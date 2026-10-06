import assert from "node:assert/strict";
import test from "node:test";
import { keepTypedConfig } from "./keep-typed.ts";

test("empty remote gas url and mail do not erase local", () => {
  const kept = keepTypedConfig(
    {
      email: "",
      gmailAppPassword: "",
      telegramToken: "",
      telegramChatId: "",
      gasWebUrl: "",
      gasSyncKey: "",
      gasScriptId: "",
      emailNotify: false,
    },
    {
      email: "a@b.c",
      gmailAppPassword: "app",
      telegramToken: "tg",
      telegramChatId: "1",
      gasWebUrl: "https://script.google.com/macros/s/abc/exec",
      gasSyncKey: "local-key",
      gasScriptId: "script",
      emailNotify: true,
    },
  );
  assert.equal(kept.email, "a@b.c");
  assert.equal(kept.gmailAppPassword, "app");
  assert.equal(kept.telegramToken, "tg");
  assert.equal(kept.gasWebUrl, "https://script.google.com/macros/s/abc/exec");
  assert.equal(kept.gasSyncKey, "local-key");
  assert.equal(kept.emailNotify, true);
});

test("a filled remote value stays", () => {
  const kept = keepTypedConfig(
    { gasWebUrl: "https://script.google.com/macros/s/new/exec", email: "new@b.c" },
    { gasWebUrl: "https://script.google.com/macros/s/old/exec", email: "old@b.c" },
  );
  assert.equal(kept.gasWebUrl, "https://script.google.com/macros/s/new/exec");
  assert.equal(kept.email, "new@b.c");
});
