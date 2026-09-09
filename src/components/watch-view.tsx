import { ChevronDown, RefreshCw, Search, Star, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { intentFromShowtime } from "@/lib/cinema/auto-booking";
import { selectedMovies, titlesMatch, titleInSet, watchedTitleSet } from "@/lib/cinema/match";
import { applyCgvSeatHits, formatShowPlace, mergeShowtimes, summarizeSeatDelta } from "@/lib/cinema/seats";
import { pullTheaterSeats, scanCinema } from "@/lib/cinema/scan";
import { THEATERS } from "@/lib/cinema/theaters";
import type { MovieTab, RankingMovie, ScanProps, Showtime, TheaterId } from "@/lib/cinema/types";
import { CHART_SIZE } from "@/lib/cinema/types";
import { useAppStore } from "@/lib/store";
import { cn, formatPlayDate, kstDateKeys, normalizeTitle } from "@/lib/utils";
import { SourceStatus } from "./source-status";
import { FormatChips } from "./theater-picks";

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
  const [focusShowId, setFocusShowId] = useState<string | null>(null);
  const movies = selectedMovies(
    scan?.ranking ?? [],
    scan?.showing ?? [],
    config,
    scan?.catalog ?? [],
  );
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
        if (!formats.length || !s.formats.some((f) => formats.includes(f))) {
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
            ? "예매율 1~9위입니다. 포스터를 누르면 알림설정. 아래 검색으로 차트 밖 영화도 넣을 수 있습니다."
            : "이미 개봉한 영화만, 예매율 순 9편입니다. 포스터를 누르면 알림설정입니다."}
        </p>
        <MovieSearch catalog={scan?.catalog ?? []} />
        {scan?.catalogNote ? (
          <p className="mb-3 text-xs leading-relaxed text-muted">{scan.catalogNote}</p>
        ) : null}
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
        <ExtraWatchStrip
          catalog={scan?.catalog ?? []}
          visible={catalog}
        />
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
          알림 탭에 뜬 상영이 아직 없습니다.
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
            seatSource={result?.seatSource ?? "none"}
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
            focusShowId={focusShowId}
            onJump={(show) => setFocusShowId(show.id)}
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

function MovieSearch({ catalog }: { catalog: RankingMovie[] }) {
  const [query, setQuery] = useState("");
  const watchTitles = useAppStore((s) => s.config.watchTitles);
  const toggleWatchTitle = useAppStore((s) => s.toggleWatchTitle);
  const q = query.trim();
  const extraKeys = new Set(watchTitles.map((t) => normalizeTitle(t)));
  const hits = q
    ? catalog
        .filter((m) => m.title.replace(/\s/g, "").includes(q.replace(/\s/g, "")))
        .slice(0, 8)
    : [];
  return (
    <div className="relative mb-3">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="상영중·예정작 검색해 추가"
        className="min-h-11 w-full rounded-md bg-surface pl-10 pr-3 text-sm text-fg shadow-border outline-none placeholder:text-faint"
      />
      {q ? (
        <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-md bg-surface shadow-border ring-1 ring-border">
          {hits.length ? (
            hits.map((movie) => {
              const on = extraKeys.has(normalizeTitle(movie.title));
              return (
                <button
                  key={`${movie.movieNo}-${movie.title}`}
                  type="button"
                  onClick={() => {
                    toggleWatchTitle(movie.title);
                    toast.success(
                      on ? "추가 감시에서 뺐습니다." : `${movie.title}을 추가했습니다.`,
                    );
                    setQuery("");
                  }}
                  className="flex min-h-11 w-full items-center gap-3 px-3 text-left text-sm text-fg hover:bg-pick"
                >
                  {movie.posterUrl ? (
                    <img
                      src={movie.posterUrl}
                      alt=""
                      className="size-9 shrink-0 rounded-sm object-cover"
                    />
                  ) : (
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-sm bg-bg text-[10px] text-muted">
                      {movie.rank || "+"}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate">{movie.title}</span>
                  <span className="shrink-0 text-[11px] text-muted">
                    {on ? "빼기" : "추가"}
                  </span>
                </button>
              );
            })
          ) : (
            <p className="px-3 py-3 text-sm text-muted">맞는 영화가 없습니다.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ExtraWatchStrip({
  catalog,
  visible,
}: {
  catalog: RankingMovie[];
  visible: RankingMovie[];
}) {
  const watchTitles = useAppStore((s) => s.config.watchTitles);
  const toggleWatchTitle = useAppStore((s) => s.toggleWatchTitle);
  const visibleKeys = new Set(visible.map((m) => normalizeTitle(m.title)));
  const extras = watchTitles
    .map((title) => {
      const hit = catalog.find(
        (m) => normalizeTitle(m.title) === normalizeTitle(title),
      );
      return (
        hit ?? {
          rank: 0,
          title,
          movieNo: "",
          bookingRate: null,
          posterUrl: null,
          releaseDate: null,
          bookingOpen: false,
          released: false,
        }
      );
    })
    .filter((m) => !visibleKeys.has(normalizeTitle(m.title)));
  if (!extras.length) return null;
  return (
    <div className="mt-3">
      <p className="mb-2 text-[11px] tracking-[0.12em] text-muted">추가 영화</p>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {extras.map((movie) => (
          <button
            key={movie.title}
            type="button"
            onClick={() => {
              toggleWatchTitle(movie.title);
              toast("추가 감시에서 뺐습니다.");
            }}
            className="relative w-[4.5rem] shrink-0 text-left"
          >
            <div className="relative aspect-[3/4] overflow-hidden rounded-md bg-surface-2 ring-2 ring-notify">
              {movie.posterUrl ? (
                <img
                  src={movie.posterUrl}
                  alt=""
                  className="size-full object-cover"
                />
              ) : (
                <div className="flex size-full items-center justify-center px-1 text-center text-[10px] text-muted">
                  {movie.title}
                </div>
              )}
              <span className="absolute right-0.5 top-0.5 flex size-4 items-center justify-center rounded-full bg-bg/80 text-muted">
                <X className="size-2.5" strokeWidth={2.5} />
              </span>
            </div>
            <p className="mt-1 line-clamp-2 text-[10px] leading-snug text-fg">
              {movie.title}
            </p>
          </button>
        ))}
      </div>
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
  source,
  seatSource,
  movies,
  shows,
  allShows,
  otherOpens,
  alertedShows,
  onlyAlerted,
  focusShowId,
  onJump,
  onQueue,
}: {
  theaterId: TheaterId;
  ok: boolean;
  error: string | null;
  source: string;
  seatSource: string;
  movies: RankingMovie[];
  shows: Showtime[];
  allShows: Showtime[];
  otherOpens: { theaterName: string; show: Showtime }[];
  alertedShows: Set<string>;
  onlyAlerted: boolean;
  focusShowId: string | null;
  onJump: (show: Showtime) => void;
  onQueue: (show: Showtime) => void;
}) {
  const theater = THEATERS.find((t) => t.id === theaterId);
  const formats = useAppStore((s) => s.config.formats[theaterId] ?? []);
  const setTheaterFormats = useAppStore((s) => s.setTheaterFormats);
  const gasWebUrl = useAppStore((s) => s.config.gasWebUrl);
  const daysAhead = useAppStore((s) => s.config.daysAhead);
  const mergeSeatMap = useAppStore((s) => s.mergeSeatMap);
  const mergeOverlayShows = useAppStore((s) => s.mergeOverlayShows);
  const [seatBusy, setSeatBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const focusedHere = Boolean(focusShowId && shows.some((s) => s.id === focusShowId));
  useEffect(() => {
    if (!focusedHere) return;
    setOpen(true);
    const id = `show-${focusShowId}`;
    const timer = window.setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
    return () => window.clearTimeout(timer);
  }, [focusedHere, focusShowId]);
  if (!theater) return null;
  const current = theater;
  const missingSeats =
    ok && shows.length > 0 && !shows.some((s) => s.restSeats != null);
  const formatSummary = theater.formats
    .filter((f) => formats.includes(f.id))
    .map((f) => f.label)
    .join(" · ");

  async function refreshTheater() {
    setSeatBusy(true);
    try {
      const days = Math.min(Math.max(daysAhead || 7, 1), 14);
      const gas = gasWebUrl.trim() || undefined;
      const [scan, result] = await Promise.all([
        scanCinema({
          data: {
            theaters: [theaterId],
            daysAhead: days,
            gasWebUrl: gas,
            sources: { official: true, naver: true, gas: true },
          },
        }),
        pullTheaterSeats({
          url: gas,
          theaterId,
          daysAhead: days,
          fresh: true,
        }),
      ]);
      const timetable = (scan.theaters ?? []).find((row) => row.theaterId === theaterId);
      if (timetable?.showtimes?.length) {
        mergeOverlayShows(theaterId, timetable.showtimes);
      }
      const map = result.map ?? {};
      if (Object.keys(map).length) mergeSeatMap(map);
      const overlay = (result.showtimes ?? []).filter(
        (row) => row.theaterId === theaterId,
      );
      if (overlay.length) mergeOverlayShows(theaterId, overlay);
      const next = applyCgvSeatHits(
        mergeShowtimes(allShows, [...(timetable?.showtimes ?? []), ...overlay]),
        { ...useAppStore.getState().seatMap, ...map },
        true,
      );
      const delta = summarizeSeatDelta(allShows, next);
      if (delta.lines.length) {
        toast.success("잔여석이 늘었습니다", {
          description: (
            <span className="mt-1 block text-left leading-relaxed">
              {delta.lines.join("\n")}
            </span>
          ),
        });
      } else {
        toast.success(`${current.shortName} 시간표를 다시 받았습니다.`);
      }
    } catch (err) {
      if (shows.some((s) => s.restSeats != null)) {
        toast("공홈이 잠깐 안 됩니다. 화면에 있는 값을 유지합니다.");
        return;
      }
      toast.error(err instanceof Error ? err.message : "불러오지 못했습니다.");
    } finally {
      setSeatBusy(false);
    }
  }

  function toggleAllFormats() {
    const ids = current.formats.map((f) => f.id);
    const allOn = ids.length > 0 && ids.every((id) => formats.includes(id));
    setTheaterFormats(current.id, allOn ? [] : ids);
  }

  const allOn =
    current.formats.length > 0 &&
    current.formats.every((f) => formats.includes(f.id));
  const someOn = formats.length > 0;

  return (
    <section
      id={`theater-${theaterId}`}
      className={cn(
        "rise-in flex flex-col overflow-hidden rounded-xl p-3 shadow-border transition-colors",
        allOn
          ? "bg-pick ring-1 ring-border-strong"
          : someOn
            ? "bg-surface-2 ring-1 ring-border"
            : "bg-surface",
      )}
    >
      <header className="flex items-start gap-2">
        <button
          type="button"
          onClick={toggleAllFormats}
          className={cn(
            "flex min-h-11 min-w-0 flex-1 items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left",
            allOn ? "bg-pick ring-1 ring-border-strong" : "bg-surface-2 ring-1 ring-border",
          )}
        >
          <div className="min-w-0">
            <h2 className="truncate text-xl font-bold leading-tight text-fg">
              {theater.name}
            </h2>
            <div className="mt-1.5">
              <SourceStatus
                source={source}
                seatSource={seatSource}
                ok={ok}
                quiet
              />
            </div>
            <p className="mt-1 truncate text-xs text-muted">
              {ok ? formatSummary || "특별관 없음" : "조회 실패"}
            </p>
          </div>
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
        <button
          type="button"
          onClick={() => {
            void refreshTheater();
          }}
          disabled={seatBusy}
          className="inline-flex min-h-11 shrink-0 items-center gap-1.5 self-center rounded-md bg-bg px-3 text-xs text-fg ring-1 ring-border-strong disabled:opacity-40"
        >
          <RefreshCw
            className={cn("size-3.5", seatBusy && "animate-spin")}
            strokeWidth={1.75}
          />
          새로고침
        </button>
      </header>

      {open ? (
        <div className="mt-3 border-t border-border pt-3">
          <FormatChips theaterId={theater.id} />

          {missingSeats ? (
            <p className="mt-3 text-xs leading-relaxed text-faint">
              잔여석은 오른쪽 「새로고침」을 누르면 이 극장의 시간표와 좌석을 같이 다시 받습니다.
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
                    focusShowId={focusShowId}
                    alertedShows={alertedShows}
                    onJump={onJump}
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
  focusShowId,
  alertedShows,
  onJump,
  onQueue,
}: {
  movie: RankingMovie;
  shows: Showtime[];
  elsewhere: { theaterName: string; show: Showtime }[];
  focusShowId: string | null;
  alertedShows: Set<string>;
  onJump: (show: Showtime) => void;
  onQueue: (show: Showtime) => void;
}) {
  const flagged = shows.filter((s) => alertedShows.has(showAlertKey(s)));
  const rest = shows.filter((s) => !alertedShows.has(showAlertKey(s)));
  let visible = [...flagged, ...rest].slice(0, Math.max(8, flagged.length));
  if (focusShowId && shows.some((s) => s.id === focusShowId) && !visible.some((s) => s.id === focusShowId)) {
    const hit = shows.find((s) => s.id === focusShowId);
    if (hit) visible = [hit, ...visible.filter((s) => s.id !== hit.id)].slice(0, 9);
  }
  const hidden = Math.max(0, shows.length - visible.length);
  const elseList = elsewhere
    .slice()
    .sort((a, b) =>
      a.show.playDate === b.show.playDate
        ? a.show.startTime.localeCompare(b.show.startTime)
        : a.show.playDate.localeCompare(b.show.playDate),
    );
  const elseVisible = elseList.slice(0, 6);
  const elseHidden = elseList.length - elseVisible.length;
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
            <div className="flex flex-col gap-1.5">
              {elseVisible.map((row) => (
                <button
                  key={row.show.id}
                  type="button"
                  onClick={() => onJump(row.show)}
                  className="min-h-11 rounded-md px-1 text-left text-sm text-open hover:bg-pick"
                >
                  {formatShowPlace(row.show)} 오픈
                </button>
              ))}
              {elseHidden > 0 ? (
                <p className="text-[11px] text-faint">외 {elseHidden}건 · 해당 극장 카드를 펼치세요</p>
              ) : (
                <p className="text-[11px] text-faint">이 극장에는 아직 없습니다. 눌러서 이동하세요.</p>
              )}
            </div>
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
              id={`show-${show.id}`}
              className={cn(
                "rounded-md bg-bg px-3 py-2",
                isAlert && "outline outline-2 outline-offset-1 outline-notify",
                focusShowId === show.id && "ring-1 ring-border-strong",
              )}
            >
              <p className="truncate text-[11px] text-muted">
                {formatPlayDate(show.playDate)}
                {" · "}
                {show.hallName}
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
            <li className="px-1 text-[11px] text-faint">외 {hidden}건</li>
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
