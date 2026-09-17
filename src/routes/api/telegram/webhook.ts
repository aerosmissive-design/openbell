import { createFileRoute } from "@tanstack/react-router";
import { getBookingSession, updateBookingState } from "@/lib/booking/session";
import { answerTelegramCallback, editTelegramMessage } from "@/lib/telegram/notifier";

function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

function webhookAuthorized(request: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (!secret) return true;
  return request.headers.get("x-telegram-bot-api-secret-token") === secret;
}

export const Route = createFileRoute("/api/telegram/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!webhookAuthorized(request)) return json({ ok: false }, 401);

        let update: any;
        try {
          update = await request.json();
        } catch {
          return json({ ok: false, error: "invalid json" }, 400);
        }

        const callback = update?.callback_query;
        if (!callback?.id || typeof callback.data !== "string") return json({ ok: true });

        const configuredChatId = process.env.TELEGRAM_CHAT_ID?.trim() || "";
        const callbackChatId = String(callback.message?.chat?.id ?? "");
        const callbackUserId = String(callback.from?.id ?? "");
        const configuredUserId = process.env.TELEGRAM_USER_ID?.trim() || "";
        if (!configuredChatId || callbackChatId !== configuredChatId || (configuredUserId && callbackUserId !== configuredUserId)) {
          await answerTelegramCallback(callback.id, "권한이 없는 사용자입니다.", true);
          return json({ ok: true });
        }

        const match = callback.data.match(/^openbell:cancel:([a-f0-9-]+)$/i);
        if (!match) {
          await answerTelegramCallback(callback.id, "알 수 없는 요청입니다.", true);
          return json({ ok: true });
        }

        const sessionId = match[1];
        const session = await getBookingSession(sessionId);
        if (!session) {
          await answerTelegramCallback(callback.id, "예약 세션을 찾을 수 없습니다.", true);
          return json({ ok: true });
        }

        if (["COMPLETED", "CANCELLED", "EXPIRED", "FAILED"].includes(session.state)) {
          await answerTelegramCallback(callback.id, `이미 종료된 예약입니다. (${session.state})`, true);
          return json({ ok: true });
        }

        try {
          const cancelled = await updateBookingState(sessionId, "CANCELLED");
          await answerTelegramCallback(callback.id, "예약을 중단했습니다.");
          if (callback.message?.message_id) {
            await editTelegramMessage(callbackChatId, Number(callback.message.message_id), [
              "🛑 OpenBell 예약 중단",
              "",
              `영화: ${cancelled.movieTitle}`,
              `시간: ${cancelled.showtime}`,
              "",
              "사용자 요청으로 예약 세션을 중단했습니다.",
            ].join("\n"));
          }
        } catch {
          await answerTelegramCallback(callback.id, "예약 중단 처리에 실패했습니다. 다시 시도해주세요.", true);
        }

        return json({ ok: true });
      },
    },
  },
});
