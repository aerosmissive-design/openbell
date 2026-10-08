import { createFileRoute } from "@tanstack/react-router";
import { bookingJobsAuth } from "@/lib/cinema/booking-jobs.server";
import { nasJobsConfigured } from "@/lib/cinema/nas-jobs.server";
import { gasWebUrlForEmail, latestGasWebUrl } from "@/lib/cinema/gas-bind.server";

export const Route = createFileRoute("/api/booking/gas-url")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!nasJobsConfigured()) return Response.json({ ok: false, reason: "no_token" }, { status: 503 });
        if (!bookingJobsAuth(request)) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
        const email = new URL(request.url).searchParams.get("email") || "";
        const url = email.trim() ? await gasWebUrlForEmail(email) : await latestGasWebUrl();
        return Response.json({ ok: true, gasWebUrl: url });
      },
    },
  },
});
