import type { BookingSession } from "@/lib/booking/types";

const TELEGRAM_API = "https://api.telegram.org";

function config() {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim() || "";
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim() || "";
  return { token, chatId };
}

function apiUrl(token: string, method: string) {
  return `${TELEGRAM_API}/bot${token}/${method}`;
}

function textFor(session: BookingSession) {
  return [
    "🎬 OpenBell 결제 알림",
    "",
    `극장: ${session.theaterId}`,
    `영화: ${session.movieTitle}`,
    `날짜: ${session.playDate}`,
    `시간: ${session.showtime}`,
    `상영관: ${session.hall}`,
    `좌석: ${session.selectedSeats.join(" · ") || "선택됨"}`,
    "",
    "✅ 결제 직전까지 자동으로 진행되었습니다.",
    "⚠️ 최종 결제는 자동으로 진행하지 않습니다.",
    `⏳ ${session.expiresAt ? new Date(session.expiresAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : "10분"}까지 처리해주세요.",
  ].join("\n");
}

export async function sendPaymentReadyTelegram(session: BookingSession) {
  const { token, chatId } = config();
  if (!token || !chatId) return { ok: false, skipped: true, reason: "telegram_not_configured" };

  const buttons: Array<Array<Record<string, string>>> = [];
  if (session.browserAccessUrl?.startsWith("https://")) {
    buttons.push([{ text: "🖥 브라우저 열기", url: session.browserAccessUrl }]);
  }
  buttons.push([{ text: "❌ 예약 중단", callback_data: `openbell:cancel:${session.id}` }]);

  const response = await fetch(apiUrl(token, "sendMessage"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: textFor(session),
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: buttons },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`TELEGRAM_SEND_FAILED:${response.status}:${detail.slice(0, 300)}`);
  }
  const data = await response.json() as { ok?: boolean; result?: { message_id?: number } };
  return { ok: Boolean(data.ok), messageId: data.result?.message_id };
}

export async function answerTelegramCallback(callbackQueryId: string, text: string, showAlert = false) {
  const { token } = config();
  if (!token) return;
  await fetch(apiUrl(token, "answerCallbackQuery"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text, show_alert: showAlert }),
  });
}

export async function editTelegramMessage(chatId: string, messageId: number, text: string) {
  const { token } = config();
  if (!token) return;
  await fetch(apiUrl(token, "editMessageText"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId, text }),
  });
}
