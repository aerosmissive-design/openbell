import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_WATCH } from "@/lib/cinema/gas-script";
import { DEFAULT_FORMATS } from "@/lib/cinema/theaters";
import type { SeatHitMap } from "@/lib/cinema/seats";
import type {
  AlertItem,
  BookingIntent,
  FormatId,
  Showtime,
  TheaterId,
  WatchConfig,
} from "@/lib/cinema/types";
import { normalizeScanSources, CHART_SIZE } from "@/lib/cinema/types";

type Tab = "watch" | "alerts" | "star" | "settings";

type AppState = {
  tab: Tab;
  setTab: (tab: Tab) => void;
  config: WatchConfig;
  primed: boolean;
  seenIds: string[];
  seenDates: string[];
  alerts: AlertItem[];
  queue: BookingIntent[];
  onlyAlerted: boolean;
  watchSig: string;
  ownerId: string | null;
  seatTick: number;
  seatMap: SeatHitMap;
  overlayShows: Record<string, Showtime[]>;
  setOnlyAlerted: (on: boolean) => void;
  setWatchSig: (sig: string) => void;
  setOwnerId: (id: string | null) => void;
  bumpSeatTick: () => void;
  mergeSeatMap: (map: SeatHitMap) => void;
  mergeOverlayShows: (theaterId: TheaterId, shows: Showtime[]) => void;
  setConfig: (patch: Partial<WatchConfig>) => void;
  setTheater: (id: TheaterId, on: boolean) => void;
  toggleFormat: (id: TheaterId, format: FormatId) => void;
  setTheaterFormats: (id: TheaterId, formats: FormatId[]) => void;
  toggleRank: (rank: number) => void;
  toggleWatchTitle: (title: string) => void;
  markPrimed: (ids: string[], dates?: string[]) => void;
  remember: (ids: string[], dates?: string[]) => void;
  pushAlerts: (items: AlertItem[]) => void;
  clearAlerts: () => void;
  enqueue: (item: BookingIntent) => void;
  dequeue: (id: string) => void;
  replaceQueue: (queue: BookingIntent[]) => void;
  patchQueueSeats: (
    id: string,
    restSeats: number | null,
    totalSeats?: number | null,
  ) => void;
  hydrateCloud: (snap: {
    config: WatchConfig;
    queue: BookingIntent[];
    alerts: AlertItem[];
    onlyAlerted: boolean;
    primed: boolean;
    seenIds: string[];
    seenDates: string[];
    watchSig: string;
  }) => void;
};

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      tab: "watch",
      setTab: (tab) => set({ tab }),
      config: DEFAULT_WATCH,
      primed: false,
      seenIds: [],
      seenDates: [],
      alerts: [],
      queue: [],
      onlyAlerted: false,
      watchSig: "",
      ownerId: null,
      seatTick: 0,
      seatMap: {},
      overlayShows: {},
      setOnlyAlerted: (on) => set({ onlyAlerted: on }),
      setWatchSig: (sig) => set({ watchSig: sig }),
      setOwnerId: (id) => set({ ownerId: id }),
      bumpSeatTick: () => set((s) => ({ seatTick: s.seatTick + 1 })),
      mergeSeatMap: (map) =>
        set((s) => ({ seatMap: { ...s.seatMap, ...map } })),
      mergeOverlayShows: (theaterId, shows) =>
        set((s) => ({
          overlayShows: {
            ...s.overlayShows,
            [theaterId]: shows,
          },
        })),
      setConfig: (patch) =>
        set((s) => ({ config: { ...s.config, ...patch } })),
      setTheater: (id, on) =>
        set((s) => ({
          config: {
            ...s.config,
            theaters: { ...s.config.theaters, [id]: on },
            formats: on
              ? s.config.formats
              : { ...s.config.formats, [id]: [] },
          },
        })),
      setTheaterFormats: (id, formats) =>
        set((s) => ({
          config: {
            ...s.config,
            formats: { ...s.config.formats, [id]: formats },
            theaters: { ...s.config.theaters, [id]: formats.length > 0 },
          },
        })),
      toggleFormat: (id, format) =>
        set((s) => {
          const current = s.config.formats[id] ?? [];
          const next = current.includes(format)
            ? current.filter((f) => f !== format)
            : [...current, format];
          return {
            config: {
              ...s.config,
              formats: { ...s.config.formats, [id]: next },
              theaters: { ...s.config.theaters, [id]: next.length > 0 },
            },
          };
        }),
      toggleRank: (rank) =>
        set((s) => {
          if (rank < 1 || rank > CHART_SIZE) return s;
          const has = s.config.ranks.includes(rank);
          const ranks = has
            ? s.config.ranks.filter((r) => r !== rank)
            : [...s.config.ranks, rank].sort((a, b) => a - b);
          return { config: { ...s.config, ranks } };
        }),
      toggleWatchTitle: (title) =>
        set((s) => {
          const key = title.trim();
          if (!key) return s;
          const has = s.config.watchTitles.some(
            (t) => t.toLowerCase() === key.toLowerCase(),
          );
          const watchTitles = has
            ? s.config.watchTitles.filter(
                (t) => t.toLowerCase() !== key.toLowerCase(),
              )
            : [...s.config.watchTitles, key].slice(0, 24);
          return { config: { ...s.config, watchTitles } };
        }),
      markPrimed: (ids, dates) =>
        set((s) => ({
          primed: true,
          seenIds: uniqueCap([...s.seenIds, ...ids], 2500),
          seenDates: uniqueCap([...s.seenDates, ...(dates ?? [])], 40),
        })),
      remember: (ids, dates) =>
        set((s) => ({
          seenIds: uniqueCap([...s.seenIds, ...ids], 2500),
          seenDates: uniqueCap([...s.seenDates, ...(dates ?? [])], 40),
        })),
      pushAlerts: (items) =>
        set((s) => ({
          alerts: [...items, ...s.alerts].slice(0, 2000),
        })),
      clearAlerts: () => set({ alerts: [] }),
      enqueue: (item) =>
        set((s) => ({
          queue: s.queue.some((q) => q.id === item.id)
            ? s.queue
            : [item, ...s.queue].slice(0, 40),
        })),
      dequeue: (id) =>
        set((s) => ({ queue: s.queue.filter((q) => q.id !== id) })),
      replaceQueue: (queue) => set({ queue: queue.slice(0, 40) }),
      patchQueueSeats: (id, restSeats, totalSeats) =>
        set((s) => ({
          queue: s.queue.map((q) =>
            q.id === id
              ? {
                  ...q,
                  restSeats,
                  totalSeats: totalSeats === undefined ? q.totalSeats : totalSeats,
                }
              : q,
          ),
        })),
      hydrateCloud: (snap) =>
        set((s) => ({
          config: {
            ...DEFAULT_WATCH,
            ...snap.config,
            theaters: {
              ...DEFAULT_WATCH.theaters,
              ...(snap.config.theaters ?? {}),
            },
            formats: {
              ...DEFAULT_FORMATS,
              ...(snap.config.formats ?? {}),
            },
            scanSources: normalizeScanSources(snap.config.scanSources),
            ranks: clampStoredRanks(snap.config.ranks),
            gasSourceStamp:
              snap.config.gasSourceStamp || s.config.gasSourceStamp,
          },
          queue: snap.queue.slice(0, 40),
          alerts: snap.alerts.slice(0, 2000),
          onlyAlerted: snap.onlyAlerted,
          primed: snap.primed,
          seenIds: uniqueCap(snap.seenIds, 2500),
          seenDates: uniqueCap(snap.seenDates, 40),
          watchSig: snap.watchSig,
          ownerId: s.ownerId,
        })),
    }),
    {
      name: "openbell-v2",
      partialize: (s) => ({
        config: s.config,
        primed: s.primed,
        seenIds: s.seenIds,
        seenDates: s.seenDates,
        alerts: s.alerts,
        queue: s.queue,
        onlyAlerted: s.onlyAlerted,
        watchSig: s.watchSig,
        ownerId: s.ownerId,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppState>;
        return {
          ...current,
          ...p,
          config: {
            ...DEFAULT_WATCH,
            ...(p.config ?? {}),
            theaters: syncTheatersFromFormats(
              {
                ...DEFAULT_FORMATS,
                ...((p.config && p.config.formats) || {}),
              },
              p.config?.theaters,
            ),
            formats: {
              ...DEFAULT_FORMATS,
              ...((p.config && p.config.formats) || {}),
            },
            scanSources: normalizeScanSources(p.config?.scanSources),
            ranks: clampStoredRanks(p.config?.ranks),
            theme: p.config?.theme ?? DEFAULT_WATCH.theme,
            emailNotify:
              typeof p.config?.emailNotify === "boolean"
                ? p.config.emailNotify
                : Boolean(p.config?.email?.trim()),
          },
          seenDates: p.seenDates ?? current.seenDates,
        };
      },
    },
  ),
);

function uniqueCap(ids: string[], cap: number): string[] {
  return [...new Set(ids)].slice(-cap);
}

function clampStoredRanks(raw: number[] | undefined): number[] {
  const ranks = (raw ?? DEFAULT_WATCH.ranks).filter(
    (n) => n >= 1 && n <= CHART_SIZE,
  );
  return ranks.length ? ranks : DEFAULT_WATCH.ranks;
}

function syncTheatersFromFormats(
  formats: Record<string, FormatId[] | undefined>,
  theaters?: Partial<Record<TheaterId, boolean>>,
): Record<TheaterId, boolean> {
  const ids: TheaterId[] = [
    "cgv_yongsan",
    "cgv_yeongdeungpo",
    "megabox_coex",
    "megabox_namyangju",
  ];
  const out: Record<TheaterId, boolean> = {
    megabox_coex: true,
    megabox_namyangju: true,
    cgv_yongsan: true,
    cgv_yeongdeungpo: true,
    ...theaters,
  };
  for (const id of ids) {
    const list = formats[id];
    if (Array.isArray(list)) out[id] = list.length > 0;
  }
  return out;
}
