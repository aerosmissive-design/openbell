import { createFileRoute } from "@tanstack/react-router";
import { bookingDeviceName } from "@/lib/cinema/booking-link";
import { claimBookingJobForDevice, jobDbFailure } from "@/lib/cinema/booking-jobs.server";
import { authorizeAgent } from "@/lib/cinema/devices.server";

function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

export const Route = createFileRoute("/api/booking/jobs/claim")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authorizeAgent(request, "claim");
        if (!auth.ok) return json({ ok: false, error: auth.error, reason: auth.reason }, auth.status);
        let body: { agentId?: string; deviceName?: unknown } = {};
        try {
          body = (await request.json()) as { agentId?: string; deviceName?: unknown };
        } catch {
          body = {};
        }
        const agentId = String(body.agentId || (auth.via === "device" ? auth.deviceName : "")).trim();
        if (!agentId) return json({ ok: false, error: "agentId required" }, 400);
        const device = bookingDeviceName(body.deviceName || (auth.via === "device" ? auth.deviceName : ""));
        if (!device) return json({ ok: true, job: null });
        try {
          const job = await claimBookingJobForDevice(agentId, device);
          return json({ ok: true, job });
        } catch (err) {
          const fail = jobDbFailure(err);
          return json(fail, fail.reason === "error" ? 500 : 200);
        }
      },
    },
  },
});
