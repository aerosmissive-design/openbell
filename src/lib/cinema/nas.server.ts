import type { Showtime, TheaterId } from "./types";
import { putSeatHit, type SeatHitMap } from "./seats";
import { readAppMetaJsonFields, readAppMetas } from "./app-meta.server";
import { readGasSeatBlobs } from "./gas-fallback.server";
import { readSeatBlobCacheValue, readSeatBlobs, saveSeatBlobCache } from "./seat-blob-store";
import { cgvHallFromCapacity, megaboxFormats } from "./theaters";
import { decodeHtml, normalizePlayDate } from "@/lib/utils";
import {
  legacyBlobKey,
  parseSeatStat,
  REPORTER_SOURCES,
  reporterLabel,
  reporterTimesFromStats,
  seatBlobKey,
  seatStatKey,
  statKeyForBlobKey,
  storageSource,
  type SeatStat,
} from "./seat-stat";

const NAS_FRESH_MS = 30 * 60 * 1000; // 감시/설정용. 전광판은 maxAgeMs:0
const THEATER_NAME: Record<string, string> = {
  cgv_yongsan: "CGV 용산아이파크몰",
  cgv_yeongdeungpo: "CGV 영등포타임스퀘어",
  megabox_coex: "메가박스 코엑스",
  megabox_namyangju: "메가박스 남양주",
};
const SITE_NO: Record<string, string> = {
  cgv_yongsan: "0013",
  cgv_yeongdeungpo: "0059",
  megabox_coex: "1351",
  megabox_namyangju: "0019",
};

type NasRow = {
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
};
type NasPayload = { at: number; rows: NasRow[]; source?: string };
type NasSource = "pc" | "nas" | "nas423" | "nas225";

export type NasHealth = {
  theaterId: TheaterId;
  at: number;
  ageMs: number;
  count: number;
  fresh: boolean;
};

function parsePayload(raw: string): NasPayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as NasPayload;
    if (!parsed || !Array.isArray(parsed.rows) || !parsed.at) return null;
    return parsed;
  } catch {
    return null;
  }
}

function normalizeNasSource(source?: string): NasSource {
  if (source === "nas423" || source === "nas225" || source === "nas") return source;
  return "pc";
}

function isCgv(theaterId: string) {
  return theaterId.startsWith("cgv");
}

function cgvNasBookingUrl(
  theaterId: TheaterId,
  playDate: string,
  movieNo: string,
  bookingUrl?: string,
  scnsNo?: string,
  scnSseq?: string,
): string {
  const direct = String(bookingUrl ?? "").trim();
  if (direct) return direct;
  const siteNo = SITE_NO[theaterId] ?? "";
  const siteNm = THEATER_NAME[theaterId]?.replace(/^CGV\s*/i, "") ?? "";
  if (!siteNo || !movieNo) return "";
  const params: Record<string, string> = {
    movNo: movieNo,
    scnYmd: playDate,
    siteNo,
    siteNm,
  };
  if (scnsNo && scnSseq) {
    params.scnsNo = scnsNo;
    params.scnSseq = scnSseq;
  }
  return `https://cgv.co.kr/cnm/movieBook/movie?${new URLSearchParams(params).toString()}`;
}

async function readSourceStats(theaters: string[]): Promise<Record<string, Record<string, SeatStat>>> {
  const statKeys: string[] = [];
  const slots: { theaterId: string; src: (typeof REPORTER_SOURCES)[number]; stat: string; blob: string }[] = [];
  for (const theaterId of theaters) {
    for (const src of REPORTER_SOURCES) {
      const stat = seatStatKey(src, theaterId);
      const blob = seatBlobKey(src, theaterId);
      statKeys.push(stat);
      slots.push({ theaterId, src, stat, blob });
    }
  }
  const bag = await readAppMetas(statKeys);
  const out: Record<string, Record<string, SeatStat>> = {};
  const missing: { theaterId: string; src: string; blob: string }[] = [];
  for (const slot of slots) {
    const parsed = parseSeatStat(bag[slot.stat] || "", slot.src);
    if (parsed) (out[slot.theaterId] ??= {})[slot.src] = parsed;
    else missing.push(slot);
  }
  if (missing.length) {
    const fields = await readAppMetaJsonFields(missing.map((slot) => slot.blob));
    for (const slot of missing) {
      const field = fields[slot.blob];
      if (!field?.at) continue;
      (out[slot.theaterId] ??= {})[slot.src] = {
        at: field.at,
        count: field.count,
        source: slot.src,
      };
    }
  }
  return out;
}

export async function nasReporterHealth(
  theaters: TheaterId[] = [
    "cgv_yongsan",
    "cgv_yeongdeungpo",
    "megabox_coex",
    "megabox_namyangju",
  ],
): Promise<NasHealth[]> {
  const now = Date.now();
  const stats = await readSourceStats(theaters);
  const needLegacy = theaters.filter((id) => !Object.keys(stats[id] || {}).length);
  const legacy = needLegacy.length
    ? await readAppMetaJsonFields(needLegacy.map((id) => legacyBlobKey(id)))
    : {};
  const out: NasHealth[] = [];
  for (const theaterId of theaters) {
    let best: SeatStat | null = null;
    for (const src of REPORTER_SOURCES) {
      const stat = stats[theaterId]?.[src];
      if (stat && (!best || stat.at > best.at)) best = stat;
    }
    if (!best) {
      const field = legacy[legacyBlobKey(theaterId)];
      if (field?.at) best = { at: field.at, count: field.count, source: field.source || "pc" };
    }
    if (!best) continue;
    out.push({
      theaterId,
      at: best.at,
      ageMs: now - best.at,
      count: best.count,
      fresh: now - best.at <= NAS_FRESH_MS,
    });
  }
  return out;
}

export type TheaterSeatHealth = {
  at: number;
  ageMs: number;
  count: number;
  source: string;
  bySource: Record<string, { at: number; count: number }>;
};

/** seat-report GET. Counts come from the sibling key, not the seat rows. */
export async function readTheaterSeatHealth(
  theaters: string[],
  now = Date.now(),
): Promise<Record<string, TheaterSeatHealth>> {
  const stats = await readSourceStats(theaters);
  const needLegacy = theaters.filter((id) => !Object.keys(stats[id] || {}).length);
  const legacy = needLegacy.length
    ? await readAppMetaJsonFields(needLegacy.map((id) => legacyBlobKey(id)))
    : {};
  const out: Record<string, TheaterSeatHealth> = {};
  for (const theaterId of theaters) {
    const bySource: Record<string, { at: number; count: number }> = {};
    let bestAt = 0;
    let bestCount = 0;
    let bestSource = "pc";
    for (const src of REPORTER_SOURCES) {
      const stat = stats[theaterId]?.[src];
      if (!stat?.at) continue;
      bySource[src] = { at: stat.at, count: stat.count };
      if (stat.at >= bestAt) {
        bestAt = stat.at;
        bestCount = stat.count;
        bestSource = src;
      }
    }
    if (!Object.keys(bySource).length) {
      const field = legacy[legacyBlobKey(theaterId)];
      if (field?.at) {
        const src = storageSource(field.source);
        bySource[src] = { at: field.at, count: field.count };
        bestAt = field.at;
        bestCount = field.count;
        bestSource = src;
      }
    }
    if (bestAt > 0) {
      out[theaterId] = {
        at: bestAt,
        ageMs: now - bestAt,
        count: bestCount,
        source: bestSource,
        bySource,
      };
    }
  }
  return out;
}

/** 극장×출처별 마지막 성공 시각 (설정 표용). 작은 stat 키만 읽는다. */
export async function readNasReporterTimes(
  theaters: TheaterId[],
  options?: { maxAgeMs?: number },
): Promise<Record<string, Record<string, string>>> {
  const maxAge = options?.maxAgeMs ?? NAS_FRESH_MS;
  const now = Date.now();
  const stats = await readSourceStats(theaters);
  const out: Record<string, Record<string, string>> = {};
  const needLegacy: string[] = [];
  for (const theaterId of theaters) {
    const times = reporterTimesFromStats(stats[theaterId] || {}, null, now, maxAge);
    if (Object.keys(times).length) out[theaterId] = times;
    else needLegacy.push(theaterId);
  }
  if (needLegacy.length) {
    const fields = await readAppMetaJsonFields(needLegacy.map((id) => legacyBlobKey(id)));
    for (const theaterId of needLegacy) {
      const field = fields[legacyBlobKey(theaterId)];
      const legacy = field?.at
        ? { at: field.at, count: field.count, source: field.source || "pc" }
        : null;
      const times = reporterTimesFromStats(stats[theaterId] || {}, legacy, now, maxAge);
      if (Object.keys(times).length) out[theaterId] = times;
    }
  }
  return out;
}

async function knownBlobAts(keys: string[]): Promise<Record<string, number>> {
  const pairs = keys
    .map((key) => ({ key, stat: statKeyForBlobKey(key) }))
    .filter((row) => row.stat);
  if (!pairs.length) return {};
  const bag = await readAppMetas(pairs.map((row) => row.stat));
  const out: Record<string, number> = {};
  for (const row of pairs) {
    const parsed = parseSeatStat(bag[row.stat] || "");
    if (parsed?.at) out[row.key] = parsed.at;
  }
  return out;
}

/** 큰 좌석 블롭. Runtime Cache → GAS → Neon. 작은 stat 키는 여기로 오지 않는다. */
export async function readStoredSeatBlobs(keys: string[]): Promise<Record<string, string>> {
  if (!keys.length) return {};
  return readSeatBlobs(keys, {
    cacheGet: readSeatBlobCacheValue,
    gasRead: (missing) => readGasSeatBlobs(missing),
    dbRead: (missing) => readAppMetas(missing),
    knownAts: knownBlobAts,
    cachePut: (key, value) => saveSeatBlobCache(key, value),
  });
}

/** maxAgeMs: 0이면 신선도 무시(전광판용). 기본은 30분. */
export async function readNasSeatmap(
  theaters: TheaterId[],
  options?: { maxAgeMs?: number },
): Promise<{
  map: SeatHitMap;
  showtimes: Showtime[];
  source: NasSource;
  reporterTimes: Record<string, Record<string, string>>;
}> {
  const map: SeatHitMap = {};
  const showtimes: Showtime[] = [];
  const now = Date.now();
  const maxAge = options?.maxAgeMs ?? NAS_FRESH_MS;
  let source: NasSource = "pc";
  let sourceAt = 0;

  async function ingest(theaterId: TheaterId, parsedSource: NasSource, parsed: NasPayload) {
    if (maxAge > 0 && now - parsed.at > maxAge) return;
    if (parsed.at >= sourceAt) {
      sourceAt = parsed.at;
      source = parsedSource;
    }
    const label = reporterLabel(parsedSource);
    for (const r of parsed.rows) {
      const restSeats = Number(r.restSeats);
      if (!Number.isFinite(restSeats)) continue;
      const totalSeats = Number(r.totalSeats);
      const rawHall = decodeHtml(String(r.hallName ?? "").trim());
      const movieTitle = decodeHtml(String(r.movieTitle ?? "").trim());
      const playDate = normalizePlayDate(String(r.playDate ?? "").trim());
      const startTime = String(r.startTime ?? "").trim();
      if (!movieTitle || !playDate || !startTime) continue;
      const chain = isCgv(theaterId) ? ("cgv" as const) : ("megabox" as const);
      let hallName = rawHall || "일반";
      let formats: Showtime["formats"] = ["other"];
      if (chain === "cgv") {
        const mapped = cgvHallFromCapacity(
          theaterId,
          rawHall,
          Number.isFinite(totalSeats) ? totalSeats : null,
        );
        hallName = mapped.hall || rawHall || "일반";
        formats = mapped.formats;
      } else {
        formats = megaboxFormats(null, rawHall);
      }
      const bookingUrl =
        chain === "cgv"
          ? cgvNasBookingUrl(
              theaterId,
              playDate,
              r.movieNo ? String(r.movieNo) : "",
              r.bookingUrl,
              r.scnsNo ? String(r.scnsNo) : "",
              r.scnSseq ? String(r.scnSseq) : "",
            )
          : String(r.bookingUrl ?? "").trim() || "https://www.megabox.co.kr/booking";
      const row: Showtime = {
        id: `${chain}:${theaterId}:${playDate}:${startTime}:${hallName}:${movieTitle}`,
        theaterId,
        theaterName: THEATER_NAME[theaterId] ?? theaterId,
        chain,
        movieTitle,
        movieNo: r.movieNo ? String(r.movieNo) : "",
        playDate,
        startTime,
        endTime: null,
        hallName,
        formats,
        restSeats,
        totalSeats: Number.isFinite(totalSeats) ? totalSeats : null,
        bookingUrl,
        bookable: true,
        seatLive: true,
        seatCheckedAt: new Date(parsed.at).toISOString(),
        seatSource: label,
      };
      showtimes.push(row);
      putSeatHit(map, row);
    }
  }

  const blobKeys: string[] = [];
  for (const theaterId of theaters) {
    for (const src of REPORTER_SOURCES) blobKeys.push(seatBlobKey(src, theaterId));
  }
  const blobs = await readStoredSeatBlobs(blobKeys);
  const perTheater = new Map<string, Record<string, SeatStat>>();
  const legacyRaw = new Map<string, string>();
  const needLegacy: TheaterId[] = [];

  for (const theaterId of theaters) {
    const stats: Record<string, SeatStat> = {};
    let any = false;
    for (const src of REPORTER_SOURCES) {
      const raw = blobs[seatBlobKey(src, theaterId)] || "";
      if (!raw) continue;
      const parsed = parsePayload(raw);
      if (!parsed) continue;
      any = true;
      stats[src] = { at: parsed.at, count: parsed.rows.length, source: src };
      await ingest(theaterId, src, parsed);
    }
    perTheater.set(theaterId, stats);
    if (!any) needLegacy.push(theaterId);
  }

  if (needLegacy.length) {
    const legacyBag = await readAppMetas(needLegacy.map((id) => legacyBlobKey(id)));
    for (const theaterId of needLegacy) {
      const raw = legacyBag[legacyBlobKey(theaterId)] || "";
      legacyRaw.set(theaterId, raw);
      const parsed = parsePayload(raw);
      if (parsed) await ingest(theaterId, normalizeNasSource(parsed.source), parsed);
    }
  }

  const reporterTimes: Record<string, Record<string, string>> = {};
  const legacyFieldNeed: TheaterId[] = [];
  for (const theaterId of theaters) {
    const stats = perTheater.get(theaterId) || {};
    const legacy = legacyRaw.has(theaterId) ? parseSeatStat(legacyRaw.get(theaterId) || "") : null;
    const times = reporterTimesFromStats(stats, legacy, now, maxAge);
    if (Object.keys(times).length) reporterTimes[theaterId] = times;
    else if (!legacyRaw.has(theaterId)) legacyFieldNeed.push(theaterId);
  }
  if (legacyFieldNeed.length) {
    const fields = await readAppMetaJsonFields(legacyFieldNeed.map((id) => legacyBlobKey(id)));
    for (const theaterId of legacyFieldNeed) {
      const field = fields[legacyBlobKey(theaterId)];
      if (!field?.at) continue;
      const times = reporterTimesFromStats(
        perTheater.get(theaterId) || {},
        { at: field.at, count: field.count, source: field.source || "pc" },
        now,
        maxAge,
      );
      if (Object.keys(times).length) reporterTimes[theaterId] = times;
    }
  }

  return { map, showtimes, source, reporterTimes };
}
