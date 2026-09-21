import { DEFAULT_FORMATS, THEATERS } from "./theaters";
import type { BookingIntent, WatchConfig } from "./types";
import { DEFAULT_HOLD, DEFAULT_SCAN_SOURCES, normalizeScanSources } from "./types";

export const GAS_SOURCE_STAMP = "20260921-gds2";

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
    typeof window !== "undefined" ? window.location.origin : "";
  const appUrl =
    liveOrigin.startsWith("https://") && !/localhost|127\.0\.0\.1/.test(liveOrigin)
      ? liveOrigin
      : "https://openbell-fawn.vercel.app";
  return `/**\n * 오픈벨\n */\nconst SCRIPT_STAMP = ${JSON.stringify(GAS_SOURCE_STAMP)};\n`;
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
