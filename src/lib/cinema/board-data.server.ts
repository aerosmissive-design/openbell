import type { Showtime, TheaterId } from "./types";
import { THEATERS } from "./theaters";
import { kstDateKeys } from "@/lib/utils";
import { fetchCgvKtSeatmap } from "./kt.server";
import { pushCgvBoardRows } from "./gas-fallback.server";

const IDS: TheaterId[] = [
  "cgv_yongsan",
  "cgv_yeongdeungpo",
  "megabox_coex",
  "megabox_namyangju",
];

const KT_DAYS = 3;
const KT_TIMEOUT_MS = 8000;
const CACHE_MS = 90_000;

export type BoardTheaterBlock = {
  theaterId: TheaterId;
  theaterName: string;
  source: string;
  reportedAt: string | null;
  count: number;
  showtimes: Showtime[];
};

export type BoardPayload = {
  scannedAt: string;
  theaters: BoardTheaterBlock[];
};

let cache: { at: number; key: string; payload: BoardPayload } | null = null;

function isCgv(id: string) {
  return id === "cgv_yongsan" || id === "cgv_yeongdeungpo";
}

function sortShows(rows: Showtime[]) {
  return rows.slice().sort((a, b) => `${a.playDate}${a.startTime}`.localeCompare(`${b.playDate}${b.startTime}`));
}

/** KT 회차로 극장을 채운다. 없는 극장만 기존 리포터 행을 남긴다. */
export function blocksFromKt(
  wanted: TheaterId[],
  ktShows: Showtime[],
  stored: Showtime[],
  scannedAt: string,
): BoardTheaterBlock[] {
  return wanted.map((id) => {
    const meta = THEATERS.find((t) => t.id === id);
    const kt = sortShows(ktShows.filter((row) => row.theaterId === id));
    const fallback = sortShows(stored.filter((row) => row.theaterId === id));
    const showtimes = kt.length ? kt : fallback;
    const source = showtimes[0]?.seatSource || (kt.length ? (isCgv(id) ? "cgv-kt" : "mega-mobile") : "none");
    return {
      theaterId: id,
      theaterName: meta?.name || id,
      source: showtimes.length ? source : "none",
      reportedAt: showtimes.length ? scannedAt : null,
      count: showtimes.length,
      showtimes,
    };
  });
}

async function deadline<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p.catch(() => fallback),
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * 전광판: KT 쇼무비(CGV)와 메가 모바일 시간표를 그 자리에서 읽는다.
 * Neon에 저장하지 않는다. CGV 행만 GAS 전광판 캐시에 보낸다.
 * 예매 잡은 만들지 않는다.
 */
export async function loadBoardDataImpl(data: {
  theaters?: TheaterId[];
}): Promise<BoardPayload> {
  const wanted = (data.theaters?.length ? data.theaters : IDS) as TheaterId[];
  const key = wanted.join(",");
  if (cache && cache.key === key && Date.now() - cache.at < CACHE_MS) return cache.payload;

  const dates = kstDateKeys(KT_DAYS);
  const kt = await deadline(
    fetchCgvKtSeatmap({ theaters: wanted, dates }),
    KT_TIMEOUT_MS,
    { map: {}, showtimes: [] as Showtime[] },
  );
  const scannedAt = new Date().toISOString();
  const missing = wanted.filter((id) => !kt.showtimes.some((row) => row.theaterId === id));
  let stored: Showtime[] = [];
  if (missing.length) {
    const { readNasSeatmap } = await import("./nas.server");
    const packed = await deadline(
      readNasSeatmap(missing, { maxAgeMs: 0 }),
      1500,
      { map: {}, showtimes: [] as Showtime[], source: "pc" as const },
    );
    stored = packed.showtimes;
  }
  const payload: BoardPayload = {
    scannedAt,
    theaters: blocksFromKt(wanted, kt.showtimes, stored, scannedAt),
  };
  if (kt.showtimes.length) {
    cache = { at: Date.now(), key, payload };
    const cgv = kt.showtimes.filter((row) => isCgv(row.theaterId));
    await Promise.race([
      pushCgvBoardRows(cgv).catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 4000)),
    ]);
  }
  return payload;
}
