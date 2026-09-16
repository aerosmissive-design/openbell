import type { Showtime, TheaterId } from "./types";
import { putSeatHit, type SeatHitMap } from "./seats";
import { cgvFormats } from "./theaters";

// KT 쇼무비(showmovie.mobile.kt.com)는 CGV 티켓을 실제로 파는 공식 제휴처라
// 잔여석 데이터가 실시간이고, 확인 결과 로그인 없이도(시크릿 모드) 그대로 응답한다.
// 공홈/우회조회(mcp.aka.page)가 둘 다 막혔을 때를 대비한 3번째 CGV 잔여석 소스.

const KT_BASE = "https://showmovie.mobile.kt.com/WebService/wsMovieInfo5.asmx";

const KT_THEATER_CD: Partial<Record<TheaterId, string>> = {
  cgv_yongsan: "201",
  cgv_yeongdeungpo: "35",
};

const KT_AGN_THEATER_NO: Partial<Record<TheaterId, string>> = {
  cgv_yongsan: "0013",
  cgv_yeongdeungpo: "0059",
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

type KtPlay = { startTime: string; endTime: string | null; screenNm: string; seatQty: number; seatTot: number };

async function fetchKtPlayTime(agnTheaterNo: string, agnMovieGrpNo: string, agnMovieNo: string, dateYmd: string): Promise<KtPlay[]> {
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
    if (startTime && Number.isFinite(seatQty) && Number.isFinite(seatTot)) out.push({ startTime, endTime: tag(block, "EndTime"), screenNm, seatQty, seatTot });
  }
  return out;
}

function ymd(dateKey: string): string { return dateKey.replace(/-/g, ""); }

/**
 * KT 쇼무비를 통해 CGV 용산/영등포 잔여석을 조회한다.
 * 호출측에서 오픈벨 설정의 감시 기간(5/7/10/15/30일 등)을 그대로 dates로 전달한다.
 * KT 자체에서 제공하지 않는 특별관은 이 소스로 숫자가 생기지 않으며, 같은 관의 회차만 매칭한다.
 */
export async function fetchCgvKtSeatmap(input: { theaters: TheaterId[]; dates: string[] }): Promise<{ map: SeatHitMap; showtimes: Showtime[] }> {
  const map: SeatHitMap = {};
  const showtimes: Showtime[] = [];
  const theaterIds = input.theaters.filter((id) => KT_THEATER_CD[id]);
  if (!theaterIds.length || !input.dates.length) return { map, showtimes };

  await Promise.all(theaterIds.map(async (theaterId) => {
    const theaterCd = KT_THEATER_CD[theaterId]!;
    const agnTheaterNo = KT_AGN_THEATER_NO[theaterId]!;
    let movies: KtMovie[] = [];
    try { movies = await fetchKtMovieTitle(theaterCd); } catch { return; }
    const pairs = movies.flatMap((movie) => input.dates.map((dateKey) => ({ movie, dateKey })));
    await Promise.all(pairs.map(async ({ movie, dateKey }) => {
      let plays: KtPlay[] = [];
      try { plays = await fetchKtPlayTime(agnTheaterNo, movie.agnMovieGrpNo, movie.agnMovieNo, ymd(dateKey)); } catch { return; }
      for (const play of plays) {
        const row: Showtime = {
          id: `kt-${theaterId}-${dateKey}-${play.startTime}-${movie.agnMovieGrpNo}`,
          theaterId,
          theaterName: theaterId === "cgv_yongsan" ? "CGV 용산아이파크몰" : "CGV 영등포타임스퀘어",
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
          bookingUrl: "",
          bookable: true,
          seatLive: true,
          seatCheckedAt: new Date().toISOString(),
        };
        showtimes.push(row);
        putSeatHit(map, row);
      }
    }));
  }));

  return { map, showtimes };
}
