import assert from "node:assert/strict";
import { test } from "node:test";
import { isFalseyFlag, isPaymentAutomationLocked, parseEnvFile, paymentReadyTtlMinutes } from "./env.js";

test("parseEnvFile skips comments, handles CRLF and quotes", () => {
  const parsed = parseEnvFile("# comment\r\nBOOKING_MOVIE=영화\r\nTOKEN='abc'\nEMPTY=\nNOEQ\n=novalue\n");
  assert.equal(parsed.BOOKING_MOVIE, "영화");
  assert.equal(parsed.TOKEN, "abc");
  assert.equal(parsed.EMPTY, "");
  assert.equal("NOEQ" in parsed, false);
});

test("PAYMENT_HARD_STOP=false is still locked", () => {
  assert.equal(isPaymentAutomationLocked("false"), true);
  assert.equal(isPaymentAutomationLocked("0"), true);
  assert.equal(isPaymentAutomationLocked(undefined), true);
  assert.equal(isFalseyFlag("false"), true);
  assert.equal(isFalseyFlag("true"), false);
});

test("paymentReadyTtlMinutes is display-only and defaults to 10", () => {
  assert.equal(paymentReadyTtlMinutes(undefined), 10);
  assert.equal(paymentReadyTtlMinutes(""), 10);
  assert.equal(paymentReadyTtlMinutes("not-a-number"), 10);
  assert.equal(paymentReadyTtlMinutes("600000"), 10);
  assert.equal(paymentReadyTtlMinutes("1200000"), 20);
});
