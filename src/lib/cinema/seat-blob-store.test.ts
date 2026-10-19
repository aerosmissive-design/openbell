import assert from "node:assert/strict";
import test from "node:test";
import {
  __resetSeatBlobStoreForTests,
  decodeSeatRows,
  encodeSeatRow,
  monthlySeatBlobEgressBytes,
  payloadFromGasBlob,
  planSeatBlobCache,
  readSeatBlobs,
  RUNTIME_CACHE_ITEM_LIMIT,
  SEAT_BLOB_COUNT_DELTA,
  SEAT_BLOB_NEON_INTERVAL_MS,
  SEAT_GAS_STALE_MS,
  seatBlobCachePuts,
  shouldWriteNeonSeatBlob,
  unpackSeatBlob,
} from "./seat-blob-store.ts";

function row(n: number, title = "영화") {
  return {
    playDate: "20261019",
    startTime: "19:30",
    hallName: "IMAX",
    movieTitle: `${title}-${n}`,
    movieNo: String(1000 + n),
    bookingUrl: `https://cgv.co.kr/book?n=${n}&x=${"u".repeat(40)}`,
    scnsNo: "01",
    scnSseq: "1",
    restSeats: n,
    totalSeats: 200,
    status: "open",
  };
}

function payload(count: number, at = 5000) {
  return JSON.stringify({
    at,
    rows: Array.from({ length: count }, (_, i) => row(i)),
    mode: "full",
    source: "pc",
    sourceId: "pc:box",
    displayGroup: "G_PC",
  });
}

test("seat blob reads use Runtime Cache, then GAS, then Neon", async () => {
  const cacheKey = "nas_seats:pc:cgv_yongsan";
  const gasKey = "nas_seats:nas423:cgv_yongsan";
  const dbKey = "nas_seats:nas225:cgv_yongsan";
  const calls: string[] = [];
  const cacheBody = payload(1, 11);
  const gasBody = payload(1, 22);
  const dbBody = payload(1, 33);
  const blobs = await readSeatBlobs([cacheKey, gasKey, dbKey], {
    cacheGet: async (key) => {
      calls.push(`cache:${key}`);
      return key === cacheKey ? cacheBody : null;
    },
    gasRead: async (keys) => {
      calls.push(`gas:${keys.join(",")}`);
      return { [gasKey]: gasBody };
    },
    dbRead: async (keys) => {
      calls.push(`db:${keys.join(",")}`);
      return { [dbKey]: dbBody };
    },
  });
  assert.equal(blobs[cacheKey], cacheBody);
  assert.equal(blobs[gasKey], gasBody);
  assert.equal(blobs[dbKey], dbBody);
  assert.equal(calls.some((item) => item.startsWith("gas")), true);
  assert.equal(calls.includes(`gas:${gasKey},${dbKey}`) || calls.includes(`gas:${dbKey},${gasKey}`), true);
  assert.equal(calls.includes(`db:${dbKey}`), true);
  assert.equal(calls.some((item) => item.startsWith("db:") && item.includes(cacheKey)), false);
  assert.equal(calls.some((item) => item.startsWith("db:") && item.includes(gasKey)), false);
});

test("a Runtime Cache hit does not call GAS or Neon", async () => {
  const key = "nas_seats:pc:megabox_coex";
  let gas = 0;
  let db = 0;
  const blobs = await readSeatBlobs([key], {
    cacheGet: async () => payload(1, 9),
    gasRead: async () => {
      gas += 1;
      return {};
    },
    dbRead: async () => {
      db += 1;
      return {};
    },
  });
  assert.match(blobs[key], /"at":9/);
  assert.equal(gas, 0);
  assert.equal(db, 0);
});

test("GAS covers a cache miss and Neon is not called", async () => {
  const key = "nas_seats:nas423:megabox_coex";
  let db = 0;
  const blobs = await readSeatBlobs([key], {
    cacheGet: async () => null,
    gasRead: async (keys) => {
      assert.deepEqual(keys, [key]);
      return { [key]: payload(1, 8) };
    },
    dbRead: async () => {
      db += 1;
      return {};
    },
  });
  assert.match(blobs[key], /"at":8/);
  assert.equal(db, 0);
});

test("both caches missing fall through to Neon", async () => {
  const key = "nas_seats:nas225:cgv_yeongdeungpo";
  const blobs = await readSeatBlobs([key], {
    cacheGet: async () => null,
    gasRead: async () => ({}),
    dbRead: async (keys) => {
      assert.deepEqual(keys, [key]);
      return { [key]: payload(1, 7) };
    },
  });
  assert.match(blobs[key], /"at":7/);
});

test("Neon seat blob writes wait ten minutes unless the row count jumps or the cache write failed", () => {
  const now = 1_700_000_000_000;
  assert.equal(SEAT_BLOB_NEON_INTERVAL_MS, 10 * 60 * 1000);
  assert.equal(SEAT_BLOB_COUNT_DELTA, 20);
  assert.equal(
    shouldWriteNeonSeatBlob({ now, lastAt: 0, lastCount: 0, count: 40, cacheOk: true }),
    true,
  );
  assert.equal(
    shouldWriteNeonSeatBlob({
      now,
      lastAt: now - SEAT_BLOB_NEON_INTERVAL_MS + 1,
      lastCount: 40,
      count: 41,
      cacheOk: true,
    }),
    false,
  );
  assert.equal(
    shouldWriteNeonSeatBlob({
      now,
      lastAt: now - SEAT_BLOB_NEON_INTERVAL_MS,
      lastCount: 40,
      count: 40,
      cacheOk: true,
    }),
    true,
  );
  assert.equal(
    shouldWriteNeonSeatBlob({
      now,
      lastAt: now - 60_000,
      lastCount: 40,
      count: 40 + SEAT_BLOB_COUNT_DELTA - 1,
      cacheOk: true,
    }),
    false,
  );
  assert.equal(
    shouldWriteNeonSeatBlob({
      now,
      lastAt: now - 60_000,
      lastCount: 40,
      count: 40 + SEAT_BLOB_COUNT_DELTA,
      cacheOk: true,
    }),
    true,
  );
  assert.equal(
    shouldWriteNeonSeatBlob({ now, lastAt: now - 1000, lastCount: 40, count: 40, cacheOk: false }),
    true,
  );
});

test("a blob over the Runtime Cache limit is stored as compact tab rows and round-trips", async () => {
  const raw = payload(3, 77);
  const limit = 180;
  assert.equal(raw.length > limit, true);
  const plan = planSeatBlobCache(raw, limit);
  assert.equal(plan.kind, "compact");
  assert.equal(plan.complete, true);
  if (plan.kind !== "compact") return;
  const store = new Map<string, unknown>();
  store.set("k", plan.manifest);
  plan.shards.forEach((shard, i) => store.set(`k#${i}`, shard));
  for (const [key, value] of store) {
    assert.equal(JSON.stringify(value).length <= limit, true, key);
  }
  const restored = await unpackSeatBlob("k", store.get("k"), async (shardKey) => store.get(shardKey) ?? null);
  const parsed = JSON.parse(restored) as { at: number; rows: { bookingUrl?: string; movieTitle?: string; restSeats?: number }[] };
  assert.equal(parsed.at, 77);
  assert.equal(parsed.rows.length, 3);
  assert.equal(parsed.rows[1]?.restSeats, 1);
  assert.equal(parsed.rows[1]?.bookingUrl, row(1).bookingUrl);
  assert.equal(parsed.rows[2]?.movieTitle, "영화-2");
  const line = encodeSeatRow(row(1));
  assert.equal(decodeSeatRows(line)[0]?.hallName, "IMAX");
  assert.equal(plan.manifest.body ? plan.shards.length === 0 : plan.shards.length > 0, true);
});

test("GAS reporter JSON becomes the same payload string", () => {
  const encoded = payloadFromGasBlob({
    at: 12,
    source: "nas423",
    rows: [{ playDate: "20261019", startTime: "10:00", hallName: "1관", movieTitle: "A", restSeats: 4 }],
  });
  assert.equal(JSON.parse(encoded).rows[0].restSeats, 4);
  assert.equal(payloadFromGasBlob({ at: 1, n: 3 }), "");
  assert.equal(payloadFromGasBlob("openbell"), "");
});

test("steady cache hits drop seat-blob Neon egress to zero", () => {
  assert.equal(RUNTIME_CACHE_ITEM_LIMIT, 2_000_000);
  const before = monthlySeatBlobEgressBytes({
    blobBytes: 320_000,
    blobCount: 4,
    scansPerDay: 480,
    neonReadRate: 1,
  });
  const after = monthlySeatBlobEgressBytes({
    blobBytes: 320_000,
    blobCount: 4,
    scansPerDay: 480,
    neonReadRate: 0,
  });
  assert.equal(before, 320_000 * 4 * 480 * 30);
  assert.equal(after, 0);
});

test("shard puts publish the manifest last and a missing shard is not a payload", async () => {
  const raw = payload(4, 77);
  let puts: { key: string; value: unknown }[] | null = null;
  for (let limit = 80; limit < raw.length; limit += 15) {
    const plan = seatBlobCachePuts("k", raw, limit);
    if (plan && plan.length > 2 && plan[plan.length - 1]?.key === "k") {
      puts = plan;
      break;
    }
  }
  assert.ok(puts);
  if (!puts) return;
  const head = puts[puts.length - 1]!;
  const manifest = head.value as { shardGen?: string };
  assert.equal(typeof manifest.shardGen, "string");
  assert.ok(manifest.shardGen);
  puts.slice(0, -1).forEach((put, index) => {
    assert.equal(put.key, `k#${manifest.shardGen}#${index}`);
  });
  const store = new Map(puts.map((put) => [put.key, put.value]));
  const whole = await unpackSeatBlob("k", store.get("k"), async (shardKey) => store.get(shardKey) ?? null);
  assert.equal(JSON.parse(whole).at, 77);
  store.delete(puts[0]!.key);
  const broken = await unpackSeatBlob("k", store.get("k"), async (shardKey) => store.get(shardKey) ?? null);
  assert.equal(broken, "");
});

test("stale GAS does not hide a newer Neon blob", async () => {
  const key = "nas_seats:pc:cgv_yongsan";
  const gasAt = 1_000_000;
  const knownAt = gasAt + SEAT_GAS_STALE_MS + 1;
  let db = 0;
  const puts: string[] = [];
  const blobs = await readSeatBlobs([key], {
    cacheGet: async () => null,
    gasRead: async () => ({ [key]: payload(1, gasAt) }),
    knownAts: async () => ({ [key]: knownAt }),
    dbRead: async () => {
      db += 1;
      return { [key]: payload(1, knownAt) };
    },
    cachePut: async (cacheKey) => {
      puts.push(cacheKey);
    },
  });
  assert.equal(db, 1);
  assert.match(blobs[key] ?? "", new RegExp(`"at":${knownAt}`));
  assert.deepEqual(puts, [key]);
});

test("GAS inside the skew window does not read Neon", async () => {
  const key = "nas_seats:nas423:cgv_yongsan";
  const gasAt = 2_000_000;
  let db = 0;
  const blobs = await readSeatBlobs([key], {
    cacheGet: async () => null,
    gasRead: async () => ({ [key]: payload(1, gasAt) }),
    knownAts: async () => ({ [key]: gasAt + 60_000 }),
    dbRead: async () => {
      db += 1;
      return {};
    },
  });
  assert.equal(db, 0);
  assert.match(blobs[key] ?? "", /"at":2000000/);
});

test("stale GAS is kept when Neon is empty and is not written back to the cache", async () => {
  const key = "nas_seats:nas225:cgv_yongsan";
  const gasAt = 3_000_000;
  const knownAt = gasAt + SEAT_GAS_STALE_MS + 5_000;
  let puts = 0;
  const blobs = await readSeatBlobs([key], {
    cacheGet: async () => null,
    gasRead: async () => ({ [key]: payload(1, gasAt) }),
    knownAts: async () => ({ [key]: knownAt }),
    dbRead: async () => ({}),
    cachePut: async () => {
      puts += 1;
    },
  });
  assert.match(blobs[key] ?? "", /"at":3000000/);
  assert.equal(puts, 0);
});

test("a failed stat-clock check reads Neon instead of pinning GAS", async () => {
  const key = "nas_seats:pc:megabox_coex";
  let db = 0;
  let puts = 0;
  const blobs = await readSeatBlobs([key], {
    cacheGet: async () => null,
    gasRead: async () => ({ [key]: payload(1, 10) }),
    knownAts: async () => {
      throw new Error("stat down");
    },
    dbRead: async () => {
      db += 1;
      return { [key]: payload(1, 50) };
    },
    cachePut: async () => {
      puts += 1;
    },
  });
  assert.equal(db, 1);
  assert.match(blobs[key] ?? "", /"at":50/);
  assert.equal(puts, 1);
});

test("a Runtime Cache hit does not fill the cache again", async () => {
  const key = "nas_seats:pc:megabox_namyangju";
  let puts = 0;
  const blobs = await readSeatBlobs([key], {
    cacheGet: async () => payload(1, 4),
    gasRead: async () => ({}),
    dbRead: async () => ({}),
    cachePut: async () => {
      puts += 1;
    },
  });
  assert.match(blobs[key] ?? "", /"at":4/);
  assert.equal(puts, 0);
});

test("store reset clears throttle marks between cases", () => {
  __resetSeatBlobStoreForTests();
  assert.equal(shouldWriteNeonSeatBlob({ now: 10, lastAt: 0, lastCount: 0, count: 1, cacheOk: true }), true);
});
