import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useSession } from "better-auth/react";
import { authEnabled } from "@/lib/auth/client";
import { applyCgvSeatHits, mergeShowtimes, seatFreshnessLabel } from "@/lib/cinema/seats";
import { pullTheaterSeats, scanCinema } from "@/lib/cinema/scan";
import { THEATERS } from "@/lib/cinema/theaters";
import type { Showtime, TheaterId } from "@/lib/cinema/types";
import { useAppStore } from "@/lib/store";
import { formatClock } from "@/lib/utils";

const IDS: TheaterId[] = ["cgv_yongsan", "cgv_yeongdeungpo", "megabox_coex", "megabox_namyangju"];

export function BoardView() {
  const { data: session, isPending } = useSession();
  const config = useAppStore((s) => s.config);
  const [data, setData] = useState<Record<string, Showtime[]>>({});
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const enabled = useMemo(() => IDS.filter((id) => config.theaters?.[id] !== false), [config.theaters]);

  async function refresh() {
    setBusy(true);
    try {
      const [scan, seats] = await Promise.all([
        scanCinema({ data: { theaters: enabled, daysAhead: Math.min(Math.max(config.daysAhead || 7, 1), 20), gasWebUrl: config.gasWebUrl || undefined, mode: "full", sources: { official: true, naver: true, gas: Boolean(config.gasWebUrl) } } }),
        pullTheaterSeats({ url: config.gasWebUrl.trim() || undefined, daysAhead: Math.min(Math.max(config.daysAhead || 7, 1), 20), fresh: true }),
      ]);
      const next: Record<string, Showtime[]> = {};
      for (const theater of scan.theaters) {
        const merged = mergeShowtimes(theater.showtimes, seats.showtimes.filter((s) => s.theaterId === theater.theaterId));
        next[theater.theaterId] = applyCgvSeatHits(merged, seats.map, false, false).slice(0, 18);
      }
      setData(next);
      setUpdatedAt(new Date().toISOString());
    } finally { setBusy(false); }
  }

  useEffect(() => { if (!authEnabled || session?.user) void refresh(); }, [enabled.join(","), config.daysAhead, config.gasWebUrl, session?.user?.id]);
  useEffect(() => { if (authEnabled && !session?.user) return; const id = window.setInterval(() => void refresh(), 60000); return () => window.clearInterval(id); }, [enabled.join(","), config.daysAhead, config.gasWebUrl, session?.user?.id]);

  if (authEnabled && isPending) return <div className="min-h-dvh bg-bg p-8 text-muted">로그인 확인 중…</div>;
  if (authEnabled && !session?.user) return <div className="min-h-dvh bg-bg p-8 text-fg"><h1 className="text-2xl font-bold">오픈벨 전광판</h1><p className="mt-3 text-muted">로그인 후 사용할 수 있습니다.</p><a className="mt-5 inline-block rounded-md bg-pick px-4 py-3" href="/">홈으로</a></div>;

  return <main className="min-h-dvh bg-bg px-4 py-5 text-fg md:px-6 lg:px-8">
    <header className="mx-auto mb-5 flex max-w-[1800px] items-end justify-between gap-4"><div><p className="text-xs tracking-[.18em] text-muted">OPENBELL BOARD</p><h1 className="mt-1 text-3xl font-bold md:text-4xl">예매 전광판</h1></div><button type="button" onClick={() => void refresh()} className="flex items-center gap-2 rounded-md bg-surface px-3 py-2 text-sm"><RefreshCw className={busy ? "size-4 animate-spin" : "size-4"} />새로고침</button></header>
    <div className="mx-auto grid max-w-[1800px] grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      {IDS.filter((id) => enabled.includes(id)).map((id) => { const theater = THEATERS.find((t) => t.id === id)!; return <section key={id} className="min-w-0 rounded-2xl bg-surface p-4 shadow-border md:p-5"><h2 className="mb-4 text-xl font-bold md:text-2xl">{theater.shortName}</h2><div className="space-y-2">{(data[id] || []).map((show) => { const imax = show.formats.includes("imax") || /IMAX/i.test(show.hallName); return <a key={show.id} href={show.bookingUrl || "#"} target="_blank" rel="noreferrer" className="block rounded-xl bg-bg/60 p-3 ring-1 ring-border hover:bg-pick"><div className="flex justify-between gap-2"><b className="text-lg tabular-nums">{formatClock(show.startTime)}</b><span className={imax ? "rounded-full bg-open px-2 py-1 text-[11px] font-bold text-white" : "text-[11px] text-muted"}>{imax ? "IMAX" : show.hallName}</span></div><p className="mt-1 text-sm font-medium">{show.movieTitle}</p><div className="mt-2 flex justify-between text-xs"><b>잔여 <span className="text-base">{show.restSeats ?? "-"}</span>석</b><span className="text-muted">{seatFreshnessLabel(show) || "확인 대기"}</span></div></a>; })}</div></section>; })}
    </div>
    {updatedAt && <p className="mx-auto mt-4 max-w-[1800px] text-right text-xs text-muted">{formatClock(updatedAt)} 기준 · 60초 자동 갱신</p>}
  </main>;
}
