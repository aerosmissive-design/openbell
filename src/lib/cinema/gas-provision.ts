import { buildGasScript } from "./gas-script";
import { pullGasMeta, upgradeExistingGas } from "./cloud";
import { claimGasBind, getGasOauthClient, provisionGasScript } from "./scan";
import { GAS_OAUTH_MESSAGE, gasOauthStartPath } from "./gas-oauth";
import { useAppStore } from "@/lib/store";

let cachedOauthClientId = "";
let gasOauthPopup: Window | null = null;

export function preloadGasOauth() {
  void peekGasOauthClient()
    .then((id) => {
      cachedOauthClientId = id;
    })
    .catch(() => {});
}

export function peekCachedOauthClient() {
  return cachedOauthClientId;
}

export function googleTokenFromClick(email?: string): Promise<string> {
  const start = gasOauthStartPath(email);
  const popup = window.open(start, "openbell-gas-oauth", "popup=yes,width=520,height=740");
  gasOauthPopup = popup && !popup.closed ? popup : null;
  if (!popup) {
    window.location.assign(start);
    return new Promise(() => {});
  }
  return new Promise((resolve, reject) => {
    const timer = window.setInterval(() => {
      if (popup.closed) {
        cleanup();
        reject(new Error("구글 창을 닫았습니다. 다시 눌러 주세요."));
      }
    }, 400);
    function onMsg(ev: MessageEvent) {
      if (ev.origin !== window.location.origin) return;
      if (!ev.data || ev.data.type !== GAS_OAUTH_MESSAGE) return;
      cleanup();
      if (ev.data.token) {
        resolve(String(ev.data.token));
        return;
      }
      reject(new Error(String(ev.data.error || "구글 권한을 받지 못했습니다.")));
    }
    function cleanup() {
      window.clearInterval(timer);
      window.removeEventListener("message", onMsg);
    }
    window.addEventListener("message", onMsg);
  });
}

export function takeStoredGasOauthToken() {
  try {
    const raw = sessionStorage.getItem(GAS_OAUTH_MESSAGE);
    if (!raw) return "";
    sessionStorage.removeItem(GAS_OAUTH_MESSAGE);
    const parsed = JSON.parse(raw) as { token?: string };
    return String(parsed.token || "");
  } catch {
    return "";
  }
}

export function openOwnedScript(scriptId: string) {
  const url = existingScriptEditorUrl(scriptId);
  if (gasOauthPopup && !gasOauthPopup.closed) {
    try {
      gasOauthPopup.location.href = url;
      gasOauthPopup.focus();
      return true;
    } catch {
      // fall through
    }
  }
  const next = window.open(url, "openbell-gas-oauth");
  return Boolean(next);
}

export function ensureGasSyncKey() {
  const store = useAppStore.getState();
  let syncKey = store.config.gasSyncKey;
  if (!syncKey) {
    syncKey = crypto.randomUUID();
    store.setConfig({ gasSyncKey: syncKey });
  }
  return syncKey;
}

export function currentGasScript() {
  ensureGasSyncKey();
  return buildGasScript(useAppStore.getState().config, useAppStore.getState().queue);
}

export function gasWatchFingerprint() {
  const { config, queue } = useAppStore.getState();
  return JSON.stringify({
    intervalMin: config.intervalMin,
    daysAhead: config.daysAhead,
    ranks: config.ranks,
    theaters: config.theaters,
    formats: config.formats,
    watchTitles: config.watchTitles,
    email: config.email,
    emailNotify: config.emailNotify,
    telegramToken: config.telegramToken,
    telegramChatId: config.telegramChatId,
    kakaoRestKey: config.kakaoRestKey,
    kakaoRefreshToken: config.kakaoRefreshToken,
    webhookUrl: config.webhookUrl,
    xApiKey: config.xApiKey,
    xApiSecret: config.xApiSecret,
    xAccessToken: config.xAccessToken,
    xAccessSecret: config.xAccessSecret,
    xClientId: config.xClientId,
    xClientSecret: config.xClientSecret,
    xRefreshToken: config.xRefreshToken,
    gasWebUrl: config.gasWebUrl,
    gasSyncKey: config.gasSyncKey,
    queued: queue.map((item) => item.showtimeId),
  });
}

export async function pushLinkedGasSource() {
  const { gasWebUrl, gasSyncKey } = useAppStore.getState().config;
  const url = gasWebUrl.trim();
  const key = gasSyncKey.trim();
  if (!url || !key) return { status: "skipped" as const, reason: "no-url" };
  return upgradeExistingGas({
    data: { url, key, source: currentGasScript() },
  });
}

export function gasIsLinked() {
  const { gasWebUrl, gasScriptId } = useAppStore.getState().config;
  return Boolean(gasWebUrl.trim() || gasScriptId.trim());
}

const LAST_SCRIPT_ID_KEY = "openbell-last-gas-id";

function lastScriptStorageKey(ownerId?: string | null) {
  const id = String(ownerId || useAppStore.getState().ownerId || "").trim();
  return id ? `${LAST_SCRIPT_ID_KEY}:${id}` : "";
}

function rememberLastScriptId(scriptId: string) {
  const id = String(scriptId || "").trim();
  const key = lastScriptStorageKey();
  if (!id || !key || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, id);
    localStorage.removeItem(LAST_SCRIPT_ID_KEY);
  } catch {
    // ignore
  }
}

export function forgetGasLink() {
  useAppStore.getState().setConfig({ gasWebUrl: "", gasScriptId: "", gasSyncKey: "" });
  const key = lastScriptStorageKey();
  try {
    if (key) localStorage.removeItem(key);
    localStorage.removeItem(LAST_SCRIPT_ID_KEY);
  } catch {
    // ignore
  }
}

export function lastKnownScriptId() {
  const fromConfig = useAppStore.getState().config.gasScriptId.trim();
  if (fromConfig) return fromConfig;
  const key = lastScriptStorageKey();
  if (!key) return "";
  try {
    return String(localStorage.getItem(key) || "").trim();
  } catch {
    return "";
  }
}

function saveGasTarget(url: string, scriptId: string) {
  const prev = useAppStore.getState().config;
  useAppStore.getState().setConfig({
    gasWebUrl: url || prev.gasWebUrl,
    gasScriptId: scriptId || prev.gasScriptId,
  });
  rememberLastScriptId(scriptId || prev.gasScriptId);
}

export async function peekGasOauthClient() {
  return String((await getGasOauthClient({ data: {} })) || "").trim();
}

async function oauthSync(
  createNew: boolean,
  scriptId?: string,
  email?: string,
  accessToken?: string,
) {
  const token = String(accessToken || "").trim();
  if (!token) return null;
  const result = await provisionGasScript({
    data: {
      accessToken: token,
      source: currentGasScript(),
      scriptId: createNew ? undefined : scriptId,
      createNew,
      expectedEmail: email || undefined,
    },
  });
  saveGasTarget(result.url, result.scriptId);
  const installUrl = `${result.url}${result.url.includes("?") ? "&" : "?"}op=install`;
  return { url: result.url, scriptId: result.scriptId, installUrl };
}

export async function waitForGasBind(
  syncKey: string,
  signal: AbortSignal,
  sinceMs?: number,
  email?: string,
) {
  while (!signal.aborted) {
    const hit = await claimGasBind({
      data: { key: syncKey, email: email || undefined },
    });
    if (hit.status === "ok" && (hit.url || hit.scriptId)) {
      const created = Date.parse(String(hit.createdAt || ""));
      if (!sinceMs || (Number.isFinite(created) && created >= sinceMs - 5000)) {
        saveGasTarget(hit.url, hit.scriptId);
        return hit;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error("취소했습니다.");
}

export async function refreshGasMeta(url: string, email?: string) {
  const meta = await pullGasMeta({ data: { url } });
  if (meta.status !== "ok") return "";
  const owner = String(meta.email || "").trim().toLowerCase();
  const want = String(email || "").trim().toLowerCase();
  if (want && owner && owner !== want) return "";
  if (meta.scriptId) saveGasTarget(meta.url || url, meta.scriptId);
  return meta.scriptId;
}

export function existingScriptEditorUrl(scriptId: string, _email?: string) {
  return `https://script.google.com/home/projects/${encodeURIComponent(scriptId)}/edit`;
}

export function gasHomeUrl(email?: string) {
  const mail = String(email || "").trim();
  const home = "https://script.google.com/home";
  if (!mail) return home;
  return (
    "https://accounts.google.com/AccountChooser?Email=" +
    encodeURIComponent(mail) +
    "&continue=" +
    encodeURIComponent(home)
  );
}

export async function connectedEditorUrl(email?: string) {
  const { gasScriptId } = useAppStore.getState().config;
  if (gasScriptId.trim()) return existingScriptEditorUrl(gasScriptId.trim());
  return gasHomeUrl(email);
}

export async function attachInstalledScript(email?: string) {
  const key = ensureGasSyncKey();
  const hit = await claimGasBind({
    data: { key, email: email || undefined },
  });
  if (hit.status !== "ok" || (!hit.url && !hit.scriptId)) return null;
  saveGasTarget(hit.url, hit.scriptId);
  return hit;
}

export async function syncGasScript(
  email?: string,
  accessToken?: string,
): Promise<
  | { mode: "oauth"; created: boolean; installUrl: string; scriptId: string }
  | { mode: "upgrade" }
  | { mode: "wizard" }
  | { mode: "editor"; editorUrl: string }
> {
  ensureGasSyncKey();
  const mail = String(email || "").trim().toLowerCase();
  if (accessToken) {
    const before = useAppStore.getState().config.gasScriptId.trim();
    const result = await oauthSync(true, undefined, mail, accessToken);
    if (result) {
      return {
        mode: "oauth",
        created: !before,
        installUrl: result.installUrl,
        scriptId: result.scriptId,
      };
    }
  }

  const url = useAppStore.getState().config.gasWebUrl.trim();
  if (url && mail) {
    const meta = await pullGasMeta({ data: { url } });
    const owner = String(meta.status === "ok" ? meta.email || "" : "").toLowerCase();
    if (owner && owner !== mail) {
      forgetGasLink();
      return { mode: "wizard" };
    }
    if (meta.status === "ok") {
      const pushed = await upgradeExistingGas({
        data: { url, key: ensureGasSyncKey(), source: currentGasScript() },
      });
      if (pushed.status === "ok") return { mode: "upgrade" };
    }
  }
  return { mode: "wizard" };
}
