import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { UserButton } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import {
  loadCloudSettings,
  mergeNotifyFromGas,
  publishToGas,
  pullGasNotify,
  refreshGasCode,
  saveCloudSettings,
  type CloudSnapshot,
  type GasPushResult,
} from "@/lib/cinema/cloud";
import { DEFAULT_WATCH } from "@/lib/cinema/gas-script";
import { gasWatchFingerprint } from "@/lib/cinema/gas-provision";
import { useAutoBook } from "@/lib/auto-book-store";
import { mergeAutoMovies, mergeAutoShows, sanitizeAutoFired } from "@/lib/cinema/auto-book-run";
import { useAppStore } from "@/lib/store";

function localSnapshot(): CloudSnapshot {
  const s = useAppStore.getState();
  return {
    config: s.config,
    queue: s.queue,
    alerts: s.alerts,
    onlyAlerted: s.onlyAlerted,
    primed: s.primed,
    seenIds: s.seenIds,
    seenDates: s.seenDates,
    watchSig: s.watchSig,
    autoMovies: useAutoBook.getState().movies,
    autoShows: useAutoBook.getState().shows,
    autoFired: {},
  };
}

function withSyncKey(snap: CloudSnapshot): CloudSnapshot {
  if (snap.config.gasSyncKey) return snap;
  const key = crypto.randomUUID();
  useAppStore.getState().setConfig({ gasSyncKey: key });
  return { ...snap, config: { ...snap.config, gasSyncKey: key } };
}

export function describeGasPush(gas: GasPushResult | undefined): string | null {
  if (!gas) return null;
  if (gas.status === "ok") return "구글 스크립트에 반영했습니다.";
  if (gas.status === "skipped") return null;
  if (gas.status === "need-script") return null;
  return gas.message;
}

export async function flushSettings(signedIn: boolean): Promise<GasPushResult> {
  const snap = withSyncKey(localSnapshot());
  const payload = {
    config: { ...snap.config, updatedAt: new Date().toISOString() },
    queue: snap.queue,
    alerts: snap.alerts,
    onlyAlerted: snap.onlyAlerted,
    primed: snap.primed,
    seenIds: snap.seenIds,
    seenDates: snap.seenDates,
    watchSig: snap.watchSig,
    autoMovies: snap.autoMovies,
    autoShows: snap.autoShows,
  };
  const published = await publishToGas({ data: payload }).catch(() => null);
  if (signedIn) {
    void Promise.race([
      saveCloudSettings({ data: payload }),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]).catch(() => {});
  }
  return published?.gas ?? { status: "error", message: "gas" };
}

export async function importNotifyFromGas(mode: "fill" | "prefer-gas") {
  const config = useAppStore.getState().config;
  const url = config.gasWebUrl.trim();
  if (!url) return { status: "skipped" as const, reason: "no-url" };
  const pulled = await pullGasNotify({ data: { url, key: config.gasSyncKey } });
  if (pulled.status !== "ok") return pulled;
  const patch = mergeNotifyFromGas(config, pulled.notify, mode);
  useAppStore.getState().setConfig(patch);
  return pulled;
}

export function CloudSync() {
  const { user, isPending } = useCurrentUserState();
  const userId = user?.id ?? null;
  const config = useAppStore((s) => s.config);
  const queue = useAppStore((s) => s.queue);
  const alerts = useAppStore((s) => s.alerts);
  const onlyAlerted = useAppStore((s) => s.onlyAlerted);
  const primed = useAppStore((s) => s.primed);
  const seenIds = useAppStore((s) => s.seenIds);
  const seenDates = useAppStore((s) => s.seenDates);
  const watchSig = useAppStore((s) => s.watchSig);
  const autoMovies = useAutoBook((s) => s.movies);
  const autoShows = useAutoBook((s) => s.shows);
  const hydrateCloud = useAppStore((s) => s.hydrateCloud);
  const [ready, setReady] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const skipSave = useRef(true);
  const userIdRef = useRef(userId);
  userIdRef.current = userId;
  const pulledFor = useRef<string | null>(null);
  const lastWatch = useRef("");

  useEffect(() => {
    const api = useAppStore.persist;
    if (!api?.hasHydrated) {
      setHydrated(true);
      return;
    }
    if (api.hasHydrated()) setHydrated(true);
    return api.onFinishHydration(() => setHydrated(true));
  }, []);

  useEffect(() => {
    if (!hydrated || isPending) return;
    if (!userId) {
      pulledFor.current = null;
      useAppStore.getState().setOwnerId(null);
      setReady(true);
      return;
    }
    if (pulledFor.current === userId) {
      setReady(true);
      return;
    }
    pulledFor.current = userId;
    useAppStore.getState().setOwnerId(userId);
    let cancelled = false;
    skipSave.current = true;
    loadCloudSettings()
      .then(async (remote) => {
        if (cancelled) return;
        const ownerId = useAppStore.getState().ownerId;
        if (remote.snapshot) {
          const mergedMovies = mergeAutoMovies(remote.snapshot.autoMovies, useAutoBook.getState().movies);
          const mergedShows = mergeAutoShows(remote.snapshot.autoShows, useAutoBook.getState().shows);
          rememberRemoteFired(remote.snapshot.autoFired);
          useAutoBook.getState().replaceAll(mergedMovies, mergedShows);
          hydrateCloud(remote.snapshot);
          await persistQuiet({ ...remote.snapshot, autoMovies: mergedMovies, autoShows: mergedShows });
          return;
        }
        if (ownerId && ownerId !== userId) {
          const fresh: CloudSnapshot = {
            config: {
              ...DEFAULT_WATCH,
              theme: useAppStore.getState().config.theme,
            },
            queue: [],
            alerts: [],
            onlyAlerted: false,
            primed: false,
            seenIds: [],
            seenDates: [],
            watchSig: "",
            autoMovies: [],
            autoShows: [],
            autoFired: {},
          };
          useAutoBook.getState().replaceAll([], []);
          hydrateCloud(fresh);
          await persistQuiet(fresh);
          return;
        }
        await persistQuiet(localSnapshot());
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) {
          skipSave.current = true;
          setReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [hydrated, userId, isPending, hydrateCloud]);

  useEffect(() => {
    if (!ready || !hydrated) return;
    let stop = false;
    const owner = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    void (async () => {
      try {
        const now = Date.now();
        const pause = Number(localStorage.getItem("openbell-gas-pause") || 0);
        if (now - pause < 30 * 60 * 1000) return;
        const beat = Number(localStorage.getItem("openbell-gas-beat") || 0);
        const current = localStorage.getItem("openbell-gas-owner") || "";
        if (current && current !== owner && now - beat < 20_000) return;
        localStorage.setItem("openbell-gas-owner", owner);
        localStorage.setItem("openbell-gas-beat", String(now));
      } catch {
        /* 저장을 막으면 이 탭만 진행한다 */
      }
      await flushSettings(Boolean(userIdRef.current)).catch(() => undefined);
      if (stop) return;
      let slot = 0;
      let cursor = 0;
      let begun = false;
      let mark = "";
      for (let n = 0; n < 2000 && !stop; n++) {
        try {
          if (localStorage.getItem("openbell-gas-owner") !== owner) return;
          localStorage.setItem("openbell-gas-beat", String(Date.now()));
        } catch {
          /* ignore */
        }
        const step = await refreshGasCode({ data: { slot, cursor, begun, mark } }).catch(() => null);
        if (!step?.pending) {
          try {
            localStorage.setItem("openbell-gas-pause", String(Date.now()));
          } catch {
            /* ignore */
          }
          return;
        }
        if (!step.begun) mark = "";
        else if (step.mark) mark = step.mark;
        slot = step.slot;
        cursor = step.cursor;
        begun = step.begun;
      }
    })();
    return () => {
      stop = true;
    };
  }, [ready, hydrated]);

  useEffect(() => {
    if (!ready || !hydrated) return;
    if (skipSave.current) {
      skipSave.current = false;
      lastWatch.current = gasWatchFingerprint();
      return;
    }
    const timer = window.setTimeout(() => {
      void flushSettings(Boolean(userId)).catch(() => {});
      lastWatch.current = gasWatchFingerprint();
    }, 900);
    return () => window.clearTimeout(timer);
  }, [
    config,
    queue,
    alerts,
    onlyAlerted,
    primed,
    seenIds,
    seenDates,
    watchSig,
    autoMovies,
    autoShows,
    ready,
    hydrated,
    userId,
  ]);

  return null;
}

function rememberRemoteFired(remote: Record<string, string>) {
  const incoming = sanitizeAutoFired(remote);
  let local: Record<string, string> = {};
  try {
    const raw = JSON.parse(localStorage.getItem("openbell-autobook-fired") || "{}") as unknown;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) local = raw as Record<string, string>;
  } catch {
    local = {};
  }
  try {
    localStorage.setItem("openbell-autobook-fired", JSON.stringify({ ...local, ...incoming }));
  } catch {
    /* 저장 공간이 막혀도 계정 쪽 기록은 남는다 */
  }
}

async function persistQuiet(snap: CloudSnapshot) {
  const next = withSyncKey(snap);
  await saveCloudSettings({
    data: {
      config: next.config,
      queue: next.queue,
      alerts: next.alerts,
      onlyAlerted: next.onlyAlerted,
      primed: next.primed,
      seenIds: next.seenIds,
      seenDates: next.seenDates,
      watchSig: next.watchSig,
      autoMovies: next.autoMovies,
      autoShows: next.autoShows,
    },
  }).catch(() => {});
}

export function AuthSlot() {
  const { user, isPending } = useCurrentUserState();
  if (isPending) {
    return <div className="ml-auto size-8 animate-pulse rounded-full bg-surface-2" />;
  }
  if (user) {
    return (
      <div className="max-w-[10rem] [&_span.text-sm.font-medium]:hidden md:[&_span.text-sm.font-medium]:inline">
        <UserButton />
      </div>
    );
  }
  return (
    <Link
      to="/login"
      className="text-[11px] text-muted underline-offset-2 hover:underline"
    >
      동기화
    </Link>
  );
}
