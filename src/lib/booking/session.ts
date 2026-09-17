import { readAppMeta, writeAppMeta } from "@/lib/cinema/app-meta.server";
import { transition } from "./state-machine";
import type { BookingSession, BookingState } from "./types";

const PREFIX = "booking_session:";

function key(id: string) {
  return `${PREFIX}${id}`;
}

export async function getBookingSession(id: string): Promise<BookingSession | null> {
  const raw = await readAppMeta(key(id));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as BookingSession;
  } catch {
    return null;
  }
}

export async function saveBookingSession(session: BookingSession) {
  await writeAppMeta(key(session.id), JSON.stringify(session));
  return session;
}

export async function createBookingSession(input: Omit<BookingSession, "id" | "createdAt" | "state">) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  return saveBookingSession({ ...input, id, createdAt: now, state: "IDLE" });
}

export async function updateBookingState(id: string, next: BookingState) {
  const session = await getBookingSession(id);
  if (!session) throw new Error("BOOKING_SESSION_NOT_FOUND");
  const state = transition(session.state, next);
  const updated = { ...session, state };
  if (state === "PAYMENT_READY") {
    updated.paymentReadyAt = new Date().toISOString();
    updated.expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  }
  return saveBookingSession(updated);
}

export async function patchBookingSession(id: string, patch: Partial<BookingSession>) {
  const session = await getBookingSession(id);
  if (!session) throw new Error("BOOKING_SESSION_NOT_FOUND");
  return saveBookingSession({ ...session, ...patch, id: session.id });
}
