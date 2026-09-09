import { buildGasManifest } from "./gas-script";

type GoogleErr = { error?: { message?: string; status?: string; code?: number } };

async function gfetch<T>(
  token: string,
  url: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  let json: T & GoogleErr = {} as T & GoogleErr;
  try {
    json = JSON.parse(text) as T & GoogleErr;
  } catch {
    if (!res.ok) throw new Error(koreanGasError(text, res.status));
    throw new Error("구글 응답을 읽지 못했습니다.");
  }
  if (!res.ok) {
    throw new Error(koreanGasError(json.error?.message || text, res.status));
  }
  return json;
}

function koreanGasError(message: string, status: number) {
  const m = String(message || "").toLowerCase();
  if (status === 401 || m.includes("unauthenticated") || m.includes("invalid credentials")) {
    return "구글 권한이 만료됐습니다. 다시 눌러 주세요.";
  }
  if (
    m.includes("apps script api has not been used") ||
    m.includes("access not configured") ||
    m.includes("it is disabled") ||
    m.includes("usersettings")
  ) {
    return "구글 계정에서 앱스 스크립트 API가 꺼져 있습니다. 열리는 설정에서 켜고 다시 눌러 주세요.";
  }
  if (m.includes("insufficient") || m.includes("permission") || status === 403) {
    return "스크립트 권한이 부족합니다. 허용 화면에서 모두 체크해 주세요.";
  }
  return message.slice(0, 180) || "구글 스크립트를 만들지 못했습니다.";
}

function webAppUrl(deployment: {
  entryPoints?: Array<{
    entryPointType?: string;
    webApp?: { url?: string };
  }>;
}): string {
  const hit = (deployment.entryPoints ?? []).find(
    (p) => p.entryPointType === "WEB_APP" && p.webApp?.url,
  );
  return String(hit?.webApp?.url ?? "").replace(/\/dev$/, "/exec");
}

async function googleTokenEmail(token: string) {
  try {
    const info = await gfetch<{ email?: string }>(
      token,
      "https://www.googleapis.com/oauth2/v2/userinfo",
    );
    return String(info.email || "").trim().toLowerCase();
  } catch {
    return "";
  }
}

async function listOwnedOpenbellIds(token: string): Promise<string[]> {
  const q = encodeURIComponent(
    "mimeType='application/vnd.google-apps.script' and trashed=false and 'me' in owners",
  );
  try {
    const listed = await gfetch<{
      files?: Array<{ id?: string; name?: string; modifiedTime?: string }>;
    }>(
      token,
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc&pageSize=20`,
    );
    return (listed.files ?? [])
      .filter((f) => String(f.name || "").includes("오픈벨") && f.id)
      .map((f) => String(f.id));
  } catch {
    return [];
  }
}

async function resolveOwnedScriptId(
  token: string,
  preferred: string,
  _createNew: boolean,
) {
  const owned = await listOwnedOpenbellIds(token);
  if (preferred && owned.includes(preferred)) return preferred;
  if (owned[0]) return owned[0];
  if (preferred) {
    try {
      const meta = await gfetch<{ ownedByMe?: boolean }>(
        token,
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(preferred)}?fields=id,ownedByMe`,
      );
      if (meta.ownedByMe) return preferred;
    } catch {
      // 다른 계정 스크립트입니다.
    }
  }
  return "";
}

export async function provisionGasProject(input: {
  accessToken: string;
  source: string;
  scriptId?: string;
  createNew?: boolean;
  expectedEmail?: string;
}): Promise<{ url: string; scriptId: string }> {
  const token = input.accessToken.trim();
  if (!token) throw new Error("구글 권한이 없습니다.");
  const tokenEmail = await googleTokenEmail(token);
  const expected = String(input.expectedEmail || "").trim().toLowerCase();
  if (expected && tokenEmail && tokenEmail !== expected) {
    throw new Error(
      `구글 창에서 ${expected}를 고르세요. 지금은 ${tokenEmail}로 열렸습니다.`,
    );
  }
  let scriptId = await resolveOwnedScriptId(
    token,
    input.scriptId?.trim() ?? "",
    Boolean(input.createNew),
  );
  if (!scriptId && input.createNew) {
    const created = await gfetch<{ scriptId?: string }>(
      token,
      "https://script.googleapis.com/v1/projects",
      {
        method: "POST",
        body: JSON.stringify({ title: "오픈벨" }),
      },
    );
    scriptId = String(created.scriptId ?? "");
  }
  if (!scriptId) {
    throw new Error("이 구글 계정의 오픈벨 스크립트를 찾지 못했습니다.");
  }

  await gfetch(token, `https://script.googleapis.com/v1/projects/${scriptId}/content`, {
    method: "PUT",
    body: JSON.stringify({
      files: [
        { name: "appsscript", type: "JSON", source: buildGasManifest() },
        { name: "Code", type: "SERVER_JS", source: input.source },
      ],
    }),
  });

  const version = await gfetch<{ versionNumber?: number }>(
    token,
    `https://script.googleapis.com/v1/projects/${scriptId}/versions`,
    {
      method: "POST",
      body: JSON.stringify({ description: "openbell" }),
    },
  );
  const versionNumber = Number(version.versionNumber || 1);

  const listed = await gfetch<{
    deployments?: Array<{
      deploymentId?: string;
      entryPoints?: Array<{ entryPointType?: string; webApp?: { url?: string } }>;
    }>;
  }>(token, `https://script.googleapis.com/v1/projects/${scriptId}/deployments`);
  const existing = (listed.deployments ?? []).find((d) => webAppUrl(d));

  let url = "";
  if (existing?.deploymentId) {
    const updated = await gfetch<{
      entryPoints?: Array<{ entryPointType?: string; webApp?: { url?: string } }>;
    }>(
      token,
      `https://script.googleapis.com/v1/projects/${scriptId}/deployments/${existing.deploymentId}?updateMask=deploymentConfig`,
      {
        method: "PATCH",
        body: JSON.stringify({
          deploymentConfig: {
            scriptId,
            versionNumber,
            manifestFileName: "appsscript",
            description: "openbell web",
          },
        }),
      },
    );
    url = webAppUrl(updated) || webAppUrl(existing);
  } else {
    const created = await gfetch<{
      entryPoints?: Array<{ entryPointType?: string; webApp?: { url?: string } }>;
    }>(token, `https://script.googleapis.com/v1/projects/${scriptId}/deployments`, {
      method: "POST",
      body: JSON.stringify({
        versionNumber,
        manifestFileName: "appsscript",
        description: "openbell web",
      }),
    });
    url = webAppUrl(created);
  }

  if (!url) {
    throw new Error("웹앱 주소를 받지 못했습니다. 배포는 됐으니 편집기에서 웹앱 URL을 확인해 주세요.");
  }
  return { url, scriptId };
}

export function gasOauthClientId() {
  return (
    process.env.GOOGLE_SCRIPT_CLIENT_ID ||
    process.env.VITE_GOOGLE_SCRIPT_CLIENT_ID ||
    process.env.GOOGLE_CLIENT_ID ||
    ""
  );
}
