import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CGV_RELAY_STALE_MS,
  cgvTheatersMissingSeats,
  nextCgvRelayWatch,
  parseCgvRelayWatch,
} from "./relay-watch.ts";
import type { Showtime, TheaterScan } from "./types.ts";

const show = (rest: number | null): Showtime => ({
  id: "s",
  theaterId: "cgv_yongsan",
  theaterName: "용산",
  chain: "cgv",
  movieTitle: "오디세이",
  movieNo: "",
  playDate: "20260912",
  startTime: "19:00",
  endTime: null,
  hallName: "IMAX관",
  formats: ["imax"],
  restSeats: rest,
  totalSeats: 400,
  bookingUrl: "",
  bookable: true,
});

const theater = (
  id: TheaterScan["theaterId"],
  rests: Array<number | null>,
): TheaterScan => ({
  theaterId: id,
  ok: rests.length > 0,
  error: null,
  showtimes: rests.map((rest) => ({
    ...show(rest),
    theaterId: id,
  })),
  source: "naver-place",
  seatSource: rests.every((n) => n == null) ? "none" : "cgv-relay",
});

describe("cgv relay watch", () => {
  it("lists CGV theaters that have times but no seats", () => {
    const missing = cgvTheatersMissingSeats([
      theater("cgv_yongsan", [null, null]),
      theater("cgv_yeongdeungpo", [12]),
      theater("megabox_coex", [null]),
      theater("cgv_yongsan", []),
    ]);
    assert.deepEqual(missing, ["cgv_yongsan"]);
  });

  it("alerts once after 15 minutes empty, then resets on recovery", () => {
    const t0 = 1_000_000;
    const first = nextCgvRelayWatch(
      parseCgvRelayWatch(null),
      ["cgv_yongsan", "cgv_yeongdeungpo"],
      t0,
    );
    assert.equal(first.stale, false);
    assert.equal(first.shouldAlert, false);

    const later = nextCgvRelayWatch(
      first.state,
      ["cgv_yeongdeungpo"],
      t0 + CGV_RELAY_STALE_MS,
    );
    assert.equal(later.stale, true);
    assert.equal(later.shouldAlert, true);
    assert.equal(later.state.lastAlertAt, t0 + CGV_RELAY_STALE_MS);

    const again = nextCgvRelayWatch(
      later.state,
      ["cgv_yeongdeungpo"],
      t0 + CGV_RELAY_STALE_MS + 60_000,
    );
    assert.equal(again.shouldAlert, false);
    assert.equal(again.stale, true);

    const recovered = nextCgvRelayWatch(again.state, [], t0 + CGV_RELAY_STALE_MS + 120_000);
    assert.equal(recovered.stale, false);
    assert.equal(recovered.state.emptySince, null);
  });
});
