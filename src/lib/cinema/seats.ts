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

export function mergeShowtimes(
  primary: Showtime[],
  extra: Showtime[] = [],
): Showtime[] {
  if (!extra.length) return primary;
  const keyOf = (row: Showtime) =>
    `${row.theaterId}|${row.playDate}|${normTime(row.startTime)}|${normalizeTitle(row.movieTitle)}|${normalizeTitle(row.hallName)}`;
  const map = new Map<string, Showtime>();
  for (const row of extra) map.set(keyOf(row), row);
  for (const row of primary) {
    const key = keyOf(row);
    const prev = map.get(key);
    if (!prev) {
      map.set(key, row);
      continue;
    }
    map.set(key, {
      ...prev,
      ...row,
      restSeats: row.restSeats ?? prev.restSeats,
      totalSeats: row.totalSeats ?? prev.totalSeats,
      bookingUrl: row.bookingUrl || prev.bookingUrl,
      movieNo: row.movieNo || prev.movieNo,
      seatLive:
        row.restSeats != null ? (row.seatLive ?? true) : prev.seatLive,
      seatCheckedAt: row.seatCheckedAt ?? prev.seatCheckedAt,
    });
  }
  return [...map.values()];
}

export function applyCgvSeatHits(
  rows: Showtime[],
  map: SeatHitMap,
  overwrite = false,
  asLive = true,
): Showtime[] {
  const nowIso = new Date().toISOString();
  const stampKeep = (row: Showtime): Showtime => {
    if (typeof row.restSeats !== "number" || !Number.isFinite(row.restSeats)) {
      return { ...row, seatLive: false };
    }
    return {
      ...row,
      seatLive: row.seatLive ?? true,
      seatCheckedAt: row.seatCheckedAt ?? nowIso,
    };
  };
  const keys = Object.keys(map);
  if (!keys.length) return rows.map(stampKeep);
  return rows.map((row) => {
    const had =
      typeof row.restSeats === "number" && Number.isFinite(row.restSeats);
    if (had && !overwrite) return stampKeep(row);
    const hit = lookupSeatHit(row, map);
    if (!hit) return stampKeep(row);
    return {
      ...row,
      restSeats: hit.rest,
      totalSeats: hit.total ?? row.totalSeats,
      seatLive: asLive,
      seatCheckedAt: asLive
        ? nowIso
        : hit.at
          ? new Date(hit.at).toISOString()
          : row.seatCheckedAt ?? null,
    };
  });
}

export function indexSeatHit(
  map: SeatHitMap,
  row: {
    theaterId: string;
    playDate: string;
    startTime: string;
    movieTitle?: string;
    hallName?: string;
    movieNo?: string;
    chain?: "cgv" | "megabox";
  },
  rec: SeatHit,
) {
  const chain =
    row.chain ?? (String(row.theaterId).startsWith("cgv") ? "cgv" : "megabox");
  for (const key of seatLookupKeys({
    id: "",
    theaterId: row.theaterId as Showtime["theaterId"],
    theaterName: "",
    chain,
    movieTitle: row.movieTitle || "",
    movieNo: row.movieNo || "",
    playDate: row.playDate,
    startTime: row.startTime,
    endTime: null,
    hallName: row.hallName || "",
    formats: [],
    restSeats: rec.rest,
    totalSeats: rec.total,
    bookingUrl: "",
    bookable: true,
  })) {
    map[key] = { ...rec, at: rec.at ?? Date.now() };
  }
}

export function putSeatHit(map: SeatHitMap, row: Showtime) {
  if (typeof row.restSeats !== "number" || !Number.isFinite(row.restSeats)) return;
  if (row.seatLive === false) return;
  indexSeatHit(map, row, {
    rest: row.restSeats,
    total: row.totalSeats,
    at: Date.now(),
  });
}

function packHit(hit: SeatHit): SeatHit {
  return { rest: hit.rest, total: hit.total ?? null, at: hit.at };
}

export function lookupSeatHit(row: Showtime, map: SeatHitMap): SeatHit | null {
  for (const key of seatLookupKeys(row)) {
    const hit = map[key];
    if (hit && typeof hit.rest === "number" && Number.isFinite(hit.rest)) {
      return packHit(hit);
    }
  }
  const siteNo = SITE_NO[row.theaterId] ?? "";
  if (!siteNo) return null;
  const title = normalizeTitle(row.movieTitle);
  const hall = normalizeTitle(row.hallName);
  const tag = row.chain === "cgv" ? "k" : "m";
  for (const clock of clockVariants(row.playDate, row.startTime)) {
    const prefix = `${tag}:${siteNo}|${clock.playDate}|${clock.startTime}|`;
    const cands: SeatHit[] = [];
    for (const [key, hit] of Object.entries(map)) {
      if (!key.startsWith(prefix)) continue;
      if (typeof hit?.rest !== "number" || !Number.isFinite(hit.rest)) continue;
      const suffix = key.slice(prefix.length);
      if (
        !suffix ||
        titlesMatch(suffix, title) ||
        titlesMatch(suffix, hall) ||
        (row.movieNo && suffix === row.movieNo)
      ) {
        if (suffix && (titlesMatch(suffix, title) || suffix === row.movieNo)) {
          return packHit(hit);
        }
        cands.push(hit);
      }
    }
    const named = cands;
    if (named.length === 1) return packHit(named[0]);
  }
  return null;
}

export function seatFreshnessLabel(
  show: Pick<Showtime, "restSeats" | "seatLive" | "seatCheckedAt">,
): string | null {
  if (typeof show.restSeats !== "number" || !Number.isFinite(show.restSeats)) {
    return null;
  }
  if (show.seatLive !== false) return "실시간";
  if (!show.seatCheckedAt) return "마지막 확인";
  const ms = Date.now() - new Date(show.seatCheckedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "마지막 확인";
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `${min}분 전 확인`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours}시간 전 확인`;
  return `${Math.round(hours / 24)}일 전 확인`;
}

export function countSeatHits(rows: Showtime[], map: SeatHitMap): number {
  if (!Object.keys(map).length) return 0;
  return rows.filter((row) => lookupSeatHit(row, map)).length;
}

export function summarizeSeatDelta(before: Showtime[], after: Showtime[]) {
  const gains = listSeatGains(before, after);
  return {
    shows: gains.length,
    seats: gains.reduce((sum, row) => sum + row.added, 0),
    lines: gains.map((row) => {
      return `• ${formatShowPlace(row.show)}에서 ${row.added}석이 추가됐습니다`;
    }),
  };
}

export function listSeatGains(before: Showtime[], after: Showtime[]) {
  const prev = new Map(before.map((row) => [row.id, row.restSeats]));
  const rows: { show: Showtime; added: number }[] = [];
  for (const row of after) {
    if (typeof row.restSeats !== "number") continue;
    if (row.seatLive === false) continue;
    const last = prev.get(row.id);
    let added = 0;
    if (typeof last !== "number") added = row.restSeats;
    else if (row.restSeats > last) added = row.restSeats - last;
    if (added <= 0) continue;
    rows.push({ show: row, added });
  }
  return rows;
}

export function formatClock(time: string) {
  const match = String(time || "").match(/^(\d{1,2}):(\d{2})/);
  if (!match) return time;
  return `${Number(match[1])}시 ${match[2]}분`;
}

export function formatShowPlace(show: {
  theaterName: string;
  chain: "megabox" | "cgv" | string;
  playDate: string;
  startTime: string;
  hallName?: string | null;
}) {
  const chain = show.chain === "cgv" ? "CGV" : "메가박스";
  const name = String(show.theaterName || "")
    .replace(/^메가박스\s*/, "")
    .replace(/^CGV\s*/, "")
    .trim();
  const bits = [
    `${name} ${chain}`.trim(),
    formatPlayDate(show.playDate),
    formatClock(show.startTime),
  ];
  if (show.hallName) bits.push(show.hallName);
  return bits.filter(Boolean).join(" ");
}

export function formatPlayDate(ymd: string) {
  const s = String(ymd || "");
  if (s.length < 8) return s;
  const month = Number(s.slice(4, 6));
  const day = Number(s.slice(6, 8));
  if (!month || !day) return s;
  return `${month}월 ${day}일`;
}

export function showAlertBody(
  show: Showtime,
  _all: Showtime[] = [],
  extra = "",
) {
  const bits = [formatShowPlace(show)];
  if (extra) bits.push(extra);
  return bits.filter(Boolean).join(" · ");
}

function seatLookupKeys(row: Showtime): string[] {
  const titleKey = normalizeTitle(row.movieTitle);
  const siteNo = SITE_NO[row.theaterId] ?? "";
  const prefix = row.chain === "cgv" ? "k:" : "m:";
  const keys = [row.id];
  for (const clock of clockVariants(row.playDate, row.startTime)) {
    const stem = siteNo ? `${prefix}${siteNo}|${clock.playDate}|${clock.startTime}` : "";
    if (!stem) continue;
    for (const hall of hallVariants(row.hallName)) {
      keys.push(`${stem}|${hall}`);
    }
    if (titleKey) keys.push(`${stem}|${titleKey}`);
    if (row.movieNo) keys.push(`${stem}|${row.movieNo}`);
  }
  return [...new Set(keys.filter(Boolean))];
}

function hallVariants(hall: string): string[] {
  const base = normHall(hall);
  const stripped = base.replace(/\[.*?\]/g, "");
  const loose = stripped.replace(/관$/, "");
  const titled = normalizeTitle(hall);
  return [...new Set([base, stripped, loose, `${loose}관`, titled].filter(Boolean))];
}

function clockVariants(playDate: string, startTime: string): { playDate: string; startTime: string }[] {
  const time = parseClock(startTime);
  if (!time) return [];
  const out = [{ playDate, startTime: time.hhmm }];
  if (time.hour >= 24 && playDate.length === 8) {
    out.push({
      playDate: addYmd(playDate, 1),
      startTime: `${String(time.hour - 24).padStart(2, "0")}:${time.minute}`,
    });
    out.push({ playDate, startTime: `${time.hour}:${time.minute}` });
  }
  if (time.hour < 4 && playDate.length === 8) {
    out.push({
      playDate: addYmd(playDate, -1),
      startTime: `${time.hour + 24}:${time.minute}`,
    });
  }
  return out;
}

function parseClock(raw: string): { hour: number; minute: string; hhmm: string } | null {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length < 3) return null;
  const padded = digits.length === 3 ? `0${digits}` : digits.slice(0, 4);
  const hour = Number(padded.slice(0, padded.length - 2));
  const minute = padded.slice(-2);
  if (!Number.isFinite(hour) || Number(minute) > 59) return null;
  const hhmm = `${String(hour % 24).padStart(2, "0")}:${minute}`;
  return { hour, minute, hhmm: hour >= 24 ? `${hour}:${minute}` : hhmm };
}

function addYmd(ymd: string, days: number) {
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(4, 6));
  const d = Number(ymd.slice(6, 8));
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}${String(dt.getUTCMonth() + 1).padStart(2, "0")}${String(dt.getUTCDate()).padStart(2, "0")}`;
}

function normTime(time: string) {
  const parsed = parseClock(time);
  return parsed?.hhmm ?? String(time || "").trim();
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
          (normalizeTitle(s.hallName) === normalizeTitle(item.hallName) ||
            titlesMatch(s.movieTitle, item.movieTitle)),
      ) ??
      shows.find(
        (s) =>
          s.theaterId === item.theaterId &&
          titlesMatch(s.movieTitle, item.movieTitle) &&
          clockVariants(s.playDate, s.startTime).some((c) =>
            clockVariants(item.playDate, item.startTime).some(
              (q) => q.playDate === c.playDate && q.startTime === c.startTime,
            ),
          ),
      );
    if (!show || show.restSeats == null) return item;
    if (show.seatLive === false) return item;
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

export function seatChangeAlert(change: SeatChange, all: Showtime[] = []): AlertItem {
  const sign = change.delta > 0 ? "+" : "";
  return {
    id: `alert:seat:${change.show.id}:${change.prev}:${change.next}:${Date.now()}`,
    createdAt: new Date().toISOString(),
    kind: "seat",
    title: `${change.show.movieTitle} 잔여석 ${sign}${change.delta}`,
    body: showAlertBody(
      change.show,
      all.length ? all : [change.show],
      `${change.prev}석 → ${change.next}석 (${sign}${change.delta})`,
    ),
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

export function notifyBatches(items: AlertItem[], size = 8): AlertItem[][] {
  const out: AlertItem[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function notifyCopy(
  items: AlertItem[],
  opts?: { total?: number },
): {
  subject: string;
  text: string;
  telegramHtml: string;
} {
  const total = opts?.total ?? items.length;
  const seats = items.filter((i) => i.kind === "seat").length;
  const opens = items.length - seats;
  const allSeats = seats === items.length;
  const allOpens = opens === items.length;
  const subject =
    allSeats
      ? `[오픈벨] 잔여석 변동 ${total}건`
      : allOpens
        ? `[오픈벨] 예매 오픈 ${total}건`
        : `[오픈벨] 알림 ${total}건`;
  const text = `${subject}\n\n${items
    .map((a) => {
      const link = a.bookingUrl ? `\n바로 예매 ${a.bookingUrl}` : "";
      return `${a.title}\n${a.body}${link}`;
    })
    .join("\n\n")}`;
  const telegramHtml = `${escapeHtml(subject)}\n\n${items
    .map((a) => {
      const href = escapeAttr(a.bookingUrl);
      const link = href ? `\n<a href="${href}">바로 예매</a>` : "";
      return `<b>${escapeHtml(a.title)}</b>\n${escapeHtml(a.body)}${link}`;
    })
    .join("\n\n")}`;
  return { subject, text, telegramHtml };
}

export function tweetCopy(items: AlertItem[]): string {
  const rows = items.slice(0, 3);
  const lines = ["홀드현알리미"];
  for (const item of rows) {
    lines.push(item.title);
    if (item.body) lines.push(item.body);
    if (item.bookingUrl) lines.push(item.bookingUrl);
  }
  if (items.length > rows.length) {
    lines.push(`외 ${items.length - rows.length}건`);
  }
  const text = lines.filter(Boolean).join("\n");
  return text.length > 270 ? `${text.slice(0, 267)}…` : text;
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
