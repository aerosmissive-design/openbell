import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { loadBoardData } from "@/lib/cinema/scan";
import { seatFreshnessLabel } from "@/lib/cinema/seats";
import { THEATERS } from "@/lib/cinema/theaters";
import type { Showtime, TheaterId } from "@/lib/cinema/types";
import { useAppStore } from "@/lib/store";
import { decodeHtml } from "@/lib/utils";
import { seatSourceLabel } from "@/lib/cinema/types";

type BoardTheaterBlock = {
  theaterId: TheaterId;
  theaterName: string;
  source: string;
  reportedAt: string | null;
  count: number;
  showtimes: Showtime[];
};

const IDS: TheaterId[] = [
  "cgv_yongsan",
  "cgv_yeongdeungpo",
  "megabox_coex",
  "megabox_namyangju",
];

function formatBoardTimestamp(iso: string | null): string {
  if (!iso) return "—";
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "";
  return `${get("month")}.${get("day")}일 ${get("hour")}:${get("minute")}`;
}

function formatPlayDate(playDate: string | null | undefined): string {
  if (!playDate) return "";
  const raw = String(playDate).trim();
  if (/^\d{8}$/.test(raw)) {
    const m = Number(raw.slice(4, 6));
    const d = Number(raw.slice(6, 8));
    return `${m}/${d}`;
  }
  const m = raw.match(/(\d{4})[-./]?(\d{1,2})[-./]?(\d{1,2})/);
  if (m) return `${Number(m[2])}/${Number(m[3])}`;
  return raw;
}

function isImax(show: Showtime) {
  return show.formats?.includes("imax") || /imax|아이맥스/i.test(`${show.hallName} ${show.movieTitle}`);
}

function seatTone(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "neutral";
  if (n === 0) return "zero";
  if (n <= 5) return "low";
  return "good";
}

export function BoardView() {
  const config = useAppStore((s) => s.config);
  const [blocks, setBlocks] = useState<BoardTheaterBlock[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateFilter, setDateFilter] = useState("all");
  const [search, setSearch] = useState("");

  const enabled = useMemo(
    () => IDS.filter((id) => config.theaters?.[id] !== false),
    [config.theaters],
  );

  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      const data = await loadBoardData({ data: { theaters: enabled } });
      setBlocks(data.theaters);
      setUpdatedAt(data.scannedAt);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [enabled.join(",")]);

  useEffect(() => {
    const id = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(id);
  }, [enabled.join(",")]);

  const allDates = useMemo(() => {
    const set = new Set<string>();
    for (const b of blocks) for (const s of b.showtimes) if (s.playDate) set.add(s.playDate);
    return [...set].sort();
  }, [blocks]);

  const filteredBlocks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return blocks.map((b) => {
      const showtimes = b.showtimes.filter((s) => {
        if (dateFilter !== "all" && s.playDate !== dateFilter) return false;
        if (!q) return true;
        return `${s.movieTitle} ${s.hallName}`.toLowerCase().includes(q);
      });
      return { ...b, showtimes };
    });
  }, [blocks, dateFilter, search]);

  const totalRows = filteredBlocks.reduce((n, b) => n + b.showtimes.length, 0);

  return (
    <main className="min-h-dvh bg-[#090d16] px-3 py-4 text-[#eef2f8] md:px-5 lg:px-6">
      <div className="mx-auto max-w-[1600px]">
        <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] tracking-[0.18em] text-[#7b879e]">OPENBELL BOARD · 취합 전광판</p>
            <h1 className="mt-1 text-2xl font-bold md:text-3xl">예매 전광판</h1>
            <p className="mt-1 text-xs text-[#9aa6bf]">
              PC Reporter · NAS 등 서버로 들어온 잔여석을 취합합니다. 로그인 없이 열 수 있습니다.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            className="flex items-center gap-2 rounded-lg border border-[#25324b] bg-[#111827] px-3 py-2 text-sm hover:border-[#3d4f73]"
          >
            <RefreshCw className={busy ? "size-4 animate-spin" : "size-4"} />
            새로고침
          </button>
        </header>

        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-xl border border-[#25324b] bg-[#111827] px-3 py-2">
            <div className="text-[11px] text-[#7b879e]">표시 회차</div>
            <div className="text-lg font-semibold tabular-nums">{totalRows}</div>
          </div>
          <div className="rounded-xl border border-[#25324b] bg-[#111827] px-3 py-2">
            <div className="text-[11px] text-[#7b879e]">감시 극장</div>
            <div className="text-lg font-semibold">{enabled.length}곳</div>
          </div>
          <div className="rounded-xl border border-[#25324b] bg-[#111827] px-3 py-2">
            <div className="text-[11px] text-[#7b879e]">마지막 갱신</div>
            <div className="text-sm font-medium">{formatBoardTimestamp(updatedAt)}</div>
          </div>
          <div className="rounded-xl border border-[#25324b] bg-[#111827] px-3 py-2">
            <div className="text-[11px] text-[#7b879e]">자동 갱신</div>
            <div className="text-sm font-medium">30초</div>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <select
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="rounded-lg border border-[#25324b] bg-[#111827] px-3 py-2 text-sm"
          >
            <option value="all">전체 날짜</option>
            {allDates.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="영화명 / 관 검색"
            className="min-w-[180px] flex-1 rounded-lg border border-[#25324b] bg-[#111827] px-3 py-2 text-sm outline-none focus:border-[#3d4f73]"
          />
          {error && <span className="text-sm text-[#ff6b7a]">{error}</span>}
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {filteredBlocks.map((block) => {
            const meta = THEATERS.find((t) => t.id === block.theaterId);
            return (
              <section
                key={block.theaterId}
                className="flex min-h-[280px] min-w-0 flex-col overflow-hidden rounded-2xl border border-[#25324b] bg-[#111827]"
              >
                <div className="border-b border-[#25324b] px-3 py-2.5">
                  <h2 className="text-base font-bold md:text-lg">{block.theaterName || meta?.name}</h2>
                  <p className="mt-0.5 text-[11px] text-[#7b879e]">
                    {block.source !== "none" ? block.source : "출처 없음"}
                    {block.reportedAt ? ` · ${formatBoardTimestamp(block.reportedAt)} 수신` : ""}
                    {` · ${block.showtimes.length}회차`}
                  </p>
                </div>
                <div className="flex-1 space-y-1.5 overflow-y-auto p-2" style={{ maxHeight: "70vh" }}>
                  {block.showtimes.length === 0 ? (
                    <div className="px-3 py-8 text-center text-xs text-[#7b879e]">회차 없음</div>
                  ) : (
                    block.showtimes.slice(0, 500).map((show) => {
                      const tone = seatTone(show.restSeats);
                      const imax = isImax(show);
                      const ring =
                        tone === "zero"
                          ? "ring-[#ff6b7a]/30"
                          : tone === "low"
                            ? "ring-[#ffd166]/25"
                            : "ring-[#62e6a1]/15";
                      const seatColor =
                        tone === "zero"
                          ? "text-[#ff6b7a]"
                          : tone === "low"
                            ? "text-[#ffd166]"
                            : "text-[#62e6a1]";
                      const srcLabel =
                        seatSourceLabel(show.seatSource) !== "없음"
                          ? seatSourceLabel(show.seatSource)
                          : block.source !== "none"
                            ? seatSourceLabel(block.source)
                            : "—";
                      return (
                        <a
                          key={show.id}
                          href={show.bookingUrl || "#"}
                          target="_blank"
                          rel="noreferrer"
                          className={`block rounded-xl bg-[#090d16]/80 p-2.5 ring-1 ${ring} hover:bg-[#162033]`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <b className="text-base tabular-nums">
                              {formatPlayDate(show.playDate)
                                ? `${formatPlayDate(show.playDate)} ${show.startTime}`
                                : show.startTime}
                            </b>
                            <span
                              className={
                                imax
                                  ? "rounded-full bg-[#e879f9]/20 px-2 py-0.5 text-[10px] font-bold text-[#e879f9]"
                                  : "text-[11px] text-[#7b879e]"
                              }
                            >
                              {imax ? "IMAX" : decodeHtml(show.hallName || "")}
                            </span>
                          </div>
                          <p className="mt-1 text-sm font-medium leading-snug">{decodeHtml(show.movieTitle)}</p>
                          <div className="mt-1.5 flex flex-col gap-0.5 text-xs">
                            <div className="flex items-center justify-between gap-2">
                              <b className={seatColor}>
                                {show.restSeats ?? "-"}
                                {show.totalSeats != null ? ` / ${show.totalSeats}` : ""}석
                                {tone === "zero" ? " · 매진" : tone === "low" ? " · 잔여 적음" : " · 잔여"}
                              </b>
                              <span className="text-[#7b879e]">{seatFreshnessLabel(show) || ""}</span>
                            </div>
                            <div className="text-right text-[10px] tabular-nums text-[#9aa6bf]">출처 {srcLabel}</div>
                          </div>
                        </a>
                      );
                    })
                  )}
                </div>
              </section>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#7b879e]">
          <div className="flex flex-wrap gap-3">
            <span className="text-[#62e6a1]">● 여유</span>
            <span className="text-[#ffd166]">● 임박</span>
            <span className="text-[#ff6b7a]">● 매진</span>
            <span className="text-[#e879f9]">● IMAX</span>
          </div>
          <p>
            {updatedAt ? `${formatBoardTimestamp(updatedAt)} 기준` : "—"} · 30초 자동 갱신 · 로그인 불필요
          </p>
        </div>
      </div>
    </main>
  );
}
