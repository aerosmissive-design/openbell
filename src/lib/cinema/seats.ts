import { normalizeTitle } from "@/lib/utils";
import type { Showtime } from "./types";

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
  return null;
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
