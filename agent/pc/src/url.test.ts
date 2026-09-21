import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dateClickLabels,
  isAllowedCgvBookingPageUrl,
  isExactCgvBookingUrl,
  isMegaboxTarget,
  isPaymentBookingUrl,
  normalizeBookingDate,
} from "./safety.js";

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

test("shallow movie/cinema URLs are allowed; payment URLs are not", () => {
  assert.equal(isAllowedCgvBookingPageUrl("https://cgv.co.kr/cnm/movieBook/movie?movNo=1"), true);
  assert.equal(isAllowedCgvBookingPageUrl("https://www.cgv.co.kr/cnm/movieBook/cinema?siteNo=0013"), true);
  assert.equal(isAllowedCgvBookingPageUrl("https://cgv.co.kr/cnm/movieBook/payment"), false);
  assert.equal(isPaymentBookingUrl("https://cgv.co.kr/cnm/movieBook/checkout"), true);
  assert.equal(isMegaboxTarget("메가박스 코엑스", undefined), true);
  assert.equal(isMegaboxTarget("CGV용산아이파크몰", "https://cgv.co.kr/cnm/movieBook/movie?movNo=1"), false);
  assert.equal(normalizeBookingDate("20260920"), "2026-09-20");
  assert.equal(normalizeBookingDate("2026-09-20"), "2026-09-20");
  assert.equal(normalizeBookingDate("2026/09/20"), undefined);
});
