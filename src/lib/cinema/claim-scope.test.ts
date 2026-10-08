import assert from "node:assert/strict";
import test from "node:test";
import { claimEmailScope } from "./claim-scope.ts";

test("omitted emails keep the legacy claim", () => {
  assert.deepEqual(claimEmailScope(undefined), { kind: "all" });
});

test("an empty or short-name list claims nothing", () => {
  assert.deepEqual(claimEmailScope([]), { kind: "none" });
  assert.deepEqual(claimEmailScope(["aero", "aero1"]), { kind: "none" });
  assert.deepEqual(claimEmailScope("a@b.c"), { kind: "none" });
});

test("only mailboxes are kept and duplicates drop", () => {
  assert.deepEqual(claimEmailScope([" Aero ", "B@Example.com", "b@example.com"]), {
    kind: "emails",
    emails: ["b@example.com"],
  });
});
