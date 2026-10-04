import { randomUUID } from "node:crypto";
import { openNotifySecret, sealNotifySecret } from "./crypto.server";
import { DUPLICATE_NOTICE, isMaskedKeep, normalizeProvider } from "./policy";
import { ensureNotifySchema } from "./schema.server";
import type { MailProvider, NotifyPrefs, NotifySettingsView } from "./types";

export type NotifyRow = {
  user_id: string;
  telegram_bot_token: string | null;
  telegram_chat_id: string | null;
  telegram_enabled: boolean;
  telegram_verified: boolean;
  mail_provider: string;
  mail_address: string | null;
  mail_credential: string | null;
  mail_enabled: boolean;
  kakao_api_key: string | null;
  kakao_channel_id: string | null;
  kakao_enabled: boolean;
  kakao_verified: boolean;
  gas_mail_enabled: boolean;
  gas_web_url: string | null;
  notify_payment_ready: boolean;
  notify_daily_report: boolean;
  notify_error_alert: boolean;
  notify_settlement: boolean;
};

export type EffectiveNotify = NotifyPrefs & {
  userId: string;
  source: "account" | "legacy" | "env";
  telegramToken: string;
  telegramChatId: string;
  mailAddress: string;
  mailCredential: string;
  gasWebUrl: string;
};

function bool(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  return fallback;
}

export function viewFromRow(row: NotifyRow): NotifySettingsView {
  return {
    telegramEnabled: bool(row.telegram_enabled),
    telegramVerified: bool(row.telegram_verified),
    telegramChatId: String(row.telegram_chat_id || ""),
    telegramTokenSet: Boolean(openNotifySecret(String(row.telegram_bot_token || ""))),
    mailProvider: normalizeProvider(String(row.mail_provider || "none")),
    mailAddress: String(row.mail_address || ""),
    mailCredentialSet: Boolean(openNotifySecret(String(row.mail_credential || ""))),
    mailEnabled: bool(row.mail_enabled),
    kakaoEnabled: false,
    kakaoVerified: false,
    kakaoChannelId: String(row.kakao_channel_id || ""),
    kakaoKeySet: Boolean(String(row.kakao_api_key || "")),
    kakaoStatus: "pending_business",
    gasMailEnabled: bool(row.gas_mail_enabled, true),
    gasWebUrl: String(row.gas_web_url || ""),
    notifyPaymentReady: bool(row.notify_payment_ready, true),
    notifyDailyReport: bool(row.notify_daily_report, true),
    notifyErrorAlert: bool(row.notify_error_alert, true),
    notifySettlement: bool(row.notify_settlement, true),
    duplicateNotice: DUPLICATE_NOTICE,
  };
}

export function emptyView(): NotifySettingsView {
  return viewFromRow({
    user_id: "",
    telegram_bot_token: "",
    telegram_chat_id: "",
    telegram_enabled: false,
    telegram_verified: false,
    mail_provider: "none",
    mail_address: "",
    mail_credential: "",
    mail_enabled: false,
    kakao_api_key: "",
    kakao_channel_id: "",
    kakao_enabled: false,
    kakao_verified: false,
    gas_mail_enabled: true,
    gas_web_url: "",
    notify_payment_ready: true,
    notify_daily_report: true,
    notify_error_alert: true,
    notify_settlement: true,
  });
}

async function sql() {
  await ensureNotifySchema();
  const { getSql } = await import("@/lib/db");
  return getSql();
}

export async function readNotifyRow(userId: string) {
  const db = await sql();
  const rows = await db.query<NotifyRow>(
    `select * from user_notification_settings where user_id = $1 limit 1`,
    [userId],
  );
  return rows[0] ?? null;
}

export type NotifySaveInput = {
  telegramEnabled: boolean;
  telegramChatId: string;
  telegramToken?: string;
  mailProvider: MailProvider;
  mailAddress: string;
  mailCredential?: string;
  mailEnabled: boolean;
  kakaoChannelId: string;
  kakaoApiKey?: string;
  gasMailEnabled: boolean;
  gasWebUrl: string;
  notifyPaymentReady: boolean;
  notifyDailyReport: boolean;
  notifyErrorAlert: boolean;
  notifySettlement: boolean;
  resetTelegramVerified?: boolean;
};

export async function saveNotifyRow(userId: string, input: NotifySaveInput) {
  const current = await readNotifyRow(userId);
  const token = isMaskedKeep(input.telegramToken)
    ? String(current?.telegram_bot_token || "")
    : sealNotifySecret(String(input.telegramToken || ""));
  const credential = isMaskedKeep(input.mailCredential)
    ? String(current?.mail_credential || "")
    : sealNotifySecret(String(input.mailCredential || ""));
  const kakaoKey = isMaskedKeep(input.kakaoApiKey)
    ? String(current?.kakao_api_key || "")
    : sealNotifySecret(String(input.kakaoApiKey || ""));
  const tokenChanged = !isMaskedKeep(input.telegramToken);
  const chatChanged = String(input.telegramChatId || "") !== String(current?.telegram_chat_id || "");
  const verified = tokenChanged || chatChanged || input.resetTelegramVerified
    ? false
    : bool(current?.telegram_verified);
  const db = await sql();
  await db.query(
    `insert into user_notification_settings (
       id, user_id, telegram_bot_token, telegram_chat_id, telegram_enabled, telegram_verified,
       mail_provider, mail_address, mail_credential, mail_enabled,
       kakao_api_key, kakao_channel_id, kakao_enabled, kakao_verified,
       gas_mail_enabled, gas_web_url,
       notify_payment_ready, notify_daily_report, notify_error_alert, notify_settlement, updated_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,false,false,$13,$14,$15,$16,$17,$18,now())
     on conflict (user_id) do update set
       telegram_bot_token = excluded.telegram_bot_token,
       telegram_chat_id = excluded.telegram_chat_id,
       telegram_enabled = excluded.telegram_enabled,
       telegram_verified = excluded.telegram_verified,
       mail_provider = excluded.mail_provider,
       mail_address = excluded.mail_address,
       mail_credential = excluded.mail_credential,
       mail_enabled = excluded.mail_enabled,
       kakao_api_key = excluded.kakao_api_key,
       kakao_channel_id = excluded.kakao_channel_id,
       kakao_enabled = false,
       kakao_verified = false,
       gas_mail_enabled = excluded.gas_mail_enabled,
       gas_web_url = excluded.gas_web_url,
       notify_payment_ready = excluded.notify_payment_ready,
       notify_daily_report = excluded.notify_daily_report,
       notify_error_alert = excluded.notify_error_alert,
       notify_settlement = excluded.notify_settlement,
       updated_at = now()`,
    [
      current?.user_id ? String((current as NotifyRow & { id?: string }).id || randomUUID()) : randomUUID(),
      userId,
      token,
      input.telegramChatId.trim(),
      input.telegramEnabled,
      input.telegramEnabled ? verified : false,
      normalizeProvider(input.mailProvider),
      input.mailAddress.trim(),
      credential,
      input.mailEnabled,
      kakaoKey,
      input.kakaoChannelId.trim(),
      input.gasMailEnabled,
      input.gasWebUrl.trim(),
      input.notifyPaymentReady,
      input.notifyDailyReport,
      input.notifyErrorAlert,
      input.notifySettlement,
    ],
  );
  const saved = await readNotifyRow(userId);
  return saved ? viewFromRow(saved) : emptyView();
}

export async function markTelegramVerified(userId: string, verified: boolean) {
  const db = await sql();
  await db.query(
    `update user_notification_settings
     set telegram_verified = $2, telegram_enabled = case when $2 then true else telegram_enabled end, updated_at = now()
     where user_id = $1`,
    [userId, verified],
  );
}

function prefsFrom(row: NotifyRow, source: EffectiveNotify["source"]): EffectiveNotify {
  return {
    userId: row.user_id,
    source,
    telegramEnabled: bool(row.telegram_enabled),
    telegramVerified: bool(row.telegram_verified),
    telegramToken: openNotifySecret(String(row.telegram_bot_token || "")),
    telegramChatId: String(row.telegram_chat_id || ""),
    mailEnabled: bool(row.mail_enabled),
    mailProvider: normalizeProvider(String(row.mail_provider || "none")),
    mailAddress: String(row.mail_address || ""),
    mailCredential: openNotifySecret(String(row.mail_credential || "")),
    kakaoEnabled: false,
    kakaoVerified: false,
    gasMailEnabled: bool(row.gas_mail_enabled, true),
    gasWebUrl: String(row.gas_web_url || ""),
    notifyPaymentReady: bool(row.notify_payment_ready, true),
    notifyDailyReport: bool(row.notify_daily_report, true),
    notifyErrorAlert: bool(row.notify_error_alert, true),
    notifySettlement: bool(row.notify_settlement, true),
  };
}

type LegacyConfig = {
  telegramToken?: string;
  telegramChatId?: string;
  email?: string;
  emailNotify?: boolean;
  gmailAppPassword?: string;
  gasWebUrl?: string;
};

async function soleUserId(table: "user_notification_settings" | "user_settings") {
  const db = await sql();
  const rows = await db.query<{ user_id: string }>(
    `select user_id from ${table} order by user_id limit 2`,
  );
  if (rows.length !== 1) return "";
  return String(rows[0]?.user_id || "");
}

async function legacyConfig(userId: string): Promise<LegacyConfig | null> {
  const { getSql } = await import("@/lib/db");
  const db = await getSql();
  const rows = await db.query<{ config: LegacyConfig }>(
    `select config from user_settings where user_id = $1 limit 1`,
    [userId],
  );
  const config = rows[0]?.config;
  if (!config || typeof config !== "object") return null;
  const { revealConfigSecrets } = await import("@/lib/cinema/secret-box.server");
  return revealConfigSecrets(config as never) as LegacyConfig;
}

function envEffective(): EffectiveNotify {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim() || "";
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim() || "";
  const resend = process.env.RESEND_API_KEY?.trim() || "";
  return {
    userId: "",
    source: "env",
    telegramEnabled: Boolean(token && chatId),
    telegramVerified: Boolean(token && chatId),
    telegramToken: token,
    telegramChatId: chatId,
    mailEnabled: Boolean(resend),
    mailProvider: resend ? "resend" : "none",
    mailAddress: "",
    mailCredential: resend,
    kakaoEnabled: false,
    kakaoVerified: false,
    gasMailEnabled: false,
    gasWebUrl: "",
    notifyPaymentReady: true,
    notifyDailyReport: true,
    notifyErrorAlert: true,
    notifySettlement: true,
  };
}

export async function loadEffectiveNotify(explicitUserId: string): Promise<EffectiveNotify> {
  const userId = explicitUserId.trim() || (await soleUserId("user_notification_settings")) || (await soleUserId("user_settings"));
  if (!userId) return envEffective();
  const row = await readNotifyRow(userId);
  if (row) {
    const effective = prefsFrom(row, "account");
    if (!effective.gasWebUrl) {
      const legacy = await legacyConfig(userId);
      if (legacy?.gasWebUrl) effective.gasWebUrl = String(legacy.gasWebUrl);
    }
    if (effective.mailProvider === "resend" && !effective.mailCredential) {
      effective.mailCredential = process.env.RESEND_API_KEY?.trim() || "";
    }
    return effective;
  }
  const legacy = await legacyConfig(userId);
  if (!legacy) return envEffective();
  const token = String(legacy.telegramToken || "");
  const chatId = String(legacy.telegramChatId || "");
  const gmail = String(legacy.gmailAppPassword || "");
  const email = String(legacy.email || "");
  return {
    userId,
    source: "legacy",
    telegramEnabled: Boolean(token && chatId),
    telegramVerified: Boolean(token && chatId),
    telegramToken: token,
    telegramChatId: chatId,
    mailEnabled: Boolean(legacy.emailNotify && email && gmail),
    mailProvider: gmail ? "gmail_smtp" : "none",
    mailAddress: email,
    mailCredential: gmail,
    kakaoEnabled: false,
    kakaoVerified: false,
    gasMailEnabled: true,
    gasWebUrl: String(legacy.gasWebUrl || ""),
    notifyPaymentReady: true,
    notifyDailyReport: true,
    notifyErrorAlert: true,
    notifySettlement: true,
  };
}
