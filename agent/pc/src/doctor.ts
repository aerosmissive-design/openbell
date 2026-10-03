/**
 * Operator doctor — checks install/config without printing secret values.
 * Usage: npx tsx src/doctor.ts
 */
import { existsSync, writeFileSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
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
const poll = (process.env.AGENT_MODE || "").trim().toLowerCase() === "poll";
check("config.env exists", hasConfig || poll, hasConfig ? "found" : poll ? "poll can create it" : "missing");

const env = hasConfig ? loadEnvFile(configPath) : {};
const requiredKeys = ["BOOKING_MOVIE", "BOOKING_DATE", "BOOKING_SHOWTIME", "BOOKING_SEAT_COUNT"] as const;
if (!poll) {
  for (const key of requiredKeys) {
    const value = env[key] ?? process.env[key];
    check(`${key}`, present(value), present(value) ? "set" : "missing");
  }
} else {
  lines.push("[INFO] poll mode — movie/date/showtime come from the web job, not config.env");
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
  if (isExactCgvBookingUrl(bookingUrl!)) {
    check("BOOKING_URL format", true, "exact showtime URL");
  } else {
    lines.push("[WARN] BOOKING_URL lacks scnsNo/scnSseq — agent will click date/time instead of aborting");
  }
} else {
  lines.push("[INFO] BOOKING_URL unset — agent will click movie/date/showtime (DOM unverified)");
}

const openbell = env.OPENBELL_URL ?? process.env.OPENBELL_URL;
const token = env.NAS_WORKER_TOKEN ?? process.env.NAS_WORKER_TOKEN ?? process.env.NAS_REPORT_TOKEN;
console.log(`[INFO] OPENBELL_URL: ${maskStatus(openbell)}`);
if (present(openbell) && !isOfficialOpenBellUrl(openbell!.trim())) {
  lines.push("[WARN] OPENBELL_URL is not https://openbell-fawn.vercel.app — production alias must not change");
}
if (poll && (!present(openbell) || !present(token))) {
  const rl = createInterface({ input: stdin, output: stdout });
  if (!present(openbell)) {
    const v = (await rl.question("OPENBELL_URL이 비어 있습니다. 입력하세요: ")).trim() || "https://openbell-fawn.vercel.app";
    writeFileSync(configPath, `OPENBELL_URL=${v}\n`, { flag: "a" });
    console.log("[OK] OPENBELL_URL saved");
  }
  if (!present(token)) {
    const v = (await rl.question("NAS_WORKER_TOKEN이 비어 있습니다. 입력하세요 (Enter=99159915): ")).trim() || "99159915";
    writeFileSync(configPath, `NAS_WORKER_TOKEN=${v}\n`, { flag: "a" });
    console.log("[OK] NAS_WORKER_TOKEN saved");
  }
  rl.close();
}
console.log(`[INFO] NAS_WORKER_TOKEN: ${maskStatus(token)}`);
const gasUrl = env.GAS_WEB_URL ?? process.env.GAS_WEB_URL;
console.log(`[INFO] GAS_WEB_URL: ${maskStatus(gasUrl)}`);
if (!present(gasUrl)) {
  if (poll) lines.push("[WARN] GAS_WEB_URL 없음 — 베셀 잡만 받는다");
  else lines.push("[WARN] GAS 없음 — 폰에서 켠 잡은 Neon 죽음 때 못 받음");
}
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

lines.push("[INFO] PAYMENT_READY_TTL_MS is display-only; server TTL is 10 minutes until this PR is merged");

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
