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

function parseWatchSig(prevSig: string): WatchSig | null {
  try {
    return JSON.parse(prevSig || "{}") as WatchSig;
  } catch {
    return null;
  }
}

export function describeWatchChange(
  prevSig: string,
  config: WatchConfig,
  ranking: RankingMovie[],
) {
  const prev = parseWatchSig(prevSig);
  if (!prev) {
    return { addedTitles: [] as string[], muteAll: true };
  }
  const prevTitles = new Set(prev.t ?? []);
  const nextTitles = new Set(
    (config.watchTitles ?? []).map((s) => normalizeTitle(s)),
  );
  const addedClickTitles = [...nextTitles].filter((t) => !prevTitles.has(t));
  const prevRanks = new Set(prev.r ?? []);
  const addedRanks = config.ranks.filter((r) => !prevRanks.has(r));
  const addedRankTitles = ranking
    .filter((m) => addedRanks.includes(m.rank))
    .map((m) => normalizeTitle(m.title))
    .filter(Boolean);
  const addedTheaters = Object.keys(config.theaters).filter(
    (id) => config.theaters[id as TheaterId] && !prev.th?.[id],
  );
  const formatExpanded = Object.keys(config.formats).some((id) => {
    const prevF = prev.f?.[id] ?? [];
    const nextF = config.formats[id as TheaterId] ?? [];
    return nextF.some((f) => !prevF.includes(f));
  });
  const daysChanged = (prev.d ?? 0) !== config.daysAhead;
  const ranksUnmapped = addedRanks.length > 0 && addedRankTitles.length === 0;
  const muteAll =
    daysChanged ||
    addedTheaters.length > 0 ||
    formatExpanded ||
    ranksUnmapped;
  return {
    addedTitles: [...addedClickTitles, ...addedRankTitles],
    muteAll,
  };
}

function showMatchesAddedTitle(show: Showtime, addedTitles: string[]) {
  if (!addedTitles.length) return false;
  const keys = new Set(addedTitles);
  return titleInSet(show.movieTitle, keys);
}

export function primeIdsForWatchChange(
  prevSig: string,
  config: WatchConfig,
  ranking: RankingMovie[],
  shows: Showtime[],
) {
  const change = describeWatchChange(prevSig, config, ranking);
  if (change.muteAll) {
    return shows.map((s) => s.id);
  }
  const prev = parseWatchSig(prevSig);
  if (!prev) return shows.map((s) => s.id);
  const addedTheaters = Object.keys(config.theaters).filter(
    (id) => config.theaters[id as TheaterId] && !prev.th?.[id],
  );
  return shows
    .filter((s) => {
      if (showMatchesAddedTitle(s, change.addedTitles)) return true;
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
  const short = Math.min(x.length, y.length);
  if (short >= 2 && (x.includes(y) || y.includes(x))) return true;
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
  catalog: RankingMovie[] = [],
) {
  const titles = watchedTitleSet(ranking, config);
  const seen = new Set<string>();
  const out: RankingMovie[] = [];
  for (const movie of [...ranking, ...showing, ...catalog]) {
    const key = normalizeTitle(movie.title);
    if (!titles.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(movie);
  }
  for (const raw of config.watchTitles ?? []) {
    const key = normalizeTitle(raw);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      rank: 0,
      title: raw,
      movieNo: "",
      bookingRate: null,
      posterUrl: null,
      releaseDate: null,
      bookingOpen: false,
      released: false,
    });
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
  if (!formats.length || !show.formats.some((f) => formats.includes(f))) {
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

export function mergeMovieCatalog(...lists: RankingMovie[][]) {
  const out: RankingMovie[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const row of list) {
      const key = normalizeTitle(row.title);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
  }
  return out;
}

export function moviesFromShowtimes(shows: Showtime[]): RankingMovie[] {
  const out: RankingMovie[] = [];
  const seen = new Set<string>();
  for (const show of shows) {
    const title = show.movieTitle.trim();
    const key = normalizeTitle(title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      rank: 0,
      title,
      movieNo: show.movieNo || "",
      bookingRate: null,
      posterUrl: null,
      releaseDate: show.playDate || null,
      bookingOpen: true,
      released: true,
    });
  }
  return out;
}
