import { createFileRoute } from "@tanstack/react-router";
import { createBookingSession, getBookingSession } from "@/lib/booking/session";
import type { BookingAgent } from "@/lib/booking/types";

function token() {
  return process.env.NAS_WORKER_TOKEN?.trim() || process.env.NAS_REPORT_TOKEN?.trim() || process.env.CRON_SECRET?.trim() || "";
}

function authorized(request: Request) {
  const expected = token();
  return Boolean(expected) && request.headers.get("authorization") === `Bearer ${expected}`;
}

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "authorization,content-type" } });
}

export const Route = createFileRoute("/api/booking/session")({
  server: {
    handlers: {
      OPTIONS: () => json({ ok: true }),
      GET: async ({ request }) => {
        if (!authorized(request)) return json({ ok: false, error: "unauthorized" }, 401);
        const id = new URL(request.url).searchParams.get("id")?.trim();
        if (!id) return json({ ok: false, error: "id required" }, 400);
        const session = await getBookingSession(id);
        return session ? json({ ok: true, session }) : json({ ok: false, error: "not found" }, 404);
      },
      POST: async ({ request }) => {
        if (!authorized(request)) return json({ ok: false, error: "unauthorized" }, 401);
        let body: Record<string, unknown>;
        try { body = await request.json(); } catch { return json({ ok: false, error: "invalid json" }, 400); }
        const theaterId = String(body.theaterId || "").trim();
        const movieTitle = String(body.movieTitle || "").trim();
        const playDate = String(body.playDate || "").trim();
        const showtime = String(body.showtime || "").trim();
        const hall = String(body.hall || "").trim();
        const requestedSeatCount = Number(body.requestedSeatCount);
        const agent = String(body.agent || "pc") as BookingAgent;
        if (!theaterId || !movieTitle || !playDate || !showtime || !hall || !Number.isInteger(requestedSeatCount) || requestedSeatCount < 1 || requestedSeatCount > 10) {
          return json({ ok: false, error: "invalid booking target" }, 400);
        }
        if (agent !== "pc" && agent !== "nas") return json({ ok: false, error: "invalid agent" }, 400);
        const session = await createBookingSession({ theaterId, movieTitle, playDate, showtime, hall, requestedSeatCount, selectedSeats: [], agent });
        return json({ ok: true, session }, 201);
      },
    },
  },
});
