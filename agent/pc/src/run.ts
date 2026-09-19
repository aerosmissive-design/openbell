import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  CgvBookingAgent,
  type BookingState,
  type BookingTarget,
  isExactCgvBookingUrl,
} from "./cgv-agent.js";
import { classifyAgentError } from "./result-code.js";
import { isBookingDate, isBookingShowtime } from "./safety.js";
import { PC_ROOT, applyEnvFile, isFalseyFlag } from "./env.js";

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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  const cause = (error as Error & { cause?: { code?: string } }).cause;
  const code = String(cause?.code || "").toLowerCase();
  return (
    /fetch failed|network|econnreset|econnrefused|etimedout|enotfound|socket|aborted/.test(msg) ||
    /econnreset|econnrefused|etimedout|enotfound|und_err/.test(code)
  );
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

/**
 * POST payment-ready with up to 3 attempts.
 * Retries network errors and 5xx with backoff ~500ms then ~1500ms.
 * Never retries HTTP 401.
 */
async function notifyPaymentReady(input: {
  openbellUrl: string;
  workerToken: string;
  sessionId: string;
  url: string;
  seats: string[];
}) {
  const backoffMs = [500, 1500];
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
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

      if (response.status === 401) {
        const text = await response.text();
        throw new Error(`OPENBELL_PAYMENT_READY_FAILED:401:${text.slice(0, 500)}`);
      }

      if (response.status >= 500) {
        const text = await response.text();
        lastError = new Error(`OPENBELL_PAYMENT_READY_FAILED:${response.status}:${text.slice(0, 500)}`);
        if (attempt < 3) {
          const wait = backoffMs[attempt - 1] ?? 1500;
          console.warn(`[payment-ready] ${response.status} on attempt ${attempt}/3; retry in ${wait}ms`);
          await sleep(wait);
          continue;
        }
        throw lastError;
      }

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`OPENBELL_PAYMENT_READY_FAILED:${response.status}:${text.slice(0, 500)}`);
      }

      const data = (await response.json().catch(() => ({}))) as {
        hardStop?: unknown;
        telegram?: unknown;
        ok?: unknown;
      };
      if (data.hardStop !== undefined || data.telegram !== undefined) {
        const tg =
          data.telegram == null
            ? "n/a"
            : typeof data.telegram === "object"
              ? JSON.stringify(data.telegram).slice(0, 120)
              : String(data.telegram).slice(0, 120);
        console.log(`[payment-ready] hardStop=${String(data.hardStop)} telegram=${tg}`);
      }
      return;
    } catch (error) {
      if (error instanceof Error && error.message.includes(":401:")) throw error;
      if (!isRetryableNetworkError(error) && !(error instanceof Error && /OPENBELL_PAYMENT_READY_FAILED:5\d\d/.test(error.message))) {
        if (error instanceof Error && error.message.startsWith("OPENBELL_PAYMENT_READY_FAILED:")) throw error;
        if (!isRetryableNetworkError(error)) throw error;
      }
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < 3) {
        const wait = backoffMs[attempt - 1] ?? 1500;
        console.warn(`[payment-ready] network/5xx on attempt ${attempt}/3; retry in ${wait}ms`);
        await sleep(wait);
        continue;
      }
      throw lastError;
    }
  }

  throw lastError ?? new Error("OPENBELL_PAYMENT_READY_FAILED:unknown");
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
  const holdAtPayment = input.holdAtPayment ?? !headless;
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
    if (holdAtPayment) {
      await input.onStateChange?.("WAITING_USER");
      console.log("Payment hard stop reached. Browser remains open for manual completion.");
      await agent.waitForBrowserClose();
    } else {
      await agent.close();
    }
    return result;
  } catch (error) {
    // If we already hit PAYMENT_READY, never close the browser on a later API/callback error.
    if (agent.hasHardStopped() && holdAtPayment) {
      console.error("[HARD_STOP] Error after payment page. Browser stays open for manual payment.");
      console.error(error instanceof Error ? error.message : error);
      try {
        await input.onStateChange?.("WAITING_USER");
      } catch {
        /* ignore */
      }
      await agent.waitForBrowserClose();
      throw error;
    }
    await agent.close();
    throw error;
  }
}

// --- CLI entry ---

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

/** Preflight banner — never prints tokens or secrets. */
console.log("========================================");
console.log("OpenBell PC Agent preflight");
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
const storageResolved = storageStatePath ? resolve(PC_ROOT, storageStatePath) : undefined;
if (storageResolved && existsSync(storageResolved)) {
  console.log("CGV_STORAGE_STATE: file found");
} else if (storageStatePath) {
  console.log("WARNING: CGV_STORAGE_STATE file missing. Run 4-save-login.cmd after a manual CGV login.");
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
  printResultCode(classifyAgentError(message), message);
  // Server has no CAPTCHA_STOP state — report FAILED so the session is not left WATCHING.
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
