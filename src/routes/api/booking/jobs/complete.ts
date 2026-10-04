import { createFileRoute } from "@tanstack/react-router";
import { completeBookingJob, jobDbFailure } from "@/lib/cinema/booking-jobs.server";
import { authorizeAgent } from "@/lib/cinema/devices.server";

function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

export const Route = createFileRoute("/api/booking/jobs/complete")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authorizeAgent(request, "seen");
        if (!auth.ok) return json({ ok: false, error: auth.error, reason: auth.reason }, auth.status);
        let body: { id?: string; agentId?: string; status?: string; resultMessage?: string } = {};
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return json({ ok: false, error: "invalid json" }, 400);
        }
        const id = String(body.id || "").trim();
        const agentId = String(body.agentId || (auth.via === "device" ? auth.deviceName : "")).trim();
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
