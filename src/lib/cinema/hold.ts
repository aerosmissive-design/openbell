import { theaterById } from "./theaters";
import type {
  AlertItem,
  BookingIntent,
  FormatId,
  HoldPrefs,
  HoldSession,
  HoldStep,
  HoldZone,
  Showtime,
  TheaterId,
} from "./types";

export type HoldSource = {
  theaterId: TheaterId;
  movieTitle: string;
  playDate: string;
  startTime: string;
  hallName: string;
  formats?: FormatId[];
  showtimeId?: string;
  id?: string;
  bookingUrl: string;
  restSeats?: number | null;
  totalSeats?: number | null;
};

const ROW_LABELS = "ABCDEFGHIJKL".split("");
const COLS = 16;
const ROWS = ROW_LABELS.length;

export const HOLD_STEPS: { id: HoldStep; title: string; hint: string }[] = [
  {
    id: "seats",
    title: "좌석 찍기",
    hint: "극장 화면에서 추천 구역을 찍으세요.",
  },
  {
    id: "pay",
    title: "결제 화면",
    hint: "결제하기만 눌러 좌석을 잡으세요. 결제는 하지 마세요.",
  },
  {
    id: "wait",
    title: "홀드",
    hint: "시간이 끝나기 전에 직접 결제하세요.",
  },
];

export function sessionFromSource(
  source: HoldSource,
  prefs: HoldPrefs,
): HoldSession {
  const showtimeId = source.showtimeId || source.id || "";
  return {
    id: `hold:${showtimeId || source.bookingUrl}:${Date.now()}`,
    startedAt: new Date().toISOString(),
    theaterId: source.theaterId,
    movieTitle: source.movieTitle,
    playDate: source.playDate,
    startTime: source.startTime,
    hallName: source.hallName,
    formats: source.formats ?? [],
    showtimeId,
    bookingUrl: source.bookingUrl,
    restSeats: source.restSeats ?? null,
    totalSeats: source.totalSeats ?? null,
    seats: prefs.seats,
    zone: prefs.zone,
    step: "seats",
    holdStartedAt: null,
  };
}

export function sessionFromShowtime(show: Showtime, prefs: HoldPrefs) {
  return sessionFromSource(
    {
      theaterId: show.theaterId,
      movieTitle: show.movieTitle,
      playDate: show.playDate,
      startTime: show.startTime,
      hallName: show.hallName,
      formats: show.formats,
      showtimeId: show.id,
      id: show.id,
      bookingUrl: show.bookingUrl,
      restSeats: show.restSeats,
      totalSeats: show.totalSeats,
    },
    prefs,
  );
}

export function sessionFromAlert(alert: AlertItem, prefs: HoldPrefs) {
  return sessionFromSource(
    {
      theaterId: alert.theaterId,
      movieTitle: alert.movieTitle,
      playDate: alert.playDate,
      startTime: alert.startTime,
      hallName: alert.hallName,
      formats: alert.formats,
      showtimeId: alert.id,
      id: alert.id,
      bookingUrl: alert.bookingUrl,
      restSeats: alert.restSeats,
      totalSeats: alert.totalSeats,
    },
    prefs,
  );
}

export function sessionFromIntent(item: BookingIntent, prefs: HoldPrefs) {
  return sessionFromSource(
    {
      theaterId: item.theaterId,
      movieTitle: item.movieTitle,
      playDate: item.playDate,
      startTime: item.startTime,
      hallName: item.hallName,
      showtimeId: item.showtimeId,
      id: item.showtimeId,
      bookingUrl: item.bookingUrl,
      restSeats: item.restSeats,
      totalSeats: item.totalSeats,
    },
    prefs,
  );
}

export function openBookingTab(url: string) {
  if (!url || typeof window === "undefined") return false;
  const popup = window.open(url, "_blank", "noopener,noreferrer");
  return Boolean(popup);
}

export function remainingHoldMs(
  holdStartedAt: string | null,
  minutes: number,
  now = Date.now(),
) {
  if (!holdStartedAt) return minutes * 60 * 1000;
  const end = Date.parse(holdStartedAt) + minutes * 60 * 1000;
  return Math.max(0, end - now);
}

export function formatHoldClock(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export type SeatGuide = {
  zoneLabel: string;
  rows: string;
  body: string;
  rowFrom: number;
  rowTo: number;
  colFrom: number;
  colTo: number;
  grid: { rows: number; cols: number };
};

export function describeSeatGuide(
  session: Pick<HoldSession, "formats" | "hallName" | "zone" | "seats">,
): SeatGuide {
  const band = zoneBand(session.zone);
  const colFrom = Math.max(2, Math.floor((COLS - session.seats) / 2));
  const colTo = Math.min(COLS - 3, colFrom + session.seats - 1);
  const format = session.formats[0] ?? inferFormat(session.hallName);
  return {
    zoneLabel: zoneLabel(session.zone),
    rows: `${ROW_LABELS[band.from]}–${ROW_LABELS[band.to]}열`,
    body: guideBody(format, session.zone, session.seats),
    rowFrom: band.from,
    rowTo: band.to,
    colFrom,
    colTo,
    grid: { rows: ROWS, cols: COLS },
  };
}

export function isGuideSeat(
  guide: SeatGuide,
  row: number,
  col: number,
) {
  return (
    row >= guide.rowFrom &&
    row <= guide.rowTo &&
    col >= guide.colFrom &&
    col <= guide.colTo
  );
}

export function holdPlaceLine(session: HoldSession) {
  const theater = theaterById(session.theaterId);
  const bits = [
    theater.shortName,
    formatHoldDate(session.playDate),
    session.startTime,
  ];
  if (session.hallName) bits.push(session.hallName);
  return bits.filter(Boolean).join(" · ");
}

export function formatHoldDate(ymd: string) {
  const s = String(ymd || "");
  if (s.length < 8) return s;
  const month = Number(s.slice(4, 6));
  const day = Number(s.slice(6, 8));
  if (!month || !day) return s;
  return `${month}월 ${day}일`;
}

function zoneBand(zone: HoldZone): { from: number; to: number } {
  if (zone === "front") return { from: 1, to: 4 };
  if (zone === "rear") return { from: 8, to: 11 };
  return { from: 5, to: 8 };
}

function zoneLabel(zone: HoldZone) {
  if (zone === "front") return "앞쪽 중앙";
  if (zone === "rear") return "뒤쪽 중앙";
  return "정중앙";
}

function inferFormat(hallName: string): FormatId | "other" {
  const compact = hallName.toUpperCase().replace(/\s+/g, "");
  if (compact.includes("IMAX")) return "imax";
  if (compact.includes("ULTRA4DX")) return "ultra4dx";
  if (compact.includes("4DX")) return "4dx";
  if (compact.includes("SCREENX") || hallName.includes("스크린X")) return "screenx";
  if (compact.includes("DOLBY") || hallName.includes("돌비")) return "dolby";
  if (compact.includes("MX4D")) return "mx4d";
  if (compact.includes("LED")) return "mega_led";
  if (compact.includes("ATMOS") || hallName.includes("애트모스")) return "atmos";
  return "other";
}

function guideBody(format: FormatId | "other", zone: HoldZone, seats: number) {
  const count = `${seats}자리`;
  const place = zoneLabel(zone);
  if (format === "imax") {
    return `IMAX는 ${place} ${count}. 너무 앞자리는 피하고, 가운데 블록을 이어서 찍으세요.`;
  }
  if (format === "4dx" || format === "ultra4dx" || format === "mx4d") {
    return `체감 특별관은 ${place} ${count}. 맨 앞·맨 끝보다 가운데가 안정적입니다.`;
  }
  if (format === "screenx") {
    return `스크린X는 양쪽 벽면이 보이는 ${place} ${count}를 찍으세요.`;
  }
  if (format === "dolby" || format === "atmos" || format === "mega_led") {
    return `${place} ${count}. 스피커·화면이 고르게 오는 가운데를 우선합니다.`;
  }
  return `극장 좌석도에서 ${place} ${count}를 이어서 찍으세요.`;
}

export const HOLD_ZONE_OPTIONS: { id: HoldZone; label: string }[] = [
  { id: "center", label: "중앙" },
  { id: "rear", label: "뒤쪽" },
  { id: "front", label: "앞쪽" },
];
