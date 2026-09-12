import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  filterWatched,
  mergeMovieCatalog,
  moviesFromShowtimes,
  titlesMatch,
  watchedTitleSet,
} from "./match.ts";
import type { RankingMovie, Showtime, WatchConfig } from "./types.ts";

const movie = (title: string, rank = 0): RankingMovie => ({
  rank,
  title,
  movieNo: "",
  bookingRate: null,
  posterUrl: null,
  releaseDate: null,
  bookingOpen: true,
  released: true,
});

const show = (title: string, theaterId: Showtime["theaterId"] = "cgv_yongsan"): Showtime => ({
  id: `${theaterId}:${title}`,
  theaterId,
  theaterName: "용산",
  chain: "cgv",
  movieTitle: title,
  movieNo: "",
  playDate: "20260920",
  startTime: "19:00",
  endTime: null,
  hallName: "IMAX관",
  formats: ["imax"],
  restSeats: 12,
  totalSeats: 400,
  bookingUrl: "https://cgv.co.kr",
  bookable: true,
});

const config: WatchConfig = {
  email: "",
  emailNotify: false,
  ranks: [],
  watchTitles: ["인턴"],
  theaters: {
    megabox_coex: false,
    megabox_namyangju: false,
    cgv_yongsan: true,
    cgv_yeongdeungpo: false,
  },
  formats: {
    megabox_coex: [],
    megabox_namyangju: [],
    cgv_yongsan: ["imax"],
    cgv_yeongdeungpo: [],
  },
  daysAhead: 7,
  intervalMin: 5,
  browserNotify: true,
  telegramToken: "",
  telegramChatId: "",
  webhookUrl: "",
  kakaoRestKey: "",
  kakaoRefreshToken: "",
  gmailAppPassword: "",
  xApiKey: "",
  xApiSecret: "",
  xAccessToken: "",
  xAccessSecret: "",
  xClientId: "",
  xClientSecret: "",
  xRefreshToken: "",
  scanSources: { official: true, naver: true, gas: true },
  gasWebUrl: "",
  gasSyncKey: "",
  gasScriptId: "",
  gasSourceStamp: "",
  theme: "system",
  movieTab: "chart",
  hold: {
    enabled: true,
    seats: 2,
    zone: "center",
    autoOpen: false,
    minutes: 10,
  },
};

describe("match", () => {
  it("merges catalogs without duplicate titles", () => {
    const out = mergeMovieCatalog(
      [movie("오디세이", 1), movie("인턴")],
      [movie("오디세이"), movie("싱 어게인")],
    );
    assert.deepEqual(
      out.map((m) => m.title),
      ["오디세이", "인턴", "싱 어게인"],
    );
  });

  it("matches close titles", () => {
    assert.equal(titlesMatch("스파이더맨: 브랜드 뉴 데이", "스파이더맨브랜드뉴데이"), true);
    assert.equal(titlesMatch("오디세이", "인턴"), false);
  });

  it("keeps extra watch titles even before showtimes exist", () => {
    const titles = watchedTitleSet([], config);
    assert.equal([...titles].some((t) => t.includes("인턴")), true);
    const watched = filterWatched([show("인턴"), show("오디세이")], config, titles);
    assert.equal(watched.length, 1);
    assert.equal(watched[0].movieTitle, "인턴");
  });

  it("builds catalog rows from showtimes", () => {
    const rows = moviesFromShowtimes([show("아이유 콘서트"), show("아이유 콘서트")]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].title, "아이유 콘서트");
  });
});
