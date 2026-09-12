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
    note: "좌석을 찍고 결제 화면까지만 갑니다. 결제는 극장에서 직접 합니다.",
  };
}
