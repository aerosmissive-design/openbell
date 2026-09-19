import assert from "node:assert/strict";
import { test } from "node:test";
import { isFalseyFlag, isPaymentAutomationLocked, parseEnvFile } from "./env.js";

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
