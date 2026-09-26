import { Trash2 } from "lucide-react";
import { useMemo } from "react";
import { THEATERS } from "@/lib/cinema/theaters";
import { useAppStore } from "@/lib/store";
import { formatPlayDate, kstDateKeys } from "@/lib/utils";

function showSortKey(playDate: string, startTime: string) {
  return `${playDate}-${String(startTime || "").padStart(5, "0")}`;
}

function isPastShow(playDate: string, startTime: string) {
  const today = kstDateKeys(1)[0];
  if (playDate < today) return true;
  if (playDate > today) return false;
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const hh = String(kst.getUTCHours()).padStart(2, "0");
  const mm = String(kst.getUTCMinutes()).padStart(2, "0");
  return String(startTime || "") < `${hh}:${mm}`;
}

export function StarsView() {
  const queue = useAppStore((s) => s.queue);
  const dequeue = useAppStore((s) => s.dequeue);

  const { upcoming, past } = useMemo(() => {
    const next = [];
    const gone = [];
    for (const item of queue) {
      if (isPastShow(item.playDate, item.startTime)) gone.push(item);
      else next.push(item);
    }
    const byTime = (a: (typeof queue)[number], b: (typeof queue)[number]) =>
      showSortKey(a.playDate, a.startTime).localeCompare(showSortKey(b.playDate, b.startTime));
    next.sort(byTime);
    gone.sort(byTime);
    return { upcoming: next, past: gone };
  }, [queue]);

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
      {upcoming.length ? (
        <ul className="flex flex-col gap-2">
          {upcoming.map((item) => (
            <StarRow key={item.id} item={item} onRemove={() => dequeue(item.id)} />
          ))}
        </ul>
      ) : null}
      {past.length ? (
        <div className="mt-2">
          <h3 className="mb-2 text-[11px] tracking-[0.12em] text-muted">지난 회차 {past.length}건</h3>
          <ul className="flex flex-col gap-2">
            {past.map((item) => (
              <StarRow key={item.id} item={item} past onRemove={() => dequeue(item.id)} />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function StarRow({
  item,
  past,
  onRemove,
}: {
  item: {
    id: string;
    theaterId: string;
    movieTitle: string;
    playDate: string;
    startTime: string;
    hallName: string;
    bookingUrl: string;
    restSeats: number | null;
    totalSeats: number | null;
  };
  past?: boolean;
  onRemove: () => void;
}) {
  const theater = THEATERS.find((t) => t.id === item.theaterId);
  return (
    <li className={`flex items-center gap-2 rounded-xl bg-surface px-3 py-3 shadow-border ${past ? "opacity-55" : ""}`}>
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
            : " · 정보 없음"}
        </p>
      </div>
      {!past ? (
        <a
          href={item.bookingUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-7 shrink-0 items-center justify-center rounded-full bg-open px-2.5 text-[11px] font-medium text-open-fg"
        >
          예매
        </a>
      ) : (
        <span className="shrink-0 text-[11px] text-muted">지난 회차</span>
      )}
      <button
        type="button"
        className="flex size-9 shrink-0 items-center justify-center text-muted"
        onClick={onRemove}
        aria-label="별표 해제"
      >
        <Trash2 className="size-4" strokeWidth={1.75} />
      </button>
    </li>
  );
}
