export type NotificationChannel = "telegram" | "mail" | "kakao" | "gas_mail";

export type NotificationEventType =
  | "PAYMENT_READY"
  | "DAILY_REPORT"
  | "ERROR_ALERT"
  | "SETTLEMENT";

export type MailProvider = "gmail_smtp" | "resend" | "none";

export interface NotificationEvent {
  eventType: NotificationEventType;
  userId: string;
  serverId: string;
  payload: Record<string, unknown>;
  idempotencyKey?: string;
  timestamp: string;
}

export type NotifyPrefs = {
  telegramEnabled: boolean;
  telegramVerified: boolean;
  mailEnabled: boolean;
  mailProvider: MailProvider;
  kakaoEnabled: boolean;
  kakaoVerified: boolean;
  gasMailEnabled: boolean;
  notifyPaymentReady: boolean;
  notifyDailyReport: boolean;
  notifyErrorAlert: boolean;
  notifySettlement: boolean;
};

export type NotifySettingsView = {
  telegramEnabled: boolean;
  telegramVerified: boolean;
  telegramChatId: string;
  telegramTokenSet: boolean;
  mailProvider: MailProvider;
  mailAddress: string;
  mailCredentialSet: boolean;
  mailEnabled: boolean;
  kakaoEnabled: boolean;
  kakaoVerified: boolean;
  kakaoChannelId: string;
  kakaoKeySet: boolean;
  kakaoStatus: "pending_business";
  gasMailEnabled: boolean;
  gasWebUrl: string;
  notifyPaymentReady: boolean;
  notifyDailyReport: boolean;
  notifyErrorAlert: boolean;
  notifySettlement: boolean;
  duplicateNotice: string;
};
