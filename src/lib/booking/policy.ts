import type { BookingState } from "./types";

export function assertAutomationMayProceed(state: BookingState) {
  if (state === "PAYMENT_READY" || state === "WAITING_USER") {
    throw new Error("AUTOMATION_HARD_STOP");
  }
}

export function isPaymentReady(state: BookingState) {
  return state === "PAYMENT_READY" || state === "WAITING_USER";
}

export function isExpired(expiresAt?: string) {
  if (!expiresAt) return false;
  return Date.now() >= Date.parse(expiresAt);
}
