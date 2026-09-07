import { kstDateKeys } from "@/lib/utils";
import {
  fetchCgvNaver,
  fetchCgvRelaySeatmap,
  fetchYongsanTelegram,
  isCgvId,
} from "./cgv.server";
import { fetchMegaboxCatalog, fetchMegaboxSchedule, fetchMegaboxSeatmap, fetchNaverMegabox } from "./megabox.server";
import { applyCgvSeatHits, type SeatHitMap } from "./seats";
import type {
  RankingMovie,
  ScanResult,
  ScanSources,
  Showtime,
  TheaterId,
  TheaterScan,
} from "./types";
import { normalizeScanSources } from "./types";

type MegaboxId = "megabox_coex" | "megabox_namyangju";

export async function runScan(input: {
  daysAhead: number;
  theaters: TheaterId[];
  gasWebUrl?: string;
  sources?: Partial<ScanSources> | null;
}): Promise<ScanResult> {
  const days = Math.min(Math.max(input.daysAhead || 7, 1), 30);
  const playDates = kstDateKeys(days);
  const wanted = new Set(input.theaters);
  const sources = normalizeScanSources(input.sources);

  const rankingPromise = fetchMegaboxCatalog().catch(() => ({
    ranking: [],
    showing: [],
  }));

  const gasSeats = input.gasWebUrl
    ? Promise.race([
        loadGasSeatmap(input.gasWebUrl),
        new Promise<{ status: "empty"; map: GasSeatMap }>((resolve) => {
          setTimeout(() => resolve({ status: "empty", map: {} }), 3500);
        }),
      ])
    : Promise.resolve({
        status: "empty" as const,
        map: {} as GasSeatMap,
      });
  const relaySeats = [...wanted].some(isCgvId)
    ? Promise.race([
        fetchCgvRelaySeatmap({ days }).catch(() => ({}) as SeatHitMap),
        new Promise<SeatHitMap>((resolve) => {
          setTimeout(() => resolve({}), 8000);
        }),
      ])
    : Promise.resolve({} as SeatHitMap);
  const megaSeats = [...wanted].some(
    (id) => id === "megabox_coex" || id === "megabox_namyangju",
  )
    ? fetchMegaboxSeatmap({ days }).catch(() => ({}) as SeatHitMap)
    : Promise.resolve({} as SeatHitMap);
  const gasShows =
    sources.gas && input.gasWebUrl
      ? loadGasShows(input.gasWebUrl)
      : Promise.resolve([] as Showtime[]);

  const jobs: Promise<TheaterScan>[] = [];
  if (wanted.has("megabox_coex")) {
    jobs.push(scanTheater("megabox_coex", playDates, sources, gasShows));
  }
  if (wanted.has("megabox_namyangju")) {
    jobs.push(scanTheater("megabox_namyangju", playDates, sources, gasShows));
  }
  for (const id of wanted) {
    if (isCgvId(id)) {
      jobs.push(scanTheater(id, playDates, sources, gasShows));
    }
  }

  const [catalog, seats, relay, mega, ...theaters] = await Promise.all([
    rankingPromise,
    gasSeats,
    relaySeats,
    megaSeats,
    ...jobs,
  ]);
  const withSeats = applyCgvSeatHitsAcross(theaters, {
    ...seats.map,
    ...relay,
    ...mega,
  });
  const ranking = catalog.ranking.length
    ? catalog.ranking
    : rankingFromShows(withSeats);
  const showing = catalog.showing.length ? catalog.showing : ranking;
  return {
    scannedAt: new Date().toISOString(),
    playDates,
    ranking,
    showing,
    theaters: withSeats,
  };
}

async function scanTheater(
  theaterId: TheaterId,
  playDates: string[],
  sources: ScanSources,
  gasShows: Promise<Showtime[]>,
): Promise<TheaterScan> {
  const naverPromise =
    sources.naver
      ? fetchNaver(theaterId).catch(() => new Map<string, Showtime[]>())
      : Promise.resolve(new Map<string, Showtime[]>());

  const officialByDate = new Map<string, Showtime[]>();
  if (sources.official && !isCgvId(theaterId)) {
    const rows = await mapPool(playDates, 3, (date) =>
      fetchOfficial(theaterId, date),
    );
    rows.forEach((item, i) => {
      const date = playDates[i];
      if (item.status === "fulfilled" && item.value.length && date) {
        officialByDate.set(date, item.value);
      }
    });
  }

  const missingAfterOfficial = playDates.filter(
    (d) => !(officialByDate.get(d)?.length),
  );
  let naverByDate = new Map<string, Showtime[]>();
  if (missingAfterOfficial.length && sources.naver) {
    naverByDate = await naverPromise;
  }

  const stillMissing = playDates.filter(
    (d) => !(officialByDate.get(d)?.length || naverByDate.get(d)?.length),
  );
  let gasByDate = new Map<string, Showtime[]>();
  let teleByDate = new Map<string, Showtime[]>();
  if (stillMissing.length && sources.gas) {
    try {
      gasByDate = byDateForTheater(await gasShows, theaterId);
    } catch {
      gasByDate = new Map();
    }
    if (theaterId === "cgv_yongsan") {
      const needTele = stillMissing.some((d) => !gasByDate.get(d)?.length);
      if (needTele) {
        try {
          teleByDate = await fetchYongsanTelegram();
        } catch {
          teleByDate = new Map();
        }
      }
    }
  }

  const showtimes: Showtime[] = [];
  let usedOfficial = false;
  let usedNaver = false;
  let usedGas = false;
  let usedTele = false;
  for (const date of playDates) {
    const official = officialByDate.get(date);
    if (official?.length) {
      showtimes.push(...official);
      usedOfficial = true;
      continue;
    }
    const naver = naverByDate.get(date);
    if (naver?.length) {
      showtimes.push(...naver);
      usedNaver = true;
      continue;
    }
    const gas = gasByDate.get(date);
    if (gas?.length) {
      showtimes.push(...gas);
      usedGas = true;
      continue;
    }
    const tele = teleByDate.get(date);
    if (tele?.length) {
      showtimes.push(...tele);
      usedTele = true;
    }
  }

  const source = usedOfficial
    ? "official"
    : usedNaver
      ? "naver-place"
      : usedGas
        ? "gas-cache"
        : usedTele
          ? "yongsan-channel"
          : "none";

  if (!showtimes.length) {
    return {
      theaterId,
      ok: false,
      error: failMessage(theaterId, sources),
      showtimes: [],
      source,
    };
  }

  return {
    theaterId,
    ok: true,
    error: null,
    showtimes,
    source,
  };
}

async function fetchOfficial(
  theaterId: TheaterId,
  playDate: string,
): Promise<Showtime[]> {
  if (isCgvId(theaterId)) return [];
  return fetchMegaboxSchedule(theaterId as MegaboxId, playDate, {
    timeoutMs: 4000,
  }).catch(() => []);
}

async function fetchNaver(theaterId: TheaterId): Promise<Map<string, Showtime[]>> {
  if (isCgvId(theaterId)) return fetchCgvNaver(theaterId);
  return fetchNaverMegabox(theaterId as MegaboxId);
}

function failMessage(theaterId: TheaterId, sources: ScanSources) {
  const tried = isCgvId(theaterId)
    ? [sources.naver ? "네이버" : "", sources.gas ? "구글·기타" : ""].filter(Boolean)
    : [
        sources.official ? "공홈" : "",
        sources.naver ? "네이버" : "",
        sources.gas ? "구글·기타" : "",
      ].filter(Boolean);
  const name = isCgvId(theaterId) ? "CGV" : "메가박스";
  return `${name} 시간표를 ${tried.join(" → ") || "조회"}에서 가져오지 못했습니다.`;
}

function rankingFromShows(theaters: TheaterScan[]): RankingMovie[] {
  const counts = new Map<string, number>();
  for (const theater of theaters) {
    for (const show of theater.showtimes) {
      const title = show.movieTitle.trim();
      if (!title) continue;
      counts.set(title, (counts.get(title) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 9)
    .map(([title], i) => ({
      rank: i + 1,
      title,
      movieNo: "",
      bookingRate: null,
      posterUrl: null,
      releaseDate: null,
      bookingOpen: true,
      released: true,
    }));
}

async function mapPool<T, R>(
  items: T[],
  size: number,
  fn: (item: T) => Promise<R>,
) {
  const out: PromiseSettledResult<R>[] = [];
  for (let i = 0; i < items.length; i += size) {
    const part = await Promise.allSettled(items.slice(i, i + size).map(fn));
    out.push(...part);
  }
  return out;
}

type GasSeatMap = SeatHitMap;
type GasShowRow = {
  id?: string;
  theaterId?: string;
  theater?: string;
  title?: string;
  date?: string;
  time?: string;
  hall?: string;
  formats?: Showtime["formats"];
  restSeats?: number | null;
  totalSeats?: number | null;
  url?: string;
};

function applyCgvSeatHitsAcross(
  theaters: TheaterScan[],
  map: GasSeatMap,
): TheaterScan[] {
  if (!Object.keys(map).length) return theaters;
  return theaters.map((t) => ({
    ...t,
    showtimes: applyCgvSeatHits(t.showtimes, map),
  }));
}

function byDateForTheater(
  shows: Showtime[],
  theaterId: TheaterId,
): Map<string, Showtime[]> {
  const map = new Map<string, Showtime[]>();
  for (const show of shows) {
    if (show.theaterId !== theaterId) continue;
    const list = map.get(show.playDate) ?? [];
    list.push(show);
    map.set(show.playDate, list);
  }
  return map;
}

export async function pingSeatmap(input: {
  url?: string;
  fresh?: boolean;
  theaterId?: TheaterId;
  daysAhead?: number;
}) {
  const days = Math.min(Math.max(input.daysAhead ?? 7, 1), 14);
  const fresh = Boolean(input.fresh);
  const wantMega =
    !input.theaterId ||
    input.theaterId === "megabox_coex" ||
    input.theaterId === "megabox_namyangju";
  const wantCgv =
    !input.theaterId ||
    input.theaterId === "cgv_yongsan" ||
    input.theaterId === "cgv_yeongdeungpo";

  const megaPromise = wantMega
    ? fetchMegaboxSeatmap({
        theaterId:
          input.theaterId === "megabox_coex" ||
          input.theaterId === "megabox_namyangju"
            ? input.theaterId
            : undefined,
        days,
        fresh,
      }).catch(() => ({}) as SeatHitMap)
    : Promise.resolve({} as SeatHitMap);

  const cgvPromise = wantCgv
    ? fetchCgvRelaySeatmap({
        theaterId:
          input.theaterId === "cgv_yongsan" ||
          input.theaterId === "cgv_yeongdeungpo"
            ? input.theaterId
            : undefined,
        days,
        fresh,
      }).catch(() => ({}) as SeatHitMap)
    : Promise.resolve({} as SeatHitMap);

  const [mega, relay] = await Promise.all([megaPromise, cgvPromise]);
  let gasMap: SeatHitMap = {};
  let gasStatus: "ok" | "old" | "denied" | "empty" | "badurl" | "timeout" =
    "empty";
  if (input.url?.trim() && !Object.keys(mega).length && !Object.keys(relay).length) {
    const gas = await loadGasSeatmap(input.url, fresh);
    gasMap = gas.map;
    gasStatus = gas.status;
  }
  const map = { ...gasMap, ...mega, ...relay };
  const keys = Object.keys(map);
  const cgvCount = keys.filter(
    (key) => key.startsWith("k:") || key.startsWith("cgv:"),
  ).length;
  const status = keys.length ? ("ok" as const) : gasStatus;
  return { status, count: keys.length, cgvCount, map };
}

async function loadGasShows(url: string): Promise<Showtime[]> {
  let target: URL;
  try {
    target = new URL(url.trim());
  } catch {
    return [];
  }
  const host = target.hostname;
  if (
    !host.endsWith("script.google.com") &&
    !host.endsWith("googleusercontent.com")
  ) {
    return [];
  }
  target.searchParams.set("op", "shows");
  try {
    const res = await fetch(target.toString(), {
      redirect: "follow",
      signal: AbortSignal.timeout(25000),
    });
    const text = await res.text();
    if (!text || /sign in|accounts\.google/i.test(text)) return [];
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start < 0 || end <= start) return [];
    const json = JSON.parse(text.slice(start, end + 1)) as GasShowRow[];
    if (!Array.isArray(json)) return [];
    return json
      .map(gasRowToShowtime)
      .filter((row): row is Showtime => Boolean(row));
  } catch {
    return [];
  }
}

function gasRowToShowtime(row: GasShowRow): Showtime | null {
  const theaterId = row.theaterId as TheaterId | undefined;
  const playDate = String(row.date || "");
  const startTime = String(row.time || "");
  const title = String(row.title || "").trim();
  if (
    !theaterId ||
    !playDate ||
    !startTime ||
    !title ||
    !["megabox_coex", "megabox_namyangju", "cgv_yongsan", "cgv_yeongdeungpo"].includes(
      theaterId,
    )
  ) {
    return null;
  }
  const chain = theaterId.startsWith("cgv_") ? "cgv" : "megabox";
  return {
    id:
      row.id ||
      `${chain}:${theaterId}:${playDate}:${startTime}:${row.hall || ""}:${title}`,
    theaterId,
    theaterName: String(row.theater || "").replace(/^메가박스\s*|^CGV\s*/, "") || theaterId,
    chain,
    movieTitle: title,
    movieNo: "",
    playDate,
    startTime,
    endTime: null,
    hallName: String(row.hall || ""),
    formats: Array.isArray(row.formats) ? row.formats : [],
    restSeats: typeof row.restSeats === "number" ? row.restSeats : null,
    totalSeats: typeof row.totalSeats === "number" ? row.totalSeats : null,
    bookingUrl: String(row.url || ""),
    bookable: true,
  };
}

async function loadGasSeatmap(
  url: string,
  fresh = false,
): Promise<{
  status: "ok" | "old" | "denied" | "empty" | "badurl" | "timeout";
  map: GasSeatMap;
}> {
  let target: URL;
  try {
    target = new URL(url.trim());
  } catch {
    return { status: "badurl", map: {} };
  }
  const host = target.hostname;
  if (
    !host.endsWith("script.google.com") &&
    !host.endsWith("googleusercontent.com")
  ) {
    return { status: "badurl", map: {} };
  }
  target.searchParams.set("op", "seatmap");
  if (fresh) target.searchParams.set("fresh", "1");
  try {
    const res = await fetch(target.toString(), {
      redirect: "follow",
      signal: AbortSignal.timeout(fresh ? 20000 : 15000),
    });
    const text = await res.text();
    if (!text || /sign in|accounts\.google/i.test(text)) {
      return { status: "denied", map: {} };
    }
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) {
      return { status: "old", map: {} };
    }
    const json = JSON.parse(text.slice(start, end + 1)) as GasSeatMap;
    if (!json || typeof json !== "object") return { status: "old", map: {} };
    const cgvCount = Object.keys(json).filter(
      (key) => key.startsWith("k:") || key.startsWith("cgv:"),
    ).length;
    if (!Object.keys(json).length) return { status: "empty", map: {} };
    if (fresh && !cgvCount) return { status: "empty", map: json };
    return {
      status: "ok",
      map: json,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (/abort|timeout/i.test(msg)) return { status: "timeout", map: {} };
    return { status: "old", map: {} };
  }
}
