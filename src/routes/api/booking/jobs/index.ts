import { createFileRoute } from "@tanstack/react-router";
import { bookingJobsAuth, insertBookingJob, jobDbFailure, listBookingJobs } from "@/lib/cinema/booking-jobs.server";
import { nasJobsConfigured } from "@/lib/cinema/nas-jobs.server";

function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

export const Route = createFileRoute("/api/booking/jobs")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!nasJobsConfigured()) return json({ ok: false, reason: "no_token" }, 503);
        if (!bookingJobsAuth(request)) return json({ ok: false, error: "unauthorized" }, 401);
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
        });
        if (!job) return json({ ok: false, error: "job" }, 400);
        return json({ ok: true, job });
      },
      GET: async ({ request }) => {
        if (!nasJobsConfigured()) return json({ ok: false, reason: "no_token" }, 503);
        if (!bookingJobsAuth(request)) return json({ ok: false, error: "unauthorized" }, 401);
        try {
          const url = new URL(request.url);
          const jobs = await listBookingJobs(Number(url.searchParams.get("limit") || 20));
          return json({ ok: true, jobs });
        } catch (err) {
          const fail = jobDbFailure(err);
          return json(fail, fail.reason === "error" ? 500 : 200);
        }
      },
    },
  },
});
