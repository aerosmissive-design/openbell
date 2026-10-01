import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSourceKey, seatReportStatus, sourceTypeOf } from "./source-key.ts";

test("normalizeSourceKey splits instance and display group", () => {
  assert.deepEqual(normalizeSourceKey("G_PC:PC01"), { sourceId: "G_PC:PC01", displayGroup: "G_PC" });
  assert.deepEqual(normalizeSourceKey("G_PC"), { sourceId: "G_PC:unknown", displayGroup: "G_PC" });
  assert.deepEqual(normalizeSourceKey("pc"), { sourceId: "G_PC:unknown", displayGroup: "G_PC" });
  assert.equal(normalizeSourceKey("G_DS423+:ds423").displayGroup, "G_DS423+");
  assert.equal(normalizeSourceKey("nas225").sourceId, "G_DS225+:unknown");
});

test("seat status keeps a number and a reason", () => {
  assert.equal(seatReportStatus(3), "available");
  assert.equal(seatReportStatus(0), "soldout");
  assert.equal(seatReportStatus(0, "scrape_failed"), "scrape_failed");
});

test("source type ranks official above fallback above cache", () => {
  assert.equal(sourceTypeOf("official"), "official");
  assert.equal(sourceTypeOf("g-pc"), "fallback");
  assert.equal(sourceTypeOf("last-known"), "cache");
});
