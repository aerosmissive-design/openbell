import assert from "node:assert/strict";
import test from "node:test";
import {
  legacyStatJson,
  parseSeatStat,
  reporterTimesFromStats,
  seatStatJson,
  seatStatKey,
} from "./seat-stat.ts";

test("seat stat key is the small sibling of a reporter source", () => {
  assert.equal(seatStatKey("pc", "cgv_yongsan"), "nas_seats_at:pc:cgv_yongsan");
  assert.equal(seatStatKey("nas", "megabox_coex"), "nas_seats_at:nas423:megabox_coex");
  assert.equal(seatStatKey("nas225", "cgv_yeongdeungpo"), "nas_seats_at:nas225:cgv_yeongdeungpo");
  assert.deepEqual(JSON.parse(seatStatJson(1_700_000_000_000, 42)), { at: 1_700_000_000_000, count: 42 });
  assert.deepEqual(JSON.parse(legacyStatJson(1_700_000_000_000, "nas", 7)), {
    at: 1_700_000_000_000,
    source: "nas423",
    n: 7,
  });
});

test("parseSeatStat reads {at,count}, GAS {at,n}, and a full row blob", () => {
  assert.deepEqual(parseSeatStat(seatStatJson(50, 3), "pc"), { at: 50, count: 3, source: "pc" });
  assert.deepEqual(parseSeatStat(legacyStatJson(60, "nas225", 4)), { at: 60, count: 4, source: "nas225" });
  const blob = JSON.stringify({
    at: 70,
    source: "pc",
    rows: [{ restSeats: 1 }, { restSeats: 2 }],
  });
  assert.equal(parseSeatStat(blob)?.count, 2);
  assert.equal(parseSeatStat(""), null);
  assert.equal(parseSeatStat("{"), null);
});

test("reporter clocks skip stale sources and fall back to legacy", () => {
  const now = 1_000_000;
  const maxAge = 30 * 60 * 1000;
  const fresh = reporterTimesFromStats(
    {
      pc: { at: now - 1000, count: 2, source: "pc" },
      nas423: { at: now - maxAge - 1, count: 9, source: "nas423" },
    },
    { at: now - 500, count: 1, source: "nas225" },
    now,
    maxAge,
  );
  assert.deepEqual(Object.keys(fresh), ["g-pc"]);
  const stale = reporterTimesFromStats(
    { pc: { at: now - maxAge - 5, count: 2, source: "pc" } },
    { at: now - 1000, count: 4, source: "nas" },
    now,
    maxAge,
  );
  assert.equal(stale["g-nas423+"], new Date(now - 1000).toISOString());
  assert.equal("g-pc" in stale, false);
});
