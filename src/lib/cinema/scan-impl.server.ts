import { kstDateKeys, normalizePlayDate } from "@/lib/utils";
import {
  fetchCgvNaver,
  fetchCgvOfficialSeatmap,
  fetchCgvRelaySeatmap,
  fetchCgvUpcomingCatalog,
  fetchYongsanTelegram,
  isCgvId,
} from "./cgv.server";
import { fetchMegaboxCatalog, fetchMegaboxSeatmap, fetchNaverMegabox } from "./megabox.server";
import { fetchCgvKtSeatmap } from "./kt.server";
import { readNasSeatmap } from "./nas.server";
import { applyCgvSeatHits, lookupSeatHit, mergeShowtimes, putSeatHit, type SeatHitMap } from "./seats";
import { loadSeatLastKnown, saveSeatLastKnown } from "./seat-cache.server";
import type {
  RankingMovie,
  ScanResult,
  ScanSources,
  Showtime,
  TheaterId,
  TheaterScan,
} from "./types";
import { normalizeScanSources } from "./types";
import { mergeMovieCatalog, moviesFromShowtimes, titlesMatch } from "./match";

type MegaboxId = "megabox_coex" | "megabox_namyangju";

export async function runScan(input: {
  daysAhead: number;
  theaters: TheaterId[];
  gasWebUrl?: string;
  sources?: Partial<ScanSources> | null;
}): Promise<ScanResult> {
  const days = Math.min(Math.max(input.daysAhead || 7, 1), 30);
  const playDates = kstDateKeys(days);
  const wanted = new Set(input.theaters);
  const sources = normalizeScanSources(input.sources);

  const rankingPromise = fetchMegaboxCatalog().catch(() => ({ ranking: [], showing: [], catalog: [] }));
  const cgvComingPromise = fetchCgvUpcomingCatalog().catch(() => ({ movies: [] as RankingMovie[], source: "none" as const }));
  const gasSeats = input.gasWebUrl
    ? loadGasSeatmap(input.gasWebUrl).catch(() => ({ status: "empty" as const, map: {} as GasSeatMap }))
    : Promise.resolve({ status: "empty" as const, map: {} as GasSeatMap });
  const officialCgvSeats = [...wanted].some(isCgvId)
    ? fetchCgvOfficialSeatmap({ days: Math.min(days, 7) }).catch(() => ({ map: {} as SeatHitMap, showtimes: [] as Showtime[] }))
    : Promise.resolve({ map: {} as SeatHitMap, showtimes: [] as Showtime[] });
  const relaySeats = [...wanted].some(isCgvId)
    ? fetchCgvRelaySeatmap({ days }).catch(() => ({ map: {} as SeatHitMap, showtimes: [] as Showtime[] }))
    : Promise.resolve({ map: {} as SeatHitMap, showtimes: [] as Showtime[] });
  const nasSeats = [...wanted].some(isCgvId)
    ? readNasSeatmap([...wanted].filter(isCgvId)).catch(() => ({ map: {} as SeatHitMap, showtimes: [] as Showtime[], source: "pc" as const }))
    : Promise.resolve({ map: {} as SeatHitMap, showtimes: [] as Showtime[], source: "pc" as const });
  const ktSeats = [...wanted].some(isCgvId)
    ? fetchCgvKtSeatmap({ theaters: [...wanted].filter(isCgvId), dates: playDates }).catch(() => ({ map: {} as SeatHitMap, showtimes: [] as Showtime[] }))
    : Promise.resolve({ map: {} as SeatHitMap, showtimes: [] as Showtime[] });
  const megaSeats = [...wanted].some((id) => id === "megabox_coex" || id === "megabox_namyangju")
    ? fetchMegaboxSeatmap({ days: Math.min(days, 5) }).catch(() => ({ map: {} as SeatHitMap, showtimes: [] as Showtime[] }))
    : Promise.resolve({ map: {} as SeatHitMap, showtimes: [] as Showtime[] });
  const gasShows = sources.gas && input.gasWebUrl
    ? loadGasTimetable(input.gasWebUrl, days).catch(() => [] as Showtime[])
    : Promise.resolve([] as Showtime[]);

  const jobs: Promise<TheaterScan>[] = [];
  if (wanted.has("megabox_coex")) jobs.push(scanTheater("megabox_coex", playDates, sources, gasShows));
  if (wanted.has("megabox_namyangju")) jobs.push(scanTheater("megabox_namyangju", playDates, sources, gasShows));
  for (const id of wanted) if (isCgvId(id)) jobs.push(scanTheater(id, playDates, sources, gasShows));

  const [catalog, cgvComing, seats, officialCgv, relay, nas, kt, mega, gasList, ...theaters] = await Promise.all([
    rankingPromise, cgvComingPromise, gasSeats, officialCgvSeats, relaySeats, nasSeats, ktSeats, megaSeats, gasShows, ...jobs,
  ]);
  const gasMap: SeatHitMap = { ...seats.map };
  for (const row of gasList) putSeatHit(gasMap, row);
  const officialMap: SeatHitMap = { ...officialCgv.map, ...mega.map };
  const lastKnown = await loadSeatLastKnown();
  const withSeats = theaters.map((theater) => {
    const extraMega = theater.theaterId === "megabox_coex" || theater.theaterId === "megabox_namyangju" ? mega.showtimes.filter((row) => row.theaterId === theater.theaterId) : [];
    const extraOfficialCgv = isCgvId(theater.theaterId) ? officialCgv.showtimes.filter((row) => row.theaterId === theater.theaterId) : [];
    const extraRelay = isCgvId(theater.theaterId) ? relay.showtimes.filter((row) => row.theaterId === theater.theaterId) : [];
    const extraNas = isCgvId(theater.theaterId) ? nas.showtimes.filter((row) => row.theaterId === theater.theaterId) : [];
    const extraKt = isCgvId(theater.theaterId) ? kt.showtimes.filter((row) => row.theaterId === theater.theaterId) : [];
    const extraGas = gasList.filter((row) => row.theaterId === theater.theaterId);
    const extraOfficial = [...extraMega, ...extraOfficialCgv];
    const extra = [...extraGas, ...extraRelay, ...extraKt, ...extraNas, ...extraOfficial];
    const base = normalizeShowtimes(theater.showtimes);
    const normalizedExtra = normalizeShowtimes(extra);
    const merged = normalizedExtra.length ? mergeShowtimes(base, normalizedExtra) : base;
    let live = applySeatLayers(merged, [officialMap, nas.map, kt.map, relay.map, gasMap]);
    if (isCgvId(theater.theaterId) && extraNas.length) {
      live = applyReporterFallback(live, extraNas);
    }
    const nasSeatSource = nas.source === "nas423" ? "g-nas423" : nas.source === "nas225" ? "g-nas225" : nas.source === "nas" ? "g-nas" : "g-pc";
    const showtimes = applyCgvSeatHits(live, lastKnown, false, false).map((row) => {
      const liveSource =
        lookupSeatHit(row, officialMap) ? "official" :
        lookupSeatHit(row, nas.map) ? nasSeatSource :
        lookupSeatHit(row, kt.map) ? "cgv-kt" :
        lookupSeatHit(row, relay.map) ? "cgv-relay" :
        lookupSeatHit(row, gasMap) ? "gas-cache" :
        row.restSeats != null ? "last-known" : undefined;
      return ({
      ...row,
      playDate: normalizePlayDate(row.playDate),
      seatSource: liveSource,
    });
    });
    let source = theater.source;
    if (!theater.showtimes.length) {
      if (extraOfficial.length) source = "official";
      else if (extraNas.length) source = "nas-report";
      else if (extraKt.length) source = "cgv-kt";
      else if (extraRelay.length) source = "cgv-relay";
      else if (extraGas.length) source = "gas-cache";
    }
    return { ...theater, showtimes, source, ok: theater.ok || showtimes.length > 0, error: showtimes.length ? null : theater.error };
  });
  const tagged = withSeats.map((theater) => ({
    ...theater,
    seatSource: detectSeatSource(theater.showtimes, { official: officialMap, nas: nas.map, kt: kt.map, relay: relay.map, gas: gasMap }, nas.source),
  }));
  const harvested: SeatHitMap = {};
  for (const theater of tagged) for (const row of theater.showtimes) putSeatHit(harvested, row);
  if (Object.keys(harvested).length) await saveSeatLastKnown(harvested);
  const ranking = catalog.ranking.length ? catalog.ranking : rankingFromShows(tagged);
  const showing = catalog.showing.length ? catalog.showing : ranking;
  return {
    scannedAt: new Date().toISOString(), playDates, ranking, showing,
    catalog: mergeMovieCatalog(catalog.catalog ?? [], catalog.ranking, catalog.showing, cgvComing.movies, moviesFromShowtimes(tagged.flatMap((t) => t.showtimes))),
    theaters: tagged,
  };
}

function normalizeShowtimes(rows: Showtime[]): Showtime[] {
  return rows.map((row) => ({ ...row, playDate: normalizePlayDate(row.playDate) }));
}

async function scanTheater(theaterId: TheaterId, playDates: string[], sources: ScanSources, gasShows: Promise<Showtime[]>): Promise<TheaterScan> {
  const naverPromise = sources.naver ? fetchNaver(theaterId).catch(() => new Map<string, Showtime[]>()) : Promise.resolve(new Map<string, Showtime[]>());
  const officialByDate = new Map<string, Showtime[]>();
  const naverByDate = sources.naver ? await naverPromise : new Map<string, Showtime[]>();
  const stillMissing = playDates.filter((d) => !(officialByDate.get(d)?.length || naverByDate.get(d)?.length));
  let gasByDate = new Map<string, Showtime[]>(); let teleByDate = new Map<string, Showtime[]>();
  if (sources.gas) { try { gasByDate = byDateForTheater(await gasShows, theaterId); } catch { gasByDate = new Map(); } }
  if (stillMissing.length && theaterId === "cgv_yongsan") { try { teleByDate = await fetchYongsanTelegram(); } catch { teleByDate = new Map(); } }
  const showtimes: Showtime[] = []; let usedOfficial = false; let usedNaver = false; let usedGas = false; let usedTele = false;
  for (const date of playDates) {
    const primary = mergeShowtimes(officialByDate.get(date) ?? [], naverByDate.get(date) ?? []);
    if (primary.length) { showtimes.push(...primary); if (officialByDate.get(date)?.length) usedOfficial = true; if (naverByDate.get(date)?.length) usedNaver = true; continue; }
    const tele = teleByDate.get(date); if (tele?.length) { showtimes.push(...tele); usedTele = true; continue; }
    const gas = gasByDate.get(date); if (gas?.length) { showtimes.push(...gas); usedGas = true; }
  }
  const source = usedOfficial ? "official" : usedNaver ? "naver-place" : usedTele ? "yongsan-channel" : usedGas ? "gas-cache" : "none";
  if (!showtimes.length) return { theaterId, ok: false, error: failMessage(theaterId, sources), showtimes: [], source, seatSource: "none" };
  return { theaterId, ok: true, error: null, showtimes: normalizeShowtimes(showtimes), source, seatSource: "none" };
}

async function fetchNaver(theaterId: TheaterId): Promise<Map<string, Showtime[]>> {
  if (isCgvId(theaterId)) return fetchCgvNaver(theaterId);
  return fetchNaverMegabox(theaterId as MegaboxId);
}

function failMessage(theaterId: TheaterId, sources: ScanSources) {
  const tried = isCgvId(theaterId) ? [sources.naver ? "네이버" : "", theaterId === "cgv_yongsan" ? "용아맥 채널" : ""].filter(Boolean) : [sources.official ? "공홈" : "", sources.naver ? "네이버" : ""].filter(Boolean);
  const name = isCgvId(theaterId) ? "CGV" : "메가박스";
  return `${name} 시간표를 ${tried.join(" → ") || "조회"}에서 가져오지 못했습니다.`;
}

function rankingFromShows(theaters: TheaterScan[]): RankingMovie[] {
  const counts = new Map<string, number>();
  for (const theater of theaters) for (const show of theater.showtimes) { const title = show.movieTitle.trim(); if (title) counts.set(title, (counts.get(title) ?? 0) + 1); }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 9).map(([title], i) => ({ rank: i + 1, title, movieNo: "", bookingRate: null, posterUrl: null, releaseDate: null, bookingOpen: true, released: true }));
}

type GasSeatMap = SeatHitMap;
type GasShowRow = { id?: string; theaterId?: string; theater?: string; title?: string; date?: string; time?: string; hall?: string; formats?: Showtime["formats"]; restSeats?: number | null; totalSeats?: number | null; url?: string };

function applySeatLayers(rows: Showtime[], layers: SeatHitMap[]): Showtime[] {
  let out = rows;
  for (const layer of [...layers].reverse()) out = applyCgvSeatHits(out, layer, true);
  return out;
}

function applyReporterFallback(rows: Showtime[], reporter: Showtime[]): Showtime[] {
  return rows.map((row) => {
    if (row.restSeats != null) return row;
    const hit = reporter.find((candidate) =>
      candidate.theaterId === row.theaterId &&
      normalizePlayDate(candidate.playDate) === normalizePlayDate(row.playDate) &&
      normTime(candidate.startTime) === normTime(row.startTime) &&
      hallsMatch(candidate.hallName, row.hallName) &&
      (titlesMatch(candidate.movieTitle, row.movieTitle) ||
        Boolean(candidate.movieNo && row.movieNo && candidate.movieNo === row.movieNo)),
    );
    if (!hit || hit.restSeats == null) return row;
    return {
      ...row,
      restSeats: hit.restSeats,
      totalSeats: hit.totalSeats ?? row.totalSeats,
      seatLive: true,
      seatCheckedAt: hit.seatCheckedAt ?? row.seatCheckedAt,
      seatSource: hit.seatSource ?? row.seatSource,
    };
  });
}

function hallsMatch(a: string, b: string): boolean {
  const normalize = (value: string) => String(value || "").toUpperCase().replace(/[\s|()[\]{}·•]/g, "");
  const variants = (value: string) => {
    const base = normalize(value);
    const noBracket = base.replace(/\[.*?\]/g, "");
    const loose = noBracket.replace(/관$/, "");
    return new Set([base, noBracket, loose, `${loose}관`].filter(Boolean));
  };
  const aa = variants(a); const bb = variants(b);
  if (!aa.size || !bb.size) return false;
  for (const v of aa) if (bb.has(v)) return true;
  return false;
}

function normTime(time: string) {
  const digits = String(time || "").replace(/\D/g, "");
  if (digits.length < 3) return String(time || "").trim();
  const padded = digits.length === 3 ? `0${digits}` : digits.slice(0, 4);
  return `${padded.slice(0, 2)}:${padded.slice(-2)}`;
}

function detectSeatSource(rows: Showtime[], maps: { official: SeatHitMap; nas: SeatHitMap; kt: SeatHitMap; relay: SeatHitMap; gas: SeatHitMap }, reporterSource: "pc" | "nas" | "nas423" | "nas225") {
  const seated = rows.filter((row) => row.restSeats != null);
  if (!seated.length) return "none";
  const live = seated.filter((row) => row.seatLive !== false);
  if (!live.length) return "last-known";
  const score = (map: SeatHitMap) => live.filter((row) => lookupSeatHit(row, map)).length;
  const official = score(maps.official), nas = score(maps.nas), kt = score(maps.kt), relay = score(maps.relay), gas = score(maps.gas);
  if (official >= nas && official >= kt && official >= relay && official >= gas && official > 0) return "official";
  if (nas >= kt && nas >= relay && nas >= gas && nas > 0) {
    const rowSource = live.find((row) => row.seatSource === "g-nas423" || row.seatSource === "g-nas225" || row.seatSource === "g-nas" || row.seatSource === "g-pc")?.seatSource;
    if (rowSource) return rowSource;
    if (reporterSource === "nas423") return "g-nas423";
    if (reporterSource === "nas225") return "g-nas225";
    if (reporterSource === "nas") return "g-nas";
    return "g-pc";
  }
  if (kt >= relay && kt >= gas && kt > 0) return "cgv-kt";
  if (relay >= gas && relay > 0) return "cgv-relay";
  if (gas > 0) return "gas-cache";
  const chain = seated[0]?.chain;
  if (chain === "cgv") return "cgv-relay";
  return "official";
}

function byDateForTheater(shows: Showtime[], theaterId: TheaterId): Map<string, Showtime[]> {
  const map = new Map<string, Showtime[]>();
  for (const show of shows) { if (show.theaterId !== theaterId) continue; const normalized = normalizePlayDate(show.playDate); const list = map.get(normalized) ?? []; list.push({ ...show, playDate: normalized }); map.set(normalized, list); }
  return map;
}

export async function pingSeatmap(input: { url?: string; fresh?: boolean; theaterId?: TheaterId; daysAhead?: number }) {
  const days = Math.min(Math.max(input.daysAhead ?? 7, 1), 14); const fresh = Boolean(input.fresh);
  const wantMega = !input.theaterId || input.theaterId === "megabox_coex" || input.theaterId === "megabox_namyangju";
  const wantCgv = !input.theaterId || input.theaterId === "cgv_yongsan" || input.theaterId === "cgv_yeongdeungpo";
  const megaPromise = wantMega ? fetchMegaboxSeatmap({ theaterId: input.theaterId === "megabox_coex" || input.theaterId === "megabox_namyangju" ? input.theaterId : undefined, days: Math.min(days, 5), fresh }).catch(() => ({ map: {} as SeatHitMap, showtimes: [] as Showtime[] })) : Promise.resolve({ map: {} as SeatHitMap, showtimes: [] as Showtime[] });
  const officialCgvPromise = wantCgv ? fetchCgvOfficialSeatmap({ theaterId: input.theaterId === "cgv_yongsan" || input.theaterId === "cgv_yeongdeungpo" ? input.theaterId : undefined, days: Math.min(days, 7), fresh }).catch(() => ({ map: {} as SeatHitMap, showtimes: [] as Showtime[] })) : Promise.resolve({ map: {} as SeatHitMap, showtimes: [] as Showtime[] });
  const [mega, officialCgv] = await Promise.all([megaPromise, officialCgvPromise]);
  const megaHit = Object.keys(mega.map).length > 0 || mega.showtimes.some((row) => typeof row.restSeats === "number");
  const cgvOfficialHit = Object.keys(officialCgv.map).length > 0 || officialCgv.showtimes.some((row) => typeof row.restSeats === "number");
  const relay = wantCgv && !cgvOfficialHit ? await fetchCgvRelaySeatmap({ theaterId: input.theaterId === "cgv_yongsan" || input.theaterId === "cgv_yeongdeungpo" ? input.theaterId : undefined, days, fresh }).catch(() => ({ map: {} as SeatHitMap, showtimes: [] as Showtime[] })) : { map: {} as SeatHitMap, showtimes: [] as Showtime[] };
  let gasMap: SeatHitMap = {}; let gasShows: Showtime[] = []; let gasStatus: "ok" | "old" | "denied" | "empty" | "badurl" | "timeout" = "empty";
  if (input.url?.trim() && ((wantMega && !megaHit) || (wantCgv && !cgvHit))) {
    const live = await loadGasTimetable(input.url.trim(), days, input.theaterId).catch(() => [] as Showtime[]);
    if (live.length) { gasShows = live; for (const row of live) putSeatHit(gasMap, row); gasStatus = "ok"; } else { const gas = await loadGasSeatmap(input.url, fresh); gasMap = gas.map; gasStatus = gas.status; }
  }
  const map = { ...gasMap, ...relay.map, ...officialCgv.map, ...mega.map };
  const extraShows = [...gasShows, ...relay.showtimes, ...officialCgv.showtimes, ...mega.showtimes];
  const keys = Object.keys(map); const cgvCount = keys.filter((key) => key.startsWith("k:") || key.startsWith("cgv:")).length;
  const status = keys.length || extraShows.length ? ("ok" as const) : gasStatus;
  return { status, count: keys.length || extraShows.length, cgvCount, map, showtimes: extraShows };
}

async function loadGasTimetable(url: string, days: number, theaterId?: TheaterId): Promise<Showtime[]> {
  const params: Record<string, string> = { op: "live", days: String(Math.min(days, 30)) }; if (theaterId) params.theater = theaterId;
  const live = await loadGasJson(url, params); if (live.length) return live;
  const mega = await loadGasJson(url, { ...params, op: "mega" }); if (mega.length) return mega;
  return loadGasShows(url);
}

async function loadGasJson(url: string, params: Record<string, string>): Promise<Showtime[]> {
  let target: URL; try { target = new URL(url.trim()); } catch { return []; }
  const host = target.hostname; if (!host.endsWith("script.google.com") && !host.endsWith("googleusercontent.com")) return [];
  for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value);
  try { const res = await fetch(target.toString(), { redirect: "follow", signal: AbortSignal.timeout(25000) }); const text = await res.text(); if (!text || /sign in|accounts\.google/i.test(text)) return []; const start = text.indexOf("["); const end = text.lastIndexOf("]"); if (start < 0 || end <= start) return []; const json = JSON.parse(text.slice(start, end + 1)) as GasShowRow[]; if (!Array.isArray(json)) return []; return json.map(gasRowToShowtime).filter((row): row is Showtime => Boolean(row)); } catch { return []; }
}

async function loadGasShows(url: string): Promise<Showtime[]> { return loadGasJson(url, { op: "shows" }); }

function gasRowToShowtime(row: GasShowRow): Showtime | null {
  const theaterId = row.theaterId as TheaterId | undefined; const playDate = normalizePlayDate(String(row.date || "")); const startTime = String(row.time || ""); const title = String(row.title || "").trim();
  if (!theaterId || !playDate || !startTime || !title || !["megabox_coex", "megabox_namyangju", "cgv_yongsan", "cgv_yeongdeungpo"].includes(theaterId)) return null;
  const chain = theaterId.startsWith("cgv_") ? "cgv" : "megabox";
  return { id: row.id || `${chain}:${theaterId}:${playDate}:${startTime}:${row.hall || ""}:${title}`, theaterId, theaterName: String(row.theater || "").replace(/^메가박스\s*|^CGV\s*/, "") || theaterId, chain, movieTitle: title, movieNo: "", playDate, startTime, endTime: null, hallName: String(row.hall || ""), formats: Array.isArray(row.formats) ? row.formats : [], restSeats: typeof row.restSeats === "number" ? row.restSeats : null, totalSeats: typeof row.totalSeats === "number" ? row.totalSeats : null, bookingUrl: String(row.url || ""), bookable: true };
}

async function loadGasSeatmap(url: string, fresh = false): Promise<{ status: "ok" | "old" | "denied" | "empty" | "badurl" | "timeout"; map: GasSeatMap }> {
  let target: URL; try { target = new URL(url.trim()); } catch { return { status: "badurl", map: {} }; }
  const host = target.hostname; if (!host.endsWith("script.google.com") && !host.endsWith("googleusercontent.com")) return { status: "badurl", map: {} };
  target.searchParams.set("op", "seatmap"); if (fresh) target.searchParams.set("fresh", "1");
  try { const res = await fetch(target.toString(), { redirect: "follow", signal: AbortSignal.timeout(fresh ? 20000 : 15000) }); const text = await res.text(); if (!text || /sign in|accounts\.google/i.test(text)) return { status: "denied", map: {} }; const start = text.indexOf("{"); const end = text.lastIndexOf("}"); if (start < 0 || end <= start) return { status: "old", map: {} }; const json = JSON.parse(text.slice(start, end + 1)) as GasSeatMap; if (!json || typeof json !== "object") return { status: "old", map: {} }; const cgvCount = Object.keys(json).filter((key) => key.startsWith("k:") || key.startsWith("cgv:")).length; if (!Object.keys(json).length) return { status: "empty", map: {} }; if (fresh && !cgvCount) return { status: "empty", map: json }; return { status: "ok", map: json }; } catch (err) { const msg = err instanceof Error ? err.message : ""; if (/abort|timeout/i.test(msg)) return { status: "timeout", map: {} }; return { status: "old", map: {} }; }
}
