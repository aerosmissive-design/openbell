#!/usr/bin/env node
/**
 * 오픈벨 나스 도우미 v3
 * - 폴링 + Playwright + 쿠키 유지 + 텔레그램 결제 안내
 */

import { runBookingJob } from "./book.mjs";

const OPENBELL_URL = (process.env.OPENBELL_URL || "").replace(/\/$/, "");
const NAS_WORKER_TOKEN = process.env.NAS_WORKER_TOKEN || "";
const POLL_MS = Math.max(5, Number(process.env.POLL_SECONDS || 15)) * 1000;
const HEADLESS = process.env.HEADLESS !== "0";
const DRY_RUN = process.env.DRY_RUN === "1";
const TG_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
const TG_CHAT = (process.env.TELEGRAM_CHAT_ID || "").trim();

if (!OPENBELL_URL || !NAS_WORKER_TOKEN) {
  console.error("[나스도우미] OPENBELL_URL, NAS_WORKER_TOKEN 필요");
  process.exit(1);
}

const headers = {
  authorization: `Bearer ${NAS_WORKER_TOKEN}`,
  accept: "application/json",
  "content-type": "application/json",
  "user-agent": "openbell-nas-worker/3",
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

async function notifyTelegram(job, status, message, finalUrl) {
  if (!TG_TOKEN || !TG_CHAT) return;
  const payLine =
    status === "done"
      ? "✅ 결제 직전까지 진행됨 — 지금 결제해 주세요 (자동 결제 없음)"
      : status === "need_user"
        ? "⚠️ 직접 확인/로그인이 필요합니다"
        : "❌ 예매 도우미 실패";
  const text = [
    "🔔 [오픈벨 나스]",
    payLine,
    "",
    `🎬 ${job.movieTitle}`,
    `📍 ${job.theaterId} ${job.hallName || ""}`.trim(),
    `⏰ ${job.playDate} ${job.startTime}`,
    message ? `💬 ${message.slice(0, 200)}` : "",
    finalUrl || job.bookingUrl
      ? `🔗 ${finalUrl || job.bookingUrl}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
  try {
    const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: /^-?\d+$/.test(TG_CHAT) ? Number(TG_CHAT) : TG_CHAT,
        text,
        disable_web_page_preview: true,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) console.warn("[tg]", data.description || res.status);
    else console.log("[tg] sent");
  } catch (err) {
    console.warn("[tg]", err instanceof Error ? err.message : err);
  }
}

async function handleJob(job) {
  console.log("----------");
  console.log("[잡]", job.id, job.movieTitle, job.playDate, job.startTime);
  console.log("  URL:", job.bookingUrl);

  if (DRY_RUN) {
    await report(job, "need_user", "DRY_RUN=1");
    await notifyTelegram(job, "need_user", "DRY_RUN", job.bookingUrl);
    return;
  }

  const result = await runBookingJob(job, { headless: HEADLESS });
  const msg = [result.message, result.url ? `최종URL=${result.url}` : ""]
    .filter(Boolean)
    .join(" | ")
    .slice(0, 500);
  await report(job, result.status, msg);
  await notifyTelegram(job, result.status, result.message, result.url);
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

console.log("[나스도우미] v3 시작");
console.log("  서버:", OPENBELL_URL);
console.log("  폴링:", POLL_MS / 1000, "초");
console.log("  headless:", HEADLESS, "dryRun:", DRY_RUN);
console.log("  텔레그램:", TG_TOKEN && TG_CHAT ? "on" : "off");
console.log("  결제 확정 클릭: 차단(고정)");

await tick();
setInterval(tick, POLL_MS);
