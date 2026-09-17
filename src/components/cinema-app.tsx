import { useQuery } from "@tanstack/react-query";
import { Bell, ScanLine, Settings2, Star } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { bookingJumpUrl } from "@/lib/cinema/kakao";
import { filterWatched, mergeMovieCatalog, moviesFromShowtimes, primeIdsForWatchChange, watchedTitleSet, watchSignature } from "@/lib/cinema/match";
import { enqueueNasFromAlert } from "@/lib/cinema/nas-enqueue";
import { fetchMovieCatalog, pingGasBeat, pullTheaterSeats, scanCinema, sendAlertEmail, sendKakaoMemo, sendTelegram, sendWebhook } from "@/lib/cinema/scan";
import { applyCgvSeatHits, diffStarSeats, mergeShowtimes, notifyBatches, notifyCopy, putSeatHit, seatChangeAlert, showAlertBody, type SeatHitMap } from "@/lib/cinema/seats";
import { THEATERS } from "@/lib/cinema/theaters";
import type { AlertItem, RankingMovie, ScanResult, Showtime, WatchConfig } from "@/lib/cinema/types";
import { mailEnabled, inferSeatSource } from "@/lib/cinema/types";
import { useAppStore } from "@/lib/store";
import { cn, formatClock, normalizeTitle } from "@/lib/utils";
import { APP_VERSION } from "@/lib/app-version";
import { AlertsView } from "./alerts-view";
import { AuthSlot, CloudSync } from "./cloud-sync";
import { SettingsView } from "./settings-view";
import { StarsView } from "./stars-view";
import { WatchView } from "./watch-view";

export function CinemaApp() {
  const tab = useAppStore((s) => s.tab);
  const setTab = useAppStore((s) => s.setTab);
  const config = useAppStore((s) => s.config);
  const primed = useAppStore((s) => s.primed);
  const watchSig = useAppStore((s) => s.watchSig);
  const seatMap = useAppStore((s) => s.seatMap);
  const mergeSeatMap = useAppStore((s) => s.mergeSeatMap);
  const overlayShows = useAppStore((s) => s.overlayShows);
  const mergeOverlayShows = useAppStore((s) => s.mergeOverlayShows);
  const setWatchSig = useAppStore((s) => s.setWatchSig);
  const seenIds = useAppStore((s) => s.seenIds);
  const alerts = useAppStore((s) => s.alerts);
  const markPrimed = useAppStore((s) => s.markPrimed);
  const remember = useAppStore((s) => s.remember);
  const pushAlerts = useAppStore((s) => s.pushAlerts);
  const queue = useAppStore((s) => s.queue);
  const replaceQueue = useAppStore((s) => s.replaceQueue);
  const seenRef = useRef(seenIds);
  seenRef.current = seenIds;

  const enabledTheaters = THEATERS.map((t) => t.id);
  const scanInterval = Math.max(config.intervalMin, 1) * 60 * 1000;

  const catalogQuery = useQuery({
    queryKey: ["movie-catalog"],
    queryFn: () => fetchMovieCatalog(),
    staleTime: 120_000,
    retry: 1,
    placeholderData: (prev) => prev,
  });

  const fastQuery = useQuery({
    queryKey: [
      "scan-fast",
      enabledTheaters,
      config.daysAhead,
      config.gasWebUrl,
    ],
    enabled: enabledTheaters.length > 0,
    queryFn: () =>
      scanCinema({
        data: {
          theaters: enabledTheaters,
          daysAhead: config.daysAhead,
          gasWebUrl: config.gasWebUrl || undefined,
          mode: "fast",
          sources: { official: false, naver: true, gas: false },
        },
      }),
    placeholderData: (prev) => prev,
  });

  const fullQuery = useQuery({
    queryKey: [
      "scan-full",
      enabledTheaters,
      config.daysAhead,
      config.gasWebUrl,
    ],
    enabled: enabledTheaters.length > 0,
    queryFn: () =>
      scanCinema({
        data: {
          theaters: enabledTheaters,
          daysAhead: config.daysAhead,
          gasWebUrl: config.gasWebUrl || undefined,
          mode: "full",
          sources: { official: true, naver: true, gas: Boolean(config.gasWebUrl) },
        },
      }),
    refetchInterval: scanInterval,
    placeholderData: (prev) => prev,
  });

  const seatQuery = useQuery({
    queryKey: ["seats", enabledTheaters, config.daysAhead, config.gasWebUrl],
    enabled: enabledTheaters.length > 0,
    queryFn: () =>
      pullTheaterSeats({
        url: config.gasWebUrl.trim() || undefined,
        daysAhead: Math.min(Math.max(config.daysAhead || 7, 1), 30),
        fresh: true,
      }),
    refetchInterval: scanInterval,
    refetchIntervalInBackground: false,
    staleTime: 60_000,
    retry: 1,
  });

  const scan = useMemo(
    () => mergeScanResults(fastQuery.data ?? null, fullQuery.data ?? null),
    [fastQuery.data, fullQuery.data],
  );
  const alertScan = fullQuery.data ?? fastQuery.data ?? null;
  const posterByTitle = useRef(new Map<string, string>());
  for (const row of [
    ...(catalogQuery.data?.catalog ?? []),
    ...(catalogQuery.data?.ranking ?? []),
    ...(catalogQuery.data?.showing ?? []),
    ...(scan?.catalog ?? []),
    ...(scan?.ranking ?? []),
    ...(scan?.showing ?? []),
  ]) {
    if (row.posterUrl) posterByTitle.current.set(normalizeTitle(row.title), row.posterUrl);
  }
  const stampPosters = (list: RankingMovie[]) =>
    list.map((row) =>
      row.posterUrl
        ? row
        : {
            ...row,
            posterUrl: posterByTitle.current.get(normalizeTitle(row.title)) ?? null,
          },
    );
  const viewScan = useMemo(() => {
    if (!scan && !catalogQuery.data) return null;
    const theaters = (scan?.theaters ?? []).map((t) => {
      const showtimes = applyCgvSeatHits(
        mergeShowtimes(t.showtimes, overlayShows[t.theaterId] ?? []),
        seatMap,
        false,
        false,
      );
      const hasSeats = showtimes.some((row) => row.restSeats != null);
      const cachedOnly =
        hasSeats &&
        showtimes.every(
          (row) => row.restSeats == null || row.seatLive === false,
        );
      return {
        ...t,
        showtimes,
        seatSource: inferSeatSource({
          theaterId: t.theaterId,
          seatSource: t.seatSource,
          source: t.source,
          hasSeats,
          cachedOnly,
        }),
      };
    });
    const rankingSrc = catalogQuery.data?.ranking.length
      ? catalogQuery.data.ranking
      : (scan?.ranking ?? []);
    const showingSrc = catalogQuery.data?.showing.length
      ? catalogQuery.data.showing
      : (scan?.showing ?? []);
    return {
      scannedAt: scan?.scannedAt ?? new Date().toISOString(),
      playDates: scan?.playDates ?? [],
      ranking: stampPosters(rankingSrc),
      showing: stampPosters(showingSrc),
      catalog: stampPosters(
        mergeMovieCatalog(
          catalogQuery.data?.catalog ?? [],
          scan?.catalog ?? [],
          rankingSrc,
          showingSrc,
          moviesFromShowtimes(theaters.flatMap((t) => t.showtimes)),
        ),
      ),
      catalogNote: catalogQuery.data?.catalogNote || scan?.catalogNote,
      seatSourceTimes: mergeSeatSourceTimes(scan?.seatSourceTimes, seatQuery.data?.seatSourceTimes),
      theaters,
    };
  }, [scan, catalogQuery.data, seatMap, overlayShows, seatQuery.data?.seatSourceTimes]);
  const titles = useMemo(
    () => watchedTitleSet(viewScan?.ranking ?? [], config),
    [viewScan?.ranking, config],
  );
  const watchedShows = useMemo(
    () =>
      filterWatched(
        (alertScan?.theaters ?? []).flatMap((t) => t.showtimes),
        config,
        titles,
      ),
    [alertScan, config, titles],
  );

  useEffect(() => {
    const map = seatQuery.data?.map;
    if (map && Object.keys(map).length) mergeSeatMap(map);
    const extra = seatQuery.data?.showtimes ?? [];
    const byTheater = new Map<string, typeof extra>();
    for (const show of extra) {
      const list = byTheater.get(show.theaterId) ?? [];
      list.push(show);
      byTheater.set(show.theaterId, list);
    }
    for (const [id, rows] of byTheater) {
      mergeOverlayShows(id as (typeof extra)[number]["theaterId"], rows);
    }
  }, [seatQuery.dataUpdatedAt, seatQuery.data, mergeSeatMap, mergeOverlayShows]);

  useEffect(() => {
    if (!scan) return;
    const harvested: SeatHitMap = {};
    for (const theater of scan.theaters ?? []) {
      for (const show of theater.showtimes) putSeatHit(harvested, show);
    }
    if (Object.keys(harvested).length) mergeSeatMap(harvested);
  }, [scan, mergeSeatMap]);

  useEffect(() => {
    if (!alertScan) return;
    const sig = watchSignature(config);
    if (!primed) {
      markPrimed(watchedShows.map((s) => s.id));
      setWatchSig(sig);
      return;
    }
    let extraSeen: string[] = [];
    if (!watchSig) {
      setWatchSig(sig);
    } else if (sig !== watchSig) {
      extraSeen = primeIdsForWatchChange(
        watchSig,
        config,
        alertScan.ranking ?? [],
        watchedShows,
      );
      if (extraSeen.length) markPrimed(extraSeen);
      setWatchSig(sig);
    }
    const seen = new Set([...seenRef.current, ...extraSeen]);
    const fresh = watchedShows.filter((s) => !seen.has(s.id));
    if (!fresh.length) return;
    remember(fresh.map((s) => s.id));
    const items = fresh.map((show) =>
      toAlert(
        show,
        (alertScan.theaters ?? []).flatMap((t) => t.showtimes),
      ),
    );
    pushAlerts(items);
    announce(items, config);
    setTab("alerts");
  }, [
    alertScan?.scannedAt,
    watchedShows,
    primed,
    watchSig,
    config,
    alertScan,
    markPrimed,
    setWatchSig,
    remember,
    pushAlerts,
    setTab,
  ]);

  useEffect(() => {
    if (!alertScan) return;
    const all = (alertScan.theaters ?? []).flatMap((t) =>
      applyCgvSeatHits(t.showtimes, seatMap, false, false),
    );
    const { nextQueue, changes } = diffStarSeats(queue, all);
    const dirty =
      changes.length > 0 ||
      nextQueue.some(
        (q, i) =>
          q.restSeats !== queue[i]?.restSeats ||
          q.totalSeats !== queue[i]?.totalSeats,
      );
    if (!dirty) return;
    replaceQueue(nextQueue);
    if (!changes.length) return;
    const items = changes.map((change) => seatChangeAlert(change, all));
    pushAlerts(items);
    announce(items, config);
  }, [alertScan?.scannedAt, alertScan, queue, config, seatMap, replaceQueue, pushAlerts]);

  useEffect(() => {
    const url = config.gasWebUrl.trim();
    if (!url || !alertScan?.scannedAt) return;
    void pingGasBeat({
      data: { url, key: config.gasSyncKey || undefined, src: "page" },
    }).catch(() => null);
  }, [alertScan?.scannedAt, config.gasWebUrl, config.gasSyncKey]);

  useEffect(() => {
    const tick = () => {
      void fetch("/api/watch-tick", { method: "GET" }).catch(() => null);
    };
    tick();
    const timer = window.setInterval(tick, 3 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (typeof Notification === "undefined") return;
    if (Notification.permission !== "default") return;
    void Notification.requestPermission().catch(() => null);
  }, []);

  const fetching = fastQuery.isFetching || fullQuery.isFetching || seatQuery.isFetching;
  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col bg-bg md:max-w-5xl">
      <CloudSync />
      <header className="sticky top-0 z-20 border-b border-border bg-bg px-5 pb-3 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-medium tracking-[0.18em] text-muted">
              특별관 예매 알람
            </p>
            <h1 className="mt-1 text-[28px] font-bold leading-none text-fg">
              오픈벨
              <span className="ml-2 align-middle text-xs font-medium tracking-normal text-muted">
                v{APP_VERSION}
              </span>
            </h1>
          </div>
          <div className="mb-0.5 flex flex-col items-end gap-1">
            <AuthSlot />
            <p className="flex items-center justify-end gap-1.5 text-[11px] text-muted">
              <span
                className={cn(
                  "inline-block size-1.5 rounded-full",
                  fetching ? "bg-open live-dot" : "bg-faint",
                )}
              />
              {fetching ? "조회 중" : "감시 중"}
            </p>
            <p className="mt-0.5 font-medium tabular-nums text-xs text-fg">
              {formatClock(scan?.scannedAt ?? null)}
            </p>
          </div>
        </div>
      </header>

      <main className="flex-1 px-5 pb-28 pt-5">
        {tab === "watch" ? (
          <WatchView
            scan={viewScan}
            loading={!scan && catalogQuery.isLoading && !catalogQuery.data}
            error={fullQuery.error ?? fastQuery.error}
            onRefresh={() => {
              void fastQuery.refetch();
              void fullQuery.refetch();
              void seatQuery.refetch();
            }}
            refreshing={fetching}
          />
        ) : null}
        {tab === "alerts" ? <AlertsView /> : null}
        {tab === "star" ? <StarsView /> : null}
        {tab === "settings" ? <SettingsView lastScan={viewScan} /> : null}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-lg border-t border-border-strong bg-surface px-4 pb-[max(0.6rem,env(safe-area-inset-bottom))] pt-2 md:max-w-5xl">
        <div className="grid grid-cols-4 gap-1">
          <NavBtn
            active={tab === "watch"}
            onClick={() => setTab("watch")}
            icon={<ScanLine className="size-4" strokeWidth={1.75} />}
            label="감시"
          />
          <NavBtn
            active={tab === "alerts"}
            onClick={() => setTab("alerts")}
            icon={<Bell className="size-4" strokeWidth={1.75} />}
            label="알림"
            badge={alerts.length}
          />
          <NavBtn
            active={tab === "star"}
            onClick={() => setTab("star")}
            icon={
              <Star
                className="size-5"
                strokeWidth={1.75}
                fill={tab === "star" || queue.length ? "currentColor" : "none"}
              />
            }
            ariaLabel="별표"
            badge={queue.length}
          />
          <NavBtn
            active={tab === "settings"}
            onClick={() => setTab("settings")}
            icon={<Settings2 className="size-4" strokeWidth={1.75} />}
            label="설정"
          />
        </div>
      </nav>
    </div>
  );
}

function mergeSeatSourceTimes(base?: ScanResult["seatSourceTimes"], extra?: ScanResult["seatSourceTimes"]): ScanResult["seatSourceTimes"] {
  const out: NonNullable<ScanResult["seatSourceTimes"]> = { ...(base ?? {}) };
  for (const [theaterId, times] of Object.entries(extra ?? {})) { const current = { ...(out[theaterId] ?? {}) }; for (const [key, value] of Object.entries(times ?? {})) { if (!current[key] || new Date(value).getTime() >= new Date(current[key]).getTime()) current[key] = value; } out[theaterId] = current; }
  return out;
}

function mergeScanResults(fast: ScanResult | null, full: ScanResult | null): ScanResult | null {
  if (!fast) return full;
  if (!full) return fast;
  const fastByTheater = new Map(fast.theaters.map((theater) => [theater.theaterId, theater]));
  const theaters = full.theaters.map((theater) => {
    const fallback = fastByTheater.get(theater.theaterId);
    if (!fallback) return theater;
    const showtimes = mergeShowtimes(theater.showtimes, fallback.showtimes);
    return {
      ...fallback,
      ...theater,
      showtimes,
      ok: theater.ok || fallback.ok,
      error: theater.error ?? fallback.error,
      source: theater.showtimes.length ? theater.source : fallback.source,
      seatSource: theater.seatSource !== "none" ? theater.seatSource : fallback.seatSource,
    };
  });
  for (const theater of fast.theaters) {
    if (!theaters.some((row) => row.theaterId === theater.theaterId)) theaters.push(theater);
  }
  const ranking = full.ranking.length ? full.ranking : fast.ranking;
  const showing = full.showing.length ? full.showing : fast.showing;
  return {
    ...fast,
    ...full,
    scannedAt: full.scannedAt,
    playDates: full.playDates.length ? full.playDates : fast.playDates,
    ranking,
    showing,
    catalog: mergeMovieCatalog(fast.catalog ?? [], full.catalog ?? [], ranking, showing, moviesFromShowtimes(theaters.flatMap((theater) => theater.showtimes))),
    theaters,
  };
}

function NavBtn({
  active,
  onClick,
  icon,
  label,
  ariaLabel,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label?: string;
  ariaLabel?: string;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel || label}
      className={cn(
        "relative flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-md text-[11px] font-medium transition-colors duration-150",
        active ? "text-accent" : "text-fg",
      )}
    >
      {icon}
      {label ? <span>{label}</span> : null}
      {badge ? (
        <span className="absolute right-1.5 top-0.5 min-w-4 rounded-full bg-accent px-1 text-[10px] font-medium text-accent-fg tabular-nums">
          {badge}
        </span>
      ) : null}
    </button>
  );
}

function toAlert(show: Showtime, all: Showtime[]): AlertItem {
  const bookingUrl = resolveBookingUrl(show, all);
  return {
    id: `alert:${show.id}:${Date.now()}`,
    createdAt: new Date().toISOString(),
    kind: "open",
    title: `${show.movieTitle} 예매 오픈`,
    body: showAlertBody(show, all),
    bookingUrl,
    theaterId: show.theaterId,
    movieTitle: show.movieTitle,
    playDate: show.playDate,
    startTime: show.startTime,
    hallName: show.hallName,
    formats: show.formats,
    restSeats: show.restSeats,
    totalSeats: show.totalSeats,
  };
}

function resolveBookingUrl(show: Showtime, all: Showtime[]): string {
  if (show.bookingUrl) return show.bookingUrl;
  const normTime = (v: string) => String(v || '').replace(/\D/g, '').padStart(4, '0').slice(-4);
  const normTitle = (v: string) => normalizeTitle(v);
  const same = all.find((row) =>
    row !== show &&
    row.theaterId === show.theaterId &&
    row.playDate === show.playDate &&
    normTime(row.startTime) === normTime(show.startTime) &&
    normTitle(row.movieTitle) === normTitle(show.movieTitle) &&
    Boolean(row.bookingUrl),
  );
  if (same?.bookingUrl) return same.bookingUrl;
  if (show.chain === 'cgv') return 'https://www.cgv.co.kr/cnm/movieBook/cinema';
  return show.chain === 'megabox' ? 'https://www.megabox.co.kr/booking' : '';
}

function queueNasHoldJobs(items: AlertItem[], config: WatchConfig) {
  if (!config.hold?.nasAuto) return;
  const hold = config.hold;
  const payload = items
    .filter((a) => a.bookingUrl)
    .slice(0, 8)
    .map((a) => ({
      movieTitle: a.movieTitle,
      theaterId: a.theaterId,
      playDate: a.playDate,
      startTime: a.startTime,
      hallName: a.hallName,
      bookingUrl: a.bookingUrl,
      seats: hold.seats,
      zone: hold.zone,
    }));
  if (!payload.length) return;
  void enqueueNasFromAlert({ data: { items: payload } })
    .then((res) => {
      if (res && "enqueued" in res && typeof (res as { enqueued?: number }).enqueued === "number") {
        toast.success(`NAS 홀드 큐 ${(res as { enqueued: number }).enqueued}건`);
      }
    })
    .catch(() => null);
}

function announce(items: AlertItem[], config: WatchConfig) {
  if (!items.length) return;
  queueNasHoldJobs(items, config);
  const text = notifyCopy(items);
  const batches = notifyBatches(items);
  if (config.telegram?.token && config.telegram?.chatId) {
    for (const batch of batches) {
      void sendTelegram({
        data: {
          token: config.telegram.token,
          chatId: config.telegram.chatId,
          text: batch,
          html: true,
        },
      }).catch(() => null);
    }
  }
  if (config.webhookUrl) {
    void sendWebhook({
      data: { url: config.webhookUrl, payload: { text, items } },
    }).catch(() => null);
  }
  if (config.kakao?.restKey && config.kakao?.refreshToken) {
    for (const item of items.slice(0, 3)) {
      void sendKakaoMemo({
        data: {
          restKey: config.kakao.restKey,
          refreshToken: config.kakao.refreshToken,
          text: item.title.slice(0, 200),
          bookingUrl: item.bookingUrl || undefined,
        },
      }).catch(() => null);
    }
  }
  if (mailEnabled(config) && config.mailTo) {
    void sendAlertEmail({
      data: {
        to: config.mailTo,
        subject: items[0]?.title || "오픈벨 알림",
        text,
        items: items.map((i) => ({
          title: i.title,
          body: i.body,
          bookingUrl: i.bookingUrl || "",
        })),
        gasWebUrl: config.gasWebUrl || undefined,
        gmailAppPassword: config.gmailAppPassword || undefined,
      },
    }).catch(() => null);
  }
  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    try {
      new Notification(items[0].title, { body: items[0].body, tag: items[0].id });
    } catch {}
  }
  for (const item of items) {
    if (item.bookingUrl) {
      try {
        const jump = bookingJumpUrl(item.bookingUrl);
        if (jump) window.open(jump, "_blank", "noopener");
      } catch {}
    }
  }
}
