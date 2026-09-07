import { DEFAULT_FORMATS, THEATERS } from "./theaters";
import type { BookingIntent, WatchConfig } from "./types";
import { DEFAULT_SCAN_SOURCES, normalizeScanSources } from "./types";

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
  const minutes = config.intervalMin <= 1 ? 1 : config.intervalMin <= 5 ? 5 : 10;
  const appUrl =
    typeof window !== "undefined" ? window.location.origin.replace(/\/$/, "") : "";
  return `/**
 * 오픈벨
 *
 * 1) https://script.google.com 에서 예전에 만든 오픈벨 프로젝트 열기
 *    (없으면 새 프로젝트)
 * 2) 코드를 전부 지우고 이 파일 붙여넣기 → 저장
 * 3) 위쪽 함수를 설치 로 고르고 실행 (한 번만)
 *    권한: 검토 → 고급 → 프로젝트로 이동 → 허용
 * 4) 설치 완료 메일이 한 통 오면 끝. 시계(트리거)는 만지지 마세요.
 *
 * 설치가 예전 알림을 지우고 5분마다 감시합니다.
 * 이미 열린 회차는 넘어가고, 새로 열린 n월 n일 n시만 메일로 옵니다.
 */
const CONFIG = {
  email: ${JSON.stringify(email)},
  ranks: ${JSON.stringify(ranks)},
  extraTitles: ${JSON.stringify(extraTitles)},
  theaters: ${JSON.stringify(theaters)},
  formats: ${JSON.stringify(formats)},
  daysAhead: ${JSON.stringify(config.daysAhead)},
  telegramToken: ${JSON.stringify(telegramToken)},
  telegramChatId: ${JSON.stringify(telegramChatId)},
  webhookUrl: ${JSON.stringify(webhookUrl)},
  kakaoRestKey: ${JSON.stringify(kakaoRestKey)},
  kakaoRefreshToken: ${JSON.stringify(kakaoRefreshToken)},
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
    };
    ["email","ranks","extraTitles","theaters","formats","daysAhead","telegramToken","telegramChatId","webhookUrl","kakaoRestKey","kakaoRefreshToken","scanSources","queued","syncKey"].forEach(function (k) {
      if (extra[k] === undefined || extra[k] === null) return;
      if (secrets[k] && !String(extra[k]).trim()) return;
      CONFIG[k] = extra[k];
    });
  } catch (e) {}
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function 설치() {
  applyLiveConfig_();
  if (CONFIG.syncKey) {
    PropertiesService.getScriptProperties().setProperty("syncKey", CONFIG.syncKey);
  }
  ScriptApp.getProjectTriggers().forEach(function (t) {
    ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("checkOpenSeats")
    .timeBased()
    .everyMinutes(${minutes})
    .create();
  var report = { names: [], found: 0, error: "", cgvFound: 0, cgvErr: "" };
  try {
    report = scan_(true);
  } catch (e) {
    report.error = String(e);
  }
  const names = (report.names || []).join(", ") || "없음";
  const body = report.error
    ? "설치는 됐지만 시간표 조회가 실패했습니다. " + report.error
    : "지금부터 ${minutes}분마다 감시합니다.\\n알림 영화: " + names + "\\n이미 열린 회차 " + report.found + "건은 넘어갑니다.\\n용산 CGV " + (report.cgvFound || 0) + "건 확인" + (report.cgvFound ? "" : (report.cgvErr ? " (" + report.cgvErr + ")" : "")) + ".\\n앞으로 새 날짜·새 시간이 열리면 메일·텔레그램으로 알려드립니다.";
  notify_("[오픈벨] 설치 완료", body, [{
    title: "오픈벨",
    theater: "설치 완료",
    hall: "",
    date: "",
    time: "",
    url: CONFIG.appUrl || "https://www.megabox.co.kr/booking",
  }]);
}

function checkOpenSeats() {
  applyLiveConfig_();
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
  CONFIG.theaters.forEach(function (theaterId) {
    kstDates_(CONFIG.daysAhead).forEach(function (playDate) {
      const rows = theaterId.indexOf("cgv_") === 0
        ? fetchCgv_(theaterId, playDate)
        : fetchMegabox_(theaterId, playDate);
      if (theaterId.indexOf("cgv_") === 0) cgvFound += rows.length;
      rows.forEach(function (row) {
        byId[row.id] = row;
        if (watchedTitles.length && watchedTitles.indexOf(normalize_(row.title)) < 0) return;
        const allowed = CONFIG.formats[theaterId] || [];
        if (allowed.length && !row.formats.some(function (f) { return allowed.indexOf(f) >= 0; })) return;
        found += 1;
        if (seen[row.id]) return;
        seen[row.id] = true;
        if (!primeOnly && primed) alerts.push(row);
      });
    });
  });
  (CONFIG.queued || []).forEach(function (q) {
    const row = byId[q.id];
    if (!row || typeof row.restSeats !== "number") return;
    const last = qseats[q.id];
    if (!primeOnly && typeof last === "number" && row.restSeats > last) {
      seatAlerts.push({
        title: (q.title || row.title) + " 좌석 +" + (row.restSeats - last),
        theater: row.theater,
        hall: row.hall,
        date: row.date,
        time: row.time,
        url: q.url || row.url,
        restSeats: row.restSeats,
        delta: row.restSeats - last,
      });
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
    return ContentService.createTextOutput("ok");
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
    return ContentService.createTextOutput(JSON.stringify(loadShowcache_()))
      .setMimeType(ContentService.MimeType.JSON);
  }
  if (op === "pack") {
    return ContentService.createTextOutput(JSON.stringify({
      shows: loadShowcache_(),
      seats: loadSeatmap_(),
    })).setMimeType(ContentService.MimeType.JSON);
  }
  if (op === "sync") return handleSync_(e);
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
    });
  }
  return ContentService.createTextOutput("openbell");
}

function doPost(e) {
  var p = (e && e.parameter) || {};
  if (p.op === "sync") return handleSync_(e);
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
    ["email","telegramToken","telegramChatId","webhookUrl","kakaoRestKey","kakaoRefreshToken"].forEach(function (k) {
      if (!body.config[k] && (prev[k] || CONFIG[k])) {
        body.config[k] = prev[k] || CONFIG[k];
      }
    });
    props.setProperty("liveConfig", JSON.stringify(body.config));
    applyLiveConfig_();
  }
  return jsonOut_({ ok: true });
}

function notify_(subject, body, alerts) {
  const html = buildMailHtml_(subject, body, alerts);
  if (CONFIG.email) {
    try {
      GmailApp.sendEmail(CONFIG.email, subject, body, { htmlBody: html, name: "오픈벨" });
    } catch (e) {
      Logger.log("mail " + String(e));
    }
  }
  sendTelegram_(subject, body, alerts);
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
  try { sendKakao_(subject, alerts); } catch (e) { Logger.log("kakao " + String(e)); }
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
  var text = String(subject || "");
  var keys = [];
  if (items.length) {
    items.forEach(function (a, i) {
      if (i < 12) text += "\\n\\n" + alertLine_(a);
      if (a.url && keys.length < 20) {
        var label = items.length === 1 ? "바로 예매" : buttonLabel_(a);
        keys.push([{ text: label, url: String(a.url) }]);
      }
    });
    if (items.length > 12) text += "\\n\\n외 " + (items.length - 12) + "건";
  } else {
    text += "\\n\\n" + stripMailUrls_(body);
  }
  var payload = {
    chat_id: chatId,
    text: text.substring(0, 3500),
    disable_web_page_preview: true,
  };
  if (keys.length) payload.reply_markup = { inline_keyboard: keys };
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
}

function alertLine_(a) {
  var bits = [];
  if (a.title) bits.push(a.title);
  var meta = [a.theater, a.hall, a.date, a.time].filter(Boolean).join(" · ");
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
    const meta = [a.theater, a.hall, a.date, a.time].filter(Boolean).join(" · ");
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
    "<p style='margin:16px 0 0;color:#888;font-size:12px'>오픈벨 · 새로 열린 회차만 보냅니다.</p></div>";
}

function sendKakao_(subject, alerts) {
  if (!CONFIG.kakaoRestKey || !CONFIG.kakaoRefreshToken) return;
  const first = (alerts && alerts[0]) || {};
  const text = (first.title
    ? "[오픈벨] " + first.title + "\\n" + [first.theater, first.hall, first.date, first.time].filter(Boolean).join(" · ")
    : subject).substring(0, 200);
  const rawLink = first.url || "https://www.megabox.co.kr/booking";
  const link = CONFIG.appUrl
    ? CONFIG.appUrl + "/go?u=" + encodeURIComponent(rawLink)
    : rawLink;
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
  cgv_yongsan: { placeId: "12298207", siteNo: "0013", name: "CGV 용산아이파크몰", book: "https://cgv.co.kr/cnm/movieBook?siteNo=0013" },
  cgv_yeongdeungpo: { placeId: "13141635", siteNo: "0059", name: "CGV 영등포", book: "https://cgv.co.kr/cnm/movieBook?siteNo=0059" },
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
        if (!formats.length || (formats.length === 1 && formats[0] === "other")) continue;
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
          "https://cgv.co.kr/cnm/movieBook?siteNo=0013&date=" + date,
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
    kstDates_(Math.min(CONFIG.daysAhead || 7, 7)).forEach(function (playDate) {
      reqs.push({
        url: "https://mcp.aka.page/api/cgv/timetable?playDate=" + playDate + "&theaterCode=" + site.siteNo + "&limit=200",
        muteHttpExceptions: true,
        followRedirects: true,
      });
      meta.push({ siteNo: site.siteNo, playDate: playDate });
    });
  });
  const map = {};
  if (!reqs.length) return map;
  try {
    const resps = UrlFetchApp.fetchAll(reqs);
    resps.forEach(function (res, i) {
      const info = meta[i];
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
      } catch (e) {}
    });
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
    kstDates_(Math.min(CONFIG.daysAhead || 7, 7)).forEach(function (playDate) {
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
      const rec = cgvRow_(playDate, time, hall, title, "", theaterId);
      const rest = Number(row.frSeatCnt);
      const total = Number(row.stcnt);
      if (Number.isFinite(rest)) rec.restSeats = rest;
      if (Number.isFinite(total)) rec.totalSeats = total;
      out.push(rec);
    });
  } catch (e) {}
  return out;
}

function cgvRow_(playDate, time, hall, title, url, theaterId) {
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
    url: url || (site.book + "&date=" + playDate),
  };
}

function megaFormats_(kind, hall) {
  const k = String(kind || "").toUpperCase();
  const h = String(hall || "").toUpperCase();
  if (k === "DBC" || h.indexOf("DOLBY") >= 0) return ["dolby"];
  if (k === "MX4D" || h.indexOf("MX4D") >= 0) return ["mx4d"];
  if (k === "LUMINEON" || h.indexOf("LED") >= 0) return ["mega_led"];
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

function decode_(s) {
  return String(s || "")
    .split("&#" + "40;").join("(")
    .split("&#" + "41;").join(")")
    .split("&" + "amp;").join("&");
}

function esc_(s) {
  return String(s || "").split('"').join("'");
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
  ranks: [1, 2, 3],
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
  daysAhead: 7,
  browserNotify: true,
  telegramToken: "",
  telegramChatId: "",
  webhookUrl: "",
  email: "",
  emailNotify: false,
  gmailAppPassword: "",
  kakaoRestKey: "",
  kakaoRefreshToken: "",
  gasWebUrl: "",
  gasSyncKey: "",
  scanSources: { ...DEFAULT_SCAN_SOURCES },
  theme: "dark",
};
