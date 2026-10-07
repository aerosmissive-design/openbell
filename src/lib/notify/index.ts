import { claimIdempotency, writeDeliveryLog } from "./delivery-log";
import { sendKakaoAlimtalk } from "./kakao";
import { sendDirectMail, sendGasMail } from "./mail";
import { resolveChannels } from "./policy";
import { loadEffectiveNotify, type EffectiveNotify } from "./store.server";
import { sendTelegramText } from "./telegram";
import type { NotificationChannel, NotificationEvent } from "./types";

function isTestEvent(event: NotificationEvent) {
  return Boolean(event.payload.is_test || event.payload.isTest);
}

function subjectFor(event: NotificationEvent) {
  if (isTestEvent(event)) return "[오픈벨 테스트] 알림 확인";
  if (event.eventType === "PAYMENT_READY") {
    const seats = Array.isArray(event.payload.seats) ? event.payload.seats.map(String).filter(Boolean).join(" ") : "";
    const amount = String(event.payload.amount || "");
    const when = String(event.payload.showtime || "");
    return `[오픈벨] ${["결제하세요", seats, amount, when].filter(Boolean).join(" · ")}`.slice(0, 120);
  }
  if (event.eventType === "DAILY_REPORT") return "[오픈벨] 일일 리포트";
  if (event.eventType === "ERROR_ALERT") return "[오픈벨] 오류";
  return "[오픈벨] 정산";
}

function textFor(event: NotificationEvent) {
  if (isTestEvent(event)) {
    return "오픈벨 테스트 알림입니다. 실제 예매나 결제 정보가 아닙니다.";
  }
  if (event.eventType === "PAYMENT_READY") {
    const seats = Array.isArray(event.payload.seats) ? event.payload.seats.map(String).join(" · ") : "";
    return [
      "오픈벨 결제 준비",
      `극장: ${String(event.payload.theaterId || "")}`,
      `영화: ${String(event.payload.movieTitle || "")}`,
      `날짜: ${String(event.payload.playDate || "")} ${String(event.payload.showtime || "")}`,
      `상영관: ${String(event.payload.hall || "")}`,
      `좌석: ${seats}`,
      `금액: ${String(event.payload.amount || "")}`,
      `색: ${String(event.payload.color || event.payload.hall || "")}`,
      "",
      "최종 결제는 PC에 열린 브라우저에서 직접 하세요.",
      "결제 버튼은 누르지 않았습니다.",
      "휴대폰에서 결제 페이지를 새로 열지 마세요.",
    ].join("\n");
  }
  return String(event.payload.text || event.eventType);
}

async function sendChannel(channel: NotificationChannel, cfg: EffectiveNotify, subject: string, text: string) {
  if (channel === "telegram") return sendTelegramText(cfg.telegramToken, cfg.telegramChatId, text);
  if (channel === "mail") {
    return sendDirectMail({
      provider: cfg.mailProvider,
      to: cfg.mailAddress,
      credential: cfg.mailCredential,
      subject,
      text,
    });
  }
  if (channel === "gas_mail") return sendGasMail(cfg.gasWebUrl, subject, text);
  return sendKakaoAlimtalk();
}

export async function dispatchNotification(event: NotificationEvent) {
  const test = isTestEvent(event);
  if (!test && event.idempotencyKey) {
    const fresh = await claimIdempotency(event.idempotencyKey, 3600);
    if (!fresh) {
      return { ok: true as const, skipped: true as const, reason: "duplicate" as const, results: [] };
    }
  }
  const cfg = await loadEffectiveNotify(event.userId);
  const channels = resolveChannels(cfg, event.eventType);
  const subject = subjectFor(event);
  const text = textFor(event);
  const settled = await Promise.allSettled(
    channels.map(async (channel) => {
      try {
        const result = await sendChannel(channel, cfg, subject, text);
        await writeDeliveryLog({
          userId: cfg.userId || event.userId,
          eventType: event.eventType,
          channel,
          ok: result.ok,
          isTest: test,
          detail: result.ok ? "ok" : result.error,
          idempotencyKey: event.idempotencyKey,
        });
        return { channel, ok: result.ok, error: result.ok ? "" : result.error };
      } catch {
        await writeDeliveryLog({
          userId: cfg.userId || event.userId,
          eventType: event.eventType,
          channel,
          ok: false,
          isTest: test,
          detail: "send_failed",
          idempotencyKey: event.idempotencyKey,
        }).catch(() => null);
        return { channel, ok: false, error: "send_failed" };
      }
    }),
  );
  return {
    ok: true as const,
    skipped: false as const,
    hardStop: event.eventType === "PAYMENT_READY",
    source: cfg.source,
    results: settled.map((item) =>
      item.status === "fulfilled" ? item.value : { channel: "mail" as const, ok: false, error: "send_failed" },
    ),
  };
}
