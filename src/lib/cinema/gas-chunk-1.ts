export const C1 = `N);
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
  bases.push("https://openbell-fawn.vercel.app");
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
    muteHttpExceptions: tr`;
