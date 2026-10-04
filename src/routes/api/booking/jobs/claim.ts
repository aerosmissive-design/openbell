import { createFileRoute } from "@tanstack/react-router";
import { claimBookingJob, jobDbFailure } from "@/lib/cinema/booking-jobs.server";
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
        let body: { agentId?: string } = {};
        try {
          body = (await request.json()) as { agentId?: string };
        } catch {
          body = {};
        }
        const agentId = String(body.agentId || (auth.via === "device" ? auth.deviceName : "")).trim();
        if (!agentId) return json({ ok: false, error: "agentId required" }, 400);
        try {
          const job = await claimBookingJob(agentId, auth.via === "device" ? auth.userIds : null);
          return json({ ok: true, job });
        } catch (err) {
          const fail = jobDbFailure(err);
          return json(fail, fail.reason === "error" ? 500 : 200);
        }
      },
    },
  },
});
