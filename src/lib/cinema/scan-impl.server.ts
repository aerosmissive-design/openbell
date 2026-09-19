import { kstDateKeys } from "@/lib/utils";
import {
  fetchCgvNaver,
  fetchCgvOfficialSeatmap,
  fetchCgvRelaySeatmap,
  isCgvId,
} from "./cgv.server";
import { fetchCgvKtSeatmap } from "./kt.server";
import { fetchMegaboxSeatmap, fetchNaverMegabox } from "./megabox.server";
import { readNasSeatmap, readNasReporterTimes } from "./nas.server";
import { mergeShowtimes, putSeatHit, type SeatHitMap } from "./seats";
import { THEATERS } from "./theaters";
import type { ScanResult, Showtime, TheaterId } from "./types";

const SCAN_DEADLINES = {
  fastNas: 2800,
  nas: 4000,
  naver: 4000,
  officialCgv: 8000,
  relay: 8000,
  kt: 8000,
  mega: 8000,
};

async function deadline<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function emptyMap(): { map: SeatHitMap; showtimes: Showtime[] } {
  return { map: {}, showtimes: [] };
}

function splitNasMaps(showtimes: Showtime[]) {
  const pcMap: SeatHitMap = {};
  const nas225Map: SeatHitMap = {};
  const nas423Map: SeatHitMap = {};
  for (const row of showtimes) {
    const src = String(row.seatSource || "").toLowerCase();
    if (src === "g-nas225+" || src === "nas225" || src === "nas225+") putSeatHit(nas225Map, row);
    else if (src === "g-nas423+" || src === "nas423" || src === "nas423+") putSeatHit(nas423Map, row);
    else putSeatHit(pcMap, row);
  }
  return { pcMap, nas225Map, nas423Map };
}

function latestSeatSourceTimes(
  theaterId: TheaterId,
  sources: { key: string; map: SeatHitMap; source?: string }[],
) {
  const out: Record<string, string> = {};
  const siteNo =
    (
      {
        cgv_yongsan: "0013",
        cgv_yeongdeungpo: "0059",
        megabox_coex: "1351",
        megabox_namyangju: "0019",
      } as Record<string, string>
    )[theaterId] ?? "";
  const prefixes = siteNo ? [`k:${siteNo}|`, `m:${siteNo}|`] : [];
  for (const source of sources) {
    let latest = 0;
    for (const [key, hit] of Object.entries(source.map)) {
      if (!hit || typeof hit.at !== "number" || !Number.isFinite(hit.at)) continue;
      if (source.source) {
        const hs = String(hit.source || "").toLowerCase();
        const want = String(source.source).toLowerCase();
        const aliases = new Set([want, `g-${want}`, want.replace(/^g-/, "")]);
        if (want === "nas423" || want === "g-nas423+") {
          aliases.add("g-nas423+");
          aliases.add("nas423");
          aliases.add("nas423+");
        }
        if (want === "nas225" || want === "g-nas225+") {
          aliases.add("g-nas225+");
          aliases.add("nas225");
          aliases.add("nas225+");
        }
        if (want === "pc" || want === "g-pc") {
          aliases.add("g-pc");
          aliases.add("pc");
          aliases.add("nas-report");
        }
        if (hs && !aliases.has(hs)) continue;
      }
      if (!prefixes.some((prefix) => key.startsWith(prefix))) continue;
      latest = Math.max(latest, hit.at);
    }
    if (latest > 0) out[source.key] = new Date(latest).toISOString();
  }
  return out;
}

async function fetchNaverShowtimes(wanted: TheaterId[]): Promise<Showtime[]> {
  const rows: Showtime[] = [];
  await Promise.all(
    wanted.map(async (id) => {
      try {
        const byDate = isCgvId(id)
          ? await fetchCgvNaver(id)
          : id === "megabox_coex" || id === "megabox_namyangju"
            ? await fetchNaverMegabox(id)
            : null;
        if (!byDate) return;
        for (const list of byDate.values()) rows.push(...list);
      } catch {
        /* 네이버가 막혀도 다른 소스 유지 */
      }
    }),
  );
  return rows;
}

function hasFor(rows: Showtime[], theaterId: TheaterId) {
  return rows.some((s) => s.theaterId === theaterId);
}

function detectTimetableSource(
  theaterId: TheaterId,
  packs: { name: string; rows: Showtime[] }[],
): string {
  const has = (name: string) => {
    const pack = packs.find((p) => p.name === name);
    return pack ? hasFor(pack.rows, theaterId) : false;
  };
  if (theaterId.startsWith("megabox")) {
    if (has("official")) return "official";
    if (has("naver")) return "naver";
    if (has("nas423")) return "g-nas423+";
    if (has("nas225")) return "g-nas225+";
    if (has("nas")) return "g-pc";
    if (has("kt")) return "mega-mobile";
    return "none";
  }
  if (has("official")) return "official";
  if (has("naver")) return "naver";
  if (has("nas423")) return "g-nas423+";
  if (has("nas225")) return "g-nas225+";
  if (has("nas")) return "g-pc";
  if (has("kt")) return "cgv-kt";
  if (has("relay")) return "cgv-relay";
  return "none";
}

function detectSeatSource(
  theaterId: TheaterId,
  nasSource: string,
  packs: { name: string; rows: Showtime[] }[],
  merged: Showtime[],
): string {
  const seated = merged.filter(
    (s) => s.theaterId === theaterId && typeof s.restSeats === "number",
  );
  const voted = seated.find((s) => s.seatSource && s.seatSource !== "none")?.seatSource;
  if (voted) return voted;
  const has = (name: string) => {
    const pack = packs.find((p) => p.name === name);
    return pack ? pack.rows.some((s) => s.theaterId === theaterId && typeof s.restSeats === "number") : false;
  };
  if (has("official")) return "official";
  if (nasSource === "nas423" && has("nas423")) return "g-nas423+";
  if (nasSource === "nas225" && has("nas225")) return "g-nas225+";
  if (has("nas")) return "g-pc";
  if (has("kt")) return theaterId.startsWith("megabox") ? "mega-mobile" : "cgv-kt";
  if (has("relay")) return "cgv-relay";
  return seated.length ? "official" : "none";
}

/** 같은 회차는 정밀 예매 URL이 이기도록 mergeShowtimes로 합친다. */
function foldShows(layers: Showtime[][]): Showtime[] {
  let out: Showtime[] = [];
  for (const layer of layers) {
    if (!layer.length) continue;
    out = out.length ? mergeShowtimes(layer, out) : layer;
  }
  return out;
}

export async function runScan(input: {
  theaters: TheaterId[];
  daysAhead: number;
  gasWebUrl?: string;
  mode?: "fast" | "full";
  sources?: { official?: boolean; naver?: boolean; gas?: boolean };
}): Promise<ScanResult> {
  const days = Math.min(Math.max(input.daysAhead || 7, 1), 30);
  const playDates = kstDateKeys(days);
  const wanted = input.theaters.length
    ? input.theaters
    : (THEATERS.map((t) => t.id) as TheaterId[]);
  const fast = input.mode === "fast";
  const wantNaver = input.sources?.naver !== false;
  const hasCgv = wanted.some(isCgvId);
  const hasMega = wanted.some((id) => id.startsWith("megabox"));

  const emptyNas = { map: {} as SeatHitMap, showtimes: [] as Showtime[], source: "pc" as const };

  const officialCgvPromise =
    !fast && hasCgv
      ? deadline(
          fetchCgvOfficialSeatmap({ days: Math.min(days, 7) }),
          SCAN_DEADLINES.officialCgv,
          emptyMap(),
        )
      : Promise.resolve(emptyMap());
  const relayPromise =
    !fast && hasCgv
      ? deadline(fetchCgvRelaySeatmap({ days }), SCAN_DEADLINES.relay, emptyMap())
      : Promise.resolve(emptyMap());
  const ktPromise =
    hasCgv || hasMega
      ? deadline(
          fetchCgvKtSeatmap({
            theaters: wanted.filter((id) => isCgvId(id) || id.startsWith("megabox")),
            dates: playDates.slice(0, fast ? 2 : 3),
          }),
          fast ? 5000 : SCAN_DEADLINES.kt,
          emptyMap(),
        )
      : Promise.resolve(emptyMap());
  const megaPromise =
    !fast && hasMega
      ? deadline(
          fetchMegaboxSeatmap({ days: Math.min(days, 5) }),
          SCAN_DEADLINES.mega,
          emptyMap(),
        )
      : Promise.resolve(emptyMap());
  const nasPromise = deadline(
    readNasSeatmap([...wanted], { maxAgeMs: 30 * 60 * 1000 }),
    fast ? SCAN_DEADLINES.fastNas : SCAN_DEADLINES.nas,
    emptyNas,
  );
  const naverPromise = wantNaver
    ? deadline(fetchNaverShowtimes(wanted), SCAN_DEADLINES.naver, [] as Showtime[])
    : Promise.resolve([] as Showtime[]);

  const [officialCgv, relay, kt, mega, nas, naver] = await Promise.all([
    officialCgvPromise,
    relayPromise,
    ktPromise,
    megaPromise,
    nasPromise,
    naverPromise,
  ]);

  const officialMap: SeatHitMap = { ...officialCgv.map, ...mega.map };
  const { nas225Map, nas423Map } = splitNasMaps(nas.showtimes);
  const nas423Rows = nas.showtimes.filter((s) => {
    const src = String(s.seatSource || "").toLowerCase();
    return src === "g-nas423+" || src === "nas423" || src === "nas423+";
  });
  const nas225Rows = nas.showtimes.filter((s) => {
    const src = String(s.seatSource || "").toLowerCase();
    return src === "g-nas225+" || src === "nas225" || src === "nas225+";
  });

  const theaters = wanted.map((theaterId) => {
    const meta = THEATERS.find((t) => t.id === theaterId);
    const packs = [
      { name: "naver", rows: naver.filter((s) => s.theaterId === theaterId) },
      { name: "relay", rows: relay.showtimes.filter((s) => s.theaterId === theaterId) },
      { name: "kt", rows: kt.showtimes.filter((s) => s.theaterId === theaterId) },
      {
        name: "official",
        rows: [
          ...officialCgv.showtimes.filter((s) => s.theaterId === theaterId),
          ...mega.showtimes.filter((s) => s.theaterId === theaterId),
        ],
      },
      { name: "nas", rows: nas.showtimes.filter((s) => s.theaterId === theaterId) },
      { name: "nas225", rows: nas225Rows.filter((s) => s.theaterId === theaterId) },
      { name: "nas423", rows: nas423Rows.filter((s) => s.theaterId === theaterId) },
    ];
    const showtimes = foldShows(packs.map((p) => p.rows));
    const source = showtimes.length ? detectTimetableSource(theaterId, packs) : "none";
    const seatSource = detectSeatSource(theaterId, nas.source, packs, showtimes);
    return {
      theaterId,
      theaterName: meta?.name || theaterId,
      ok: showtimes.length > 0,
      source,
      seatSource,
      showtimes,
      error: showtimes.length || fast ? null : "데이터 없음",
    };
  });

  const reporterTimes = await readNasReporterTimes([...wanted], { maxAgeMs: 30 * 60 * 1000 }).catch(
    () => ({} as Record<string, Record<string, string>>),
  );
  const seatSourceTimes = Object.fromEntries(
    wanted.map((theaterId) => {
      const fromMaps = latestSeatSourceTimes(theaterId, [
        { key: "official", map: officialMap },
        { key: "cgv-kt", map: kt.map },
        { key: "cgv-relay", map: relay.map },
        { key: "g-nas225+", map: nas225Map, source: "g-nas225+" },
        { key: "g-nas423+", map: nas423Map, source: "g-nas423+" },
        { key: "gas-cache", map: {} },
      ]);
      const fromReporter = reporterTimes[theaterId] || {};
      return [theaterId, { ...fromMaps, ...fromReporter }];
    }),
  );

  return {
    scannedAt: new Date().toISOString(),
    playDates,
    ranking: [],
    showing: [],
    catalog: [],
    theaters,
    seatSourceTimes,
  };
}

export async function pingSeatmap(input: {
  url?: string;
  fresh?: boolean;
  theaterId?: TheaterId;
  daysAhead?: number;
}) {
  const days = Math.min(Math.max(input.daysAhead ?? 7, 1), 14);
  const fresh = Boolean(input.fresh);
  const wantMega =
    !input.theaterId ||
    input.theaterId === "megabox_coex" ||
    input.theaterId === "megabox_namyangju";
  const wantCgv =
    !input.theaterId ||
    input.theaterId === "cgv_yongsan" ||
    input.theaterId === "cgv_yeongdeungpo";

  const megaPromise = wantMega
    ? fetchMegaboxSeatmap({
        theaterId:
          input.theaterId === "megabox_coex" || input.theaterId === "megabox_namyangju"
            ? input.theaterId
            : undefined,
        days: Math.min(days, 5),
        fresh,
      }).catch(() => emptyMap())
    : Promise.resolve(emptyMap());
  const officialCgvPromise = wantCgv
    ? fetchCgvOfficialSeatmap({
        theaterId:
          input.theaterId === "cgv_yongsan" || input.theaterId === "cgv_yeongdeungpo"
            ? input.theaterId
            : undefined,
        days: Math.min(days, 7),
        fresh,
      }).catch(() => emptyMap())
    : Promise.resolve(emptyMap());
  const nasTheaters = (
    ["cgv_yongsan", "cgv_yeongdeungpo", "megabox_coex", "megabox_namyangju"] as TheaterId[]
  ).filter((id) => !input.theaterId || input.theaterId === id);
  const ktPromise = nasTheaters.length
    ? deadline(
        fetchCgvKtSeatmap({
          theaters: nasTheaters.filter((id) => isCgvId(id) || id.startsWith("megabox")),
          dates: kstDateKeys(Math.min(days, 2)),
        }),
        8000,
        emptyMap(),
      )
    : Promise.resolve(emptyMap());
  const naverPromise = deadline(fetchNaverShowtimes(nasTheaters), 4000, [] as Showtime[]);

  const [mega, officialCgv, kt, naver] = await Promise.all([
    megaPromise,
    officialCgvPromise,
    ktPromise,
    naverPromise,
  ]);
  const cgvOfficialHit =
    Object.keys(officialCgv.map).length > 0 ||
    officialCgv.showtimes.some((row) => typeof row.restSeats === "number");

  const relay =
    wantCgv && !cgvOfficialHit
      ? await fetchCgvRelaySeatmap({
          theaterId:
            input.theaterId === "cgv_yongsan" || input.theaterId === "cgv_yeongdeungpo"
              ? input.theaterId
              : undefined,
          days,
          fresh,
        }).catch(() => emptyMap())
      : emptyMap();

  const nas = await readNasSeatmap(nasTheaters, { maxAgeMs: 30 * 60 * 1000 }).catch(() => ({
    map: {} as SeatHitMap,
    showtimes: [] as Showtime[],
    source: "pc" as const,
  }));

  const map = { ...relay.map, ...kt.map, ...officialCgv.map, ...mega.map, ...nas.map };
  const extraShows = [
    ...naver,
    ...relay.showtimes,
    ...kt.showtimes,
    ...officialCgv.showtimes,
    ...mega.showtimes,
    ...nas.showtimes,
  ];
  const keys = Object.keys(map);
  const reporterTimes = await readNasReporterTimes(nasTheaters, { maxAgeMs: 30 * 60 * 1000 }).catch(
    () => ({} as Record<string, Record<string, string>>),
  );
  const seatSourceTimes: Record<string, Record<string, string>> = {};
  for (const theaterId of nasTheaters) {
    const fromMaps = latestSeatSourceTimes(theaterId, [
      { key: "official", map: { ...officialCgv.map, ...mega.map } },
      { key: "cgv-kt", map: kt.map },
      { key: "cgv-relay", map: relay.map },
    ]);
    const fromReporter = reporterTimes[theaterId] || {};
    seatSourceTimes[theaterId] = { ...fromMaps, ...fromReporter };
  }
  return {
    status: keys.length || extraShows.length ? ("ok" as const) : ("empty" as const),
    count: keys.length || extraShows.length,
    cgvCount: keys.filter((k) => k.startsWith("k:") || k.startsWith("cgv:")).length,
    map,
    showtimes: extraShows,
    seatSourceTimes,
  };
}
