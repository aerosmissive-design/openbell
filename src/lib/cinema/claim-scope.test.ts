import assert from "node:assert/strict";
import test from "node:test";
import { claimEmailScope, legacyClaimPlan } from "./claim-scope.ts";

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

test("a mailbox claim keeps that account and jobs with no account", () => {
  assert.deepEqual(legacyClaimPlan({ kind: "emails", emails: ["a@b.c"] }, []), {
    userIds: [],
    includeUnscoped: true,
  });
  assert.deepEqual(legacyClaimPlan({ kind: "emails", emails: ["a@b.c"] }, ["user-1"]), {
    userIds: ["user-1"],
    includeUnscoped: true,
  });
});

test("an empty mailbox list claims nothing and an omitted list stays open", () => {
  assert.equal(legacyClaimPlan({ kind: "none" }, ["user-1"]), null);
  assert.deepEqual(legacyClaimPlan({ kind: "all" }, []), {
    userIds: null,
    includeUnscoped: true,
  });
});
