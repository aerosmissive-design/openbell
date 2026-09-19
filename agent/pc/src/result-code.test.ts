import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyAgentError } from "./result-code.js";
import {
  isBookingDate,
  isBookingShowtime,
  isOfficialOpenBellUrl,
  isSafeDialogLabel,
  looksLikeLoginPage,
} from "./safety.js";

test("classifyAgentError maps captcha / API / DOM", () => {
  assert.equal(classifyAgentError("CAPTCHA_DETECTED: stop"), "C");
  assert.equal(classifyAgentError("OPENBELL_PAYMENT_READY_FAILED:401:x"), "E");
  assert.equal(classifyAgentError("CGV_SEAT_MAP_NOT_FOUND"), "D");
  assert.equal(classifyAgentError("LOGIN_REQUIRED"), "D");
});

test("looksLikeLoginPage requires login path AND password form", () => {
  assert.equal(
    looksLikeLoginPage("https://www.cgv.co.kr/user/login", "아이디 비밀번호 로그인"),
    true,
  );
  assert.equal(
    looksLikeLoginPage("https://cgv.co.kr/cnm/movieBook/movie", "로그인 예매하기"),
    false,
  );
});

test("isSafeDialogLabel allows age-gate, refuses payment", () => {
  assert.equal(isSafeDialogLabel("동의합니다"), true);
  assert.equal(isSafeDialogLabel("닫기"), true);
  assert.equal(isSafeDialogLabel("관람등급 확인"), true);
  assert.equal(isSafeDialogLabel("결제하기"), false);
  assert.equal(isSafeDialogLabel("결제 동의"), false);
});

test("date/showtime/official host helpers", () => {
  assert.equal(isBookingDate("2026-09-20"), true);
  assert.equal(isBookingDate("2026/09/20"), false);
  assert.equal(isBookingShowtime("20:10"), true);
  assert.equal(isBookingShowtime("8pm"), false);
  assert.equal(isOfficialOpenBellUrl("https://openbell-fawn.vercel.app"), true);
  assert.equal(isOfficialOpenBellUrl("https://example.vercel.app"), false);
});
