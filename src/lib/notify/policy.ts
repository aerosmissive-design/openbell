import type {
  MailProvider,
  NotificationChannel,
  NotificationEventType,
  NotifyPrefs,
} from "./types";

export const DUPLICATE_NOTICE =
  "GAS 메일(예비)을 켜 두면 직접 메일(메인)과 같은 내용이 둘 다 갈 수 있습니다.";

export const KAKAO_BUSINESS_NOTICE =
  "카카오 알림톡은 사업자 등록과 채널 심사가 필요합니다. 검증 전에는 보내지 않습니다. 나에게 보내기는 위 카톡 카드를 그대로 씁니다.";

const EVENT_FLAG: Record<NotificationEventType, keyof NotifyPrefs> = {
  PAYMENT_READY: "notifyPaymentReady",
  DAILY_REPORT: "notifyDailyReport",
  ERROR_ALERT: "notifyErrorAlert",
  SETTLEMENT: "notifySettlement",
};

export function eventAllowed(prefs: NotifyPrefs, event: NotificationEventType) {
  return Boolean(prefs[EVENT_FLAG[event]]);
}

/** gas_mail is included when the toggle is on. Kakao alimtalk stays out until business verification. */
export function resolveChannels(
  prefs: NotifyPrefs,
  event: NotificationEventType,
): NotificationChannel[] {
  if (!eventAllowed(prefs, event)) return [];
  const channels: NotificationChannel[] = [];
  if (prefs.gasMailEnabled) channels.push("gas_mail");
  if (prefs.telegramEnabled && prefs.telegramVerified) channels.push("telegram");
  if (prefs.mailEnabled && prefs.mailProvider !== "none") channels.push("mail");
  return channels;
}

export function paymentReadyIdempotencyKey(
  serverId: string,
  orderId: string,
  at: Date,
) {
  const minute = at.toISOString().slice(0, 16);
  return `${serverId}:${orderId}:${minute}`;
}

export function maskSecret(value: string) {
  return value.trim() ? "****" : "";
}

export function isMaskedKeep(value: string | undefined) {
  const text = String(value ?? "").trim();
  return text === "" || text === "****";
}

export function normalizeProvider(value: string): MailProvider {
  if (value === "gmail_smtp" || value === "resend") return value;
  return "none";
}
