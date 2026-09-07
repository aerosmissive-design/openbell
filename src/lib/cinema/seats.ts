import { normalizeTitle } from "@/lib/utils";
import { titlesMatch } from "./match";
import type { AlertItem, BookingIntent, Showtime } from "./types";

export type SeatHit = { rest: number; total: number | null };
export type SeatHitMap = Record<string, SeatHit>;

const SITE_NO: Record<string, string> = {
  cgv_yongsan: "0013",
  cgv_yeongdeungpo: "0059",
  megabox_coex: "1351",
  megabox_namyangju: "0019",
};

export function describeSeatPing(result: {
  status: string;
  count: number;
  cgvCount: number;
}): { ok: boolean; text: string } {
  if (result.status === "ok" && result.count > 0) {
    return { ok: true, text: "잔여석을 붙였습니다." };
  }
  if (result.status === "timeout") {
    return {
      ok: false,
      text: "잔여석 응답이 늦습니다. 잠시 뒤 다시 누르세요.",
    };
  }
  if (result.status === "denied") {
    return {
      ok: false,
      text: "구글이 막았습니다. 웹앱 액세스가 '모든 사용자'인지 보세요.",
    };
  }
  if (result.status === "badurl") {
    return {
      ok: false,
      text: "웹앱 주소가 올바르지 않습니다. /exec 로 끝나는 주소를 붙여넣으세요.",
    };
  }
  return {
    ok: false,
    text: "잔여석을 받지 못했습니다. 잠시 뒤 다시 눌러 보세요.",
  };
}

export function applyCgvSeatHits(
  rows: Showtime[],
  map: SeatHitMap,
  overwrite = false,
): Showtime[] {
  const keys = Object.keys(map);
  if (!keys.length) return rows;
  return rows.map((row) => {
    if (row.restSeats != null && !overwrite) return row;
    const hit = lookupSeatHit(row, map);
    if (!hit) return row;
    return {
      ...row,
      restSeats: hit.rest,
      totalSeats: hit.total ?? row.totalSeats,
    };
  });
}

export function putSeatHit(map: SeatHitMap, row: Showtime) {
  if (typeof row.restSeats !== "number" || !Number.isFinite(row.restSeats)) return;
  const rec: SeatHit = { rest: row.restSeats, total: row.totalSeats };
  for (const key of seatLookupKeys(row)) map[key] = rec;
}

function lookupSeatHit(row: Showtime, map: SeatHitMap): SeatHit | null {
  for (const key of seatLookupKeys(row)) {
    const hit = map[key];
    if (hit && typeof hit.rest === "number" && Number.isFinite(hit.rest)) {
      return { rest: hit.rest, total: hit.total ?? null };
    }
  }
  const siteNo = SITE_NO[row.theaterId] ?? "";
  if (!siteNo) return null;
  const prefix = `${row.chain === "cgv" ? "k" : "m"}:${siteNo}|${row.playDate}|${normTime(row.startTime)}|`;
  const title = normalizeTitle(row.movieTitle);
  for (const [key, hit] of Object.entries(map)) {
    if (!key.startsWith(prefix)) continue;
    if (typeof hit?.rest !== "number" || !Number.isFinite(hit.rest)) continue;
    const suffix = key.slice(prefix.length);
    if (!suffix) continue;
    if (titlesMatch(suffix, title) || titlesMatch(suffix, row.hallName)) {
      return { rest: hit.rest, total: hit.total ?? null };
    }
  }
  return null;
}

export function countSeatHits(rows: Showtime[], map: SeatHitMap): number {
  if (!Object.keys(map).length) return 0;
  return rows.filter((row) => lookupSeatHit(row, map)).length;
}

function seatLookupKeys(row: Showtime): string[] {
  const time = normTime(row.startTime);
  const titleKey = normalizeTitle(row.movieTitle);
  const siteNo = SITE_NO[row.theaterId] ?? "";
  const prefix = row.chain === "cgv" ? "k:" : "m:";
  const keys = [row.id];
  for (const hall of hallVariants(row.hallName)) {
    if (siteNo) keys.push(`${prefix}${siteNo}|${row.playDate}|${time}|${hall}`);
  }
  if (siteNo && titleKey) {
    keys.push(`${prefix}${siteNo}|${row.playDate}|${time}|${titleKey}`);
  }
  if (siteNo && row.movieNo) {
    keys.push(`${prefix}${siteNo}|${row.playDate}|${time}|${row.movieNo}`);
  }
  if (siteNo) keys.push(`${prefix}${siteNo}|${row.playDate}|${time}`);
  return keys;
}

function hallVariants(hall: string): string[] {
  const base = normHall(hall);
  const stripped = base.replace(/\[.*?\]/g, "");
  const loose = stripped.replace(/관$/, "");
  return [...new Set([base, stripped, loose, `${loose}관`].filter(Boolean))];
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

export type SeatChange = {
  itemId: string;
  show: Showtime;
  prev: number;
  next: number;
  delta: number;
};

export function diffStarSeats(
  queue: BookingIntent[],
  shows: Showtime[],
): { nextQueue: BookingIntent[]; changes: SeatChange[] } {
  const byId = new Map(shows.map((s) => [s.id, s]));
  const changes: SeatChange[] = [];
  const nextQueue = queue.map((item) => {
    const show =
      byId.get(item.showtimeId) ??
      shows.find(
        (s) =>
          s.theaterId === item.theaterId &&
          s.playDate === item.playDate &&
          s.startTime === item.startTime &&
          normalizeTitle(s.hallName) === normalizeTitle(item.hallName),
      );
    if (!show || show.restSeats == null) return item;
    const prev = item.restSeats;
    if (typeof prev === "number" && prev !== show.restSeats) {
      changes.push({
        itemId: item.id,
        show,
        prev,
        next: show.restSeats,
        delta: show.restSeats - prev,
      });
    }
    if (prev !== show.restSeats || item.totalSeats !== show.totalSeats) {
      return {
        ...item,
        restSeats: show.restSeats,
        totalSeats: show.totalSeats,
        bookingUrl: show.bookingUrl || item.bookingUrl,
      };
    }
    return item;
  });
  return { nextQueue, changes };
}

export function seatChangeAlert(change: SeatChange): AlertItem {
  const sign = change.delta > 0 ? "+" : "";
  return {
    id: `alert:seat:${change.show.id}:${change.prev}:${change.next}:${Date.now()}`,
    createdAt: new Date().toISOString(),
    kind: "seat",
    title: `${change.show.movieTitle} 잔여석 ${sign}${change.delta}`,
    body: `${change.show.theaterName} · ${change.show.hallName} · ${change.show.startTime} · ${change.prev}석 → ${change.next}석 (${sign}${change.delta})`,
    bookingUrl: change.show.bookingUrl,
    theaterId: change.show.theaterId,
    movieTitle: change.show.movieTitle,
    playDate: change.show.playDate,
    startTime: change.show.startTime,
    hallName: change.show.hallName,
    formats: change.show.formats,
    restSeats: change.next,
    totalSeats: change.show.totalSeats,
  };
}

export function notifyCopy(items: AlertItem[]): {
  subject: string;
  text: string;
  telegramHtml: string;
} {
  const seats = items.filter((i) => i.kind === "seat").length;
  const opens = items.length - seats;
  const subject =
    seats && !opens
      ? `[오픈벨] 잔여석 변동 ${seats}건`
      : opens && !seats
        ? `[오픈벨] ${opens}건 오픈`
        : `[오픈벨] 알림 ${items.length}건`;
  const rows = items.slice(0, 8);
  const text = `${subject}\n\n${rows
    .map((a) => `· ${a.title}\n  ${a.body}`)
    .join("\n\n")}`;
  const telegramHtml = `${escapeHtml(subject)}\n\n${rows
    .map((a) => {
      const href = escapeAttr(a.bookingUrl);
      return `<b>${escapeHtml(a.title)}</b>\n${escapeHtml(a.body)}\n<a href="${href}">바로 예매</a>`;
    })
    .join("\n\n")}`;
  return { subject, text, telegramHtml };
}

export function escapeHtml(value: string) {
  return String(value || "")
    .replace(/&/g, "&" + "amp;")
    .replace(/</g, "&" + "lt;")
    .replace(/>/g, "&" + "gt;");
}

export function escapeAttr(value: string) {
  return String(value || "")
    .replace(/&/g, "&" + "amp;")
    .replace(/"/g, "&" + "quot;")
    .replace(/</g, "&" + "lt;");
}
