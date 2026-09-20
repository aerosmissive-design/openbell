/**
 * Operator helper: open headed Chromium so the user can log in to CGV manually,
 * then save Playwright storageState. Never types credentials. Never clicks payment.
 *
 * Usage: npx tsx src/save-login.ts
 */
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { looksLikeLoginPage, looksLoggedInCgv } from "./safety.js";
import { PC_ROOT, applyEnvFile } from "./env.js";

const CGV_HOME = "https://www.cgv.co.kr/";

applyEnvFile();

const outPath = resolve(PC_ROOT, process.env.CGV_STORAGE_STATE?.trim() || "cgv-storage.json");

console.log("========================================");
console.log("OpenBell PC Agent — save CGV login");
console.log("A browser will open. Log in yourself.");
console.log("This helper will NOT type your password.");
console.log("This helper will NOT click payment.");
console.log(`Will save session to: ${outPath}`);
console.log("========================================");

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ locale: "ko-KR", timezoneId: "Asia/Seoul" });
const page = await context.newPage();
await page.goto(CGV_HOME, { waitUntil: "domcontentloaded" });

const rl = createInterface({ input: stdin, output: stdout });
await rl.question("After you are logged in, press Enter here to save (or Ctrl+C to cancel)...\n");
rl.close();

const body = await page.locator("body").innerText().catch(() => "");
if (looksLikeLoginPage(page.url(), body) || !looksLoggedInCgv(page.url(), body)) {
  await browser.close().catch(() => undefined);
  console.error("LOGIN_NOT_COMPLETED: logout / MY CGV not found. Session was NOT saved.");
  console.error("Log in on the CGV window, then run 4-save-login.cmd again.");
  process.exit(1);
}

await context.storageState({ path: outPath });
await browser.close();
console.log("Saved. Set CGV_STORAGE_STATE in config.env if it is not already this file.");
console.log("Next: 3-doctor.cmd then 2-run.cmd");
console.log("Safety: no payment click, no CAPTCHA bypass.");
