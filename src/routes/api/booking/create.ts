import { createFileRoute } from "@tanstack/react-router";
import { createBookingSession } from "@/lib/booking/session";

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

function normalizeCgvBookingUrl(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    const pathname = url.pathname.replace(/\/+$/, "");
    if (!/^https:$/.test(url.protocol)) return undefined;
    if (host !== "cgv.co.kr" && host !== "www.cgv.co.kr") return undefined;
    if (pathname !== "/cnm/movieBook/movie") return undefined;
    const required = ["movNo", "scnYmd", "scnsNo", "scnSseq"];
    if (!required.every((key) => url.searchParams.get(key))) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
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
        const bookingUrl = normalizeCgvBookingUrl(body.bookingUrl);

        if (!theaterId || !movieTitle || !playDate || !showtime || !hall) {
          return json({ ok: false, error: "theaterId, movieTitle, playDate, showtime, hall are required" }, 400);
        }
        if (!Number.isInteger(requestedSeatCount) || requestedSeatCount < 1 || requestedSeatCount > 10) {
          return json({ ok: false, error: "invalid requestedSeatCount" }, 400);
        }
        if (body.bookingUrl && !bookingUrl) {
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
