import { normalizeTitle } from "@/lib/utils";
import type { RankingMovie, Showtime, TheaterId, WatchConfig } from "./types";

export function watchSignature(config: WatchConfig) {
  return JSON.stringify({
    r: [...config.ranks].sort((a, b) => a - b),
    t: [...(config.watchTitles ?? [])].map((s) => normalizeTitle(s)).sort(),
    th: config.theaters,
    f: config.formats,
    d: config.daysAhead,
  });
}

type WatchSig = {
  r?: number[];
  t?: string[];
  th?: Record<string, boolean>;
  f?: Record<string, string[]>;
  d?: number;
};

export function primeIdsForWatchChange(
  prevSig: string,
  config: WatchConfig,
  ranking: RankingMovie[],
  shows: Showtime[],
) {
  let prev: WatchSig = {};
  try {
    prev = JSON.parse(prevSig || "{}") as WatchSig;
  } catch {
    return [];
  }
  const prevTitles = new Set(prev.t ?? []);
  const nextTitles = new Set(
    (config.watchTitles ?? []).map((s) => normalizeTitle(s)),
  );
  const addedClickTitles = [...nextTitles].filter((t) => !prevTitles.has(t));
  const prevRanks = new Set(prev.r ?? []);
  const addedRankTitles = new Set(
    ranking
      .filter((m) => config.ranks.includes(m.rank) && !prevRanks.has(m.rank))
      .map((m) => normalizeTitle(m.title)),
  );
  const addedTheaters = Object.keys(config.theaters).filter(
    (id) => config.theaters[id as TheaterId] && !prev.th?.[id],
  );
  if ((prev.d ?? 0) !== config.daysAhead) {
    return shows.map((s) => s.id);
  }
  return shows
    .filter((s) => {
      const title = normalizeTitle(s.movieTitle);
      if (addedClickTitles.includes(title) || addedRankTitles.has(title)) {
        return true;
      }
      if (addedTheaters.includes(s.theaterId)) return true;
      const prevF = prev.f?.[s.theaterId] ?? [];
      const nextF = config.formats[s.theaterId] ?? [];
      return s.formats.some((f) => nextF.includes(f) && !prevF.includes(f));
    })
    .map((s) => s.id);
}

export function titlesMatch(a: string, b: string) {
  const x = normalizeTitle(a);
  const y = normalizeTitle(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.length >= 5 && y.length >= 5 && (x.includes(y) || y.includes(x))) {
    return true;
  }
  return false;
}

export function titleInSet(title: string, titles: Set<string>) {
  const key = normalizeTitle(title);
  if (titles.has(key)) return true;
  for (const t of titles) {
    if (titlesMatch(title, t)) return true;
  }
  return false;
}

export function watchedMovies(ranking: RankingMovie[], ranks: number[]) {
  return ranking.filter((m) => ranks.includes(m.rank));
}

export function watchedTitleSet(
  ranking: RankingMovie[],
  config: WatchConfig,
) {
  const fromRank = watchedMovies(ranking, config.ranks).map((m) =>
    normalizeTitle(m.title),
  );
  const extra = (config.watchTitles ?? []).map((t) => normalizeTitle(t));
  return new Set([...fromRank, ...extra]);
}

export function selectedMovies(
  ranking: RankingMovie[],
  showing: RankingMovie[],
  config: WatchConfig,
) {
  const titles = watchedTitleSet(ranking, config);
  const seen = new Set<string>();
  const out: RankingMovie[] = [];
  for (const movie of [...ranking, ...showing]) {
    const key = normalizeTitle(movie.title);
    if (!titles.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(movie);
  }
  return out.sort((a, b) => (a.rank || 999) - (b.rank || 999));
}

export function watchedTitles(ranking: RankingMovie[], ranks: number[]) {
  return new Set(
    watchedMovies(ranking, ranks).map((m) => normalizeTitle(m.title)),
  );
}

export function isWatchedShow(
  show: Showtime,
  config: WatchConfig,
  titles: Set<string>,
) {
  if (!config.theaters[show.theaterId]) return false;
  const formats = config.formats[show.theaterId] ?? [];
  if (formats.length && !show.formats.some((f) => formats.includes(f))) {
    return false;
  }
  if (titles.size === 0) return true;
  return titleInSet(show.movieTitle, titles);
}

export function filterWatched(
  shows: Showtime[],
  config: WatchConfig,
  titles: Set<string>,
) {
  return shows.filter((s) => isWatchedShow(s, config, titles));
}
