import type { Showtime, TheaterId } from "./types";
import { putSeatHit, type SeatHitMap } from "./seats";
import { readAppMeta } from "./app-meta.server";
import { cgvHallFromCapacity, megaboxFormats } from "./theaters";
import { normalizePlayDate } from "@/lib/utils";

const NAS_FRESH_MS = 3 * 60 * 1000;
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
    const parsed = parsePayload(await readAppMeta(`nas_seats:${theaterId}`));
    if (!parsed) continue;
    out.push({
      theaterId,
      at: parsed.at,
      ageMs: now - parsed.at,
      count: parsed.rows.length,
      fresh: now - parsed.at <= NAS_FRESH_MS,
    });
  }
  return out;
}

/** maxAgeMs: 0이면 신선도 무시(전광판용). 기본은 3분. */
export async function readNasSeatmap(
  theaters: TheaterId[],
  options?: { maxAgeMs?: number },
): Promise<{ map: SeatHitMap; showtimes: Showtime[]; source: NasSource }> {
  const map: SeatHitMap = {};
  const showtimes: Showtime[] = [];
  const now = Date.now();
  const maxAge = options?.maxAgeMs ?? NAS_FRESH_MS;
  let source: NasSource = "pc";
  await Promise.all(
    theaters.map(async (theaterId) => {
      const parsed = parsePayload(await readAppMeta(`nas_seats:${theaterId}`));
      if (!parsed) return;
      if (maxAge > 0 && now - parsed.at > maxAge) return;
      const parsedSource = normalizeNasSource(parsed.source);
      if (parsedSource === "nas423" || parsedSource === "nas225" || parsedSource === "nas")
        source = parsedSource;
      for (const r of parsed.rows) {
        const restSeats = Number(r.restSeats);
        if (!Number.isFinite(restSeats)) continue;
        const totalSeats = Number(r.totalSeats);
        const rawHall = String(r.hallName ?? "").trim();
        const movieTitle = String(r.movieTitle ?? "").trim();
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
            : String(r.bookingUrl ?? "").trim() ||
              `https://www.megabox.co.kr/theater/time?brchNo=${SITE_NO[theaterId] || ""}`;
        const row: Showtime = {
          id: `nas-${theaterId}-${playDate}-${startTime}-${hallName}-${movieTitle}`,
          theaterId,
          theaterName: THEATER_NAME[theaterId] || theaterId,
          chain,
          movieTitle,
          movieNo: r.movieNo ? String(r.movieNo) : "",
          playDate,
          startTime,
          endTime: null,
          hallName,
          formats,
          restSeats,
          totalSeats: Number.isFinite(totalSeats) ? totalSeats : restSeats,
          bookingUrl,
          bookable: true,
          seatLive: true,
          seatCheckedAt: new Date(parsed.at).toISOString(),
          seatSource:
            parsedSource === "nas423"
              ? "g-nas423+"
              : parsedSource === "nas225"
                ? "g-nas225+"
                : parsedSource === "nas"
                  ? "g-nas"
                  : "g-pc",
        };
        showtimes.push(row);
        putSeatHit(map, row);
      }
    }),
  );
  return { map, showtimes, source };
}
