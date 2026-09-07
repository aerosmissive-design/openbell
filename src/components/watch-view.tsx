import { ChevronDown, RefreshCw, Star } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { intentFromShowtime } from "@/lib/cinema/auto-booking";
import { selectedMovies, titlesMatch, titleInSet, watchedTitleSet } from "@/lib/cinema/match";
import { countSeatHits, describeSeatPing } from "@/lib/cinema/seats";
import { pullTheaterSeats } from "@/lib/cinema/scan";
import { THEATERS } from "@/lib/cinema/theaters";
import type { MovieTab, RankingMovie, ScanProps, Showtime, TheaterId } from "@/lib/cinema/types";
import { CHART_SIZE } from "@/lib/cinema/types";
import { useAppStore } from "@/lib/store";
import { cn, formatPlayDate, kstDateKeys, normalizeTitle } from "@/lib/utils";

export function WatchView({ scan, loading, error, onRefresh, refreshing }: ScanProps) {
  const config = useAppStore((s) => s.config);
  const setConfig = useAppStore((s) => s.setConfig);
  const enqueue = useAppStore((s) => s.enqueue);
  const dequeue = useAppStore((s) => s.dequeue);
  const queue = useAppStore((s) => s.queue);
  const alerts = useAppStore((s) => s.alerts);
  const onlyAlerted = useAppStore((s) => s.onlyAlerted);
  const setOnlyAlerted = useAppStore((s) => s.setOnlyAlerted);
  const movieTab = config.movieTab ?? "chart";
  const movies = selectedMovies(scan?.ranking ?? [], scan?.showing ?? [], config);
  const titles = watchedTitleSet(scan?.ranking ?? [], config);
  const enabledTheaters = THEATERS;
  const alertedShows = new Set(alerts.map(alertShowKey));
  const catalog = (
    movieTab === "showing" ? (scan?.showing ?? []) : (scan?.ranking ?? [])
  ).slice(0, CHART_SIZE);

  const theaterRows = enabledTheaters
    .map((theater) => {
      const result = scan?.theaters.find((t) => t.theaterId === theater.id);
      const formats = config.formats[theater.id] ?? [];
      const shows = (result?.showtimes ?? []).filter((s) => {
        if (formats.length && !s.formats.some((f) => formats.includes(f))) {
          return false;
        }
        if (titles.size && !titleInSet(s.movieTitle, titles)) return false;
        if (onlyAlerted && !alertedShows.has(showAlertKey(s))) return false;
        return true;
      });
      return { theater, result, shows };
    })
    .filter((row) => !onlyAlerted || row.shows.length > 0);

  return (
    <div className="flex flex-col gap-6">
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-medium tracking-[0.16em] text-muted">
            감시 영화
          </h2>
          <button
            type="button"
            onClick={onRefresh}
            className="flex min-h-9 items-center gap-1.5 text-xs text-muted"
          >
            <RefreshCw
              className={cn("size-3.5", refreshing && "animate-spin")}
              strokeWidth={1.75}
            />
            다시 조회
          </button>
        </div>
        <div className="mb-3 grid grid-cols-2 gap-2">
          {([
            ["chart", "무비차트"],
            ["showing", "현재상영작"],
          ] as [MovieTab, string][]).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setConfig({ movieTab: id })}
              className={cn(
                "min-h-11 rounded-md text-sm",
                movieTab === id
                  ? "bg-pick text-fg ring-1 ring-border-strong"
                  : "bg-surface text-muted shadow-border",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="mb-3 text-xs leading-relaxed text-faint">
          {movieTab === "chart"
            ? "예매율 1~9위입니다. 포스터를 누르면 알림설정. 새 회차가 열리면 텔레그램으로 옵니다."
            : "이미 개봉한 영화만, 예매율 순 9편입니다. 포스터를 누르면 알림설정입니다."}
        </p>
        {loading && !scan ? (
          <div className="grid grid-cols-3 gap-2">
            {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <div key={i} className="aspect-[3/4] rounded-lg bg-surface" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {(catalog.length
              ? catalog
              : [1, 2, 3, 4, 5, 6, 7, 8, 9].map((rank) => ({
                  rank,
                  title: "순위 대기",
                  movieNo: "",
                  bookingRate: null,
                  posterUrl: null,
                  releaseDate: null,
                  bookingOpen: false,
                  released: false,
                }))
            ).map((movie) => (
              <MovieCard
                key={`${movie.movieNo}-${movie.rank}-${movie.title}`}
                movie={movie}
                mode={movieTab}
              />
            ))}
          </div>
        )}
        <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md bg-surface px-3 text-sm text-fg shadow-border">
          <input
            type="checkbox"
            checked={onlyAlerted}
            onChange={(e) => setOnlyAlerted(e.target.checked)}
            className="size-4 shrink-0 accent-notify"
          />
          알림 뜬 관만 표시
        </label>
      </section>

      {error ? (
        <p className="rounded-lg bg-surface px-4 py-3 text-sm text-danger">
          {error.message}
        </p>
      ) : null}

      {onlyAlerted && !theaterRows.length ? (
        <p className="rounded-xl bg-surface px-4 py-8 text-center text-sm text-muted shadow-border">
          알림 탭에 뜬 회차가 아직 없습니다.
        </p>
      ) : (
      <div className="flex flex-col gap-3">
      {theaterRows.map(({ theater, result, shows }) => (
          <TheaterBlock
            key={theater.id}
            theaterId={theater.id}
            ok={result?.ok ?? true}
            error={onlyAlerted ? null : (result?.error ?? null)}
            source={result?.source ?? ""}
            movies={movies}
            shows={shows}
            allShows={result?.showtimes ?? []}
            otherOpens={theaterRows
              .filter((row) => row.theater.id !== theater.id)
              .flatMap((row) =>
                row.shows.map((s) => ({
                  theaterName: row.theater.shortName,
                  show: s,
                })),
              )}
            alertedShows={alertedShows}
            onlyAlerted={onlyAlerted}
            onQueue={(show) => {
              const item = intentFromShowtime(show);
              const exists = queue.some((q) => q.id === item.id);
              if (exists) {
                dequeue(item.id);
                toast("별표를 해제했습니다.");
                return;
              }
              enqueue(item);
              toast.success("별표에 담았습니다.");
            }}
          />
      ))}
      </div>
      )}
    </div>
  );
}

function MovieCard({
  movie,
  mode,
}: {
  movie: RankingMovie;
  mode: MovieTab;
}) {
  const ranks = useAppStore((s) => s.config.ranks);
  const watchTitles = useAppStore((s) => s.config.watchTitles);
  const toggleRank = useAppStore((s) => s.toggleRank);
  const toggleWatchTitle = useAppStore((s) => s.toggleWatchTitle);
  const selected =
    mode === "chart"
      ? ranks.includes(movie.rank)
      : watchTitles.some(
          (t) => normalizeTitle(t) === normalizeTitle(movie.title),
        );
  return (
    <button
      type="button"
      onClick={() =>
        mode === "chart" ? toggleRank(movie.rank) : toggleWatchTitle(movie.title)
      }
      className={cn(
        "rise-in flex flex-col rounded-lg bg-surface text-left shadow-border transition-[box-shadow,outline-color] duration-150",
        selected && "outline outline-2 outline-offset-2 outline-notify",
      )}
    >
      <div className="relative aspect-[3/4] min-h-[8.5rem] overflow-hidden rounded-t-lg bg-surface-2">
        {movie.posterUrl ? (
          <img
            src={movie.posterUrl}
            alt=""
            loading="lazy"
            className={cn(
              "size-full object-cover outline outline-1 -outline-offset-1 outline-fg/10",
              !selected && "opacity-80",
            )}
          />
        ) : (
          <div className="flex size-full items-center justify-center text-2xl font-semibold text-faint">
            {movie.rank || "·"}
          </div>
        )}
        <span className="absolute left-1.5 top-1.5 rounded-sm bg-bg/80 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-fg">
          {movie.rank}위
        </span>
        {mode === "chart" && !movie.released ? (
          <span className="absolute right-1.5 top-1.5 rounded-sm bg-wait/90 px-1.5 py-0.5 text-[10px] text-wait-fg">
            {releaseBadge(movie.releaseDate) ?? "개봉전"}
          </span>
        ) : null}
        {selected ? (
          <span className="absolute bottom-1.5 left-1.5 rounded-sm bg-notify px-1.5 py-0.5 text-[10px] font-medium text-notify-fg">
            알림설정
          </span>
        ) : null}
      </div>
      <div className="px-2 py-2">
        <p className="line-clamp-2 text-[12px] font-medium leading-snug text-fg">
          {movie.title}
        </p>
        <p className="mt-1 text-[10px] tabular-nums text-muted">
          {movie.bookingRate != null ? `예매 ${movie.bookingRate}%` : "예매율 —"}
          {mode === "chart" && !movie.released
            ? ` · ${releaseBadge(movie.releaseDate) ?? "개봉전"}`
            : movie.released && movie.releaseDate
              ? ` · ${formatPlayDate(movie.releaseDate)}`
              : ""}
        </p>
      </div>
    </button>
  );
}

function TheaterBlock({
  theaterId,
  ok,
  error,
  source: _source,
  movies,
  shows,
  allShows,
  otherOpens,
  alertedShows,
  onlyAlerted,
  onQueue,
}: {
  theaterId: TheaterId;
  ok: boolean;
  error: string | null;
  source: string;
  movies: RankingMovie[];
  shows: Showtime[];
  allShows: Showtime[];
  otherOpens: { theaterName: string; show: Showtime }[];
  alertedShows: Set<string>;
  onlyAlerted: boolean;
  onQueue: (show: Showtime) => void;
}) {
  const theater = THEATERS.find((t) => t.id === theaterId);
  const formats = useAppStore((s) => s.config.formats[theaterId] ?? []);
  const toggleFormat = useAppStore((s) => s.toggleFormat);
  const gasWebUrl = useAppStore((s) => s.config.gasWebUrl);
  const daysAhead = useAppStore((s) => s.config.daysAhead);
  const mergeSeatMap = useAppStore((s) => s.mergeSeatMap);
  const [seatBusy, setSeatBusy] = useState(false);
  const [open, setOpen] = useState(false);
  if (!theater) return null;
  const current = theater;
  const missingSeats =
    ok && shows.length > 0 && !shows.some((s) => s.restSeats != null);
  const formatSummary = theater.formats
    .filter((f) => formats.includes(f.id))
    .map((f) => f.label)
    .join(" · ");

  async function refreshSeats() {
    setSeatBusy(true);
    try {
      const result = await pullTheaterSeats({
        url: gasWebUrl.trim() || undefined,
        theaterId,
        daysAhead: Math.min(Math.max(daysAhead || 7, 1), 14),
        fresh: true,
      });
      const map = result.map ?? {};
      if (Object.keys(map).length) mergeSeatMap(map);
      const watchHits = countSeatHits(shows, map);
      const allHits = countSeatHits(allShows, map);
      if (watchHits > 0) {
        toast.success(`${current.shortName} ${watchHits}개 회차에 잔여석을 붙였습니다.`);
        return;
      }
      if (allHits > 0) {
        toast.success(`${current.shortName} ${allHits}개 회차에 잔여석을 붙였습니다.`);
        return;
      }
      if (!shows.length) {
        toast(`${current.shortName}에는 지금 감시 중인 특별관 회차가 없습니다.`);
        return;
      }
      if (shows.some((s) => s.restSeats != null)) {
        toast("공홈이 잠깐 안 됩니다. 화면에 있는 잔여석을 유지합니다.");
        return;
      }
      toast.error(
        Object.keys(map).length
          ? "잔여석 숫자는 받았는데 이 극장 시간표와 짝이 안 맞습니다. 다시 눌러 보세요."
          : describeSeatPing(result).text,
      );
    } catch (err) {
      if (shows.some((s) => s.restSeats != null)) {
        toast("공홈이 잠깐 안 됩니다. 화면에 있는 잔여석을 유지합니다.");
        return;
      }
      toast.error(err instanceof Error ? err.message : "불러오지 못했습니다.");
    } finally {
      setSeatBusy(false);
    }
  }

  return (
    <section className="rise-in flex flex-col overflow-hidden rounded-xl bg-surface p-3 shadow-border">
      <header className="flex items-start gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-h-11 min-w-0 flex-1 items-center justify-between gap-3 rounded-lg bg-surface-2 px-3 py-2.5 text-left ring-1 ring-border"
        >
          <div className="min-w-0">
            <h2 className="truncate text-xl font-bold leading-tight text-fg">
              {theater.name}
            </h2>
            <p className="mt-1 truncate text-xs text-muted">
              {formatSummary || "특별관 없음"}
              {ok
                ? ` · ${shows.length}회`
                : " · 조회 실패"}
            </p>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted">
            {open ? "접기" : "펼치기"}
            <ChevronDown
              className={cn("size-4 transition-transform", open && "rotate-180")}
              strokeWidth={1.75}
            />
          </span>
        </button>
        <button
          type="button"
          onClick={() => {
            void refreshSeats();
          }}
          disabled={seatBusy}
          className="inline-flex min-h-11 shrink-0 items-center gap-1.5 self-center rounded-md bg-bg px-3 text-xs text-fg ring-1 ring-border-strong disabled:opacity-40"
        >
          <RefreshCw
            className={cn("size-3.5", seatBusy && "animate-spin")}
            strokeWidth={1.75}
          />
          잔여석
        </button>
      </header>

      {open ? (
        <div className="mt-3 border-t border-border pt-3">
          <div className="flex flex-wrap gap-1.5">
            {theater.formats.map((format) => {
              const on = formats.includes(format.id);
              return (
                <button
                  key={format.id}
                  type="button"
                  onClick={() => toggleFormat(theater.id, format.id)}
                  className={cn(
                    "min-h-9 rounded-full px-3 text-xs transition-colors duration-150",
                    on
                      ? "bg-accent text-accent-fg"
                      : "bg-surface-2 text-fg ring-1 ring-border",
                  )}
                >
                  {format.label}
                </button>
              );
            })}
          </div>

          {missingSeats ? (
            <p className="mt-3 text-xs leading-relaxed text-faint">
              잔여석은 오른쪽 「잔여석」을 누르면 이 극장만 다시 붙습니다.
            </p>
          ) : null}

          {error ? (
            <div className="mt-4 rounded-md bg-bg px-3 py-3">
              <p className="text-sm text-danger">시간표를 못 가져왔습니다.</p>
              <p className="mt-1 text-xs leading-relaxed text-muted">{error}</p>
              <a
                href={theater.bookingUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex min-h-9 items-center text-xs text-fg underline-offset-2 hover:underline"
              >
                극장 페이지 열기
              </a>
            </div>
          ) : null}

          {ok ? (
            <div className="mt-3 space-y-3">
              {movies
                .map((movie) => {
                  const list = shows
                    .filter((s) => titlesMatch(s.movieTitle, movie.title))
                    .sort((a, b) =>
                      a.playDate === b.playDate
                        ? a.startTime.localeCompare(b.startTime)
                        : a.playDate.localeCompare(b.playDate),
                    );
                  const elsewhere = otherOpens.filter((row) =>
                    titlesMatch(row.show.movieTitle, movie.title),
                  );
                  return { movie, list, elsewhere };
                })
                .filter(({ list, elsewhere }) => !onlyAlerted || list.length > 0)
                .sort((a, b) => {
                  const aHit = a.list.some((s) => alertedShows.has(showAlertKey(s))) ? 0 : 1;
                  const bHit = b.list.some((s) => alertedShows.has(showAlertKey(s))) ? 0 : 1;
                  return aHit - bHit;
                })
                .map(({ movie, list, elsewhere }) => (
                  <MovieTimes
                    key={movie.movieNo || movie.rank}
                    movie={movie}
                    shows={list}
                    elsewhere={elsewhere}
                    alertedShows={alertedShows}
                    onQueue={onQueue}
                  />
                ))}
              {!movies.length ? (
                <p className="text-sm text-muted">상영 랭킹을 불러오는 중입니다.</p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function MovieTimes({
  movie,
  shows,
  elsewhere,
  alertedShows,
  onQueue,
}: {
  movie: RankingMovie;
  shows: Showtime[];
  elsewhere: { theaterName: string; show: Showtime }[];
  alertedShows: Set<string>;
  onQueue: (show: Showtime) => void;
}) {
  const flagged = shows.filter((s) => alertedShows.has(showAlertKey(s)));
  const rest = shows.filter((s) => !alertedShows.has(showAlertKey(s)));
  const visible = [...flagged, ...rest].slice(0, Math.max(8, flagged.length));
  const hidden = shows.length - visible.length;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-fg">{movie.title}</h3>
        <span className="text-[11px] tabular-nums text-muted">
          {movie.released ? `${movie.rank}위` : releaseBadge(movie.releaseDate) ?? "개봉전"}
        </span>
      </div>
      {shows.length === 0 ? (
        <div className="mt-2 rounded-md bg-bg px-3 py-3">
          {elsewhere.length ? (
            <>
              <p className="text-sm text-open">
                {summarizeElsewhere(elsewhere)}
              </p>
              <p className="mt-1 text-[11px] text-faint">
                이 극장에는 아직 없습니다. 위 극장 카드를 펼치세요.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm text-wait">미오픈 · 감시 중</p>
              {movie.releaseDate ? (
                <p className="mt-1 text-[11px] text-faint">개봉 {formatPlayDate(movie.releaseDate)}</p>
              ) : null}
            </>
          )}
        </div>
      ) : (
        <ul className="mt-2 flex flex-col gap-1.5">
          {visible.map((show) => {
            const isAlert = alertedShows.has(showAlertKey(show));
            return (
            <li
              key={show.id}
              className={cn(
                "rounded-md bg-bg px-3 py-2",
                isAlert && "outline outline-2 outline-offset-1 outline-notify",
              )}
            >
              <p className="truncate text-[11px] text-muted">
                {formatPlayDate(show.playDate)} · {show.hallName}
              </p>
              <div className="mt-1 flex items-center gap-3">
                <p className="min-w-0 flex-1 truncate text-sm text-fg">
                  <span className="tabular-nums font-medium">{show.startTime}</span>
                  {isAlert ? (
                    <span className="ml-1.5 rounded-sm bg-notify px-1 py-px text-[10px] font-medium text-notify-fg">
                      알림
                    </span>
                  ) : null}
                  {show.restSeats != null ? (
                    <span className="ml-1.5 tabular-nums text-[11px] text-open">
                      {show.totalSeats != null
                        ? `${show.restSeats}/${show.totalSeats}`
                        : `잔여 ${show.restSeats}`}
                    </span>
                  ) : null}
                </p>
                <a
                  href={show.bookingUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-7 shrink-0 items-center justify-center rounded-full bg-open px-2.5 text-[11px] font-medium tracking-wide text-open-fg"
                >
                  예매
                </a>
                <StarBtn show={show} onQueue={onQueue} />
              </div>
            </li>
            );
          })}
          {hidden > 0 ? (
            <li className="px-1 text-[11px] text-faint">외 {hidden}회차</li>
          ) : null}
        </ul>
      )}
    </div>
  );
}

function StarBtn({
  show,
  onQueue,
}: {
  show: Showtime;
  onQueue: (show: Showtime) => void;
}) {
  const on = useAppStore((s) =>
    s.queue.some((q) => q.showtimeId === show.id),
  );
  return (
    <button
      type="button"
      onClick={() => onQueue(show)}
      aria-label={on ? "별표 해제" : "별표"}
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-full",
        on ? "text-wait" : "text-muted",
      )}
    >
      <Star
        className="size-4"
        strokeWidth={1.75}
        fill={on ? "currentColor" : "none"}
      />
    </button>
  );
}

function summarizeElsewhere(
  rows: { theaterName: string; show: Showtime }[],
) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.theaterName, (counts.get(row.theaterName) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, n]) => `${name} ${n}회 오픈`)
    .join(" · ");
}

function alertShowKey(alert: { theaterId: string; movieTitle: string; playDate: string; startTime: string; hallName: string }) {
  return [alert.theaterId, normalizeTitle(alert.movieTitle), alert.playDate, alert.startTime, alert.hallName].join("|");
}

function showAlertKey(show: Showtime) {
  return [show.theaterId, normalizeTitle(show.movieTitle), show.playDate, show.startTime, show.hallName].join("|");
}

function releaseBadge(releaseDate: string | null) {
  if (!releaseDate || releaseDate.length !== 8) return null;
  const today = kstDateKeys(1)[0];
  if (releaseDate <= today) return null;
  const start = Date.UTC(
    Number(today.slice(0, 4)),
    Number(today.slice(4, 6)) - 1,
    Number(today.slice(6, 8)),
  );
  const end = Date.UTC(
    Number(releaseDate.slice(0, 4)),
    Number(releaseDate.slice(4, 6)) - 1,
    Number(releaseDate.slice(6, 8)),
  );
  const days = Math.round((end - start) / 86400000);
  return `D-${days}`;
}
