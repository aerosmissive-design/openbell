import { dbSource } from "@/lib/db";

export type ChannelSendLog = {
  at: number;
  telegram?: string;
  kakao?: string;
  mail?: string;
  x?: string;
  webhook?: string;
};

async function ensureMeta() {
  const { getSql } = await import("@/lib/db");
  const sql = await getSql();
  await sql.query(
    `create table if not exists app_meta (
      key text primary key,
      value text not null,
      updated_at timestamptz not null default now()
    )`,
  );
  return sql;
}

export async function readAppMeta(key: string) {
  try {
    const sql = await ensureMeta();
    const rows = await sql.query<{ value: string }>(
      "select value from app_meta where key = $1 limit 1",
      [key],
    );
    return rows[0]?.value ?? "";
  } catch {
    return "";
  }
}

export async function writeAppMeta(key: string, value: string) {
  try {
    const sql = await ensureMeta();
    await sql.query(
      `insert into app_meta (key, value, updated_at)
       values ($1, $2, now())
       on conflict (key) do update set value = excluded.value, updated_at = now()`,
      [key, value],
    );
  } catch {
    /* preview without db */
  }
}

export async function readLastNotify(): Promise<ChannelSendLog | null> {
  const raw = await readAppMeta("last_notify");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ChannelSendLog;
  } catch {
    return null;
  }
}

export async function writeLastNotify(log: ChannelSendLog) {
  await writeAppMeta("last_notify", JSON.stringify(log));
}

export async function readWatchLastRun() {
  const raw = await readAppMeta("watch_last_run");
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export async function writeWatchLastRun(at: number) {
  await writeAppMeta("watch_last_run", String(at));
}

export function dbLabel() {
  return dbSource === "neon" ? "neon" : "pglite";
}
