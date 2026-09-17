import { readFileSync } from "node:fs";
import { runBooking } from "./run-booking";
import type { BookingState } from "../../src/lib/booking/types";

function loadEnv(path = "config.env") {
  try {
    const text = readFileSync(path, "utf8");
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const index = line.indexOf("=");
      if (index < 1) continue;
      const key = line.slice(0, index).trim();
      const value = line.slice(index + 1).trim().replace(/^['\"]|['\"]$/g, "");
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // Shell environment variables are also supported.
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

loadEnv(process.env.OPENBELL_AGENT_CONFIG || "config.env");

const requestedSeatCount = Number(process.env.BOOKING_SEAT_COUNT || "2");
if (!Number.isInteger(requestedSeatCount) || requestedSeatCount < 1) throw new Error("INVALID_BOOKING_SEAT_COUNT");

const explicitSeatIds = (process.env.BOOKING_SEAT_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (explicitSeatIds.length && explicitSeatIds.length !== requestedSeatCount) {
  throw new Error("BOOKING_SEAT_IDS must contain exactly BOOKING_SEAT_COUNT seats when provided");
}

const target = {
  movieTitle: required("BOOKING_MOVIE"),
  playDate: required("BOOKING_DATE"),
  showtime: required("BOOKING_SHOWTIME"),
  requestedSeatCount,
  seatIds: explicitSeatIds.length ? explicitSeatIds : undefined,
  seatPreference: {
    preferredRow: process.env.SEAT_PREFERRED_ROW?.trim() || undefined,
    preferredRowDistance: optionalNumber("SEAT_PREFERRED_ROW_DISTANCE"),
    allowAisle: bool("SEAT_ALLOW_AISLE", true),
    allowEdge: bool("SEAT_ALLOW_EDGE", false),
  },
};

const headless = bool("PLAYWRIGHT_HEADLESS", false);
const storageStatePath = process.env.CGV_STORAGE_STATE?.trim() || undefined;
const openbellUrl = process.env.OPENBELL_URL?.trim().replace(/\/$/, "");
const workerToken = process.env.NAS_WORKER_TOKEN?.trim() || process.env.NAS_REPORT_TOKEN?.trim();
let bookingSessionId = process.env.BOOKING_SESSION_ID?.trim();
const autoCreatedSession = !bookingSessionId;

const bookingInfo: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) {
  if (key.startsWith("BOOKING_INFO_")) bookingInfo[key.slice("BOOKING_INFO_".length)] = value || "";
}

if (!bookingSessionId) {
  if (!openbellUrl || !workerToken) {
    throw new Error("AUTO_BOOKING_SESSION_REQUIRES_OPENBELL_URL_AND_NAS_WORKER_TOKEN");
  }
  bookingSessionId = await createSession({
    openbellUrl,
    workerToken,
    theaterId: process.env.BOOKING_THEATER_ID?.trim() || "CGV용산아이파크몰",
    movieTitle: target.movieTitle,
    playDate: target.playDate,
    showtime: target.showtime,
    hall: process.env.BOOKING_HALL?.trim() || "20관",
    requestedSeatCount,
  });
  console.log(`OpenBell booking session created: ${bookingSessionId}`);
}

const stateCallback =
  autoCreatedSession && openbellUrl && workerToken && bookingSessionId
    ? async (state: BookingState) => {
        await updateState({ openbellUrl, workerToken, sessionId: bookingSessionId as string, state });
        console.log(`OpenBell booking state: ${state}`);
      }
    : undefined;

if (stateCallback) await stateCallback("WATCHING");

const result = await runBooking({
  ...target,
  storageStatePath,
  headless,
  bookingInfo: Object.keys(bookingInfo).length ? bookingInfo : undefined,
  onStateChange: stateCallback,
  onPaymentReady: async ({ url, seats }) => {
    console.log("\n========================================");
    console.log("PAYMENT_READY - AUTOMATION HARD STOP");
    console.log(`URL: ${url}`);
    console.log(`SEATS: ${seats.join(", ")}`);
    console.log("Final payment was NOT clicked.");
    console.log("========================================\n");

    if (!bookingSessionId) return;
    if (!openbellUrl || !workerToken) {
      throw new Error("BOOKING_SESSION_CALLBACK_REQUIRES_OPENBELL_URL_AND_NAS_WORKER_TOKEN");
    }

    const response = await fetch(`${openbellUrl}/api/booking/payment-ready`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${workerToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ id: bookingSessionId, browserAccessUrl: url, selectedSeats: seats }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OPENBELL_PAYMENT_READY_FAILED:${response.status}:${text.slice(0, 500)}`);
    }

    console.log("OpenBell PAYMENT_READY callback sent successfully.");
  },
});

console.log(JSON.stringify(result, null, 2));
