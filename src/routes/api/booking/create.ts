import { createFileRoute } from "@tanstack/react-router";
import { createBookingSession } from "@/lib/booking/session";
import { isExactCgvMovieBookUrl } from "@/lib/booking/cgv-url";

function authorized(request: Request) {
  const expected = process.env.NAS_WORKER_TOKEN?.trim() || process.env.NAS_REPORT_TOKEN?.trim() || process.env.CRON_SECRET?.trim() || "";
  return Boolean(expected) && request.headers.get("authorization") === `Bearer ${expected}`;
}

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST,OPTIONS",
      "access-control-allow-headers": "authorization,content-type",
    },
  });
}

export const Route = createFileRoute("/api/booking/create")({
  server: {
    handlers: {
      OPTIONS: () => json({ ok: true }),
      POST: async ({ request }) => {
        if (!authorized(request)) return json({ ok: false, error: "unauthorized" }, 401);

        let body: Record<string, unknown>;
        try {
          body = await request.json();
        } catch {
          return json({ ok: false, error: "invalid json" }, 400);
        }

        const theaterId = String(body.theaterId || "").trim();
        const movieTitle = String(body.movieTitle || "").trim();
        const playDate = String(body.playDate || "").trim();
        const showtime = String(body.showtime || "").trim();
        const hall = String(body.hall || "").trim();
        const requestedSeatCount = Number(body.requestedSeatCount ?? 2);
        const bookingUrlRaw = String(body.bookingUrl || "").trim();
        const bookingUrl = bookingUrlRaw && isExactCgvMovieBookUrl(bookingUrlRaw) ? bookingUrlRaw : undefined;

        if (!theaterId || !movieTitle || !playDate || !showtime || !hall) {
          return json({ ok: false, error: "theaterId, movieTitle, playDate, showtime, hall are required" }, 400);
        }
        if (!Number.isInteger(requestedSeatCount) || requestedSeatCount < 1 || requestedSeatCount > 10) {
          return json({ ok: false, error: "invalid requestedSeatCount" }, 400);
        }
        if (bookingUrlRaw && !bookingUrl) {
          return json({ ok: false, error: "bookingUrl must be a valid exact CGV movie-booking URL" }, 400);
        }

        const agent = body.agent === "nas" ? "nas" : "pc";
        const session = await createBookingSession({
          theaterId,
          movieTitle,
          playDate,
          showtime,
          hall,
          requestedSeatCount,
          selectedSeats: [],
          agent,
          bookingUrl,
        });

        return json({ ok: true, session });
      },
    },
  },
});
