import assert from "node:assert/strict";
import test from "node:test";
import { autoPayEnabled, bookingDeviceName, gasUrlForNotifyEmail, mergeAgentSeen, notifyMailbox, readAgentSeen } from "./booking-link.ts";

test("only the three agent names connect", () => {
  assert.equal(bookingDeviceName("G_PC"), "G_PC");
  assert.equal(bookingDeviceName(" G_DS423+ "), "G_DS423+");
  assert.equal(bookingDeviceName("G_DS225+"), "G_DS225+");
  assert.equal(bookingDeviceName("aero"), "");
  assert.equal(bookingDeviceName(""), "");
});

test("auto pay stays off unless the choice is on", () => {
  assert.equal(autoPayEnabled(undefined), false);
  assert.equal(autoPayEnabled(""), false);
  assert.equal(autoPayEnabled("off"), false);
  assert.equal(autoPayEnabled("on"), true);
  assert.equal(autoPayEnabled(true), true);
});

test("a notify mailbox is one email", () => {
  assert.equal(notifyMailbox(" A@B.C "), "a@b.c");
  assert.equal(notifyMailbox("aero"), "");
  assert.equal(notifyMailbox(""), "");
});

test("payment mail uses only the script that owns that mailbox", () => {
  const found = [
    { url: "https://example.test/a", email: "a@b.c" },
    { url: "https://example.test/b", email: "B@B.c" },
  ];
  assert.equal(gasUrlForNotifyEmail(found, "b@b.c"), "https://example.test/b");
  assert.equal(gasUrlForNotifyEmail(found, "c@b.c"), "");
  assert.equal(gasUrlForNotifyEmail([{ url: "http://example.test/plain", email: "a@b.c" }], "a@b.c"), "");
});

test("a seen mark keeps the other agents", () => {
  const next = mergeAgentSeen(JSON.stringify({ "G_PC": "t0", "G_DS225+": "t1" }), "G_DS423+", "t2");
  assert.deepEqual(readAgentSeen(next), [
    { name: "G_PC", seenAt: "t0" },
    { name: "G_DS225+", seenAt: "t1" },
    { name: "G_DS423+", seenAt: "t2" },
  ]);
});
