import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planAutoBook } from "./auto-book-run.ts";
import type { Showtime } from "./types.ts";

function show(patch: Partial<Showtime>): Showtime {
  return {
    id: "s1",
    theaterId: "cgv_yongsan",
    theaterName: "용산",
    chain: "cgv",
    movieTitle: "테스트",
    movieNo: "1",
    playDate: "20260928",
    startTime: "19:20",
    endTime: null,
    hallName: "IMAX",
    formats: ["imax"],
    restSeats: 10,
    totalSeats: 400,
    bookingUrl: "https://cgv.co.kr/cnm/movieBook/movie?movNo=1&scnSseq=9",
    bookable: true,
    ...patch,
  };
}

describe("planAutoBook", () => {
  it("fires only after the movie is added, and only once", () => {
    const live = [show({})];
    const primed = planAutoBook({
      live,
      movies: [],
      autoShows: [],
      fired: {},
      armMovies: new Set(),
      armShows: new Set(),
    });
    assert.equal(primed.jobs.length, 0);
    const armed = planAutoBook({
      live,
      movies: [{ title: "테스트", seats: 2 }],
      autoShows: [],
      fired: primed.fired,
      armMovies: new Set(["테스트"]),
      armShows: new Set(),
    });
    assert.equal(armed.jobs.length, 1);
    assert.equal(armed.jobs[0]?.seats, 2);
    assert.ok(armed.jobs[0]?.preferredSeats.includes("J22"));
    const again = planAutoBook({
      live,
      movies: [{ title: "테스트", seats: 2 }],
      autoShows: [],
      fired: armed.fired,
      armMovies: new Set(["테스트"]),
      armShows: new Set(),
    });
    assert.equal(again.jobs.length, 0);
  });

  it("requeues a starred show when the seat count changes", () => {
    const row = {
      id: "star1",
      title: "테스트",
      theaterId: "cgv_yongsan" as const,
      playDate: "20260928",
      startTime: "19:20",
      hallName: "IMAX관",
      bookingUrl: "https://cgv.co.kr/book",
      seats: 3,
    };
    const first = planAutoBook({
      live: [show({ id: "other", restSeats: 4 })],
      movies: [],
      autoShows: [row],
      fired: {},
      armMovies: new Set(),
      armShows: new Set([row.id]),
    });
    assert.equal(first.jobs.length, 1);
    assert.equal(first.jobs[0]?.reason, "open");
    const same = planAutoBook({
      live: [show({ id: "other", restSeats: 4 })],
      movies: [],
      autoShows: [row],
      fired: first.fired,
      armMovies: new Set(),
      armShows: new Set(),
    });
    assert.equal(same.jobs.length, 0);
    const changed = planAutoBook({
      live: [show({ id: "other", restSeats: 7 })],
      movies: [],
      autoShows: [row],
      fired: same.fired,
      armMovies: new Set(),
      armShows: new Set(),
    });
    assert.equal(changed.jobs.length, 1);
    assert.equal(changed.jobs[0]?.reason, "seats");
  });

  it("books the show already on the board, then a showtime that opens later", () => {
    const current = planAutoBook({
      live: [show({ id: "old" })],
      movies: [{ title: "테스트", seats: 2 }],
      autoShows: [],
      fired: {},
      armMovies: new Set(),
      armShows: new Set(),
      knownShowIds: new Set(["old"]),
    });
    assert.equal(current.jobs.length, 1);
    assert.equal(current.jobs[0]?.show.id, "old");
    assert.equal(current.jobs[0]?.seats, 2);
    const opened = planAutoBook({
      live: [show({ id: "old" }), show({ id: "new", startTime: "21:00" })],
      movies: [{ title: "테스트", seats: 2 }],
      autoShows: [],
      fired: current.fired,
      armMovies: new Set(),
      armShows: new Set(),
      knownShowIds: new Set(["old"]),
    });
    assert.equal(opened.jobs.length, 1);
    assert.equal(opened.jobs[0]?.show.id, "new");
    assert.equal(opened.jobs[0]?.seats, 2);
  });
});
