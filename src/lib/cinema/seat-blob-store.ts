/**
 * Hot seat blobs live in the Vercel Runtime Cache. Neon is the cold copy.
 * Item cap: Runtime Cache rejects a value over 2 MiB, so we pack under 2_000_000 bytes.
 */

export const SEAT_BLOB_CACHE_NS = "openbell";
/** Stay under the 2 MiB Runtime Cache item limit. */
export const RUNTIME_CACHE_ITEM_LIMIT = 2_000_000;
/** Longer than the 30-minute freshness window so a fresh blob is not re-read from Neon. */
export const SEAT_BLOB_CACHE_TTL_SEC = 45 * 60;
/** Cold Neon copy of one source key. */
export const SEAT_BLOB_NEON_INTERVAL_MS = 10 * 60 * 1000;
/** A schedule change, not a seat-count flicker. */
export const SEAT_BLOB_COUNT_DELTA = 20;
const SEAT_BLOB_MAX_SHARDS = 24;
const NEON_MARK_PREFIX = "neon-seat-mark:";

export type SeatBlobRow = {
  playDate?: string;
  startTime?: string;
  hallName?: string;
  movieTitle?: string;
  movieNo?: string;
  bookingUrl?: string;
  scnsNo?: string;
  scnSseq?: string;
  restSeats?: number;
  totalSeats?: number;
  status?: string;
};

export type SeatBlobPayload = {
  at?: number;
  rows?: SeatBlobRow[];
  mode?: string;
  source?: string;
  sourceId?: string;
  displayGroup?: string;
};

export type SeatBlobManifest = {
  v: 1;
  compact: 1;
  at: number;
  mode?: string;
  source?: string;
  sourceId?: string;
  displayGroup?: string;
  n: number;
  body?: string;
  shards?: number;
  /** Shard keys are `${blobKey}#${shardGen}#${i}` so a new write cannot mix with the previous one. */
  shardGen?: string;
};

export type SeatBlobCachePlan =
  | { kind: "raw"; value: string; shards: string[]; complete: boolean }
  | { kind: "compact"; manifest: SeatBlobManifest; shards: string[]; complete: boolean };

export type SeatBlobReadDeps = {
  cacheGet(key: string): Promise<unknown>;
  gasRead(keys: string[]): Promise<Record<string, string>>;
  dbRead(keys: string[]): Promise<Record<string, string>>;
  /** Newest stat clock. GAS older than this by SEAT_GAS_STALE_MS falls through to Neon. */
  knownAts?(keys: string[]): Promise<Record<string, number>>;
  /** Remember a GAS or Neon payload so the next scan can hit Runtime Cache. */
  cachePut?(key: string, payloadJson: string): Promise<unknown>;
};

/** GAS this far behind the stat clock is not allowed to hide Neon. */
export const SEAT_GAS_STALE_MS = 2 * 60 * 1000;

type NeonMark = { at: number; count: number };

const mirror = new Map<string, string>();
const neonWrites = new Map<string, NeonMark>();

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

export function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

export function fitsCacheItem(value: unknown, limit = RUNTIME_CACHE_ITEM_LIMIT): boolean {
  return jsonBytes(value) <= limit;
}

function cell(value: unknown): string {
  return String(value ?? "").replace(/[\t\n\r]/g, " ");
}

export function encodeSeatRow(row: SeatBlobRow): string {
  const total = row.totalSeats == null || !Number.isFinite(Number(row.totalSeats)) ? "" : String(row.totalSeats);
  return [
    cell(row.playDate),
    cell(row.startTime),
    cell(row.hallName),
    cell(row.movieTitle),
    cell(row.restSeats),
    total,
    cell(row.movieNo),
    cell(row.scnsNo),
    cell(row.scnSseq),
    cell(row.bookingUrl),
    cell(row.status),
  ].join("\t");
}

export function decodeSeatRows(body: string): SeatBlobRow[] {
  const rows: SeatBlobRow[] = [];
  if (!body) return rows;
  for (const line of body.split("\n")) {
    if (!line) continue;
    const cols = line.split("\t");
    const rest = Number(cols[4]);
    if (!Number.isFinite(rest)) continue;
    const tot = cols[5] === "" || cols[5] == null ? undefined : Number(cols[5]);
    const status = cols[10] ? String(cols[10]) : undefined;
    rows.push({
      playDate: cols[0] || "",
      startTime: cols[1] || "",
      hallName: cols[2] || "",
      movieTitle: cols[3] || "",
      restSeats: rest,
      totalSeats: Number.isFinite(Number(tot)) ? Number(tot) : undefined,
      movieNo: cols[6] || "",
      scnsNo: cols[7] || "",
      scnSseq: cols[8] || "",
      bookingUrl: cols[9] || "",
      status,
    });
  }
  return rows;
}

function payloadFromParts(manifest: SeatBlobManifest, body: string): string {
  return JSON.stringify({
    at: Number(manifest.at) || 0,
    rows: decodeSeatRows(body),
    mode: manifest.mode || "full",
    source: manifest.source || "",
    sourceId: manifest.sourceId || "",
    displayGroup: manifest.displayGroup || "",
  });
}

function packShards(lines: string[], limit: number): string[] | null {
  const shards: string[] = [];
  let buf: string[] = [];
  const flush = () => {
    if (!buf.length) return;
    shards.push(buf.join("\n"));
    buf = [];
  };
  for (const line of lines) {
    if (!fitsCacheItem(line, limit)) return null;
    if (buf.length && !fitsCacheItem(`${buf.join("\n")}\n${line}`, limit)) flush();
    buf.push(line);
    if (shards.length + 1 > SEAT_BLOB_MAX_SHARDS) return null;
  }
  flush();
  if (shards.length > SEAT_BLOB_MAX_SHARDS) return null;
  return shards;
}

export function planSeatBlobCache(payloadJson: string, limit = RUNTIME_CACHE_ITEM_LIMIT): SeatBlobCachePlan {
  if (fitsCacheItem(payloadJson, limit)) return { kind: "raw", value: payloadJson, shards: [], complete: true };
  let payload: SeatBlobPayload;
  try {
    payload = JSON.parse(payloadJson) as SeatBlobPayload;
  } catch {
    return { kind: "raw", value: payloadJson, shards: [], complete: false };
  }
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const lines = rows.map((row) => encodeSeatRow(row));
  const base: SeatBlobManifest = {
    v: 1,
    compact: 1,
    at: Number(payload.at) || 0,
    mode: payload.mode,
    source: payload.source,
    sourceId: payload.sourceId,
    displayGroup: payload.displayGroup,
    n: rows.length,
  };
  const one: SeatBlobManifest = { ...base, body: lines.join("\n") };
  if (fitsCacheItem(one, limit)) return { kind: "compact", manifest: one, shards: [], complete: true };
  const shards = packShards(lines, limit);
  if (!shards) return { kind: "compact", manifest: { ...base, shards: 0 }, shards: [], complete: false };
  const manifest: SeatBlobManifest = { ...base, shards: shards.length };
  if (!fitsCacheItem(manifest, limit)) return { kind: "compact", manifest, shards, complete: false };
  return { kind: "compact", manifest, shards, complete: true };
}

/** Shard puts first, manifest last. Null means the payload cannot be cached. */
export function seatBlobCachePuts(
  key: string,
  payloadJson: string,
  limit = RUNTIME_CACHE_ITEM_LIMIT,
): { key: string; value: unknown }[] | null {
  const plan = planSeatBlobCache(payloadJson, limit);
  if (!plan.complete) return null;
  if (plan.kind === "raw") return [{ key, value: plan.value }];
  const shardGen = `${plan.manifest.at}:${plan.shards.length}:${plan.shards.reduce((sum, shard) => sum + shard.length, 0)}`;
  const puts: { key: string; value: unknown }[] = plan.shards.map((shard, index) => ({
    key: `${key}#${shardGen}#${index}`,
    value: shard,
  }));
  puts.push({ key, value: { ...plan.manifest, shardGen } });
  return puts;
}

function payloadAt(raw: string): number {
  try {
    const parsed = JSON.parse(raw) as { at?: number };
    return Number(parsed.at) || 0;
  } catch {
    return 0;
  }
}

function preferNewer(current: string, next: string): string {
  if (!current) return next;
  if (!next) return current;
  return payloadAt(next) >= payloadAt(current) ? next : current;
}

export async function unpackSeatBlob(
  key: string,
  value: unknown,
  getShard: (shardKey: string) => Promise<unknown>,
): Promise<string> {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as SeatBlobPayload;
      if (parsed && Array.isArray(parsed.rows) && parsed.at) return value;
    } catch {
      return "";
    }
    return "";
  }
  if (!value || typeof value !== "object") return "";
  const rec = value as SeatBlobManifest & SeatBlobPayload;
  if (rec.compact !== 1) {
    if (Array.isArray(rec.rows) && rec.at) return JSON.stringify(rec);
    return "";
  }
  let body = typeof rec.body === "string" ? rec.body : "";
  const n = Number(rec.shards) || 0;
  const gen = typeof rec.shardGen === "string" ? rec.shardGen : "";
  if (!body && n > 0) {
    const pieces = await Promise.all(
      Array.from({ length: n }, (_, i) => getShard(gen ? `${key}#${gen}#${i}` : `${key}#${i}`)),
    );
    if (pieces.some((piece) => typeof piece !== "string" || piece.length === 0)) return "";
    body = (pieces as string[]).join("\n");
  }
  if (!rec.at) return "";
  if (n > 0 && !body) return "";
  return payloadFromParts(rec, body);
}

/**
 * Cache, then GAS, then Neon. A layer is asked only for the keys still missing.
 */
export async function readSeatBlobs(keys: string[], deps: SeatBlobReadDeps): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const missed: string[] = [];
  await Promise.all(
    keys.map(async (key) => {
      let value: unknown = null;
      try {
        value = await deps.cacheGet(key);
      } catch {
        value = null;
      }
      const raw = await unpackSeatBlob(key, value, async (shardKey) => {
        try {
          return await deps.cacheGet(shardKey);
        } catch {
          return null;
        }
      });
      if (raw) out[key] = raw;
      else missed.push(key);
    }),
  );
  if (!missed.length) return out;
  let gas: Record<string, string> = {};
  try {
    gas = await deps.gasRead(missed);
  } catch {
    gas = {};
  }
  let known: Record<string, number> = {};
  let knownFailed = false;
  const gasKeys = missed.filter((key) => gas[key]);
  if (gasKeys.length && deps.knownAts) {
    try {
      known = await deps.knownAts(gasKeys);
    } catch {
      known = {};
      knownFailed = true;
    }
  }
  const dbKeys: string[] = [];
  const gasFallback = new Map<string, string>();
  for (const key of missed) {
    const gasRaw = gas[key] || "";
    if (!gasRaw) {
      dbKeys.push(key);
      continue;
    }
    const knownAt = Number(known[key]) || 0;
    const gasAt = payloadAt(gasRaw);
    if (knownFailed || (knownAt && gasAt && knownAt - gasAt > SEAT_GAS_STALE_MS)) {
      gasFallback.set(key, gasRaw);
      dbKeys.push(key);
      continue;
    }
    out[key] = gasRaw;
  }
  if (dbKeys.length) {
    let db: Record<string, string> = {};
    try {
      db = await deps.dbRead(dbKeys);
    } catch {
      db = {};
    }
    for (const key of dbKeys) {
      const picked = preferNewer(gasFallback.get(key) || "", db[key] || "");
      if (picked) out[key] = picked;
    }
  }
  if (deps.cachePut) {
    const fill = missed.filter((key) => {
      const value = out[key];
      if (!value) return false;
      if (knownFailed && gasFallback.get(key) === value) return false;
      const knownAt = Number(known[key]) || 0;
      if (!knownAt) return true;
      // A stale GAS fallback must not stick in front of a later Neon copy.
      return payloadAt(value) + SEAT_GAS_STALE_MS >= knownAt;
    });
    await Promise.all(
      fill.map(async (key) => {
        try {
          await deps.cachePut!(key, out[key]);
        } catch {
          /* the value already read still stands */
        }
      }),
    );
  }
  return out;
}

export function shouldWriteNeonSeatBlob(input: {
  now: number;
  lastAt: number;
  lastCount: number;
  count: number;
  cacheOk: boolean;
  intervalMs?: number;
  countDelta?: number;
}): boolean {
  if (!input.cacheOk) return true;
  if (!input.lastAt) return true;
  const interval = input.intervalMs ?? SEAT_BLOB_NEON_INTERVAL_MS;
  const delta = input.countDelta ?? SEAT_BLOB_COUNT_DELTA;
  if (input.now - input.lastAt >= interval) return true;
  if (Math.abs(input.count - input.lastCount) >= delta) return true;
  return false;
}

export function neonSeatMarkKey(blobKey: string) {
  return `${NEON_MARK_PREFIX}${blobKey}`;
}

export function parseNeonSeatMark(value: unknown): NeonMark | null {
  let rec: unknown = value;
  if (typeof value === "string") {
    try {
      rec = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!rec || typeof rec !== "object") return null;
  const at = Number((rec as { at?: number }).at) || 0;
  const count = Number((rec as { count?: number }).count);
  if (!at || !Number.isFinite(count)) return null;
  return { at, count };
}

function cachedAt(value: unknown): number {
  if (typeof value === "string") {
    try {
      return cachedAt(JSON.parse(value));
    } catch {
      return 0;
    }
  }
  if (!value || typeof value !== "object") return 0;
  return Number((value as { at?: number }).at) || 0;
}

async function runtimeCacheGet(key: string): Promise<unknown> {
  try {
    const { getCache } = await import("@vercel/functions");
    return await within(getCache({ namespace: SEAT_BLOB_CACHE_NS }).get(key), 1000, null);
  } catch {
    return null;
  }
}

async function runtimeCacheDelete(key: string): Promise<void> {
  try {
    const { getCache } = await import("@vercel/functions");
    await within(getCache({ namespace: SEAT_BLOB_CACHE_NS }).delete(key).then(() => undefined), 1000, undefined);
  } catch {
    /* a stale entry expires with the ttl */
  }
}

async function runtimeCacheSet(key: string, value: unknown, name: string): Promise<boolean> {
  try {
    const { getCache } = await import("@vercel/functions");
    return await within(
      getCache({ namespace: SEAT_BLOB_CACHE_NS })
        .set(key, value, { ttl: SEAT_BLOB_CACHE_TTL_SEC, name })
        .then(() => true),
      2000,
      false,
    );
  } catch {
    return false;
  }
}

/** Shared Runtime Cache first. The instance mirror wins only when it is newer. */
export async function readSeatBlobCacheValue(key: string): Promise<unknown> {
  const remote = await runtimeCacheGet(key);
  const local = mirror.get(key) ?? null;
  if (remote == null || remote === "") return local;
  if (local == null) return remote;
  if (cachedAt(local) > cachedAt(remote)) return local;
  return remote;
}

export async function saveSeatBlobCache(key: string, payloadJson: string): Promise<boolean> {
  mirror.set(key, payloadJson);
  const puts = seatBlobCachePuts(key, payloadJson);
  if (!puts) {
    await runtimeCacheDelete(key);
    return false;
  }
  const head = puts[puts.length - 1];
  const shards = puts.slice(0, -1);
  if (shards.length) {
    const wrote = await Promise.all(shards.map((put) => runtimeCacheSet(put.key, put.value, put.key)));
    if (!wrote.every(Boolean)) {
      await runtimeCacheDelete(key);
      return false;
    }
  }
  const ok = await runtimeCacheSet(head.key, head.value, head.key);
  // A failed put must not leave an older cache entry hiding GAS and Neon.
  if (!ok) await runtimeCacheDelete(key);
  return ok;
}

export async function loadNeonSeatMark(blobKey: string, now = Date.now()): Promise<NeonMark | null> {
  const mem = neonWrites.get(blobKey) ?? null;
  if (mem && now - mem.at < SEAT_BLOB_NEON_INTERVAL_MS) return mem;
  const remote = parseNeonSeatMark(await readSeatBlobCacheValue(neonSeatMarkKey(blobKey)));
  if (mem && remote) return mem.at >= remote.at ? mem : remote;
  return mem ?? remote;
}

export async function rememberNeonSeatMark(blobKey: string, at: number, count: number): Promise<void> {
  const mark = { at, count };
  neonWrites.set(blobKey, mark);
  mirror.set(neonSeatMarkKey(blobKey), JSON.stringify(mark));
  await runtimeCacheSet(neonSeatMarkKey(blobKey), mark, "neon-seat-mark");
}

export function payloadFromGasBlob(value: unknown): string {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as SeatBlobPayload;
      if (parsed && Array.isArray(parsed.rows) && parsed.at) return value;
    } catch {
      return "";
    }
    return "";
  }
  if (!value || typeof value !== "object") return "";
  const rec = value as SeatBlobPayload;
  if (!Array.isArray(rec.rows) || !rec.at) return "";
  return JSON.stringify({
    at: rec.at,
    rows: rec.rows,
    source: rec.source || "",
    mode: rec.mode || "full",
  });
}

/**
 * Seat-blob bytes that would leave Neon. neonReadRate is the share of scans
 * that miss both Runtime Cache and GAS. 0 is the steady state after this change.
 */
export function monthlySeatBlobEgressBytes(input: {
  blobBytes: number;
  blobCount: number;
  scansPerDay: number;
  days?: number;
  neonReadRate: number;
}): number {
  const days = input.days ?? 30;
  return Math.round(input.blobBytes * input.blobCount * input.scansPerDay * days * input.neonReadRate);
}

export function __resetSeatBlobStoreForTests() {
  mirror.clear();
  neonWrites.clear();
}
