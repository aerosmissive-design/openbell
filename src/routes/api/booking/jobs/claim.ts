import { createFileRoute } from "@tanstack/react-router";
import { claimBookingJob, jobDbFailure, userIdsForEmails } from "@/lib/cinema/booking-jobs.server";
import { claimEmailScope } from "@/lib/cinema/claim-scope";
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
        let body: { agentId?: string; emails?: unknown } = {};
        try {
          body = (await request.json()) as { agentId?: string; emails?: unknown };
        } catch {
          body = {};
        }
        const agentId = String(body.agentId || (auth.via === "device" ? auth.deviceName : "")).trim();
        if (!agentId) return json({ ok: false, error: "agentId required" }, 400);
        try {
          let userIds: string[] | null = null;
          let includeUnscoped = true;
          if (auth.via === "device") {
            userIds = auth.userIds;
          } else {
            const scope = claimEmailScope(body.emails);
            if (scope.kind === "none") return json({ ok: true, job: null });
            if (scope.kind === "emails") {
              userIds = await userIdsForEmails(scope.emails);
              includeUnscoped = false;
              if (userIds.length === 0) return json({ ok: true, job: null });
            }
          }
          const job = await claimBookingJob(agentId, userIds, includeUnscoped);
          return json({ ok: true, job });
        } catch (err) {
          const fail = jobDbFailure(err);
          return json(fail, fail.reason === "error" ? 500 : 200);
        }
      },
    },
  },
});
