import { normalizeTitle } from "@/lib/utils";
import type { AutoMovie, AutoShow } from "@/lib/auto-book-store";
import { movieAutoSeats } from "@/lib/auto-book-store";
import type { Showtime } from "./types";
import { titlesMatch } from "./match";
import { hallsMatch, normTime } from "./seats-lookup";
import { preferredSeatHints } from "./golden-rows";

export type AutoJob = {
  key: string;
  show: Showtime;
  seats: number;
  preferredSeats: string[];
  reason: "open" | "seats";
};

/** 영화 단위는 회차가 새로 보이면 한 번. 회차 단위는 잔여석이 바뀔 때마다. 결제는 호출하지 않는다. */
export function planAutoBook(input: {
  live: Showtime[];
  movies: AutoMovie[];
  autoShows: AutoShow[];
  fired: Record<string, string>;
  armMovies: Set<string>;
  armShows: Set<string>;
}): { jobs: AutoJob[]; fired: Record<string, string> } {
  const next = { ...input.fired };
  const jobs: AutoJob[] = [];

  for (const show of input.live) {
    const seats = movieAutoSeats(show.movieTitle, input.movies);
    if (seats == null) continue;
    const key = `m:${normalizeTitle(show.movieTitle)}:${show.id}`;
    if (next[key]) continue;
    next[key] = "open";
    if (!input.armMovies.has(normalizeTitle(show.movieTitle))) continue;
    if (!show.bookingUrl) continue;
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
    const sig = live.restSeats == null ? "na" : String(live.restSeats);
    const key = `s:${row.id}`;
    const prev = input.fired[key];
    if (prev === sig) {
      next[key] = sig;
      continue;
    }
    next[key] = sig;
    const armed = input.armShows.has(row.id);
    const changed = prev != null && prev !== sig && sig !== "na";
    if (!armed && !changed) continue;
    const bookingUrl = live.bookingUrl || row.bookingUrl;
    if (!bookingUrl) continue;
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
