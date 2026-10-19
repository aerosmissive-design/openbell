import { dbSource, isTransientDbError, type Sql } from "@/lib/db";
import { createMetaReadCache, META_READ_TTL_MS, metaNow, setMetaClockForTests } from "./meta-read-cache";
import { parseSeatStat } from "./seat-stat";

export type ChannelSendLog = {
  at: number;
  telegram?: string;
  kakao?: string;
  mail?: string;
  x?: string;
  webhook?: string;
};

let metaSql: Sql | null = null;
let metaReady = false;
const mem = new Map<string, string>();
const dirtyKeys = new Set<string>();
const metaCache = createMetaReadCache(META_READ_TTL_MS);
export type DbDegraded = "quota_exceeded" | "conn_failed";
let degraded: DbDegraded | null = null;
let quotaUntil = 0;
let lastConnProbe = 0;

export type MetaWriteResult =
  | { ok: true }
  | { ok: false; reason: "dbQuota" | "dbConn" | "error" };

export function isDbQuotaError(err: unknown) {
  const e = err as { code?: string; message?: string };
  return e?.code === "53000" || /exceeded the quota/i.test(String(e?.message || err));
}

export function dbDegraded(): DbDegraded | null {
  if (degraded === "quota_exceeded" && metaNow() >= quotaUntil) {
    degraded = null;
    quotaUntil = 0;
  }
  return degraded;
}

/** null means the caller should try Neon. Quota skips for the whole window; a dead connection skips for 30s. */
export function dbSkipReason(): DbDegraded | null {
  const state = dbDegraded();
  if (state === "quota_exceeded") return state;
  if (state === "conn_failed" && metaNow() - lastConnProbe < 30_000) return state;
  return null;
}

export function dbSkippedError(reason: DbDegraded): Error & { code: string } {
  if (reason === "quota_exceeded") {
    const err = new Error("exceeded the quota") as Error & { code: string };
    err.code = "53000";
    return err;
  }
  const err = new Error("Connection terminated") as Error & { code: string };
  err.code = "08006";
  return err;
}

export function noteDbSuccess() {
  if (degraded) clearDegraded();
}

export function noteDbFailure(err: unknown): DbDegraded | null {
  if (isDbQuotaError(err)) {
    markQuota();
    return "quota_exceeded";
  }
  if (isTransientDbError(err)) {
    markConn();
    return "conn_failed";
  }
  return null;
}

export function lastMetaDbQuota() {
  return dbDegraded() === "quota_exceeded";
}

function markQuota() {
  degraded = "quota_exceeded";
  quotaUntil = metaNow() + 15 * 60 * 1000;
  metaSql = null;
  metaReady = false;
}

function markConn() {
  degraded = "conn_failed";
  lastConnProbe = metaNow();
  metaSql = null;
  metaReady = false;
}

function clearDegraded() {
  degraded = null;
  quotaUntil = 0;
  lastConnProbe = 0;
}

async function probeDb(): Promise<boolean> {
  lastConnProbe = metaNow();
  try {
    const { getSql } = await import("@/lib/db");
    const sql = await getSql();
    await sql.query("select 1 as ok");
    clearDegraded();
    metaSql = sql;
    return true;
  } catch (err) {
    if (isDbQuotaError(err)) markQuota();
    else if (isTransientDbError(err)) markConn();
    return false;
  }
}

async function ensureMeta() {
  if (metaReady && metaSql) return metaSql;
  const { getSql } = await import("@/lib/db");
  const sql = await getSql();
  if (!metaReady) {
    await sql.query(
      `create table if not exists app_meta (
        key text primary key,
        value text not null,
        updated_at timestamptz not null default now()
      )`,
    );
    metaReady = true;
  }
  metaSql = sql;
  clearDegraded();
  return sql;
}

function fromMem(keys: string[]) {
  const out: Record<string, string> = {};
  for (const key of keys) out[key] = mem.get(key) ?? "";
  return out;
}

function storeFresh(key: string, value: string) {
  mem.set(key, value);
  dirtyKeys.delete(key);
  metaCache.set(key, value, metaNow());
}

/** Value is visible to this instance, but Neon has not accepted it yet. */
function rememberDirty(key: string, value: string) {
  mem.set(key, value);
  dirtyKeys.add(key);
  metaCache.set(key, value, metaNow());
}

function cacheHits(keys: string[]) {
  const hit: Record<string, string> = {};
  const miss: string[] = [];
  const now = metaNow();
  for (const key of keys) {
    const value = metaCache.get(key, now);
    if (value === undefined) miss.push(key);
    else hit[key] = value;
  }
  return { hit, miss };
}

export async function readAppMetas(keys: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!keys.length) return out;
  const state = dbDegraded();
  if (state === "quota_exceeded") return fromMem(keys);
  if (state === "conn_failed") {
    if (metaNow() - lastConnProbe < 30_000) return fromMem(keys);
    const ok = await probeDb();
    if (!ok) return fromMem(keys);
  }
  const { hit, miss } = cacheHits(keys);
  if (!miss.length) return hit;
  try {
    const sql = await ensureMeta();
    const rows = await sql.query<{ key: string; value: string }>(
      "select key, value from app_meta where key = any($1::text[])",
      [miss],
    );
    clearDegraded();
    Object.assign(out, hit);
    for (const row of rows) {
      out[row.key] = row.value;
      storeFresh(row.key, row.value);
    }
    for (const key of miss) {
      if (key in out) continue;
      if (dirtyKeys.has(key) && mem.has(key)) {
        out[key] = mem.get(key) ?? "";
        continue;
      }
      out[key] = "";
      storeFresh(key, "");
    }
    return out;
  } catch (err) {
    noteDbFailure(err);
    return fromMem(keys);
  }
}

export type MetaJsonField = { at: number; count: number; source: string };

function fieldFromRaw(raw: string, fallbackSource = ""): MetaJsonField | null {
  const parsed = parseSeatStat(raw, fallbackSource);
  if (!parsed) return null;
  return { at: parsed.at, count: parsed.count, source: parsed.source };
}

/**
 * at/count/source only. Postgres extracts them so a large JSON value is not
 * shipped to the instance. A fresh read-cache entry is parsed in memory.
 */
export async function readAppMetaJsonFields(keys: string[]): Promise<Record<string, MetaJsonField>> {
  const out: Record<string, MetaJsonField> = {};
  if (!keys.length) return out;
  const miss: string[] = [];
  const now = metaNow();
  for (const key of keys) {
    const cached = metaCache.get(key, now);
    if (cached === undefined) {
      miss.push(key);
      continue;
    }
    const parsed = fieldFromRaw(cached);
    if (parsed) out[key] = parsed;
  }
  if (!miss.length) return out;
  const state = dbDegraded();
  if (state === "quota_exceeded" || (state === "conn_failed" && metaNow() - lastConnProbe < 30_000)) {
    for (const key of miss) {
      const parsed = fieldFromRaw(mem.get(key) ?? "");
      if (parsed) out[key] = parsed;
    }
    return out;
  }
  try {
    const sql = await ensureMeta();
    const rows = await sql.query<{ key: string; at: string | null; count: string | null; source: string | null }>(
      `select key,
              doc->>'at' as at,
              coalesce(
                doc->>'count',
                doc->>'n',
                case
                  when jsonb_typeof(doc->'rows') = 'array' then jsonb_array_length(doc->'rows')::text
                  else null
                end
              ) as count,
              coalesce(doc->>'source', '') as source
       from (
         select key, value::jsonb as doc
         from app_meta
         where key = any($1::text[])
           and left(ltrim(value), 1) = '{'
       ) s`,
      [miss],
    );
    clearDegraded();
    for (const row of rows) {
      const at = Number(row.at) || 0;
      if (!at) continue;
      const count = Number(row.count);
      out[row.key] = {
        at,
        count: Number.isFinite(count) ? count : 0,
        source: String(row.source || ""),
      };
    }
    return out;
  } catch (err) {
    noteDbFailure(err);
    for (const key of miss) {
      const parsed = fieldFromRaw(mem.get(key) ?? "");
      if (parsed) out[key] = parsed;
    }
    return out;
  }
}

export async function readAppMeta(key: string) {
  const bag = await readAppMetas([key]);
  return bag[key] ?? "";
}

export async function writeAppMeta(key: string, value: string): Promise<MetaWriteResult> {
  const state = dbDegraded();
  if (state === "quota_exceeded") {
    rememberDirty(key, value);
    return { ok: false, reason: "dbQuota" };
  }
  if (state === "conn_failed") {
    if (metaNow() - lastConnProbe < 30_000) {
      rememberDirty(key, value);
      return { ok: false, reason: "dbConn" };
    }
    const ok = await probeDb();
    if (!ok) {
      rememberDirty(key, value);
      return { ok: false, reason: dbDegraded() === "quota_exceeded" ? "dbQuota" : "dbConn" };
    }
  }
  if (!dirtyKeys.has(key) && mem.get(key) === value && !dbDegraded()) {
    metaCache.set(key, value, metaNow());
    return { ok: true };
  }
  try {
    const sql = await ensureMeta();
    await sql.query(
      `insert into app_meta (key, value, updated_at)
       values ($1, $2, now())
       on conflict (key) do update set value = excluded.value, updated_at = now()`,
      [key, value],
    );
    storeFresh(key, value);
    clearDegraded();
    return { ok: true };
  } catch (err) {
    const reason = noteDbFailure(err);
    if (reason === "quota_exceeded") {
      rememberDirty(key, value);
      return { ok: false, reason: "dbQuota" };
    }
    if (reason === "conn_failed") {
      rememberDirty(key, value);
      return { ok: false, reason: "dbConn" };
    }
    return { ok: false, reason: "error" };
  }
}

export function __resetAppMetaForTests(sql: Sql | null = null) {
  mem.clear();
  dirtyKeys.clear();
  metaCache.clear();
  degraded = null;
  quotaUntil = 0;
  lastConnProbe = 0;
  metaSql = sql;
  metaReady = sql != null;
  setMetaClockForTests(null);
}

export function __setMetaSqlForTests(sql: Sql | null) {
  metaSql = sql;
  metaReady = sql != null;
}

export function __clearDbDegradedForTests() {
  degraded = null;
  quotaUntil = 0;
  lastConnProbe = 0;
}

export async function readLastNotify(): Promise<ChannelSendLog | null> {
  const raw = await readAppMeta(`last_notify_${watchHost()}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ChannelSendLog;
  } catch {
    return null;
  }
}

export async function writeLastNotify(log: ChannelSendLog) {
  await writeAppMeta(`last_notify_${watchHost()}`, JSON.stringify(log));
}

export function watchHost(): "grok" | "vercel" {
  return process.env.VERCEL ? "vercel" : "grok";
}

export async function readWatchLastRun() {
  const raw = await readAppMeta(`watch_last_run_${watchHost()}`);
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export async function writeWatchLastRun(at: number) {
  await writeAppMeta(`watch_last_run_${watchHost()}`, String(at));
}

export function dbLabel() {
  return dbSource === "neon" ? "neon" : "pglite";
}
