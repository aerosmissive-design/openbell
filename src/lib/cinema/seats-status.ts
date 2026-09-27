import type { Showtime } from "./types";
import { lookupSeatHit, type SeatHitMap } from "./seats-lookup";
export function formatSeatCheckedAt(iso?: string | null): string | null {
  if (!iso) return null;
  const checked = new Date(iso);
  if (!Number.isFinite(checked.getTime())) return null;
  const parts = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(checked);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${Number(get("month"))}.${Number(get("day"))}일 ${get("hour")}:${get("minute")} 조회`;
}
export function latestSeatArrival(times?: Record<string, string> | null): { source: string; at: string } | null {
  if (!times) return null;
  let source = "";
  let at = "";
  let best = 0;
  for (const [key, value] of Object.entries(times)) {
    if (!key || key === "none" || !value) continue;
    const ms = new Date(value).getTime();
    if (!Number.isFinite(ms)) continue;
    if (ms >= best) { best = ms; source = key; at = value; }
  }
  return at ? { source, at } : null;
}
export function seatStatusLine(
  show: Pick<Showtime, "seatCheckedAt" | "seatSource" | "theaterId">,
  theaterTimes?: Record<string, string> | null,
): string {
  let source = show.seatSource && show.seatSource !== "none" ? show.seatSource : "";
  let at = show.seatCheckedAt || "";
  if (theaterTimes && source && !at) {
    const match = pickTheaterTimeForSource(theaterTimes, source);
    if (match) at = match;
  }
  if ((!source || !at) && theaterTimes) {
    const latest = latestSeatArrival(theaterTimes);
    if (latest) {
      if (!source) source = latest.source;
      if (!at) at = latest.at;
    }
  }
  const sourceText = lazySeatSourceLabel(source || "none");
  const timeText = formatSeatCheckedAt(at);
  if (sourceText === "없음" && !timeText) return "잔여석 출처 없음";
  if (sourceText === "없음") return `${timeText} · 출처 없음`;
  if (!timeText) return `${sourceText} · 조회시각 없음`;
  return `${timeText} · ${sourceText}`;
}
function pickTheaterTimeForSource(
  times: Record<string, string>,
  source: string,
): string | null {
  const aliases = sourceTimeAliases(source);
  let best = "";
  let bestMs = 0;
  for (const [key, value] of Object.entries(times)) {
    if (!value || !aliases.has(String(key).toLowerCase())) continue;
    const ms = new Date(value).getTime();
    if (!Number.isFinite(ms)) continue;
    if (ms >= bestMs) {
      bestMs = ms;
      best = value;
    }
  }
  return best || null;
}
function sourceTimeAliases(source: string): Set<string> {
  const s = String(source || "").toLowerCase();
  const out = new Set<string>([s]);
  if (s === "cgv-kt" || s === "kt") { out.add("cgv-kt"); out.add("kt"); }
  if (s === "cgv-relay" || s === "relay") { out.add("cgv-relay"); out.add("relay"); }
  if (s === "mega-mobile") out.add("mega-mobile");
  if (s === "gas-cache" || s === "gas") { out.add("gas-cache"); out.add("gas"); }
  if (s === "official" || s === "megabox" || s === "cgv") {
    out.add("official"); out.add("megabox"); out.add("cgv");
  }
  if (s === "g-pc" || s === "pc" || s === "nas-report") {
    out.add("g-pc"); out.add("pc"); out.add("nas-report");
  }
  if (s === "g-nas423+" || s === "g-ds423+" || s === "nas423" || s === "nas423+" || s === "ds423" || s === "ds423+" || s === "g-nas" || s === "nas") {
    out.add("g-nas423+"); out.add("g-ds423+"); out.add("nas423"); out.add("nas423+"); out.add("ds423"); out.add("g-nas");
  }
  if (s === "g-nas225+" || s === "g-ds225+" || s === "nas225" || s === "nas225+" || s === "ds225" || s === "ds225+") {
    out.add("g-nas225+"); out.add("g-ds225+"); out.add("nas225"); out.add("nas225+"); out.add("ds225");
  }
  return out;
}
function lazySeatSourceLabel(source?: string) {
  if (!source || source === "none") return "없음";
  if (source === "official" || source === "megabox" || source === "cgv") return "공홈";
  if (source === "g-pc" || source === "pc" || source === "nas-report") return "G_PC";
  if (source === "g-nas225+" || source === "g-ds225+" || source === "nas225" || source === "nas225+" || source === "ds225" || source === "ds225+") return "G_DS225+";
  if (source === "g-nas423+" || source === "g-ds423+" || source === "nas423" || source === "nas423+" || source === "ds423" || source === "ds423+") return "G_DS423+";
  if (source === "nas" || source === "g-nas") return "G_DS423+";
  if (source === "cgv-relay" || source === "relay") return "CGV 우회조회";
  if (source === "cgv-kt" || source === "kt") return "KT 우회조회";
  if (source === "mega-mobile") return "메가 우회조회";
  if (source === "gas-cache" || source === "gas") return "GAS";
  if (source === "naver") return "네이버";
  if (source === "yong-imax" || source === "yongsan-imax" || source === "imax-channel") return "용아맥채널";
  if (source === "last-known") return "마지막 확인";
  return source;
}
export function seatFreshnessLabel(show: Pick<Showtime, "restSeats" | "seatLive" | "seatCheckedAt" | "seatSource" | "theaterId">, theaterTimes?: Record<string, string> | null): string | null {
  return seatStatusLine(show, theaterTimes);
}
export function countSeatHits(rows: Showtime[], map: SeatHitMap): number { if (!Object.keys(map).length) return 0; return rows.filter((row) => lookupSeatHit(row, map)).length; }
export function summarizeSeatDelta(before: Showtime[], after: Showtime[]) { const gains = listSeatGains(before, after); return { shows: gains.length, seats: gains.reduce((sum, row) => sum + row.added, 0), lines: gains.map((row) => `• ${formatShowPlace(row.show)}에서 ${row.added}석이 추가됐습니다`) }; }
export function listSeatGains(before: Showtime[], after: Showtime[]) { const prev = new Map(before.map((row) => [row.id, row.restSeats])); const rows: { show: Showtime; added: number }[] = []; for (const row of after) { if (typeof row.restSeats !== "number") continue; if (row.seatLive === false) continue; const last = prev.get(row.id); let added = 0; if (typeof last !== "number") added = row.restSeats; else if (row.restSeats > last) added = row.restSeats - last; if (added <= 0) continue; rows.push({ show: row, added }); } return rows; }
export function formatClock(time: string) { const match = String(time || "").match(/^(\d{1,2}):(\d{2})/); if (!match) return time; return `${Number(match[1])}시 ${match[2]}분`; }
export function formatShowPlace(show: { theaterName: string; chain: "megabox" | "cgv" | string; playDate: string; startTime: string; hallName?: string | null }) { const chain = show.chain === "cgv" ? "CGV" : "메가박스"; const name = String(show.theaterName || "").replace(/^메가박스\s*/, "").replace(/^CGV\s*/, "").trim(); return [`${name} ${chain}`.trim(), formatPlayDate(show.playDate), formatClock(show.startTime), show.hallName].filter(Boolean).join(" "); }
export function formatPlayDate(ymd: string) { const s = String(ymd || ""); if (s.length < 8) return s; const month = Number(s.slice(4, 6)); const day = Number(s.slice(6, 8)); if (!month || !day) return s; return `${month}월 ${day}일`; }
export function showAlertBody(show: Showtime, _all: Showtime[] = [], extra = "") { return [formatShowPlace(show), extra].filter(Boolean).join(" · "); }
