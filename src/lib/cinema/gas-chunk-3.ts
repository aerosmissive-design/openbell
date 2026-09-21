export const C3 = `()); } catch (err) {}
  if (listed.getResponseCode() !== 200) {
    WEBAPP_ERR_ = apiErr_(listed, "deploy list fail");
    return "";
  }
  var deployments = (json.deployments || []);
  var entry = "";
  for (var d = 0; d < deployments.length; d++) {
    var eps = (deployments[d].entryPoints || []);
    for (var e = 0; e < eps.length; e++) {
      if (eps[e].entryPointType === "WEB_APP" && eps[e].webApp && eps[e].webApp.url) {
        entry = eps[e].webApp.url;
        break;
      }
    }
    if (entry) break;
  }
  if (entry) return entry;
  var create = UrlFetchApp.fetch("https://script.googleapis.com/v1/projects/" + id + "/deployments", {
    method: "post",
    headers: headers,
    contentType: "application/json",
    payload: JSON.stringify({
      versionNumber: 1,
      description: "openbell-web",
      entryPoints: [{
        entryPointType: "WEB_APP",
        webApp: { executeAs: "USER_DEPLOYING", access: "ANYONE_ANONYMOUS" },
      }],
    }),
    muteHttpExceptions: true,
  });
  if (create.getResponseCode() >= 300) {
    WEBAPP_ERR_ = apiErr_(create, "deploy create fail");
    return "";
  }
  var created = {};
  try { created = JSON.parse(create.getContentText()); } catch (e3) {}
  var eps3 = (created.entryPoints || []);
      for (va`;
