import { createFileRoute } from "@tanstack/react-router";
import { bookingJobsAuth, claimBookingJob, jobDbFailure } from "@/lib/cinema/booking-jobs.server";
import { nasJobsConfigured } from "@/lib/cinema/nas-jobs.server";

function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

export const Route = createFileRoute("/api/booking/jobs/claim")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!nasJobsConfigured()) return json({ ok: false, reason: "no_token" }, 503);
        if (!bookingJobsAuth(request)) return json({ ok: false, error: "unauthorized" }, 401);
        let body: { agentId?: string } = {};
        try {
          body = (await request.json()) as { agentId?: string };
        } catch {
          body = {};
        }
        const agentId = String(body.agentId || "").trim();
        if (!agentId) return json({ ok: false, error: "agentId required" }, 400);
        try {
          const job = await claimBookingJob(agentId);
          return json({ ok: true, job });
        } catch (err) {
          const fail = jobDbFailure(err);
          return json(fail, fail.reason === "error" ? 500 : 200);
        }
      },
    },
  },
});
