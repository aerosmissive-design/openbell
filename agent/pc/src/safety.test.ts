import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isCaptchaFrameUrl,
  isExactCgvBookingUrl,
  isForbiddenClickLabel,
  isPaymentStageSignal,
  looksLikeCaptchaChallenge,
} from "./safety.js";

test("isExactCgvBookingUrl requires https + path + four query keys", () => {
  const ok =
    "https://cgv.co.kr/cnm/movieBook/movie?movNo=1&scnYmd=20260920&scnsNo=2&scnSseq=3";
  assert.equal(isExactCgvBookingUrl(ok), true);
  assert.equal(
    isExactCgvBookingUrl(
      "https://www.cgv.co.kr/cnm/movieBook/movie?movNo=1&scnYmd=20260920&scnsNo=2&scnSseq=3&siteNo=99",
    ),
    true,
  );
  assert.equal(isExactCgvBookingUrl("https://cgv.co.kr/cnm/movieBook/movie?movNo=1"), false);
  assert.equal(isExactCgvBookingUrl("http://cgv.co.kr/cnm/movieBook/movie?movNo=1&scnYmd=1&scnsNo=2&scnSseq=3"), false);
  assert.equal(isExactCgvBookingUrl("https://ticket.cgv.co.kr/cnm/movieBook/movie?movNo=1&scnYmd=1&scnsNo=2&scnSseq=3"), false);
});

test("isPaymentStageSignal ignores lone 결제하기 and English order/border", () => {
  assert.equal(isPaymentStageSignal("https://cgv.co.kr/cnm/movieBook/movie", "예매 좌석 선택 결제하기"), false);
  assert.equal(isPaymentStageSignal("https://cgv.co.kr/cnm/movieBook/movie", "border-box order list"), false);
  assert.equal(
    isPaymentStageSignal("https://cgv.co.kr/cnm/movieBook/payment", "anything"),
    true,
  );
  assert.equal(
    isPaymentStageSignal("https://cgv.co.kr/x", "최종결제금액 12,000원\n결제수단"),
    true,
  );
});

test("looksLikeCaptchaChallenge does not trip on CDN script words", () => {
  assert.equal(looksLikeCaptchaChallenge("영화 예매 좌석을 선택하세요"), false);
  assert.equal(
    looksLikeCaptchaChallenge("cdn.cloudflare.com recaptcha/api.js 자동입력 스크립트"),
    false,
  );
  assert.equal(looksLikeCaptchaChallenge("보안문자 숫자를 입력하세요"), true);
  assert.equal(looksLikeCaptchaChallenge("자동입력 방지 문자를 입력하세요"), true);
  assert.equal(looksLikeCaptchaChallenge("로봇이 아닙니다"), true);
});

test("forbidden click labels include 결제하기 but not 좌석선택완료", () => {
  assert.equal(isForbiddenClickLabel("결제하기"), true);
  assert.equal(isForbiddenClickLabel("최종결제"), true);
  assert.equal(isForbiddenClickLabel("좌석선택완료"), false);
  assert.equal(isForbiddenClickLabel("다음"), false);
});

test("captcha frame URLs", () => {
  assert.equal(isCaptchaFrameUrl("https://www.google.com/recaptcha/api2/anchor"), true);
  assert.equal(isCaptchaFrameUrl("https://cgv.co.kr/cnm/movieBook/movie"), false);
});
