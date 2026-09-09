import { decodeHtml, kstDateKeys, normalizeTitle } from "@/lib/utils";
import { indexSeatHit, type SeatHit as SharedSeatHit, type SeatHitMap } from "./seats";
import { cgvFormats, cgvHallFromCapacity } from "./theaters";
import type { RankingMovie, Showtime, TheaterId } from "./types";

export type CgvId = "cgv_yongsan" | "cgv_yeongdeungpo";

const CGV_SITES: Record<
  CgvId,
  { placeId: string; siteNo: string; theaterName: string }
> = {
  cgv_yongsan: {
    placeId: "12298207",
    siteNo: "0013",
    theaterName: "용산아이파크몰",
  },
  cgv_yeongdeungpo: {
    placeId: "13141635",
    siteNo: "0059",
    theaterName: "영등포",
  },
};

type SeatHit = SharedSeatHit;

type Cache = {
  at: number;
  byDate: Map<string, Showtime[]>;
};

const caches = new Map<CgvId, Cache>();
const pending = new Map<CgvId, Promise<Map<string, Showtime[]> | null>>();
let officialCgvBlocked = false;
let teleCache: Cache | null = null;
let telePending: Promise<Map<string, Showtime[]>> | null = null;
const relayCache = new Map<
  string,
  { at: number; map: SeatHitMap; showtimes: Showtime[] }
>();
const RELAY_TTL = 90_000;

export function isCgvId(id: TheaterId): id is CgvId {
  return id in CGV_SITES;
}

export function cgvSiteNo(id: CgvId) {
  return CGV_SITES[id].siteNo;
}

export async function fetchCgvUpcomingCatalog(): Promise<{
  movies: RankingMovie[];
  source: "official" | "naver" | "relay" | "none";
}> {
  const official = await fetchCgvOfficialMovieList();
  if (official.length) {
    const extra = await fetchMcpCgvMovies().catch(() => []);
    return { movies: mergeRankingMovies(official, extra), source: "official" };
  }
  const [naver, mcp] = await Promise.all([
    fetchNaverComingMovies().catch(() => []),
    fetchMcpCgvMovies().catch(() => []),
  ]);
  if (naver.length) return { movies: mergeRankingMovies(naver, mcp), source: "naver" };
  if (mcp.length) return { movies: mcp, source: "relay" };
  return { movies: [], source: "none" };
}

function mergeRankingMovies(...lists: RankingMovie[][]) {
  const out: RankingMovie[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const row of list) {
      const key = normalizeTitle(row.title);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
  }
  return out;
}

function asMovie(title: string, movieNo = "", posterUrl: string | null = null): RankingMovie {
  return {
    rank: 0,
    title,
    movieNo,
    bookingRate: null,
    posterUrl,
    releaseDate: null,
    bookingOpen: false,
    released: false,
  };
}

const CGV_JSON_HEADERS = {
  accept: "application/json, text/plain, */*",
  "accept-language": "ko-KR,ko;q=0.9",
  origin: "https://cgv.co.kr",
  referer: "https://cgv.co.kr/",
  "user-agent":
    "Mozilla/5.0 (Linux; Android 13; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36",
};

async function fetchCgvOfficialMovieList(): Promise<RankingMovie[]> {
  if (officialCgvBlocked) return [];
  const urls = [
    "https://api.cgv.co.kr/cnm/atkt/searchMovieList?coCd=A420",
    "https://api.cgv.co.kr/cnm/atkt/searchComingMovieList?coCd=A420",
    "https://api.cgv.co.kr/cnm/atkt/searchMovieList?coCd=A420&rtctlScopCd=08",
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: CGV_JSON_HEADERS,
        redirect: "follow",
        signal: AbortSignal.timeout(2500),
      });
      if (res.status === 403 || res.status === 429) return [];
      if (!res.ok) continue;
      const json = (await res.json()) as unknown;
      const rows = collectCgvMovieRows(json);
      if (rows.length) return rows;
    } catch {
      continue;
    }
  }
  return [];
}

function collectCgvMovieRows(node: unknown, depth = 0): RankingMovie[] {
  const out: RankingMovie[] = [];
  const seen = new Set<string>();
  const walk = (value: unknown, level: number) => {
    if (value == null || level > 6) return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item, level + 1);
      return;
    }
    if (typeof value !== "object") return;
    const row = value as Record<string, unknown>;
    const title = decodeHtml(
      String(row.movNm || row.movieNm || row.movieName || row.mvNm || ""),
    ).trim();
    if (title) {
      const key = normalizeTitle(title);
      if (key && !seen.has(key)) {
        seen.add(key);
        out.push(asMovie(title, String(row.movNo || row.movieCode || row.movieNo || "")));
      }
    }
    for (const child of Object.values(row)) {
      if (child && typeof child === "object") walk(child, level + 1);
    }
  };
  walk(node, depth);
  return out;
}

async function fetchNaverComingMovies(): Promise<RankingMovie[]> {
  const res = await fetch(
    "https://search.naver.com/search.naver?where=nexearch&query=" +
      encodeURIComponent("상영예정영화"),
    {
      headers: {
        "user-agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        "accept-language": "ko-KR,ko;q=0.9",
        accept: "text/html",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
    },
  );
  if (!res.ok) return [];
  const html = await res.text();
  const out: RankingMovie[] = [];
  const seen = new Set<string>();
  const re = /class="this_text _text">([^<]+)<\/strong>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    const title = decodeHtml(match[1] || "").trim();
    const key = normalizeTitle(title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(asMovie(title));
  }
  return out;
}

async function fetchMcpCgvMovies(): Promise<RankingMovie[]> {
  const siteNos = Object.values(CGV_SITES).map((s) => s.siteNo);
  const batches = await Promise.all(
    siteNos.map(async (siteNo) => {
      try {
        const res = await fetch(
          `https://mcp.aka.page/api/cgv/movies?theaterCode=${siteNo}&limit=200`,
          {
            headers: {
              accept: "application/json",
              "user-agent":
                "Mozilla/5.0 (Linux; Android 13; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36",
            },
            redirect: "follow",
            signal: AbortSignal.timeout(8000),
          },
        );
        if (!res.ok) return [] as RankingMovie[];
        const json = (await res.json()) as {
          data?: { movies?: Array<{ movieName?: string; movieCode?: string }> };
        };
        const rows: RankingMovie[] = [];
        for (const row of json.data?.movies ?? []) {
          const title = decodeHtml(String(row.movieName || "").trim());
          if (!title) continue;
          rows.push(asMovie(title, String(row.movieCode || "")));
        }
        return rows;
      } catch {
        return [] as RankingMovie[];
      }
    }),
  );
  return mergeRankingMovies(...batches);
}

export async function fetchCgvRelaySeatmap(input?: {
  theaterId?: CgvId;
  days?: number;
  fresh?: boolean;
}): Promise<{ map: SeatHitMap; showtimes: Showtime[] }> {
  const days = Math.min(Math.max(input?.days ?? 7, 1), 14);
  const dates = kstDateKeys(days);
  const theaters: CgvId[] = input?.theaterId
    ? [input.theaterId]
    : (Object.keys(CGV_SITES) as CgvId[]);
  const jobs = theaters.flatMap((id) =>
    dates.map((date) => fetchRelayDay(id, date, Boolean(input?.fresh))),
  );
  const parts = await Promise.all(jobs);
  const map: SeatHitMap = {};
  const showtimes: Showtime[] = [];
  for (const part of parts) {
    Object.assign(map, part.map);
    showtimes.push(...part.showtimes);
  }
  return { map, showtimes };
}

async function fetchRelayDay(
  theaterId: CgvId,
  playDate: string,
  fresh: boolean,
): Promise<{ map: SeatHitMap; showtimes: Showtime[] }> {
  const site = CGV_SITES[theaterId];
  const siteNo = site.siteNo;
  const cacheKey = `${siteNo}|${playDate}`;
  if (!fresh) {
    const hit = relayCache.get(cacheKey);
    if (hit && Date.now() - hit.at < RELAY_TTL) return hit;
  }
  try {
    const res = await fetch(
      `https://mcp.aka.page/api/cgv/timetable?playDate=${playDate}&theaterCode=${siteNo}&limit=200`,
      {
        headers: {
          accept: "application/json",
          "user-agent":
            "Mozilla/5.0 (Linux; Android 13; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!res.ok) return { map: {}, showtimes: [] };
    const json = (await res.json()) as {
      data?: {
        timetable?: Array<{
          movieName?: string;
          movieCode?: string;
          startTime?: string;
          screenName?: string;
          remainingSeats?: number;
          totalSeats?: number | null;
        }>;
      };
    };
    const map: SeatHitMap = {};
    const showtimes: Showtime[] = [];
    for (const row of json.data?.timetable ?? []) {
      const time = String(row.startTime || "").trim();
      const title = String(row.movieName || "").trim();
      if (!time || !title) continue;
      const total =
        typeof row.totalSeats === "number" && Number.isFinite(row.totalSeats)
          ? row.totalSeats
          : null;
      const rest =
        typeof row.remainingSeats === "number" && Number.isFinite(row.remainingSeats)
          ? row.remainingSeats
          : null;
      const guessed = cgvHallFromCapacity(
        theaterId,
        row.screenName || "",
        total,
      );
      const movieNo = String(row.movieCode || "");
      const show: Showtime = {
        id: `cgv:${siteNo}:${playDate}:${time}:${guessed.hall}:${title}`,
        theaterId,
        theaterName: site.theaterName,
        chain: "cgv",
        movieTitle: title,
        movieNo,
        playDate,
        startTime: time,
        endTime: null,
        hallName: guessed.hall,
        formats: guessed.formats,
        restSeats: rest,
        totalSeats: total,
        bookingUrl: movieNo
          ? `https://cgv.co.kr/cnm/movieBook/movie?movNo=${movieNo}&scnYmd=${playDate}&siteNo=${siteNo}`
          : `https://cgv.co.kr/cnm/movieBook?siteNo=${siteNo}&date=${playDate}`,
        bookable: true,
      };
      showtimes.push(show);
      if (rest != null) {
        indexSeatHit(
          map,
          {
            theaterId,
            playDate,
            startTime: time,
            movieTitle: title,
            hallName: guessed.hall,
            movieNo,
            chain: "cgv",
          },
          { rest, total },
        );
      }
    }
    const packed = { at: Date.now(), map, showtimes };
    relayCache.set(cacheKey, packed);
    return packed;
  } catch {
    return { map: {}, showtimes: [] };
  }
}

export async function fetchCgvOfficial(
  theaterId: CgvId,
  playDate: string,
): Promise<Showtime[]> {
  if (officialCgvBlocked) return [];
  const fromApi = await fetchCgvApi(theaterId, playDate);
  if (officialCgvBlocked) return [];
  if (fromApi.length) return fromApi;
  const iframe = await fetchOfficialHtml(
    `https://www.cgv.co.kr/common/showtimes/iframeTheater.aspx?areacode=01&theatercode=${CGV_SITES[theaterId].siteNo}&date=${playDate}`,
  );
  if (officialCgvBlocked) return [];
  const fromIframe = parseCgvOfficialShowtimes(iframe, theaterId, playDate);
  if (fromIframe.length) return fromIframe;
  const mobile = await fetchMobileSchedule(theaterId, playDate);
  return parseCgvOfficialShowtimes(mobile, theaterId, playDate);
}

export async function fetchCgvNaver(
  theaterId: CgvId,
): Promise<Map<string, Showtime[]>> {
  const catalog = await loadNaverIfNeeded(theaterId);
  return catalog ?? new Map();
}

export async function fetchYongsanTelegram(): Promise<Map<string, Showtime[]>> {
  const hit = teleCache;
  if (hit && hit.byDate.size > 0 && Date.now() - hit.at < 120_000) {
    return hit.byDate;
  }
  if (telePending) return telePending;
  const task = loadYongsanTelegram()
    .then((next) => {
      telePending = null;
      if (next.size > 0) teleCache = { at: Date.now(), byDate: next };
      return next;
    })
    .catch((err) => {
      telePending = null;
      throw err;
    });
  telePending = task;
  return task;
}

export async function fetchCgvTheater(
  theaterId: CgvId,
  playDate: string,
): Promise<{ showtimes: Showtime[]; source: string }> {
  const official = await fetchCgvOfficial(theaterId, playDate);
  if (official.length) return { showtimes: official, source: "official" };
  const catalog = await loadNaverIfNeeded(theaterId);
  if (catalog) {
    const rows = catalog.get(playDate) ?? [];
    if (rows.length) return { showtimes: rows, source: "naver-place" };
  }
  throw new Error(`${CGV_SITES[theaterId].theaterName} 시간표를 가져오지 못했습니다.`);
}


export async function attachCgvSeats(
  theaterId: CgvId,
  rows: Showtime[],
): Promise<Showtime[]> {
  if (!rows.length || officialCgvBlocked) return rows;
  const dates = [...new Set(rows.map((r) => r.playDate))];
  const maps = new Map<string, Map<string, SeatHit>>();
  for (let i = 0; i < dates.length; i += 3) {
    if (officialCgvBlocked) break;
    const part = dates.slice(i, i + 3);
    const got = await Promise.all(
      part.map(async (date) => [date, await fetchCgvSeatMap(theaterId, date)] as const),
    );
    for (const [date, map] of got) maps.set(date, map);
  }
  return rows.map((row) => {
    if (row.restSeats != null) return row;
    const seats = maps.get(row.playDate);
    if (!seats || !seats.size) return row;
    const hit =
      seats.get(seatKey(row.startTime, row.hallName)) ||
      seats.get(normTime(row.startTime));
    if (!hit) return row;
    return {
      ...row,
      restSeats: hit.rest,
      totalSeats: hit.total ?? row.totalSeats,
    };
  });
}

async function loadNaverIfNeeded(
  theaterId: CgvId,
): Promise<Map<string, Showtime[]> | null> {
  const hit = caches.get(theaterId);
  if (hit && hit.byDate.size > 0 && Date.now() - hit.at < 120_000) {
    return hit.byDate;
  }
  const inflight = pending.get(theaterId);
  if (inflight) return inflight;
  const task = loadNaverCgv(theaterId)
    .then((next) => {
      pending.delete(theaterId);
      if (next.size > 0) {
        caches.set(theaterId, { at: Date.now(), byDate: next });
        return next;
      }
      return hit && hit.byDate.size > 0 ? hit.byDate : null;
    })
    .catch((err) => {
      pending.delete(theaterId);
      throw err;
    });
  pending.set(theaterId, task);
  return task;
}

async function loadNaverCgv(theaterId: CgvId): Promise<Map<string, Showtime[]>> {
  const site = CGV_SITES[theaterId];
  const byDate = new Map<string, Showtime[]>();
  const res = await fetch(`https://m.place.naver.com/theater/${site.placeId}/movie`, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      "accept-language": "ko-KR,ko;q=0.9",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      referer: "https://m.place.naver.com/",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return byDate;
  const text = (await res.text()).split("\\u002F").join("/");
  const parts = text.split('"__typename":"MovieTime"');
  for (let i = 1; i < parts.length; i++) {
    const block = parts[i].slice(0, 100000);
    const dateRaw = block.match(/"date":"(\d{4}-\d{2}-\d{2})"/)?.[1];
    const title = decodeHtml(block.match(/"name":"([^"]+)"/)?.[1] ?? "").trim();
    if (!dateRaw || !title || title.length > 40) continue;
    if (!block.includes("scheduleList") && !block.includes("theaterName")) continue;
    const date = dateRaw.replace(/-/g, "");
    const hallBlocks = block.split('"theaterName":"');
    for (let h = 1; h < hallBlocks.length; h++) {
      const hall = hallBlocks[h].split('"')[0] ?? "";
      const formats = cgvFormats(hall).filter((f) => f !== "other");
      if (!formats.length) continue;
      const times = [...hallBlocks[h].matchAll(/"rtime":"(\d{1,2}:\d{2})"/g)].map(
        (m) => m[1].padStart(5, "0"),
      );
      const urls = [...hallBlocks[h].matchAll(/ticketMobileUrl":"([^"]+)"/g)].map(
        (m) => m[1],
      );
      times.forEach((startTime, idx) => {
        const bookingUrl = urls[idx] || urls[0] || "";
        const movieNo = bookingUrl.match(/movNo=(\d+)/)?.[1] ?? "";
        const row: Showtime = {
          id: `cgv:${site.siteNo}:${date}:${startTime}:${hall}:${title}`,
          theaterId,
          theaterName: site.theaterName,
          chain: "cgv",
          movieTitle: title,
          movieNo,
          playDate: date,
          startTime,
          endTime: null,
          hallName: hall,
          formats,
          restSeats: null,
          totalSeats: null,
          bookingUrl:
            bookingUrl ||
            `https://cgv.co.kr/cnm/movieBook?siteNo=${site.siteNo}&date=${date}`,
          bookable: true,
        };
        const list = byDate.get(date) ?? [];
        list.push(row);
        byDate.set(date, list);
      });
    }
  }
  return byDate;
}

function seatKey(time: string, hall: string) {
  return `${normTime(time)}|${normHall(hall)}`;
}

function normTime(time: string) {
  const t = String(time || "").trim();
  return t.length === 4 ? `0${t}` : t;
}

function normHall(hall: string) {
  return String(hall || "")
    .toUpperCase()
    .replace(/[\s|]+/g, "");
}

async function fetchCgvSeatMap(
  theaterId: CgvId,
  playDate: string,
): Promise<Map<string, SeatHit>> {
  if (officialCgvBlocked) return new Map();
  const iframe = await fetchOfficialHtml(
    `https://www.cgv.co.kr/common/showtimes/iframeTheater.aspx?areacode=01&theatercode=${CGV_SITES[theaterId].siteNo}&date=${playDate}`,
  );
  if (officialCgvBlocked) return new Map();
  const fromIframe = mergeSeatMaps(parseCgvSeatMap(iframe), parseCgvHrefSeats(iframe));
  if (fromIframe.size) return fromIframe;
  const mobile = await fetchMobileSchedule(theaterId, playDate);
  return mergeSeatMaps(parseCgvSeatMap(mobile), parseCgvHrefSeats(mobile));
}

async function fetchOfficialHtml(url: string) {
  if (officialCgvBlocked) return "";
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Linux; Android 13; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36",
        "accept-language": "ko-KR,ko;q=0.9",
        accept: "text/html,application/xhtml+xml",
        referer: "https://www.cgv.co.kr/theaters/",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(2500),
    });
    if (res.status === 403 || res.status === 429) {
      officialCgvBlocked = true;
      return "";
    }
    if (!res.ok) return "";
    return await res.text();
  } catch {
    officialCgvBlocked = true;
    return "";
  }
}

async function fetchMobileSchedule(theaterId: CgvId, playDate: string) {
  if (officialCgvBlocked) return "";
  try {
    const res = await fetch("https://m.cgv.co.kr/Schedule/cont/ajaxMovieSchedule.aspx", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "user-agent":
          "Mozilla/5.0 (Linux; Android 13; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36",
        "accept-language": "ko-KR,ko;q=0.9",
        "x-requested-with": "XMLHttpRequest",
        referer: "https://m.cgv.co.kr/",
      },
      body: new URLSearchParams({
        theaterCd: CGV_SITES[theaterId].siteNo,
        playYMD: playDate,
      }).toString(),
      redirect: "follow",
      signal: AbortSignal.timeout(2500),
    });
    if (res.status === 403 || res.status === 429) {
      officialCgvBlocked = true;
      return "";
    }
    if (!res.ok) return "";
    return await res.text();
  } catch {
    officialCgvBlocked = true;
    return "";
  }
}

function mergeSeatMaps(a: Map<string, SeatHit>, b: Map<string, SeatHit>) {
  const out = new Map(a);
  for (const [key, val] of b) {
    if (!out.has(key)) out.set(key, val);
  }
  return out;
}

function parseCgvSeatMap(html: string) {
  const map = new Map<string, SeatHit>();
  const chunks = String(html || "").split(/<li/i);
  let hall = "";
  let hallTotal: number | null = null;
  for (const chunk of chunks) {
    const hallM = chunk.match(
      /(ULTRA\s*4DX|SCREENX|4DX|IMAX|DOLBY\s*ATMOS|ATMOS|\d+\s*관)/i,
    );
    if (hallM) hall = hallM[1];
    const totM = chunk.match(/총\s*(\d+)\s*석/);
    if (totM) hallTotal = Number(totM[1]);
    const timeM = chunk.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
    const restM =
      chunk.match(/잔여좌석[^0-9]{0,12}(\d+)/) ||
      chunk.match(/>(\d+)\s*석</);
    const sold = /(마감|매진)/.test(chunk);
    if (!timeM || (!restM && !sold)) continue;
    const time = `${timeM[1].padStart(2, "0")}:${timeM[2]}`;
    const rest = restM ? Number(restM[1]) : 0;
    if (!Number.isFinite(rest)) continue;
    const rec = { rest, total: hallTotal };
    map.set(time, rec);
    if (hall) map.set(seatKey(time, hall), rec);
  }
  return map;
}

function parseCgvHrefSeats(html: string) {
  const map = new Map<string, SeatHit>();
  const parts = String(html || "").split(/href\s*=/i);
  for (const chunk of parts) {
    const quoted = chunk.match(/'[^']*'/g);
    if (!quoted || quoted.length < 8) continue;
    const vals = quoted.map((q) => q.slice(1, -1));
    let time = "";
    let hall = "";
    for (const v of vals) {
      if (/^([01]?\d|2[0-3]):[0-5]\d$/.test(v)) {
        time = v.length === 4 ? `0${v}` : v;
      }
      if (
        /(ULTRA\s*4DX|SCREENX|4DX|IMAX|DOLBY\s*ATMOS|ATMOS|\d+\s*관)/i.test(v) &&
        v.length < 40
      ) {
        hall = v;
      }
    }
    const indexed = vals.length > 9 ? seatPair(vals[7], vals[9]) : null;
    let rec = indexed;
    if (!rec) {
      for (let i = 0; i < vals.length - 1; i++) {
        const pair = seatPair(vals[i], vals[i + 1]);
        if (pair) {
          rec = pair;
          break;
        }
      }
    }
    if (!time || !rec) continue;
    map.set(time, rec);
    if (hall) map.set(seatKey(time, hall), rec);
  }
  return map;
}

function seatPair(a: string, b: string): SeatHit | null {
  if (!/^\d{1,4}$/.test(a) || !/^\d{1,4}$/.test(b)) return null;
  const rest = Number(a);
  const total = Number(b);
  if (!Number.isFinite(rest) || !Number.isFinite(total)) return null;
  if (total < 20 || total > 900 || rest < 0 || rest > total) return null;
  return { rest, total };
}

function parseCgvOfficialShowtimes(
  html: string,
  theaterId: CgvId,
  playDate: string,
): Showtime[] {
  if (!html) return [];
  const site = CGV_SITES[theaterId];
  const seats = mergeSeatMaps(parseCgvSeatMap(html), parseCgvHrefSeats(html));
  const out: Showtime[] = [];
  const seen = new Set<string>();
  const blocks = html.split(/<div[^>]*col-times/i);
  const chunks = blocks.length > 1 ? blocks.slice(1) : [html];
  for (const block of chunks) {
    const titleRaw =
      block.match(/<strong>([^<]+)<\/strong>/i)?.[1] ??
      block.match(/movieName["']?\s*[:=]\s*["']([^"']+)/i)?.[1] ??
      "";
    const title = decodeHtml(titleRaw).trim();
    if (!title || title.length > 60) continue;
    const halls = block.split(/type-hall|info-hall|info-timetable/i);
    const parts = halls.length > 1 ? halls : [block];
    for (const part of parts) {
      const hallM = part.match(
        /(ULTRA\s*4DX|SCREENX|4DX|IMAX|DOLBY\s*ATMOS|ATMOS|\d+\s*관)/i,
      );
      const hall = hallM ? hallM[1].replace(/\s+/g, " ").trim() : "";
      const formats = cgvFormats(hall).filter((f) => f !== "other");
      if (!formats.length) continue;
      const timed = [
        ...part.matchAll(/data-playstarttime=["'](\d{4})["']/gi),
      ].map((m) => `${m[1].slice(0, 2)}:${m[1].slice(2)}`);
      const clock = [...part.matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g)].map(
        (m) => `${m[1].padStart(2, "0")}:${m[2]}`,
      );
      const times = timed.length ? timed : clock;
      for (const startTime of times) {
        const id = `cgv:${site.siteNo}:${playDate}:${startTime}:${hall}:${title}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const hit =
          seats.get(seatKey(startTime, hall)) || seats.get(normTime(startTime));
        out.push({
          id,
          theaterId,
          theaterName: site.theaterName,
          chain: "cgv",
          movieTitle: title,
          movieNo: "",
          playDate,
          startTime,
          endTime: null,
          hallName: hall,
          formats,
          restSeats: hit?.rest ?? null,
          totalSeats: hit?.total ?? null,
          bookingUrl: `https://cgv.co.kr/cnm/movieBook?siteNo=${site.siteNo}&date=${playDate}`,
          bookable: true,
        });
      }
    }
  }
  return out;
}

async function fetchCgvApi(
  theaterId: CgvId,
  playDate: string,
): Promise<Showtime[]> {
  if (officialCgvBlocked) return [];
  const site = CGV_SITES[theaterId];
  try {
    const res = await fetch(
      `https://api.cgv.co.kr/cnm/atkt/searchMovScnInfo?coCd=A420&siteNo=${site.siteNo}&scnYmd=${playDate}&rtctlScopCd=08`,
      {
        headers: {
          accept: "application/json, text/plain, */*",
          "accept-language": "ko-KR,ko;q=0.9",
          origin: "https://cgv.co.kr",
          referer: "https://cgv.co.kr/",
          "user-agent":
            "Mozilla/5.0 (Linux; Android 13; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(2500),
      },
    );
    if (res.status === 403 || res.status === 429) {
      officialCgvBlocked = true;
      return [];
    }
    if (!res.ok) return [];
    const json = (await res.json()) as {
      data?: CgvApiRow[];
      body?: CgvApiRow[];
    };
    const rows = json.data ?? json.body ?? [];
    const out: Showtime[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const title = decodeHtml(row.movNm || row.movieName || "").trim();
      const hall = String(
        row.scrnNm || row.scnNm || row.soundTypNm || row.scnsrtNm || "",
      ).trim();
      const formats = cgvFormats(hall).filter((f) => f !== "other");
      if (!title || !formats.length) continue;
      const raw = String(row.scnsrtTm || row.startTime || "");
      const startTime =
        raw.length === 4 ? `${raw.slice(0, 2)}:${raw.slice(2)}` : raw;
      if (!/^\d{2}:\d{2}$/.test(startTime)) continue;
      const id = `cgv:${site.siteNo}:${playDate}:${startTime}:${hall}:${title}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const rest = Number(row.frSeatCnt);
      const total = Number(row.stcnt);
      out.push({
        id,
        theaterId,
        theaterName: site.theaterName,
        chain: "cgv",
        movieTitle: title,
        movieNo: String(row.movNo ?? ""),
        playDate,
        startTime,
        endTime: null,
        hallName: hall,
        formats,
        restSeats: Number.isFinite(rest) ? rest : null,
        totalSeats: Number.isFinite(total) ? total : null,
        bookingUrl: `https://cgv.co.kr/cnm/movieBook?siteNo=${site.siteNo}&date=${playDate}`,
        bookable: true,
      });
    }
    return out;
  } catch {
    officialCgvBlocked = true;
    return [];
  }
}

type CgvApiRow = {
  movNm?: string;
  movieName?: string;
  scrnNm?: string;
  scnNm?: string;
  soundTypNm?: string;
  scnsrtNm?: string;
  scnsrtTm?: string;
  startTime?: string;
  frSeatCnt?: number;
  stcnt?: number;
  movNo?: string;
};

async function loadYongsanTelegram(): Promise<Map<string, Showtime[]>> {
  const byDate = new Map<string, Showtime[]>();
  const site = CGV_SITES.cgv_yongsan;
  const res = await fetch("https://t.me/s/yongsan_cgv_imax", {
    headers: {
      "user-agent":
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      "accept-language": "ko-KR,ko;q=0.9",
      accept: "text/html",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return byDate;
  const plain = (await res.text()).replace(/<[^>]+>/g, "\n");
  const parts = plain.split(/(\d{4}년\s*\d{1,2}월\s*\d{1,2}일)/);
  for (let i = 1; i < parts.length; i += 2) {
    const head = parts[i] ?? "";
    const body = parts[i + 1] ?? "";
    const dm = head.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
    if (!dm) continue;
    const date = `${dm[1]}${dm[2].padStart(2, "0")}${dm[3].padStart(2, "0")}`;
    let title = "오디세이";
    const tm = body.match(/([가-힣A-Za-z0-9: ·]{2,40})\s*\(\s*IMAX/i);
    if (tm) title = decodeHtml(tm[1]).replace(/\s+/g, " ").trim();
    const times = body.match(/(\d{1,2}:\d{2})\s*~/g) ?? [];
    for (const mark of times) {
      const startTime = mark.replace(/[^0-9:]/g, "").padStart(5, "0");
      const hall = "IMAX관";
      const row: Showtime = {
        id: `cgv:${site.siteNo}:${date}:${startTime}:${hall}:${title}`,
        theaterId: "cgv_yongsan",
        theaterName: site.theaterName,
        chain: "cgv",
        movieTitle: title,
        movieNo: "",
        playDate: date,
        startTime,
        endTime: null,
        hallName: hall,
        formats: ["imax"],
        restSeats: null,
        totalSeats: null,
        bookingUrl: `https://cgv.co.kr/cnm/movieBook?siteNo=${site.siteNo}&date=${date}`,
        bookable: true,
      };
      const list = byDate.get(date) ?? [];
      list.push(row);
      byDate.set(date, list);
    }
  }
  return byDate;
}

