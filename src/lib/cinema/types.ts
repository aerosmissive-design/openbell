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
  seatLive?: boolean;
  seatCheckedAt?: string | null;
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

export type HoldZone = "center" | "rear" | "front";

export type HoldStep = "seats" | "pay" | "wait";

export type HoldPrefs = {
  enabled: boolean;
  seats: number;
  zone: HoldZone;
  autoOpen: boolean;
  minutes: number;
};

export const DEFAULT_HOLD: HoldPrefs = {
  enabled: false,
  seats: 2,
  zone: "center",
  autoOpen: false,
  minutes: 10,
};

export function normalizeHold(raw?: Partial<HoldPrefs> | null): HoldPrefs {
  const seats = Number(raw?.seats);
  const minutes = Number(raw?.minutes);
  const zone = raw?.zone;
  return {
    enabled: raw?.enabled ?? DEFAULT_HOLD.enabled,
    seats:
      Number.isFinite(seats) && seats >= 1
        ? Math.min(8, Math.max(1, Math.round(seats)))
        : DEFAULT_HOLD.seats,
    zone:
      zone === "rear" || zone === "front" || zone === "center"
        ? zone
        : DEFAULT_HOLD.zone,
    autoOpen: raw?.autoOpen ?? DEFAULT_HOLD.autoOpen,
    minutes:
      Number.isFinite(minutes) && minutes >= 5
        ? Math.min(20, Math.max(5, Math.round(minutes)))
        : DEFAULT_HOLD.minutes,
  };
}

export type HoldSession = {
  id: string;
  startedAt: string;
  theaterId: TheaterId;
  movieTitle: string;
  playDate: string;
  startTime: string;
  hallName: string;
  formats: FormatId[];
  showtimeId: string;
  bookingUrl: string;
  restSeats: number | null;
  totalSeats: number | null;
  seats: number;
  zone: HoldZone;
  step: HoldStep;
  holdStartedAt: string | null;
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
  hold: HoldPrefs;
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
  if (source === "last-known") return "마지막 확인";
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
  if (input.cachedOnly && input.hasSeats) return "last-known";
  if (input.seatSource && input.seatSource !== "none" && input.seatSource !== "last-known") {
    return input.seatSource;
  }
  if (!input.hasSeats) return "none";
  if (input.theaterId.startsWith("cgv")) return "cgv-relay";
  if (input.source === "gas-cache") return "gas-cache";
  return "official";
}

export const TIMETABLE_HELP = [
  {
    step: "1",
    title: "극장 공홈",
    body: "메가박스 공식 시간표입니다. CGV 공홈은 이 서버에서 막혀 있어 건너뚱니다.",
  },
  {
    step: "2",
    title: "네이버",
    body: "공홈이 막히거나 비면 네이버 플레이스 시간표로 넘어갑니다. CGV 용산·영등포는 여기서 시작합니다. 영등포는 이 단계까지입니다.",
  },
  {
    step: "3",
    title: "용아맥 채널",
    body: "용산만, 24시간 감시 안전망입니다. 네이버가 비면 용산 스캐너 채널을 봅니다. 영등포는 이 단계가 없습니다.",
  },
];

export const SEAT_HELP = [
  {
    step: "1",
    title: "극장 공홈",
    body: "메가박스는 공식 좌석 숫자를 붙입니다. CGV 공홈 좌석은 이 서버에서 막혀 건너뚱니다.",
  },
  {
    step: "2",
    title: "CGV 우회조회",
    body: "용산·영등포 잔여석은 우회조회로 붙입니다. 구글스크립트는 없어도 됩니다.",
  },
  {
    step: "3",
    title: "장애 알림",
    body: "우회조회가 15분 넘게 비면 설정에 경고를 띠우고, 메일이 켜져 있으면 알려 줍니다. 시간표는 네이버로 유지됩니다.",
  },
  {
    step: "4",
    title: "마지막 확인",
    body: "공홈·우회·구글스크립트가 모두 실패하면, 마지막으로 성공한 숫자를 ‘N분 전 확인’으로 보여 줍니다. 이번 조회에서 받은 숫자는 ‘실시간’입니다.",
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
