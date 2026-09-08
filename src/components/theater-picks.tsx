import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { THEATERS } from "@/lib/cinema/theaters";
import type { TheaterId } from "@/lib/cinema/types";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";

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

export function SettingsTheaterPicks({ onChange }: { onChange?: () => void }) {
  return (
    <>
      <h2 className="text-xs font-medium tracking-[0.16em] text-muted">
        감시 극장
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        제목을 누르면 그 극장 특별관이 전부 켜지거나 꺼집니다. 켠 특별관만
        알림이 갑니다.
      </p>
      <div className="mt-3 flex flex-col gap-2">
        {THEATERS.map((theater) => (
          <SettingsTheaterRow
            key={theater.id}
            theaterId={theater.id}
            onChange={onChange}
          />
        ))}
      </div>
    </>
  );
}

function SettingsTheaterRow({
  theaterId,
  onChange,
}: {
  theaterId: TheaterId;
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