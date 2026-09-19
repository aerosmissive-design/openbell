import assert from "node:assert/strict";
import { test } from "node:test";
import { rankSeatBlocks, type SeatPoint } from "./seat-ranker.js";

function seat(id: string, row: string, number: number, extra: Partial<SeatPoint> = {}): SeatPoint {
  return { id, row, number, available: true, ...extra };
}

test("prefers contiguous block near row center", () => {
  const seats: SeatPoint[] = [
    seat("E1", "E", 1),
    seat("E2", "E", 2),
    seat("E3", "E", 3),
    seat("E4", "E", 4),
    seat("E5", "E", 5),
    seat("E6", "E", 6),
    seat("E7", "E", 7),
    seat("E8", "E", 8),
  ];
  const blocks = rankSeatBlocks(seats, { count: 2 });
  assert.ok(blocks.length > 0);
  assert.deepEqual(
    blocks[0].seats.map((s) => s.id),
    ["E4", "E5"],
  );
});

test("preferredRowDistance filters far rows", () => {
  const seats: SeatPoint[] = [
    seat("A1", "A", 1),
    seat("A2", "A", 2),
    seat("E4", "E", 4),
    seat("E5", "E", 5),
  ];
  const near = rankSeatBlocks(seats, {
    count: 2,
    preferredRow: "E",
    preferredRowDistance: 1,
  });
  assert.equal(near.length, 1);
  assert.deepEqual(
    near[0].seats.map((s) => s.id),
    ["E4", "E5"],
  );

  const none = rankSeatBlocks(seats, {
    count: 2,
    preferredRow: "E",
    preferredRowDistance: 0,
  });
  // Only row E is distance 0; A is filtered out.
  assert.equal(none.length, 1);
  assert.equal(none[0].seats[0].row, "E");

  const empty = rankSeatBlocks(
    [seat("A1", "A", 1), seat("A2", "A", 2)],
    { count: 2, preferredRow: "E", preferredRowDistance: 1 },
    { allowDistanceFallback: false },
  );
  assert.equal(empty.length, 0);
});

test("distance filter alone empty → fallback still returns contiguous seats", () => {
  const seats: SeatPoint[] = [
    seat("A1", "A", 1),
    seat("A2", "A", 2),
    seat("A3", "A", 3),
  ];
  let fallback = false;
  const blocked = rankSeatBlocks(
    seats,
    { count: 2, preferredRow: "E", preferredRowDistance: 1 },
    { allowDistanceFallback: false },
  );
  assert.equal(blocked.length, 0);

  const blocks = rankSeatBlocks(
    seats,
    { count: 2, preferredRow: "E", preferredRowDistance: 1 },
    { onDistanceFallback: () => {
      fallback = true;
    } },
  );
  assert.equal(fallback, true);
  assert.ok(blocks.length > 0);
  assert.deepEqual(
    blocks[0].seats.map((s) => s.id),
    ["A1", "A2"],
  );
});

test("distance fallback still respects aisle and edge filters", () => {
  const seats: SeatPoint[] = [
    seat("A1", "A", 1, { aisle: true }),
    seat("A2", "A", 2, { aisle: true }),
    seat("A3", "A", 3, { edge: true }),
    seat("A4", "A", 4, { edge: true }),
    seat("B5", "B", 5),
    seat("B6", "B", 6),
  ];
  let fallback = false;
  const blocks = rankSeatBlocks(
    seats,
    {
      count: 2,
      preferredRow: "Z",
      preferredRowDistance: 0,
      allowAisle: false,
      allowEdge: false,
    },
    { onDistanceFallback: () => {
      fallback = true;
    } },
  );
  assert.equal(fallback, true);
  assert.equal(blocks.length, 1);
  assert.deepEqual(
    blocks[0].seats.map((s) => s.id),
    ["B5", "B6"],
  );
});

test("skips non-contiguous numbers", () => {
  const seats: SeatPoint[] = [seat("E1", "E", 1), seat("E3", "E", 3), seat("E4", "E", 4)];
  const blocks = rankSeatBlocks(seats, { count: 2 });
  assert.equal(blocks.length, 1);
  assert.deepEqual(
    blocks[0].seats.map((s) => s.id),
    ["E3", "E4"],
  );
});
