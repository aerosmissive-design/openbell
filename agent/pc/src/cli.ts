/**
 * Windows CLI entry. Importing this file starts the agent.
 * Library code lives in run.ts / openbell-api.ts (safe to import from tests).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type BookingState, type BookingTarget, isExactCgvBookingUrl } from "./cgv-agent.js";
import { classifyAgentError } from "./result-code.js";
import { isBookingDate, isBookingShowtime, safeBrowserAccessUrl } from "./safety.js";
import { PC_ROOT, applyEnvFile, isFalseyFlag, paymentReadyTtlMinutes, resolveExistingStorageState } from "./env.js";
import { createSession, notifyPaymentReady, updateState } from "./openbell-api.js";
import { runBooking } from "./run.js";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`MISSING_ENV:${name}`);
  return value;
}

function bool(name: string, fallback = false) {
  const value = process.env[name];
  return value == null ? fallback : /^(1|true|yes|on)$/i.test(value.trim());
}

function optionalNumber(name: string) {
  const value = process.env[name]?.trim();
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`INVALID_ENV:${name}`);
  return parsed;
}

applyEnvFile(process.env.OPENBELL_AGENT_CONFIG || resolve(PC_ROOT, "config.env"));

const requestedSeatCount = Number(process.env.BOOKING_SEAT_COUNT || "2");
if (!Number.isInteger(requestedSeatCount) || requestedSeatCount < 1) {
  throw new Error("INVALID_BOOKING_SEAT_COUNT");
}

const explicitSeatIds = (process.env.BOOKING_SEAT_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (explicitSeatIds.length && explicitSeatIds.length !== requestedSeatCount) {
  throw new Error("BOOKING_SEAT_IDS must contain exactly BOOKING_SEAT_COUNT seats when provided");
}

const exactBookingUrl = process.env.BOOKING_URL?.trim() || undefined;
if (exactBookingUrl && !isExactCgvBookingUrl(exactBookingUrl)) {
  throw new Error(
    "INVALID_BOOKING_URL: must be https://cgv.co.kr/cnm/movieBook/movie with movNo,scnYmd,scnsNo,scnSseq",
  );
}

const target: BookingTarget = {
  movieTitle: required("BOOKING_MOVIE"),
  playDate: required("BOOKING_DATE"),
  showtime: required("BOOKING_SHOWTIME"),
  requestedSeatCount,
  bookingUrl: exactBookingUrl,
  seatIds: explicitSeatIds.length ? explicitSeatIds : undefined,
  seatPreference: {
    preferredRow: process.env.SEAT_PREFERRED_ROW?.trim() || undefined,
    preferredRowDistance: optionalNumber("SEAT_PREFERRED_ROW_DISTANCE"),
    allowAisle: bool("SEAT_ALLOW_AISLE", true),
    allowEdge: bool("SEAT_ALLOW_EDGE", false),
  },
};

if (!isBookingDate(target.playDate)) {
  throw new Error("INVALID_BOOKING_DATE: use YYYY-MM-DD");
}
if (!isBookingShowtime(target.showtime)) {
  throw new Error("INVALID_BOOKING_SHOWTIME: use HH:MM (e.g. 20:10)");
}

const headless = bool("PLAYWRIGHT_HEADLESS", false);
const holdAtPayment = bool("PAYMENT_HOLD_BROWSER", true);
const storageStatePath = resolveExistingStorageState(PC_ROOT, process.env.CGV_STORAGE_STATE);
const openbellUrl = process.env.OPENBELL_URL?.trim().replace(/\/$/, "");
const workerToken = process.env.NAS_WORKER_TOKEN?.trim() || process.env.NAS_REPORT_TOKEN?.trim();
const callbacksEnabled = Boolean(openbellUrl && workerToken);
const dryRun = !callbacksEnabled;

let bookingSessionId = process.env.BOOKING_SESSION_ID?.trim();

const bookingInfo: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) {
  if (key.startsWith("BOOKING_INFO_")) bookingInfo[key.slice("BOOKING_INFO_".length)] = value || "";
}

let agentVersion = "2.0.16";
try {
  const pkg = JSON.parse(readFileSync(resolve(PC_ROOT, "package.json"), "utf8")) as { version?: string };
  if (pkg.version) agentVersion = pkg.version;
} catch {
  // hardcoded fallback
}
console.log("========================================");
console.log(`OpenBell PC Agent preflight — openbell-pc-agent@${agentVersion}`);
console.log(`Mode: ${dryRun ? "dry-run" : "linked"}`);
console.log(`Movie: ${target.movieTitle}`);
console.log(`Date: ${target.playDate}`);
console.log(`Showtime: ${target.showtime}`);
console.log(`Seat count: ${requestedSeatCount}`);
console.log(`BOOKING_URL: ${exactBookingUrl ? "yes" : "no"}`);
console.log(`Headless: ${headless}`);
console.log(`Hold browser: ${holdAtPayment}`);
console.log("PAYMENT_HARD_STOP: locked (final payment is never clicked)");
if (isFalseyFlag(process.env.PAYMENT_HARD_STOP)) {
  console.warn("[safety] PAYMENT_HARD_STOP=false is ignored. Final payment is never automated.");
}
const storageConfigured = process.env.CGV_STORAGE_STATE?.trim();
if (storageStatePath) {
  console.log("CGV_STORAGE_STATE: file found");
} else if (storageConfigured) {
  console.log("WARNING: CGV_STORAGE_STATE file missing. Continuing without it. Run 4-save-login.cmd after a manual CGV login.");
} else {
  console.log("CGV_STORAGE_STATE: unset. If CGV shows login, run 4-save-login.cmd.");
}
if (!exactBookingUrl) {
  console.log("WARNING: BOOKING_URL is empty. Agent will try movie/date/showtime clicks (DOM unverified).");
}
console.log("========================================");

if (dryRun) {
  console.log("[DRY-RUN] OPENBELL_URL + NAS_WORKER_TOKEN not both set. No OpenBell API callbacks.");
} else if (!bookingSessionId) {
  bookingSessionId = await createSession({
    openbellUrl: openbellUrl!,
    workerToken: workerToken!,
    theaterId: process.env.BOOKING_THEATER_ID?.trim() || "CGV용산아이파크몰",
    movieTitle: target.movieTitle,
    playDate: target.playDate,
    showtime: target.showtime,
    hall: process.env.BOOKING_HALL?.trim() || "20관",
    requestedSeatCount,
    bookingUrl: target.bookingUrl,
  });
  console.log(`OpenBell booking session created: ${bookingSessionId}`);
}

const stateCallback =
  callbacksEnabled && bookingSessionId
    ? async (state: BookingState) => {
        await updateState({
          openbellUrl: openbellUrl!,
          workerToken: workerToken!,
          sessionId: bookingSessionId!,
          state,
        });
        console.log(`OpenBell booking state: ${state}`);
      }
    : async (state: BookingState) => {
        console.log(`[local] booking state: ${state}`);
      };

await stateCallback("WATCHING");

function printResultCode(code: "A" | "B" | "C" | "D" | "E", detail: string) {
  console.log(`\n[RESULT_CODE=${code}] ${detail}`);
}

try {
  const result = await runBooking({
    ...target,
    storageStatePath,
    headless,
    holdAtPayment,
    bookingInfo: Object.keys(bookingInfo).length ? bookingInfo : undefined,
    onStateChange: stateCallback,
    onPaymentReady: async ({ url, seats }) => {
      console.log("\n========================================");
      console.log("PAYMENT_READY - AUTOMATION HARD STOP");
      console.log(`URL: ${url}`);
      console.log(`SEATS: ${seats.join(", ")}`);
      console.log("Final payment was NOT clicked.");
      console.log(`TTL: server PAYMENT_READY window is about ${paymentReadyTtlMinutes()} minutes (display; server default is 10).`);
      console.log("Telegram: sent by OpenBell server after payment-ready (not by this PC agent).");
      console.log("Pay in this PC browser. Do not open the payment page on a phone.");
      if (!headless && holdAtPayment) {
        console.log("Browser is being kept open for manual completion (PAYMENT_HOLD_BROWSER).");
      }
      console.log("========================================\n");

      if (!callbacksEnabled || !bookingSessionId) {
        console.log("[DRY-RUN] Skipped POST /api/booking/payment-ready");
        return;
      }

      // Never send a payment-page URL to OpenBell/Telegram — exact movie-book only.
      const callbackUrl =
        safeBrowserAccessUrl(exactBookingUrl ?? "") || safeBrowserAccessUrl(url);
      await notifyPaymentReady({
        openbellUrl: openbellUrl!,
        workerToken: workerToken!,
        sessionId: bookingSessionId,
        url: callbackUrl,
        seats,
      });
      console.log("OpenBell PAYMENT_READY callback sent successfully.");
    },
  });

  console.log(JSON.stringify(result, null, 2));
  if (dryRun) {
    printResultCode("B", "Dry-run HARD STOP at PAYMENT_READY (no OpenBell callbacks).");
  } else {
    printResultCode("A", `PAYMENT_READY HARD STOP; OpenBell notified. Finish payment manually within ~${paymentReadyTtlMinutes()} min.`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  printResultCode(classifyAgentError(message), message);
  if (callbacksEnabled && bookingSessionId && !message.startsWith("OPENBELL_")) {
    try {
      await updateState({
        openbellUrl: openbellUrl!,
        workerToken: workerToken!,
        sessionId: bookingSessionId,
        state: "FAILED",
      });
      console.log("OpenBell booking state: FAILED");
    } catch (stateError) {
      const detail = stateError instanceof Error ? stateError.message : String(stateError);
      console.warn(`[state] failed to report FAILED: ${detail.slice(0, 200)}`);
    }
  }
  process.exitCode = 1;
  throw error;
}
