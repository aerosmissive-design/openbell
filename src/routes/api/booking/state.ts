import { createFileRoute } from "@tanstack/react-router";
import { updateBookingState } from "@/lib/booking/session";
import type { BookingState } from "@/lib/booking/types";

function authorized(request: Request) {
  const expected = process.env.NAS_WORKER_TOKEN?.trim() || process.env.NAS_REPORT_TOKEN?.trim() || process.env.CRON_SECRET?.trim() || "";
  return Boolean(expected) && request.headers.get("authorization") === `Bearer ${expected}`;
}

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "POST,OPTIONS", "access-control-allow-headers": "authorization,content-type" } });
}

export const Route = createFileRoute("/api/booking/state")({
  server: {
    handlers: {
      OPTIONS: () => json({ ok: true }),
      POST: async ({ request }) => {
        if (!authorized(request)) return json({ ok: false, error: "unauthorized" }, 401);
        let body: { id?: string; state?: BookingState };
        try { body = await request.json(); } catch { return json({ ok: false, error: "invalid json" }, 400); }
        const id = String(body.id || "").trim();
        const state = body.state;
        if (!id || !state) return json({ ok: false, error: "id and state required" }, 400);
        try {
          const session = await updateBookingState(id, state);
          return json({ ok: true, session });
        } catch (error) {
          const message = error instanceof Error ? error.message : "state update failed";
          return json({ ok: false, error: message }, message === "BOOKING_SESSION_NOT_FOUND" ? 404 : 409);
        }
      },
    },
  },
});
