import { readAppMeta, writeAppMeta } from "./app-meta.server";

export type NasJobStatus =
  | "pending"
  | "running"
  | "done"
  | "failed"
  | "need_user";

export type NasHoldJob = {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: NasJobStatus;
  movieTitle: string;
  theaterId: string;
  playDate: string;
  startTime: string;
  hallName: string;
  bookingUrl: string;
  seats: number;
  zone: string;
  preferredSeats: string[];
  /** 워커가 남긴 설명 (캡차 필요, 선점 성공 등) */
  resultMessage: string;
};

const META_KEY = "nas_hold_jobs_v1";
const MAX_JOBS = 40;
const JOB_TTL_MS = 6 * 60 * 60 * 1000;

function workerToken() {
  return (
    (typeof process !== "undefined" &&
      (process.env.NAS_WORKER_TOKEN || process.env.CRON_SECRET || "").trim()) ||
    ""
  );
}

export function nasJobsConfigured() {
  return Boolean(workerToken());
}

export function authorizeNasWorker(request: Request) {
  const secret = workerToken();
  if (!secret) return false;
  const auth = request.headers.get("authorization") || "";
  if (auth === `Bearer ${secret}`) return true;
  try {
    const url = new URL(request.url);
    if (url.searchParams.get("token") === secret) return true;
  } catch {
    /* ignore */
  }
  return false;
}

async function loadJobs(): Promise<NasHoldJob[]> {
  const raw = await readAppMeta(META_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as NasHoldJob[];
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return parsed.filter((j) => {
      const t = Date.parse(j.createdAt);
      return Number.isFinite(t) && now - t < JOB_TTL_MS;
    });
  } catch {
    return [];
  }
}

async function saveJobs(jobs: NasHoldJob[]) {
  const trimmed = jobs.slice(-MAX_JOBS);
  await writeAppMeta(META_KEY, JSON.stringify(trimmed));
}

function newId() {
  return `nas_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export type EnqueueNasJobInput = {
  movieTitle: string;
  theaterId: string;
  playDate: string;
  startTime: string;
  hallName?: string;
  bookingUrl: string;
  seats?: number;
  zone?: string;
  preferredSeats?: string[];
};

export async function enqueueNasJob(
  input: EnqueueNasJobInput,
): Promise<NasHoldJob | null> {
  if (!nasJobsConfigured()) return null;
  const url = String(input.bookingUrl || "").trim();
  if (!url) return null;
  const now = new Date().toISOString();
  const job: NasHoldJob = {
    id: newId(),
    createdAt: now,
    updatedAt: now,
    status: "pending",
    movieTitle: String(input.movieTitle || "").trim() || "(제목 없음)",
    theaterId: String(input.theaterId || "").trim(),
    playDate: String(input.playDate || "").trim(),
    startTime: String(input.startTime || "").trim(),
    hallName: String(input.hallName || "").trim(),
    bookingUrl: url,
    seats:
      Number.isFinite(Number(input.seats)) && Number(input.seats) >= 1
        ? Math.min(8, Math.round(Number(input.seats)))
        : 2,
    zone: ["center", "rear", "front"].includes(String(input.zone))
      ? String(input.zone)
      : "center",
    preferredSeats: Array.isArray(input.preferredSeats)
      ? input.preferredSeats.map(String).slice(0, 20)
      : [],
    resultMessage: "",
  };
  const jobs = await loadJobs();
  jobs.push(job);
  await saveJobs(jobs);
  return job;
}

export async function listNasJobs(opts?: {
  status?: NasJobStatus;
  limit?: number;
}) {
  let jobs = await loadJobs();
  if (opts?.status) jobs = jobs.filter((j) => j.status === opts.status);
  jobs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const limit = Math.min(Math.max(opts?.limit ?? 20, 1), 50);
  return jobs.slice(0, limit);
}

/** 대기 중 1건을 running 으로 바꿔 가져감 (나스 폴링용) */
export async function claimNextNasJob(): Promise<NasHoldJob | null> {
  const jobs = await loadJobs();
  const idx = jobs.findIndex((j) => j.status === "pending");
  if (idx < 0) return null;
  const now = new Date().toISOString();
  jobs[idx] = {
    ...jobs[idx],
    status: "running",
    updatedAt: now,
    resultMessage: "워커가 가져감",
  };
  await saveJobs(jobs);
  return jobs[idx];
}

export async function completeNasJob(input: {
  id: string;
  status: Exclude<NasJobStatus, "pending" | "running">;
  resultMessage?: string;
}): Promise<NasHoldJob | null> {
  const jobs = await loadJobs();
  const idx = jobs.findIndex((j) => j.id === input.id);
  if (idx < 0) return null;
  const now = new Date().toISOString();
  jobs[idx] = {
    ...jobs[idx],
    status: input.status,
    updatedAt: now,
    resultMessage: String(input.resultMessage || "").slice(0, 500),
  };
  await saveJobs(jobs);
  return jobs[idx];
}
