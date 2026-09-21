export const C2 = `ue
  });
  if (current.getResponseCode() !== 200) {
    WEBAPP_ERR_ = apiErr_(current, "content get fail");
    return false;
  }
  var data = JSON.parse(current.getContentText());
  var files = data.files || [];
  var found = false;
  for (var i = 0; i < files.length; i++) {
    if (files[i].name === "appsscript") {
      files[i].source = GAS_MANIFEST;
      found = true;
      break;
    }
  }
  if (!found) files.push({ name: "appsscript", type: "JSON", source: GAS_MANIFEST });
  var put = UrlFetchApp.fetch("https://script.googleapis.com/v1/projects/" + id + "/content", {
    method: "put",
    headers: headers,
    contentType: "application/json",
    payload: JSON.stringify({ files: files }),
    muteHttpExceptions: true,
  });
  if (put.getResponseCode() !== 200) {
    WEBAPP_ERR_ = apiErr_(put, "content put fail");
    return false;
  }
  return true;
}

function ensureWebApp_() {
  WEBAPP_ERR_ = "";
  try {
    var existing = ScriptApp.getService().getUrl();
    if (existing) return existing;
  } catch (e0) {}
  writeManifest_();
  var id = ScriptApp.getScriptId();
  var headers = scriptApiHeaders_();
  var listed = UrlFetchApp.fetch("https://script.googleapis.com/v1/projects/" + id + "/deployments", {
    headers: headers,
    muteHttpExceptions: true,
  });
  var json = {};
  try { json = JSON.parse(listed.getContentText`;
