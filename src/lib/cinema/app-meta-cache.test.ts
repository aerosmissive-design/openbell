import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Sql } from "@/lib/db";
import { HOT_META_NEON_MS, monthlyHotMetaWrites, type HotMetaEntry } from "./hot-meta.ts";
import { setMetaClockForTests } from "./meta-read-cache.ts";

// db.ts boots PGLite when DATABASE_URL is empty, and that boot calls Vite's
// import.meta.glob. A closed local URL keeps this file on the lazy Neon path.
// The tests inject a fake client and never call getSql().
if (!process.env.DATABASE_URL?.trim()) {
  process.env.DATABASE_URL = "postgres://127.0.0.1:1/openbell_meta_cache_test";
}

const {
  __clearDbDegradedForTests,
  __dropMetaMemoryForTests,
  __resetAppMetaForTests,
  __setMetaSqlForTests,
  __setSharedMetaCacheForTests,
  appMetaFreshTrusted,
  readAppMetaFresh,
  readAppMetas,
  writeAppMeta,
} = await import("./app-meta.server.ts");

function quotaError() {
  const err = new Error("exceeded the quota") as Error & { code: string };
  err.code = "53000";
  return err;
}

function fakeSql(store: Map<string, string>, selects: { n: number; writes: number }, fail: { quota: boolean }): Sql {
  const query = async (text: string, params?: unknown[]) => {
    if (fail.quota) throw quotaError();
    if (/^select/i.test(text)) {
      selects.n += 1;
      const keys = (params?.[0] as string[]) ?? [];
      return keys.filter((key) => store.has(key)).map((key) => ({ key, value: store.get(key) ?? "" }));
    }
    if (/insert into app_meta/i.test(text)) {
      selects.writes += 1;
      store.set(String(params?.[0]), String(params?.[1]));
      return [];
    }
    return [];
  };
  return { query } as unknown as Sql;
}

describe("app_meta read cache", { concurrency: false }, () => {
test("readAppMetas uses the 45s cache and write-through", async () => {
  const store = new Map<string, string>([["a", "1"]]);
  const selects = { n: 0, writes: 0 };
  const fail = { quota: false };
  let now = 10_000;
  __resetAppMetaForTests(fakeSql(store, selects, fail));
  setMetaClockForTests(() => now);
  try {
    assert.equal((await readAppMetas(["a"])).a, "1");
    assert.equal((await readAppMetas(["a"])).a, "1");
    assert.equal(selects.n, 1);
    const wrote = await writeAppMeta("a", "2");
    assert.equal(wrote.ok, true);
    assert.equal((await readAppMetas(["a"])).a, "2");
    assert.equal(selects.n, 1);
    assert.equal(store.get("a"), "2");
    now += 45_000;
    assert.equal((await readAppMetas(["a"])).a, "2");
    assert.equal(selects.n, 2);
  } finally {
    __resetAppMetaForTests(null);
  }
});

test("a quota write stays in memory and is flushed once Neon accepts it", async () => {
  const store = new Map<string, string>();
  const selects = { n: 0, writes: 0 };
  const fail = { quota: true };
  __resetAppMetaForTests(fakeSql(store, selects, fail));
  try {
    const denied = await writeAppMeta("nas_seats_at:pc:cgv_yongsan", "{\"at\":9,\"count\":4}");
    assert.equal(denied.ok, false);
    if (denied.ok) return;
    assert.equal(denied.reason, "dbQuota");
    assert.equal((await readAppMetas(["nas_seats_at:pc:cgv_yongsan"]))["nas_seats_at:pc:cgv_yongsan"], "{\"at\":9,\"count\":4}");
    assert.equal(store.has("nas_seats_at:pc:cgv_yongsan"), false);
    fail.quota = false;
    __clearDbDegradedForTests();
    __setMetaSqlForTests(fakeSql(store, selects, fail));
    const stored = await writeAppMeta("nas_seats_at:pc:cgv_yongsan", "{\"at\":9,\"count\":4}");
    assert.equal(stored.ok, true);
    assert.equal(store.get("nas_seats_at:pc:cgv_yongsan"), "{\"at\":9,\"count\":4}");
  } finally {
    __resetAppMetaForTests(null);
  }
});

test("a hot stat skips Neon until the interval, and another instance reads the shared copy", async () => {
  const key = "nas_seats_at:pc:cgv_yongsan";
  const store = new Map<string, string>();
  const selects = { n: 0, writes: 0 };
  const fail = { quota: false };
  const shared = new Map<string, HotMetaEntry>();
  let now = 1_000_000;
  __resetAppMetaForTests(fakeSql(store, selects, fail));
  setMetaClockForTests(() => now);
  __setSharedMetaCacheForTests(shared);
  try {
    assert.equal((await writeAppMeta(key, "{\"at\":1,\"count\":1}")).ok, true);
    assert.equal((await writeAppMeta(key, "{\"at\":2,\"count\":2}")).ok, true);
    assert.equal(selects.writes, 1);
    assert.equal(store.get(key), "{\"at\":1,\"count\":1}");
    assert.equal((await readAppMetas([key]))[key], "{\"at\":2,\"count\":2}");
    const selectsBefore = selects.n;
    __dropMetaMemoryForTests();
    assert.equal((await readAppMetas([key]))[key], "{\"at\":2,\"count\":2}");
    assert.equal(selects.n, selectsBefore);
    now += HOT_META_NEON_MS;
    assert.equal((await writeAppMeta(key, "{\"at\":3,\"count\":3}")).ok, true);
    assert.equal(store.get(key), "{\"at\":3,\"count\":3}");
    assert.equal(selects.writes, 2);
  } finally {
    __resetAppMetaForTests(null);
  }
});

test("a shared-cache miss still writes every hot value, and a cold key always writes", async () => {
  const store = new Map<string, string>();
  const selects = { n: 0, writes: 0 };
  const fail = { quota: false };
  __resetAppMetaForTests(fakeSql(store, selects, fail));
  try {
    assert.equal((await writeAppMeta("reporter_seen:pc:cgv_yongsan", "1")).ok, true);
    assert.equal((await writeAppMeta("reporter_seen:pc:cgv_yongsan", "2")).ok, true);
    assert.equal(selects.writes, 2);
    __setSharedMetaCacheForTests(new Map());
    assert.equal((await writeAppMeta("device_registry_v1", "a")).ok, true);
    assert.equal((await writeAppMeta("device_registry_v1", "b")).ok, true);
    assert.equal(selects.writes, 4);
    assert.equal(store.get("device_registry_v1"), "b");
  } finally {
    __resetAppMetaForTests(null);
  }
});

test("a quota write is flushed on the next try even inside the hot interval", async () => {
  const key = "nas_seats_at:pc:cgv_yongsan";
  const store = new Map<string, string>();
  const selects = { n: 0, writes: 0 };
  const fail = { quota: false };
  const shared = new Map<string, HotMetaEntry>();
  let now = 2_000_000;
  __resetAppMetaForTests(fakeSql(store, selects, fail));
  setMetaClockForTests(() => now);
  __setSharedMetaCacheForTests(shared);
  try {
    assert.equal((await writeAppMeta(key, "{\"at\":1,\"count\":1}")).ok, true);
    __setSharedMetaCacheForTests("off");
    fail.quota = true;
    const denied = await writeAppMeta(key, "{\"at\":2,\"count\":2}");
    assert.equal(denied.ok, false);
    assert.equal(store.get(key), "{\"at\":1,\"count\":1}");
    __setSharedMetaCacheForTests(shared);
    fail.quota = false;
    __clearDbDegradedForTests();
    __setMetaSqlForTests(fakeSql(store, selects, fail));
    now += 1_000;
    const flushed = await writeAppMeta(key, "{\"at\":2,\"count\":2}");
    assert.equal(flushed.ok, true);
    assert.equal(store.get(key), "{\"at\":2,\"count\":2}");
  } finally {
    __resetAppMetaForTests(null);
  }
});

test("a Neon read does not drop a value that quota has not stored yet", async () => {
  const store = new Map<string, string>([["plain", "old"]]);
  const selects = { n: 0, writes: 0 };
  const fail = { quota: true };
  let now = 3_000_000;
  __resetAppMetaForTests(fakeSql(store, selects, fail));
  setMetaClockForTests(() => now);
  try {
    const denied = await writeAppMeta("plain", "new");
    assert.equal(denied.ok, false);
    fail.quota = false;
    __clearDbDegradedForTests();
    __setMetaSqlForTests(fakeSql(store, selects, fail));
    now += 46_000;
    assert.equal((await readAppMetas(["plain"])).plain, "new");
    assert.equal(store.get("plain"), "old");
  } finally {
    __resetAppMetaForTests(null);
  }
});

test("readAppMetaFresh sees a newer shared value while the 45s cache still has this instance", async () => {
  const key = "agent_seen_v1";
  const store = new Map<string, string>();
  const selects = { n: 0, writes: 0 };
  const fail = { quota: false };
  const shared = new Map<string, HotMetaEntry>();
  let now = 4_000_000;
  __resetAppMetaForTests(fakeSql(store, selects, fail));
  setMetaClockForTests(() => now);
  __setSharedMetaCacheForTests(shared);
  try {
    assert.equal((await writeAppMeta(key, "local")).ok, true);
    shared.set(key, { v: "shared-newer", neonAt: now, at: now + 5 });
    assert.equal((await readAppMetas([key]))[key], "local");
    assert.equal(await readAppMetaFresh(key), "shared-newer");
    assert.equal(selects.n, 0);
  } finally {
    __resetAppMetaForTests(null);
  }
});

test("an empty hot cache does not hide a newer shared value", async () => {
  const key = "nas_seats_at:pc:cgv_yongsan";
  const store = new Map<string, string>();
  const selects = { n: 0, writes: 0 };
  const fail = { quota: false };
  const shared = new Map<string, HotMetaEntry>();
  let now = 5_000_000;
  __resetAppMetaForTests(fakeSql(store, selects, fail));
  setMetaClockForTests(() => now);
  __setSharedMetaCacheForTests(shared);
  try {
    assert.equal((await readAppMetas([key]))[key], "");
    assert.equal(selects.n, 1);
    shared.set(key, { v: "{\"at\":4,\"count\":4}", neonAt: now, at: now + 1 });
    assert.equal((await readAppMetas([key]))[key], "{\"at\":4,\"count\":4}");
    assert.equal(selects.n, 1);
  } finally {
    __resetAppMetaForTests(null);
  }
});

test("a failed shared read of a clean hot key still reads Neon and does not write it back", async () => {
  const hot = "reporter_instances";
  const store = new Map<string, string>([[hot, "newer"]]);
  const selects = { n: 0, writes: 0 };
  const fail = { quota: false };
  __resetAppMetaForTests(fakeSql(store, selects, fail));
  __setSharedMetaCacheForTests("off");
  try {
    assert.equal((await writeAppMeta(hot, "local")).ok, true);
    store.set(hot, "newer");
    __setSharedMetaCacheForTests("error");
    assert.equal(await readAppMetaFresh(hot), "newer");
    assert.equal(appMetaFreshTrusted(hot), false);
    assert.equal(store.get(hot), "newer");
    assert.equal(selects.writes, 1);
  } finally {
    __resetAppMetaForTests(null);
  }
});

test("a dirty hot value survives a failed shared read", async () => {
  const hot = "reporter_instances";
  const store = new Map<string, string>([[hot, "old"]]);
  const selects = { n: 0, writes: 0 };
  const fail = { quota: true };
  __resetAppMetaForTests(fakeSql(store, selects, fail));
  try {
    const denied = await writeAppMeta(hot, "dirty");
    assert.equal(denied.ok, false);
    __setSharedMetaCacheForTests("error");
    __clearDbDegradedForTests();
    fail.quota = false;
    __setMetaSqlForTests(fakeSql(store, selects, fail));
    assert.equal(await readAppMetaFresh(hot), "dirty");
    assert.equal(appMetaFreshTrusted(hot), false);
    assert.equal(store.get(hot), "old");
  } finally {
    __resetAppMetaForTests(null);
  }
});

test("an unchanged hot value still reaches Neon once the interval has elapsed", async () => {
  const key = "nas_seats_at:pc:cgv_yongsan";
  const store = new Map<string, string>();
  const selects = { n: 0, writes: 0 };
  const fail = { quota: false };
  const shared = new Map<string, HotMetaEntry>();
  let now = 6_000_000;
  __resetAppMetaForTests(fakeSql(store, selects, fail));
  setMetaClockForTests(() => now);
  __setSharedMetaCacheForTests(shared);
  try {
    assert.equal((await writeAppMeta(key, "1")).ok, true);
    shared.set(key, { v: "2", neonAt: now, at: now + 1000 });
    now += 45_000;
    assert.equal((await readAppMetas([key]))[key], "2");
    now = 6_000_000 + HOT_META_NEON_MS;
    assert.equal((await writeAppMeta(key, "2")).ok, true);
    assert.equal(store.get(key), "2");
    assert.equal(selects.writes, 2);
  } finally {
    __resetAppMetaForTests(null);
  }
});

test("a failed shared read is not trusted for a hot key", async () => {
  const hot = "reporter_instances";
  const store = new Map<string, string>([
    [hot, "[]"],
    ["device_registry_v1", "reg"],
  ]);
  const selects = { n: 0, writes: 0 };
  const fail = { quota: false };
  __resetAppMetaForTests(fakeSql(store, selects, fail));
  __setSharedMetaCacheForTests("error");
  try {
    assert.equal(await readAppMetaFresh(hot), "[]");
    assert.equal(appMetaFreshTrusted(hot), false);
    assert.equal(await readAppMetaFresh("device_registry_v1"), "reg");
    assert.equal(appMetaFreshTrusted("device_registry_v1"), true);
  } finally {
    __resetAppMetaForTests(null);
  }
});

test("hot stat writes per month follow the distinct-key flush", () => {
  const got = monthlyHotMetaWrites({
    reportsPerMin: 12,
    writesPerReport: 4,
    distinctKeys: 29,
    flushMin: 5,
  });
  assert.equal(got.before, 2_073_600);
  assert.equal(got.after, 250_560);
});
});
