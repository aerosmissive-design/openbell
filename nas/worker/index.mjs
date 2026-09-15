#!/usr/bin/env node
/**
 * 오픈벨 나스 도우미 (1단계 스텁)
 *
 * - 베셀 /api/nas-jobs 를 주기적으로 물어봄
 * - pending 작업을 가져옴
 * - 지금은 로그 + 결과만 보고 (좌석 클릭은 다음 단계)
 * - 결제 버튼은 절대 누르지 않음
 */

const OPENBELL_URL = (process.env.OPENBELL_URL || "").replace(/\/$/, "");
const NAS_WORKER_TOKEN = process.env.NAS_WORKER_TOKEN || "";
const POLL_MS = Math.max(5, Number(process.env.POLL_SECONDS || 15)) * 1000;

if (!OPENBELL_URL || !NAS_WORKER_TOKEN) {
  console.error(
    "[나스도우미] OPENBELL_URL 과 NAS_WORKER_TOKEN 환경변수가 필요합니다.",
  );
  console.error("  예: OPENBELL_URL=https://openbell-fawn.vercel.app");
  console.error("      NAS_WORKER_TOKEN=베셀에_넣은_같은_토큰");
  process.exit(1);
}

const headers = {
  authorization: `Bearer ${NAS_WORKER_TOKEN}`,
  accept: "application/json",
  "content-type": "application/json",
  "user-agent": "openbell-nas-worker/1",
};

async function claimJob() {
  const res = await fetch(`${OPENBELL_URL}/api/nas-jobs?claim=1`, {
    headers,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `claim HTTP ${res.status}`);
  }
  return data.job || null;
}

async function report(job, status, resultMessage) {
  const res = await fetch(`${OPENBELL_URL}/api/nas-jobs`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ id: job.id, status, resultMessage }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `report HTTP ${res.status}`);
  }
  return data.job;
}

/**
 * 2단계에서 Playwright 로 좌석 클릭.
 * 지금은 정보만 출력하고 need_user 로 넘김 (결제 절대 안 함).
 */
async function handleJob(job) {
  console.log("----------");
  console.log("[잡 수신]", job.id);
  console.log("  영화:", job.movieTitle);
  console.log("  극장:", job.theaterId);
  console.log("  일시:", job.playDate, job.startTime);
  console.log("  관:", job.hallName || "-");
  console.log("  인원:", job.seats, "구역:", job.zone);
  console.log("  URL:", job.bookingUrl);
  console.log("  선호좌석:", (job.preferredSeats || []).join(", ") || "(없음)");

  // TODO(2단계): Playwright 로 bookingUrl 열고 좌석 선택 → 결제 페이지에서 STOP
  // 캡차 뜨면 status: need_user
  // 결제 버튼 셀렉터는 의도적으로 구현하지 않음

  await report(
    job,
    "need_user",
    "스텁: 예매 URL만 확인함. 좌석 자동 클릭은 아직 없음. 직접 결제하세요.",
  );
  console.log("[완료] need_user 로 보고함 (직접 결제)");
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

console.log("[나스도우미] 시작");
console.log("  서버:", OPENBELL_URL);
console.log("  폴링:", POLL_MS / 1000, "초");
console.log("  결제 자동 클릭: 없음 (고정)");

await tick();
setInterval(tick, POLL_MS);
