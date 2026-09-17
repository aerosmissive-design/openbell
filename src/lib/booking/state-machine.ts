import type { BookingState } from "./types";

const transitions: Record<BookingState, readonly BookingState[]> = {
  IDLE: ["WATCHING", "CANCELLED"],
  WATCHING: ["SEAT_FOUND", "CANCELLED", "FAILED"],
  SEAT_FOUND: ["BOOKING", "CANCELLED", "FAILED"],
  BOOKING: ["MOVIE_SELECTED", "FAILED", "CANCELLED"],
  MOVIE_SELECTED: ["SHOWTIME_SELECTED", "FAILED", "CANCELLED"],
  SHOWTIME_SELECTED: ["SEAT_SELECTED", "FAILED", "CANCELLED"],
  SEAT_SELECTED: ["BOOKING_INFO", "FAILED", "CANCELLED"],
  BOOKING_INFO: ["PAYMENT_READY", "FAILED", "CANCELLED"],
  PAYMENT_READY: ["WAITING_USER", "EXPIRED", "CANCELLED"],
  WAITING_USER: ["COMPLETED", "EXPIRED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
  EXPIRED: [],
  FAILED: [],
};

export function canTransition(from: BookingState, to: BookingState): boolean {
  return transitions[from].includes(to);
}

export function transition(from: BookingState, to: BookingState): BookingState {
  if (!canTransition(from, to)) {
    throw new Error(`INVALID_BOOKING_TRANSITION:${from}->${to}`);
  }
  if (from === "PAYMENT_READY" && to !== "WAITING_USER" && to !== "EXPIRED" && to !== "CANCELLED") {
    throw new Error("AUTOMATION_HARD_STOP");
  }
  return to;
}

export function assertAutomationMayProceed(state: BookingState): void {
  if (state === "PAYMENT_READY" || state === "WAITING_USER") {
    throw new Error("AUTOMATION_HARD_STOP");
  }
}
