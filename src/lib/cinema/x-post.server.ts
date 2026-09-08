import { createHmac, randomBytes } from "node:crypto";

export const X_HANDLE = "aerosmissive2";
export const X_DISPLAY = "홀드현알리미";
export const X_PROFILE = "https://x.com/aerosmissive2";

export type XAuth = {
  accessToken: string;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  apiKey?: string;
  apiSecret?: string;
  accessSecret?: string;
};

type TweetResult = {
  id: string;
  url: string;
  accessToken?: string;
  refreshToken?: string;
};

function rfc3986(value: string) {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function oauth1Header(auth: XAuth, method: string, url: string) {
  const oauth: Record<string, string> = {
    oauth_consumer_key: auth.apiKey || "",
    oauth_nonce: randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: auth.accessToken,
    oauth_version: "1.0",
  };
  const paramString = Object.keys(oauth)
    .sort()
    .map((key) => `${rfc3986(key)}=${rfc3986(oauth[key])}`)
    .join("&");
  const base = `${method.toUpperCase()}&${rfc3986(url)}&${rfc3986(paramString)}`;
  const signingKey = `${rfc3986(auth.apiSecret || "")}&${rfc3986(auth.accessSecret || "")}`;
  oauth.oauth_signature = createHmac("sha1", signingKey)
    .update(base)
    .digest("base64");
  return (
    "OAuth " +
    Object.keys(oauth)
      .sort()
      .map((key) => `${rfc3986(key)}="${rfc3986(oauth[key])}"`)
      .join(", ")
  );
}

function oauth1Ready(auth: XAuth) {
  return Boolean(
    auth.apiKey?.trim() &&
      auth.apiSecret?.trim() &&
      auth.accessToken.trim() &&
      auth.accessSecret?.trim(),
  );
}

async function tweetWithBearer(token: string, text: string) {
  const res = await fetch("https://api.x.com/2/tweets", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ text: text.slice(0, 270) }),
    signal: AbortSignal.timeout(12000),
  });
  const json = (await res.json().catch(() => ({}))) as XApiError & {
    data?: { id?: string };
  };
  return { ok: res.ok && Boolean(json.data?.id), status: res.status, json };
}

type XApiError = {
  detail?: string;
  title?: string;
  reason?: string;
  errors?: Array<{ message?: string; detail?: string }>;
};

function xErrorText(json: XApiError) {
  return (
    json.errors?.[0]?.message ||
    json.errors?.[0]?.detail ||
    json.detail ||
    json.title ||
    json.reason ||
    ""
  );
}

function xPostError(status: number, detail?: string) {
  const text = String(detail || "");
  const lower = text.toLowerCase();
  if (lower.includes("credit") || lower.includes("depleted")) {
    return "X API 크레딧이 없습니다. developer.x.com에서 프로젝트 결제·크레딧을 충전하거나 Basic 플랜을 확인하세요. 오픈벨 설정은 맞습니다.";
  }
  if (status === 401) {
    return "액세스 토큰이 잘못됐거나 만료됐습니다. Keys and tokens의 OAuth 2.0 액세스 토큰을 다시 복사하세요. 앱 전용 Bearer는 안 됩니다.";
  }
  if (status === 403) {
    if (lower.includes("duplicate") || lower.includes("already")) {
      return "같은 글을 이미 올렸습니다. 테스트 문구가 조금 달라도 다시 눌러 보세요.";
    }
    if (lower.includes("credit") || lower.includes("depleted")) {
      return "X API 크레딧이 없습니다. developer.x.com에서 프로젝트 결제·크레딧을 충전하거나 Basic 플랜을 확인하세요. 오픈벨 설정은 맞습니다.";
    }
    if (
      lower.includes("not permitted") ||
      lower.includes("client-not-enrolled") ||
      lower.includes("access to this endpoint") ||
      lower.includes("oauth1") ||
      lower.includes("forbidden")
    ) {
      return (
        text.slice(0, 180) ||
        "X가 글 올리기를 막았습니다. 무료 API는 게시가 안 되는 경우가 많습니다. developer.x.com에서 Basic 플랜과 tweet.write를 확인하세요."
      );
    }
    return text.slice(0, 180) || "X가 글 올리기를 거부했습니다(403).";
  }
  if (status === 429) return "X가 잠시 막았습니다. 잠시 뒤 다시 올려 보세요.";
  return text.slice(0, 180) || "X에 올리지 못했습니다.";
}

async function refreshUserToken(auth: XAuth) {
  const id = auth.clientId?.trim() || "";
  const secret = auth.clientSecret?.trim() || "";
  const refresh = auth.refreshToken?.trim() || "";
  if (!id || !secret || !refresh) return null;
  const basic = Buffer.from(`${id}:${secret}`).toString("base64");
  const res = await fetch("https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers: {
      authorization: `Basic ${basic}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refresh,
    }),
    signal: AbortSignal.timeout(12000),
  });
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
  };
  if (!res.ok || !json.access_token) return null;
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token || refresh,
  };
}

export async function postXTweet(auth: XAuth, text: string): Promise<TweetResult> {
  const token = auth.accessToken.trim();
  if (!token) throw new Error("OAuth 2.0 액세스 토큰을 붙여넣으세요.");

  if (oauth1Ready(auth)) {
    const url = "https://api.x.com/2/tweets";
    const res = await fetch(url, {
      method: "POST",
      headers: {
        authorization: oauth1Header(auth, "POST", url),
        "content-type": "application/json",
      },
      body: JSON.stringify({ text: text.slice(0, 270) }),
      signal: AbortSignal.timeout(12000),
    });
    const json = (await res.json().catch(() => ({}))) as {
      data?: { id?: string };
      detail?: string;
      title?: string;
    };
    if (res.ok && json.data?.id) {
      return {
        id: String(json.data.id),
        url: `https://x.com/${X_HANDLE}/status/${json.data.id}`,
      };
    }
  }

  let access = token;
  let refresh = auth.refreshToken?.trim() || "";
  let posted = await tweetWithBearer(access, text);
  if (!posted.ok && posted.status === 401) {
    const next = await refreshUserToken({ ...auth, accessToken: access });
    if (next) {
      access = next.accessToken;
      refresh = next.refreshToken;
      posted = await tweetWithBearer(access, text);
    }
  }
  if (!posted.ok || !posted.json.data?.id) {
    throw new Error(xPostError(posted.status, xErrorText(posted.json)));
  }
  return {
    id: String(posted.json.data.id),
    url: `https://x.com/${X_HANDLE}/status/${posted.json.data.id}`,
    accessToken: access !== token ? access : undefined,
    refreshToken: refresh && refresh !== auth.refreshToken ? refresh : undefined,
  };
}
