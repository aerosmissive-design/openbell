import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { GAS_OAUTH_MESSAGE, GAS_OAUTH_SCOPES, googleAuthUrl } from "@/lib/cinema/gas-oauth";
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
      reject(new Error("gsi"));
      return;
    }
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: GAS_OAUTH_SCOPES,
      hint: email || undefined,
      callback: (resp) => {
        if (resp.access_token) resolve(resp.access_token);
        else reject(new Error(resp.error_description || resp.error || "권한 없음"));
      },
      error_callback: (err) => reject(new Error(err.message || err.type || "popup")),
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
  const [message, setMessage] = useState("구글 계정을 고르는 창을 엽니다.");

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const token = hash.get("access_token") || "";
    const error = hash.get("error_description") || hash.get("error") || "";
    if (token || error) {
      sendBack(token, error);
      return;
    }
    const email = new URLSearchParams(window.location.search).get("email") || "";
    void (async () => {
      try {
        const clientId = String((await getGasOauthClient({ data: {} })) || "").trim();
        if (!clientId) {
          setMessage("구글 스크립트용 클라이언트가 없습니다.");
          return;
        }
        try {
          await loadGsi();
          sendBack(await tokenFromGsi(clientId, email));
          return;
        } catch {
          window.location.replace(googleAuthUrl(clientId, email));
        }
      } catch (err) {
        setMessage(err instanceof Error ? err.message : "구글 창을 열지 못했습니다.");
      }
    })();
  }, []);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg px-6 text-center text-sm text-muted">
      {message}
    </main>
  );
}
