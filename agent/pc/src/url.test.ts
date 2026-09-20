import assert from "node:assert/strict";
import { test } from "node:test";
import { dateClickLabels, isExactCgvBookingUrl } from "./safety.js";

test("accepts exact CGV booking URL with required query params", () => {
  const url =
    "https://cgv.co.kr/cnm/movieBook/movie?movNo=123&scnYmd=20260920&scnsNo=1&scnSseq=2";
  assert.equal(isExactCgvBookingUrl(url), true);
});

test("accepts www host and optional siteNo", () => {
  const url =
    "https://www.cgv.co.kr/cnm/movieBook/movie?movNo=1&scnYmd=20260920&scnsNo=9&scnSseq=1&siteNo=0013";
  assert.equal(isExactCgvBookingUrl(url), true);
});

test("rejects missing required query", () => {
  assert.equal(
    isExactCgvBookingUrl("https://cgv.co.kr/cnm/movieBook/movie?movNo=1&scnYmd=20260920&scnsNo=1"),
    false,
  );
});

test("rejects non-CGV host or http", () => {
  assert.equal(
    isExactCgvBookingUrl("http://cgv.co.kr/cnm/movieBook/movie?movNo=1&scnYmd=20260920&scnsNo=1&scnSseq=2"),
    false,
  );
  assert.equal(
    isExactCgvBookingUrl(
      "https://example.com/cnm/movieBook/movie?movNo=1&scnYmd=20260920&scnsNo=1&scnSseq=2",
    ),
    false,
  );
});

test("dateClickLabels accepts YYYYMMDD from OpenBell alerts", () => {
  const labels = dateClickLabels("20260920");
  assert.ok(labels.includes("20260920"));
  assert.ok(labels.includes("9월 20일"));
});
