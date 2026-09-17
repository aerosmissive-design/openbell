import { createFileRoute } from "@tanstack/react-router";
import { updateBookingState } from "@/lib/booking/session";

function authorized(request: Request) {
  const expected = process.env.NAS_WORKER_TOKEN?.trim() || process.env.NAS_REPORT_TOKEN?.trim() || process.env.CRON_SECRET?.trim() || "";
  return Boolean(expected) && request.headers.get("authorization") === `Bearer ${expected}`;
}

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "POST,OPTIONS", "access-control-allow-headers": "authorization,content-type" } });
}

export const Route = createFileRoute("/api/booking/payment-ready")({
  server: {
    handlers: {
      OPTIONS: () => json({ ok: true }),
      POST: async ({ request }) => {
        if (!authorized(request)) return json({ ok: false, error: "unauthorized" }, 401);
        let body: { id?: string; browserAccessUrl?: string; selectedSeats?: string[] };
        try { body = await request.json(); } catch { return json({ ok: false, error: "invalid json" }, 400); }
        const id = String(body.id || "").trim();
        if (!id) return json({ ok: false, error: "id required" }, 400);
        try {
          const session = await updateBookingState(id, "PAYMENT_READY");
          const updated = { ...session, browserAccessUrl: body.browserAccessUrl || session.browserAccessUrl, selectedSeats: Array.isArray(body.selectedSeats) ? body.selectedSeats.map(String) : session.selectedSeats };
          const { saveBookingSession } = await import("@/lib/booking/session");
          await saveBookingSession(updated);
          return json({ ok: true, hardStop: true, session: updated });
        } catch (error) {
          const message = error instanceof Error ? error.message : "payment-ready failed";
          return json({ ok: false, error: message }, message === "BOOKING_SESSION_NOT_FOUND" ? 404 : 409);
        }
      },
    },
  },
});
