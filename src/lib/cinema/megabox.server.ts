import { decodeHtml, kstDateKeys } from "@/lib/utils";
import { megaboxFormats } from "./theaters";
import { postFormJson } from "./http.server";
import { putSeatHit, type SeatHitMap } from "./seats";
import type { Showtime } from "./types";

type MegaForm = {
  playSchdlNo?: string;
  rpstMovieNm?: string;
  movieNm?: string;
  movieNo?: string;
  rpstMovieNo?: string;
  playDe?: string;
  playStartTime?: string;
  playEndTime?: string;
  theabExpoNm?: string;
  theabKindCd?: string;
  restSeatCnt?: number;
  totSeatCnt?: number;
  bokdAbleAt?: string;
  brchNm?: string;
  moviePosterImg?: string;
};

type MegaSchedule = {
  megaMap?: { movieFormList?: MegaForm[] };
};

type MegaMovie = {
  movieNo?: string;
  rpstMovieNo?: string;
  movieNm?: string;
  boxoRank?: number;
  boxoBokdRt?: number;
  imgPathNm?: string;
  rfilmDe?: string;
  bokdAbleAt?: string;
};

type MegaMovieList = {
  imgSvrUrl?: string;
  movieList?: MegaMovie[];
};

type MegaboxId = "megabox_coex" | "megabox_namyangju";

const BRANCH: Record<MegaboxId, string> = {
  megabox_coex: "1351",
  megabox_namyangju: "0019",
};

const NAVER_PLACE: Record<MegaboxId, { placeId: string; theaterName: string }> = {
  megabox_coex: { placeId: "12307868", theaterName: "코엑스" },
  megabox_namyangju: { placeId: "1542146675", theaterName: "남양주" },
};

type NaverCache = { at: number; byDate: Map<string, Showtime[]> };
const naverCaches = new Map<MegaboxId, NaverCache>();
const naverPending = new Map<MegaboxId, Promise<Map<string, Showtime[]>>>();
let megaFailStreak = 0;
let megaFailAt = 0;
const megaSeatCache = new Map<string, { at: number; map: SeatHitMap }>();
const MEGA_SEAT_TTL = 90_000;

function isMegaboxId(id: string): id is MegaboxId {
  return id in BRANCH;
}

export async function fetchMegaboxCatalog() {
  const data = await postFormJson<MegaMovieList>(
    "https://www.megabox.co.kr/on/oh/oha/Movie/selectMovieList.do",
    {
      currentPage: "1",
      recordCountPerPage: "80",
      onairYn: "Y",
    },
  );
  const imgSvr = data.imgSvrUrl ?? "https://img.megabox.co.kr";
  const today = kstDateKeys(1)[0];
  const all = (data.movieList ?? [])
    .filter((m) => m.movieNm)
    .map((m) => {
      const releaseDate = toYmd(m.rfilmDe);
      return {
        rank: m.boxoRank && m.boxoRank < 900 ? m.boxoRank : 0,
        title: decodeHtml(m.movieNm ?? ""),
        movieNo: m.rpstMovieNo || m.movieNo || "",
        bookingRate: typeof m.boxoBokdRt === "number" ? m.boxoBokdRt : null,
        posterUrl: m.imgPathNm ? `${imgSvr}${m.imgPathNm}` : null,
        releaseDate: releaseDate || null,
        bookingOpen: m.bokdAbleAt === "Y",
        released: Boolean(releaseDate && releaseDate <= today),
      };
    });
  const ranking = all
    .filter((m) => m.rank >= 1 && m.rank <= 9)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 9);
  const showing = all
    .filter((m) => m.released)
    .sort((a, b) => {
      const ra = a.rank || 999;
      const rb = b.rank || 999;
      if (ra !== rb) return ra - rb;
      return (b.bookingRate ?? 0) - (a.bookingRate ?? 0);
    })
    .slice(0, 9)
    .map((m, i) => ({ ...m, rank: i + 1 }));
  return { ranking, showing };
}

function toYmd(value?: string) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length >= 8 ? digits.slice(0, 8) : "";
}

export async function fetchMegaboxSeatmap(input?: {
  theaterId?: MegaboxId;
  days?: number;
  fresh?: boolean;
}): Promise<SeatHitMap> {
  const days = Math.min(Math.max(input?.days ?? 7, 1), 14);
  const dates = kstDateKeys(days);
  const theaters: MegaboxId[] = input?.theaterId
    ? [input.theaterId]
    : (Object.keys(BRANCH) as MegaboxId[]);
  if (input?.fresh) megaFailStreak = 0;
  const map: SeatHitMap = {};
  const stale: SeatHitMap = {};
  for (const id of theaters) {
    for (const date of dates) {
      const hit = megaSeatCache.get(`${id}|${date}`);
      if (hit) Object.assign(stale, hit.map);
    }
  }
  const enqueue = async (id: MegaboxId, date: string) => {
    const cacheKey = `${id}|${date}`;
    const hit = megaSeatCache.get(cacheKey);
    const cacheAge = hit ? Date.now() - hit.at : Number.POSITIVE_INFINITY;
    if (!input?.fresh && hit && cacheAge < MEGA_SEAT_TTL) {
      Object.assign(map, hit.map);
      return;
    }
    if (input?.fresh && hit && cacheAge < 20_000) {
      Object.assign(map, hit.map);
      return;
    }
    const rows = await fetchMegaboxSchedule(id, date, {
      ignoreCircuit: true,
      timeoutMs: 6000,
    }).catch(() => null);
    if (!rows) {
      if (hit) Object.assign(map, hit.map);
      return;
    }
    const part: SeatHitMap = {};
    for (const row of rows) putSeatHit(part, row);
    if (Object.keys(part).length) {
      megaSeatCache.set(cacheKey, { at: Date.now(), map: part });
      Object.assign(map, part);
      return;
    }
    if (hit) Object.assign(map, hit.map);
  };
  const tasks: Array<() => Promise<void>> = [];
  for (const id of theaters) {
    for (const date of dates) tasks.push(() => enqueue(id, date));
  }
  const size = 6;
  for (let i = 0; i < tasks.length; i += size) {
    await Promise.all(tasks.slice(i, i + size).map((fn) => fn()));
  }
  if (!Object.keys(map).length) Object.assign(map, stale);
  return map;
}

export async function fetchMegaboxSchedule(
  theaterId: MegaboxId,
  playDate: string,
  opts?: { ignoreCircuit?: boolean; timeoutMs?: number },
): Promise<Showtime[]> {
  if (!isMegaboxId(theaterId)) return [];
  if (
    !opts?.ignoreCircuit &&
    megaFailStreak >= 3 &&
    Date.now() - megaFailAt < 45_000
  ) {
    throw new Error("메가박스에 연결하지 못했습니다.");
  }
  if (megaFailStreak >= 3 && Date.now() - megaFailAt >= 45_000) {
    megaFailStreak = 0;
  }
  try {
    const brchNo = BRANCH[theaterId];
    const data = await postFormJson<MegaSchedule>(
      "https://www.megabox.co.kr/on/oh/ohc/Brch/schedulePage.do",
      {
        brchNo,
        brchNo1: brchNo,
        playDe: playDate,
        masterType: "brch",
      },
      { timeoutMs: opts?.timeoutMs ?? 8000, attempts: 1 },
    );
    megaFailStreak = 0;
    const list = data.megaMap?.movieFormList ?? [];
    return list
      .map((row) => toShowtime(theaterId, brchNo, row))
      .filter((row): row is Showtime => Boolean(row));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (/403|429/.test(msg)) {
      megaFailStreak += 1;
      megaFailAt = Date.now();
    }
    throw err instanceof Error ? err : new Error("메가박스 조회 실패");
  }
}

export async function fetchNaverMegabox(
  theaterId: MegaboxId,
): Promise<Map<string, Showtime[]>> {
  const hit = naverCaches.get(theaterId);
  if (hit && hit.byDate.size > 0 && Date.now() - hit.at < 120_000) {
    return hit.byDate;
  }
  const inflight = naverPending.get(theaterId);
  if (inflight) return inflight;
  const task = loadNaverMegabox(theaterId)
    .then((next) => {
      naverPending.delete(theaterId);
      if (next.size > 0) {
        naverCaches.set(theaterId, { at: Date.now(), byDate: next });
      }
      return next;
    })
    .catch((err) => {
      naverPending.delete(theaterId);
      throw err;
    });
  naverPending.set(theaterId, task);
  return task;
}

async function loadNaverMegabox(
  theaterId: MegaboxId,
): Promise<Map<string, Showtime[]>> {
  const site = NAVER_PLACE[theaterId];
  const brchNo = BRANCH[theaterId];
  const byDate = new Map<string, Showtime[]>();
  const res = await fetch(
    `https://m.place.naver.com/theater/${site.placeId}/movie`,
    {
      headers: {
        "user-agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        "accept-language": "ko-KR,ko;q=0.9",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        referer: "https://m.place.naver.com/",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!res.ok) return byDate;
  const text = (await res.text()).split("\\u002F").join("/");
  const parts = text.split('"__typename":"MovieTime"');
  for (let i = 1; i < parts.length; i++) {
    const chunk = parts[i].slice(0, 100000);
    const dateRaw = chunk.match(/"date":"(\d{4}-\d{2}-\d{2})"/)?.[1];
    const title = decodeHtml(chunk.match(/"name":"([^"]+)"/)?.[1] ?? "").trim();
    if (!dateRaw || !title || title.length > 40) continue;
    const date = dateRaw.replace(/-/g, "");
    const hallBlocks = chunk.split('"theaterName":"');
    for (let h = 1; h < hallBlocks.length; h++) {
      const hall = hallBlocks[h].split('"')[0] ?? "";
      const formats = megaboxFormats(null, hall).filter((f) => f !== "other");
      if (!formats.length) continue;
      const times = [
        ...hallBlocks[h].matchAll(/"rtime":"(\d{1,2}:\d{2})"/g),
      ].map((m) => m[1].padStart(5, "0"));
      const urls = [
        ...hallBlocks[h].matchAll(/ticketMobileUrl":"([^"]+)"/g),
      ].map((m) => m[1]);
      times.forEach((startTime, idx) => {
        const bookingUrl =
          urls[idx] ||
          urls[0] ||
          `https://m.megabox.co.kr/booking?brchNo=${brchNo}&playDe=${date}`;
        const playSchdlNo = bookingUrl.match(/playSchdlNo=(\w+)/)?.[1];
        const row: Showtime = {
          id: `megabox:${brchNo}:${date}:${startTime}:${hall}`,
          theaterId,
          theaterName: site.theaterName,
          chain: "megabox",
          movieTitle: title,
          movieNo: "",
          playDate: date,
          startTime,
          endTime: null,
          hallName: hall,
          formats,
          restSeats: null,
          totalSeats: null,
          bookingUrl: playSchdlNo
            ? `https://m.megabox.co.kr/on/oh/ohz/PcntSeatChoi/selectPcntSeatChoi.do?playSchdlNo=${playSchdlNo}&brchNo=${brchNo}&playDe=${date}`
            : bookingUrl,
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

function toShowtime(
  theaterId: MegaboxId,
  brchNo: string,
  row: MegaForm,
): Showtime | null {
  const start = (row.playStartTime ?? "").trim();
  const playDate = row.playDe ?? "";
  const title = decodeHtml(row.rpstMovieNm || row.movieNm || "");
  const hall = decodeHtml(row.theabExpoNm || "");
  if (!start || !playDate || !title) return null;
  const movieNo = row.rpstMovieNo || row.movieNo || "";
  const id = `megabox:${brchNo}:${playDate}:${start}:${hall}`;
  return {
    id,
    theaterId,
    theaterName: decodeHtml(row.brchNm || (theaterId === "megabox_coex" ? "코엑스" : "남양주")),
    chain: "megabox",
    movieTitle: title,
    movieNo,
    playDate,
    startTime: start,
    endTime: row.playEndTime ?? null,
    hallName: hall,
    formats: megaboxFormats(row.theabKindCd, hall),
    restSeats: toSeatNumber(row.restSeatCnt),
    totalSeats: toSeatNumber(row.totSeatCnt),
    bookingUrl: megaboxSeatUrl(brchNo, playDate, movieNo, row.playSchdlNo),
    bookable: row.bokdAbleAt !== "N",
  };
}

function toSeatNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const n = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function megaboxSeatUrl(
  brchNo: string,
  playDate: string,
  movieNo: string,
  playSchdlNo?: string,
) {
  if (playSchdlNo) {
    const q = new URLSearchParams({
      playSchdlNo,
      brchNo,
      playDe: playDate,
    });
    if (movieNo) q.set("movieNo", movieNo);
    return `https://m.megabox.co.kr/on/oh/ohz/PcntSeatChoi/selectPcntSeatChoi.do?${q.toString()}`;
  }
  const q = new URLSearchParams({ brchNo, playDe: playDate });
  if (movieNo) q.set("movieNo", movieNo);
  return `https://m.megabox.co.kr/booking?${q.toString()}`;
}
