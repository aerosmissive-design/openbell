import { normalizeTitle } from "@/lib/utils";
import { titlesMatch } from "./match";
import type { Showtime } from "./types";
import { clockVariants, hallsMatch, normTime } from "./seats-lookup";

export type { SeatHit, SeatHitMap } from "./seats-lookup";
export {
  applyCgvSeatHits,
  indexSeatHit,
  putSeatHit,
  lookupSeatHit,
  hallsMatch,
  normTime,
} from "./seats-lookup";
export {
  formatSeatCheckedAt,
  latestSeatArrival,
  seatStatusLine,
  seatFreshnessLabel,
  countSeatHits,
  summarizeSeatDelta,
  listSeatGains,
  formatClock,
  formatShowPlace,
  formatPlayDate,
  showAlertBody,
} from "./seats-status";
export {
  diffStarSeats,
  seatChangeAlert,
  notifyBatches,
  alertBookingUrl,
  notifyCopy,
  escapeHtml,
  escapeAttr,
} from "./seats-alert";
export type { SeatChange } from "./seats-alert";

export function describeSeatPing(result: { status: string; count: number; cgvCount: number }): { ok: boolean; text: string } {
  if (result.status === "ok" && result.count > 0) return { ok: true, text: "잔여석을 붙였습니다." };
  if (result.status === "timeout") return { ok: false, text: "잔여석 응답이 늦습니다. 잠시 뒤 다시 누르세요." };
  if (result.status === "denied") return { ok: false, text: "구글이 막았습니다. 웹앱 액세스가 '모든 사용자'인지 보세요." };
  if (result.status === "badurl") return { ok: false, text: "구글 웹앱 주소가 올바르지 않습니다. /exec 로 끝나는 주소를 붙여넣으세요." };
  return { ok: false, text: "잔여석을 받지 못했습니다. 잠시 뒤 다시 눌러 보세요." };
}

export function mergeShowtimes(primary: Showtime[], extra: Showtime[] = []): Showtime[] {
  const out: Showtime[] = [];
  for (const row of [...extra, ...primary]) {
    const index = out.findIndex((candidate) => sameShowtime(row, candidate));
    if (index < 0) {
      out.push(row);
      continue;
    }
    const prev = out[index]!;
    out[index] = {
      ...prev,
      ...row,
      restSeats: row.restSeats ?? prev.restSeats,
      totalSeats: row.totalSeats ?? prev.totalSeats,
      bookingUrl: betterBookingUrl(row.bookingUrl, prev.bookingUrl),
      movieNo: row.movieNo || prev.movieNo,
      seatLive: row.restSeats != null ? (row.seatLive ?? true) : prev.seatLive,
      seatCheckedAt: row.seatCheckedAt ?? prev.seatCheckedAt,
      seatSource: row.seatSource && row.seatSource !== "none" ? row.seatSource : prev.seatSource,
    };
  }
  return out;
}

/** 극장·시각·관이 같으면 한 회차. 예약 URL의 스케줄 번호가 달라도 합친다. */
function sameShowtime(a: Showtime, b: Showtime): boolean {
  if (a.theaterId !== b.theaterId || !clocksMatch(a, b) || !hallsMatch(a.hallName, b.hallName)) return false;
  const left = normalizeTitle(a.movieTitle);
  const right = normalizeTitle(b.movieTitle);
  if (left && right && !titlesMatch(a.movieTitle, b.movieTitle)) return false;
  return true;
}

function clocksMatch(a: Showtime, b: Showtime): boolean {
  const left = clockVariants(a.playDate, a.startTime);
  const right = clockVariants(b.playDate, b.startTime);
  if (left.length && right.length) {
    return left.some((x) => right.some((y) => x.playDate === y.playDate && x.startTime === y.startTime));
  }
  return a.playDate === b.playDate && normTime(a.startTime) === normTime(b.startTime);
}

function betterBookingUrl(a: string, b: string): string {
  const score = (url: string) => {
    const u = String(url || "").trim();
    if (!u) return 0;
    if (/megabox\.co\.kr\/booking\/seat\?[^#]*playSchdlNo=|PcntSeatChoi\/selectPcntSeatChoi\.do\?[^#]*playSchdlNo=/i.test(u)) return 100;
    if (/cgv\.co\.kr\/cnm\/movieBook\/(?:movie|cinema)\?[^#]*(?:scnSseq|scnsNo)=/i.test(u) && /movNo=/i.test(u)) return 95;
    if (/cgv\.co\.kr\/cnm\/movieBook\/movie\?[^#]*movNo=/i.test(u)) return 75;
    if (/cgv\.co\.kr\/cnm\/movieBook\/cinema\?/i.test(u)) return 20;
    if (/megabox\.co\.kr\/booking\?/i.test(u)) return 20;
    return 10;
  };
  return score(a) >= score(b) ? String(a || "").trim() : String(b || "").trim();
}
