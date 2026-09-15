#!/usr/bin/env node
/**
 * 오픈벨 나스 도우미 v2
 * - 베셀 /api/nas-jobs 폴링
 * - Playwright 예매 시도 (결제 확정 클릭 없음)
 * - 캡차/로그인 → need_user
 */

import { runBookingJob } from "./book.mjs";

const OPENBELL_URL = (process.env.OPENBELL_URL || "").replace(/\/$/, "");
const NAS_WORKER_TOKEN = process.env.NAS_WORKER_TOKEN || "";
const POLL_MS = Math.max(5, Number(process.env.POLL_SECONDS || 15)) * 1000;
const HEADLESS = process.env.HEADLESS !== "0";
const DRY_RUN = process.env.DRY_RUN === "1";

if (!OPENBELL_URL || !NAS_WORKER_TOKEN) {
  console.error("[나스도우미] OPENBELL_URL, NAS_WORKER_TOKEN 필요");
  process.exit(1);
}

const headers = {
  authorization: `Bearer ${NAS_WORKER_TOKEN}`,
  accept: "application/json",
  "content-type": "application/json",
  "user-agent": "openbell-nas-worker/2",
};

async function claimJob() {
  const res = await fetch(`${OPENBELL_URL}/api/nas-jobs?claim=1`, { headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `claim HTTP ${res.status}`);
  return data.job || null;
}

async function report(job, status, resultMessage) {
  const res = await fetch(`${OPENBELL_URL}/api/nas-jobs`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ id: job.id, status, resultMessage }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `report HTTP ${res.status}`);
  return data.job;
}

async function handleJob(job) {
  console.log("----------");
  console.log("[잡]", job.id, job.movieTitle, job.playDate, job.startTime);
  console.log("  URL:", job.bookingUrl);

  if (DRY_RUN) {
    await report(job, "need_user", "DRY_RUN=1 — 브라우저 안 띄움");
    console.log("[DRY_RUN] 보고만 함");
    return;
  }

  const result = await runBookingJob(job, { headless: HEADLESS });
  const msg = [result.message, result.url ? `최종URL=${result.url}` : ""]
    .filter(Boolean)
    .join(" | ")
    .slice(0, 500);
  await report(job, result.status, msg);
  console.log("[결과]", result.status, msg);
}

async function tick() {
  try {
    const job = await claimJob();
    if (!job) {
      process.stdout.write(".");
      return;
    }
    console.log("");
    await handleJob(job);
  } catch (err) {
    console.error("\n[오류]", err instanceof Error ? err.message : err);
  }
}

console.log("[나스도우미] v2 시작");
console.log("  서버:", OPENBELL_URL);
console.log("  폴링:", POLL_MS / 1000, "초");
console.log("  headless:", HEADLESS, "dryRun:", DRY_RUN);
console.log("  결제 확정 클릭: 차단(고정)");

await tick();
setInterval(tick, POLL_MS);
