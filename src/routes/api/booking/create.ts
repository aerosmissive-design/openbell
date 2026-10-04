import { createFileRoute } from "@tanstack/react-router";
import { createBookingSession } from "@/lib/booking/session";
import { isAllowedBookingPageUrl } from "@/lib/booking/cgv-url";
import { authorizeAgent } from "@/lib/cinema/devices.server";

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST,OPTIONS",
      "access-control-allow-headers": "authorization,content-type,x-openbell-device-key",
    },
  });
}

export const Route = createFileRoute("/api/booking/create")({
  server: {
    handlers: {
      OPTIONS: () => json({ ok: true }),
      POST: async ({ request }) => {
        const auth = await authorizeAgent(request, "seen");
        if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

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
        const bookingUrl = bookingUrlRaw && isAllowedBookingPageUrl(bookingUrlRaw) ? bookingUrlRaw : undefined;

        if (!theaterId || !movieTitle || !playDate || !showtime || !hall) {
          return json({ ok: false, error: "theaterId, movieTitle, playDate, showtime, hall are required" }, 400);
        }
        if (!Number.isInteger(requestedSeatCount) || requestedSeatCount < 1 || requestedSeatCount > 10) {
          return json({ ok: false, error: "invalid requestedSeatCount" }, 400);
        }
        if (bookingUrlRaw && !bookingUrl) {
          return json({ ok: false, error: "bookingUrl must be a CGV/Megabox booking page, not payment" }, 400);
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
