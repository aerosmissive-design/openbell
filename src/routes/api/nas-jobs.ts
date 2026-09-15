import { createFileRoute } from "@tanstack/react-router";
import {
  authorizeNasWorker,
  claimNextNasJob,
  completeNasJob,
  enqueueNasJob,
  listNasJobs,
  nasJobsConfigured,
} from "@/lib/cinema/nas-jobs.server";

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, PATCH, OPTIONS",
      "access-control-allow-headers": "authorization, content-type",
    },
  });
}

async function handleGet(request: Request) {
  if (!nasJobsConfigured()) {
    return json(
      {
        ok: false,
        error:
          "NAS_WORKER_TOKEN(또는 CRON_SECRET)을 베셀 환경변수에 넣어 주세요",
      },
      503,
    );
  }
  if (!authorizeNasWorker(request)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  const url = new URL(request.url);
  const claim = url.searchParams.get("claim") === "1";
  if (claim) {
    const job = await claimNextNasJob();
    return json({ ok: true, job });
  }
  const status = url.searchParams.get("status") || undefined;
  const jobs = await listNasJobs({
    status: status as "pending" | undefined,
    limit: Number(url.searchParams.get("limit") || 20),
  });
  return json({ ok: true, jobs });
}

async function handlePost(request: Request) {
  if (!nasJobsConfigured()) {
    return json({ ok: false, error: "worker token not configured" }, 503);
  }
  if (!authorizeNasWorker(request)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "invalid json" }, 400);
  }
  const job = await enqueueNasJob({
    movieTitle: String(body.movieTitle || ""),
    theaterId: String(body.theaterId || ""),
    playDate: String(body.playDate || ""),
    startTime: String(body.startTime || ""),
    hallName: String(body.hallName || ""),
    bookingUrl: String(body.bookingUrl || ""),
    seats: body.seats != null ? Number(body.seats) : undefined,
    zone: body.zone != null ? String(body.zone) : undefined,
    preferredSeats: Array.isArray(body.preferredSeats)
      ? body.preferredSeats.map(String)
      : undefined,
  });
  if (!job) return json({ ok: false, error: "enqueue failed (bookingUrl?)" }, 400);
  return json({ ok: true, job });
}

async function handlePatch(request: Request) {
  if (!nasJobsConfigured()) {
    return json({ ok: false, error: "worker token not configured" }, 503);
  }
  if (!authorizeNasWorker(request)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "invalid json" }, 400);
  }
  const id = String(body.id || "");
  const status = String(body.status || "");
  if (!id || !["done", "failed", "need_user"].includes(status)) {
    return json(
      { ok: false, error: "id + status(done|failed|need_user) 필요" },
      400,
    );
  }
  const job = await completeNasJob({
    id,
    status: status as "done" | "failed" | "need_user",
    resultMessage: body.resultMessage != null ? String(body.resultMessage) : "",
  });
  if (!job) return json({ ok: false, error: "job not found" }, 404);
  return json({ ok: true, job });
}

export const Route = createFileRoute("/api/nas-jobs")({
  server: {
    handlers: {
      OPTIONS: () => json({ ok: true }),
      GET: ({ request }) => handleGet(request),
      POST: ({ request }) => handlePost(request),
      PATCH: ({ request }) => handlePatch(request),
    },
  },
});
