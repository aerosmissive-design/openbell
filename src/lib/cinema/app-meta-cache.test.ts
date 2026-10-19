import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Sql } from "@/lib/db";
import { setMetaClockForTests } from "./meta-read-cache.ts";

// db.ts boots PGLite when DATABASE_URL is empty, and that boot calls Vite's
// import.meta.glob. A closed local URL keeps this file on the lazy Neon path.
// The tests inject a fake client and never call getSql().
if (!process.env.DATABASE_URL?.trim()) {
  process.env.DATABASE_URL = "postgres://127.0.0.1:1/openbell_meta_cache_test";
}

const {
  __clearDbDegradedForTests,
  __resetAppMetaForTests,
  __setMetaSqlForTests,
  readAppMetas,
  writeAppMeta,
} = await import("./app-meta.server.ts");

function quotaError() {
  const err = new Error("exceeded the quota") as Error & { code: string };
  err.code = "53000";
  return err;
}

function fakeSql(store: Map<string, string>, selects: { n: number }, fail: { quota: boolean }): Sql {
  const query = async (text: string, params?: unknown[]) => {
    if (fail.quota) throw quotaError();
    if (/^select/i.test(text)) {
      selects.n += 1;
      const keys = (params?.[0] as string[]) ?? [];
      return keys.filter((key) => store.has(key)).map((key) => ({ key, value: store.get(key) ?? "" }));
    }
    if (/insert into app_meta/i.test(text)) {
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
  const selects = { n: 0 };
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
  const selects = { n: 0 };
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
});
