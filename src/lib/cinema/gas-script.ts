import { DEFAULT_FORMATS, THEATERS } from "./theaters";
import type { BookingIntent, WatchConfig } from "./types";
import { DEFAULT_HOLD, DEFAULT_SCAN_SOURCES, normalizeScanSources } from "./types";
import { GAS_SCRIPT_BODY } from "./gas-script-body";

export const GAS_SOURCE_STAMP = "20260921-wake";

export function buildGasManifest(): string {
  return JSON.stringify({
    timeZone: "Asia/Seoul",
    runtimeVersion: "V8",
    exceptionLogging: "STACKDRIVER",
    webapp: {
      executeAs: "USER_DEPLOYING",
      access: "ANYONE_ANONYMOUS",
    },
    executionApi: {
      access: "ANYONE",
    },
    oauthScopes: [
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/script.scriptapp",
      "https://www.googleapis.com/auth/script.external_request",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/script.projects",
      "https://www.googleapis.com/auth/script.deployments",
    ],
  });
}

export function buildGasScript(config: WatchConfig, queue: BookingIntent[] = []): string {
  const theaters = THEATERS.filter((t) => config.theaters[t.id]).map((t) => t.id);
  const formats = config.formats;
  const ranks = config.ranks;
  const extraTitles = config.watchTitles ?? [];
  const email = config.email || "YOU@gmail.com";
  const telegramToken = config.telegramToken;
  const telegramChatId = config.telegramChatId;
  const webhookUrl = config.webhookUrl;
  const kakaoRestKey = config.kakaoRestKey || "";
  const kakaoRefreshToken = config.kakaoRefreshToken || "";
  const xApiKey = config.xApiKey || "";
  const xApiSecret = config.xApiSecret || "";
  const xAccessToken = config.xAccessToken || "";
  const xAccessSecret = config.xAccessSecret || "";
  const xClientId = config.xClientId || "";
  const xClientSecret = config.xClientSecret || "";
  const xRefreshToken = config.xRefreshToken || "";
  const minutes = config.intervalMin <= 1 ? 1 : config.intervalMin <= 5 ? 5 : 10;
  const theaterNames =
    THEATERS.filter((t) => config.theaters[t.id])
      .map((t) => t.shortName)
      .join(", ") || "없음";
  const extraLabel = extraTitles.length ? extraTitles.join(", ") : "없음";
  const teleLabel = telegramChatId ? "켜짐" : "끔";
  const kakaoLabel = kakaoRefreshToken ? "켜짐" : "끔";
  const liveOrigin =
    typeof window !== "undefined" ? window.location.origin.replace(/\/$/, "") : "";
  const appUrl =
    liveOrigin.startsWith("https://") && !/localhost|127\.0\.0\.1/.test(liveOrigin)
      ? liveOrigin
      : "https://openbell-fawn.vercel.app";
  const body = GAS_SCRIPT_BODY.replace(/__MINUTES__/g, String(minutes));
  return `/******/\n * 오픈벨\n *\n * 주기: ${minutes}분마다\n * 며칠: ${config.daysAhead}일 뒤까지\n * 극장: ${theaterNames}\n * 순위: ${ranks.join(", ") || "없음"}\n * 추가 영화: ${extraLabel}\n * 메일: ${email}\n * 텔레그램: ${teleLabel}\n * 카카오: ${kakaoLabel}\n * X: ${xAccessToken ? "켜짐" : "끔"}\n *\n * 처음: 전부 지우고 붙여넣기 → 저장 → 위쪽 함수 설치 실행\n * 그다음: 오픈벨 설정만 바꾸면 이 스크립트에 반영됩니다.\n */\nconst SCRIPT_STAMP = ${JSON.stringify(GAS_SOURCE_STAMP)};\nconst CONFIG = {\n  email: ${JSON.stringify(email)},\n  ranks: ${JSON.stringify(ranks)},\n  extraTitles: ${JSON.stringify(extraTitles)},\n  theaters: ${JSON.stringify(theaters)},\n  formats: ${JSON.stringify(formats)},\n  daysAhead: ${JSON.stringify(config.daysAhead)},\n  intervalMin: ${minutes},\n  telegramToken: ${JSON.stringify(telegramToken)},\n  telegramChatId: ${JSON.stringify(telegramChatId)},\n  webhookUrl: ${JSON.stringify(webhookUrl)},\n  kakaoRestKey: ${JSON.stringify(kakaoRestKey)},\n  kakaoRefreshToken: ${JSON.stringify(kakaoRefreshToken)},\n  xApiKey: ${JSON.stringify(xApiKey)},\n  xApiSecret: ${JSON.stringify(xApiSecret)},\n  xAccessToken: ${JSON.stringify(xAccessToken)},\n  xAccessSecret: ${JSON.stringify(xAccessSecret)},\n  xClientId: ${JSON.stringify(xClientId)},\n  xClientSecret: ${JSON.stringify(xClientSecret)},\n  xRefreshToken: ${JSON.stringify(xRefreshToken)},\n  appUrl: ${JSON.stringify(appUrl)},\n  scanSources: ${JSON.stringify(normalizeScanSources(config.scanSources))},\n  syncKey: ${JSON.stringify(config.gasSyncKey || "")},\n  queued: ${JSON.stringify(\n    queue.slice(0, 20).map((q) => ({\n      id: q.showtimeId,\n      title: q.movieTitle,\n      url: q.bookingUrl,\n    })),\n  )},\n};\n\nconst GAS_MANIFEST = ${buildGasManifest()};\n` + body;
}

export const DEFAULT_WATCH: WatchConfig = {
  ranks: [],
  watchTitles: [],
  movieTab: "chart",
  theaters: {
    megabox_coex: true,
    megabox_namyangju: true,
    cgv_yongsan: true,
    cgv_yeongdeungpo: true,
  },
  formats: DEFAULT_FORMATS,
  intervalMin: 5,
  daysAhead: 15,
  browserNotify: true,
  telegramToken: "",
  telegramChatId: "",
  webhookUrl: "",
  email: "",
  emailNotify: false,
  gmailAppPassword: "",
  kakaoRestKey: "",
  kakaoRefreshToken: "",
  xApiKey: "",
  xApiSecret: "",
  xAccessToken: "",
  xAccessSecret: "",
  xClientId: "",
  xClientSecret: "",
  xRefreshToken: "",
  gasWebUrl: "",
  gasSyncKey: "",
  gasScriptId: "",
  gasSourceStamp: "",
  scanSources: { ...DEFAULT_SCAN_SOURCES },
  theme: "dark",
  hold: { ...DEFAULT_HOLD },
};
