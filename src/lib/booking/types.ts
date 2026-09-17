export type BookingState =
  | "IDLE"
  | "WATCHING"
  | "SEAT_FOUND"
  | "BOOKING"
  | "MOVIE_SELECTED"
  | "SHOWTIME_SELECTED"
  | "SEAT_SELECTED"
  | "BOOKING_INFO"
  | "PAYMENT_READY"
  | "WAITING_USER"
  | "COMPLETED"
  | "CANCELLED"
  | "EXPIRED"
  | "FAILED";

export type BookingAgent = "pc" | "nas";

export type BookingSession = {
  id: string;
  theaterId: string;
  movieTitle: string;
  playDate: string;
  showtime: string;
  hall: string;
  requestedSeatCount: number;
  selectedSeats: string[];
  state: BookingState;
  agent: BookingAgent;
  bookingUrl?: string;
  browserAccessUrl?: string;
  createdAt: string;
  paymentReadyAt?: string;
  expiresAt?: string;
  telegramMessageId?: string;
};

export const PAYMENT_READY_TTL_MS = 10 * 60 * 1000;
