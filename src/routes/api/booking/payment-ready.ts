import { createFileRoute } from "@tanstack/react-router";
import { updateBookingState, saveBookingSession } from "@/lib/booking/session";
import { telegramSafeBrowserUrl } from "@/lib/booking/cgv-url";
import { paymentReadyIdempotencyKey } from "@/lib/notify/policy";
import { authorizeAgent } from "@/lib/cinema/devices.server";

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "POST,OPTIONS", "access-control-allow-headers": "authorization,content-type,x-openbell-device-key" } });
}

export const Route = createFileRoute("/api/booking/payment-ready")({
  server: {
    handlers: {
      OPTIONS: () => json({ ok: true }),
      POST: async ({ request }) => {
        const auth = await authorizeAgent(request, "payment");
        if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
        let body: { id?: string; browserAccessUrl?: string; selectedSeats?: string[] };
        try { body = await request.json(); } catch { return json({ ok: false, error: "invalid json" }, 400); }
        const id = String(body.id || "").trim();
        if (!id) return json({ ok: false, error: "id required" }, 400);
        try {
          const session = await updateBookingState(id, "PAYMENT_READY");
          const updated = {
            ...session,
            browserAccessUrl: telegramSafeBrowserUrl(body.browserAccessUrl) || session.browserAccessUrl,
            selectedSeats: Array.isArray(body.selectedSeats) ? body.selectedSeats.map(String) : session.selectedSeats,
          };
          await saveBookingSession(updated);

          let notify: unknown = { ok: false, skipped: true };
          try {
            const { dispatchNotification } = await import("@/lib/notify");
            notify = await dispatchNotification({
              eventType: "PAYMENT_READY",
              userId: auth.via === "device" ? auth.userId : "",
              serverId: updated.agent || "openbell",
              payload: {
                theaterId: updated.theaterId,
                movieTitle: updated.movieTitle,
                playDate: updated.playDate,
                showtime: updated.showtime,
                hall: updated.hall,
                seats: updated.selectedSeats,
              },
              idempotencyKey: paymentReadyIdempotencyKey(updated.agent || "openbell", updated.id, new Date()),
              timestamp: new Date().toISOString(),
            });
          } catch (error) {
            notify = { ok: false, error: error instanceof Error ? error.message : "notify failed" };
          }

          return json({ ok: true, hardStop: true, session: updated, notify });
        } catch (error) {
          const message = error instanceof Error ? error.message : "payment-ready failed";
          return json({ ok: false, error: message }, message === "BOOKING_SESSION_NOT_FOUND" ? 404 : 409);
        }
      },
    },
  },
});
