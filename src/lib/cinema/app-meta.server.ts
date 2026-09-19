import { dbSource } from "@/lib/db";

export type ChannelSendLog = {
  at: number;
  telegram?: string;
  kakao?: string;
  mail?: string;
  x?: string;
  webhook?: string;
};

type Sql = Awaited<ReturnType<(typeof import("@/lib/db"))["getSql"]>>;

let metaSql: Sql | null = null;
let metaReady = false;
const mem = new Map<string, string>();
let lastDbQuota = false;

export function isDbQuotaError(err: unknown) {
  const e = err as { code?: string; message?: string };
  return e?.code === "53000" || /exceeded the quota/i.test(String(e?.message || err));
}

export function lastMetaDbQuota() {
  return lastDbQuota;
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
  lastDbQuota = false;
  return sql;
}

export async function readAppMetas(keys: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!keys.length) return out;
  try {
    const sql = await ensureMeta();
    const rows = await sql.query<{ key: string; value: string }>(
      "select key, value from app_meta where key = any($1::text[])",
      [keys],
    );
    lastDbQuota = false;
    for (const row of rows) {
      out[row.key] = row.value;
      mem.set(row.key, row.value);
    }
    for (const key of keys) {
      if (!(key in out)) out[key] = mem.get(key) ?? "";
    }
    return out;
  } catch (err) {
    if (isDbQuotaError(err)) lastDbQuota = true;
    for (const key of keys) out[key] = mem.get(key) ?? "";
    return out;
  }
}

export async function readAppMeta(key: string) {
  const bag = await readAppMetas([key]);
  return bag[key] ?? "";
}

export async function writeAppMeta(key: string, value: string) {
  if (mem.get(key) === value) return;
  try {
    const sql = await ensureMeta();
    await sql.query(
      `insert into app_meta (key, value, updated_at)
       values ($1, $2, now())
       on conflict (key) do update set value = excluded.value, updated_at = now()`,
      [key, value],
    );
    mem.set(key, value);
    lastDbQuota = false;
  } catch (err) {
    if (isDbQuotaError(err)) lastDbQuota = true;
  }
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
