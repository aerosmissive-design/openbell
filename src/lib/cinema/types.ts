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
  seatSource: string;
};

export type ScanResult = {
  scannedAt: string;
  playDates: string[];
  ranking: RankingMovie[];
  showing: RankingMovie[];
  catalog: RankingMovie[];
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

export function xEnabled(
  config: Pick<
    WatchConfig,
    | "xApiKey"
    | "xApiSecret"
    | "xAccessToken"
    | "xAccessSecret"
  >,
) {
  if (config.xAccessToken.trim()) return true;
  return Boolean(
    config.xApiKey.trim() &&
      config.xApiSecret.trim() &&
      config.xAccessSecret.trim(),
  );
}

export function sourceLabel(source: string) {
  return sourcePlace(source) || "연결됨";
}

export function sourcePlace(source: string) {
  if (source === "official" || source === "cgv" || source === "megabox-schedule") {
    return "극장 공홈";
  }
  if (source === "naver-place") return "네이버";
  if (source === "gas-cache") return "구글 스크립트";
  if (source === "yongsan-channel") return "용아맥 채널";
  if (source === "cgv-relay") return "CGV 우회조회";
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
}) {
  if (input.seatSource && input.seatSource !== "none") return input.seatSource;
  if (!input.hasSeats) return "none";
  if (input.theaterId.startsWith("cgv")) return "cgv-relay";
  if (input.source === "gas-cache") return "gas-cache";
  return "official";
}

export const TIMETABLE_HELP = [
  {
    step: "1",
    title: "극장 공홈",
    body: "메가박스 공식 시간표입니다. 이 앱 서버에서 CGV 공홈은 막혀 있어 건너뜁니다.",
  },
  {
    step: "2",
    title: "네이버",
    body: "공홈이 막히거나 비면 네이버 플레이스 시간표로 넘어갑니다. CGV는 웹에서 여기서 시작합니다.",
  },
  {
    step: "3",
    title: "구글·기타",
    body: "구글 스크립트가 구글 계정으로 CGV 공홈(모바일·API)을 다시 받아 옵니다. 그래도 없으면 받아 둔 시간표를 쓰고, 용산은 용아맥 채널도 봅니다.",
  },
];

export const SEAT_HELP = [
  {
    step: "1",
    title: "극장 공홈",
    body: "메가박스는 공식 좌석 숫자를 붙입니다. CGV 공홈 좌석은 이 앱 서버에선 막혀 건너뜁니다.",
  },
  {
    step: "2",
    title: "CGV 우회조회",
    body: "용산·영등포 잔여석은 CGV 시간표를 대신 받아 주는 우회조회로 붙입니다.",
  },
  {
    step: "3",
    title: "구글 스크립트",
    body: "구글 스크립트가 CGV 공홈에서 받은 좌석을 붙입니다. 네이버와 용아맥에는 잔여석이 없습니다.",
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
