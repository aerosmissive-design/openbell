import assert from "node:assert/strict";
import test from "node:test";
import { createMetaReadCache, META_READ_TTL_MS } from "./meta-read-cache.ts";

test("meta read cache keeps a value for 45s, including an empty string", () => {
  const cache = createMetaReadCache(META_READ_TTL_MS);
  const start = 1_000_000;
  cache.set("seats", "{\"at\":1}", start);
  cache.set("missing", "", start);
  assert.equal(cache.get("seats", start + META_READ_TTL_MS - 1), "{\"at\":1}");
  assert.equal(cache.get("missing", start + 1), "");
  assert.equal(cache.get("seats", start + META_READ_TTL_MS), undefined);
  assert.equal(cache.get("other", start), undefined);
});

test("a later write replaces the cached app_meta value", () => {
  const cache = createMetaReadCache();
  cache.set("k", "a", 10);
  cache.set("k", "b", 20);
  assert.equal(cache.get("k", 30), "b");
});
