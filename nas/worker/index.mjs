#!/usr/bin/env node
/**
 * 오픈벨 도우미 v4
 * - 폴링 + Playwright + 쿠키 + 결제 직전 N분 창 유지 + 텔레그램
 * - 리눅스(나스 Docker) / Windows PC 동일 코드 (Chromium)
 */

import { runBookingJob } from "./book.mjs";

const OPENBELL_URL = (process.env.OPENBELL_URL || "").replace(/\/$/, "");
const NAS_WORKER_TOKEN = process.env.NAS_WORKER_TOKEN || "";
const POLL_MS = Math.max(5, Number(process.env.POLL_SECONDS || 15)) * 1000;
const HEADLESS = process.env.HEADLESS !== "0";
const DRY_RUN = process.env.DRY_RUN === "1";
const HOLD_MINUTES = Math.min(
  20,
  Math.max(1, Number(process.env.HOLD_MINUTES) || 10),
);
const TG_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
const TG_CHAT = (process.env.TELEGRAM_CHAT_ID || "").trim();

if (!OPENBELL_URL || !NAS_WORKER_TOKEN) {
  console.error("[도우미] OPENBELL_URL, NAS_WORKER_TOKEN 필요");
  process.exit(1);
}

const headers = {
  authorization: `Bearer ${NAS_WORKER_TOKEN}`,
  accept: "application/json",
  "content-type": "application/json",
  "user-agent": "openbell-nas-worker/4",
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

async function tg(text) {
  if (!TG_TOKEN || !TG_CHAT) return;
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

async function notifyTelegram(job, status, message, finalUrl) {
  const payLine =
    status === "done"
      ? "✅ 처리 완료 (자동 결제 없음)"
      : status === "need_user"
        ? "⚠️ 직접 확인 필요"
        : "❌ 실패";
  await tg(
    [
      "🔔 [오픈벨 도우미]",
      payLine,
      "",
      `🎬 ${job.movieTitle}`,
      `📍 ${job.theaterId} ${job.hallName || ""}`.trim(),
      `⏰ ${job.playDate} ${job.startTime}`,
      message ? `💬 ${String(message).slice(0, 220)}` : "",
      finalUrl || job.bookingUrl ? `🔗 ${finalUrl || job.bookingUrl}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
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

  const result = await runBookingJob(job, {
    headless: HEADLESS,
    holdMinutes: HOLD_MINUTES,
    onHold: async (info) => {
      const where = info.headless
        ? `나스/헤드리스: 화면이 안 보일 수 있습니다.\n같은 극장 계정으로 폰·PC 앱에서 결제해 보세요.\n(선점이 ${info.minutes}분 정도 유지되길 기대하지만 사이트마다 다름)`
        : `PC 창이 열려 있습니다 → 그 창에서 결제하세요.\n「결제하기」는 자동으로 누르지 않습니다.`;
      await tg(
        [
          "🚨 [오픈벨] 지금 결제하세요!",
          "",
          `🎬 ${job.movieTitle}`,
          `💺 좌석: ${(info.seats || []).join(", ") || "-"}`,
          `⏱️ 브라우저 유지: ${info.minutes}분`,
          "",
          where,
          info.url ? `🔗 ${info.url}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      );
      // 큐에도 진행 중 표시
      await report(
        job,
        "done",
        `결제대기 ${info.minutes}분 시작 seats=${(info.seats || []).join(",")}`,
      ).catch(() => null);
    },
  });

  const msg = [result.message, result.url ? `최종URL=${result.url}` : ""]
    .filter(Boolean)
    .join(" | ")
    .slice(0, 500);
  await report(job, result.status, msg);
  if (!result.held) {
    await notifyTelegram(job, result.status, result.message, result.url);
  }
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

console.log("[오픈벨 도우미] v4 시작");
console.log("  서버:", OPENBELL_URL);
console.log("  폴링:", POLL_MS / 1000, "초");
console.log("  headless:", HEADLESS, "hold분:", HOLD_MINUTES);
console.log("  텔레그램:", TG_TOKEN && TG_CHAT ? "on" : "off");
console.log("  결제 확정 클릭: 차단 | 리눅스·윈도우 동일(Chromium)");

await tick();
setInterval(tick, POLL_MS);
