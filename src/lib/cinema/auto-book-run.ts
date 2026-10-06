import { normalizeTitle } from "@/lib/utils";
import type { AutoMovie, AutoShow } from "@/lib/auto-book-store";
import { movieAutoSeats } from "@/lib/auto-book-store";
import type { Showtime, TheaterId } from "./types";
import { titlesMatch } from "./match";
import { hallsMatch, normTime } from "./seats-lookup";
import { preferredSeatHints } from "./golden-rows";

const THEATER_IDS = new Set<TheaterId>([
  "megabox_coex",
  "megabox_namyangju",
  "cgv_yongsan",
  "cgv_yeongdeungpo",
]);

export function sanitizeAutoMovies(raw: unknown): AutoMovie[] {
  if (!Array.isArray(raw)) return [];
  const out: AutoMovie[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const title = String((row as AutoMovie).title || "").trim();
    if (!normalizeTitle(title)) continue;
    const seats = Math.min(8, Math.max(1, Math.round(Number((row as AutoMovie).seats) || 1)));
    out.push({ title, seats });
  }
  return out.slice(-24);
}

export function sanitizeAutoShows(raw: unknown): AutoShow[] {
  if (!Array.isArray(raw)) return [];
  const out: AutoShow[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const show = row as AutoShow;
    const title = String(show.title || "").trim();
    const id = String(show.id || "").trim();
    const theaterId = String(show.theaterId || "") as TheaterId;
    if (!id || !normalizeTitle(title) || !THEATER_IDS.has(theaterId)) continue;
    const seats = Math.min(8, Math.max(1, Math.round(Number(show.seats) || 1)));
    out.push({
      id,
      title,
      theaterId,
      playDate: String(show.playDate || ""),
      startTime: String(show.startTime || ""),
      hallName: String(show.hallName || ""),
      bookingUrl: String(show.bookingUrl || ""),
      seats,
    });
  }
  return out.slice(0, 40);
}

export function sanitizeAutoFired(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!key || typeof value !== "string") continue;
    out[key] = value.slice(0, 40);
  }
  return out;
}

export function mergeAutoMovies(remote: AutoMovie[], local: AutoMovie[]): AutoMovie[] {
  const map = new Map<string, AutoMovie>();
  for (const row of [...sanitizeAutoMovies(remote), ...sanitizeAutoMovies(local)]) {
    map.set(normalizeTitle(row.title), row);
  }
  return [...map.values()].slice(-24);
}

export function mergeAutoShows(remote: AutoShow[], local: AutoShow[]): AutoShow[] {
  const map = new Map<string, AutoShow>();
  for (const row of [...sanitizeAutoShows(remote), ...sanitizeAutoShows(local)]) {
    map.set(row.id, row);
  }
  return [...map.values()].slice(0, 40);
}

export type AutoJob = {
  key: string;
  show: Showtime;
  seats: number;
  preferredSeats: string[];
  reason: "open" | "seats";
};

/**
 * 영화 목록에 남아 있으면, 아직 작업하지 않은 회차는 지금 떠 있는 것도
 * 나중에 열리는 것도 한 번씩 넣는다. 이미 넣은 회차는 다시 넣지 않는다.
 * 회차 목록에 있으면 그 회차가 살아 있을 때 한 번, 잔여석이 바뀌면 다시 잡는다.
 * 결제는 호출하지 않는다.
 * armMovies, armShows, knownShowIds 는 예전 호출부를 유지하기 위한 인자다.
 */
export function planAutoBook(input: {
  live: Showtime[];
  movies: AutoMovie[];
  autoShows: AutoShow[];
  fired: Record<string, string>;
  armMovies: Set<string>;
  armShows: Set<string>;
  knownShowIds?: Set<string>;
}): { jobs: AutoJob[]; fired: Record<string, string> } {
  const next = { ...input.fired };
  const jobs: AutoJob[] = [];
  void input.armMovies;
  void input.armShows;
  void input.knownShowIds;

  for (const show of input.live) {
    const seats = movieAutoSeats(show.movieTitle, input.movies);
    if (seats == null) continue;
    const key = `m:${normalizeTitle(show.movieTitle)}:${show.id}`;
    if (next[key]) continue;
    if (!show.bookingUrl) continue;
    next[key] = "open";
    jobs.push({
      key,
      show,
      seats,
      preferredSeats: preferredSeatHints(show.theaterId, seats),
      reason: "open",
    });
  }

  for (const row of input.autoShows) {
    const live = input.live.find((show) => sameAutoShow(row, show));
    if (!live) continue;
    const bookingUrl = live.bookingUrl || row.bookingUrl;
    if (!bookingUrl) continue;
    const sig = live.restSeats == null ? "na" : String(live.restSeats);
    const key = `s:${row.id}`;
    const prev = input.fired[key];
    if (prev === sig) {
      next[key] = sig;
      continue;
    }
    const changed = prev != null && prev !== sig && sig !== "na";
    if (prev != null && !changed) continue;
    next[key] = sig;
    jobs.push({
      key,
      show: { ...live, bookingUrl },
      seats: row.seats,
      preferredSeats: preferredSeatHints(live.theaterId, row.seats),
      reason: changed ? "seats" : "open",
    });
  }

  return { jobs, fired: trimFired(next) };
}

function sameAutoShow(row: AutoShow, show: Showtime): boolean {
  if (row.id && row.id === show.id) return true;
  if (row.theaterId !== show.theaterId || row.playDate !== show.playDate) return false;
  if (normTime(row.startTime) !== normTime(show.startTime)) return false;
  if (!hallsMatch(row.hallName, show.hallName)) return false;
  return titlesMatch(row.title, show.movieTitle);
}

function trimFired(fired: Record<string, string>): Record<string, string> {
  const keys = Object.keys(fired);
  if (keys.length <= 300) return fired;
  return Object.fromEntries(keys.slice(-300).map((key) => [key, fired[key]!]));
}
