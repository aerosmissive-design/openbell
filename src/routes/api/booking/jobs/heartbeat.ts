import { createFileRoute } from "@tanstack/react-router";
import { bookingJobsAuth, heartbeatBookingJob, jobDbFailure } from "@/lib/cinema/booking-jobs.server";
import { nasJobsConfigured } from "@/lib/cinema/nas-jobs.server";

function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

export const Route = createFileRoute("/api/booking/jobs/heartbeat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!nasJobsConfigured()) return json({ ok: false, reason: "no_token" }, 503);
        if (!bookingJobsAuth(request)) return json({ ok: false, error: "unauthorized" }, 401);
        let body: { id?: string; agentId?: string } = {};
        try {
          body = (await request.json()) as { id?: string; agentId?: string };
        } catch {
          return json({ ok: false, error: "invalid json" }, 400);
        }
        const id = String(body.id || "").trim();
        const agentId = String(body.agentId || "").trim();
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
