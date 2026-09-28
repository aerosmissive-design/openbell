import { useEffect, useState, type ReactNode } from "react";
import { pullGasAlertStatus, type GasAlertStatus } from "@/lib/cinema/cloud";
import { useAppStore } from "@/lib/store";

type Alive = {
  db?: string;
  alive?: boolean;
  ageMs?: number | null;
  githubWakeAgeMs?: number | null;
  externalWakeAgeMs?: number | null;
  gasWakeAgeMs?: number | null;
  vercelWakeAt?: number;
  vercelWakeAgeMs?: number | null;
};

function ago(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "없음";
  const min = Math.max(0, Math.floor(ms / 60000));
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const hour = Math.floor(min / 60);
  if (hour < 48) return `${hour}시간 전`;
  return `${Math.floor(hour / 24)}일 전`;
}

function dbLabel(db?: string): string {
  if (db === "neon") return "Neon";
  if (db === "neon-quota") return "Neon 쿼터";
  if (db === "pglite") return "로컬 DB";
  return "없음";
}

export function ServerStatus() {
  const gasUrl = useAppStore((s) => s.config.gasWebUrl);
  const [alive, setAlive] = useState<Alive | null>(null);
  const [gas, setGas] = useState<GasAlertStatus | null>(null);

  useEffect(() => {
    let stop = false;
    const load = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      const q = gasUrl.trim() ? `?gas=${encodeURIComponent(gasUrl.trim())}` : "";
      void fetch(`/api/watch-alive${q}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((json) => {
          if (!stop && json) setAlive(json as Alive);
        })
        .catch(() => null);
    };
    load();
    const timer = window.setInterval(load, 60_000);
    const onVis = () => {
      if (!document.hidden) load();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stop = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [gasUrl]);

  useEffect(() => {
    const url = gasUrl.trim();
    if (!url) {
      setGas(null);
      return;
    }
    let stop = false;
    void pullGasAlertStatus({ data: { url } })
      .then((row) => {
        if (!stop) setGas(row);
      })
      .catch(() => {
        if (!stop) setGas({ status: "error", message: "status" });
      });
    return () => {
      stop = true;
    };
  }, [gasUrl]);

  const gasOk = gas?.status === "ok" ? gas : null;

  return (
    <div className="mt-4 border-t border-border pt-3">
      <h2 className="text-xs font-medium tracking-[0.16em] text-muted">서버 status</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        외부 크론은 베셀을 밖에서 두드리는 시계입니다. GAS 마지막 실행과는 다른 칸입니다.
      </p>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <StatusCard title="베셀" subtitle="메인서버">
          <Row label="Neon" value={dbLabel(alive?.db)} />
          <Row label="틱" value={alive ? `${ago(alive.ageMs)} · ${alive.alive ? "살아 있음" : "멈춤"}` : "없음"} />
          <Row label="깃허브 깨움" value={ago(alive?.githubWakeAgeMs)} />
          <Row label="외부 크론" value={ago(alive?.externalWakeAgeMs)} />
          <Row label="GAS 깨움" value={ago(alive?.gasWakeAgeMs)} />
          <Row label="베셀 크론" value={alive?.vercelWakeAt ? ago(alive.vercelWakeAgeMs) : "꺼짐"} />
        </StatusCard>
        <StatusCard title="GAS" subtitle="예비서버">
          <Row label="연결" value={gasUrl.trim() ? "연결됨" : "없음"} />
          <Row label="자기 감시" value={gasOk ? (gasOk.gasAlive ? "살아 있음" : "멈춤") : "없음"} />
          <Row label="마지막 실행" value={gasOk?.gasLastRun ? ago(Date.now() - gasOk.gasLastRun) : "없음"} />
          <Row label="간격" value={gasOk ? `${gasOk.intervalMin}분` : "없음"} />
          <Row label="메일" value={gasOk?.lastNotify?.mail || "없음"} />
        </StatusCard>
      </div>
    </div>
  );
}

function StatusCard({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="rounded-lg bg-bg px-3 py-3 ring-1 ring-border">
      <p className="text-sm font-medium text-fg">
        {title}
        <span className="ml-1.5 text-[11px] font-normal text-muted">{subtitle}</span>
      </p>
      <dl className="mt-2 flex flex-col gap-1">{children}</dl>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[12px]">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right text-fg">{value}</dd>
    </div>
  );
}
