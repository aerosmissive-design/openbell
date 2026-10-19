/** Small sibling of a seat blob. Health and reporter clocks read this, not the rows. */
export const REPORTER_SOURCES = ["pc", "nas423", "nas225"] as const;
export type ReporterSourceId = (typeof REPORTER_SOURCES)[number];

export type SeatStat = { at: number; count: number; source: string };

export function storageSource(source?: string): ReporterSourceId {
  if (source === "nas" || source === "nas423") return "nas423";
  if (source === "nas225") return "nas225";
  return "pc";
}

export function seatBlobKey(source: string, theaterId: string) {
  return `nas_seats:${storageSource(source)}:${theaterId}`;
}

export function seatStatKey(source: string, theaterId: string) {
  return `nas_seats_at:${storageSource(source)}:${theaterId}`;
}

export function legacyBlobKey(theaterId: string) {
  return `nas_seats:${theaterId}`;
}

export function seatStatJson(at: number, count: number) {
  return JSON.stringify({ at, count });
}

/** GAS stores the legacy key as {at, source, n}. Rows stay on the source key. */
export function legacyStatJson(at: number, source: string, count: number) {
  return JSON.stringify({ at, source: storageSource(source), n: count });
}

export function parseSeatStat(raw: string, fallbackSource = ""): SeatStat | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      at?: number;
      count?: number;
      n?: number;
      rows?: unknown[];
      source?: string;
    };
    const at = Number(parsed.at) || 0;
    if (!at) return null;
    let count = Number(parsed.count);
    if (!Number.isFinite(count)) count = Number(parsed.n);
    if (!Number.isFinite(count)) count = Array.isArray(parsed.rows) ? parsed.rows.length : 0;
    return { at, count, source: storageSource(parsed.source || fallbackSource) };
  } catch {
    return null;
  }
}

export function reporterLabel(source?: string) {
  const src = storageSource(source);
  if (src === "nas225") return "g-nas225+";
  if (src === "nas423") return "g-nas423+";
  return "g-pc";
}

/**
 * Fresh per-source clocks win. Legacy is only the fallback when every source
 * is missing or older than maxAge (maxAge <= 0 keeps every timestamp).
 */
export function reporterTimesFromStats(
  stats: Record<string, SeatStat | null | undefined>,
  legacy: SeatStat | null,
  now: number,
  maxAge: number,
): Record<string, string> {
  const times: Record<string, string> = {};
  for (const src of REPORTER_SOURCES) {
    const stat = stats[src];
    const at = Number(stat?.at) || 0;
    if (!at) continue;
    if (maxAge > 0 && now - at > maxAge) continue;
    times[reporterLabel(src)] = new Date(at).toISOString();
  }
  if (!Object.keys(times).length && legacy) {
    const at = Number(legacy.at) || 0;
    if (at && (maxAge <= 0 || now - at <= maxAge)) {
      times[reporterLabel(legacy.source)] = new Date(at).toISOString();
    }
  }
  return times;
}
