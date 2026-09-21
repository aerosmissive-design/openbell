import { DEFAULT_FORMATS, THEATERS } from "./theaters";
import type { BookingIntent, WatchConfig } from "./types";
import { DEFAULT_HOLD, DEFAULT_SCAN_SOURCES, normalizeScanSources } from "./types";

export const GAS_SOURCE_STAMP = "20260921-wake";

export function buildGasManifest(): string {
  return JSON.stringify({
    timeZone: "Asia/Seoul",
    runtimeVersion: "V8",
    exceptionLogging: "STACKDRIVER",
    webapp: { executeAs: "USER_DEPLOYING", access: "ANYONE_ANONYMOUS" },
    executionApi: { access: "ANYONE" },
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

/** Temporary thin template. Full scan template restore pending. Existing GAS installs keep working until re-copy. */
export function buildGasScript(config: WatchConfig, queue: BookingIntent[] = []): string {
  const minutes = config.intervalMin <= 1 ? 1 : config.intervalMin <= 5 ? 5 : 10;
  const email = config.email || "YOU@gmail.com";
  const appUrl =
    typeof window !== "undefined" && window.location.origin.startsWith("https://")
      ? window.location.origin.replace(/\/$/, "")
      : "https://openbell-fawn.vercel.app";
  return `/******/\n * OpenBell GAS (temp 3.9.81) — full template restore soon\n * interval: ${minutes}m · mail: ${email}\n * checkOpenSeats wakes Vercel watch-tick\n */\nconst SCRIPT_STAMP = ${JSON.stringify(GAS_SOURCE_STAMP)};\nconst CONFIG = {\n  email: ${JSON.stringify(email)},\n  ranks: ${JSON.stringify(config.ranks)},\n  extraTitles: ${JSON.stringify(config.watchTitles ?? [])},\n  theaters: ${JSON.stringify(THEATERS.filter((t) => config.theaters[t.id]).map((t) => t.id))},\n  formats: ${JSON.stringify(config.formats)},\n  daysAhead: ${JSON.stringify(config.daysAhead)},\n  intervalMin: ${minutes},\n  telegramToken: ${JSON.stringify(config.telegramToken)},\n  telegramChatId: ${JSON.stringify(config.telegramChatId)},\n  webhookUrl: ${JSON.stringify(config.webhookUrl)},\n  kakaoRestKey: ${JSON.stringify(config.kakaoRestKey || "")},\n  kakaoRefreshToken: ${JSON.stringify(config.kakaoRefreshToken || "")},\n  appUrl: ${JSON.stringify(appUrl)},\n  scanSources: ${JSON.stringify(normalizeScanSources(config.scanSources))},\n  syncKey: ${JSON.stringify(config.gasSyncKey || "")},\n};\n\nfunction applyLiveConfig_() {\n  try {\n    var props = PropertiesService.getScriptProperties();\n    var raw = props.getProperty("liveConfig");\n    if (!raw) return;\n    var extra = JSON.parse(raw);\n    ["email","ranks","extraTitles","theaters","formats","daysAhead","intervalMin","telegramToken","telegramChatId","webhookUrl","kakaoRestKey","kakaoRefreshToken","scanSources","syncKey"].forEach(function (k) {\n      if (extra[k] !== undefined && extra[k] !== null) CONFIG[k] = extra[k];\n    });\n  } catch (e) {}\n}\n\nfunction triggerMinutes_() {\n  var n = Number(CONFIG.intervalMin || 5);\n  if (n <= 1) return 1;\n  if (n <= 5) return 5;\n  return 10;\n}\n\nfunction ensureTrigger_() {\n  var want = triggerMinutes_();\n  var props = PropertiesService.getScriptProperties();\n  var have = String(props.getProperty("trigMin") || "");\n  var triggers = ScriptApp.getProjectTriggers();\n  var found = 0;\n  triggers.forEach(function (t) { if (t.getHandlerFunction() === "checkOpenSeats") found += 1; });\n  if (have === String(want) && found === 1) return;\n  triggers.forEach(function (t) { ScriptApp.deleteTrigger(t); });\n  ScriptApp.newTrigger("checkOpenSeats").timeBased().everyMinutes(want).create();\n  props.setProperty("trigMin", String(want));\n}\n\nfunction markGasRun_() {\n  PropertiesService.getScriptProperties().setProperty("gasLastRun", String(Date.now()));\n}\n\nfunction wakeVercelTick_() {\n  try {\n    var base = String(CONFIG.appUrl || "https://openbell-fawn.vercel.app").replace(/\\/$/, "");\n    if (!/^https:\\/\\//.test(base)) base = "https://openbell-fawn.vercel.app";\n    UrlFetchApp.fetch(base + "/api/watch-tick?src=gas", { method: "get", muteHttpExceptions: true, followRedirects: true });\n  } catch (e) { Logger.log("wakeVercel " + String(e)); }\n}\n\nfunction notify_(subject, body) {\n  if (CONFIG.email) {\n    try { GmailApp.sendEmail(CONFIG.email, subject, body, { name: "OpenBell" }); } catch (e) { Logger.log(String(e)); }\n  }\n  if (CONFIG.telegramToken && CONFIG.telegramChatId) {\n    try {\n      UrlFetchApp.fetch("https://api.telegram.org/bot" + CONFIG.telegramToken + "/sendMessage", {\n        method: "post",\n        contentType: "application/json",\n        payload: JSON.stringify({ chat_id: CONFIG.telegramChatId, text: subject + "\\n\\n" + body }),\n        muteHttpExceptions: true,\n      });\n    } catch (e) { Logger.log(String(e)); }\n  }\n}\n\nfunction setupInstall() {\n  applyLiveConfig_();\n  markGasRun_();\n  ensureTrigger_();\n  try { wakeVercelTick_(); } catch (e) {}\n  notify_("[OpenBell] install ok", "every " + triggerMinutes_() + " min. (temp thin script)");\n}\n\nfunction checkOpenSeats() {\n  applyLiveConfig_();\n  markGasRun_();\n  ensureTrigger_();\n  try { wakeVercelTick_(); } catch (e) {}\n  Logger.log("checkOpenSeats tick · stamp " + SCRIPT_STAMP);\n}\n\nfunction doGet(e) {\n  var op = (e && e.parameter && e.parameter.op) || "status";\n  if (op === "status") {\n    var last = Number(PropertiesService.getScriptProperties().getProperty("gasLastRun") || 0);\n    return ContentService.createTextOutput(JSON.stringify({\n      ok: true, gasAlive: last > 0, gasLastRun: last, stamp: SCRIPT_STAMP\n    })).setMimeType(ContentService.MimeType.JSON);\n  }\n  return ContentService.createTextOutput(JSON.stringify({ ok: true, stamp: SCRIPT_STAMP }))\n    .setMimeType(ContentService.MimeType.JSON);\n}\n\nfunction setup() { setupInstall(); }\nfunction 설치() { setupInstall(); }\n`;
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
