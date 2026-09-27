import { decodeHtml, normalizeTitle } from "@/lib/utils";
import { titlesMatch } from "./match";
import type { AlertItem, BookingIntent, Showtime } from "./types";
import { clockVariants, hallsMatch } from "./seats-lookup";
import { showAlertBody } from "./seats-status";
export type SeatChange = { itemId: string; show: Showtime; prev: number; next: number; delta: number };
export function diffStarSeats(queue: BookingIntent[], shows: Showtime[]): { nextQueue: BookingIntent[]; changes: SeatChange[] } { const byId = new Map(shows.map((s) => [s.id, s])); const changes: SeatChange[] = []; const nextQueue = queue.map((item) => { const show = byId.get(item.showtimeId) ?? shows.find((s) => s.theaterId === item.theaterId && s.playDate === item.playDate && s.startTime === item.startTime && normalizeTitle(s.hallName) === normalizeTitle(item.hallName)) ?? shows.find((s) => s.theaterId === item.theaterId && titlesMatch(s.movieTitle, item.movieTitle) && clockVariants(s.playDate, s.startTime).some((c) => clockVariants(item.playDate, item.startTime).some((q) => q.playDate === c.playDate && q.startTime === c.startTime && hallsMatch(s.hallName, item.hallName)))); if (!show || show.restSeats == null || show.seatLive === false) return item; const prev = item.restSeats; if (typeof prev === "number" && prev !== show.restSeats) changes.push({ itemId: item.id, show, prev, next: show.restSeats, delta: show.restSeats - prev }); if (prev !== show.restSeats || item.totalSeats !== show.totalSeats) return { ...item, restSeats: show.restSeats, totalSeats: show.totalSeats, bookingUrl: show.bookingUrl || item.bookingUrl }; return item; }); return { nextQueue, changes }; }
export function seatChangeAlert(change: SeatChange, all: Showtime[] = []): AlertItem { const sign = change.delta > 0 ? "+" : ""; return { id: `alert:seat:${change.show.id}:${change.prev}:${change.next}:${Date.now()}`, createdAt: new Date().toISOString(), kind: "seat", title: `${change.show.movieTitle} 잔여석 ${sign}${change.delta}`, body: showAlertBody(change.show, all.length ? all : [change.show], `${change.prev}석 → ${change.next}석 (${sign}${change.delta})`), bookingUrl: change.show.bookingUrl, theaterId: change.show.theaterId, movieTitle: change.show.movieTitle, playDate: change.show.playDate, startTime: change.show.startTime, hallName: change.show.hallName, formats: change.show.formats, restSeats: change.next, totalSeats: change.show.totalSeats, seatSource: change.show.seatSource }; }
export function notifyBatches(items: AlertItem[], size = 8): AlertItem[][] { const out: AlertItem[][] = []; for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size)); return out; }
export function alertBookingUrl(item: AlertItem): string { if (item.bookingUrl?.trim()) return item.bookingUrl.trim(); if (item.theaterId === "cgv_yongsan") return `https://cgv.co.kr/cnm/movieBook/cinema?siteNm=%EC%9A%A9%EC%82%B0%EC%95%84%EC%9D%B4%ED%8C%8C%ED%81%B4%EB%AA%B0&siteNo=0013&date=${String(item.playDate || "").replace(/-/g, "")}`; if (item.theaterId === "cgv_yeongdeungpo") return `https://cgv.co.kr/cnm/movieBook/cinema?siteNm=%EC%98%81%EB%93%B1%ED%8F%AC%ED%83%80%EC%9E%84%EC%8A%A4%ED%80%98%EC%96%B4&siteNo=0059&date=${String(item.playDate || "").replace(/-/g, "")}`; if (String(item.theaterId || "").startsWith("megabox")) return "https://www.megabox.co.kr/booking"; return ""; }
export function notifyCopy(items: AlertItem[], opts?: { total?: number }): { subject: string; text: string; telegramHtml: string } { const total = opts?.total ?? items.length; const seats = items.filter((i) => i.kind === "seat").length; const opens = items.length - seats; const allSeats = seats === items.length; const allOpens = opens === items.length; const subject = allSeats ? `[오픈벨] 잔여석 변동 ${total}건` : allOpens ? `[오픈벨] 예매 오픈 ${total}건` : `[오픈벨] 알림 ${total}건`; const rawText = `${subject}\n\n${items.map((a) => { const url = alertBookingUrl(a); const link = url ? `\n바로 예매 ${url}` : ""; return `${decodeHtml(a.title)}\n${decodeHtml(a.body)}${link}`; }).join("\n\n")}`; const text = rawText; const telegramHtml = items.map((a) => { const url = alertBookingUrl(a); const link = url ? `\n<a href=\"${url}\">바로 예매</a>` : ""; return `<b>${escapeHtml(decodeHtml(a.title))}</b>\n${escapeHtml(decodeHtml(a.body))}${link}`; }).join("\n\n"); return { subject, text, telegramHtml }; }
export function escapeHtml(value: string) {
  return String(value || "")
    .replace(/&/g, "&" + "amp;")
    .replace(/"/g, "&" + "quot;")
    .replace(/</g, "&" + "lt;")
    .replace(/>/g, "&" + "gt;");
}
export function escapeAttr(value: string) {
  return String(value || "")
    .replace(/&/g, "&" + "amp;")
    .replace(/"/g, "&" + "quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&" + "lt;");
}
