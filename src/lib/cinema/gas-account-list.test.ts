import assert from "node:assert/strict";
import test from "node:test";
import { decideAccountList, emailFromGasMeta, emailsFromGasSlots, gasAccountSlots } from "./gas-account-list.ts";

test("gas slots keep only https script hosts and drop duplicate urls", () => {
  const slots = gasAccountSlots({
    GAS_WEB_URL: "https://script.google.com/macros/s/aaa/dev",
    GAS_SYNC_KEY: "key-one",
    GAS_WEB_URL_AERO1: "http://script.google.com/macros/s/bbb/exec",
    GAS_SYNC_KEY_AERO1: "key-two",
    GAS_WEB_URL_AERO2: "https://evil.example/macros/s/ccc/exec",
    GAS_SYNC_KEY_AERO2: "key-three",
  });
  assert.equal(slots.length, 1);
  assert.equal(slots[0].url, "https://script.google.com/macros/s/aaa/exec");
  assert.equal(slots[0].key, "key-one");
});

test("meta json yields the mailbox and drops the web app url", () => {
  const text = JSON.stringify({
    ok: true,
    url: "https://script.google.com/macros/s/hidden/exec",
    id: "scriptid12345678",
    email: "Owner@Example.com",
    telegramToken: "should-not-leak",
  });
  assert.equal(emailFromGasMeta(text), "owner@example.com");
  assert.equal(emailFromGasMeta("<html>owner@example.com</html>"), "");
  assert.equal(emailFromGasMeta("openbell"), "");
  assert.equal(emailFromGasMeta(JSON.stringify({ email: "aero" })), "");
});

test("a vessel outage still returns mailboxes GAS already knows", () => {
  assert.deepEqual(decideAccountList(null, ["b@example.com", "a@example.com"]), {
    status: 200,
    accounts: ["a@example.com", "b@example.com"],
  });
  assert.deepEqual(decideAccountList(null, []), { status: 503 });
  assert.deepEqual(decideAccountList(["a@example.com"], ["b@example.com"]), {
    status: 200,
    accounts: ["a@example.com", "b@example.com"],
  });
  assert.deepEqual(decideAccountList([], []), { status: 200, accounts: [] });
});

test("meta fetch asks GAS without the sync key", async () => {
  const seen: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    seen.push(String(input));
    return new Response(
      JSON.stringify({
        ok: true,
        email: "owner@example.com",
        url: "https://script.google.com/macros/s/hidden/exec",
        id: "scriptid12345678",
      }),
      { status: 200 },
    );
  }) as typeof fetch;
  const rows = await emailsFromGasSlots(
    [{ url: "https://script.google.com/macros/s/aaa/exec", key: "sync-key-secret" }],
    fetchImpl,
    1000,
  );
  assert.equal(seen.length, 1);
  assert.equal(seen[0].includes("op=meta"), true);
  assert.equal(seen[0].includes("sync-key-secret"), false);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].email, "owner@example.com");
  assert.equal(rows[0].scriptId, "scriptid12345678");
  assert.equal(JSON.stringify({ ok: true, accounts: rows.map((row) => row.email) }).includes("script.google.com"), false);
});
