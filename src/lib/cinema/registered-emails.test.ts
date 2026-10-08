import assert from "node:assert/strict";
import test from "node:test";
import { collectRegisteredEmails, isAccountEmail } from "./registered-emails.ts";

test("registered emails are trimmed, unique, and sorted", () => {
  const emails = collectRegisteredEmails(
    [" Aero@Example.com ", "aero"],
    ["aero@example.com", "second@example.com"],
    ["", "not-an-email", "second@example.com"],
  );
  assert.deepEqual(emails, ["aero@example.com", "second@example.com"]);
});

test("a short account name is not an email", () => {
  assert.equal(isAccountEmail("aero"), false);
  assert.equal(isAccountEmail("person@example.com"), true);
});
