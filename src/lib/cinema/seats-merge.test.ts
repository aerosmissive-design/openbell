import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeShowtimes } from "./seats.ts";
import type { Showtime } from "./types.ts";

function show(patch: Partial<Showtime> & Pick<Showtime, "id" | "movieTitle" | "hallName" | "startTime">): Showtime {
  return {
    theaterId: "cgv_yongsan",
    theaterName: "CGV 용산",
    chain: "cgv",
    movieNo: "100",
    playDate: "20260927",
    endTime: null,
    formats: ["imax"],
    restSeats: null,
    totalSeats: null,
    bookingUrl: "",
    bookable: true,
    ...patch,
  };
}

describe("mergeShowtimes", () => {
  it("collapses same hall and time even when schedule ids differ", () => {
    const shallow = show({
      id: "a",
      movieTitle: "테스트",
      hallName: "IMAX",
      startTime: "19:20",
      bookingUrl: "https://cgv.co.kr/cnm/movieBook/cinema?siteNo=0013&scnSseq=111",
      restSeats: null,
    });
    const deep = show({
      id: "b",
      movieTitle: "테스트",
      hallName: "IMAX관",
      startTime: "19:20",
      movieNo: "200",
      bookingUrl: "https://cgv.co.kr/cnm/movieBook/movie?movNo=200&scnSseq=999",
      restSeats: 8,
      totalSeats: 400,
      seatSource: "official",
    });
    const merged = mergeShowtimes([shallow, deep]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0]?.restSeats, 8);
    assert.match(merged[0]?.bookingUrl ?? "", /scnSseq=999/);
  });

  it("treats 24:10 and next-day 00:10 as one showtime", () => {
    const late = show({ id: "late", movieTitle: "심야", hallName: "4DX관", startTime: "24:10", playDate: "20260927" });
    const early = show({ id: "early", movieTitle: "심야", hallName: "4DX", startTime: "00:10", playDate: "20260928", restSeats: 3 });
    const merged = mergeShowtimes([late], [early]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0]?.restSeats, 3);
  });

  it("keeps different halls and different movies apart", () => {
    const imax = show({ id: "i", movieTitle: "영화A", hallName: "IMAX", startTime: "19:20" });
    const other = show({ id: "o", movieTitle: "영화A", hallName: "4DX", startTime: "19:20" });
    const otherMovie = show({ id: "m", movieTitle: "완전히다른영화", hallName: "IMAX", startTime: "19:20" });
    assert.equal(mergeShowtimes([imax, other, otherMovie]).length, 3);
  });
});
