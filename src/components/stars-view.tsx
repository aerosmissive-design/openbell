import { Trash2 } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { formatPlayDate } from "@/lib/utils";

export function StarsView() {
  const queue = useAppStore((s) => s.queue);
  const dequeue = useAppStore((s) => s.dequeue);

  if (!queue.length) {
    return (
      <div className="rounded-xl bg-surface px-5 py-10 text-center shadow-border">
        <p className="text-xl font-bold text-fg">별표한 회차 없음</p>
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
        {queue.map((item) => (
          <li
            key={item.id}
            className="flex items-center gap-2 rounded-xl bg-surface px-3 py-3 shadow-border"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-fg">{item.movieTitle}</p>
              <p className="truncate text-[11px] text-muted">
                {formatPlayDate(item.playDate)} {item.startTime} · {item.hallName}
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
        ))}
      </ul>
    </div>
  );
}
