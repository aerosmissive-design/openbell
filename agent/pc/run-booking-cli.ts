import { readFileSync } from "node:fs";
import { runBooking } from "./run-booking";

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

const bookingInfo: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) {
  if (key.startsWith("BOOKING_INFO_")) bookingInfo[key.slice("BOOKING_INFO_".length)] = value || "";
}

const result = await runBooking({
  ...target,
  storageStatePath,
  headless,
  bookingInfo: Object.keys(bookingInfo).length ? bookingInfo : undefined,
  onPaymentReady: async ({ url, seats }) => {
    console.log("\n========================================");
    console.log("PAYMENT_READY - AUTOMATION HARD STOP");
    console.log(`URL: ${url}`);
    console.log(`SEATS: ${seats.join(", ")}`);
    console.log("Final payment was NOT clicked.");
    console.log("========================================\n");
  },
});

console.log(JSON.stringify(result, null, 2));
