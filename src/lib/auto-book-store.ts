import { create } from "zustand";
import { persist } from "zustand/middleware";
import { normalizeTitle } from "@/lib/utils";
import type { TheaterId } from "@/lib/cinema/types";

export type AutoMovie = { title: string; seats: number };
export type AutoShow = {
  id: string;
  title: string;
  theaterId: TheaterId;
  playDate: string;
  startTime: string;
  hallName: string;
  bookingUrl: string;
  seats: number;
};

type AutoState = {
  movies: AutoMovie[];
  shows: AutoShow[];
  setMovie: (title: string, seats: number) => void;
  removeMovie: (title: string) => void;
  setShow: (row: AutoShow) => void;
  removeShow: (id: string) => void;
};

export const useAutoBook = create<AutoState>()(
  persist(
    (set) => ({
      movies: [],
      shows: [],
      setMovie: (title, seats) =>
        set((s) => {
          const key = normalizeTitle(title);
          if (!key) return s;
          const n = Math.min(8, Math.max(1, Math.round(seats || 1)));
          const rest = s.movies.filter((m) => normalizeTitle(m.title) !== key);
          return { movies: [...rest, { title: title.trim(), seats: n }].slice(-24) };
        }),
      removeMovie: (title) =>
        set((s) => ({
          movies: s.movies.filter((m) => normalizeTitle(m.title) !== normalizeTitle(title)),
        })),
      setShow: (row) =>
        set((s) => ({
          shows: [row, ...s.shows.filter((x) => x.id !== row.id)].slice(0, 40),
        })),
      removeShow: (id) => set((s) => ({ shows: s.shows.filter((x) => x.id !== id) })),
    }),
    { name: "openbell-autobook" },
  ),
);

export function movieAutoSeats(title: string, movies: AutoMovie[]): number | null {
  const hit = movies.find((m) => normalizeTitle(m.title) === normalizeTitle(title));
  return hit ? hit.seats : null;
}
