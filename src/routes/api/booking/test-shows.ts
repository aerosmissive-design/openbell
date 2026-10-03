import { createFileRoute } from "@tanstack/react-router";
import { bookingJobsAuth } from "@/lib/cinema/booking-jobs.server";
import { nasJobsConfigured } from "@/lib/cinema/nas-jobs.server";
import { loadBoardDataImpl } from "@/lib/cinema/board-data.server";

export const Route = createFileRoute("/api/booking/test-shows")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!nasJobsConfigured()) return Response.json({ ok: false, reason: "no_token" }, { status: 503 });
        if (!bookingJobsAuth(request)) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
        const board = await loadBoardDataImpl({});
        const pick = (prefix: string) => {
          for (const block of board.theaters) {
            if (!block.theaterId.startsWith(prefix)) continue;
            const show = block.showtimes.find((s) => s.bookingUrl);
            if (show) return { theaterId: block.theaterId, theaterName: block.theaterName, ...show };
          }
          return null;
        };
        return Response.json({ ok: true, cgv: pick("cgv"), megabox: pick("megabox") });
      },
    },
  },
});
