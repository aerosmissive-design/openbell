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

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSO`;
