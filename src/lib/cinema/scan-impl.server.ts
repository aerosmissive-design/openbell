import { kstDateKeys } from "@/lib/utils";
import {
  fetchCgvNaver,
  fetchCgvRelaySeatmap,
  fetchCgvUpcomingCatalog,
  fetchYongsanTelegram,
  isCgvId,
} from "./cgv.server";
import { fetchMegaboxCatalog, fetchMegaboxSeatmap, fetchNaverMegabox } from "./megabox.server";
import { applyCgvSeatHits, lookupSeatHit, mergeShowtimes, putSeatHit, type SeatHitMap } from "./seats";
import type {
  RankingMovie,
  ScanResult,
  ScanSources,
  Showtime,
  TheaterId,
  TheaterScan,
} from "./types";
import { normalizeScanSources } from "./types";
import { mergeMovieCatalog, moviesFromShowtimes } from "./match";

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
    catalog: [],
  }));
  const cgvComingPromise = fetchCgvUpcomingCatalog().catch(() => ({
    movies: [] as RankingMovie[],
    source: "none" as const,
  }));

  const gasSeats = input.gasWebUrl
    ? loadGasSeatmap(input.gasWebUrl).catch(() => ({
        status: "empty" as const,
        map: {} as GasSeatMap,
      }))
    : Promise.resolve({
        status: "empty" as const,
        map: {} as GasSeatMap,
      });
  const relaySeats = [...wanted].some(isCgvId)
    ? fetchCgvRelaySeatmap({ days }).catch(() => ({
        map: {} as SeatHitMap,
        showtimes: [] as Showtime[],
      }))
    : Promise.resolve({ map: {} as SeatHitMap, showtimes: [] as Showtime[] });
  const megaSeats =
    input.gasWebUrl ||
    ![...wanted].some((id) => id === "megabox_coex" || id === "megabox_namyangju")
      ? Promise.resolve({ map: {} as SeatHitMap, showtimes: [] as Showtime[] })
      : fetchMegaboxSeatmap({ days: Math.min(days, 5) }).catch(() => ({
          map: {} as SeatHitMap,
          showtimes: [] as Showtime[],
        }));
  const gasShows =
    sources.gas && input.gasWebUrl
      ? loadGasTimetable(input.gasWebUrl, days).catch(() => [] as Showtime[])
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

  const [catalog, cgvComing, seats, relay, mega, gasList, ...theaters] = await Promise.all([
    rankingPromise,
    cgvComingPromise,
    gasSeats,
    relaySeats,
    megaSeats,
    gasShows,
    ...jobs,
  ]);
  const gasMap: SeatHitMap = { ...seats.map };
  for (const row of gasList) putSeatHit(gasMap, row);
  const withSeats = applyCgvSeatHitsAcross(
    theaters.map((theater) => {
      const extraMega =
        theater.theaterId === "megabox_coex" || theater.theaterId === "megabox_namyangju"
          ? mega.showtimes.filter((row) => row.theaterId === theater.theaterId)
          : [];
      const extraRelay = isCgvId(theater.theaterId)
        ? relay.showtimes.filter((row) => row.theaterId === theater.theaterId)
        : [];
      const extraGas = gasList.filter((row) => row.theaterId === theater.theaterId);
      const extra = [...extraGas, ...extraMega, ...extraRelay];
      if (!extra.length) return theater;
      const showtimes = mergeShowtimes(theater.showtimes, extra);
      let source = theater.source;
      if (!theater.showtimes.length) {
        if (extraMega.length) source = "official";
        else if (extraRelay.length) source = "cgv-relay";
        else if (extraGas.length) source = "gas-cache";
      }
      return {
        ...theater,
        showtimes,
        source,
        ok: theater.ok || showtimes.length > 0,
        error: showtimes.length ? null : theater.error,
      };
    }),
    {
      ...gasMap,
      ...relay.map,
      ...mega.map,
    },
  );
  const tagged = withSeats.map((theater) => ({
    ...theater,
    seatSource: detectSeatSource(theater.showtimes, {
      official: mega.map,
      relay: relay.map,
      gas: gasMap,
    }),
  }));
  const ranking = catalog.ranking.length
    ? catalog.ranking
    : rankingFromShows(tagged);
  const showing = catalog.showing.length ? catalog.showing : ranking;
  return {
    scannedAt: new Date().toISOString(),
    playDates,
    ranking,
    showing,
    catalog: mergeMovieCatalog(
      catalog.catalog ?? [],
      catalog.ranking,
      catalog.showing,
      cgvComing.movies,
      moviesFromShowtimes(tagged.flatMap((t) => t.showtimes)),
    ),
    theaters: tagged,
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
  // CGV 공홈은 막혀 있어 비워 둡니다. 메가박스 공홈 회차는 아래 mega.showtimes에서 합칩니다.

  const naverByDate = sources.naver
    ? await naverPromise
    : new Map<string, Showtime[]>();

  const stillMissing = playDates.filter(
    (d) =>
      !(
        officialByDate.get(d)?.length || naverByDate.get(d)?.length
      ),
  );
  let gasByDate = new Map<string, Showtime[]>();
  let teleByDate = new Map<string, Showtime[]>();
  if (sources.gas) {
    try {
      gasByDate = byDateForTheater(await gasShows, theaterId);
    } catch {
      gasByDate = new Map();
    }
  }
  if (stillMissing.length && theaterId === "cgv_yongsan") {
    const needTele = stillMissing.some((d) => !gasByDate.get(d)?.length);
    if (needTele) {
      try {
        teleByDate = await fetchYongsanTelegram();
      } catch {
        teleByDate = new Map();
      }
    }
  }

  const showtimes: Showtime[] = [];
  let usedOfficial = false;
  let usedNaver = false;
  let usedGas = false;
  let usedTele = false;
  for (const date of playDates) {
    const merged = mergeShowtimes(
      mergeShowtimes(officialByDate.get(date) ?? [], naverByDate.get(date) ?? []),
      gasByDate.get(date) ?? [],
    );
    if (merged.length) {
      showtimes.push(...merged);
      if (officialByDate.get(date)?.length) usedOfficial = true;
      if (naverByDate.get(date)?.length) usedNaver = true;
      if (gasByDate.get(date)?.length) usedGas = true;
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
      seatSource: "none",
    };
  }

  return {
    theaterId,
    ok: true,
    error: null,
    showtimes,
    source,
    seatSource: "none",
  };
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

function detectSeatSource(
  rows: Showtime[],
  maps: { official: SeatHitMap; relay: SeatHitMap; gas: SeatHitMap },
) {
  const seated = rows.filter((row) => row.restSeats != null);
  if (!seated.length) return "none";
  const score = (map: SeatHitMap) =>
    seated.filter((row) => lookupSeatHit(row, map)).length;
  const official = score(maps.official);
  const relay = score(maps.relay);
  const gas = score(maps.gas);
  if (official >= relay && official >= gas && official > 0) return "official";
  if (relay >= gas && relay > 0) return "cgv-relay";
  if (gas > 0) return "gas-cache";
  const chain = seated[0]?.chain;
  if (chain === "cgv") return "cgv-relay";
  return "official";
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
  if (input.url?.trim()) {
    const live = await loadGasTimetable(
      input.url.trim(),
      days,
      input.theaterId,
    ).catch(() => [] as Showtime[]);
    if (live.length) {
      const map: SeatHitMap = {};
      for (const row of live) putSeatHit(map, row);
      const cgvCount = live.filter((row) => row.chain === "cgv").length;
      return {
        status: "ok" as const,
        count: live.length,
        cgvCount,
        map,
        showtimes: live,
      };
    }
  }
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
      }).catch(() => ({ map: {} as SeatHitMap, showtimes: [] as Showtime[] }))
    : Promise.resolve({ map: {} as SeatHitMap, showtimes: [] as Showtime[] });

  const cgvPromise = wantCgv
    ? fetchCgvRelaySeatmap({
        theaterId:
          input.theaterId === "cgv_yongsan" ||
          input.theaterId === "cgv_yeongdeungpo"
            ? input.theaterId
            : undefined,
        days,
        fresh,
      }).catch(() => ({ map: {} as SeatHitMap, showtimes: [] as Showtime[] }))
    : Promise.resolve({ map: {} as SeatHitMap, showtimes: [] as Showtime[] });

  const [mega, relay] = await Promise.all([megaPromise, cgvPromise]);
  let gasMap: SeatHitMap = {};
  let gasStatus: "ok" | "old" | "denied" | "empty" | "badurl" | "timeout" =
    "empty";
  if (
    input.url?.trim() &&
    !Object.keys(mega.map).length &&
    !Object.keys(relay.map).length
  ) {
    const gas = await loadGasSeatmap(input.url, fresh);
    gasMap = gas.map;
    gasStatus = gas.status;
  }
  const map = { ...gasMap, ...mega.map, ...relay.map };
  const extraShows = [...mega.showtimes, ...relay.showtimes];
  const keys = Object.keys(map);
  const cgvCount = keys.filter(
    (key) => key.startsWith("k:") || key.startsWith("cgv:"),
  ).length;
  const status =
    keys.length || extraShows.length ? ("ok" as const) : gasStatus;
  return {
    status,
    count: keys.length || extraShows.length,
    cgvCount,
    map,
    showtimes: extraShows,
  };
}

async function loadGasTimetable(
  url: string,
  days: number,
  theaterId?: TheaterId,
): Promise<Showtime[]> {
  const params: Record<string, string> = {
    op: "live",
    days: String(Math.min(days, 10)),
  };
  if (theaterId) params.theater = theaterId;
  const live = await loadGasJson(url, params);
  if (live.length) return live;
  const mega = await loadGasJson(url, { ...params, op: "mega" });
  if (mega.length) return mega;
  return loadGasShows(url);
}

async function loadGasJson(
  url: string,
  params: Record<string, string>,
): Promise<Showtime[]> {
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
  for (const [key, value] of Object.entries(params)) {
    target.searchParams.set(key, value);
  }
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

async function loadGasShows(url: string): Promise<Showtime[]> {
  return loadGasJson(url, { op: "shows" });
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
