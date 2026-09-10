import { DEFAULT_FORMATS, THEATERS } from "./theaters";
import type { BookingIntent, WatchConfig } from "./types";
import { DEFAULT_SCAN_SOURCES, normalizeScanSources } from "./types";

export const GAS_SOURCE_STAMP = "20260910-esc";

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
      : "https://openbell.grok.me";
  return `/**
 * 오픈벨
 *
 * 주기: ${minutes}분마다
 * 며칠: ${config.daysAhead}일 뒤까지
 * 극장: ${theaterNames}
 * 순위: ${ranks.join(", ") || "없음"}
 * 추가 영화: ${extraLabel}
 * 메일: ${email}
 * 텔레그램: ${teleLabel}
 * 카카오: ${kakaoLabel}
 * X: ${xAccessToken ? "켜짐" : "끔"}
 *
 * 처음: 전부 지우고 붙여넣기 → 저장 → 위쪽 함수 설치 실행
 * 그다음: 오픈벨 설정만 바꾸면 이 스크립트에 반영됩니다.
 */
const SCRIPT_STAMP = ${JSON.stringify(GAS_SOURCE_STAMP)};
const CONFIG = {
  email: ${JSON.stringify(email)},
  ranks: ${JSON.stringify(ranks)},
  extraTitles: ${JSON.stringify(extraTitles)},
  theaters: ${JSON.stringify(theaters)},
  formats: ${JSON.stringify(formats)},
  daysAhead: ${JSON.stringify(config.daysAhead)},
  intervalMin: ${minutes},
  telegramToken: ${JSON.stringify(telegramToken)},
  telegramChatId: ${JSON.stringify(telegramChatId)},
  webhookUrl: ${JSON.stringify(webhookUrl)},
  kakaoRestKey: ${JSON.stringify(kakaoRestKey)},
  kakaoRefreshToken: ${JSON.stringify(kakaoRefreshToken)},
  xApiKey: ${JSON.stringify(xApiKey)},
  xApiSecret: ${JSON.stringify(xApiSecret)},
  xAccessToken: ${JSON.stringify(xAccessToken)},
  xAccessSecret: ${JSON.stringify(xAccessSecret)},
  xClientId: ${JSON.stringify(xClientId)},
  xClientSecret: ${JSON.stringify(xClientSecret)},
  xRefreshToken: ${JSON.stringify(xRefreshToken)},
  appUrl: ${JSON.stringify(appUrl)},
  scanSources: ${JSON.stringify(normalizeScanSources(config.scanSources))},
  syncKey: ${JSON.stringify(config.gasSyncKey || "")},
  queued: ${JSON.stringify(
    queue.slice(0, 20).map((q) => ({
      id: q.showtimeId,
      title: q.movieTitle,
      url: q.bookingUrl,
    })),
  )},
};

const GAS_MANIFEST = ${buildGasManifest()};

function applyLiveConfig_() {
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
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonpOut_(obj, cb) {
  var name = String(cb || "");
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    return ContentService.createTextOutput(name + "(" + JSON.stringify(obj) + ")")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return jsonOut_(obj);
}

function markGasRun_() {
  PropertiesService.getScriptProperties().setProperty("gasLastRun", String(Date.now()));
}

function bindUrlToApp_() {
  if (!CONFIG.syncKey) return;
  var web = "";
  try { web = ScriptApp.getService().getUrl() || ""; } catch (e) {}
  if (!web) web = ensureWebApp_() || "";
  var email = "";
  try { email = Session.getActiveUser().getEmail() || ""; } catch (e2) {}
  if (!email) email = CONFIG.email || "";
  var payload = JSON.stringify({
    key: CONFIG.syncKey,
    url: web || "",
    id: ScriptApp.getScriptId(),
    email: email,
  });
  var bases = [];
  if (CONFIG.appUrl) bases.push(String(CONFIG.appUrl).replace(/\\/$/, ""));
  bases.push("https://openbell.grok.me");
  var seen = {};
  bases.forEach(function (base) {
    if (!base || seen[base]) return;
    seen[base] = 1;
    try {
      UrlFetchApp.fetch(base + "/api/gas-bind", {
        method: "post",
        contentType: "application/json",
        payload: payload,
        muteHttpExceptions: true,
      });
    } catch (e) {}
  });
}

function scriptApiHeaders_() {
  return { Authorization: "Bearer " + ScriptApp.getOAuthToken() };
}

var WEBAPP_ERR_ = "";

function apiErr_(res, fallback) {
  var text = "";
  try { text = res.getContentText(); } catch (e) {}
  var json = {};
  try { json = JSON.parse(text); } catch (e2) {}
  var msg = (json.error && json.error.message) || text || fallback;
  return String(msg).replace(/\\s+/g, " ").slice(0, 180);
}

function writeManifest_() {
  var id = ScriptApp.getScriptId();
  var headers = scriptApiHeaders_();
  var current = UrlFetchApp.fetch("https://script.googleapis.com/v1/projects/" + id + "/content", {
    headers: headers,
    muteHttpExceptions: true
  });
  if (current.getResponseCode() >= 300) {
    WEBAPP_ERR_ = apiErr_(current, "코드를 읽지 못했습니다. script.google.com/home/usersettings 에서 Apps Script API를 켜 주세요.");
    return false;
  }
  var files = [];
  try { files = JSON.parse(current.getContentText()).files || []; } catch (e) {}
  var code = "";
  files.forEach(function (f) {
    if (f && (f.name === "Code" || f.name === "코드") && f.source) code = f.source;
  });
  if (!code) {
    WEBAPP_ERR_ = "Code.gs를 찾지 못했습니다.";
    return false;
  }
  var put = UrlFetchApp.fetch("https://script.googleapis.com/v1/projects/" + id + "/content", {
    method: "put",
    contentType: "application/json",
    headers: headers,
    payload: JSON.stringify({
      files: [
        { name: "appsscript", type: "JSON", source: JSON.stringify(GAS_MANIFEST) },
        { name: "Code", type: "SERVER_JS", source: code }
      ]
    }),
    muteHttpExceptions: true
  });
  if (put.getResponseCode() >= 300) {
    WEBAPP_ERR_ = apiErr_(put, "웹앱 설정을 쓰지 못했습니다.");
    return false;
  }
  return true;
}

function ensureWebApp_() {
  WEBAPP_ERR_ = "";
  if (!writeManifest_()) return "";
  var id = ScriptApp.getScriptId();
  var headers = scriptApiHeaders_();
  var ver = UrlFetchApp.fetch("https://script.googleapis.com/v1/projects/" + id + "/versions", {
    method: "post",
    contentType: "application/json",
    headers: headers,
    payload: JSON.stringify({ description: "openbell" }),
    muteHttpExceptions: true
  });
  var verJson = {};
  try { verJson = JSON.parse(ver.getContentText()); } catch (err) {}
  var versionNumber = Number(verJson.versionNumber || 0);
  if (ver.getResponseCode() >= 300 || !versionNumber) {
    WEBAPP_ERR_ = apiErr_(ver, "버전을 만들지 못했습니다. Apps Script API를 켜 주세요.");
    return "";
  }
  var listed = UrlFetchApp.fetch("https://script.googleapis.com/v1/projects/" + id + "/deployments", {
    headers: headers,
    muteHttpExceptions: true
  });
  var listedJson = {};
  try { listedJson = JSON.parse(listed.getContentText()); } catch (err) {}
  if (listed.getResponseCode() >= 300) {
    WEBAPP_ERR_ = apiErr_(listed, "배포 목록을 읽지 못했습니다.");
    return "";
  }
  var deployments = listedJson.deployments || [];
  var web = null;
  for (var i = 0; i < deployments.length; i++) {
    var eps = deployments[i].entryPoints || [];
    for (var j = 0; j < eps.length; j++) {
      if (eps[j].webApp && eps[j].webApp.url) {
        web = deployments[i];
        break;
      }
    }
    if (web) break;
  }
  var url = "";
  if (web && web.deploymentId) {
    var patched = UrlFetchApp.fetch(
      "https://script.googleapis.com/v1/projects/" + id + "/deployments/" + web.deploymentId + "?updateMask=deploymentConfig",
      {
        method: "patch",
        contentType: "application/json",
        headers: headers,
        payload: JSON.stringify({
          deploymentConfig: {
            scriptId: id,
            versionNumber: versionNumber,
            manifestFileName: "appsscript",
            description: "openbell web"
          }
        }),
        muteHttpExceptions: true
      }
    );
    try {
      var patchedJson = JSON.parse(patched.getContentText());
      var eps2 = (patchedJson.entryPoints || []);
      for (var k = 0; k < eps2.length; k++) {
        if (eps2[k].webApp && eps2[k].webApp.url) url = eps2[k].webApp.url;
      }
    } catch (err2) {}
    if (patched.getResponseCode() >= 300 && !url) {
      WEBAPP_ERR_ = apiErr_(patched, "기존 배포를 고치지 못했습니다.");
    }
  } else {
    var created = UrlFetchApp.fetch("https://script.googleapis.com/v1/projects/" + id + "/deployments", {
      method: "post",
      contentType: "application/json",
      headers: headers,
      payload: JSON.stringify({
        versionNumber: versionNumber,
        manifestFileName: "appsscript",
        description: "openbell web"
      }),
      muteHttpExceptions: true
    });
    try {
      var createdJson = JSON.parse(created.getContentText());
      var eps3 = (createdJson.entryPoints || []);
      for (var m = 0; m < eps3.length; m++) {
        if (eps3[m].webApp && eps3[m].webApp.url) url = eps3[m].webApp.url;
      }
    } catch (err3) {}
    if (created.getResponseCode() >= 300 && !url) {
      WEBAPP_ERR_ = apiErr_(created, "웹앱 배포를 만들지 못했습니다.");
    }
  }
  if (!url) {
    try { url = ScriptApp.getService().getUrl() || ""; } catch (err4) {}
  }
  url = String(url || "").replace(/\\/dev$/, "/exec");
  if (!url && !WEBAPP_ERR_) WEBAPP_ERR_ = "웹앱 URL을 받지 못했습니다. 배포 → 새 배포에서 웹 앱을 만드세요.";
  return url;
}

function 설치() {
  applyLiveConfig_();
  markGasRun_();
  if (CONFIG.syncKey) {
    PropertiesService.getScriptProperties().setProperty("syncKey", CONFIG.syncKey);
  }
  var web = ensureWebApp_();
  ensureTrigger_();
  var report = { names: [], found: 0, error: "", cgvFound: 0, cgvErr: "" };
  try {
    report = scan_(true);
  } catch (e) {
    report.error = String(e);
  }
  const names = (report.names || []).join(", ") || "없음";
  var body = report.error
    ? "설치는 됐지만 시간표 조회가 실패했습니다. " + report.error
    : "지금부터 ${minutes}분마다 감시합니다.\\n알림 영화: " + names + "\\n이미 열린 상영 " + report.found + "건은 넘어갑니다.\\n용산 CGV " + (report.cgvFound || 0) + "건 확인" + (report.cgvFound ? "" : (report.cgvErr ? " (" + report.cgvErr + ")" : "")) + ".\\n앞으로 새 날짜·새 시간이 열리면 메일·텔레그램으로 알려드립니다.";
  if (web) body += "\\n웹앱: " + web;
  else if (WEBAPP_ERR_) body += "\\n웹앱 배포 실패: " + WEBAPP_ERR_ + " script.google.com/home/usersettings 에서 Apps Script API를 켠 뒤 설치를 다시 실행하세요.";
  notify_("[오픈벨] 설치 완료", body, [{
    title: "오픈벨",
    theater: "설치 완료",
    hall: "",
    date: "",
    time: "",
    url: web || CONFIG.appUrl || "https://www.megabox.co.kr/booking",
  }]);
  bindUrlToApp_();
}

function checkOpenSeats() {
  applyLiveConfig_();
  markGasRun_();
  ensureTrigger_();
  const report = scan_(false);
  if (report.alerts && report.alerts.length) {
    const body = report.alerts.map(function (a) {
      return "· " + a.title + "\\n  " + a.theater + " / " + a.hall + "\\n  " + a.date + " " + a.time + "\\n  바로예매 " + a.url;
    }).join("\\n\\n");
    notify_("[오픈벨] 예매 오픈 " + report.alerts.length + "건", body, report.alerts);
  }
  if (report.seatAlerts && report.seatAlerts.length) {
    const body = report.seatAlerts.map(function (a) {
      return "· " + a.title + "\\n  " + a.theater + " / " + a.hall + "\\n  " + a.date + " " + a.time + "\\n  잔여 " + a.restSeats + " (+" + a.delta + ")\\n  바로예매 " + a.url;
    }).join("\\n\\n");
    notify_("[오픈벨] 좌석 늘음 " + report.seatAlerts.length + "건 — 지금 예매하세요", body, report.seatAlerts);
  }
}

function grokWaitMs_() {
  return Math.max(triggerMinutes_() * 3, 15) * 60 * 1000;
}

function grokBeatAt_() {
  return Number(PropertiesService.getScriptProperties().getProperty("grokBeat") || 0);
}

function grokTickAt_() {
  return Number(PropertiesService.getScriptProperties().getProperty("grokTickBeat") || 0);
}

function grokIsMain_() {
  var at = grokBeatAt_();
  if (!at) return false;
  return Date.now() - at < grokWaitMs_();
}

function grokStatus_() {
  var beat = grokBeatAt_();
  var tick = grokTickAt_();
  var wait = grokWaitMs_();
  var now = Date.now();
  var last = Number(PropertiesService.getScriptProperties().getProperty("gasLastRun") || 0);
  var interval = triggerMinutes_();
  var gasWait = Math.max(interval * 3, 15) * 60 * 1000;
  return {
    ok: true,
    beat: beat,
    tick: tick,
    waitMs: wait,
    remainMs: beat ? Math.max(0, wait - (now - beat)) : 0,
    grokMain: grokIsMain_(),
    intervalMin: interval,
    gasLastRun: last,
    gasAgeMs: last ? now - last : 0,
    gasAlive: last > 0 && now - last < gasWait,
    lastNotify: (function () {
      try {
        return JSON.parse(PropertiesService.getScriptProperties().getProperty("lastNotify") || "null");
      } catch (e) {
        return null;
      }
    })()
  };
}

function scan_(primeOnly) {
  const props = PropertiesService.getScriptProperties();
  const seen = JSON.parse(props.getProperty("seen") || "{}");
  const primed = props.getProperty("primed") === "1";
  const watchHash = JSON.stringify({
    ranks: CONFIG.ranks,
    extra: CONFIG.extraTitles || [],
    theaters: CONFIG.theaters,
    formats: CONFIG.formats,
    daysAhead: CONFIG.daysAhead,
  });
  if (props.getProperty("watchHash") !== watchHash) primeOnly = true;
  const ranking = fetchRanking_();
  const names = [];
  const watchedTitles = [];
  ranking.forEach(function (m) {
    if (CONFIG.ranks.indexOf(m.rank) < 0) return;
    names.push(m.title);
    watchedTitles.push(normalize_(m.title));
  });
  (CONFIG.extraTitles || []).forEach(function (t) {
    names.push(t);
    watchedTitles.push(normalize_(t));
  });
  const alerts = [];
  const seatAlerts = [];
  var found = 0;
  var cgvFound = 0;
  const byId = {};
  const qseats = JSON.parse(props.getProperty("qseats") || "{}");
  var live = [];
  try { live = fetchLiveTimetable_(scanDays_(), ""); } catch (e) {}
  var have = {};
  live.forEach(function (row) {
    if (row && row.theaterId) have[row.theaterId] = true;
  });
  CONFIG.theaters.forEach(function (theaterId) {
    if (have[theaterId]) return;
    kstDates_(scanDays_()).forEach(function (playDate) {
      const rows = String(theaterId).indexOf("cgv_") === 0
        ? fetchCgv_(theaterId, playDate)
        : fetchMegabox_(theaterId, playDate);
      rows.forEach(function (row) {
        live.push({
          id: row.id,
          theaterId: theaterId,
          theater: row.theater,
          title: row.title,
          date: row.date,
          time: row.time,
          hall: row.hall,
          formats: row.formats,
          restSeats: row.restSeats,
          totalSeats: row.totalSeats,
          url: row.url,
        });
      });
    });
  });
  live.forEach(function (row) {
    if (!row || !row.id) return;
    byId[row.id] = row;
    if (row.theaterId && String(row.theaterId).indexOf("cgv_") === 0) cgvFound += 1;
    if (watchedTitles.length && !titleWatched_(row.title, watchedTitles)) return;
    const allowed = CONFIG.formats[row.theaterId] || [];
    if (!allowed.length || !(row.formats || []).some(function (f) { return allowed.indexOf(f) >= 0; })) return;
    found += 1;
    if (seen[row.id]) return;
    seen[row.id] = true;
    if (!primeOnly && primed) alerts.push(withRound_(row, live));
  });
  (CONFIG.queued || []).forEach(function (q) {
    const row = byId[q.id];
    if (!row || typeof row.restSeats !== "number") return;
    const last = qseats[q.id];
    if (!primeOnly && typeof last === "number" && row.restSeats > last) {
      seatAlerts.push(withRound_({
        title: (q.title || row.title) + " 좌석 +" + (row.restSeats - last),
        matchTitle: q.title || row.title,
        theater: row.theater,
        hall: row.hall,
        date: row.date,
        time: row.time,
        url: q.url || row.url,
        restSeats: row.restSeats,
        delta: row.restSeats - last,
      }, live));
    }
    qseats[q.id] = row.restSeats;
  });
  const extraSeats = refreshCgvSeatmap_(props);
  applyBatchSeats_(byId, extraSeats);
  const keys = Object.keys(seen);
  if (keys.length > 2500) {
    keys.slice(0, keys.length - 2000).forEach(function (k) { delete seen[k]; });
  }
  const seatmap = {};
  Object.keys(byId).forEach(function (id) {
    const row = byId[id];
    if (!row || typeof row.restSeats !== "number") return;
    const rec = { rest: row.restSeats, total: row.totalSeats == null ? null : row.totalSeats };
    const hallKey = String(row.hall || "").toUpperCase().replace(/[\\s|]+/g, "");
    const site = String(id).split(":")[1] || "";
    const prefix = String(id).indexOf("megabox:") === 0 ? "m:" : "k:";
    if (prefix === "k:" && site && row.date && row.time) {
      seatmap[id] = rec;
      seatmap[prefix + site + "|" + row.date + "|" + row.time + "|" + hallKey] = rec;
      seatmap[prefix + site + "|" + row.date + "|" + row.time] = rec;
    }
  });
  Object.keys(extraSeats).forEach(function (k) { seatmap[k] = extraSeats[k]; });
  if (Object.keys(seatmap).length) saveSeatmap_(props, seatmap);
  else {
    const prev = loadSeatmap_();
    Object.keys(prev).forEach(function (k) { seatmap[k] = prev[k]; });
  }
  props.setProperty("seen", JSON.stringify(seen));
  props.setProperty("primed", "1");
  props.setProperty("watchHash", watchHash);
  props.setProperty("qseats", JSON.stringify(qseats));
  const showcache = [];
  Object.keys(byId).forEach(function (id) {
    const row = byId[id];
    if (!row) return;
    showcache.push({
      id: id,
      theaterId: theaterIdFromId_(id),
      theater: row.theater,
      title: row.title,
      date: row.date,
      time: row.time,
      hall: row.hall,
      formats: row.formats,
      restSeats: row.restSeats,
      totalSeats: row.totalSeats,
      url: row.url,
    });
  });
  try {
    props.setProperty("showcache", JSON.stringify(showcache));
    props.setProperty("showcacheAt", String(Date.now()));
  } catch (e) {}
  return { alerts: alerts, seatAlerts: seatAlerts, found: found, cgvFound: cgvFound, cgvErr: CGV_ERR_, names: names, error: "" };
}

function testNotify() {
  applyLiveConfig_();
  const subject = "[오픈벨] 연결 테스트";
  const body = "감시가 연결되었습니다. 예매가 새로 열리면 바로예매 링크와 함께 옵니다.";
  notify_(subject, body, [{
    title: "오픈벨",
    theater: "연결 테스트",
    hall: "",
    date: "",
    time: "",
    url: CONFIG.appUrl || "https://www.megabox.co.kr/booking",
  }]);
}
function 테스트메일() { testNotify(); }

function doGet(e) {
  applyLiveConfig_();
  var p = (e && e.parameter) || {};
  var op = p.op;
  if (op === "ping") {
    if (p.callback || p.cb) return jsonpOut_(grokStatus_(), p.callback || p.cb);
    return ContentService.createTextOutput("ok");
  }
  if (op === "beat") {
    if (CONFIG.syncKey && String(p.key || "") !== String(CONFIG.syncKey)) {
      return jsonOut_({ ok: false });
    }
    var props = PropertiesService.getScriptProperties();
    var now = String(Date.now());
    props.setProperty("grokBeat", now);
    var src = String(p.src || "page");
    props.setProperty("grokBeatSrc", src);
    if (src === "tick") props.setProperty("grokTickBeat", now);
    return jsonOut_({ ok: true });
  }
  if (op === "status") {
    return jsonpOut_(grokStatus_(), p.callback || p.cb);
  }
  if (op === "install") {
    설치();
    return jsonOut_({ ok: true });
  }
  if (op === "bind") {
    bindUrlToApp_();
    return jsonOut_({ ok: true });
  }
  if (op === "meta") {
    var web = "";
    try { web = ScriptApp.getService().getUrl() || ""; } catch (err) {}
    return jsonOut_({ ok: true, url: web, id: ScriptApp.getScriptId(), stamp: SCRIPT_STAMP, email: CONFIG.email || "" });
  }
  if (op === "test") {
    testNotify();
    return ContentService.createTextOutput("ok");
  }
  if (op === "seat" || op === "mail") {
    notify_(p.subject || "[오픈벨] 좌석 늘음", p.body || "지금 예매하세요.", [{
      title: p.title || "오픈벨",
      theater: p.theater || "",
      hall: p.hall || "",
      date: p.date || "",
      time: p.time || "",
      url: p.url || CONFIG.appUrl || "https://m.megabox.co.kr/booking",
    }]);
    return ContentService.createTextOutput("ok");
  }
  if (op === "seatmap") {
    var props = PropertiesService.getScriptProperties();
    var map = {};
    if (p.fresh === "1" || p.fresh === "true") {
      map = refreshCgvSeatmap_(props);
      if (Object.keys(map).length) saveSeatmap_(props, map);
      else map = loadSeatmap_();
    } else {
      map = loadSeatmap_();
    }
    return ContentService.createTextOutput(JSON.stringify(map))
      .setMimeType(ContentService.MimeType.JSON);
  }
  if (op === "shows") {
    if (p.fresh === "1" || p.fresh === "true") {
      return ContentService.createTextOutput(JSON.stringify(refreshShowcache_(PropertiesService.getScriptProperties())))
        .setMimeType(ContentService.MimeType.JSON);
    }
    return ContentService.createTextOutput(JSON.stringify(loadShowcache_()))
      .setMimeType(ContentService.MimeType.JSON);
  }
  if (op === "mega" || op === "live") {
    var days = Math.min(Math.max(Number(p.days || 7), 1), 10);
    var theater = p.theater || p.theaterId || "";
    return jsonOut_(fetchLiveTimetable_(days, theater));
  }
  if (op === "pack") {
    return ContentService.createTextOutput(JSON.stringify({
      shows: loadShowcache_(),
      seats: loadSeatmap_(),
    })).setMimeType(ContentService.MimeType.JSON);
  }
  if (op === "sync") return handleSync_(e);
  if (op === "upgrade") return handleUpgrade_(e);
  if (op === "config") {
    applyLiveConfig_();
    return jsonOut_({
      ok: true,
      email: CONFIG.email || "",
      telegramToken: CONFIG.telegramToken || "",
      telegramChatId: CONFIG.telegramChatId || "",
      webhookUrl: CONFIG.webhookUrl || "",
      kakaoRestKey: CONFIG.kakaoRestKey || "",
      kakaoRefreshToken: CONFIG.kakaoRefreshToken || "",
      xApiKey: CONFIG.xApiKey || "",
      xApiSecret: CONFIG.xApiSecret || "",
      xAccessToken: CONFIG.xAccessToken || "",
      xAccessSecret: CONFIG.xAccessSecret || "",
      xClientId: CONFIG.xClientId || "",
      xClientSecret: CONFIG.xClientSecret || "",
      xRefreshToken: CONFIG.xRefreshToken || "",
    });
  }
  return ContentService.createTextOutput("openbell");
}

function doPost(e) {
  var p = (e && e.parameter) || {};
  if (p.op === "sync") return handleSync_(e);
  if (p.op === "upgrade") return handleUpgrade_(e);
  return doGet(e);
}

function handleSync_(e) {
  var p = (e && e.parameter) || {};
  var props = PropertiesService.getScriptProperties();
  var phase = String(p.phase || "");
  var incomingKey = String(p.key || "");
  var stored = props.getProperty("syncKey") || CONFIG.syncKey || "";
  if (phase === "start") {
    if (stored && incomingKey && stored !== incomingKey) return jsonOut_({ ok: false, error: "key" });
    if (incomingKey) props.setProperty("syncKey", incomingKey);
    props.setProperty("syncBuf", "");
    return jsonOut_({ ok: true, phase: "start" });
  }
  if (phase === "chunk") {
    props.setProperty("syncBuf", (props.getProperty("syncBuf") || "") + String(p.d || ""));
    return jsonOut_({ ok: true, phase: "chunk" });
  }
  var body = {};
  if (phase === "end") {
    try { body = JSON.parse(props.getProperty("syncBuf") || "{}"); } catch (err) {}
    try { props.deleteProperty("syncBuf"); } catch (err) {}
  } else {
    try { body = JSON.parse((e.postData && e.postData.contents) || "{}"); } catch (err) {}
    if (p.payload) {
      try { body = JSON.parse(p.payload); } catch (err) {}
    }
  }
  var key = String(body.key || incomingKey || "");
  stored = props.getProperty("syncKey") || CONFIG.syncKey || "";
  if (stored && key && stored !== key) return jsonOut_({ ok: false, error: "key" });
  if (!stored && key) {
    props.setProperty("syncKey", key);
  }
  if (body.config && typeof body.config === "object") {
    var prev = {};
    try { prev = JSON.parse(props.getProperty("liveConfig") || "{}"); } catch (err) {}
    ["email","telegramToken","telegramChatId","webhookUrl","kakaoRestKey","kakaoRefreshToken","xApiKey","xApiSecret","xAccessToken","xAccessSecret","xClientId","xClientSecret","xRefreshToken"].forEach(function (k) {
      if (!body.config[k] && (prev[k] || CONFIG[k])) {
        body.config[k] = prev[k] || CONFIG[k];
      }
    });
    props.setProperty("liveConfig", JSON.stringify(body.config));
    applyLiveConfig_();
    try { ensureTrigger_(); } catch (err2) {}
  }
  return jsonOut_({ ok: true });
}

function handleUpgrade_(e) {
  var p = (e && e.parameter) || {};
  var props = PropertiesService.getScriptProperties();
  var phase = String(p.phase || "");
  var incomingKey = String(p.key || "");
  var stored = props.getProperty("syncKey") || CONFIG.syncKey || "";
  if (phase === "start") {
    if (stored && incomingKey && stored !== incomingKey) return jsonOut_({ ok: false, error: "key" });
    if (incomingKey) props.setProperty("syncKey", incomingKey);
    props.setProperty("upBuf", "");
    return jsonOut_({ ok: true, phase: "start" });
  }
  if (phase === "chunk") {
    props.setProperty("upBuf", (props.getProperty("upBuf") || "") + String(p.d || ""));
    return jsonOut_({ ok: true, phase: "chunk" });
  }
  if (phase === "end") {
    var source = props.getProperty("upBuf") || "";
    try { props.deleteProperty("upBuf"); } catch (err) {}
    if (!source) return jsonOut_({ ok: false, error: "empty" });
    return jsonOut_(upgradeSelf_(source));
  }
  return jsonOut_({ ok: false, error: "phase" });
}

function upgradeSelf_(source) {
  var id = ScriptApp.getScriptId();
  var token = ScriptApp.getOAuthToken();
  var headers = { Authorization: "Bearer " + token };
  var put = UrlFetchApp.fetch("https://script.googleapis.com/v1/projects/" + id + "/content", {
    method: "put",
    contentType: "application/json",
    headers: headers,
    payload: JSON.stringify({
      files: [
        { name: "appsscript", type: "JSON", source: JSON.stringify(GAS_MANIFEST) },
        { name: "Code", type: "SERVER_JS", source: source }
      ]
    }),
    muteHttpExceptions: true
  });
  if (put.getResponseCode() >= 300) {
    return { ok: false, error: "content", detail: String(put.getContentText()).slice(0, 300) };
  }
  var ver = UrlFetchApp.fetch("https://script.googleapis.com/v1/projects/" + id + "/versions", {
    method: "post",
    contentType: "application/json",
    headers: headers,
    payload: JSON.stringify({ description: "openbell" }),
    muteHttpExceptions: true
  });
  var verJson = {};
  try { verJson = JSON.parse(ver.getContentText()); } catch (err) {}
  var versionNumber = Number(verJson.versionNumber || 0);
  if (!versionNumber) {
    return { ok: false, error: "version", detail: String(ver.getContentText()).slice(0, 300) };
  }
  var listed = UrlFetchApp.fetch("https://script.googleapis.com/v1/projects/" + id + "/deployments", {
    headers: headers,
    muteHttpExceptions: true
  });
  var listedJson = {};
  try { listedJson = JSON.parse(listed.getContentText()); } catch (err) {}
  var deployments = listedJson.deployments || [];
  var web = null;
  for (var i = 0; i < deployments.length; i++) {
    var eps = deployments[i].entryPoints || [];
    for (var j = 0; j < eps.length; j++) {
      if (eps[j].webApp && eps[j].webApp.url) {
        web = deployments[i];
        break;
      }
    }
    if (web) break;
  }
  if (!web || !web.deploymentId) {
    var created = UrlFetchApp.fetch("https://script.googleapis.com/v1/projects/" + id + "/deployments", {
      method: "post",
      contentType: "application/json",
      headers: headers,
      payload: JSON.stringify({
        versionNumber: versionNumber,
        manifestFileName: "appsscript",
        description: "openbell web"
      }),
      muteHttpExceptions: true
    });
    return { ok: created.getResponseCode() < 300, version: versionNumber };
  }
  var patched = UrlFetchApp.fetch(
    "https://script.googleapis.com/v1/projects/" + id + "/deployments/" + web.deploymentId + "?updateMask=deploymentConfig",
    {
      method: "patch",
      contentType: "application/json",
      headers: headers,
      payload: JSON.stringify({
        deploymentConfig: {
          scriptId: id,
          versionNumber: versionNumber,
          manifestFileName: "appsscript",
          description: "openbell web"
        }
      }),
      muteHttpExceptions: true
    }
  );
  return { ok: patched.getResponseCode() < 300, version: versionNumber };
}

function notify_(subject, body, alerts) {
  const html = buildMailHtml_(subject, body, alerts);
  var log = { at: Date.now(), mail: "", telegram: "", kakao: "", x: "" };
  if (CONFIG.email) {
    try {
      GmailApp.sendEmail(CONFIG.email, subject, body, { htmlBody: html, name: "오픈벨" });
      log.mail = "ok";
    } catch (e) {
      log.mail = String(e).slice(0, 80);
      Logger.log("mail " + String(e));
    }
  } else {
    log.mail = "off";
  }
  try {
    if (!CONFIG.telegramToken || !CONFIG.telegramChatId) {
      log.telegram = "off";
    } else {
      sendTelegram_(subject, body, alerts);
      log.telegram = "ok";
    }
  } catch (e) {
    log.telegram = String(e).slice(0, 80);
  }
  if (CONFIG.webhookUrl) {
    try {
      UrlFetchApp.fetch(CONFIG.webhookUrl, {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify({ title: subject, alerts: alerts }),
        muteHttpExceptions: true,
      });
    } catch (e) {
      Logger.log("webhook " + String(e));
    }
  }
  try {
    if (!CONFIG.kakaoRestKey || !CONFIG.kakaoRefreshToken) {
      log.kakao = "off";
    } else {
      sendKakao_(subject, alerts);
      log.kakao = "ok";
    }
  } catch (e) {
    log.kakao = String(e).slice(0, 80);
    Logger.log("kakao " + String(e));
  }
  try {
    if (!CONFIG.xAccessToken && !CONFIG.xApiKey) {
      log.x = "off";
    } else {
      sendX_(subject, body, alerts);
      log.x = "ok";
    }
  } catch (e) {
    log.x = String(e).slice(0, 80);
    Logger.log("x " + String(e));
  }
  try {
    PropertiesService.getScriptProperties().setProperty("lastNotify", JSON.stringify(log));
  } catch (e2) {}
}

function telegramChatId_() {
  var chatId = CONFIG.telegramChatId;
  if (/^-?\\d+$/.test(String(chatId))) return Number(chatId);
  return chatId;
}

function sendTelegram_(subject, body, alerts) {
  if (!CONFIG.telegramToken || !CONFIG.telegramChatId) return;
  var chatId = telegramChatId_();
  var items = (alerts || []).filter(function (a) { return a && (a.title || a.url); });
  var groups = [];
  if (!items.length) {
    groups.push([]);
  } else {
    for (var i = 0; i < items.length; i += 8) groups.push(items.slice(i, i + 8));
  }
  groups.forEach(function (group) {
    var text = "<b>" + escHtml_(subject) + "</b>";
    if (group.length) {
      group.forEach(function (a) {
        text += "\\n\\n<b>" + escHtml_(a.title || "") + "</b>";
        var meta = alertMeta_(a);
        if (meta) text += "\\n" + escHtml_(meta);
        if (a.restSeats != null) {
          text += "\\n" + escHtml_("잔여 " + a.restSeats + (a.delta != null ? " (" + (a.delta > 0 ? "+" : "") + a.delta + ")" : ""));
        }
        if (a.url) text += "\\n<a href=\\"" + escAttr_(a.url) + "\\">바로 예매</a>";
      });
    } else {
      text += "\\n\\n" + escHtml_(stripMailUrls_(body));
    }
    var payload = {
      chat_id: chatId,
      text: text.substring(0, 3900),
      parse_mode: "HTML",
      disable_web_page_preview: true,
    };
    try {
      var res = UrlFetchApp.fetch("https://api.telegram.org/bot" + CONFIG.telegramToken + "/sendMessage", {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify(payload),
        muteHttpExceptions: true,
      });
      var json = JSON.parse(res.getContentText());
      if (!json.ok) Logger.log("telegram " + (json.description || res.getResponseCode()));
    } catch (e) {
      Logger.log("telegram " + String(e));
    }
  });
}

function withRound_(row) {
  return row;
}

function prettyDate_(ymd) {
  var s = String(ymd || "");
  if (s.length >= 8) {
    return Number(s.slice(4, 6)) + "월 " + Number(s.slice(6, 8)) + "일";
  }
  return s;
}

function prettyTime_(t) {
  var m = String(t || "").match(/^(\\d{1,2}):(\\d{2})/);
  if (!m) return t;
  return Number(m[1]) + "시 " + m[2] + "분";
}

function alertMeta_(a) {
  return [a.theater, prettyDate_(a.date), prettyTime_(a.time), a.hall].filter(Boolean).join(" ");
}

function alertLine_(a) {
  var bits = [];
  if (a.title) bits.push(a.title);
  var meta = alertMeta_(a);
  if (meta) bits.push(meta);
  if (a.restSeats != null) {
    bits.push("잔여 " + a.restSeats + (a.delta != null ? " (+" + a.delta + ")" : ""));
  }
  return bits.join("\\n");
}

function buttonLabel_(a) {
  var label = [a.theater, a.time].filter(Boolean).join(" ");
  if (!label) label = "바로 예매";
  return String(label).substring(0, 32);
}

function stripMailUrls_(s) {
  return String(s || "").split("\\n").filter(function (line) {
    return line.indexOf("http") < 0 && line.indexOf("바로예매") < 0;
  }).join("\\n");
}

function buildMailHtml_(subject, body, alerts) {
  const items = (alerts || []).filter(function (a) {
    return a && (a.title || a.url || a.theater);
  });
  const rows = items.map(function (a) {
    const meta = alertMeta_(a);
    var extra = "";
    if (a.restSeats != null) {
      extra = "잔여 " + a.restSeats + (a.delta != null ? " (+" + a.delta + ")" : "");
    }
    const btn = a.url
      ? '<p style="margin:12px 0 0"><a href="' + esc_(a.url) + '" style="display:inline-block;padding:11px 18px;background:#9aaa96;color:#0c0c0d;text-decoration:none;border-radius:8px;font-weight:600">바로 예매</a></p>'
      : "";
    return '<div style="margin:0 0 20px;padding:0 0 16px;border-bottom:1px solid #e8e4dc">' +
      "<p style='margin:0 0 4px;font-size:16px;font-weight:600'>" + esc_(a.title || subject) + "</p>" +
      (meta ? "<p style='margin:0;font-size:13px;color:#666'>" + esc_(meta) + "</p>" : "") +
      (extra ? "<p style='margin:4px 0 0;font-size:13px;color:#4a5c4a'>" + esc_(extra) + "</p>" : "") +
      btn + "</div>";
  }).join("");
  const fallback = rows
    ? ""
    : "<p>" + esc_(stripMailUrls_(body)).split("\\n").join("<br>") + "</p>";
  return '<div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;line-height:1.55;color:#111;max-width:560px">' +
    fallback + rows +
    "<p style='margin:16px 0 0;color:#888;font-size:12px'>오픈벨 · 새로 열린 상영만 보냅니다.</p></div>";
}

function sendKakao_(subject, alerts) {
  if (!CONFIG.kakaoRestKey || !CONFIG.kakaoRefreshToken) return;
  const tokenRes = UrlFetchApp.fetch("https://kauth.kakao.com/oauth/token", {
    method: "post",
    payload: {
      grant_type: "refresh_token",
      client_id: CONFIG.kakaoRestKey,
      refresh_token: CONFIG.kakaoRefreshToken,
    },
    muteHttpExceptions: true,
  });
  const tokenJson = JSON.parse(tokenRes.getContentText());
  if (!tokenJson.access_token) return;
  const items = (alerts || []).filter(function (a) { return a && (a.title || a.url); }).slice(0, 8);
  if (!items.length) items.push({ title: subject, url: CONFIG.appUrl || "https://www.megabox.co.kr/booking" });
  items.forEach(function (a) {
    const text = (a.title
      ? "[오픈벨] " + a.title + "\\n" + alertMeta_(a)
      : subject).substring(0, 200);
    const link = a.url || "https://www.megabox.co.kr/booking";
    const template = {
      object_type: "text",
      text: text,
      link: { web_url: link, mobile_web_url: link },
      button_title: "바로 예매",
    };
    UrlFetchApp.fetch("https://kapi.kakao.com/v2/api/talk/memo/default/send", {
      method: "post",
      headers: { Authorization: "Bearer " + tokenJson.access_token },
      payload: { template_object: JSON.stringify(template) },
      muteHttpExceptions: true,
    });
  });
}

function xEnc_(s) {
  return encodeURIComponent(String(s)).replace(/[!'()*]/g, function (c) {
    return "%" + c.charCodeAt(0).toString(16).toUpperCase();
  });
}

function sendX_(subject, body, alerts) {
  if (!CONFIG.xAccessToken) return;
  var lines = ["홀드현알리미"];
  var items = (alerts || []).filter(function (a) { return a && (a.title || a.url); });
  if (items.length) {
    items.slice(0, 3).forEach(function (a) {
      if (a.title) lines.push(a.title);
      var meta = alertMeta_(a);
      if (meta) lines.push(meta);
      if (a.url) lines.push(String(a.url));
    });
    if (items.length > 3) lines.push("외 " + (items.length - 3) + "건");
  } else {
    lines.push(String(subject || "오픈벨"));
  }
  var text = lines.join("\\n").substring(0, 270);
  var url = "https://api.x.com/2/tweets";
  var token = CONFIG.xAccessToken;
  var posted = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + token },
    payload: JSON.stringify({ text: text }),
    muteHttpExceptions: true
  });
  if (posted.getResponseCode() === 401 && CONFIG.xClientId && CONFIG.xClientSecret && CONFIG.xRefreshToken) {
    var basic = Utilities.base64Encode(CONFIG.xClientId + ":" + CONFIG.xClientSecret);
    var refreshed = UrlFetchApp.fetch("https://api.x.com/2/oauth2/token", {
      method: "post",
      headers: { Authorization: "Basic " + basic },
      payload: {
        grant_type: "refresh_token",
        refresh_token: CONFIG.xRefreshToken
      },
      muteHttpExceptions: true
    });
    var tok = {};
    try { tok = JSON.parse(refreshed.getContentText()); } catch (e) {}
    if (tok.access_token) {
      token = tok.access_token;
      CONFIG.xAccessToken = token;
      if (tok.refresh_token) CONFIG.xRefreshToken = tok.refresh_token;
      try {
        var props = PropertiesService.getScriptProperties();
        var live = JSON.parse(props.getProperty("liveConfig") || "{}");
        live.xAccessToken = token;
        if (tok.refresh_token) live.xRefreshToken = tok.refresh_token;
        props.setProperty("liveConfig", JSON.stringify(live));
      } catch (e) {}
      UrlFetchApp.fetch(url, {
        method: "post",
        contentType: "application/json",
        headers: { Authorization: "Bearer " + token },
        payload: JSON.stringify({ text: text }),
        muteHttpExceptions: true
      });
    }
  }
}

function fetchRanking_() {
  const res = UrlFetchApp.fetch("https://www.megabox.co.kr/on/oh/oha/Movie/selectMovieList.do", {
    method: "post",
    payload: { currentPage: "1", recordCountPerPage: "80", onairYn: "Y" },
    muteHttpExceptions: true,
  });
  const json = JSON.parse(res.getContentText());
  return (json.movieList || []).map(function (m) {
    return { rank: m.boxoRank, title: decode_(m.movieNm || "") };
  });
}

function fetchMegabox_(theaterId, playDate) {
  const src = CONFIG.scanSources || {};
  if (src.official !== false) {
    try {
      const rows = fetchMegaboxOfficial_(theaterId, playDate);
      if (rows && rows.length) return rows;
    } catch (e) {}
  }
  if (src.naver !== false) {
    try {
      const rows = fetchMegaboxNaver_(theaterId, playDate);
      if (rows && rows.length) return rows;
    } catch (e) {}
  }
  return [];
}

function fetchLiveTimetable_(days, theaterId) {
  const dates = kstDates_(scanDays_());
  const want = String(theaterId || "");
  const megaIds = ["megabox_coex", "megabox_namyangju"].filter(function (id) {
    return !want || want === id;
  });
  const cgvIds = ["cgv_yongsan", "cgv_yeongdeungpo"].filter(function (id) {
    return !want || want === id;
  });
  const reqs = [];
  const meta = [];
  megaIds.forEach(function (id) {
    const brch = id === "megabox_coex" ? "1351" : "0019";
    dates.forEach(function (playDate) {
      reqs.push({
        url: "https://www.megabox.co.kr/on/oh/ohc/Brch/schedulePage.do",
        method: "post",
        payload: { brchNo: brch, brchNo1: brch, playDe: playDate, masterType: "brch" },
        muteHttpExceptions: true,
        followRedirects: true,
      });
      meta.push({ kind: "mega", theaterId: id, playDate: playDate, brch: brch });
    });
  });
  cgvIds.forEach(function (id) {
    const site = CGV_SITES_[id];
    if (!site) return;
    dates.forEach(function (playDate) {
      reqs.push({
        url: "https://api.cgv.co.kr/cnm/atkt/searchMovScnInfo?coCd=A420&siteNo=" + site.siteNo + "&scnYmd=" + playDate + "&rtctlScopCd=08",
        muteHttpExceptions: true,
        followRedirects: true,
        headers: { Accept: "application/json", Referer: "https://cgv.co.kr/", Origin: "https://cgv.co.kr", "User-Agent": "Mozilla/5.0 (Linux; Android 13; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36" },
      });
      meta.push({ kind: "cgv-official", theaterId: id, playDate: playDate, siteNo: site.siteNo });
    });
  });
  const out = [];
  const missingCgv = [];
  if (!reqs.length) return out;
  try {
    const resps = UrlFetchApp.fetchAll(reqs);
    resps.forEach(function (res, i) {
      const info = meta[i];
      try {
        if (info.kind === "mega") {
          const json = JSON.parse(res.getContentText());
          const list = (((json.megaMap) || {}).movieFormList) || [];
          list.forEach(function (row) {
            const hall = decode_(row.theabExpoNm || "");
            const title = decode_(row.rpstMovieNm || row.movieNm || "");
            const time = row.playStartTime;
            if (!title || !time) return;
            out.push({
              id: "megabox:" + info.brch + ":" + info.playDate + ":" + time + ":" + hall,
              theaterId: info.theaterId,
              theater: info.theaterId === "megabox_coex" ? "메가박스 코엑스" : "메가박스 남양주",
              title: title,
              date: info.playDate,
              time: time,
              hall: hall,
              formats: megaFormats_(row.theabKindCd, hall),
              restSeats: typeof row.restSeatCnt === "number" ? row.restSeatCnt : null,
              totalSeats: typeof row.totSeatCnt === "number" ? row.totSeatCnt : null,
              url: megaboxUrl_(info.brch, info.playDate, row.movieNo || row.rpstMovieNo || "", row.playSchdlNo),
            });
          });
          return;
        }
        if (info.kind === "cgv-official") {
          const added = parseCgvOfficialLive_(res.getContentText(), info);
          if (added.length) {
            added.forEach(function (row) { out.push(row); });
            return;
          }
          missingCgv.push(info);
          return;
        }
        parseCgvMcpLive_(res.getContentText(), info).forEach(function (row) { out.push(row); });
      } catch (e) {
        if (info && info.kind === "cgv-official") missingCgv.push(info);
      }
    });
    if (missingCgv.length) {
      const extraReqs = missingCgv.map(function (info) {
        return {
          url: "https://mcp.aka.page/api/cgv/timetable?playDate=" + info.playDate + "&theaterCode=" + info.siteNo + "&limit=200",
          muteHttpExceptions: true,
          followRedirects: true,
        };
      });
      const extra = UrlFetchApp.fetchAll(extraReqs);
      extra.forEach(function (res, i) {
        try {
          parseCgvMcpLive_(res.getContentText(), missingCgv[i]).forEach(function (row) { out.push(row); });
        } catch (e2) {}
      });
    }
  } catch (e) {}
  return out;
}

function parseCgvOfficialLive_(text, info) {
  const out = [];
  const json = JSON.parse(text);
  const rows = json.data || json.body || [];
  if (!rows || !rows.length) return out;
  const site = CGV_SITES_[info.theaterId];
  rows.forEach(function (row) {
    const title = decode_(row.movNm || row.movieName || "");
    const hall = row.scrnNm || row.scnNm || row.soundTypNm || row.scnsrtNm || "특별관";
    var raw = String(row.scnsrtTm || row.startTime || "");
    var time = raw.length === 4 ? raw.slice(0, 2) + ":" + raw.slice(2) : raw;
    if (!title || !time) return;
    const rest = Number(row.frSeatCnt);
    const total = Number(row.stcnt);
    out.push({
      id: "cgv:" + info.siteNo + ":" + info.playDate + ":" + time + ":" + hall + ":" + title,
      theaterId: info.theaterId,
      theater: site ? site.name : info.theaterId,
      title: title,
      date: info.playDate,
      time: time,
      hall: hall,
      formats: cgvFormats_(hall),
      restSeats: Number.isFinite(rest) ? rest : null,
      totalSeats: Number.isFinite(total) ? total : null,
      url: cgvBookUrl_(info.theaterId, info.playDate, row, ""),
    });
  });
  return out;
}

function parseCgvMcpLive_(text, info) {
  const out = [];
  const json = JSON.parse(text);
  const rows = (((json.data) || {}).timetable) || [];
  const site = CGV_SITES_[info.theaterId];
  rows.forEach(function (row) {
    const title = String(row.movieName || "").trim();
    const time = String(row.startTime || "").trim();
    if (!title || !time) return;
    const total = typeof row.totalSeats === "number" ? row.totalSeats : null;
    const guessed = cgvHallFromSeats_(info.theaterId, row.screenName || "", total);
    out.push({
      id: "cgv:" + info.siteNo + ":" + info.playDate + ":" + time + ":" + guessed.hall + ":" + title,
      theaterId: info.theaterId,
      theater: site ? site.name : info.theaterId,
      title: title,
      date: info.playDate,
      time: time,
      hall: guessed.hall,
      formats: guessed.formats,
      restSeats: typeof row.remainingSeats === "number" ? row.remainingSeats : null,
      totalSeats: total,
      url: cgvBookUrl_(info.theaterId, info.playDate, row, row.movieCode ? "" : (site ? site.book : "")),
    });
  });
  return out;
}

function cgvHallFromSeats_(theaterId, hall, total) {
  const named = cgvFormats_(hall);
  if (named.length && named[0] !== "other") return { hall: hall, formats: named };
  const table = theaterId === "cgv_yeongdeungpo"
    ? { 387: { hall: "IMAX관", formats: ["imax"] }, 144: { hall: "4DX관", formats: ["4dx"] }, 195: { hall: "4관[DOLBY ATMOS] (Laser)", formats: ["atmos"] }, 240: { hall: "SCREENX관 (리클라이너) with PRIVATE BOX", formats: ["screenx"] } }
    : theaterId === "cgv_yongsan"
      ? { 144: { hall: "4DX관", formats: ["4dx"] }, 624: { hall: "SCREENX관 (리클라이너)", formats: ["screenx"] } }
      : {};
  if (total != null && table[total]) return table[total];
  return { hall: hall || "일반", formats: ["other"] };
}

function fetchMegaboxOfficial_(theaterId, playDate) {
  const brch = theaterId === "megabox_coex" ? "1351" : "0019";
  const res = UrlFetchApp.fetch("https://www.megabox.co.kr/on/oh/ohc/Brch/schedulePage.do", {
    method: "post",
    payload: { brchNo: brch, brchNo1: brch, playDe: playDate, masterType: "brch" },
    muteHttpExceptions: true,
    followRedirects: true,
  });
  const json = JSON.parse(res.getContentText());
  const list = (((json.megaMap) || {}).movieFormList) || [];
  return list.map(function (row) {
    const hall = decode_(row.theabExpoNm || "");
    return {
      id: "megabox:" + brch + ":" + playDate + ":" + row.playStartTime + ":" + hall,
      theater: theaterId === "megabox_coex" ? "메가박스 코엑스" : "메가박스 남양주",
      title: decode_(row.rpstMovieNm || row.movieNm || ""),
      date: playDate,
      time: row.playStartTime,
      hall: hall,
      formats: megaFormats_(row.theabKindCd, hall),
      restSeats: typeof row.restSeatCnt === "number" ? row.restSeatCnt : null,
      url: megaboxUrl_(brch, playDate, row.movieNo || row.rpstMovieNo || "", row.playSchdlNo),
    };
  });
}

var NAVER_MEGA_CACHE_ = {};
var MEGA_NAVER_SITES_ = {
  megabox_coex: { placeId: "12307868", name: "메가박스 코엑스", brch: "1351" },
  megabox_namyangju: { placeId: "1542146675", name: "메가박스 남양주", brch: "0019" },
};
function fetchMegaboxNaver_(theaterId, playDate) {
  if (!NAVER_MEGA_CACHE_[theaterId]) NAVER_MEGA_CACHE_[theaterId] = parseMegaNaverAll_(theaterId);
  return NAVER_MEGA_CACHE_[theaterId][playDate] || [];
}
function parseMegaNaverAll_(theaterId) {
  const out = {};
  const site = MEGA_NAVER_SITES_[theaterId] || MEGA_NAVER_SITES_.megabox_coex;
  try {
    const res = UrlFetchApp.fetch("https://m.place.naver.com/theater/" + site.placeId + "/movie", {
      muteHttpExceptions: true,
      followRedirects: true,
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        "Accept-Language": "ko-KR,ko;q=0.9",
        Referer: "https://m.place.naver.com/",
      },
    });
    const html = res.getContentText();
    if (res.getResponseCode() !== 200) return out;
    const text = String(html || "").split("\\\\u002F").join("/");
    const parts = text.split('"__typename":"MovieTime"');
    for (var i = 1; i < parts.length; i++) {
      const chunk = parts[i].substring(0, 100000);
      const dateRaw = (chunk.match(/"date":"(\\d{4}-\\d{2}-\\d{2})"/) || [])[1];
      const title = decode_((chunk.match(/"name":"([^"]+)"/) || [])[1] || "");
      if (!dateRaw || !title || title.length > 40) continue;
      const date = String(dateRaw).replace(/-/g, "");
      const hallBlocks = chunk.split('"theaterName":"');
      for (var h = 1; h < hallBlocks.length; h++) {
        const hall = hallBlocks[h].split('"')[0];
        const formats = megaFormats_(null, hall);
        if (!formats.length || (formats.length === 1 && formats[0] === "other")) continue;
        const timeMarks = hallBlocks[h].match(/"rtime":"(\\d{1,2}:\\d{2})"/g) || [];
        const urlMarks = hallBlocks[h].match(/ticketMobileUrl":"([^"]+)"/g) || [];
        timeMarks.forEach(function (mark, idx) {
          var time = String(mark).replace(/.*"rtime":"/, "").replace(/"/g, "");
          if (time.length === 4) time = "0" + time;
          var url = String(urlMarks[idx] || urlMarks[0] || "").replace(/ticketMobileUrl":"/, "").replace(/"/g, "");
          if (!out[date]) out[date] = [];
          out[date].push({
            id: "megabox:" + site.brch + ":" + date + ":" + time + ":" + hall,
            theater: site.name,
            title: title,
            date: date,
            time: time,
            hall: hall,
            formats: formats,
            restSeats: null,
            url: url || megaboxUrl_(site.brch, date, "", ""),
          });
        });
      }
    }
  } catch (e) {}
  return out;
}

function cgvHeaders_() {
  return {
    "User-Agent": "Mozilla/5.0 (Linux; Android 13; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36",
    "Accept-Language": "ko-KR,ko;q=0.9",
    "Referer": "https://m.cgv.co.kr/",
    "X-Requested-With": "XMLHttpRequest",
  };
}

var CGV_SITES_ = {
  cgv_yongsan: { placeId: "12298207", siteNo: "0013", name: "CGV 용산아이파크몰", siteNm: "용산아이파크몰", book: "https://cgv.co.kr/cnm/movieBook/cinema?siteNo=0013" },
  cgv_yeongdeungpo: { placeId: "13141635", siteNo: "0059", name: "CGV 영등포", siteNm: "영등포타임스퀘어", book: "https://cgv.co.kr/cnm/movieBook/cinema?siteNo=0059" },
};

function fetchCgv_(theaterId, playDate) {
  const merged = [];
  const seen = {};
  const add = function (rows) {
    (rows || []).forEach(function (row) {
      if (seen[row.id]) return;
      seen[row.id] = true;
      merged.push(row);
    });
  };
  const src = CONFIG.scanSources || { official: true, naver: true, gas: true };
  if (src.naver !== false) add(fetchCgvNaver_(theaterId, playDate));
  if (!merged.length && src.official !== false && !CGV_OFFICIAL_DEAD_) {
    add(fetchCgvMobile_(theaterId, playDate));
    if (!merged.length) {
      try {
        const iframeUrl = "https://www.cgv.co.kr/common/showtimes/iframeTheater.aspx?areacode=01&theatercode=" + (CGV_SITES_[theaterId] || CGV_SITES_.cgv_yongsan).siteNo + "&date=" + playDate;
        const html = UrlFetchApp.fetch(iframeUrl, {
          muteHttpExceptions: true,
          followRedirects: true,
          headers: cgvHeaders_(),
        }).getContentText();
        add(parseCgvHtml_(html, playDate, theaterId));
      } catch (e) {}
    }
    if (!merged.length) add(fetchCgvApi_(theaterId, playDate));
    if (!merged.length) CGV_OFFICIAL_DEAD_ = true;
  }
  if (!merged.length && src.gas !== false && theaterId === "cgv_yongsan") add(fetchCgvTelegram_(playDate));
  return merged;
}

var CGV_OFFICIAL_DEAD_ = false;
var NAVER_CGV_CACHE_ = {};
var TELE_CGV_CACHE_ = null;
var CGV_ERR_ = "";
function fetchCgvNaver_(theaterId, playDate) {
  if (!NAVER_CGV_CACHE_[theaterId]) NAVER_CGV_CACHE_[theaterId] = parseCgvNaverAll_(theaterId);
  return NAVER_CGV_CACHE_[theaterId][playDate] || [];
}
function fetchCgvTelegram_(playDate) {
  if (!TELE_CGV_CACHE_) TELE_CGV_CACHE_ = parseCgvTelegramAll_();
  return TELE_CGV_CACHE_[playDate] || [];
}

function parseCgvNaverAll_(theaterId) {
  const out = {};
  const site = CGV_SITES_[theaterId] || CGV_SITES_.cgv_yongsan;
  try {
    const res = UrlFetchApp.fetch("https://m.place.naver.com/theater/" + site.placeId + "/movie", {
      muteHttpExceptions: true,
      followRedirects: true,
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        "Accept-Language": "ko-KR,ko;q=0.9",
        Referer: "https://m.place.naver.com/",
      },
    });
    const html = res.getContentText();
    if (res.getResponseCode() !== 200) {
      CGV_ERR_ = site.name + " 네이버 " + res.getResponseCode();
      return out;
    }
    const text = String(html || "").split("\\\\u002F").join("/");
    const chunks = text.split('"name":"');
    for (var i = 1; i < chunks.length; i++) {
      const title = decode_(chunks[i].split('"')[0]);
      if (!title || title.length > 40) continue;
      const block = chunks[i].substring(0, 80000);
      if (block.indexOf("scheduleList") < 0) continue;
      const hallBlocks = block.split('"theaterName":"');
      for (var h = 1; h < hallBlocks.length; h++) {
        const hall = hallBlocks[h].split('"')[0];
        const formats = cgvFormats_(hall);
        if (!formats.length) continue;
        const timeMarks = hallBlocks[h].match(/"rtime":"(\\d{1,2}:\\d{2})"/g) || [];
        const urlMarks = hallBlocks[h].match(/ticketMobileUrl":"([^"]+)"/g) || [];
        timeMarks.forEach(function (mark, idx) {
          var time = String(mark).replace(/.*"rtime":"/, "").replace(/"/g, "");
          if (time.length === 4) time = "0" + time;
          var url = String(urlMarks[idx] || urlMarks[0] || "").replace(/ticketMobileUrl":"/, "").replace(/"/g, "");
          var date = "";
          const dm = url.match(/scnYmd=(\\d{8})/);
          if (dm) date = dm[1];
          if (!date) {
            const d2 = block.match(/"date":"(\\d{4}-\\d{2}-\\d{2})"/);
            if (d2) date = String(d2[1]).replace(/-/g, "");
          }
          if (!date) return;
          if (!out[date]) out[date] = [];
          out[date].push(cgvRow_(date, time, hall, title, url, theaterId));
        });
      }
    }
    if (!Object.keys(out).length) CGV_ERR_ = site.name + " 네이버 시간표 없음";
  } catch (e) {
    CGV_ERR_ = site.name + " " + String(e);
  }
  return out;
}

function parseCgvTelegramAll_() {
  const out = {};
  try {
    const html = UrlFetchApp.fetch("https://t.me/s/yongsan_cgv_imax", {
      muteHttpExceptions: true,
      followRedirects: true,
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
        "Accept-Language": "ko-KR,ko;q=0.9",
      },
    }).getContentText();
    const plain = String(html || "").replace(/<[^>]+>/g, "\\n");
    const parts = plain.split(/(\\d{4}년\\s*\\d{1,2}월\\s*\\d{1,2}일)/);
    for (var i = 1; i < parts.length; i += 2) {
      const head = parts[i];
      const body = parts[i + 1] || "";
      const dm = head.match(/(\\d{4})년\\s*(\\d{1,2})월\\s*(\\d{1,2})일/);
      if (!dm) continue;
      const date = dm[1] + ("0" + dm[2]).slice(-2) + ("0" + dm[3]).slice(-2);
      var title = "오디세이";
      const tm = body.match(/([가-힣A-Za-z0-9: ·]{2,40})\\s*\\(\\s*IMAX/i);
      if (tm) title = decode_(tm[1]).replace(/\\s+/g, " ").trim();
      const times = body.match(/(\\d{1,2}:\\d{2})\\s*~/g) || [];
      times.forEach(function (mark) {
        var time = String(mark).replace(/[^0-9:]/g, "");
        if (time.length === 4) time = "0" + time;
        if (!out[date]) out[date] = [];
        out[date].push(cgvRow_(
          date,
          time,
          "IMAX관",
          title,
          "",
          "cgv_yongsan"
        ));
      });
    }
    if (!Object.keys(out).length && !CGV_ERR_) CGV_ERR_ = "용아맥 채널 시간표 없음";
  } catch (e) {
    if (!CGV_ERR_) CGV_ERR_ = "용아맥 " + String(e);
  }
  return out;
}

function fetchCgvMobile_(theaterId, playDate) {
  const site = CGV_SITES_[theaterId] || CGV_SITES_.cgv_yongsan;
  try {
    const res = UrlFetchApp.fetch("https://m.cgv.co.kr/Schedule/cont/ajaxMovieSchedule.aspx", {
      method: "post",
      payload: { theaterCd: site.siteNo, playYMD: playDate },
      muteHttpExceptions: true,
      followRedirects: true,
      headers: cgvHeaders_(),
    });
    if (res.getResponseCode() !== 200) return [];
    const html = res.getContentText();
    if (html.indexOf("mets01081") >= 0) return [];
    const fromOld = parseCgvHtml_(html, playDate, theaterId);
    if (fromOld.length) return fromOld;
    return parseCgvMobile_(html, playDate, theaterId);
  } catch (e) {
    return [];
  }
}

function parseCgvMobile_(html, playDate, theaterId) {
  const out = [];
  const chunks = String(html || "").split(/class=/i);
  chunks.forEach(function (chunk) {
    const hallM = chunk.match(/SCREENX|ULTRA\\s*4DX|4DX|IMAX|DOLBY\\s*ATMOS|ATMOS/i);
    if (!hallM) return;
    const titleM = chunk.match(/>([가-힣A-Za-z0-9][^<]{1,40})</);
    const title = titleM ? decode_(titleM[1]) : "";
    const times = chunk.match(/\\b([01]?\\d|2[0-3]):[0-5]\\d\\b/g) || [];
    if (!title) return;
    times.forEach(function (time) {
      out.push(cgvRow_(playDate, time, hallM[0], title, "", theaterId));
    });
  });
  return out;
}

function parseCgvHtml_(html, playDate, theaterId) {
  const out = [];
  const seats = parseCgvSeatMap_(html);
  const blocks = html.split(/<div[^>]*col-times/);
  for (var i = 1; i < blocks.length; i++) {
    const titleM = blocks[i].match(/<strong>([^<]+)<\\/strong>/);
    if (!titleM) continue;
    const title = decode_(titleM[1]);
    const times = blocks[i].match(/\\b([01]?\\d|2[0-3]):[0-5]\\d\\b/g) || [];
    const hallM = blocks[i].match(/(ULTRA\\s*4DX|SCREENX|4DX|IMAX|DOLBY\\s*ATMOS|\\d+관)/i);
    const hall = hallM ? hallM[1] : "특별관";
    times.forEach(function (time) {
      const row = cgvRow_(playDate, time, hall, title, "", theaterId);
      const hit = seats[time + "|" + String(hall).toUpperCase().replace(/\\s+/g, "")] || seats[time];
      if (hit) {
        row.restSeats = hit.rest;
        row.totalSeats = hit.total;
      }
      out.push(row);
    });
  }
  return out;
}

function mergeCgvSeats_(rows, theaterId, playDate) {
  if (!rows || !rows.length) return;
  const site = CGV_SITES_[theaterId] || CGV_SITES_.cgv_yongsan;
  try {
    const html = UrlFetchApp.fetch(
      "https://www.cgv.co.kr/common/showtimes/iframeTheater.aspx?areacode=01&theatercode=" + site.siteNo + "&date=" + playDate,
      { muteHttpExceptions: true, followRedirects: true, headers: cgvHeaders_() }
    ).getContentText();
    applySeatMap_(rows, parseCgvSeatMap_(html));
    applySeatMap_(rows, parseCgvHrefSeats_(html));
  } catch (e) {}
  if (rows.some(function (r) { return typeof r.restSeats === "number"; })) return;
  try {
    const res = UrlFetchApp.fetch("https://m.cgv.co.kr/Schedule/cont/ajaxMovieSchedule.aspx", {
      method: "post",
      payload: { theaterCd: site.siteNo, playYMD: playDate },
      muteHttpExceptions: true,
      followRedirects: true,
      headers: cgvHeaders_(),
    });
    const html = res.getContentText();
    applySeatMap_(rows, parseCgvSeatMap_(html));
    applySeatMap_(rows, parseCgvHrefSeats_(html));
  } catch (e) {}
}

function applySeatMap_(rows, seats) {
  if (!seats) return;
  rows.forEach(function (row) {
    if (typeof row.restSeats === "number") return;
    const hallKey = String(row.hall || "").toUpperCase().replace(/\\s+/g, "");
    const hit = seats[row.time + "|" + hallKey] || seats[row.time];
    if (!hit) return;
    row.restSeats = hit.rest;
    if (hit.total != null) row.totalSeats = hit.total;
  });
}

function parseCgvSeatMap_(html) {
  const map = {};
  var hall = "";
  var hallTotal = null;
  String(html || "").split(/<li/i).forEach(function (chunk) {
    const hallM = chunk.match(/(ULTRA\\s*4DX|SCREENX|4DX|IMAX|DOLBY\\s*ATMOS|ATMOS|\\d+\\s*관)/i);
    if (hallM) hall = hallM[1];
    const totM = chunk.match(/총\\s*(\\d+)\\s*석/);
    if (totM) hallTotal = Number(totM[1]);
    const timeM = chunk.match(/\\b([01]?\\d|2[0-3]):([0-5]\\d)\\b/);
    const restM = chunk.match(/잔여좌석[^0-9]{0,12}(\\d+)/) || chunk.match(/>(\\d+)\\s*석</);
    const sold = /(마감|매진)/.test(chunk);
    if (!timeM || (!restM && !sold)) return;
    var time = timeM[1] + ":" + timeM[2];
    if (time.length === 4) time = "0" + time;
    const rec = { rest: restM ? Number(restM[1]) : 0, total: hallTotal };
    map[time] = rec;
    if (hall) map[time + "|" + String(hall).toUpperCase().replace(/\\s+/g, "")] = rec;
  });
  return map;
}

function parseCgvHrefSeats_(html) {
  const map = {};
  String(html || "").split(/href\\s*=/i).forEach(function (chunk) {
    const quoted = chunk.match(/'[^']*'/g);
    if (!quoted || quoted.length < 8) return;
    const vals = quoted.map(function (q) { return q.slice(1, -1); });
    var time = "";
    var hall = "";
    vals.forEach(function (v) {
      if (/^([01]?\\d|2[0-3]):[0-5]\\d$/.test(v)) time = v.length === 4 ? "0" + v : v;
      if (/(ULTRA\\s*4DX|SCREENX|4DX|IMAX|DOLBY\\s*ATMOS|ATMOS|\\d+\\s*관)/i.test(v) && v.length < 40) hall = v;
    });
    var rec = vals.length > 9 ? seatPair_(vals[7], vals[9]) : null;
    if (!rec) {
      for (var i = 0; i < vals.length - 1; i++) {
        rec = seatPair_(vals[i], vals[i + 1]);
        if (rec) break;
      }
    }
    if (!time || !rec) return;
    map[time] = rec;
    if (hall) map[time + "|" + String(hall).toUpperCase().replace(/\\s+/g, "")] = rec;
  });
  return map;
}

function seatPair_(a, b) {
  if (!/^\\d{1,4}$/.test(a) || !/^\\d{1,4}$/.test(b)) return null;
  const rest = Number(a);
  const total = Number(b);
  if (total < 20 || total > 900 || rest < 0 || rest > total) return null;
  return { rest: rest, total: total };
}

function loadSeatmap_() {
  try {
    const cached = CacheService.getScriptCache().get("seatmap");
    if (cached) return JSON.parse(cached);
  } catch (e) {}
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty("seatmap");
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && Object.keys(parsed).length) return parsed;
    } catch (e) {}
  }
  return {};
}

function saveSeatmap_(props, map) {
  const json = JSON.stringify(map || {});
  try { CacheService.getScriptCache().put("seatmap", json, 600); } catch (e) {}
  try {
    props.setProperty("seatmap", json);
    props.setProperty("seatmapAt", String(Date.now()));
  } catch (e) {}
}

function applyBatchSeats_(byId, map) {
  if (!map) return;
  Object.keys(byId).forEach(function (id) {
    const row = byId[id];
    if (!row || typeof row.restSeats === "number") return;
    const hallKey = String(row.hall || "").toUpperCase().replace(/[\\s|]+/g, "");
    const site = String(id).split(":")[1] || "";
    const prefix = String(id).indexOf("megabox:") === 0 ? "m:" : "k:";
    const hit = map[id] ||
      map[prefix + site + "|" + row.date + "|" + row.time + "|" + hallKey] ||
      map[prefix + site + "|" + row.date + "|" + row.time];
    if (!hit || typeof hit.rest !== "number") return;
    row.restSeats = hit.rest;
    if (hit.total != null) row.totalSeats = hit.total;
  });
}

function refreshCgvSeatmap_(props) {
  const reqs = [];
  const meta = [];
  CONFIG.theaters.forEach(function (theaterId) {
    if (String(theaterId).indexOf("cgv_") !== 0) return;
    const site = CGV_SITES_[theaterId];
    if (!site) return;
    kstDates_(scanDays_()).forEach(function (playDate) {
      reqs.push({
        url: "https://api.cgv.co.kr/cnm/atkt/searchMovScnInfo?coCd=A420&siteNo=" + site.siteNo + "&scnYmd=" + playDate + "&rtctlScopCd=08",
        muteHttpExceptions: true,
        followRedirects: true,
        headers: { Accept: "application/json", Referer: "https://cgv.co.kr/", Origin: "https://cgv.co.kr", "User-Agent": "Mozilla/5.0 (Linux; Android 13; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36" },
      });
      meta.push({ siteNo: site.siteNo, playDate: playDate, theaterId: theaterId });
    });
  });
  const map = {};
  const missing = [];
  if (!reqs.length) return map;
  try {
    const resps = UrlFetchApp.fetchAll(reqs);
    resps.forEach(function (res, i) {
      const info = meta[i];
      var got = 0;
      try {
        const json = JSON.parse(res.getContentText());
        const rows = json.data || json.body || [];
        rows.forEach(function (row) {
          const rest = Number(row.frSeatCnt);
          if (!Number.isFinite(rest)) return;
          const rec = { rest: rest, total: Number.isFinite(Number(row.stcnt)) ? Number(row.stcnt) : null };
          var raw = String(row.scnsrtTm || row.startTime || "");
          var time = raw.length === 4 ? raw.slice(0, 2) + ":" + raw.slice(2) : raw;
          if (!time) return;
          const title = normalize_(row.movNm || row.movieName || "");
          if (title) map["k:" + info.siteNo + "|" + info.playDate + "|" + time + "|" + title] = rec;
          if (!map["k:" + info.siteNo + "|" + info.playDate + "|" + time]) {
            map["k:" + info.siteNo + "|" + info.playDate + "|" + time] = rec;
          }
          got += 1;
        });
      } catch (e) {}
      if (!got) missing.push(info);
    });
    if (missing.length) {
      const extraReqs = missing.map(function (info) {
        return {
          url: "https://mcp.aka.page/api/cgv/timetable?playDate=" + info.playDate + "&theaterCode=" + info.siteNo + "&limit=200",
          muteHttpExceptions: true,
          followRedirects: true,
        };
      });
      const extra = UrlFetchApp.fetchAll(extraReqs);
      extra.forEach(function (res, i) {
        const info = missing[i];
        try {
          const json = JSON.parse(res.getContentText());
          const rows = (((json.data) || {}).timetable) || [];
          rows.forEach(function (row) {
            if (typeof row.remainingSeats !== "number") return;
            const rec = { rest: row.remainingSeats, total: typeof row.totalSeats === "number" ? row.totalSeats : null };
            const time = String(row.startTime || "");
            if (!time) return;
            const title = normalize_(row.movieName || "");
            if (title) map["k:" + info.siteNo + "|" + info.playDate + "|" + time + "|" + title] = rec;
            if (row.movieCode) map["k:" + info.siteNo + "|" + info.playDate + "|" + time + "|" + row.movieCode] = rec;
            if (!map["k:" + info.siteNo + "|" + info.playDate + "|" + time]) {
              map["k:" + info.siteNo + "|" + info.playDate + "|" + time] = rec;
            }
          });
        } catch (e2) {}
      });
    }
  } catch (e) {}
  return map;
}

function loadShowcache_() {
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty("showcache");
  const at = Number(props.getProperty("showcacheAt") || 0);
  if (raw && Date.now() - at < 8 * 60 * 1000) {
    try { return JSON.parse(raw); } catch (e) {}
  }
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.length) return parsed;
    } catch (e) {}
  }
  return refreshShowcache_(props);
}

function refreshShowcache_(props) {
  const out = [];
  CONFIG.theaters.forEach(function (theaterId) {
    kstDates_(scanDays_()).forEach(function (playDate) {
      const rows = String(theaterId).indexOf("cgv_") === 0
        ? fetchCgv_(theaterId, playDate)
        : fetchMegabox_(theaterId, playDate);
      rows.forEach(function (row) {
        out.push({
          id: row.id,
          theaterId: theaterId,
          theater: row.theater,
          title: row.title,
          date: row.date,
          time: row.time,
          hall: row.hall,
          formats: row.formats,
          restSeats: row.restSeats,
          totalSeats: row.totalSeats,
          url: row.url,
        });
      });
    });
  });
  props.setProperty("showcache", JSON.stringify(out));
  props.setProperty("showcacheAt", String(Date.now()));
  return out;
}

function theaterIdFromId_(id) {
  const s = String(id || "");
  if (s.indexOf("megabox:1351:") === 0) return "megabox_coex";
  if (s.indexOf("megabox:0019:") === 0) return "megabox_namyangju";
  if (s.indexOf("cgv:0013:") === 0) return "cgv_yongsan";
  if (s.indexOf("cgv:0059:") === 0) return "cgv_yeongdeungpo";
  return "";
}

function fetchCgvApi_(theaterId, playDate) {
  const site = CGV_SITES_[theaterId] || CGV_SITES_.cgv_yongsan;
  const url = "https://api.cgv.co.kr/cnm/atkt/searchMovScnInfo?coCd=A420&siteNo=" + site.siteNo + "&scnYmd=" + playDate + "&rtctlScopCd=08";
  const res = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    followRedirects: true,
    headers: {
      Accept: "application/json",
      "Accept-Language": "ko-KR",
      Referer: "https://cgv.co.kr/",
      Origin: "https://cgv.co.kr",
      "User-Agent": "Mozilla/5.0 (Linux; Android 13; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36",
    },
  });
  const out = [];
  try {
    const json = JSON.parse(res.getContentText());
    const rows = json.data || json.body || [];
    rows.forEach(function (row) {
      const title = decode_(row.movNm || row.movieName || "");
      const hall = row.scrnNm || row.scnNm || row.soundTypNm || row.scnsrtNm || "특별관";
      var raw = String(row.scnsrtTm || row.startTime || "");
      var time = raw.length === 4 ? raw.slice(0, 2) + ":" + raw.slice(2) : raw;
      if (!title || !time) return;
      const rec = cgvRow_(playDate, time, hall, title, "", theaterId, row);
      const rest = Number(row.frSeatCnt);
      const total = Number(row.stcnt);
      if (Number.isFinite(rest)) rec.restSeats = rest;
      if (Number.isFinite(total)) rec.totalSeats = total;
      out.push(rec);
    });
  } catch (e) {}
  return out;
}

function pickField_(obj, keys) {
  if (!obj) return "";
  for (var i = 0; i < keys.length; i++) {
    var v = obj[keys[i]];
    if (v !== undefined && v !== null && String(v).trim()) return String(v).trim();
  }
  return "";
}

function cgvBookUrl_(theaterId, playDate, row, extra) {
  var site = CGV_SITES_[theaterId] || CGV_SITES_.cgv_yongsan;
  var given = String(extra || "");
  var movNo = pickField_(row, ["movNo", "movieNo", "midx", "movieCode", "MOV_NO"]);
  var fromGiven = given.match(/movNo=(\\d+)/);
  if (fromGiven && fromGiven[1]) movNo = movNo || fromGiven[1];
  var scnsNo = padCgv_(pickField_(row, ["scnsNo", "scrnNo", "scnNo", "theabNo", "SCNS_NO"]));
  var fromScr = given.match(/scnsNo=(\\d+)/);
  if (!scnsNo && fromScr) scnsNo = padCgv_(fromScr[1]);
  var sseq = pickField_(row, ["scnSseq", "scnsrtNo", "sseq", "playSseq", "SCN_SSEQ"]);
  var fromSeq = given.match(/scnSseq=(\\d+)/);
  if (!sseq && fromSeq) sseq = fromSeq[1];
  if (given.indexOf("movNo=") >= 0 && given.indexOf("scnsNo=") >= 0 && given.indexOf("scnSseq=") >= 0) return given;
  var siteNm = site.siteNm || site.name.replace(/^CGV\\s*/, "");
  if (!movNo) {
    return "https://cgv.co.kr/cnm/movieBook/cinema?siteNo=" + site.siteNo + "&siteNm=" + encodeURIComponent(siteNm) + "&date=" + playDate;
  }
  var url = "https://cgv.co.kr/cnm/movieBook/movie?movNo=" + movNo + "&scnYmd=" + playDate + "&siteNo=" + site.siteNo + "&siteNm=" + encodeURIComponent(siteNm);
  if (scnsNo) url += "&scnsNo=" + scnsNo;
  if (sseq) url += "&scnSseq=" + sseq;
  return url;
}

function padCgv_(v) {
  var d = String(v || "").replace(/\\D/g, "");
  if (!d) return "";
  while (d.length < 3) d = "0" + d;
  return d;
}

function cgvRow_(playDate, time, hall, title, url, theaterId, row) {
  const site = CGV_SITES_[theaterId] || CGV_SITES_.cgv_yongsan;
  return {
    id: "cgv:" + site.siteNo + ":" + playDate + ":" + time + ":" + hall + ":" + title,
    theater: site.name,
    title: title,
    date: playDate,
    time: time,
    hall: hall,
    formats: cgvFormats_(hall),
    restSeats: null,
    totalSeats: null,
    url: cgvBookUrl_(theaterId, playDate, row, url),
  };
}

function megaFormats_(kind, hall) {
  const k = String(kind || "").toUpperCase();
  const h = String(hall || "").toUpperCase();
  const compact = h.replace(/[\\s|/._-]+/g, "");
  if (k === "DBC" || compact.indexOf("DOLBY") >= 0 || h.indexOf("돌비") >= 0) return ["dolby"];
  if (k === "MX4D" || compact.indexOf("MX4D") >= 0) return ["mx4d"];
  if (k === "LUMINEON" || compact.indexOf("MEGALED") >= 0 || compact.indexOf("LUMINEON") >= 0 || (h.indexOf("메가") >= 0 && compact.indexOf("LED") >= 0) || compact.indexOf("LED") >= 0 && compact.indexOf("MEGA") >= 0) return ["mega_led"];
  return ["other"];
}

function cgvFormats_(hall) {
  const h = String(hall || "").toUpperCase().replace(/\\s+/g, "");
  if (h.indexOf("ULTRA4DX") >= 0) return ["ultra4dx"];
  const out = [];
  if (h.indexOf("SCREENX") >= 0) out.push("screenx");
  if (h.indexOf("4DX") >= 0) out.push("4dx");
  if (h.indexOf("IMAX") >= 0) out.push("imax");
  if (h.indexOf("ATMOS") >= 0) out.push("atmos");
  return out.length ? out : ["other"];
}

function kstDates_(n) {
  const out = [];
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  for (var i = 0; i < n; i++) {
    const d = new Date(kst.getTime() + i * 86400000);
    const y = d.getUTCFullYear();
    const m = ("0" + (d.getUTCMonth() + 1)).slice(-2);
    const day = ("0" + d.getUTCDate()).slice(-2);
    out.push("" + y + m + day);
  }
  return out;
}

function normalize_(s) {
  return String(s || "").replace(/[^0-9A-Za-z가-힣]/g, "").toLowerCase();
}
function titleWatched_(title, watchedTitles) {
  var n = normalize_(title);
  if (!watchedTitles || !watchedTitles.length) return true;
  if (!n) return false;
  for (var i = 0; i < watchedTitles.length; i++) {
    var w = String(watchedTitles[i] || "");
    if (!w) continue;
    if (n === w) return true;
    if (w.length >= 2 && (n.indexOf(w) >= 0 || w.indexOf(n) >= 0)) return true;
  }
  return false;
}

function decode_(s) {
  return String(s || "")
    .split("&#" + "40;").join("(")
    .split("&#" + "41;").join(")")
    .split("&" + "amp;").join("&");
}

function esc_(s) {
  return String(s || "").split('"').join("'");
}
function escHtml_(s) {
  return String(s || "")
    .split("&").join("&" + "amp;")
    .split("<").join("&" + "lt;")
    .split(">").join("&" + "gt;");
}
function escAttr_(s) {
  return String(s || "")
    .split("&").join("&" + "amp;")
    .split('"').join("&" + "quot;")
    .split("<").join("&" + "lt;");
}

function megaboxUrl_(brch, playDate, movieNo, playSchdlNo) {
  if (playSchdlNo) {
    var seat = "https://m.megabox.co.kr/on/oh/ohz/PcntSeatChoi/selectPcntSeatChoi.do?playSchdlNo=" + playSchdlNo + "&brchNo=" + brch + "&playDe=" + playDate;
    if (movieNo) seat += "&movieNo=" + movieNo;
    return seat;
  }
  var url = "https://m.megabox.co.kr/booking?brchNo=" + brch + "&playDe=" + playDate;
  if (movieNo) url += "&movieNo=" + movieNo;
  return url;
}

function setup() { 설치(); }
`;
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
};
