import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";

function assertOwner(owner: string, requested?: string) {
  if (requested && requested !== owner) throw new Error("FORBIDDEN");
}

const SaveInput = z.object({
  userId: z.string().optional(),
  telegramEnabled: z.boolean(),
  telegramChatId: z.string().max(80).default(""),
  telegramToken: z.string().max(200).optional(),
  mailProvider: z.enum(["gmail_smtp", "resend", "none"]),
  mailAddress: z.string().max(200).default(""),
  mailCredential: z.string().max(300).optional(),
  mailEnabled: z.boolean(),
  kakaoChannelId: z.string().max(80).default(""),
  kakaoApiKey: z.string().max(300).optional(),
  gasMailEnabled: z.boolean(),
  gasWebUrl: z.string().max(400).default(""),
  notifyPaymentReady: z.boolean(),
  notifyDailyReport: z.boolean(),
  notifyErrorAlert: z.boolean(),
  notifySettlement: z.boolean(),
});

export const loadNotifySettings = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { emptyView, readNotifyRow, viewFromRow } = await import("./store.server");
    const row = await readNotifyRow(context.userId);
    return row ? viewFromRow(row) : emptyView();
  });

export const saveNotifySettings = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(SaveInput)
  .handler(async ({ context, data }) => {
    assertOwner(context.userId, data.userId);
    const { saveNotifyRow } = await import("./store.server");
    return saveNotifyRow(context.userId, data);
  });

export const verifyNotifyTelegram = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ userId: z.string().optional(), token: z.string().max(200).optional(), chatId: z.string().max(80) }))
  .handler(async ({ context, data }) => {
    assertOwner(context.userId, data.userId);
    const { markTelegramVerified, readNotifyRow } = await import("./store.server");
    const { openNotifySecret } = await import("./crypto.server");
    const { verifyTelegramBot } = await import("./telegram");
    const row = await readNotifyRow(context.userId);
    const token = data.token?.trim() && data.token.trim() !== "****"
      ? data.token.trim()
      : openNotifySecret(String(row?.telegram_bot_token || ""));
    const result = await verifyTelegramBot(token, data.chatId);
    if (row) await markTelegramVerified(context.userId, result.ok);
    return result;
  });

export const sendNotifyTest = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({
    userId: z.string().optional(),
    eventType: z.enum(["PAYMENT_READY", "DAILY_REPORT", "ERROR_ALERT", "SETTLEMENT"]).default("PAYMENT_READY"),
  }))
  .handler(async ({ context, data }) => {
    assertOwner(context.userId, data.userId);
    const { dispatchNotification } = await import("./index");
    return dispatchNotification({
      eventType: data.eventType,
      userId: context.userId,
      serverId: "settings-test",
      payload: { is_test: true, text: "dummy" },
      timestamp: new Date().toISOString(),
    });
  });
