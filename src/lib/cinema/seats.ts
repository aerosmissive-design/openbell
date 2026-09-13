import { normalizeTitle } from "@/lib/utils";
import { titlesMatch } from "./match";
import type { AlertItem, BookingIntent, Showtime } from "./types";

export type SeatHit = { rest: number; total: number | null; at?: number };
export type SeatHitMap = Record<string, SeatHit>;

const SITE_NO: Record<string, string> = {
  cgv_yongsan: "0013",
  cgv_yeongdeungpo: "0059",
  megabox_coex: "1351",
  megabox_namyangju: "0019",
};

export function applyCgvSeatHits(
  rows: Showtime[],
  map: SeatHitMap,
  overwrite = false,
): Showtime[] {
  const nowIso = new Date().toISOString();
  return rows.map((row) => {
    const live = typeof row.restSeats === "number" && Number.isFinite(row.restSeats);
    if (live) {
      return { ...row, seatLive: true, seatCheckedAt: row.seatCheckedAt ?? nowIso };
    }
    const hit = lookupSeatHit(row, map);
    if (!hit) return { ...row, seatLive: false };
    return {
      ...row,
      restSeats: hit.rest,
      totalSeats: hit.total ?? row.totalSeats,
      seatLive: false,
      seatCheckedAt: hit.at ? new Date(hit.at).toISOString() : null,
    };
  });
}

export function putSeatHit(map: SeatHitMap, row: Showtime) {
  if (typeof row.restSeats !== "number" || !Number.isFinite(row.restSeats)) return;
  if (row.seatLive === false) return;
  map[row.id] = { rest: row.restSeats, total: row.totalSeats, at: Date.now() };
}

export function lookupSeatHit(row: Showtime, map: SeatHitMap): SeatHit | null {
  const hit = map[row.id];
  if (hit && typeof hit.rest === "number") return hit;
  return null;
}

export function mergeShowtimes(primary: Showtime[], extra: Showtime[] = []): Showtime[] {
  if (!extra.length) return primary;
  const keyOf = (row: Showtime) =>
    `${row.theaterId}|${row.playDate}|${row.startTime}|${row.movieTitle}|${row.hallName}`;
  const map = new Map<string, Showtime>();
  for (const row of extra) map.set(keyOf(row), row);
  for (const row of primary) {
    const prev = map.get(keyOf(row));
    map.set(keyOf(row), prev ? { ...prev, ...row, restSeats: row.restSeats ?? prev.restSeats, totalSeats: row.totalSeats ?? prev.totalSeats } : row);
  }
  return [...map.values()];
}

export function describeSeatPing(result: { status: string; count: number; cgvCount: number }) {
  return { ok: result.status === "ok" && result.count > 0, text: result.status === "ok" ? "잔여석을 붙였습니다." : "잔여석을 받지 못했습니다." };
}

export function indexSeatHit(map: SeatHitMap, row: Showtime, rec: SeatHit) {
  map[row.id] = rec;
}

export function countSeatHits(rows: Showtime[], map: SeatHitMap) {
  return rows.filter((row) => lookupSeatHit(row, map)).length;
}

export function listSeatGains(before: Showtime[], after: Showtime[]) {
  return [] as { show: Showtime; added: number }[];
}

export function summarizeSeatDelta(before: Showtime[], after: Showtime[]) {
  return { shows: 0, seats: 0, lines: [] as string[] };
}

export function formatClock(time: string) {
  return time;
}

export function formatShowPlace(show: { theaterName: string; playDate: string; startTime: string }) {
  return `${show.theaterName} ${show.playDate} ${show.startTime}`;
}

export function formatPlayDate(ymd: string) {
  return ymd;
}

export function showAlertBody(show: Showtime, _all: Showtime[] = [], extra = "") {
  return extra ? `${show.movieTitle} · ${extra}` : show.movieTitle;
}

export type SeatChange = { itemId: string; show: Showtime; prev: number; next: number; delta: number };

export function diffStarSeats(queue: BookingIntent[], shows: Showtime[]) {
  return { nextQueue: queue, changes: [] as SeatChange[] };
}

export function seatChangeAlert(change: SeatChange): AlertItem {
  return {
    id: `alert:seat:${change.show.id}`,
    createdAt: new Date().toISOString(),
    kind: "seat",
    title: change.show.movieTitle,
    body: "",
    bookingUrl: change.show.bookingUrl,
    theaterId: change.show.theaterId,
    movieTitle: change.show.movieTitle,
    playDate: change.show.playDate,
    startTime: change.show.startTime,
    hallName: change.show.hallName,
    formats: change.show.formats,
    restSeats: change.next,
  };
}

export function notifyBatches(items: AlertItem[], size = 8) {
  const out: AlertItem[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function notifyCopy(items: AlertItem[]) {
  return { subject: "[오픈벨]", text: "", telegramHtml: "" };
}

export function tweetCopy(items: AlertItem[]) {
  return items[0]?.title ?? "";
}

export function escapeHtml(value: string) {
  return value;
}

export function escapeAttr(value: string) {
  return value;
}
