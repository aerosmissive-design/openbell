import { createFileRoute } from "@tanstack/react-router";
import { jobDbFailure, retryFailedBookingJob } from "@/lib/cinema/booking-jobs.server";
import { authorizeAgent } from "@/lib/cinema/devices.server";

function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

/** failed 잡만 다시 pending. 화면 버튼은 없음. */
export const Route = createFileRoute("/api/booking/jobs/retry")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authorizeAgent(request, "seen");
        if (!auth.ok) return json({ ok: false, error: auth.error, reason: auth.reason }, auth.status);
        let body: { id?: string } = {};
        try {
          body = (await request.json()) as { id?: string };
        } catch {
          return json({ ok: false, error: "invalid json" }, 400);
        }
        const id = String(body.id || "").trim();
        if (!id) return json({ ok: false, error: "id required" }, 400);
        try {
          const job = await retryFailedBookingJob(id);
          if (!job) return json({ ok: false, error: "failed job not found" }, 404);
          return json({ ok: true, job });
        } catch (err) {
          const fail = jobDbFailure(err);
          return json(fail, fail.reason === "error" ? 500 : 200);
        }
      },
    },
  },
});
