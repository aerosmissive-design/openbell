import type { Showtime, TheaterId } from "./types";
import { putSeatHit, type SeatHitMap } from "./seats";
import { readAppMeta } from "./app-meta.server";
import { cgvHallFromCapacity } from "./theaters";

const NAS_FRESH_MS = 3 * 60 * 1000;
const THEATER_NAME: Record<string, string> = {
  cgv_yongsan: "CGV 용산아이파크몰",
  cgv_yeongdeungpo: "CGV 영등포타임스퀘어",
};

type NasRow = {
  playDate?: string;
  startTime?: string;
  hallName?: string;
  movieTitle?: string;
  movieNo?: string;
  restSeats?: number;
  totalSeats?: number;
};
type NasPayload = { at: number; rows: NasRow[]; source?: string };

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

export async function nasReporterHealth(
  theaters: TheaterId[] = ["cgv_yongsan", "cgv_yeongdeungpo"],
): Promise<NasHealth[]> {
  const now = Date.now();
  const out: NasHealth[] = [];
  for (const theaterId of theaters) {
    const parsed = parsePayload(await readAppMeta(`nas_seats:${theaterId}`));
    if (!parsed) continue;
    out.push({ theaterId, at: parsed.at, ageMs: now - parsed.at, count: parsed.rows.length, fresh: now - parsed.at <= NAS_FRESH_MS });
  }
  return out;
}

export async function readNasSeatmap(
  theaters: TheaterId[],
): Promise<{ map: SeatHitMap; showtimes: Showtime[]; source: "pc" | "nas" }> {
  const map: SeatHitMap = {};
  const showtimes: Showtime[] = [];
  const now = Date.now();
  let source: "pc" | "nas" = "pc";
  await Promise.all(theaters.map(async (theaterId) => {
    const parsed = parsePayload(await readAppMeta(`nas_seats:${theaterId}`));
    if (!parsed || now - parsed.at > NAS_FRESH_MS) return;
    if (parsed.source === "nas") source = "nas";
    for (const r of parsed.rows) {
      const restSeats = Number(r.restSeats);
      if (!Number.isFinite(restSeats)) continue;
      const totalSeats = Number(r.totalSeats);
      const rawHall = String(r.hallName ?? "").trim();
      const movieTitle = String(r.movieTitle ?? "").trim();
      const playDate = String(r.playDate ?? "").trim();
      const startTime = String(r.startTime ?? "").trim();
      if (!movieTitle || !playDate || !startTime) continue;
      const mapped = cgvHallFromCapacity(theaterId, rawHall, Number.isFinite(totalSeats) ? totalSeats : null);
      const hallName = mapped.hall || rawHall || "일반";
      const row: Showtime = {
        id: `nas-${theaterId}-${playDate}-${startTime}-${hallName}-${movieTitle}`,
        theaterId,
        theaterName: THEATER_NAME[theaterId] || theaterId,
        chain: "cgv",
        movieTitle,
        movieNo: r.movieNo ? String(r.movieNo) : "",
        playDate,
        startTime,
        endTime: null,
        hallName,
        formats: mapped.formats,
        restSeats,
        totalSeats: Number.isFinite(totalSeats) ? totalSeats : restSeats,
        bookingUrl: "",
        bookable: true,
        seatLive: true,
        seatCheckedAt: new Date(parsed.at).toISOString(),
      };
      showtimes.push(row);
      putSeatHit(map, row);
    }
  }));
  return { map, showtimes, source };
}
