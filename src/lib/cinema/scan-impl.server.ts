import { kstDateKeys, normalizePlayDate } from "@/lib/utils";
import { isCgvId } from "./cgv.server";
import { readNasSeatmap } from "./nas.server";
import { putSeatHit, type SeatHitMap } from "./seats";
import { THEATERS } from "./theaters";
import type { ScanResult, Showtime, TheaterId } from "./types";

const SCAN_DEADLINES = {
  fastNas: 2500,
  nas: 4000,
};

async function deadline<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Emergency slim runScan: PC/NAS seat-report data for watch + settings. Full official/naver scan to be restored. */
export async function runScan(input: {
  theaters: TheaterId[];
  daysAhead: number;
  gasWebUrl?: string;
  mode?: "fast" | "full";
  sources?: { official?: boolean; naver?: boolean; gas?: boolean };
}): Promise<ScanResult> {
  const days = Math.min(Math.max(input.daysAhead || 7, 1), 30);
  const playDates = kstDateKeys(days);
  const wanted = input.theaters.length ? input.theaters : (THEATERS.map((t) => t.id) as TheaterId[]);
  const fast = input.mode === "fast";
  const emptyNas = { map: {} as SeatHitMap, showtimes: [] as Showtime[], source: "pc" as const };

  const nas = await deadline(
    readNasSeatmap([...wanted], { maxAgeMs: 30 * 60 * 1000 }),
    fast ? SCAN_DEADLINES.fastNas : SCAN_DEADLINES.nas,
    emptyNas,
  );

  const theaters = wanted.map((theaterId) => {
    const meta = THEATERS.find((t) => t.id === theaterId);
    const shows = nas.showtimes.filter((s) => s.theaterId === theaterId);
    const seatSource =
      shows[0]?.seatSource ||
      (nas.source === "nas423"
        ? "g-nas423+"
        : nas.source === "nas225"
          ? "g-nas225+"
          : shows.length
            ? "g-pc"
            : "none");
    return {
      theaterId,
      theaterName: meta?.name || theaterId,
      ok: shows.length > 0,
      source: shows.length ? seatSource : "none",
      seatSource,
      showtimes: shows,
      error: shows.length ? undefined : "데이터 없음",
    };
  });

  const seatSourceTimes: Record<string, Record<string, string>> = {};
  for (const t of theaters) {
    const times: Record<string, string> = {};
    for (const show of t.showtimes) {
      if (!show.seatCheckedAt || !show.seatSource) continue;
      const key = show.seatSource;
      const prev = times[key];
      if (!prev || new Date(show.seatCheckedAt).getTime() >= new Date(prev).getTime()) {
        times[key] = show.seatCheckedAt;
      }
    }
    seatSourceTimes[t.theaterId] = times;
  }

  return {
    scannedAt: new Date().toISOString(),
    playDates,
    ranking: [],
    showing: [],
    catalog: [],
    theaters,
    seatSourceTimes,
  };
}

function latestSeatSourceTimes(
  theaterId: TheaterId,
  sources: { key: string; map: SeatHitMap; source?: string }[],
) {
  const out: Record<string, string> = {};
  const siteNo =
    ({ cgv_yongsan: "0013", cgv_yeongdeungpo: "0059", megabox_coex: "1351", megabox_namyangju: "0019" } as Record<
      string,
      string
    >)[theaterId] ?? "";
  const prefixes = siteNo ? [`k:${siteNo}|`, `m:${siteNo}|`] : [];
  for (const source of sources) {
    let latest = 0;
    for (const [key, hit] of Object.entries(source.map)) {
      if (!hit || typeof hit.at !== "number" || !Number.isFinite(hit.at)) continue;
      if (source.source) {
        const hs = String(hit.source || "").toLowerCase();
        const want = String(source.source).toLowerCase();
        const aliases = new Set([want, `g-${want}`, want.replace(/^g-/, "")]);
        if (want === "nas423" || want === "g-nas423+") {
          aliases.add("g-nas423+");
          aliases.add("nas423");
          aliases.add("nas423+");
        }
        if (want === "nas225" || want === "g-nas225+") {
          aliases.add("g-nas225+");
          aliases.add("nas225");
          aliases.add("nas225+");
        }
        if (want === "pc" || want === "g-pc") {
          aliases.add("g-pc");
          aliases.add("pc");
          aliases.add("nas-report");
        }
        if (hs && !aliases.has(hs)) continue;
      }
      if (!prefixes.some((prefix) => key.startsWith(prefix))) continue;
      latest = Math.max(latest, hit.at);
    }
    if (latest > 0) out[source.key] = new Date(latest).toISOString();
  }
  return out;
}

export async function pingSeatmap(input: {
  url?: string;
  fresh?: boolean;
  theaterId?: TheaterId;
  daysAhead?: number;
}) {
  const nasTheaters = (["cgv_yongsan", "cgv_yeongdeungpo", "megabox_coex", "megabox_namyangju"] as TheaterId[]).filter(
    (id) => !input.theaterId || input.theaterId === id,
  );
  const nas = await readNasSeatmap(nasTheaters, { maxAgeMs: 30 * 60 * 1000 }).catch(() => ({
    map: {} as SeatHitMap,
    showtimes: [] as Showtime[],
    source: "pc" as const,
  }));
  const pcMap: SeatHitMap = {};
  const nas225Map: SeatHitMap = {};
  const nas423Map: SeatHitMap = {};
  for (const row of nas.showtimes) {
    const src = String(row.seatSource || "").toLowerCase();
    if (src === "g-nas225+" || src === "nas225" || src === "nas225+") putSeatHit(nas225Map, row);
    else if (src === "g-nas423+" || src === "nas423" || src === "nas423+") putSeatHit(nas423Map, row);
    else putSeatHit(pcMap, row);
  }
  const seatSourceTimes: Record<string, Record<string, string>> = {};
  for (const theaterId of nasTheaters) {
    seatSourceTimes[theaterId] = latestSeatSourceTimes(theaterId, [
      { key: "g-pc", map: pcMap, source: "pc" },
      { key: "g-nas225+", map: nas225Map, source: "nas225" },
      { key: "g-nas423+", map: nas423Map, source: "nas423" },
    ]);
  }
  return {
    status: Object.keys(nas.map).length || nas.showtimes.length ? ("ok" as const) : ("empty" as const),
    count: Object.keys(nas.map).length || nas.showtimes.length,
    cgvCount: Object.keys(nas.map).filter((k) => k.startsWith("k:") || k.startsWith("cgv:")).length,
    map: nas.map,
    showtimes: nas.showtimes,
    seatSourceTimes,
  };
}
