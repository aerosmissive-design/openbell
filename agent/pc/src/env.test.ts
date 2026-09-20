import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { agentVersion, isFalseyFlag, isPaymentAutomationLocked, parseEnvFile, paymentReadyTtlMinutes, resolveExistingStorageState } from "./env.js";

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

test("resolveExistingStorageState skips missing files so Playwright does not crash", () => {
  assert.equal(resolveExistingStorageState("/r", undefined, () => true), undefined);
  assert.equal(resolveExistingStorageState("/r", "  ", () => true), undefined);
  assert.equal(
    resolveExistingStorageState("/r", "cgv-storage.json", (p) => p.endsWith("cgv-storage.json")),
    resolve("/r", "cgv-storage.json"),
  );
  assert.equal(resolveExistingStorageState("/r", "missing.json", () => false), undefined);
});

test("agentVersion reads package.json via PC_ROOT", () => {
  const v = agentVersion("0.0.0-fallback");
  assert.match(v, /^\d+\.\d+\.\d+/);
  assert.notEqual(v, "0.0.0-fallback");
});
