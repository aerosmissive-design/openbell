import type { ThemeMode } from "@/lib/theme";

export type TheaterId =
  | "megabox_coex"
  | "megabox_namyangju"
  | "cgv_yongsan"
  | "cgv_yeongdeungpo";

export type FormatId =
  | "2d"
  | "3d"
  | "4dx"
  | "imax"
  | "screenx"
  | "dolby"
  | "private"
  | "recliner"
  | "mx4d"
  | "other";

export type RankingMovie = {
  rank: number;
  title: string;
  movieNo: string;
  bookingRate: number | null;
  posterUrl: string | null;
  releaseDate: string | null;
  bookingOpen: boolean;
  released: boolean;
};

export type Showtime = {
  id: string;
  theaterId: TheaterId;
  theaterName: string;
  chain: "megabox" | "cgv";
  movieTitle: string;
  movieNo: string;
  playDate: string;
  startTime: string;
  endTime: string | null;
  hallName: string;
  formats: FormatId[];
  restSeats: number | null;
  totalSeats: number | null;
  bookingUrl: string;
  bookable: boolean;
  seatLive?: boolean;
  seatCheckedAt?: string | null;
  seatSource?: string;
};

export type TheaterScan = {
  theaterId: TheaterId;
  ok: boolean;
  error: string | null;
  showtimes: Showtime[];
  source: string;
  seatSource: string;
};

export type ScanResult = {
  scannedAt: string;
  playDates: string[];
  ranking: RankingMovie[];
  showing: RankingMovie[];
  catalog: RankingMovie[];
  catalogNote?: string;
  theaters: TheaterScan[];
  seatSourceTimes?: Record<string, Record<string, string>>;
};

export type AlertItem = {
  id: string;
  createdAt: string;
  kind: "open" | "seat";
  title: string;
  body: string;
  bookingUrl: string;
  theaterId: TheaterId;
  movieTitle: string;
  playDate: string;
  startTime: string;
  hallName: string;
  formats: FormatId[];
  restSeats: number | null;
  totalSeats?: number | null;
  seatSource?: string;
};

export type MovieTab = "chart" | "showing" | "search";
export type ScanStage = "official" | "naver" | "gas";

export type WatchConfig = {
  ranks: number[];
  watchTitles: string[];
  movieTab: MovieTab;
  theaters: Record<TheaterId, boolean>;
  formats: Record<TheaterId, FormatId[]>;
  intervalMin: number;
  daysAhead: number;
  browserNotify: boolean;
  telegramToken: string;
  telegramChatId: string;
  webhookUrl: string;
  email: string;
  emailNotify: boolean;
  gmailAppPassword: string;
  kakaoRestKey: string;
  kakaoRefreshToken: string;
  xApiKey: string;
  xApiSecret: string;
  xAccessToken: string;
  xAccessSecret: string;
  xClientId: string;
  xClientSecret: string;
  xRefreshToken: string;
  gasWebUrl: string;
  gasSyncKey: string;
  gasScriptId: string;
  gasSourceStamp: string;
  scanSources: ScanSources;
  theme: ThemeMode;
  hold: HoldPrefs;
};

export type ScanSources = Record<ScanStage, boolean>;
export const DEFAULT_SCAN_SOURCES: ScanSources = { official: true, naver: true, gas: true };
export function normalizeScanSources(raw?: Partial<ScanSources> | null): ScanSources {
  const next: ScanSources = {
    official: raw?.official ?? true,
    naver: raw?.naver ?? true,
    gas: raw?.gas ?? true,
  };
  if (!next.official && !next.naver && !next.gas) return { ...DEFAULT_SCAN_SOURCES };
  return next;
}

export type HoldPrefs = { enabled: boolean; minutes: number; seatStrategy: "edge" | "center" | "any" };
export function normalizeHold(raw?: Partial<HoldPrefs> | null): HoldPrefs {
  return {
    enabled: Boolean(raw?.enabled),
    minutes: Math.min(30, Math.max(5, Number(raw?.minutes) || 10)),
    seatStrategy: raw?.seatStrategy === "center" || raw?.seatStrategy === "any" ? raw.seatStrategy : "edge",
  };
}

export const CHART_SIZE = 9;

export function sourceLabel(source: string) {
  return sourcePlace(source) || "연결됨";
}
export function sourcePlace(source: string) {
  if (source === "official" || source === "megabox" || source === "cgv") return "공홈";
  if (source === "g-pc" || source === "pc" || source === "nas-report") return "G_PC";
  if (source === "g-nas225+" || source === "nas225" || source === "nas225+") return "G_NAS225+";
  if (source === "g-nas423+" || source === "nas423" || source === "nas423+") return "G_NAS423+";
  if (source === "cgv-relay") return "CGV 우회조회";
  if (source === "cgv-kt") return "KT 우회조회";
  if (source === "mega-mobile") return "메가 우회조회";
  if (source === "gas-cache" || source === "gas") return "GAS";
  if (source === "naver") return "네이버";
  if (source === "last-known") return "마지막 확인";
  if (source === "none") return "없음";
  return "";
}
export function timetableSourceLabel(source: string, ok: boolean) {
  if (!ok) return "실패";
  return sourcePlace(source) || "없음";
}
export function seatSourceLabel(source?: string) {
  if (!source || source === "none") return "없음";
  return sourcePlace(source) || "없음";
}
export function inferSeatSource(input: {
  theaterId: string;
  seatSource?: string;
  source?: string;
  hasSeats: boolean;
  cachedOnly?: boolean;
}) {
  if (input.seatSource && input.seatSource !== "none" && input.seatSource !== "last-known")
    return input.seatSource;
  if (input.cachedOnly && input.hasSeats) return "last-known";
  if (!input.hasSeats) return "none";
  if (input.theaterId.startsWith("cgv")) return "cgv-relay";
  if (input.source === "gas-cache") return "gas-cache";
  return "official";
}

export function mailEnabled(config: Pick<WatchConfig, "email" | "emailNotify" | "gmailAppPassword">) {
  return Boolean(config.emailNotify && config.email?.trim() && config.gmailAppPassword?.trim());
}

export type BookingIntent = {
  id: string;
  createdAt: string;
  theaterId: TheaterId;
  movieTitle: string;
  playDate: string;
  startTime: string;
  hallName: string;
  bookingUrl: string;
  restSeats: number | null;
  totalSeats: number | null;
};

export type HoldStep = "idle" | "open" | "wait" | "done" | "fail";
export type HoldSession = {
  id: string;
  theaterId: TheaterId;
  movieTitle: string;
  playDate: string;
  startTime: string;
  hallName: string;
  bookingUrl: string;
  step: HoldStep;
  holdStartedAt?: string | null;
};

export const SEAT_HELP = [
  {
    step: "1",
    title: "극장 공홈",
    body: "메가박스는 공식 좌석 숫자를 붙입니다. CGV 공홈 좌석은 이 서버에서 막혀 건너뜁니다.",
  },
  {
    step: "2",
    title: "G_PC / G_NAS",
    body: "PC 또는 NAS가 집 인터넷으로 CGV 공홈 잔여석을 읽어 오픈벨에 올립니다. 공홈 다음 2순위입니다. IMAX는 더 자주 확인합니다.",
  },
  {
    step: "3",
    title: "CGV 우회조회",
    body: "집 리포터가 없거나 끊기면 우회조회·KT 순으로 붙입니다. 구글스크립트는 없어도 됩니다.",
  },
  {
    step: "4",
    title: "마지막 확인",
    body: "공홈·집 리포터·우회가 모두 실패하면, 마지막으로 성공한 숫자를 ‘N분 전 확인’으로 보여 줍니다. 이번 조회에서 받은 숫자는 ‘실시간’입니다.",
  },
];

export const CHART_HELP = [
  {
    step: "1",
    title: "메가박스 차트",
    body: "무비차트 9칸과 현재상영작 9칸은 메가박스 공식 영화 목록(예매율·개봉일)에서 받습니다.",
  },
  {
    step: "2",
    title: "시간표로 채움",
    body: "차트 호출이 실패하면 극장 시간표에 잡힌 제목으로 칸을 채웁니다.",
  },
  {
    step: "3",
    title: "직접 추가",
    body: "돋보기는 메가박스 공홈(현재+예정)을 먼저 보고, CGV는 공홈 → 네이버 → 우회 순입니다. 네 극장 시간표 제목도 합칩니다. 제목만 추가해 두면 나중에 예매가 열려도 다시 고를 필요 없습니다.",
  },
];
