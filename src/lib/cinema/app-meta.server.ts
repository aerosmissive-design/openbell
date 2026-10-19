import { dbSource, isTransientDbError, type Sql } from "@/lib/db";
import {
  hotMetaIntervalMs,
  isHotMetaKey,
  shouldSkipHotMetaNeon,
  HOT_META_VALUE_MAX,
  type HotMetaEntry,
} from "./hot-meta";
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
const memAt = new Map<string, number>();
const dirtyKeys = new Set<string>();
const hotNeonAt = new Map<string, number>();
/** Neon rejected this key. The next write must hit Neon even inside the hot interval. */
const neonPending = new Set<string>();
/** Hot read-modify-write must not publish when the shared read failed. */
const freshUntrusted = new Set<string>();
const metaCache = createMetaReadCache(META_READ_TTL_MS);
const SHARED_META_NS = "openbell";
const SHARED_META_TTL_SEC = 45 * 60;

type SharedRead = { ok: true; entry: HotMetaEntry | null } | { ok: false };

type SharedFns = {
  read(key: string): Promise<SharedRead>;
  write(key: string, entry: HotMetaEntry): Promise<boolean>;
  delete(key: string): Promise<void>;
};

let sharedFns: SharedFns | null = null;
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
  memAt.set(key, metaNow());
  dirtyKeys.delete(key);
  neonPending.delete(key);
  metaCache.set(key, value, metaNow());
}

/** Value is visible to this instance, but Neon has not accepted it yet. */
function rememberDirty(key: string, value: string) {
  mem.set(key, value);
  memAt.set(key, metaNow());
  dirtyKeys.add(key);
  neonPending.add(key);
  metaCache.set(key, value, metaNow());
}

function asShared(value: unknown): HotMetaEntry | null {
  if (!value || typeof value !== "object") return null;
  const rec = value as { v?: unknown; neonAt?: unknown; at?: unknown };
  if (typeof rec.v !== "string") return null;
  const at = Number(rec.at) || 0;
  if (!at) return null;
  return { v: rec.v, neonAt: Number(rec.neonAt) || 0, at };
}

function within<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

function timed<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

async function defaultShared(): Promise<SharedFns> {
  const { getCache } = await import("@vercel/functions");
  const cache = () => getCache({ namespace: SHARED_META_NS });
  const name = (key: string) => `shared-meta:${key}`;
  return {
    read: async (key) => {
      try {
        const value = await timed(cache().get(name(key)), 400);
        return { ok: true, entry: asShared(value) };
      } catch {
        return { ok: false };
      }
    },
    write: (key, entry) =>
      within(cache().set(name(key), entry, { ttl: SHARED_META_TTL_SEC, name: "shared-meta" }).then(() => true), 800, false),
    delete: (key) => within(cache().delete(name(key)).then(() => undefined), 400, undefined),
  };
}

async function sharedApi(): Promise<SharedFns | null> {
  if (sharedFns) return sharedFns;
  try {
    sharedFns = await defaultShared();
    return sharedFns;
  } catch {
    // Cache is absent, so Neon stays the source of truth. A miss is not a timeout.
    sharedFns = {
      read: async () => ({ ok: true, entry: null }),
      write: async () => false,
      delete: async () => undefined,
    };
    return sharedFns;
  }
}

async function readShared(key: string): Promise<SharedRead> {
  try {
    const api = await sharedApi();
    if (!api) return { ok: true, entry: null };
    return await api.read(key);
  } catch {
    return { ok: false };
  }
}

async function publishShared(key: string, value: string, neonAt: number): Promise<boolean> {
  if (value.length > HOT_META_VALUE_MAX) {
    try {
      const api = await sharedApi();
      if (api) await api.delete(key);
    } catch {
      /* a value that does not fit must not keep hiding Neon */
    }
    return false;
  }
  try {
    const api = await sharedApi();
    if (!api) return false;
    const ok = await api.write(key, { v: value, neonAt, at: metaNow() });
    if (!ok) await api.delete(key);
    return ok;
  } catch {
    return false;
  }
}

function adoptEntry(key: string, entry: HotMetaEntry) {
  mem.set(key, entry.v);
  memAt.set(key, entry.at);
  metaCache.set(key, entry.v, metaNow());
  if (entry.neonAt) hotNeonAt.set(key, entry.neonAt);
  dirtyKeys.delete(key);
}

/** Shared cache and this instance's unflushed value. Neon is only for whatever is still missing. */
async function adoptHot(keys: string[]): Promise<{ hit: Record<string, string>; rest: string[] }> {
  const hit: Record<string, string> = {};
  const rest: string[] = [];
  const hotKeys = keys.filter((key) => isHotMetaKey(key));
  const fetched = new Map<string, SharedRead>();
  await Promise.all(
    hotKeys.map(async (key) => {
      fetched.set(key, await readShared(key));
    }),
  );
  for (const key of keys) {
    if (!isHotMetaKey(key)) {
      rest.push(key);
      continue;
    }
    const read = fetched.get(key);
    if (!read?.ok) {
      if (mem.has(key)) {
        hit[key] = mem.get(key) ?? "";
        continue;
      }
      rest.push(key);
      continue;
    }
    const entry = read.entry;
    const localAt = memAt.get(key) ?? 0;
    if (dirtyKeys.has(key) && mem.has(key) && localAt > (entry?.at ?? 0)) {
      hit[key] = mem.get(key) ?? "";
      metaCache.set(key, hit[key], metaNow());
      continue;
    }
    if (entry) {
      adoptEntry(key, entry);
      hit[key] = entry.v;
      continue;
    }
    if (dirtyKeys.has(key) && mem.has(key)) {
      hit[key] = mem.get(key) ?? "";
      continue;
    }
    rest.push(key);
  }
  return { hit, rest };
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
  const blocked =
    state === "quota_exceeded" || (state === "conn_failed" && metaNow() - lastConnProbe < 30_000);
  if (state === "conn_failed" && !blocked) {
    const ok = await probeDb();
    if (!ok) {
      const hot = await adoptHot(keys);
      return { ...hot.hit, ...fromMem(hot.rest) };
    }
  }
  if (blocked) {
    const hot = await adoptHot(keys);
    return { ...hot.hit, ...fromMem(hot.rest) };
  }
  const { hit, miss } = cacheHits(keys);
  if (!miss.length) return hit;
  const hot = await adoptHot(miss);
  if (!hot.rest.length) return { ...hit, ...hot.hit };
  try {
    const sql = await ensureMeta();
    const rows = await sql.query<{ key: string; value: string }>(
      "select key, value from app_meta where key = any($1::text[])",
      [hot.rest],
    );
    clearDegraded();
    Object.assign(out, hit, hot.hit);
    for (const row of rows) {
      if (dirtyKeys.has(row.key) && mem.has(row.key)) {
        out[row.key] = mem.get(row.key) ?? "";
        continue;
      }
      out[row.key] = row.value;
      storeFresh(row.key, row.value);
      await publishShared(row.key, row.value, metaNow());
    }
    for (const key of hot.rest) {
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
    return { ...hit, ...hot.hit, ...fromMem(hot.rest) };
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
  const hot = await adoptHot(miss);
  for (const [key, raw] of Object.entries(hot.hit)) {
    const parsed = fieldFromRaw(raw);
    if (parsed) out[key] = parsed;
  }
  const rest = hot.rest.filter((key) => !(key in out));
  if (!rest.length) return out;
  const state = dbDegraded();
  if (state === "quota_exceeded" || (state === "conn_failed" && metaNow() - lastConnProbe < 30_000)) {
    for (const key of rest) {
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
      [rest],
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
    for (const key of rest) {
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

/**
 * Read-modify-write must not reuse the 45s instance cache. A shared cache hit
 * is the latest publish; otherwise Neon is read and copied into that cache.
 */
/** False only after a hot shared read failed. Callers must not write that value back. */
export function appMetaFreshTrusted(key: string) {
  return !freshUntrusted.has(key);
}

export async function readAppMetaFresh(key: string): Promise<string> {
  const read = await readShared(key);
  if (!read.ok && isHotMetaKey(key)) {
    freshUntrusted.add(key);
    if (mem.has(key)) return mem.get(key) ?? "";
  } else if (read.ok) {
    freshUntrusted.delete(key);
    const entry = read.entry;
    const localAt = memAt.get(key) ?? 0;
    if (dirtyKeys.has(key) && mem.has(key) && localAt > (entry?.at ?? 0)) return mem.get(key) ?? "";
    if (entry) {
      adoptEntry(key, entry);
      return entry.v;
    }
  } else {
    freshUntrusted.delete(key);
  }
  const state = dbDegraded();
  if (state === "quota_exceeded" || (state === "conn_failed" && metaNow() - lastConnProbe < 30_000)) {
    return mem.get(key) ?? "";
  }
  if (state === "conn_failed") {
    const ok = await probeDb();
    if (!ok) return mem.get(key) ?? "";
  }
  try {
    const sql = await ensureMeta();
    const rows = await sql.query<{ key: string; value: string }>(
      "select key, value from app_meta where key = any($1::text[])",
      [[key]],
    );
    clearDegraded();
    const value = rows[0]?.value ?? "";
    if (freshUntrusted.has(key)) return value;
    if ((dirtyKeys.has(key) || neonPending.has(key)) && mem.has(key)) return mem.get(key) ?? "";
    storeFresh(key, value);
    if (value) await publishShared(key, value, metaNow());
    return value;
  } catch (err) {
    noteDbFailure(err);
    return mem.get(key) ?? "";
  }
}

export async function writeAppMeta(key: string, value: string): Promise<MetaWriteResult> {
  const state = dbDegraded();
  if (state === "quota_exceeded") {
    rememberDirty(key, value);
    await publishShared(key, value, hotNeonAt.get(key) ?? 0);
    return { ok: false, reason: "dbQuota" };
  }
  if (state === "conn_failed") {
    if (metaNow() - lastConnProbe < 30_000) {
      rememberDirty(key, value);
      await publishShared(key, value, hotNeonAt.get(key) ?? 0);
      return { ok: false, reason: "dbConn" };
    }
    const ok = await probeDb();
    if (!ok) {
      rememberDirty(key, value);
      await publishShared(key, value, hotNeonAt.get(key) ?? 0);
      return { ok: false, reason: dbDegraded() === "quota_exceeded" ? "dbQuota" : "dbConn" };
    }
  }
  if (!dirtyKeys.has(key) && !neonPending.has(key) && mem.get(key) === value && !dbDegraded()) {
    metaCache.set(key, value, metaNow());
    return { ok: true };
  }
  if (isHotMetaKey(key) && !neonPending.has(key)) {
    let neonAt = hotNeonAt.get(key) ?? 0;
    if (!neonAt) {
      const prev = await readShared(key);
      if (prev.ok && prev.entry?.neonAt) neonAt = prev.entry.neonAt;
    }
    const cacheOk = await publishShared(key, value, neonAt);
    if (
      shouldSkipHotMetaNeon({
        now: metaNow(),
        neonAt,
        cacheOk,
        intervalMs: hotMetaIntervalMs(key),
        valueBytes: value.length,
      })
    ) {
      mem.set(key, value);
      memAt.set(key, metaNow());
      dirtyKeys.add(key);
      metaCache.set(key, value, metaNow());
      hotNeonAt.set(key, neonAt);
      return { ok: true };
    }
  }
  try {
    const sql = await ensureMeta();
    await sql.query(
      `insert into app_meta (key, value, updated_at)
       values ($1, $2, now())
       on conflict (key) do update set value = excluded.value, updated_at = now()`,
      [key, value],
    );
    const at = metaNow();
    storeFresh(key, value);
    if (isHotMetaKey(key)) hotNeonAt.set(key, at);
    await publishShared(key, value, at);
    clearDegraded();
    return { ok: true };
  } catch (err) {
    const reason = noteDbFailure(err);
    if (reason === "quota_exceeded") {
      rememberDirty(key, value);
      await publishShared(key, value, hotNeonAt.get(key) ?? 0);
      return { ok: false, reason: "dbQuota" };
    }
    if (reason === "conn_failed") {
      rememberDirty(key, value);
      await publishShared(key, value, hotNeonAt.get(key) ?? 0);
      return { ok: false, reason: "dbConn" };
    }
    return { ok: false, reason: "error" };
  }
}

export function __resetAppMetaForTests(sql: Sql | null = null) {
  mem.clear();
  memAt.clear();
  dirtyKeys.clear();
  hotNeonAt.clear();
  neonPending.clear();
  freshUntrusted.clear();
  metaCache.clear();
  degraded = null;
  quotaUntil = 0;
  lastConnProbe = 0;
  metaSql = sql;
  metaReady = sql != null;
  setMetaClockForTests(null);
  __setSharedMetaCacheForTests("off");
}

export function __dropMetaMemoryForTests() {
  mem.clear();
  memAt.clear();
  dirtyKeys.clear();
  hotNeonAt.clear();
  neonPending.clear();
  freshUntrusted.clear();
  metaCache.clear();
}

export function __setSharedMetaCacheForTests(mode: "default" | "off" | "error" | Map<string, HotMetaEntry>) {
  if (mode === "default") {
    sharedFns = null;
    return;
  }
  if (mode === "off" || mode === "error") {
    const failed = mode === "error";
    sharedFns = {
      read: async () => (failed ? { ok: false } : { ok: true, entry: null }),
      write: async () => false,
      delete: async () => undefined,
    };
    return;
  }
  sharedFns = {
    read: async (key) => ({ ok: true, entry: mode.get(key) ?? null }),
    write: async (key, entry) => {
      mode.set(key, entry);
      return true;
    },
    delete: async (key) => {
      mode.delete(key);
    },
  };
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
