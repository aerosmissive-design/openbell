import { Trash2 } from "lucide-react";
import { useMemo } from "react";
import { THEATERS } from "@/lib/cinema/theaters";
import { useAppStore } from "@/lib/store";
import { cn, formatPlayDate, kstDateKeys } from "@/lib/utils";

function showSortKey(playDate: string, startTime: string) {
  const date = String(playDate || "").replace(/\D/g, "").padEnd(8, "0");
  const digits = String(startTime || "").replace(/\D/g, "");
  const padded = digits.length === 3 ? `0${digits}` : digits.padStart(4, "0");
  const hour = Number(padded.slice(0, Math.max(0, padded.length - 2)) || 0);
  const minute = padded.slice(-2);
  return `${date}-${String(hour).padStart(2, "0")}${minute}`;
}

function isPastShow(playDate: string, startTime: string) {
  const today = kstDateKeys(1)[0];
  const date = String(playDate || "").replace(/\D/g, "");
  if (date.length === 8 && date < today) return true;
  if (date.length === 8 && date > today) return false;
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const nowMin = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  const digits = String(startTime || "").replace(/\D/g, "");
  if (digits.length < 3) return false;
  const padded = digits.length === 3 ? `0${digits}` : digits.slice(0, 4);
  const hour = Number(padded.slice(0, padded.length - 2));
  const minute = Number(padded.slice(-2));
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return false;
  const showMin = (hour % 24) * 60 + minute + Math.floor(hour / 24) * 24 * 60;
  return showMin <= nowMin;
}

export function StarsView() {
  const queue = useAppStore((s) => s.queue);
  const dequeue = useAppStore((s) => s.dequeue);

  const rows = useMemo(
    () =>
      [...queue].sort((a, b) =>
        showSortKey(a.playDate, a.startTime).localeCompare(showSortKey(b.playDate, b.startTime)),
      ),
    [queue],
  );

  if (!queue.length) {
    return (
      <div className="rounded-xl bg-surface px-5 py-10 text-center shadow-border">
        <p className="text-xl font-bold text-fg">별표한 상영 없음</p>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          감시 탭에서 별표를 누르면 여기 모입니다. 잔여석이 늘거나 줄면
          메일·카톡·텔레그램으로 알려 드립니다.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-xs font-medium tracking-[0.16em] text-muted">
        별표 {queue.length}건
      </h2>
      <p className="text-sm leading-relaxed text-muted">
        예매를 누르면 극장 화면으로 갑니다. 잔여석이 늘거나 줄면 알려 드립니다.
      </p>
      <ul className="flex flex-col gap-2">
        {rows.map((item) => {
          const past = isPastShow(item.playDate, item.startTime);
          const theater = THEATERS.find((t) => t.id === item.theaterId);
          return (
            <li
              key={item.id}
              className={cn(
                "flex items-center gap-2 rounded-xl bg-surface px-3 py-3 shadow-border",
                past && "opacity-55",
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-fg">{item.movieTitle}</p>
                <p className="truncate text-[11px] text-muted">
                  {theater?.shortName || theater?.name || item.theaterId}
                  {" · "}
                  {formatPlayDate(item.playDate)} {item.startTime}
                  {" · "}
                  {item.hallName}
                  {item.restSeats != null
                    ? item.totalSeats != null
                      ? ` · ${item.restSeats}/${item.totalSeats}`
                      : ` · 잔여 ${item.restSeats}`
                    : ""}
                </p>
              </div>
              <a
                href={item.bookingUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-7 shrink-0 items-center justify-center rounded-full bg-open px-2.5 text-[11px] font-medium text-open-fg"
              >
                예매
              </a>
              <button
                type="button"
                className="flex size-9 shrink-0 items-center justify-center text-muted"
                onClick={() => dequeue(item.id)}
                aria-label="별표 해제"
              >
                <Trash2 className="size-4" strokeWidth={1.75} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
