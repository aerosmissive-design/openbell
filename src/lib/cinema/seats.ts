import { decodeHtml, normalizeTitle } from "@/lib/utils";
import { titlesMatch } from "./match";
import type { AlertItem, BookingIntent, Showtime } from "./types";

export type SeatHit = { rest: number; total: number | null; at?: number; source?: string };
export type SeatHitMap = Record<string, SeatHit>;

const SITE_NO: Record<string, string> = { cgv_yongsan: "0013", cgv_yeongdeungpo: "0059", megabox_coex: "1351", megabox_namyangju: "0019" };
export function describeSeatPing(result: { status: string; count: number; cgvCount: number }): { ok: boolean; text: string } { if (result.status === "ok" && result.count > 0) return { ok: true, text: "잔여석을 붙였습니다." }; if (result.status === "timeout") return { ok: false, text: "잔여석 응답이 늦습니다. 잠시 뒤 다시 누르세요." }; if (result.status === "denied") return { ok: false, text: "구글이 막았습니다. 웹앱 액세스가 '모든 사용자'인지 보세요." }; if (result.status === "badurl") return { ok: false, text: "구글 웹앱 주소가 올바르지 않습니다. /exec 로 끝나는 주소를 붙여넣으세요." }; return { ok: false, text: "잔여석을 받지 못했습니다. 잠시 뒤 다시 눌러 보세요." }; }
export function mergeShowtimes(primary: Showtime[], extra: Showtime[] = []): Showtime[] {
  if (!extra.length) return primary;
  const out = [...extra];
  for (const row of primary) {
    const index = out.findIndex((candidate) => sameShowtime(row, candidate));
    if (index < 0) { out.push(row); continue; }
    const prev = out[index];
    out[index] = { ...prev, ...row, restSeats: row.restSeats ?? prev.restSeats, totalSeats: row.totalSeats ?? prev.totalSeats, bookingUrl: betterBookingUrl(row.bookingUrl, prev.bookingUrl), movieNo: row.movieNo || prev.movieNo, seatLive: row.restSeats != null ? (row.seatLive ?? true) : prev.seatLive, seatCheckedAt: row.seatCheckedAt ?? prev.seatCheckedAt, seatSource: row.seatSource && row.seatSource !== "none" ? row.seatSource : prev.seatSource };
  }
  return out;
}
export function sameShowtime(a: Showtime, b: Showtime): boolean {
  if (a.theaterId !== b.theaterId) return false;
  if (canonDate(a.playDate) !== canonDate(b.playDate)) return false;
  if (normTime(a.startTime) !== normTime(b.startTime)) return false;
  const ai = stableShowtimeId(a), bi = stableShowtimeId(b);
  if (ai && bi && ai === bi) return true;
  if (!hallsCompatible(a.hallName, b.hallName)) return false;
  if (a.movieNo && b.movieNo) return a.movieNo === b.movieNo;
  return titlesMatch(a.movieTitle, b.movieTitle);
}
export function dedupeShowtimes(rows: Showtime[]): Showtime[] {
  const out: Showtime[] = [];
  for (const row of rows) {
    const index = out.findIndex((candidate) => sameShowtime(row, candidate));
    if (index < 0) { out.push(row); continue; }
    const prev = out[index];
    out[index] = { ...prev, ...row, restSeats: row.restSeats ?? prev.restSeats, totalSeats: row.totalSeats ?? prev.totalSeats, bookingUrl: betterBookingUrl(row.bookingUrl, prev.bookingUrl), movieNo: row.movieNo || prev.movieNo, hallName: row.hallName || prev.hallName, seatLive: row.restSeats != null ? (row.seatLive ?? true) : prev.seatLive, seatCheckedAt: row.seatCheckedAt ?? prev.seatCheckedAt, seatSource: row.seatSource && row.seatSource !== "none" ? row.seatSource : prev.seatSource };
  }
  return out;
}
function canonDate(value: string) { const digits = String(value || "").replace(/\D/g, ""); return digits.length >= 8 ? digits.slice(0, 8) : String(value || "").trim(); }
function hallsCompatible(a: string, b: string) { if (!String(a || "").trim() || !String(b || "").trim()) return true; return hallsMatch(a, b); }
function stableShowtimeId(row: Showtime): string {
  const url = String(row.bookingUrl || "");
  const mega = url.match(/[?&]playSchdlNo=([^&#]+)/i)?.[1]; if (mega) return `mega:${decodeURIComponent(mega)}`;
  const cgv = url.match(/[?&](?:scnSseq|scnsNo)=([^&#]+)/i)?.[1]; if (cgv) return `cgv:${decodeURIComponent(cgv)}`;
  return row.movieNo ? `movie:${row.movieNo}` : "";
}
function betterBookingUrl(a: string, b: string): string { const score = (url: string) => { const u = String(url || "").trim(); if (!u) return 0; if (/megabox\.co\.kr\/booking\/seat\?[^#]*playSchdlNo=|PcntSeatChoi\/selectPcntSeatChoi\.do\?[^#]*playSchdlNo=/i.test(u)) return 100; if (/cgv\.co\.kr\/cnm\/movieBook\/(?:movie|cinema)\?[^#]*(?:scnSseq|scnsNo)=/i.test(u) && /movNo=/i.test(u)) return 95; if (/cgv\.co\.kr\/cnm\/movieBook\/movie\?[^#]*movNo=/i.test(u)) return 75; if (/cgv\.co\.kr\/cnm\/movieBook\/cinema\?/i.test(u)) return 20; if (/megabox\.co\.kr\/booking\?/i.test(u)) return 20; return 10; }; return score(a) >= score(b) ? String(a || "").trim() : String(b || "").trim(); }
