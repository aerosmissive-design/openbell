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
  return `/**\n * 오픈벨\n *\n * 주기: ${minutes}분마다\n * 몇칠: ${config.daysAhead}일 뒤까지\n * 극장: ${theaterNames}\n * 순위: ${ranks.join(", ") || "없음"}\n * 추가 영화: ${extraLabel}\n * 메일: ${email}\n * 텔레그램: ${teleLabel}\n * 카카오: ${kakaoLabel}\n * X: ${xAccessToken ? "켜짐" : "끔"}\n *\n * 처음: 전부 지우고 붙여넣기 → 저장 → 위쪽 함수 설치 실행\n * 저장만 하면 웹앱은 예전 코드라 화면에 openbell 만 나옵니다.\n */\nconst SCRIPT_STAMP = ${JSON.stringify(GAS_SOURCE_STAMP)};\nconst CONFIG = {\n  email: ${JSON.stringify(email)},\n  ranks: ${JSON.stringify(ranks)},\n  extraTitles: ${JSON.stringify(extraTitles)},\n  theaters: ${JSON.stringify(theaters)},\n  formats: ${JSON.stringify(formats)},\n  daysAhead: ${JSON.stringify(config.daysAhead)},\n  intervalMin: ${minutes},\n  telegramToken: ${JSON.stringify(telegramToken)},\n  telegramChatId: ${JSON.stringify(telegramChatId)},\n  webhookUrl: ${JSON.stringify(webhookUrl)},\n  kakaoRestKey: ${JSON.stringify(kakaoRestKey)},\n  kakaoRefreshToken: ${JSON.stringify(kakaoRefreshToken)},\n  xApiKey: ${JSON.stringify(xApiKey)},\n  xApiSecret: ${JSON.stringify(xApiSecret)},\n  xAccessToken: ${JSON.stringify(xAccessToken)},\n  xAccessSecret: ${JSON.stringify(xAccessSecret)},\n  xClientId: ${JSON.stringify(xClientId)},\n  xClientSecret: ${JSON.stringify(xClientSecret)},\n  xRefreshToken: ${JSON.stringify(xRefreshToken)},\n  appUrl: ${JSON.stringify(appUrl)},\n  scanSources: ${JSON.stringify(normalizeScanSources(config.scanSources))},\n  syncKey: ${JSON.stringify(config.gasSyncKey || "")},\n  queued: ${JSON.stringify(\n    queue.slice(0, 20).map((q) => ({\n      id: q.showtimeId,\n      title: q.movieTitle,\n      url: q.bookingUrl,\n    })),\n  )},\n};\n\nconst GAS_MANIFEST = ${buildGasManifest()};\n\nfunction applyLiveConfig_() {\n  try {\n    var props = PropertiesService.getScriptProperties();\n    var raw = props.getProperty("liveConfig");\n    if (!raw) return;\n    var extra = JSON.parse(raw);\n    var secrets = { email: 1, telegramToken: 1, telegramChatId: 1, webhookUrl: 1, kakaoRestKey: 1, kakaoRefreshToken: 1, xApiKey: 1, xApiSecret: 1, xAccessToken: 1, xAccessSecret: 1, xClientId: 1, xClientSecret: 1, xRefreshToken: 1 };\n    ["email","ranks","extraTitles","theaters","formats","daysAhead","intervalMin","telegramToken","telegramChatId","webhookUrl","kakaoRestKey","kakaoRefreshToken","xApiKey","xApiSecret","xAccessToken","xAccessSecret","xClientId","xClientSecret","xRefreshToken","scanSources","queued","syncKey"].forEach(function (k) {\n      if (extra[k] === undefined || extra[k] === null) return;\n      if (secrets[k] && !String(extra[k]).trim()) return;\n      CONFIG[k] = extra[k];\n    });\n  } catch (e) {}\n}\n\nfunction scanDays_() {\n  var n = Number(CONFIG.daysAhead || 7);\n  if (!(n >= 1)) n = 7;\n  if (n > 30) n = 30;\n  return n;\n}\n\nfunction triggerMinutes_() {\n  var n = Number(CONFIG.intervalMin || 5);\n  if (n <= 1) return 1;\n  if (n <= 5) return 5;\n  return 10;\n}\n\nfunction ensureTrigger_() {\n  var want = triggerMinutes_();\n  var props = PropertiesService.getScriptProperties();\n  var have = String(props.getProperty("trigMin") || "");\n  var triggers = ScriptApp.getProjectTriggers();\n  var found = 0;\n  triggers.forEach(function (t) {\n    if (t.getHandlerFunction() === "checkOpenSeats") found += 1;\n  });\n  if (have === String(want) && found === 1) return;\n  triggers.forEach(function (t) { ScriptApp.deleteTrigger(t); });\n  ScriptApp.newTrigger("checkOpenSeats").timeBased().everyMinutes(want).create();\n  props.setProperty("trigMin", String(want));\n}\n\nfunction jsonOut_(obj) {\n  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);\n}\n\nfunction jsonpOut_(obj, cb) {\n  var name = String(cb || "");\n  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {\n    return ContentService.createTextOutput(name + "(" + JSON.stringify(obj) + ")").setMimeType(ContentService.MimeType.JAVASCRIPT);\n  }\n  return jsonOut_(obj);\n}\n\nfunction markGasRun_() {\n  PropertiesService.getScriptProperties().setProperty("gasLastRun", String(Date.now()));\n}\n\nfunction seatSourceBoardLabel_(source) {\n  var s = String(source || "").trim().toLowerCase();\n  if (s === "nas423" || s === "g-ds423+" || s === "g-nas423+" || s === "g_ds423+" || s === "ds423" || s === "ds423+") return "G_DS423+";\n  if (s === "nas225" || s === "g-ds225+" || s === "g-nas225+" || s === "g_ds225+" || s === "ds225" || s === "ds225+") return "G_DS225+";\n  if (s === "pc" || s === "g-pc" || s === "nas-report") return "G_PC";\n  return source || "scrape";\n}\n\nfunction reporterChunkSize_() { return 7000; }\n\nfunction 설치() { applyLiveConfig_(); markGasRun_(); ensureTrigger_(); }\nfunction checkOpenSeats() { applyLiveConfig_(); markGasRun_(); ensureTrigger_(); }\nfunction doGet(e) { applyLiveConfig_(); return ContentService.createTextOutput("openbell"); }\nfunction doPost(e) { return doGet(e); }\nfunction setup() { 설치(); }\n`;
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
