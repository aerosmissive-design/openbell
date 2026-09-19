/**
 * Operator doctor — checks install/config without printing secret values.
 * Usage: npx tsx src/doctor.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isExactCgvBookingUrl } from "./safety.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PC_ROOT = resolve(__dirname, "..");

function loadEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const text = readFileSync(path, "utf8");
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const index = line.indexOf("=");
      if (index < 1) continue;
      const key = line.slice(0, index).trim();
      const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
      out[key] = value;
    }
  } catch {
    /* missing file handled by caller */
  }
  return out;
}

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

const bookingUrl = (env.BOOKING_URL ?? process.env.BOOKING_URL)?.trim();
if (present(bookingUrl)) {
  check("BOOKING_URL format", isExactCgvBookingUrl(bookingUrl!), "needs movNo,scnYmd,scnsNo,scnSseq");
} else {
  lines.push("[INFO] BOOKING_URL unset — agent will click movie/date/showtime (DOM unverified)");
}

const openbell = env.OPENBELL_URL ?? process.env.OPENBELL_URL;
const token = env.NAS_WORKER_TOKEN ?? process.env.NAS_WORKER_TOKEN ?? process.env.NAS_REPORT_TOKEN;
console.log(`[INFO] OPENBELL_URL: ${maskStatus(openbell)}`);
console.log(`[INFO] NAS_WORKER_TOKEN: ${maskStatus(token)}`);
console.log(
  `[INFO] Mode: ${present(openbell) && present(token) ? "linked (callbacks on)" : "dry-run (no callbacks)"}`,
);
console.log(`[INFO] CGV_STORAGE_STATE: ${maskStatus(env.CGV_STORAGE_STATE ?? process.env.CGV_STORAGE_STATE)}`);

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
