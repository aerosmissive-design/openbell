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
  targetDevice: z.string().max(20).optional(),
  notifyEmail: z.string().max(254).optional(),
  autoPay: z.boolean().optional(),
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
    let userId = "";
    try {
      const { getRequest } = await import("@tanstack/react-start/server");
      const { auth } = await import("@/lib/auth/server");
      const request = getRequest();
      if (request) {
        const session = await auth.api.getSession({ headers: request.headers });
        userId = String(session?.user?.id || "").trim();
      }
    } catch {
      userId = "";
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
        userId,
        targetDevice: item.targetDevice,
        notifyEmail: item.notifyEmail,
        autoPay: item.autoPay === true,
      });
      if (job) {
        enqueued += 1;
        ids.push(job.id);
      }
    }
    return { ok: true as const, enqueued, ids };
  });

export const relayGasJobs = createServerFn({ method: "POST" })
  .validator(
    z.object({
      url: z.string().max(400),
      key: z.string().max(80),
      items: z.array(JobItem).min(1).max(8),
    }),
  )
  .handler(async ({ data }) => {
    const { postGasJson } = await import("./gas-post");
    let hostOk = false;
    try {
      const host = new URL(data.url).hostname;
      hostOk = host.endsWith("script.google.com") || host.endsWith("googleusercontent.com");
    } catch {
      hostOk = false;
    }
    if (!hostOk || !data.key.trim()) return { ok: false as const, sent: 0 };
    let sent = 0;
    for (const item of data.items) {
      const bookingUrl = String(item.bookingUrl || "").trim();
      if (!bookingUrl) continue;
      const job = {
        id: `web_${Date.now().toString(36)}_${sent}`,
        movieTitle: item.movieTitle,
        theaterId: item.theaterId,
        playDate: item.playDate,
        startTime: item.startTime,
        hallName: item.hallName || "",
        bookingUrl,
        seats: item.seats,
        preferredSeats: item.preferredSeats || [],
        idempotencyKey: [item.theaterId, item.playDate, item.startTime, item.hallName || "", bookingUrl].join("|"),
      };
      try {
        const { text } = await postGasJson(data.url, { op: "job", key: data.key, job });
        const json = JSON.parse(text) as { ok?: boolean };
        if (json.ok) sent += 1;
      } catch {
        /* 이 건만 건너뛴다 */
      }
    }
    return { ok: sent > 0, sent };
  });
