import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { THEATERS } from "@/lib/cinema/theaters";
import type { ScanResult, TheaterId } from "@/lib/cinema/types";
import { seatSourceLabel, timetableSourceLabel } from "@/lib/cinema/types";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { SourceStatus } from "./source-status";

const SOURCE_COLS: { id: string; label: string; keys: string[] }[] = [
  { id: "official", label: "공홈", keys: ["official", "megabox", "cgv"] },
  { id: "g-pc", label: "G_PC", keys: ["g-pc", "pc", "nas-report"] },
  { id: "g-nas", label: "G_NAS", keys: ["g-nas225+", "g-nas423+", "nas225", "nas423", "nas225+", "nas423+", "nas"] },
  { id: "kt", label: "KT 우회", keys: ["cgv-kt", "mega-mobile", "kt"] },
  { id: "naver", label: "네이버", keys: ["naver", "cgv-relay", "relay"] },
];

function sourceTimeLabel(value?: string) {
  if (!value) return "없음";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "없음";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function pickSourceTime(times: Record<string, string> | undefined, keys: string[]) {
  let best = "";
  let bestAt = 0;
  for (const key of keys) {
    const value = times?.[key];
    if (!value) continue;
    const at = new Date(value).getTime();
    if (!Number.isFinite(at)) continue;
    if (at >= bestAt) {
      bestAt = at;
      best = value;
    }
  }
  return best;
}

export function FormatChips({
  theaterId,
  onChange,
}: {
  theaterId: TheaterId;
  onChange?: () => void;
}) {
  const theater = THEATERS.find((t) => t.id === theaterId);
  const formats = useAppStore((s) => s.config.formats[theaterId] ?? []);
  const toggleFormat = useAppStore((s) => s.toggleFormat);
  const setTheaterFormats = useAppStore((s) => s.setTheaterFormats);
  if (!theater) return null;
  const ids = theater.formats.map((f) => f.id);
  const allOn = ids.length > 0 && ids.every((id) => formats.includes(id));
  return (
    <div className="flex flex-wrap gap-1.5">
      <button
        type="button"
        onClick={() => {
          setTheaterFormats(theater.id, allOn ? [] : ids);
          onChange?.();
        }}
        className={cn(
          "min-h-9 rounded-full px-3 text-xs font-medium transition-colors duration-150",
          allOn
            ? "bg-pick text-fg ring-1 ring-border-strong"
            : "bg-surface-2 text-fg ring-1 ring-border",
        )}
      >
        전체
      </button>
      {theater.formats.map((format) => {
        const on = formats.includes(format.id);
        return (
          <button
            key={format.id}
            type="button"
            onClick={() => {
              toggleFormat(theater.id, format.id);
              onChange?.();
            }}
            className={cn(
              "min-h-9 rounded-full px-3 text-xs transition-colors duration-150",
              on
                ? "bg-pick text-fg ring-1 ring-border-strong"
                : "bg-surface-2 text-fg ring-1 ring-border",
            )}
          >
            {format.label}
          </button>
        );
      })}
    </div>
  );
}

export function SettingsTheaterPicks({
  lastScan,
  onChange,
}: {
  lastScan?: ScanResult | null;
  onChange?: () => void;
}) {
  return (
    <>
      <h2 className="text-xs font-medium tracking-[0.16em] text-muted">
        감시 극장
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        제목을 누르면 그 극장 특별관이 전부 켜지거나 꺼집니다. 켜 특별관만
        알림이 갑니다. 상영시간·잔여석 출처는 마지막 조회 기준입니다.
      </p>
      <div className="mt-3 flex flex-col gap-2">
        {THEATERS.map((theater) => (
          <SettingsTheaterRow
            key={theater.id}
            theaterId={theater.id}
            lastScan={lastScan}
            onChange={onChange}
          />
        ))}
      </div>
      <ScanSourceBoard lastScan={lastScan ?? null} />
    </>
  );
}

function ScanSourceBoard({ lastScan }: { lastScan: ScanResult | null }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="mt-4 border-t border-border pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-11 w-full items-center justify-between gap-3 text-left"
      >
        <h2 className="text-xs font-medium tracking-[0.16em] text-muted">
          상영시간 및 잔여석 현황 출처
        </h2>
        <span className="shrink-0 text-xs text-muted">{open ? "접기" : "펼치기"}</span>
      </button>
      {open ? (
        <>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            상영시간과 잔여석 현황은 각각 실제 조회에 사용된 출처와 시각을 표시합니다.
            값이 없으면 「없음」입니다. 지금 시각을 「기준」으로 붙이지 않습니다.
          </p>
          <div className="mt-4">
            <p className="font-medium text-fg">상영시간 출처</p>
            <div className="mt-2 grid grid-cols-3 gap-x-3 gap-y-2 text-sm">
              <p className="text-xs text-muted">극장</p>
              <p className="text-xs text-muted">상영시간</p>
              <p className="text-xs text-muted">잔여석</p>
              {THEATERS.map((theater) => {
                const row = lastScan?.theaters.find((t) => t.theaterId === theater.id);
                return (
                  <div key={theater.id} className="contents">
                    <p className="text-fg">{theater.shortName}</p>
                    <p className="text-muted">{timetableSourceLabel(row?.source ?? "none", row?.ok ?? false)}</p>
                    <p className="text-muted">{seatSourceLabel(row?.seatSource)}</p>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="mt-5">
            <p className="font-medium text-fg">잔여석 현황 출처</p>
            <p className="mt-1 text-sm text-muted">
              각 경로에서 마지막으로 성공한 조회 시각입니다. 극장별 가장 최근 칸은 빨간색입니다.
            </p>
            <div className="mt-3 overflow-x-auto rounded-lg ring-1 ring-border">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-border bg-bg">
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted">극장</th>
                    {SOURCE_COLS.map((col) => (
                      <th key={col.id} className="px-3 py-2 text-left text-xs font-medium text-muted">
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {THEATERS.map((theater) => {
                    const times = lastScan?.seatSourceTimes?.[theater.id] ?? {};
                    const entries = SOURCE_COLS.map((col) => {
                      const value = pickSourceTime(times, col.keys);
                      return {
                        id: col.id,
                        value,
                        at: value ? new Date(value).getTime() : 0,
                      };
                    });
                    const latestAt = Math.max(0, ...entries.map((entry) => entry.at));
                    return (
                      <tr key={theater.id} className="border-b border-border last:border-b-0">
                        <th className="whitespace-nowrap px-3 py-2 text-left font-medium text-fg">
                          {theater.shortName}
                        </th>
                        {entries.map((entry) => (
                          <td
                            key={entry.id}
                            className={cn(
                              "whitespace-nowrap px-3 py-2 tabular-nums text-muted",
                              entry.at > 0 && entry.at === latestAt ? "font-medium text-danger" : "",
                            )}
                          >
                            {sourceTimeLabel(entry.value)}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function SettingsTheaterRow({
  theaterId,
  lastScan,
  onChange,
}: {
  theaterId: TheaterId;
  lastScan?: ScanResult | null;
  onChange?: () => void;
}) {
  const theater = THEATERS.find((t) => t.id === theaterId);
  const formats = useAppStore((s) => s.config.formats[theaterId] ?? []);
  const setTheaterFormats = useAppStore((s) => s.setTheaterFormats);
  const [open, setOpen] = useState(false);
  if (!theater) return null;
  const ids = theater.formats.map((f) => f.id);
  const allOn = ids.length > 0 && ids.every((id) => formats.includes(id));
  const someOn = formats.length > 0;
  const pack = lastScan?.theaters.find((row) => row.theaterId === theaterId);
  const summary = theater.formats
    .filter((f) => formats.includes(f.id))
    .map((f) => f.label)
    .join(" · ");
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl p-2 transition-colors",
        allOn
          ? "bg-pick ring-1 ring-border-strong"
          : someOn
            ? "bg-surface-2 ring-1 ring-border"
            : "bg-bg ring-1 ring-border",
      )}
    >
      <div className="flex items-stretch gap-2">
        <button
          type="button"
          onClick={() => {
            setTheaterFormats(theater.id, allOn ? [] : ids);
            onChange?.();
          }}
          className={cn(
            "min-h-11 min-w-0 flex-1 rounded-lg px-3 py-2 text-left",
            allOn ? "bg-pick ring-1 ring-border-strong" : "",
          )}
        >
          <p className="truncate text-sm font-bold text-fg">{theater.name}</p>
          <div className="mt-1">
            <SourceStatus
              source={pack?.source || "none"}
              seatSource={pack?.seatSource || "none"}
              ok={Boolean(pack?.ok)}
              quiet
            />
          </div>
          <p className="mt-0.5 truncate text-xs text-muted">
            {summary || "특별관 없음"}
          </p>
        </button>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex min-h-11 shrink-0 items-center gap-1 self-center rounded-md bg-bg px-3 text-xs text-muted ring-1 ring-border"
        >
          {open ? "접기" : "펼치기"}
          <ChevronDown
            className={cn("size-4 transition-transform", open && "rotate-180")}
            strokeWidth={1.75}
          />
        </button>
      </div>
      {open ? (
        <div className="mt-2 px-1 pb-1">
          <FormatChips theaterId={theater.id} onChange={onChange} />
        </div>
      ) : null}
    </div>
  );
}
