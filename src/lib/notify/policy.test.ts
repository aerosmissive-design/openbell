import assert from "node:assert/strict";
import test from "node:test";
import {
  paymentReadyIdempotencyKey,
  resolveChannels,
} from "./policy.ts";
import type { NotifyPrefs } from "./types.ts";

const base: NotifyPrefs = {
  telegramEnabled: true,
  telegramVerified: true,
  mailEnabled: true,
  mailProvider: "gmail_smtp",
  kakaoEnabled: true,
  kakaoVerified: false,
  gasMailEnabled: true,
  notifyPaymentReady: true,
  notifyDailyReport: true,
  notifyErrorAlert: true,
  notifySettlement: true,
};

test("gas mail stays on the list and kakao alimtalk does not", () => {
  const channels = resolveChannels(base, "PAYMENT_READY");
  assert.deepEqual(channels, ["gas_mail", "telegram", "mail"]);
});

test("gas mail toggle off drops only that channel", () => {
  const channels = resolveChannels({ ...base, gasMailEnabled: false }, "ERROR_ALERT");
  assert.deepEqual(channels, ["telegram", "mail"]);
});

test("unverified telegram is not sent", () => {
  const channels = resolveChannels(
    { ...base, telegramVerified: false, mailEnabled: false, gasMailEnabled: false },
    "DAILY_REPORT",
  );
  assert.deepEqual(channels, []);
});

test("event switch blocks every channel", () => {
  assert.deepEqual(
    resolveChannels({ ...base, notifySettlement: false }, "SETTLEMENT"),
    [],
  );
});

test("idempotency key uses the minute", () => {
  const key = paymentReadyIdempotencyKey(
    "pc",
    "order-1",
    new Date("2026-10-04T10:22:59.000Z"),
  );
  assert.equal(key, "pc:order-1:2026-10-04T10:22");
});
