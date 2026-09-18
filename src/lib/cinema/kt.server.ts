import type { Showtime, TheaterId } from "./types";
import { putSeatHit, type SeatHitMap } from "./seats";
import { cgvFormats, megaboxFormats } from "./theaters";
import { decodeHtml, normalizePlayDate } from "@/lib/utils";

// KT 쇼무비(showmovie.mobile.kt.com)는 CGV 티켓을 실제로 파는 공식 제휴처라
// 잔여석 데이터가 실시간이고, 확인 결과 로그인 없이도(시크릿 모드) 그대로 응답한다.
// 공홈/우회조회(mcp.aka.page)가 둘 다 막혔을 때를 대비한 3번째 CGV 잔여석 소스.
//
// 메가박스: KT 쇼무비 API는 MEGABOX agency 를 받아도 CGV 극장만 돌려주며
// GetPlayTime 잔여석이 비어 있다. 대신 모바일 UA 로 메가박스 스케줄 API 를
// 병렬 조회한다. seatSource 는 mega-mobile (CGV 의 cgv-kt 와 구분).
// 설정 표 우회 칸에는 scan 쪽에서 같은 시각 맵으로 합친다.

const KT_BASE = "https://showmovie.mobile.kt.com/WebService/wsMovieInfo5.asmx";

const KT_THEATER_CD: Partial<Record<TheaterId, string>> = {
  cgv_yongsan: "201",
  cgv_yeongdeungpo: "35",
};

const KT_AGN_THEATER_NO: Partial<Record<TheaterId, string>> = {
  cgv_yongsan: "0013",
  cgv_yeongdeungpo: "0059",
};

const MEGA_BRANCH: Partial<Record<TheaterId, string>> = {
  megabox_coex: "1351",
  megabox_namyangju: "0019",
};

const MEGA_NAME: Partial<Record<TheaterId, string>> = {
  megabox_coex: "메가박스 코엑스",
  megabox_namyangju: "메가박스 남양주",
};

function tag(xml: string, name: string): string | null {
  const m = xml.match(new RegExp(`<${name}>([^<]*)<\\/${name}>`));
  const v = m?.[1]?.trim();
  return v && v.length ? v : null;
}

type KtMovie = { name: string; agnMovieNo: string; agnMovieGrpNo: string };

async function fetchKtMovieTitle(theaterCd: string): Promise<KtMovie[]> {
  const url = `${KT_BASE}/GetMovieTitle?agencyNo=CGV&theatercd=${encodeURIComponent(theaterCd)}`;
  const res = await fetch(url, { headers: { accept: "application/xml, text/xml, */*" } });
  if (!res.ok) return [];
  const xml = await res.text();
  const movies: KtMovie[] = [];
  for (const block of xml.split("<CMovie>").slice(1)) {
    const name = tag(block, "MovieName");
    const agnMovieNo = tag(block, "AgnMovieNo");
    const agnMovieGrpNo = tag(block, "AgnMovieGrpNo");
    if (name && agnMovieNo && agnMovieGrpNo) movies.push({ name, agnMovieNo, agnMovieGrpNo });
  }
  return movies;
}

type KtPlay = { startTime: string; endTime: string | null; screenNm: string; seatQty: number; seatTot: number; screenCd: string | null; playNum: string | null };

async function fetchKtPlayTime(
  agnTheaterNo: string,
  agnMovieGrpNo: string,
  agnMovieNo: string,
  dateYmd: string,
): Promise<KtPlay[]> {
  const url = `${KT_BASE}/GetPlayTime?agencyNo=CGV&agnTheaterNo=${encodeURIComponent(agnTheaterNo)}&agnMovieGrpNo=${encodeURIComponent(agnMovieGrpNo)}&agnMovieNo=${encodeURIComponent(agnMovieNo)}&strPlayDateYmd=${encodeURIComponent(dateYmd)}&callType=web`;
  const res = await fetch(url, { headers: { accept: "application/xml, text/xml, */*" } });
  if (!res.ok) return [];
  const xml = await res.text();
  const out: KtPlay[] = [];
  for (const block of xml.split("<CPlayNum>").slice(1)) {
    const startTime = tag(block, "StartHHMM");
    const seatQty = Number(tag(block, "SeatQty") ?? "");
    const seatTot = Number(tag(block, "SeatTot") ?? "");
    const screenNm = tag(block, "ScreenNm") ?? "";
    if (startTime && Number.isFinite(seatQty) && Number.isFinite(seatTot)) {
      out.push({
        startTime,
        endTime: tag(block, "EndTime"),
        screenNm,
        seatQty,
        seatTot,
        screenCd: tag(block, "ScreenCd"),
        playNum: tag(block, "PlayNum"),
      });
    }
  }
  return out;
}

function ymd(dateKey: string): string {
  return dateKey.replace(/-/g, "");
}

function ktCgvBookingUrl(
  theaterId: TheaterId,
  playDate: string,
  movieNo: string,
  screenCd?: string | null,
  playNum?: string | null,
): string {
  const siteNo = KT_AGN_THEATER_NO[theaterId] || "";
  const siteNm = theaterId === "cgv_yongsan" ? "용산아이파크몰" : "영등포타임스퀘어";
  if (!siteNo || !movieNo) return "";
  const params = new URLSearchParams({ movNo: movieNo, scnYmd: playDate, siteNo, siteNm });
  // 2026-09-18 실사용자 클릭 검증(용산, 여러 회차)으로 확정:
  // KT GetPlayTime의 ScreenCd(3자리 zero-padded) = CGV scnsNo,
  // PlayNum(그날 몇 번째 회차, 1부터 시작, 패딩 없음) = CGV scnSseq.
  // 이 둘이 있으면 회차 선택 완료(빨간 테두리) 지점까지 바로 들어가는 정밀 URL이 된다.
  if (screenCd && playNum) {
    params.set("scnsNo", screenCd);
    params.set("scnSseq", playNum);
  }
  return `https://cgv.co.kr/cnm/movieBook/movie?${params.toString()}`;
}

function normalizeTime(raw: string): string {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length < 3) return String(raw || "").trim();
  const padded = digits.length === 3 ? `0${digits}` : digits.slice(0, 4);
  return `${padded.slice(0, 2)}:${padded.slice(2, 4)}`;
}

type MegaForm = {
  movieNm?: string;
  movieNo?: string;
  rpstMovieNo?: string;
  playDe?: string;
  playStartTime?: string;
  playEndTime?: string;
  theabExpoNm?: string;
  restSeatCnt?: number;
  totSeatCnt?: number;
  playSchdlNo?: string;
};

/** 메가박스 모바일 UA 스케줄 — 설정 표 우회 칸용 메가박스 모바일 조회 */
async function fetchMegaboxMobileSchedule(
  theaterId: TheaterId,
  playDate: string,
): Promise<Showtime[]> {
  const brchNo = MEGA_BRANCH[theaterId];
  if (!brchNo) return [];
  const dateYmd = ymd(playDate);
  const body = new URLSearchParams({
    brchNo,
    brchNo1: brchNo,
    playDe: dateYmd,
    masterType: "brch",
  });
  const res = await fetch("https://m.megabox.co.kr/on/oh/ohc/Brch/schedulePage.do", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      accept: "application/json, text/javascript, */*; q=0.01",
      "x-requested-with": "XMLHttpRequest",
      "user-agent":
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      referer: "https://m.megabox.co.kr/theater/time",
    },
    body,
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { megaMap?: { movieFormList?: MegaForm[] } };
  const list = data.megaMap?.movieFormList ?? [];
  const out: Showtime[] = [];
  const nowIso = new Date().toISOString();
  for (const row of list) {
    const movieTitle = decodeHtml(String(row.movieNm || "")).trim();
    const startTime = normalizeTime(String(row.playStartTime || ""));
    const hallName = decodeHtml(String(row.theabExpoNm || "")).trim() || "일반";
    if (!movieTitle || !startTime) continue;
    const rest = Number(row.restSeatCnt);
    const total = Number(row.totSeatCnt);
    const playSchdlNo = String(row.playSchdlNo || "");
    const movieNo = String(row.rpstMovieNo || row.movieNo || "");
    const show: Showtime = {
      id: `kt-mega-${theaterId}-${dateYmd}-${startTime}-${hallName}-${movieTitle}`,
      theaterId,
      theaterName: MEGA_NAME[theaterId] || theaterId,
      chain: "megabox",
      movieTitle,
      movieNo,
      playDate: normalizePlayDate(dateYmd),
      startTime,
      endTime: row.playEndTime ? normalizeTime(String(row.playEndTime)) : null,
      hallName,
      formats: megaboxFormats(null, hallName),
      restSeats: Number.isFinite(rest) ? rest : null,
      totalSeats: Number.isFinite(total) ? total : null,
      bookingUrl: playSchdlNo
        ? `https://m.megabox.co.kr/booking/seat?playSchdlNo=${encodeURIComponent(playSchdlNo)}`
        : `https://www.megabox.co.kr/booking?brchNo=${brchNo}`,
      bookable: true,
      seatLive: Number.isFinite(rest),
      seatCheckedAt: nowIso,
      seatSource: "mega-mobile",
    };
    out.push(show);
  }
  return out;
}

/**
 * KT 우회 잔여석:
 * - CGV: KT 쇼무비 실시간 API → seatSource cgv-kt
 * - 메가박스: 모바일 스케줄 API → seatSource mega-mobile (KT 쇼무비는 메가 미지원)
 */
export async function fetchCgvKtSeatmap(input: {
  theaters: TheaterId[];
  dates: string[];
}): Promise<{ map: SeatHitMap; showtimes: Showtime[] }> {
  const map: SeatHitMap = {};
  const showtimes: Showtime[] = [];
  const cgvIds = input.theaters.filter((id) => KT_THEATER_CD[id]);
  const megaIds = input.theaters.filter((id) => MEGA_BRANCH[id]);
  if ((!cgvIds.length && !megaIds.length) || !input.dates.length) return { map, showtimes };

  const nowIso = new Date().toISOString();

  await Promise.all([
    ...cgvIds.map(async (theaterId) => {
      const theaterCd = KT_THEATER_CD[theaterId]!;
      const agnTheaterNo = KT_AGN_THEATER_NO[theaterId]!;
      let movies: KtMovie[] = [];
      try {
        movies = await fetchKtMovieTitle(theaterCd);
      } catch {
        return;
      }
      const pairs = movies.flatMap((movie) => input.dates.map((dateKey) => ({ movie, dateKey })));
      await Promise.all(
        pairs.map(async ({ movie, dateKey }) => {
          let plays: KtPlay[] = [];
          try {
            plays = await fetchKtPlayTime(
              agnTheaterNo,
              movie.agnMovieGrpNo,
              movie.agnMovieNo,
              ymd(dateKey),
            );
          } catch {
            return;
          }
          for (const play of plays) {
            const row: Showtime = {
              id: `kt-${theaterId}-${dateKey}-${play.startTime}-${movie.agnMovieGrpNo}`,
              theaterId,
              theaterName:
                theaterId === "cgv_yongsan" ? "CGV 용산아이파크몰" : "CGV 영등포타임스퀘어",
              chain: "cgv",
              movieTitle: movie.name,
              movieNo: movie.agnMovieGrpNo,
              playDate: dateKey,
              startTime: play.startTime,
              endTime: play.endTime,
              hallName: play.screenNm,
              formats: cgvFormats(play.screenNm),
              restSeats: play.seatQty,
              totalSeats: play.seatTot,
              bookingUrl: ktCgvBookingUrl(theaterId, dateKey, movie.agnMovieGrpNo, play.screenCd, play.playNum),
              bookable: true,
              seatLive: true,
              seatCheckedAt: nowIso,
              seatSource: "cgv-kt",
            };
            showtimes.push(row);
            putSeatHit(map, row);
          }
        }),
      );
    }),
    ...megaIds.map(async (theaterId) => {
      await Promise.all(
        input.dates.map(async (dateKey) => {
          try {
            const rows = await fetchMegaboxMobileSchedule(theaterId, dateKey);
            for (const row of rows) {
              showtimes.push(row);
              putSeatHit(map, row);
            }
          } catch {
            /* ignore single date failure */
          }
        }),
      );
    }),
  ]);

  return { map, showtimes };
}
