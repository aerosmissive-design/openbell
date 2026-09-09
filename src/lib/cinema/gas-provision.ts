import { buildGasScript } from "./gas-script";
import { pullGasMeta, upgradeExistingGas } from "./cloud";
import { claimGasBind, getGasOauthClient, provisionGasScript } from "./scan";
import { useAppStore } from "@/lib/store";

const SCOPES = [
  "https://www.googleapis.com/auth/script.projects",
  "https://www.googleapis.com/auth/script.deployments",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
].join(" ");

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            hint?: string;
            callback: (resp: {
              access_token?: string;
              error?: string;
              error_description?: string;
            }) => void;
            error_callback?: (err: { type?: string; message?: string }) => void;
          }) => { requestAccessToken: (opts?: { prompt?: string }) => void };
        };
      };
    };
  }
}

function loadGsi(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(
      'script[src="https://accounts.google.com/gsi/client"]',
    );
    if (existing) {
      if (window.google?.accounts?.oauth2) {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () =>
        reject(new Error("구글 로그인 모듈을 불러오지 못했습니다.")),
      );
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error("구글 로그인 모듈을 불러오지 못했습니다."));
    document.head.appendChild(script);
  });
}

function googleAuthError(err: { type?: string; message?: string } | Error | string) {
  const raw =
    typeof err === "string"
      ? err
      : `${(err as { type?: string }).type || ""} ${(err as Error).message || ""}`;
  if (/popup_failed|popup window|Failed to open popup/i.test(raw)) {
    return "구글 창이 막혔습니다. 설정 화면을 연 뒤 버튼을 바로 다시 눌러 주세요. 팝업이 막혀 있으면 주소창에서 허용하세요.";
  }
  if (/popup_closed|closed/i.test(raw)) {
    return "구글 창을 닫았습니다. 다시 눌러 주세요.";
  }
  if (err instanceof Error && err.message) return err.message;
  return "구글 권한을 받지 못했습니다.";
}

function requestGoogleToken(
  clientId: string,
  prompt?: string,
  email?: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!window.google?.accounts?.oauth2) {
      reject(new Error("구글 로그인 모듈이 없습니다. 잠시 후 다시 눌러 주세요."));
      return;
    }
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      hint: String(email || "").trim() || undefined,
      callback: (resp) => {
        if (resp.access_token) {
          resolve(resp.access_token);
          return;
        }
        reject(
          new Error(
            resp.error === "access_denied"
              ? "구글 권한을 허용해야 스크립트를 만듭니다."
              : googleAuthError(resp.error_description || resp.error || ""),
          ),
        );
      },
      error_callback: (err) => {
        reject(new Error(googleAuthError(err)));
      },
    });
    client.requestAccessToken(prompt ? { prompt } : {});
  });
}

let gsiPreload: Promise<void> | null = null;
let cachedOauthClientId = "";

export function preloadGasOauth() {
  if (!gsiPreload) gsiPreload = loadGsi().catch(() => {});
  void peekGasOauthClient()
    .then((id) => {
      cachedOauthClientId = id;
    })
    .catch(() => {});
  return gsiPreload;
}

export function googleTokenFromClick(email?: string): Promise<string> {
  const clientId = cachedOauthClientId;
  if (!clientId || !window.google?.accounts?.oauth2) {
    void preloadGasOauth();
    return Promise.reject(
      new Error("구글 창 준비가 끝나지 않았습니다. 한 번만 더 눌러 주세요."),
    );
  }
  return requestGoogleToken(clientId, undefined, email);
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
  const token =
    accessToken ||
    (await (async () => {
      const clientId = cachedOauthClientId || (await peekGasOauthClient());
      if (!clientId) return "";
      await loadGsi();
      return requestGoogleToken(clientId, undefined, email);
    })());
  if (!token) return null;
  const mine = useAppStore.getState().config.gasScriptId.trim();
  const targetId = createNew ? undefined : scriptId || mine || undefined;
  const result = await provisionGasScript({
    data: {
      accessToken: token,
      source: currentGasScript(),
      scriptId: targetId,
      createNew,
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

export async function refreshGasMeta(url: string) {
  const meta = await pullGasMeta({ data: { url } });
  if (meta.status !== "ok") return "";
  if (meta.scriptId) saveGasTarget(meta.url || url, meta.scriptId);
  return meta.scriptId;
}

function withGoogleAccount(target: string, email?: string) {
  const mail = String(email || "").trim();
  if (!mail) return target;
  return (
    "https://accounts.google.com/AccountChooser?Email=" +
    encodeURIComponent(mail) +
    "&continue=" +
    encodeURIComponent(target)
  );
}

export function existingScriptEditorUrl(scriptId: string, email?: string) {
  return withGoogleAccount(
    `https://script.google.com/home/projects/${encodeURIComponent(scriptId)}/edit`,
    email,
  );
}

export function gasHomeUrl(email?: string) {
  return withGoogleAccount("https://script.google.com/home", email);
}

export async function connectedEditorUrl(email?: string) {
  const { gasWebUrl, gasScriptId } = useAppStore.getState().config;
  const url = gasWebUrl.trim();
  if (url) {
    const id = await refreshGasMeta(url);
    if (id) return existingScriptEditorUrl(id, email);
  }
  if (gasScriptId.trim()) return existingScriptEditorUrl(gasScriptId.trim(), email);
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
  const store = useAppStore.getState();
  const url = store.config.gasWebUrl.trim();

  if (!url) {
    const created = await oauthSync(true, undefined, email, accessToken);
    if (created) {
      return {
        mode: "oauth",
        created: true,
        installUrl: created.installUrl,
        scriptId: created.scriptId,
      };
    }
    return { mode: "wizard" };
  }

  const liveId = (await refreshGasMeta(url)) || store.config.gasScriptId.trim();
  if (liveId) {
    try {
      const updated = await oauthSync(false, liveId, email, accessToken);
      if (updated) {
        return {
          mode: "oauth",
          created: false,
          installUrl: updated.installUrl,
          scriptId: updated.scriptId || liveId,
        };
      }
    } catch {
      // 웹앱으로 이어서 고칩니다.
    }
  }

  const pushed = await upgradeExistingGas({
    data: { url, key: ensureGasSyncKey(), source: currentGasScript() },
  });
  if (pushed.status === "ok") return { mode: "upgrade" };

  if (liveId) {
    return { mode: "editor", editorUrl: existingScriptEditorUrl(liveId) };
  }
  throw new Error("연결된 스크립트를 찾지 못했습니다. 새 프로젝트는 만들지 않았습니다.");
}
