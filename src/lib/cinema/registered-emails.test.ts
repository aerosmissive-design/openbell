import assert from "node:assert/strict";
import test from "node:test";
import { collectRegisteredEmails, isAccountEmail, registeredEmailFailure } from "./registered-emails.ts";

test("registered emails are trimmed, unique, and sorted", () => {
  const emails = collectRegisteredEmails(
    [" Aero@Example.com ", "aero"],
    ["aero@example.com", "second@example.com"],
    ["", "not-an-email", "second@example.com"],
  );
  assert.deepEqual(emails, ["aero@example.com", "second@example.com"]);
});

test("a database failure does not keep a connection string", () => {
  const failure = registeredEmailFailure({
    name: "error",
    message: "connect failed postgresql://user:secret@db.example/openbell exceeded the quota",
    code: "53000",
  });
  assert.equal(failure.reason, "dbQuota");
  assert.equal(failure.detail.includes("secret"), false);
  assert.equal(failure.detail.includes("postgresql://"), false);
});

test("a short account name is not an email", () => {
  assert.equal(isAccountEmail("aero"), false);
  assert.equal(isAccountEmail("person@example.com"), true);
});
