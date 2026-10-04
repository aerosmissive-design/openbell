import { randomUUID } from "node:crypto";
import type { NotificationChannel, NotificationEventType } from "./types";

const RETAIN_DAYS = 30;

export async function writeDeliveryLog(row: {
  userId: string;
  eventType: NotificationEventType;
  channel: NotificationChannel;
  ok: boolean;
  isTest: boolean;
  detail: string;
  idempotencyKey?: string;
}) {
  const { ensureNotifySchema } = await import("./schema.server");
  const { getSql } = await import("@/lib/db");
  await ensureNotifySchema();
  const sql = await getSql();
  await sql.query(
    `insert into notification_delivery_log
      (id, user_id, event_type, channel, ok, is_test, detail, idempotency_key)
     values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      randomUUID(),
      row.userId || "env",
      row.eventType,
      row.channel,
      row.ok,
      row.isTest,
      row.detail.slice(0, 300),
      row.idempotencyKey || "",
    ],
  );
  await sql.query(
    `delete from notification_delivery_log where created_at < now() - interval '30 days'`,
  );
}

export const DELIVERY_LOG_RETAIN_DAYS = RETAIN_DAYS;

export async function claimIdempotency(key: string, ttlSeconds = 3600) {
  const clean = key.trim();
  if (!clean) return true;
  const { ensureNotifySchema } = await import("./schema.server");
  const { getSql } = await import("@/lib/db");
  await ensureNotifySchema();
  const sql = await getSql();
  await sql.query(`delete from notification_idempotency where expires_at < now()`);
  const rows = await sql.query<{ idempotency_key: string }>(
    `insert into notification_idempotency (idempotency_key, expires_at)
     values ($1, now() + ($2::int * interval '1 second'))
     on conflict (idempotency_key) do nothing
     returning idempotency_key`,
    [clean, String(ttlSeconds)],
  );
  return rows.length > 0;
}
