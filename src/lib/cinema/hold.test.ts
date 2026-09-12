import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  describeSeatGuide,
  formatHoldClock,
  isGuideSeat,
  remainingHoldMs,
  sessionFromShowtime,
} from "./hold.ts";
import { DEFAULT_HOLD, normalizeHold } from "./types.ts";
import type { Showtime } from "./types.ts";

const show: Showtime = {
  id: "cgv_yongsan:imax",
  theaterId: "cgv_yongsan",
  theaterName: "CGV 용산아이파크몰",
  chain: "cgv",
  movieTitle: "오디세이",
  movieNo: "",
  playDate: "20260920",
  startTime: "19:40",
  endTime: null,
  hallName: "IMAX관",
  formats: ["imax"],
  restSeats: 24,
  totalSeats: 400,
  bookingUrl: "https://cgv.co.kr/cnm/movieBook/movie?movNo=1",
  bookable: true,
};

describe("hold prefs", () => {
  it("clamps seats and minutes", () => {
    assert.equal(normalizeHold({ seats: 99, minutes: 1 }).seats, 8);
    assert.equal(normalizeHold({ seats: 0, minutes: 40 }).seats, 2);
    assert.equal(normalizeHold({ minutes: 40 }).minutes, 20);
    assert.equal(normalizeHold({ zone: "rear" }).zone, "rear");
    assert.equal(normalizeHold({ zone: "side" as never }).zone, "center");
  });
});

describe("hold session", () => {
  it("starts on the seat step and never marks payment", () => {
    const session = sessionFromShowtime(show, DEFAULT_HOLD);
    assert.equal(session.step, "seats");
    assert.equal(session.holdStartedAt, null);
    assert.equal(session.seats, 2);
    assert.match(session.bookingUrl, /^https:\/\/cgv\.co\.kr/);
  });
});

describe("seat guide", () => {
  it("highlights a center block of the requested width", () => {
    const guide = describeSeatGuide({
      formats: ["imax"],
      hallName: "IMAX관",
      zone: "center",
      seats: 3,
    });
    assert.equal(guide.colTo - guide.colFrom + 1, 3);
    assert.equal(isGuideSeat(guide, guide.rowFrom, guide.colFrom), true);
    assert.equal(isGuideSeat(guide, 0, 0), false);
    assert.match(guide.body, /IMAX/);
  });
});

describe("hold timer", () => {
  it("counts down from hold start and formats mm:ss", () => {
    const start = "2026-09-12T08:00:00.000Z";
    const now = Date.parse(start) + 90_000;
    assert.equal(remainingHoldMs(start, 10, now), 510_000);
    assert.equal(formatHoldClock(90_000), "01:30");
    assert.equal(formatHoldClock(0), "00:00");
  });
});
