import type { BookingIntent, Showtime } from "./types";

/** Queue only. Seat hold opens the theater page and stops before payment. */
export function intentFromShowtime(show: Showtime): BookingIntent {
  return {
    id: `intent:${show.id}`,
    queuedAt: new Date().toISOString(),
    theaterId: show.theaterId,
    movieTitle: show.movieTitle,
    playDate: show.playDate,
    startTime: show.startTime,
    hallName: show.hallName,
    showtimeId: show.id,
    bookingUrl: show.bookingUrl,
    restSeats: show.restSeats,
    totalSeats: show.totalSeats,
    note: "별표입니다. 홀드로 분류하면 오픈 때 정중앙 결제 화면까지 갑니다.",
    hold: false,
  };
}
