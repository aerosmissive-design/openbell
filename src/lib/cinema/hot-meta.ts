/** High-churn app_meta keys. A shared cache serves readers; Neon keeps a cold copy. */
export const HOT_META_NEON_MS = 5 * 60 * 1000;
/**
 * agent_seen feeds the 2 minute connect window. A missed cache may be this
 * stale and still counts as connected.
 */
export const AGENT_SEEN_NEON_MS = 45_000;
export const HOT_META_VALUE_MAX = 64_000;

export type HotMetaEntry = { v: string; neonAt: number; at: number };

export function isHotMetaKey(key: string): boolean {
  if (key === "reporter_instances" || key === "agent_seen_v1") return true;
  if (key.startsWith("reporter_seen:")) return true;
  if (key.startsWith("nas_seats_at:")) return true;
  // Legacy seat clock only. Source blobs are nas_seats:<source>:<theater>.
  return /^nas_seats:[^:]+$/.test(key);
}

export function hotMetaIntervalMs(key: string): number {
  if (key === "agent_seen_v1") return AGENT_SEEN_NEON_MS;
  return HOT_META_NEON_MS;
}

/** True when the shared cache has the value and Neon already stored this key recently. */
export function shouldSkipHotMetaNeon(input: {
  now: number;
  neonAt: number;
  cacheOk: boolean;
  intervalMs: number;
  valueBytes: number;
}): boolean {
  if (!input.cacheOk) return false;
  if (input.valueBytes > HOT_META_VALUE_MAX) return false;
  if (!input.neonAt) return false;
  return input.now - input.neonAt < input.intervalMs;
}

export function monthlyHotMetaWrites(input: {
  reportsPerMin: number;
  writesPerReport: number;
  distinctKeys: number;
  flushMin: number;
  days?: number;
}): { before: number; after: number } {
  const minutes = (input.days ?? 30) * 24 * 60;
  const before = input.reportsPerMin * input.writesPerReport * minutes;
  const after = Math.round((input.distinctKeys * minutes) / input.flushMin);
  return { before, after };
}
