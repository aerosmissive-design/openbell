import { createFileRoute } from "@tanstack/react-router";
import { heartbeatBookingJob, jobDbFailure } from "@/lib/cinema/booking-jobs.server";
import { authorizeAgent } from "@/lib/cinema/devices.server";

function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

export const Route = createFileRoute("/api/booking/jobs/heartbeat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authorizeAgent(request, "seen");
        if (!auth.ok) return json({ ok: false, error: auth.error, reason: auth.reason }, auth.status);
        let body: { id?: string; agentId?: string } = {};
        try {
          body = (await request.json()) as { id?: string; agentId?: string };
        } catch {
          return json({ ok: false, error: "invalid json" }, 400);
        }
        const id = String(body.id || "").trim();
        const agentId = String(body.agentId || (auth.via === "device" ? auth.deviceName : "")).trim();
        if (!id || !agentId) return json({ ok: false, error: "id + agentId required" }, 400);
        try {
          const job = await heartbeatBookingJob(id, agentId);
          if (!job) return json({ ok: false, error: "lease lost" }, 409);
          return json({ ok: true, job });
        } catch (err) {
          const fail = jobDbFailure(err);
          return json(fail, fail.reason === "error" ? 500 : 200);
        }
      },
    },
  },
});
