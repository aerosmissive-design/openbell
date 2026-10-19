import assert from "node:assert/strict";
import test from "node:test";
import {
  loadWatchUserRows,
  monthlyWatchTickEgressBytes,
  shouldPersistWatch,
  type WatchFatRow,
  type WatchQuery,
  type WatchRowCache,
} from "./watch-row-cache.ts";

function memoryCache(): WatchRowCache & { store: Map<string, { rev: string; row: WatchFatRow }> } {
  const store = new Map<string, { rev: string; row: WatchFatRow }>();
  return {
    store,
    async get(userId, rev) {
      const hit = store.get(userId);
      return hit?.rev === rev ? hit.row : null;
    },
    async set(userId, rev, row) {
      store.set(userId, { rev, row });
    },
    async drop(userId) {
      store.delete(userId);
    },
  };
}

function fatRow(rev: string, hostSeen: string[] = ["show-1"]): Record<string, unknown> {
  return {
    user_id: "u1",
    rev,
    config: { daysAhead: 7 },
    queue: [],
    seen_dates: ["2026-10-01"],
    watch_sig: "sig",
    auto_movies: [],
    auto_shows: [],
    auto_fired: {},
    primed: "true",
    host_seen: hostSeen,
  };
}

test("a watch tick repeats the stamp and reloads the fat row only when xmin changes", async () => {
  const calls: string[] = [];
  let stampRev = "100";
  let fatRev = "100";
  const query: WatchQuery = async (text) => {
    calls.push(text.includes("seenByHost") ? "fat" : "stamp");
    if (!text.includes("seenByHost")) {
      return [
        { user_id: "u1", rev: stampRev, account_email: "a@b.c" },
        { user_id: "", rev: "9", account_email: "skip" },
        { user_id: "u1", rev: stampRev, account_email: "dup" },
      ];
    }
    return [fatRow(fatRev, ["show-1", "show-2"])];
  };
  const cache = memoryCache();
  const first = await loadWatchUserRows(query, cache, "pc");
  const second = await loadWatchUserRows(query, cache, "pc");
  assert.deepEqual(
    calls.filter((kind) => kind === "fat"),
    ["fat"],
  );
  assert.equal(second[0]?.rev, "100");
  assert.equal(second[0]?.account_email, "a@b.c");
  assert.deepEqual(second[0]?.host_seen, ["show-1", "show-2"]);
  assert.equal(first.length, 1);
  assert.equal(cache.store.get("u1")?.rev, "100");

  stampRev = "200";
  fatRev = "201";
  const third = await loadWatchUserRows(query, cache, "pc");
  assert.equal(calls.filter((kind) => kind === "fat").length, 2);
  assert.equal(third[0]?.rev, "201");
  assert.equal(cache.store.get("u1")?.rev, "201");
});

test("a user missing from the fat read is not invented", async () => {
  const query: WatchQuery = async (text) => {
    if (!text.includes("seenByHost")) return [{ user_id: "gone", rev: "1", account_email: "a@b.c" }];
    return [];
  };
  const rows = await loadWatchUserRows(query, memoryCache(), "pc");
  assert.deepEqual(rows, []);
});

test("an unchanged watch snapshot does not need a settings write", () => {
  const same = {
    prevPrimed: true,
    nextPrimed: true,
    prevSig: "sig",
    nextSig: "sig",
    prevDates: ["2026-10-01"],
    nextDates: ["2026-10-01"],
    prevSeen: ["b", "a"],
    nextSeen: ["b", "a"],
    prevQueue: [{ id: "q", restSeats: 3 }],
    nextQueue: [{ restSeats: 3, id: "q" }],
    prevFired: { k: "open" },
    nextFired: { k: "open" },
    alertCount: 0,
  };
  assert.equal(shouldPersistWatch(same), false);
  assert.equal(shouldPersistWatch({ ...same, nextPrimed: false }), true);
  assert.equal(shouldPersistWatch({ ...same, alertCount: 1 }), true);
  assert.equal(shouldPersistWatch({ ...same, nextSeen: ["b", "a", "c"] }), true);
  assert.equal(shouldPersistWatch({ ...same, nextQueue: [{ id: "q", restSeats: 2 }] }), true);
});

test("watch-tick settings egress drops to the stamp plus rare fat reloads", () => {
  // 3-minute tick, 2500-id host_seen cap plus config/queue (~220 KB), stamp is user_id + xmin + email.
  const ticksPerDay = 480;
  const fatBytes = 220_000;
  const stampBytes = 200;
  const reloadsPerDay = 4;
  const got = monthlyWatchTickEgressBytes({ ticksPerDay, fatBytes, stampBytes, reloadsPerDay });
  assert.equal(got.before, 3_168_000_000);
  assert.equal(got.after, 29_280_000);
});
