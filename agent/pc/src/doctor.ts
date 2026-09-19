/**
 * Operator doctor — checks install/config without printing secret values.
 * Usage: npx tsx src/doctor.ts
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  isBookingDate,
  isBookingShowtime,
  isExactCgvBookingUrl,
  isOfficialOpenBellUrl,
} from "./safety.js";
import { PC_ROOT, isFalseyFlag, loadEnvFile } from "./env.js";

function present(value: string | undefined) {
  return Boolean(value?.trim());
}

function maskStatus(value: string | undefined) {
  return present(value) ? "set" : "unset";
}

let ok = true;
const lines: string[] = [];
function check(label: string, pass: boolean, hint?: string) {
  const mark = pass ? "OK" : "FAIL";
  if (!pass) ok = false;
  lines.push(`[${mark}] ${label}${hint ? ` — ${hint}` : ""}`);
}

console.log("========================================");
console.log("OpenBell PC Agent doctor");
console.log("========================================");

check("Node.js runtime", typeof process.versions.node === "string", `node ${process.versions.node}`);

const nodeModules = existsSync(resolve(PC_ROOT, "node_modules"));
check("node_modules present", nodeModules, nodeModules ? "found" : "run 1-install.cmd");

const playwright = existsSync(resolve(PC_ROOT, "node_modules/playwright"));
check("playwright package", playwright, playwright ? "found" : "run 1-install.cmd");

if (playwright) {
  try {
    const { chromium } = await import("playwright");
    const exe = chromium.executablePath();
    const chromiumOk = Boolean(exe && existsSync(exe));
    check(
      "Playwright Chromium binary",
      chromiumOk,
      chromiumOk ? "found" : "run npx playwright install chromium (or 1-install.cmd)",
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    check("Playwright Chromium binary", false, detail.slice(0, 120));
  }
}

const configPath = resolve(PC_ROOT, "config.env");
const hasConfig = existsSync(configPath);
check("config.env exists", hasConfig, hasConfig ? "found" : "run 1-install.cmd then edit config.env");

const env = hasConfig ? loadEnvFile(configPath) : {};
const requiredKeys = ["BOOKING_MOVIE", "BOOKING_DATE", "BOOKING_SHOWTIME", "BOOKING_SEAT_COUNT"] as const;
for (const key of requiredKeys) {
  const value = env[key] ?? process.env[key];
  check(`${key}`, present(value), present(value) ? "set" : "missing");
}

const seatCountRaw = env.BOOKING_SEAT_COUNT ?? process.env.BOOKING_SEAT_COUNT;
if (present(seatCountRaw)) {
  const n = Number(seatCountRaw);
  check("BOOKING_SEAT_COUNT range", Number.isInteger(n) && n >= 1 && n <= 10, `value is ${seatCountRaw}`);
}

const playDate = env.BOOKING_DATE ?? process.env.BOOKING_DATE;
if (present(playDate)) {
  check("BOOKING_DATE YYYY-MM-DD", isBookingDate(playDate!), playDate);
}
const showtime = env.BOOKING_SHOWTIME ?? process.env.BOOKING_SHOWTIME;
if (present(showtime)) {
  check("BOOKING_SHOWTIME HH:MM", isBookingShowtime(showtime!), showtime);
}

const bookingUrl = (env.BOOKING_URL ?? process.env.BOOKING_URL)?.trim();
if (present(bookingUrl)) {
  check("BOOKING_URL format", isExactCgvBookingUrl(bookingUrl!), "needs movNo,scnYmd,scnsNo,scnSseq");
} else {
  lines.push("[INFO] BOOKING_URL unset — agent will click movie/date/showtime (DOM unverified)");
}

const openbell = env.OPENBELL_URL ?? process.env.OPENBELL_URL;
const token = env.NAS_WORKER_TOKEN ?? process.env.NAS_WORKER_TOKEN ?? process.env.NAS_REPORT_TOKEN;
console.log(`[INFO] OPENBELL_URL: ${maskStatus(openbell)}`);
if (present(openbell) && !isOfficialOpenBellUrl(openbell!.trim())) {
  lines.push("[WARN] OPENBELL_URL is not https://openbell-fawn.vercel.app — production alias must not change");
}
console.log(`[INFO] NAS_WORKER_TOKEN: ${maskStatus(token)}`);
console.log(
  `[INFO] Mode: ${present(openbell) && present(token) ? "linked (callbacks on)" : "dry-run (no callbacks)"}`,
);
console.log(`[INFO] CGV_STORAGE_STATE: ${maskStatus(env.CGV_STORAGE_STATE ?? process.env.CGV_STORAGE_STATE)}`);
const storageRaw = env.CGV_STORAGE_STATE ?? process.env.CGV_STORAGE_STATE;
if (present(storageRaw)) {
  const storagePath = resolve(PC_ROOT, storageRaw!.trim());
  check("CGV_STORAGE_STATE file", existsSync(storagePath), existsSync(storagePath) ? "found" : "missing — run 4-save-login.cmd");
} else {
  lines.push("[INFO] CGV_STORAGE_STATE unset — if CGV shows login, run 4-save-login.cmd");
}

const hardStop = env.PAYMENT_HARD_STOP ?? process.env.PAYMENT_HARD_STOP;
if (isFalseyFlag(hardStop)) {
  lines.push("[WARN] PAYMENT_HARD_STOP=false is ignored — final payment is never automated");
} else {
  lines.push("[OK] PAYMENT_HARD_STOP locked (payment is never clicked)");
}

for (const line of lines) console.log(line);

console.log("========================================");
if (ok) {
  console.log("Doctor: ready. Next: 2-run.cmd (dry-run without token = result B).");
  console.log("Safety: no payment click, no CAPTCHA bypass. HARD STOP at PAYMENT_READY.");
  process.exitCode = 0;
} else {
  console.log("Doctor: fix FAIL items, then re-run 3-doctor.cmd or npm run doctor.");
  process.exitCode = 1;
}
