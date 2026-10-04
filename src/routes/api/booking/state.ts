import { createFileRoute } from "@tanstack/react-router";
import { updateBookingState } from "@/lib/booking/session";
import type { BookingState } from "@/lib/booking/types";
import { authorizeAgent } from "@/lib/cinema/devices.server";

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "POST,OPTIONS", "access-control-allow-headers": "authorization,content-type,x-openbell-device-key" } });
}

export const Route = createFileRoute("/api/booking/state")({
  server: {
    handlers: {
      OPTIONS: () => json({ ok: true }),
      POST: async ({ request }) => {
        const auth = await authorizeAgent(request, "seen");
        if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
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
