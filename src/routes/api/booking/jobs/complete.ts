import { createFileRoute } from "@tanstack/react-router";
import { bookingJobsAuth, completeBookingJob, jobDbFailure } from "@/lib/cinema/booking-jobs.server";
import { nasJobsConfigured } from "@/lib/cinema/nas-jobs.server";

function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

export const Route = createFileRoute("/api/booking/jobs/complete")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!nasJobsConfigured()) return json({ ok: false, reason: "no_token" }, 503);
        if (!bookingJobsAuth(request)) return json({ ok: false, error: "unauthorized" }, 401);
        let body: { id?: string; agentId?: string; status?: string; resultMessage?: string } = {};
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return json({ ok: false, error: "invalid json" }, 400);
        }
        const id = String(body.id || "").trim();
        const agentId = String(body.agentId || "").trim();
        const status = String(body.status || "");
        if (!id || !agentId || !["done", "failed", "need_user"].includes(status)) {
          return json({ ok: false, error: "id, agentId, status(done|failed|need_user)" }, 400);
        }
        try {
          const job = await completeBookingJob({
            id,
            agentId,
            status: status as "done" | "failed" | "need_user",
            resultMessage: body.resultMessage,
          });
          if (!job) return json({ ok: false, error: "job not running for this agent" }, 404);
          return json({ ok: true, job });
        } catch (err) {
          const fail = jobDbFailure(err);
          return json(fail, fail.reason === "error" ? 500 : 200);
        }
      },
    },
  },
});
