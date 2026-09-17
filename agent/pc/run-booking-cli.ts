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
  } catch {}
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`MISSING_ENV:${name}`);
  return value;
}

loadEnv(process.env.OPENBELL_AGENT_CONFIG || "config.env");

const count = Number(process.env.BOOKING_SEAT_COUNT || "2");
if (!Number.isInteger(count) || count < 1) throw new Error("BOOKING_SEAT_COUNT must be a positive integer");

const explicitSeatIds = (process.env.BOOKING_SEAT_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
if (explicitSeatIds.length && explicitSeatIds.length !== count) {
  throw new Error("BOOKING_SEAT_IDS must contain exactly BOOKING_SEAT_COUNT seats when provided");
}

const target = {
  movieTitle: required("BOOKING_MOVIE"),
  playDate: required("BOOKING_DATE"),
  showtime: required("BOOKING_SHOWTIME"),
  requestedSeatCount: count,
  seatIds: explicitSeatIds,
  seatPreference: {
    preferredRow: process.env.SEAT_PREFERRED_ROW?.trim() || undefined,
    preferredRowDistance: Number(process.env.SEAT_PREFERRED_ROW_DISTANCE || "0") || undefined,
    allowAisle: /^(1|true|yes)$/i.test(process.env.SEAT_ALLOW_AISLE || "true"),
    allowEdge: /^(1|true|yes)$/i.test(process.env.SEAT_ALLOW_EDGE || "false"),
  },
};

const headless = /^(1|true|yes)$/i.test(process.env.PLAYWRIGHT_HEADLESS || "false");
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
