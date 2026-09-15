#!/usr/bin/env node
/**
 * 한 번만: 브라우저 창을 띄워 극장에 로그인 → 쿠키 저장
 *
 * 사용 (나스/PC에서):
 *   HEADLESS=0 node login-setup.mjs cgv
 *   HEADLESS=0 node login-setup.mjs megabox
 *
 * 저장 위치: PLAYWRIGHT_STATE_DIR (기본 /data)/storage-cgv.json
 */

import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const chain = (process.argv[2] || "cgv").toLowerCase();
const STATE_DIR = process.env.PLAYWRIGHT_STATE_DIR || "./data";
const startUrl =
  chain === "megabox"
    ? "https://www.megabox.co.kr/login"
    : "https://www.cgv.co.kr/user/login/";

fs.mkdirSync(STATE_DIR, { recursive: true });
const out = path.join(STATE_DIR, `storage-${chain === "megabox" ? "megabox" : "cgv"}.json`);

console.log("[login-setup] 브라우저가 열리면 로그인하세요.");
console.log("[login-setup] 끝나면 터미널에서 Enter");

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ locale: "ko-KR" });
const page = await context.newPage();
await page.goto(startUrl, { waitUntil: "domcontentloaded" });

await new Promise((resolve) => {
  process.stdin.resume();
  process.stdin.once("data", resolve);
});

await context.storageState({ path: out });
console.log("[login-setup] 저장:", out);
await browser.close();
process.exit(0);
