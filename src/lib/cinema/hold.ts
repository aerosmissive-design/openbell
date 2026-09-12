import type {
  AlertItem,
  BookingIntent,
  HoldPrefs,
  HoldSession,
  HoldZone,
  Showtime,
} from "./types";

export const HOLD_ZONE_OPTIONS: { id: HoldZone; label: string }[] = [
  { id: "center", label: "중앙" },
  { id: "rear", label: "뒤쪽" },
  { id: "front", label: "앞쪽" },
];

export function sessionFromSource(): HoldSession {
  return {
    id: "",
    startedAt: "",
    theaterId: "cgv_yongsan",
    movieTitle: "",
    playDate: "",
    startTime: "",
    hallName: "",
    formats: [],
    showtimeId: "",
    bookingUrl: "",
    restSeats: null,
    totalSeats: null,
    seats: 2,
    zone: "center",
    step: "seats",
    holdStartedAt: null,
  };
}

export function sessionFromShowtime(_show: Showtime, _prefs: HoldPrefs) {
  return sessionFromSource();
}

export function sessionFromAlert(_alert: AlertItem, _prefs: HoldPrefs) {
  return sessionFromSource();
}

export function sessionFromIntent(_item: BookingIntent, _prefs: HoldPrefs) {
  return sessionFromSource();
}

export function openBookingTab(url: string) {
  if (!url || typeof window === "undefined") return false;
  window.open(url, "_blank", "noopener,noreferrer");
  return true;
}
