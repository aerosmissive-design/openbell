/**
 * Watch tick reads user_settings every 3 minutes. The fat columns (config,
 * host_seen, queue, auto lists) stay in a rev cache. Neon is asked for xmin
 * and email only, until a real update changes the row.
 */

export type WatchFatRow = {
  user_id: string;
  config: unknown;
  queue: unknown;
  seen_dates: unknown;
  watch_sig: string | null;
  auto_movies: unknown;
  auto_shows: unknown;
  auto_fired: unknown;
  host_seen: unknown;
  primed: unknown;
};

export type WatchLoadedRow = WatchFatRow & {
  rev: string;
  account_email: string | null;
};

export type WatchQuery = (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

export type WatchRowCache = {
  get(userId: string, rev: string): Promise<WatchFatRow | null>;
  set(userId: string, rev: string, row: WatchFatRow): Promise<void>;
  drop(userId: string): Promise<void>;
};

const STAMP_SQL = `select us.user_id, us.xmin::text as rev, u.email as account_email
     from user_settings us
     left join "user" u on u.id = us.user_id`;

const FAT_SQL = `select us.user_id,
            us.xmin::text as rev,
            us.config,
            us.queue,
            us.prefs->'seenDates' as seen_dates,
            us.prefs->>'watchSig' as watch_sig,
            us.prefs->'autoMovies' as auto_movies,
            us.prefs->'autoShows' as auto_shows,
            us.prefs->'autoFired' as auto_fired,
            coalesce(us.prefs->>'primed', '') as primed,
            coalesce(us.prefs #> ARRAY['seenByHost', $1], '[]'::jsonb) as host_seen
     from user_settings us
     where us.user_id = any($2::text[])`;

function text(value: unknown): string {
  return value == null ? "" : String(value);
}

function asFat(raw: Record<string, unknown>): WatchFatRow {
  return {
    user_id: text(raw.user_id),
    config: raw.config ?? null,
    queue: raw.queue ?? [],
    seen_dates: raw.seen_dates ?? [],
    watch_sig: raw.watch_sig == null ? null : String(raw.watch_sig),
    auto_movies: raw.auto_movies ?? [],
    auto_shows: raw.auto_shows ?? [],
    auto_fired: raw.auto_fired ?? {},
    host_seen: raw.host_seen ?? [],
    primed: raw.primed ?? "",
  };
}

export async function loadWatchUserRows(
  query: WatchQuery,
  cache: WatchRowCache,
  host: string,
): Promise<WatchLoadedRow[]> {
  const stamps = await query(STAMP_SQL);
  const ordered: { userId: string; rev: string; email: string | null }[] = [];
  const seen = new Set<string>();
  for (const raw of stamps) {
    const userId = text(raw.user_id);
    const rev = text(raw.rev);
    if (!userId || !rev || seen.has(userId)) continue;
    seen.add(userId);
    ordered.push({ userId, rev, email: text(raw.account_email).trim() || null });
  }
  const found = new Map<string, { rev: string; row: WatchFatRow }>();
  const miss: string[] = [];
  for (const stamp of ordered) {
    const cached = await cache.get(stamp.userId, stamp.rev);
    if (cached && cached.user_id === stamp.userId) found.set(stamp.userId, { rev: stamp.rev, row: cached });
    else miss.push(stamp.userId);
  }
  if (miss.length) {
    const fats = await query(FAT_SQL, [host, miss]);
    for (const raw of fats) {
      const row = asFat(raw);
      const rev = text(raw.rev);
      if (!row.user_id || !rev) continue;
      found.set(row.user_id, { rev, row });
      await cache.set(row.user_id, rev, row);
    }
  }
  const out: WatchLoadedRow[] = [];
  for (const stamp of ordered) {
    const row = found.get(stamp.userId);
    if (!row) continue;
    out.push({ ...row.row, rev: row.rev, account_email: stamp.email });
  }
  return out;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    return `{${Object.keys(rec)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(rec[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function shouldPersistWatch(input: {
  prevPrimed: boolean;
  nextPrimed: boolean;
  prevSig: string;
  nextSig: string;
  prevDates: string[];
  nextDates: string[];
  prevSeen: string[];
  nextSeen: string[];
  prevQueue: unknown;
  nextQueue: unknown;
  prevFired: unknown;
  nextFired: unknown;
  alertCount: number;
}): boolean {
  if (input.alertCount > 0) return true;
  if (input.prevPrimed !== input.nextPrimed) return true;
  if (input.prevSig !== input.nextSig) return true;
  if (stableJson(input.prevDates) !== stableJson(input.nextDates)) return true;
  if (stableJson(input.prevSeen) !== stableJson(input.nextSeen)) return true;
  if (stableJson(input.prevQueue) !== stableJson(input.nextQueue)) return true;
  if (stableJson(input.prevFired) !== stableJson(input.nextFired)) return true;
  return false;
}

/** Bytes leaving Neon for the watch-tick settings read. */
export function monthlyWatchTickEgressBytes(input: {
  ticksPerDay: number;
  fatBytes: number;
  stampBytes: number;
  reloadsPerDay: number;
  days?: number;
}): { before: number; after: number } {
  const days = input.days ?? 30;
  const before = input.ticksPerDay * input.fatBytes * days;
  const after = (input.ticksPerDay * input.stampBytes + input.reloadsPerDay * input.fatBytes) * days;
  return { before, after };
}
