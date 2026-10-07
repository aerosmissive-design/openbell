import { createFileRoute } from "@tanstack/react-router";
import { insertBookingJob, jobDbFailure, listBookingJobs } from "@/lib/cinema/booking-jobs.server";
import { authorizeAgent } from "@/lib/cinema/devices.server";

function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

export const Route = createFileRoute("/api/booking/jobs")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authorizeAgent(request, "seen");
        if (!auth.ok) return json({ ok: false, error: auth.error, reason: auth.reason }, auth.status);
        const body = await request.json().catch(() => ({})) as Record<string, unknown>;
        const seats = 1 + Math.floor(Math.random() * 4);
        const job = await insertBookingJob({
          movieTitle: String(body.movieTitle || ""),
          theaterId: String(body.theaterId || ""),
          playDate: String(body.playDate || ""),
          startTime: String(body.startTime || ""),
          hallName: String(body.hallName || ""),
          bookingUrl: String(body.bookingUrl || ""),
          seats: Number(body.seats || seats),
          userId: auth.via === "device" ? auth.userId : undefined,
        });
        if (!job) return json({ ok: false, error: "job" }, 400);
        return json({ ok: true, job });
      },
      GET: async ({ request }) => {
        const auth = await authorizeAgent(request, "seen");
        if (!auth.ok) return json({ ok: false, error: auth.error, reason: auth.reason }, auth.status);
        try {
          const url = new URL(request.url);
          const jobs = await listBookingJobs(Number(url.searchParams.get("limit") || 20));
          return json({ ok: true, jobs });
        } catch (err) {
          const fail = jobDbFailure(err);
          if (fail.reason === "dbQuota" || fail.reason === "dbConn") {
            const { listEnvGasJobs } = await import("@/lib/cinema/gas-fallback.server");
            const accounts = await listEnvGasJobs();
            if (accounts.length) {
              const jobs = accounts.flatMap((account) =>
                account.jobs.map((job) => ({ ...job, account: account.label })),
              );
              return json({
                ok: true,
                source: "gas",
                reason: fail.reason,
                jobs,
                accounts: accounts.map((account) => ({ label: account.label, count: account.jobs.length })),
              });
            }
          }
          return json(fail, fail.reason === "error" ? 500 : 200);
        }
      },
    },
  },
});
