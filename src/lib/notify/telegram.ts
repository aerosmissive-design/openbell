const TELEGRAM_API = "https://api.telegram.org";

function apiUrl(token: string, method: string) {
  return `${TELEGRAM_API}/bot${token}/${method}`;
}

export async function verifyTelegramBot(token: string, chatId: string) {
  const bot = token.trim();
  const chat = chatId.trim();
  if (!bot || !chat) return { ok: false as const, error: "봇 토큰과 채팅 ID가 필요합니다." };
  const me = await fetch(apiUrl(bot, "getMe"), { signal: AbortSignal.timeout(10000) });
  const meJson = (await me.json()) as { ok?: boolean; result?: { username?: string } };
  if (!me.ok || !meJson.ok) return { ok: false as const, error: "텔레그램 봇 토큰이 맞지 않습니다." };
  const sent = await fetch(apiUrl(bot, "sendMessage"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: /^-?\d+$/.test(chat) ? Number(chat) : chat,
      text: "오픈벨 텔레그램 연결 확인입니다. 이 메시지는 테스트입니다.",
      disable_web_page_preview: true,
    }),
    signal: AbortSignal.timeout(10000),
  });
  const sentJson = (await sent.json()) as { ok?: boolean; description?: string };
  if (!sent.ok || !sentJson.ok) {
    return { ok: false as const, error: "채팅 ID로 메시지를 보내지 못했습니다." };
  }
  return { ok: true as const, username: meJson.result?.username || "" };
}

export async function sendTelegramText(token: string, chatId: string, text: string) {
  const bot = token.trim();
  const chat = chatId.trim();
  if (!bot || !chat) return { ok: false as const, error: "telegram_not_configured" };
  const res = await fetch(apiUrl(bot, "sendMessage"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: /^-?\d+$/.test(chat) ? Number(chat) : chat,
      text: text.slice(0, 3500),
      disable_web_page_preview: true,
    }),
    signal: AbortSignal.timeout(10000),
  });
  const json = (await res.json()) as { ok?: boolean };
  if (!res.ok || !json.ok) return { ok: false as const, error: "telegram_send_failed" };
  return { ok: true as const };
}
