import type { Showtime, TheaterId } from "./types";
import { putSeatHit, type SeatHitMap } from "./seats";
import { readAppMeta } from "./app-meta.server";
import { cgvHallFromCapacity, megaboxFormats } from "./theaters";
import { decodeHtml, normalizePlayDate } from "@/lib/utils";

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

export async function nasReporterHealth(
  theaters: TheaterId[] = [
    "cgv_yongsan",
    "cgv_yeongdeungpo",
    "megabox_coex",
    "megabox_namyangju",
  ],
): Promise<NasHealth[]> {
  const now = Date.now();
  const out: NasHealth[] = [];
  for (const theaterId of theaters) {
    let best: NasPayload | null = null;
    for (const src of ["pc", "nas423", "nas225"] as const) {
      const parsed = parsePayload(await readAppMeta(`nas_seats:${src}:${theaterId}`));
      if (parsed && (!best || parsed.at > best.at)) best = parsed;
    }
    if (!best) best = parsePayload(await readAppMeta(`nas_seats:${theaterId}`));
    if (!best) continue;
    out.push({
      theaterId,
      at: best.at,
      ageMs: now - best.at,
      count: best.rows.length,
      fresh: now - best.at <= NAS_FRESH_MS,
    });
  }
  return out;
}

const REPORTER_SOURCES = ["pc", "nas423", "nas225"] as const;

function sourceMetaKey(source: string, theaterId: string) {
  const src = source === "nas" ? "nas423" : source;
  return `nas_seats:${src}:${theaterId}`;
}
function legacyMetaKey(theaterId: string) {
  return `nas_seats:${theaterId}`;
}
function seatSourceLabel(source: NasSource): string {
  if (source === "nas423") return "g-nas423+";
  if (source === "nas225") return "g-nas225+";
  if (source === "nas") return "g-nas423+";
  return "g-pc";
}

/** 극장×출처별 마지막 성공 시각 (설정 표용). */
export async function readNasReporterTimes(
  theaters: TheaterId[],
  options?: { maxAgeMs?: number },
): Promise<Record<string, Record<string, string>>> {
  const maxAge = options?.maxAgeMs ?? NAS_FRESH_MS;
  const now = Date.now();
  const out: Record<string, Record<string, string>> = {};
  await Promise.all(
    theaters.map(async (theaterId) => {
      const times: Record<string, string> = {};
      for (const src of REPORTER_SOURCES) {
        const raw = await readAppMeta(sourceMetaKey(src, theaterId));
        if (!raw) continue;
        try {
          const parsed = JSON.parse(raw) as { at?: number; source?: string };
          const at = Number(parsed.at) || 0;
          if (!at) continue;
          if (maxAge > 0 && now - at > maxAge) continue;
          const key = src === "pc" ? "g-pc" : src === "nas225" ? "g-nas225+" : "g-nas423+";
          times[key] = new Date(at).toISOString();
        } catch {}
      }
      if (!Object.keys(times).length) {
        const raw = await readAppMeta(legacyMetaKey(theaterId));
        if (raw) {
          try {
            const parsed = JSON.parse(raw) as { at?: number; source?: string };
            const at = Number(parsed.at) || 0;
            if (at && (maxAge <= 0 || now - at <= maxAge)) {
              const src = normalizeNasSource(parsed.source);
              times[seatSourceLabel(src)] = new Date(at).toISOString();
            }
          } catch {}
        }
      }
      if (Object.keys(times).length) out[theaterId] = times;
    }),
  );
  return out;
}

/** maxAgeMs: 0이면 신선도 무시(전광판용). 기본은 30분. */
export async function readNasSeatmap(
  theaters: TheaterId[],
  options?: { maxAgeMs?: number },
): Promise<{ map: SeatHitMap; showtimes: Showtime[]; source: NasSource }> {
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
    const label = seatSourceLabel(parsedSource);
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

  await Promise.all(
    theaters.map(async (theaterId) => {
      let any = false;
      for (const src of REPORTER_SOURCES) {
        const raw = await readAppMeta(sourceMetaKey(src, theaterId));
        if (!raw) continue;
        const parsed = parsePayload(raw);
        if (!parsed) continue;
        any = true;
        await ingest(theaterId, src, parsed);
      }
      if (!any) {
        const raw = await readAppMeta(legacyMetaKey(theaterId));
        const parsed = parsePayload(raw || "");
        if (parsed) await ingest(theaterId, normalizeNasSource(parsed.source), parsed);
      }
    }),
  );

  return { map, showtimes, source };
}
