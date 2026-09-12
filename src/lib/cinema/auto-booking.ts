import type { BookingIntent, Showtime } from "./types";

/** Phase 2 hook — queue only. Never talks to a payment gateway. */
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
    note: "자동결제는 영화관 이용약관상 직접 구현하지 않습니다. 예매 페이지로 바로 이동합니다.",
  };
}
