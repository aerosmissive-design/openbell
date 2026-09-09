import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { GAS_OAUTH_MESSAGE, GAS_OAUTH_SCOPES } from "@/lib/cinema/gas-oauth";
import { getGasOauthClient } from "@/lib/cinema/scan";

export const Route = createFileRoute("/gas-oauth")({
  component: GasOauth,
});

function loadGsi(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("구글 로그인 모듈을 불러오지 못했습니다."));
    document.head.appendChild(script);
  });
}

function tokenFromGsi(clientId: string, email: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!window.google?.accounts?.oauth2) {
      reject(new Error("구글 로그인 모듈이 없습니다."));
      return;
    }
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: GAS_OAUTH_SCOPES,
      hint: email || undefined,
      callback: (resp) => {
        if (resp.access_token) {
          resolve(resp.access_token);
          return;
        }
        reject(
          new Error(
            resp.error === "access_denied"
              ? "권한을 허용해야 스크립트를 고칩니다."
              : resp.error_description || resp.error || "권한을 받지 못했습니다.",
          ),
        );
      },
      error_callback: (err) => {
        const raw = `${err.type || ""} ${err.message || ""}`;
        if (/popup_closed|closed/i.test(raw)) {
          reject(new Error("창을 닫았습니다. 다시 눌러 주세요."));
          return;
        }
        reject(new Error("구글 창이 막혔습니다. 이 창에서 다시 눌러 주세요."));
      },
    });
    client.requestAccessToken({ prompt: "select_account" });
  });
}

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

function sendBack(token: string, error = "") {
  const payload = { type: GAS_OAUTH_MESSAGE, token, error };
  if (window.opener && !window.opener.closed) {
    window.opener.postMessage(payload, window.location.origin);
    window.close();
    return;
  }
  sessionStorage.setItem(GAS_OAUTH_MESSAGE, JSON.stringify(payload));
  window.location.replace("/?tab=settings");
}

function GasOauth() {
  const email = new URLSearchParams(window.location.search).get("email") || "";
  const [clientId, setClientId] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const [id] = await Promise.all([getGasOauthClient({ data: {} }), loadGsi()]);
        const client = String(id || "").trim();
        if (!client) {
          setMessage("구글 스크립트용 클라이언트가 없습니다.");
          return;
        }
        setClientId(client);
        setReady(true);
      } catch (err) {
        setMessage(err instanceof Error ? err.message : "구글 창을 준비하지 못했습니다.");
      }
    })();
  }, []);

  function pickAccount() {
    if (!clientId || busy) return;
    setBusy(true);
    setMessage("");
    void tokenFromGsi(clientId, email)
      .then((token) => sendBack(token))
      .catch((err) => {
        setBusy(false);
        setMessage(err instanceof Error ? err.message : "구글 계정을 받지 못했습니다.");
      });
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-bg px-6 text-center">
      <p className="text-sm text-muted">오픈벨에 로그인한 메일로 고르세요.</p>
      {email ? <p className="text-base font-medium text-fg">{email}</p> : null}
      <button
        type="button"
        disabled={!ready || busy}
        onClick={pickAccount}
        className="rounded-full bg-accent px-5 py-3 text-sm font-medium text-accent-fg disabled:opacity-50"
      >
        {busy ? "구글 창을 여는 중" : "구글 계정 선택"}
      </button>
      {message ? <p className="max-w-sm text-sm text-danger">{message}</p> : null}
    </main>
  );
}
