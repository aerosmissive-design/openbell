import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { UserButton } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import {
  loadCloudSettings,
  mergeNotifyFromGas,
  publishToGas,
  pullGasNotify,
  saveCloudSettings,
  type CloudSnapshot,
  type GasPushResult,
} from "@/lib/cinema/cloud";
import { DEFAULT_WATCH } from "@/lib/cinema/gas-script";
import { forgetGasLink, gasWatchFingerprint } from "@/lib/cinema/gas-provision";
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
    config: snap.config,
    queue: snap.queue,
    alerts: snap.alerts,
    onlyAlerted: snap.onlyAlerted,
    primed: snap.primed,
    seenIds: snap.seenIds,
    seenDates: snap.seenDates,
    watchSig: snap.watchSig,
  };
  if (signedIn) {
    const res = await saveCloudSettings({ data: payload });
    return res.gas;
  }
  const res = await publishToGas({ data: payload });
  return res.gas;
}

export async function importNotifyFromGas(mode: "fill" | "prefer-gas") {
  const config = useAppStore.getState().config;
  const url = config.gasWebUrl.trim();
  if (!url) return { status: "skipped" as const, reason: "no-url" };
  const pulled = await pullGasNotify({ data: { url } });
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
  const hydrateCloud = useAppStore((s) => s.hydrateCloud);
  const [ready, setReady] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const skipSave = useRef(true);
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
      forgetGasLink();
      useAppStore.getState().setOwnerId(null);
      setReady(true);
      return;
    }
    if (pulledFor.current === userId) {
      setReady(true);
      return;
    }
    const prevOwner = useAppStore.getState().ownerId;
    if (prevOwner && prevOwner !== userId) {
      forgetGasLink();
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
          hydrateCloud(remote.snapshot);
          await persistQuiet(remote.snapshot);
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
          };
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
    ready,
    hydrated,
    userId,
  ]);

  return null;
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
