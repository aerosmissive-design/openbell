import { useAutoBook } from "@/lib/auto-book-store";
import { GOLDEN_ROWS } from "@/lib/cinema/golden-rows";
import { THEATERS } from "@/lib/cinema/theaters";
import { useAppStore } from "@/lib/store";
import { formatPlayDate } from "@/lib/utils";

export function BellView() {
  const watchTitles = useAppStore((s) => s.config.watchTitles);
  const toggleWatchTitle = useAppStore((s) => s.toggleWatchTitle);
  const movies = useAutoBook((s) => s.movies);
  const shows = useAutoBook((s) => s.shows);
  const removeMovie = useAutoBook((s) => s.removeMovie);
  const removeShow = useAutoBook((s) => s.removeShow);

  return (
    <div className="flex flex-col gap-5">
      <section>
        <h2 className="text-xs font-medium tracking-[0.16em] text-muted">알림 설정 영화</h2>
        {watchTitles.length ? (
          <ul className="mt-2 flex flex-col gap-2">
            {watchTitles.map((title) => (
              <li key={title} className="flex items-center justify-between rounded-xl bg-surface px-3 py-3 shadow-border">
                <span className="text-sm text-fg">{title}</span>
                <button type="button" className="text-[11px] text-muted" onClick={() => toggleWatchTitle(title)}>빼기</button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted">차트에서 알림설정을 누르면 여기 모입니다.</p>
        )}
      </section>
      <section>
        <h2 className="text-xs font-medium tracking-[0.16em] text-muted">자동예매 영화</h2>
        <p className="mt-1 text-[11px] leading-relaxed text-muted">계정에 저장됩니다. 이 목록에 있는 영화는 지금 떠 있는 회차와 나중에 열리는 회차를 한 번씩 결제 직전까지 잡습니다.</p>
        {movies.length ? (
          <ul className="mt-2 flex flex-col gap-2">
            {movies.map((m) => (
              <li key={m.title} className="flex items-center justify-between rounded-xl bg-surface px-3 py-3 shadow-border">
                <span className="text-sm text-fg">{m.title} · {m.seats}명</span>
                <button type="button" className="text-[11px] text-muted" onClick={() => removeMovie(m.title)}>빼기</button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted">차트에서 자동예매를 누르세요.</p>
        )}
      </section>
      <section>
        <h2 className="text-xs font-medium tracking-[0.16em] text-muted">자동예매 회차</h2>
        <p className="mt-1 text-[11px] leading-relaxed text-muted">계정에 저장됩니다. 그 회차가 상영표에 있으면 잡고, 잔여석이 변하면 다시 잡습니다.</p>
        {shows.length ? (
          <ul className="mt-2 flex flex-col gap-2">
            {shows.map((row) => (
              <li key={row.id} className="flex items-center justify-between rounded-xl bg-surface px-3 py-3 shadow-border">
                <div className="min-w-0">
                  <p className="truncate text-sm text-fg">{row.title} · {row.seats}명</p>
                  <p className="truncate text-[11px] text-muted">{THEATERS.find((t) => t.id === row.theaterId)?.shortName || row.theaterId} · {formatPlayDate(row.playDate)} {row.startTime} · {row.hallName}</p>
                </div>
                <button type="button" className="shrink-0 text-[11px] text-muted" onClick={() => removeShow(row.id)}>빼기</button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted">별표한 회차에서 자동예매를 누르세요.</p>
        )}
      </section>
      <section>
        <h2 className="text-xs font-medium tracking-[0.16em] text-muted">황금열 (여론)</h2>
        <ul className="mt-2 flex flex-col gap-2">
          {THEATERS.map((t) => (
            <li key={t.id} className="rounded-xl bg-surface px-3 py-3 text-[12px] leading-relaxed text-muted shadow-border">
              <span className="text-fg">{t.shortName || t.name}</span>
              {" · "}
              {GOLDEN_ROWS[t.id]?.note}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
