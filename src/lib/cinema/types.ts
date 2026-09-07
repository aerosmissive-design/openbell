import type { ThemeMode } from "@/lib/theme";

export type TheaterId =
  | "megabox_coex"
  | "megabox_namyangju"
  | "cgv_yongsan"
  | "cgv_yeongdeungpo";

export type FormatId =
  | "dolby"
  | "mx4d"
  | "mega_led"
  | "screenx"
  | "4dx"
  | "ultra4dx"
  | "atmos"
  | "imax"
  | "other";

export type MovieTab = "chart" | "showing";

export const CHART_SIZE = 9;

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
};

export type TheaterScan = {
  theaterId: TheaterId;
  ok: boolean;
  error: string | null;
  showtimes: Showtime[];
  source: string;
};

export type ScanResult = {
  scannedAt: string;
  playDates: string[];
  ranking: RankingMovie[];
  showing: RankingMovie[];
  theaters: TheaterScan[];
};

export type ScanProps = {
  scan: ScanResult | null;
  loading: boolean;
  error: Error | null;
  onRefresh: () => void;
  refreshing: boolean;
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
};

export type BookingIntent = {
  id: string;
  queuedAt: string;
  theaterId: TheaterId;
  movieTitle: string;
  playDate: string;
  startTime: string;
  hallName: string;
  showtimeId: string;
  bookingUrl: string;
  restSeats: number | null;
  totalSeats: number | null;
  note: string;
};

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
  gasWebUrl: string;
  gasSyncKey: string;
  scanSources: ScanSources;
  theme: ThemeMode;
};

export type ScanStage = "official" | "naver" | "gas";

export type ScanSources = Record<ScanStage, boolean>;

export const DEFAULT_SCAN_SOURCES: ScanSources = {
  official: true,
  naver: true,
  gas: true,
};

export function normalizeScanSources(
  raw?: Partial<ScanSources> | null,
): ScanSources {
  const next: ScanSources = {
    official: raw?.official ?? true,
    naver: raw?.naver ?? true,
    gas: raw?.gas ?? true,
  };
  if (!next.official && !next.naver && !next.gas) {
    return { ...DEFAULT_SCAN_SOURCES };
  }
  return next;
}

export function mailEnabled(config: WatchConfig) {
  return Boolean(config.emailNotify && config.email.trim());
}

export function sourceLabel(source: string) {
  if (source === "official" || source === "cgv" || source === "megabox-schedule") {
    return "공홈";
  }
  if (source === "naver-place") return "네이버";
  if (source === "gas-cache") return "구글";
  if (source === "yongsan-channel") return "용아맥";
  return "연결됨";
}

export const SCAN_STAGE_META: {
  id: ScanStage;
  step: string;
  title: string;
  body: string;
}[] = [
  {
    id: "official",
    step: "1",
    title: "극장 공홈",
    body: "메가박스 공식 시간표입니다. CGV 공홈은 막혀 있어 이 단계는 건너뜁니다.",
  },
  {
    id: "naver",
    step: "2",
    title: "네이버",
    body: "공홈이 막히거나 비어 있으면 네이버 플레이스 시간표로 넘어갑니다. CGV는 여기서 시작합니다. 잔여석은 없습니다.",
  },
  {
    id: "gas",
    step: "3",
    title: "구글·기타",
    body: "그래도 없으면 구글에 받아 둔 시간표를 씁니다. 용산 IMAX는 팬들이 상영 시간을 올리는 공개 텔레그램 채널(용아맥)도 봅니다. 채널에는 잔여석이 없습니다.",
  },
];
