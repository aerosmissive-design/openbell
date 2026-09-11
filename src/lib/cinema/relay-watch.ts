import type { TheaterId, TheaterScan } from "./types";

export const CGV_RELAY_STALE_MS = 15 * 60 * 1000;

export type CgvRelayWatchState = {
  emptySince: number | null;
  theaters: TheaterId[];
  lastAlertAt: number | null;
};

export const EMPTY_CGV_RELAY_WATCH: CgvRelayWatchState = {
  emptySince: null,
  theaters: [],
  lastAlertAt: null,
};

export function cgvTheatersMissingSeats(theaters: TheaterScan[]): TheaterId[] {
  return theaters
    .filter(
      (row) =>
        String(row.theaterId).startsWith("cgv") &&
        row.showtimes.length > 0 &&
        row.showtimes.every((show) => show.restSeats == null),
    )
    .map((row) => row.theaterId);
}

export function nextCgvRelayWatch(
  prev: CgvRelayWatchState,
  missing: TheaterId[],
  now: number,
  staleMs = CGV_RELAY_STALE_MS,
): {
  state: CgvRelayWatchState;
  shouldAlert: boolean;
  stale: boolean;
  durationMs: number;
} {
  if (!missing.length) {
    return {
      state: {
        emptySince: null,
        theaters: [],
        lastAlertAt: prev.lastAlertAt,
      },
      shouldAlert: false,
      stale: false,
      durationMs: 0,
    };
  }
  const emptySince = prev.emptySince && prev.emptySince > 0 ? prev.emptySince : now;
  const durationMs = Math.max(0, now - emptySince);
  const stale = durationMs >= staleMs;
  const shouldAlert = stale && (!prev.lastAlertAt || prev.lastAlertAt < emptySince);
  return {
    state: {
      emptySince,
      theaters: missing,
      lastAlertAt: shouldAlert ? now : prev.lastAlertAt,
    },
    shouldAlert,
    stale,
    durationMs,
  };
}

export function parseCgvRelayWatch(raw: unknown): CgvRelayWatchState {
  if (!raw || typeof raw !== "object") return { ...EMPTY_CGV_RELAY_WATCH };
  const bag = raw as Partial<CgvRelayWatchState>;
  const theaters = Array.isArray(bag.theaters)
    ? bag.theaters.filter(
        (id): id is TheaterId =>
          id === "cgv_yongsan" || id === "cgv_yeongdeungpo",
      )
    : [];
  const emptySince =
    typeof bag.emptySince === "number" && bag.emptySince > 0 ? bag.emptySince : null;
  const lastAlertAt =
    typeof bag.lastAlertAt === "number" && bag.lastAlertAt > 0
      ? bag.lastAlertAt
      : null;
  return { emptySince, theaters, lastAlertAt };
}

export function cgvRelayWatchPublic(state: CgvRelayWatchState, now = Date.now()) {
  const durationMs =
    state.emptySince && state.theaters.length
      ? Math.max(0, now - state.emptySince)
      : 0;
  return {
    empty: state.theaters.length > 0,
    since: state.emptySince,
    durationMs,
    theaters: state.theaters,
    stale: durationMs >= CGV_RELAY_STALE_MS,
  };
}
