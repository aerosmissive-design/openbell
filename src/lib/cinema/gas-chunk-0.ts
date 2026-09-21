export const C0 = `function applyLiveConfig_() {
  try {
    var props = PropertiesService.getScriptProperties();
    var raw = props.getProperty("liveConfig");
    if (!raw) return;
    var extra = JSON.parse(raw);
    var secrets = {
      email: 1,
      telegramToken: 1,
      telegramChatId: 1,
      webhookUrl: 1,
      kakaoRestKey: 1,
      kakaoRefreshToken: 1,
      xApiKey: 1,
      xApiSecret: 1,
      xAccessToken: 1,
      xAccessSecret: 1,
      xClientId: 1,
      xClientSecret: 1,
      xRefreshToken: 1,
    };
    ["email","ranks","extraTitles","theaters","formats","daysAhead","intervalMin","telegramToken","telegramChatId","webhookUrl","kakaoRestKey","kakaoRefreshToken","xApiKey","xApiSecret","xAccessToken","xAccessSecret","xClientId","xClientSecret","xRefreshToken","scanSources","queued","syncKey"].forEach(function (k) {
      if (extra[k] === undefined || extra[k] === null) return;
      if (secrets[k] && !String(extra[k]).trim()) return;
      CONFIG[k] = extra[k];
    });
  } catch (e) {}
}

function scanDays_() {
  var n = Number(CONFIG.daysAhead || 7);
  if (!(n >= 1)) n = 7;
  if (n > 30) n = 30;
  return n;
}

function triggerMinutes_() {
  var n = Number(CONFIG.intervalMin || 5);
  if (n <= 1) return 1;
  if (n <= 5) return 5;
  return 10;
}

function ensureTrigger_() {
  var want = triggerMinutes_();
  var props = PropertiesService.getScriptProperties();
  var have = String(props.getProperty("trigMin") || "");
  var triggers = ScriptApp.getProjectTriggers();
  var found = 0;
  triggers.forEach(function (t) {
    if (t.getHandlerFunction() === "checkOpenSeats") found += 1;
  });
  if (have === String(want) && found === 1) return;
  triggers.forEach(function (t) {
    ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("checkOpenSeats").timeBased().everyMinutes(want).create();
  props.setProperty("trigMin", String(want));
}

function markGasRun_() {
  try {
    PropertiesService.getScriptProperties().setProperty("lastGasRun", String(Date.now()));
  } catch (e) {}
}

function checkOpenSeats() {
  applyLiveConfig_();
  markGasRun_();
  ensureTrigger_();
  try { wakeVercelTick_(); } catch (e0) {}
  const report = scan_(false);
  if (report.alerts && report.alerts.length) {
    const body = report.alerts.map(function (a) {
      return "· " + a.title + "\n  " + a.theater + " / " + a.hall + "\n  " + a.date + " " + a.time + "\n  바로예매 " + a.url;
    }).join("\n\n");
    notify_("오픈벨 알림", body, report.alerts);
  }
  return report;
}

function wakeVercelTick_() {
  try {
    var base = String(CONFIG.appUrl || "https://openbell-fawn.vercel.app").replace(/\/$/, "");
    if (!/^https:\/\//.test(base)) base = "https://openbell-fawn.vercel.app";
    UrlFetchApp.fetch(base + "/api/watch-tick?src=gas", {
      method: "get",
      muteHttpExceptions: true,
      followRedirects: true,
    });
  } catch (e) {
    Logger.log("wakeVercel " + String(e));
  }
}
`;
