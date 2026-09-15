import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const JobItem = z.object({
  movieTitle: z.string(),
  theaterId: z.string(),
  playDate: z.string(),
  startTime: z.string(),
  hallName: z.string().optional(),
  bookingUrl: z.string(),
  seats: z.number().optional(),
  zone: z.string().optional(),
  preferredSeats: z.array(z.string()).optional(),
});

/**
 * 클라이언트(알림) → 서버가 NAS_WORKER_TOKEN 으로 큐에 넣음.
 * 브라우저에 워커 토큰을 넣지 않아도 됨.
 */
export const enqueueNasFromAlert = createServerFn({ method: "POST" })
  .validator(
    z.object({
      items: z.array(JobItem).min(1).max(12),
    }),
  )
  .handler(async ({ data }) => {
    const { enqueueNasJob, nasJobsConfigured } = await import(
      "./nas-jobs.server"
    );
    if (!nasJobsConfigured()) {
      return {
        ok: false as const,
        reason: "no_token" as const,
        enqueued: 0,
      };
    }
    let enqueued = 0;
    const ids: string[] = [];
    for (const item of data.items) {
      if (!String(item.bookingUrl || "").trim()) continue;
      const job = await enqueueNasJob({
        movieTitle: item.movieTitle,
        theaterId: item.theaterId,
        playDate: item.playDate,
        startTime: item.startTime,
        hallName: item.hallName,
        bookingUrl: item.bookingUrl,
        seats: item.seats,
        zone: item.zone,
        preferredSeats: item.preferredSeats,
      });
      if (job) {
        enqueued += 1;
        ids.push(job.id);
      }
    }
    return { ok: true as const, enqueued, ids };
  });
