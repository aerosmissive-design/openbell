import { useQuery } from "@tanstack/react-query";
import { Bell, ScanLine, Settings2, Star } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { bookingJumpUrl } from "@/lib/cinema/kakao";
import { filterWatched, primeIdsForWatchChange, watchedTitleSet, watchSignature } from "@/lib/cinema/match";
import { fetchMovieCatalog, pullTheaterSeats, scanCinema, sendAlertEmail, sendKakaoMemo, sendTelegram, sendWebhook } from "@/lib/cinema/scan";
import { applyCgvSeatHits, diffStarSeats, mergeShowtimes, notifyCopy, putSeatHit, seatChangeAlert, type SeatHitMap } from "@/lib/cinema/seats";
import { THEATERS } from "@/lib/cinema/theaters";
import type { AlertItem, RankingMovie, Showtime, WatchConfig } from "@/lib/cinema/types";
import { mailEnabled } from "@/lib/cinema/types";
import { useAppStore } from "@/lib/store";
import { cn, formatClock, normalizeTitle } from "@/lib/utils";
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

  const enabledTheaters = useMemo(
    () => THEATERS.filter((t) => config.theaters[t.id]).map((t) => t.id),
    [config.theaters],
  );

  const catalogQuery = useQuery({
    queryKey: ["movie-catalog"],
    queryFn: () => fetchMovieCatalog(),
    staleTime: 120_000,
    retry: 1,
    placeholderData: (prev) => prev,
  });

  const query = useQuery({
    queryKey: [
      "scan",
      enabledTheaters,
      config.daysAhead,
      config.gasWebUrl,
      config.scanSources,
    ],
    enabled: enabledTheaters.length > 0,
    queryFn: () =>
      scanCinema({
        data: {
          theaters: enabledTheaters,
          daysAhead: config.daysAhead,
          gasWebUrl: config.gasWebUrl || undefined,
          sources: config.scanSources,
        },
      }),
    refetchInterval: Math.max(config.intervalMin, 1) * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  const seatQuery = useQuery({
    queryKey: ["seats", enabledTheaters, config.daysAhead],
    enabled: enabledTheaters.length > 0,
    queryFn: () =>
      pullTheaterSeats({
        daysAhead: Math.min(Math.max(config.daysAhead || 7, 1), 14),
        fresh: true,
      }),
    refetchInterval: 2 * 60 * 1000,
    refetchIntervalInBackground: false,
    staleTime: 60_000,
    retry: 1,
  });

  const scan = query.data ?? null;
  const posterByTitle = useRef(new Map<string, string>());
  for (const row of [
    ...(catalogQuery.data?.ranking ?? []),
    ...(catalogQuery.data?.showing ?? []),
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
    const theaters = (scan?.theaters ?? []).map((t) => ({
      ...t,
      showtimes: applyCgvSeatHits(
        mergeShowtimes(t.showtimes, overlayShows[t.theaterId] ?? []),
        seatMap,
        true,
      ),
    }));
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
      theaters,
    };
  }, [scan, catalogQuery.data, seatMap, overlayShows]);
  const titles = useMemo(
    () => watchedTitleSet(viewScan?.ranking ?? [], config),
    [viewScan?.ranking, config],
  );
  const watchedShows = useMemo(
    () =>
      filterWatched(
        (scan?.theaters ?? []).flatMap((t) => t.showtimes),
        config,
        titles,
      ),
    [scan, config, titles],
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
    if (!scan) return;
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
        scan.ranking ?? [],
        watchedShows,
      );
      if (extraSeen.length) markPrimed(extraSeen);
      setWatchSig(sig);
    }
    const seen = new Set([...seenRef.current, ...extraSeen]);
    const fresh = watchedShows.filter((s) => !seen.has(s.id));
    if (!fresh.length) return;
    remember(fresh.map((s) => s.id));
    const items = fresh.map(toAlert);
    pushAlerts(items);
    announce(items, config);
    setTab("alerts");
  }, [
    scan?.scannedAt,
    watchedShows,
    primed,
    watchSig,
    config,
    scan,
    markPrimed,
    setWatchSig,
    remember,
    pushAlerts,
    setTab,
  ]);

  useEffect(() => {
    if (!scan) return;
    const all = (scan.theaters ?? []).flatMap((t) =>
      applyCgvSeatHits(t.showtimes, seatMap, true),
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
    const items = changes.map(seatChangeAlert);
    pushAlerts(items);
    announce(items, config);
  }, [scan?.scannedAt, scan, queue, config, seatMap, replaceQueue, pushAlerts]);

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
            </h1>
          </div>
          <div className="mb-0.5 flex flex-col items-end gap-1">
            <AuthSlot />
            <p className="flex items-center justify-end gap-1.5 text-[11px] text-muted">
              <span
                className={cn(
                  "inline-block size-1.5 rounded-full",
                  query.isFetching || seatQuery.isFetching
                    ? "bg-open live-dot"
                    : "bg-faint",
                )}
              />
              {query.isFetching || seatQuery.isFetching ? "조회 중" : "감시 중"}
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
            loading={catalogQuery.isLoading && !catalogQuery.data}
            error={query.error}
            onRefresh={() => {
              void query.refetch();
            }}
            refreshing={query.isFetching}
          />
        ) : null}
        {tab === "alerts" ? <AlertsView /> : null}
        {tab === "star" ? <StarsView /> : null}
        {tab === "settings" ? <SettingsView lastScan={scan} /> : null}
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

function toAlert(show: Showtime): AlertItem {
  return {
    id: `alert:${show.id}:${Date.now()}`,
    createdAt: new Date().toISOString(),
    kind: "open",
    title: `${show.movieTitle} 예매 오픈`,
    body: `${show.theaterName} · ${show.hallName} · ${show.startTime}`,
    bookingUrl: show.bookingUrl,
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

function announce(items: AlertItem[], config: WatchConfig) {
  const head = items[0];
  if (!head) return;
  toast(head.title, { description: head.body });
  if (config.browserNotify && typeof Notification !== "undefined") {
    if (Notification.permission === "granted") {
      new Notification(head.title, { body: head.body });
    }
  }
  const { subject, text, telegramHtml } = notifyCopy(items);
  if (config.telegramToken && config.telegramChatId) {
    void sendTelegram({
      data: {
        token: config.telegramToken,
        chatId: config.telegramChatId,
        text: telegramHtml,
        html: true,
      },
    }).catch((err: unknown) => {
      toast.error(err instanceof Error ? err.message : "텔레그램 실패");
    });
  }
  if (config.webhookUrl) {
    void sendWebhook({
      data: {
        url: config.webhookUrl,
        payload: { title: subject, alerts: items },
      },
    }).catch(() => {
      toast.error("카카오 웹훅 전송 실패");
    });
  }
  if (config.kakaoRestKey && config.kakaoRefreshToken) {
    for (const item of items.slice(0, 8)) {
      void sendKakaoMemo({
        data: {
          restKey: config.kakaoRestKey,
          refreshToken: config.kakaoRefreshToken,
          text: `${item.title}\n${item.body}`.slice(0, 200),
          bookingUrl: bookingJumpUrl(item.bookingUrl),
        },
      }).catch((err: unknown) => {
        toast.error(err instanceof Error ? err.message : "카카오톡 전송 실패");
      });
    }
  }
  if (mailEnabled(config)) {
    void sendAlertEmail({
      data: {
        to: config.email.trim(),
        subject,
        text,
        url: head.bookingUrl,
        items: items.slice(0, 8).map((a) => ({
          title: a.title,
          body: a.body,
          bookingUrl: a.bookingUrl,
        })),
        gasWebUrl: config.gasWebUrl,
        gmailAppPassword: config.gmailAppPassword,
      },
    }).catch((err: unknown) => {
      toast.error(err instanceof Error ? err.message : "메일 전송 실패");
    });
  }
}
