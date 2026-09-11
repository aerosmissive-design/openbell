import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const ScanInput = z.object({
  daysAhead: z.number().min(1).max(30).default(7),
  theaters: z.array(
    z.enum([
      "megabox_coex",
      "megabox_namyangju",
      "cgv_yongsan",
      "cgv_yeongdeungpo",
    ]),
  ),
  gasWebUrl: z.string().optional(),
  sources: z
    .object({
      official: z.boolean(),
      naver: z.boolean(),
      gas: z.boolean(),
    })
    .optional(),
});

export const fetchMovieCatalog = createServerFn({ method: "POST" }).handler(
  async () => {
    const { fetchMegaboxCatalog } = await import("./megabox.server");
    const { fetchCgvUpcomingCatalog } = await import("./cgv.server");
    const { mergeMovieCatalog } = await import("./match");
    const [mega, cgvPack] = await Promise.all([
      fetchMegaboxCatalog(),
      fetchCgvUpcomingCatalog().catch(() => ({
        movies: [],
        source: "none" as const,
      })),
    ]);
    const cgvNote =
      cgvPack.source === "none"
        ? "CGV 예정작을 공홈·네이버·우회에서 받지 못했습니다. 메가박스 목록은 있습니다."
        : cgvPack.source === "relay"
          ? "CGV 예정작은 우회 조회입니다. 공홈이 막혀 있습니다."
          : cgvPack.source === "naver"
            ? "CGV 예정작은 네이버입니다. 공홈이 막혀 있습니다."
            : "";
    return {
      ranking: mega.ranking,
      showing: mega.showing,
      catalog: mergeMovieCatalog(mega.catalog, cgvPack.movies),
      catalogNote: cgvNote,
    };
  },
);

export const scanCinema = createServerFn({ method: "POST" })
  .validator(ScanInput)
  .handler(async ({ data }) => {
    const { runScan } = await import("./scan-impl.server");
    const scan = await runScan(data);
    const { noteCgvRelayHealth } = await import("./relay-watch.server");
    await noteCgvRelayHealth(scan.theaters).catch(() => null);
    return scan;
  });

const TelegramInput = z.object({
  token: z.string().min(10),
  chatId: z.string().min(1),
  text: z.string().min(1).max(3500),
  html: z.boolean().optional(),
});

type TgChat = {
  id?: number;
  type?: string;
  first_name?: string;
  username?: string;
};
type TgJson = {
  ok?: boolean;
  description?: string;
  result?:
    | { id?: number; username?: string; first_name?: string; is_bot?: boolean }
    | Array<{
        message?: {
          chat?: TgChat;
          from?: { is_bot?: boolean; first_name?: string };
        };
      }>;
};

async function telegramCall(token: string, method: string, body?: unknown) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  return (await res.json()) as TgJson;
}

function koreanTelegramError(desc: string): string {
  const d = (desc || "").toLowerCase();
  if (d.includes("can't send messages to the bot") || d.includes("bot can't send")) {
    return "봇 아이디가 아니라 내 채팅 ID(숫자)를 넣으세요. 봇에게 말 한 뒤 @userinfobot 의 Id 값을 복사하면 됩니다.";
  }
  if (d.includes("chat not found")) {
    return "채팅을 찾지 못했습니다. 봇에게 먼저 아무 말이나 보낸 뒤, 숫자 채팅 ID를 넣으세요.";
  }
  if (d.includes("unauthorized")) {
    return "봇 토큰이 올바르지 않습니다. @BotFather 에서 토큰을 다시 복사하세요.";
  }
  if (d.includes("forbidden")) {
    return "봇이 이 채팅에 메시지를 보낼 수 없습니다. 텔레그램에서 봇을 열고 /start 를 먼저 보내 주세요.";
  }
  return desc || "텔레그램 전송 실패";
}

function lastPrivateChat(result: TgJson["result"]) {
  if (!Array.isArray(result)) return null;
  for (let i = result.length - 1; i >= 0; i--) {
    const chat = result[i]?.message?.chat;
    const from = result[i]?.message?.from;
    if (chat?.type === "private" && chat.id && !from?.is_bot) {
      return {
        chatId: String(chat.id),
        name: chat.first_name || chat.username || "",
      };
    }
  }
  return null;
}

export const peekTelegramChat = createServerFn({ method: "POST" })
  .validator(z.object({ token: z.string().min(10) }))
  .handler(async ({ data }) => {
    const token = data.token.trim();
    const me = await telegramCall(token, "getMe");
    if (!me.ok) {
      throw new Error(koreanTelegramError(me.description || "unauthorized"));
    }
    const updates = await telegramCall(token, "getUpdates", { limit: 40 });
    if (!updates.ok) {
      throw new Error(koreanTelegramError(updates.description || "조회 실패"));
    }
    const hit = lastPrivateChat(updates.result);
    if (!hit) {
      throw new Error(
        "봇에게 텔레그램에서 아무 말이나 먼저 보내 주세요. 그다음 다시 눌러 주세요.",
      );
    }
    return { ok: true as const, ...hit };
  });

export const sendXPost = createServerFn({ method: "POST" })
  .validator(
    z.object({
      accessToken: z.string().min(8),
      text: z.string().min(1),
      clientId: z.string().optional(),
      clientSecret: z.string().optional(),
      refreshToken: z.string().optional(),
      apiKey: z.string().optional(),
      apiSecret: z.string().optional(),
      accessSecret: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { postXTweet } = await import("./x-post.server");
    return postXTweet(
      {
        accessToken: data.accessToken.trim(),
        clientId: data.clientId?.trim(),
        clientSecret: data.clientSecret?.trim(),
        refreshToken: data.refreshToken?.trim(),
        apiKey: data.apiKey?.trim(),
        apiSecret: data.apiSecret?.trim(),
        accessSecret: data.accessSecret?.trim(),
      },
      data.text,
    );
  });

export const sendTelegram = createServerFn({ method: "POST" })
  .validator(TelegramInput)
  .handler(async ({ data }) => {
    const token = data.token.trim();
    let chatId = data.chatId.trim();
    const me = await telegramCall(token, "getMe");
    if (!me.ok) {
      throw new Error(koreanTelegramError(me.description || "unauthorized"));
    }
    const botName =
      me.result && !Array.isArray(me.result) ? String(me.result.username ?? "") : "";
    const stripped = chatId.replace(/^@/, "");
    if (stripped && botName && stripped.toLowerCase() === botName.toLowerCase()) {
      throw new Error(
        "채팅 ID에 봇 이름(@)을 넣으셨습니다. 봇에게 말 한 뒤 @userinfobot 의 Id 숫자만 넣으세요.",
      );
    }
    if (chatId.startsWith("@")) chatId = stripped;
    const sent = await telegramCall(token, "sendMessage", {
      chat_id: /^-?\d+$/.test(chatId) ? Number(chatId) : chatId,
      text: data.text,
      parse_mode: data.html ? "HTML" : undefined,
      disable_web_page_preview: true,
    });
    if (!sent.ok) {
      throw new Error(koreanTelegramError(sent.description || "텔레그램 전송 실패"));
    }
    return { ok: true as const };
  });

const WebhookInput = z.object({
  url: z.string(),
  payload: z.unknown(),
});

export const sendWebhook = createServerFn({ method: "POST" })
  .validator(WebhookInput)
  .handler(async ({ data }) => {
    const res = await fetch(data.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data.payload ?? {}),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`웹훅 ${res.status}`);
    return { ok: true as const };
  });

const KakaoExchangeInput = z.object({
  restKey: z.string().min(8),
  code: z.string().min(4),
  redirectUri: z.string().min(8),
});

export const exchangeKakaoCode = createServerFn({ method: "POST" })
  .validator(KakaoExchangeInput)
  .handler(async ({ data }) => {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: data.restKey.trim(),
      redirect_uri: data.redirectUri.trim(),
      code: data.code.trim(),
    });
    const res = await fetch("https://kauth.kakao.com/oauth/token", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded;charset=utf-8",
      },
      body,
      signal: AbortSignal.timeout(10000),
    });
    const json = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      error?: string;
      error_description?: string;
    };
    if (!json.refresh_token) {
      throw new Error(
        json.error_description ||
          json.error ||
          "카카오 연결에 실패했습니다. 인가 코드를 다시 받아 주세요.",
      );
    }
    return { refreshToken: json.refresh_token, accessToken: json.access_token ?? "" };
  });

const KakaoMemoInput = z.object({
  restKey: z.string().min(8),
  refreshToken: z.string().min(8),
  text: z.string().min(1).max(200),
  bookingUrl: z.string().optional(),
});

export const sendKakaoMemo = createServerFn({ method: "POST" })
  .validator(KakaoMemoInput)
  .handler(async ({ data }) => {
    const tokenBody = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: data.restKey.trim(),
      refresh_token: data.refreshToken.trim(),
    });
    const tokenRes = await fetch("https://kauth.kakao.com/oauth/token", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded;charset=utf-8",
      },
      body: tokenBody,
      signal: AbortSignal.timeout(10000),
    });
    const tokenJson = (await tokenRes.json()) as {
      access_token?: string;
      error_description?: string;
    };
    if (!tokenJson.access_token) {
      throw new Error(
        tokenJson.error_description ||
          "카카오 토큰이 만료되었습니다. 설정에서 다시 연결해 주세요.",
      );
    }
    const link = data.bookingUrl || "https://www.megabox.co.kr";
    const memoBody = new URLSearchParams({
      template_object: JSON.stringify({
        object_type: "text",
        text: data.text.slice(0, 200),
        link: { web_url: link, mobile_web_url: link },
        button_title: "바로 예매",
      }),
    });
    const memoRes = await fetch(
      "https://kapi.kakao.com/v2/api/talk/memo/default/send",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenJson.access_token}`,
          "content-type": "application/x-www-form-urlencoded;charset=utf-8",
        },
        body: memoBody,
        signal: AbortSignal.timeout(10000),
      },
    );
    const memoJson = (await memoRes.json()) as {
      result_code?: number;
      msg?: string;
    };
    if (!memoRes.ok || (memoJson.result_code != null && memoJson.result_code !== 0)) {
      throw new Error(memoJson.msg || "카카오톡 전송에 실패했습니다.");
    }
    return { ok: true as const };
  });

const MailInput = z.object({
  to: z.string().min(3).max(120),
  subject: z.string().min(1).max(120),
  text: z.string().min(1).max(4000),
  url: z.string().optional(),
  items: z
    .array(
      z.object({
        title: z.string(),
        body: z.string(),
        bookingUrl: z.string(),
      }),
    )
    .optional(),
  gasWebUrl: z.string().optional(),
  gmailAppPassword: z.string().max(80).optional(),
});

export const sendAlertEmail = createServerFn({ method: "POST" })
  .validator(MailInput)
  .handler(async ({ data }) => {
    const { sendOpenbellMail } = await import("./mail.server");
    const result = await sendOpenbellMail({
      to: data.to,
      subject: data.subject,
      text: data.text,
      url: data.url,
      items: data.items,
      gasWebUrl: data.gasWebUrl,
      gmailAppPassword: data.gmailAppPassword,
    });
    if (!result.ok) throw new Error(result.error);
    return result;
  });

const GasTestInput = z.object({
  url: z.string().url(),
  op: z.enum(["test", "seat"]).default("test"),
  subject: z.string().max(120).optional(),
  title: z.string().max(80).optional(),
  body: z.string().max(500).optional(),
  bookingUrl: z.string().optional(),
  theater: z.string().optional(),
  hall: z.string().optional(),
  date: z.string().optional(),
  time: z.string().optional(),
});

export const sendGasTest = createServerFn({ method: "POST" })
  .validator(GasTestInput)
  .handler(async ({ data }) => {
    let target: URL;
    try {
      target = new URL(data.url.trim());
    } catch {
      throw new Error("구글 웹앱 주소가 올바르지 않습니다.");
    }
    const host = target.hostname;
    if (
      !host.endsWith("script.google.com") &&
      !host.endsWith("googleusercontent.com")
    ) {
      throw new Error("구글 스크립트 주소만 사용할 수 있습니다.");
    }
    target.searchParams.set("op", data.op);
    if (data.subject) target.searchParams.set("subject", data.subject);
    if (data.title) target.searchParams.set("title", data.title);
    if (data.body) target.searchParams.set("body", data.body);
    if (data.bookingUrl) target.searchParams.set("url", data.bookingUrl);
    if (data.theater) target.searchParams.set("theater", data.theater);
    if (data.hall) target.searchParams.set("hall", data.hall);
    if (data.date) target.searchParams.set("date", data.date);
    if (data.time) target.searchParams.set("time", data.time);
    const res = await fetch(target.toString(), {
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    });
    const text = await res.text();
    if (!/ok/i.test(text) || /sign in|accounts\.google/i.test(text)) {
      throw new Error(
        "구글이 메일을 보내지 못했습니다. 웹앱 액세스가 '모든 사용자'인지, 코드를 저장한 뒤 배포를 새로 했는지 확인하세요.",
      );
    }
    return { ok: true as const };
  });

const GasSeatmapInput = z.object({
  url: z.string().optional(),
  fresh: z.boolean().optional(),
  theaterId: z
    .enum([
      "cgv_yongsan",
      "cgv_yeongdeungpo",
      "megabox_coex",
      "megabox_namyangju",
    ])
    .optional(),
  daysAhead: z.number().min(1).max(14).optional(),
});

export const pingGasBeat = createServerFn({ method: "POST" })
  .validator(
    z.object({
      url: z.string().min(8),
      key: z.string().optional(),
      src: z.enum(["page", "tick"]).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { pingGasHeartbeat } = await import("./cloud");
    await pingGasHeartbeat(data.url, data.key || "", data.src || "page");
    return { ok: true as const };
  });

export const pingGasSeatmap = createServerFn({ method: "POST" })
  .validator(GasSeatmapInput)
  .handler(async ({ data }) => {
    const { pingSeatmap } = await import("./scan-impl.server");
    return pingSeatmap(data);
  });

export async function pullTheaterSeats(input?: {
  url?: string;
  theaterId?:
    | "cgv_yongsan"
    | "cgv_yeongdeungpo"
    | "megabox_coex"
    | "megabox_namyangju";
  daysAhead?: number;
  fresh?: boolean;
}) {
  return pingGasSeatmap({
    data: {
      url: input?.url?.trim() || undefined,
      fresh: input?.fresh ?? false,
      theaterId: input?.theaterId,
      daysAhead: input?.daysAhead,
    },
  });
}

export async function pullCgvSeats(input?: {
  url?: string;
  theaterId?: "cgv_yongsan" | "cgv_yeongdeungpo";
  daysAhead?: number;
}) {
  return pullTheaterSeats({ ...input, fresh: true });
}

export const claimGasBind = createServerFn({ method: "POST" })
  .validator(z.object({ key: z.string().min(8), email: z.string().optional() }))
  .handler(async ({ data }) => {
    const { claimGasBind: claim } = await import("./gas-bind.server");
    return claim(data.key, data.email);
  });

export const getGasOauthClient = createServerFn({ method: "POST" })
  .validator(z.object({}))
  .handler(async () => {
    const { gasOauthClientId } = await import("./gas-provision.server");
    return gasOauthClientId();
  });

const ProvisionInput = z.object({
  accessToken: z.string().min(10),
  source: z.string().min(20),
  scriptId: z.string().optional(),
  createNew: z.boolean().optional(),
});

export const provisionGasScript = createServerFn({ method: "POST" })
  .validator(ProvisionInput)
  .handler(async ({ data }) => {
    const { provisionGasProject } = await import("./gas-provision.server");
    return provisionGasProject(data);
  });

