import { getSql, isTransientDbError } from "@/lib/db";
import { authorizeNasWorker, nasJobsConfigured } from "./nas-jobs.server";
import { isDbQuotaError } from "./app-meta.server";
import { collectRegisteredEmails } from "./registered-emails";

export type BookingJobStatus = "pending" | "running" | "done" | "failed" | "need_user";

export type BookingJob = {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: BookingJobStatus;
  agentId: string;
  prevAgentId: string;
  attempts: number;
  leaseExpiresAt: string | null;
  movieTitle: string;
  theaterId: string;
  playDate: string;
  startTime: string;
  hallName: string;
  bookingUrl: string;
  seats: number;
  zone: string;
  preferredSeats: string[];
  resultMessage: string;
};

type JobRow = {
  id: string;
  created_at: string | Date;
  updated_at: string | Date;
  status: BookingJobStatus;
  agent_id: string | null;
  prev_agent_id: string | null;
  attempts: number | string;
  lease_expires_at: string | Date | null;
  movie_title: string;
  theater_id: string;
  play_date: string;
  start_time: string;
  hall_name: string;
  booking_url: string;
  seats: number | string;
  zone: string;
  preferred_seats: unknown;
  result_message: string;
};

const LEASE = "10 minutes";

function iso(value: string | Date | null) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function seatsOf(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function mapJob(row: JobRow): BookingJob {
  return {
    id: row.id,
    createdAt: iso(row.created_at) || new Date().toISOString(),
    updatedAt: iso(row.updated_at) || new Date().toISOString(),
    status: row.status,
    agentId: row.agent_id || "",
    prevAgentId: row.prev_agent_id || "",
    attempts: Number(row.attempts) || 0,
    leaseExpiresAt: iso(row.lease_expires_at),
    movieTitle: row.movie_title,
    theaterId: row.theater_id,
    playDate: row.play_date,
    startTime: row.start_time,
    hallName: row.hall_name,
    bookingUrl: row.booking_url,
    seats: Number(row.seats) || 2,
    zone: row.zone || "center",
    preferredSeats: seatsOf(row.preferred_seats),
    resultMessage: row.result_message || "",
  };
}

export function bookingJobsAuth(request: Request) {
  return nasJobsConfigured() && authorizeNasWorker(request);
}

export function jobDbFailure(err: unknown): { ok: false; reason: "dbQuota" | "dbConn" | "error"; message: string } {
  if (isDbQuotaError(err)) return { ok: false, reason: "dbQuota", message: "neon quota" };
  if (isTransientDbError(err)) return { ok: false, reason: "dbConn", message: "neon connection" };
  return { ok: false, reason: "error", message: err instanceof Error ? err.message : "db error" };
}

/** 만료된 running 을 pending 으로 되돌린다. 3회면 failed. stale_running 상태는 없다. */
export async function reapExpiredLeases() {
  const sql = await getSql();
  await sql.query(
    `update booking_jobs
     set status = case when attempts + 1 >= 3 then 'failed' else 'pending' end,
         attempts = attempts + 1,
         prev_agent_id = coalesce(agent_id, prev_agent_id),
         agent_id = null,
         lease_expires_at = null,
         result_message = case when attempts + 1 >= 3 then 'lease 3회 초과' else 'lease 만료, 대기 복귀' end,
         updated_at = now()
     where status = 'running'
       and lease_expires_at is not null
       and lease_expires_at < now()`,
  );
}

export async function insertBookingJob(input: {
  id?: string;
  movieTitle: string;
  theaterId: string;
  playDate: string;
  startTime: string;
  hallName?: string;
  bookingUrl: string;
  seats?: number;
  zone?: string;
  preferredSeats?: string[];
  userId?: string;
}): Promise<BookingJob | null> {
  const url = String(input.bookingUrl || "").trim();
  if (!url) return null;
  const sql = await getSql();
  await sql.query(`alter table booking_jobs add column if not exists user_id text`);
  const id = input.id || `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const seats =
    Number.isFinite(Number(input.seats)) && Number(input.seats) >= 1
      ? Math.min(8, Math.round(Number(input.seats)))
      : 2;
  const rows = await sql.query<JobRow>(
    `insert into booking_jobs (
       id, status, movie_title, theater_id, play_date, start_time, hall_name,
       booking_url, seats, zone, preferred_seats, user_id
     ) values (
       $1, 'pending', $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11
     )
     on conflict (id) do nothing
     returning *`,
    [
      id,
      String(input.movieTitle || "").trim() || "(제목 없음)",
      String(input.theaterId || "").trim(),
      String(input.playDate || "").trim(),
      String(input.startTime || "").trim(),
      String(input.hallName || "").trim(),
      url,
      seats,
      ["center", "rear", "front"].includes(String(input.zone)) ? String(input.zone) : "center",
      JSON.stringify((input.preferredSeats || []).map(String).slice(0, 20)),
      input.userId?.trim() || null,
    ],
  );
  return rows[0] ? mapJob(rows[0]) : null;
}

export async function listBookingJobs(limit = 20) {
  await reapExpiredLeases();
  const sql = await getSql();
  const rows = await sql.query<JobRow>(
    `select * from booking_jobs order by created_at desc limit $1`,
    [Math.min(Math.max(limit, 1), 50)],
  );
  return rows.map(mapJob);
}

/** 메일로 고른 계정의 user id. 없거나 깨진 메일은 넣지 않는다. */
export async function userIdsForEmails(emails: string[]): Promise<string[]> {
  const mails = collectRegisteredEmails(emails).slice(0, 20);
  if (mails.length === 0) return [];
  const sql = await getSql();
  const rows = await sql.query<{ id: string }>(
    `select id from "user" where lower(email) = any($1::text[])
     union
     select user_id as id from user_settings
     where lower(coalesce(config->>'email', '')) = any($1::text[])`,
    [mails],
  );
  const ids = new Set<string>();
  for (const row of rows) {
    const id = String(row.id || "").trim();
    if (id) ids.add(id);
  }
  return [...ids];
}

/**
 * pending 1건만 running.
 * userIds가 null이면 제한 없음(레거시 토큰).
 * 아니면 그 계정을 집는다. includeUnscoped가 참이면 user_id 없는 잡도 집는다.
 * 메일 필터는 includeUnscoped를 거짓으로 둔다.
 */
export async function claimBookingJob(
  agentId: string,
  userIds: string[] | null = null,
  includeUnscoped = true,
): Promise<BookingJob | null> {
  await reapExpiredLeases();
  const sql = await getSql();
  await sql.query(`alter table booking_jobs add column if not exists user_id text`);
  const rows = await sql.query<JobRow>(
    `with picked as (
       select id from booking_jobs
       where status = 'pending'
         and (
           $2::boolean
           or ($4::boolean and user_id is null)
           or user_id = any($3::text[])
         )
       order by created_at
       limit 1
       for update skip locked
     )
     update booking_jobs j
     set status = 'running',
         prev_agent_id = j.agent_id,
         agent_id = $1,
         lease_expires_at = now() + interval '${LEASE}',
         updated_at = now()
     from picked
     where j.id = picked.id and j.status = 'pending'
     returning j.*`,
    [agentId.slice(0, 120), userIds == null, userIds ?? [], userIds != null && includeUnscoped],
  );
  return rows[0] ? mapJob(rows[0]) : null;
}

export async function heartbeatBookingJob(id: string, agentId: string): Promise<BookingJob | null> {
  const sql = await getSql();
  const rows = await sql.query<JobRow>(
    `update booking_jobs
     set lease_expires_at = now() + interval '${LEASE}', updated_at = now()
     where id = $1 and status = 'running' and agent_id = $2
     returning *`,
    [id, agentId],
  );
  return rows[0] ? mapJob(rows[0]) : null;
}

export async function completeBookingJob(input: {
  id: string;
  agentId: string;
  status: "done" | "failed" | "need_user";
  resultMessage?: string;
}): Promise<BookingJob | null> {
  const sql = await getSql();
  const rows = await sql.query<JobRow>(
    `update booking_jobs
     set status = $3,
         result_message = $4,
         lease_expires_at = null,
         updated_at = now()
     where id = $1 and status = 'running' and agent_id = $2
     returning *`,
    [input.id, input.agentId, input.status, String(input.resultMessage || "").slice(0, 500)],
  );
  return rows[0] ? mapJob(rows[0]) : null;
}

export async function retryFailedBookingJob(id: string): Promise<BookingJob | null> {
  const sql = await getSql();
  const rows = await sql.query<JobRow>(
    `update booking_jobs
     set status = 'pending',
         attempts = 0,
         agent_id = null,
         lease_expires_at = null,
         result_message = '수동 재시도',
         updated_at = now()
     where id = $1 and status = 'failed'
     returning *`,
    [id],
  );
  return rows[0] ? mapJob(rows[0]) : null;
}
