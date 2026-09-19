import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CgvBookingAgent,
  type BookingState,
  type BookingTarget,
  isExactCgvBookingUrl,
} from "./cgv-agent.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PC_ROOT = resolve(__dirname, "..");

function loadEnv(path = resolve(PC_ROOT, "config.env")) {
  try {
    const text = readFileSync(path, "utf8");
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const index = line.indexOf("=");
      if (index < 1) continue;
      const key = line.slice(0, index).trim();
      const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // Shell env vars are also supported.
  }
}

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

async function createSession(input: {
  openbellUrl: string;
  workerToken: string;
  theaterId: string;
  movieTitle: string;
  playDate: string;
  showtime: string;
  hall: string;
  requestedSeatCount: number;
  bookingUrl?: string;
}) {
  const response = await fetch(`${input.openbellUrl}/api/booking/create`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.workerToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      theaterId: input.theaterId,
      movieTitle: input.movieTitle,
      playDate: input.playDate,
      showtime: input.showtime,
      hall: input.hall,
      requestedSeatCount: input.requestedSeatCount,
      bookingUrl: input.bookingUrl || undefined,
      agent: "pc",
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OPENBELL_SESSION_CREATE_FAILED:${response.status}:${text.slice(0, 500)}`);
  }
  const data = (await response.json()) as { ok?: boolean; session?: { id?: string } };
  if (!data.ok || !data.session?.id) throw new Error("OPENBELL_SESSION_CREATE_INVALID_RESPONSE");
  return data.session.id;
}

async function updateState(input: {
  openbellUrl: string;
  workerToken: string;
  sessionId: string;
  state: BookingState;
}) {
  const response = await fetch(`${input.openbellUrl}/api/booking/state`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.workerToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ id: input.sessionId, state: input.state }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OPENBELL_STATE_UPDATE_FAILED:${response.status}:${text.slice(0, 500)}`);
  }
}

async function notifyPaymentReady(input: {
  openbellUrl: string;
  workerToken: string;
  sessionId: string;
  url: string;
  seats: string[];
}) {
  const response = await fetch(`${input.openbellUrl}/api/booking/payment-ready`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.workerToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      id: input.sessionId,
      browserAccessUrl: input.url,
      selectedSeats: input.seats,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OPENBELL_PAYMENT_READY_FAILED:${response.status}:${text.slice(0, 500)}`);
  }
}

export type RunBookingInput = BookingTarget & {
  bookingInfo?: Record<string, string>;
  storageStatePath?: string;
  headless?: boolean;
  holdAtPayment?: boolean;
  onStateChange?: (state: BookingState) => Promise<void>;
  onPaymentReady?: (result: { url: string; seats: string[] }) => Promise<void>;
};

/** Runs the full non-payment portion of a CGV booking. */
export async function runBooking(input: RunBookingInput) {
  const headless = input.headless ?? false;
  const agent = new CgvBookingAgent({
    storageStatePath: input.storageStatePath,
    headless,
    onPaymentReady: input.onPaymentReady,
  });

  await agent.launch();
  try {
    await input.onStateChange?.("SEAT_FOUND");
    await input.onStateChange?.("BOOKING");

    await agent.openMovie(input);
    await input.onStateChange?.("MOVIE_SELECTED");

    await agent.openShowtime(input);
    await input.onStateChange?.("SHOWTIME_SELECTED");

    await agent.selectSeats(input);
    await input.onStateChange?.("SEAT_SELECTED");

    if (input.bookingInfo) {
      await agent.fillBookingInfo(input.bookingInfo);
    }
    await input.onStateChange?.("BOOKING_INFO");

    const result = await agent.goToPaymentPage(input);
    const holdAtPayment = input.holdAtPayment ?? !headless;
    if (holdAtPayment) {
      await input.onStateChange?.("WAITING_USER");
      console.log("Payment hard stop reached. Browser remains open for manual completion.");
      await agent.waitForBrowserClose();
    } else {
      await agent.close();
    }
    return result;
  } catch (error) {
    await agent.close();
    throw error;
  }
}

// --- CLI entry ---

loadEnv(process.env.OPENBELL_AGENT_CONFIG || resolve(PC_ROOT, "config.env"));

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

const headless = bool("PLAYWRIGHT_HEADLESS", false);
const holdAtPayment = bool("PAYMENT_HOLD_BROWSER", true);
const storageStatePath = process.env.CGV_STORAGE_STATE?.trim() || undefined;
const openbellUrl = process.env.OPENBELL_URL?.trim().replace(/\/$/, "");
const workerToken = process.env.NAS_WORKER_TOKEN?.trim() || process.env.NAS_REPORT_TOKEN?.trim();
const callbacksEnabled = Boolean(openbellUrl && workerToken);
const dryRun = !callbacksEnabled;

let bookingSessionId = process.env.BOOKING_SESSION_ID?.trim();

const bookingInfo: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) {
  if (key.startsWith("BOOKING_INFO_")) bookingInfo[key.slice("BOOKING_INFO_".length)] = value || "";
}

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

if (callbacksEnabled) await stateCallback("WATCHING");
else await stateCallback("WATCHING");

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
      console.log("TTL: server PAYMENT_READY window is 10 minutes.");
      console.log("Telegram: sent by OpenBell server after payment-ready (not by this PC agent).");
      if (!headless && holdAtPayment) {
        console.log("Browser is being kept open for manual completion (PAYMENT_HOLD_BROWSER).");
      }
      console.log("========================================\n");

      if (!callbacksEnabled || !bookingSessionId) {
        console.log("[DRY-RUN] Skipped POST /api/booking/payment-ready");
        return;
      }

      await notifyPaymentReady({
        openbellUrl: openbellUrl!,
        workerToken: workerToken!,
        sessionId: bookingSessionId,
        url,
        seats,
      });
      console.log("OpenBell PAYMENT_READY callback sent successfully.");
    },
  });

  console.log(JSON.stringify(result, null, 2));
  if (dryRun) {
    printResultCode("B", "Dry-run HARD STOP at PAYMENT_READY (no OpenBell callbacks).");
  } else {
    printResultCode("A", "PAYMENT_READY HARD STOP; OpenBell notified. Finish payment manually within 10 min.");
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith("CAPTCHA_DETECTED")) {
    printResultCode("C", message);
  } else if (
    message.startsWith("OPENBELL_") ||
    message.includes("unauthorized") ||
    message.includes("OPENBELL")
  ) {
    printResultCode("E", message);
  } else {
    printResultCode("D", message);
  }
  process.exitCode = 1;
  throw error;
}
