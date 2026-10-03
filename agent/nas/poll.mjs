/**
 * Claims one OpenBell job at a time and runs the existing CGV agent.
 * Does not type passwords, bypass CAPTCHA, or click final payment.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire("/opt/openbell/pc/package.json");
const pcRoot = "/opt/openbell/pc";
const base = String(process.env.OPENBELL_URL || "").trim().replace(/\/$/, "");
const token = String(process.env.NAS_WORKER_TOKEN || process.env.NAS_REPORT_TOKEN || "").trim();
const pollMs = Math.max(3000, Number(process.env.POLL_MS || 5000) || 5000);
const workerName = String(process.env.WORKER_NAME || "nas").trim();
const enabled = /^(1|true|yes|on)$/i.test(String(process.env.AGENT_ENABLED || "0").trim());
let gasExec = String(process.env.GAS_WEB_URL || "").trim();
const seenJobKeys = new Set();

function jobKey(job) {
  if (!job) return "";
  return job.idempotencyKey || [job.theaterId, job.playDate, job.startTime, job.hallName, job.bookingUrl].join("|");
}

async function claimGasJob() {
  if (!gasExec) return null;
  const target = new URL(gasExec);
  target.searchParams.set("op", "job");
  target.searchParams.set("claim", "1");
  const res = await fetch(target, { signal: AbortSignal.timeout(3000) });
  const data = await res.json();
  return data && data.job ? data.job : null;
}

async function ackGasJob(key) {
  if (!gasExec || !key) return;
  const target = new URL(gasExec);
  target.searchParams.set("op", "job");
  target.searchParams.set("action", "ack");
  target.searchParams.set("key", key);
  await fetch(target, { signal: AbortSignal.timeout(3000) }).catch(() => {});
}
const mode = String(process.env.AGENT_MODE || "poll").trim().toLowerCase();

function enabledFlag(name, fallback) {
  const value = process.env[name];
  if (value == null || value === "") return fallback;
  return /^(1|true|yes|on)$/i.test(value.trim());
}

function isoDate(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length >= 8) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  return String(value || "").trim();
}

function hhmm(value) {
  const text = String(value || "").trim();
  const matched = text.match(/^(\d{1,2}):(\d{2})/);
  if (matched) return `${matched[1].padStart(2, "0")}:${matched[2]}`;
  const digits = text.replace(/\D/g, "");
  if (digits.length === 4) return `${digits.slice(0, 2)}:${digits.slice(2)}`;
  return text;
}

function preferredRow(list) {
  for (const id of list || []) {
    const matched = String(id).match(/([A-Za-z])/);
    if (matched) return matched[1].toUpperCase();
  }
  return "H";
}

function isCgv(job) {
  const id = String(job.theaterId || "");
  const url = String(job.bookingUrl || "");
  if (id.startsWith("megabox") || /megabox/i.test(url)) return false;
  return id.startsWith("cgv") || /cgv\.co\.kr/i.test(url);
}

async function api(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}

async function finish(id, status, resultMessage) {
  await api("/api/nas-jobs", {
    method: "PATCH",
    body: JSON.stringify({ id, status, resultMessage: String(resultMessage || "").slice(0, 500) }),
  });
}

async function saveLogin() {
  const { chromium } = require("playwright");
  const outPath = process.env.CGV_STORAGE_STATE || "/storage/cgv-storage.json";
  console.log(`LOGIN_WAIT save to ${outPath}. Type nothing. No payment click.`);
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ locale: "ko-KR", timezoneId: "Asia/Seoul" });
  const page = await context.newPage();
  console.log("noVNC http://<nas-ip>:6080/vnc.html");
  console.log("Log in yourself in that window. Password is not typed. Payment is not clicked.");
  await page.goto("https://cgv.co.kr/mem/login?returnUrl=%2Fcnm%2FselectVisitorCnt&nmbrAtktFlag=Y", { waitUntil: "domcontentloaded" });
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    const body = await page.locator("body").innerText().catch(() => "");
    const text = body.replace(/\s+/g, " ");
    const loggedIn = /\ub85c\uadf8\uc544\uc6c3/.test(text) || /MY\s*CGV/i.test(text) || /\ub9c8\uc774\s*CGV/.test(text);
    const loginForm = /\ube44\ubc00\ubc88\ud638/.test(text) && /\uc544\uc774\ub514|\uc774\uba54\uc77c|\ud734\ub300\uc804\ud654/.test(text);
    if (loggedIn && !loginForm) {
      await context.storageState({ path: outPath });
      await browser.close();
      console.log("LOGIN_SAVED");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  await browser.close();
  throw new Error("LOGIN_NOT_COMPLETED");
}

function runJob(job) {
  const row = preferredRow(job.preferredSeats);
  const env = {
    ...process.env,
    BOOKING_MOVIE: String(job.movieTitle || "").trim(),
    BOOKING_DATE: isoDate(job.playDate),
    BOOKING_SHOWTIME: hhmm(job.startTime),
    BOOKING_SEAT_COUNT: String(job.seats || 2),
    BOOKING_URL: String(job.bookingUrl || "").trim(),
    BOOKING_THEATER_ID: String(job.theaterId || "").trim(),
    BOOKING_HALL: String(job.hallName || "").trim() || "20\uad00",
    BOOKING_SEAT_IDS: "",
    SEAT_PREFERRED_ROW: row,
    SEAT_PREFERRED_ROW_DISTANCE: process.env.SEAT_PREFERRED_ROW_DISTANCE || "3",
    PLAYWRIGHT_HEADLESS: "false",
    PAYMENT_HOLD_BROWSER: "true",
    OPENBELL_URL: base,
    NAS_WORKER_TOKEN: token,
  };
  return new Promise((resolve) => {
    let output = "";
    const child = spawn("npx", ["tsx", "src/cli.ts"], { cwd: pcRoot, env, stdio: ["ignore", "pipe", "pipe"] });
    const take = (chunk) => {
      const text = String(chunk);
      output = (output + text).slice(-8000);
      process.stdout.write(text);
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    child.on("close", (code) => resolve({ code: code ?? 1, output }));
  });
}

async function loadGasUrl() {
  if (gasExec) return;
  try {
    const data = await api("/api/booking/gas-url");
    if (data.gasWebUrl) {
      gasExec = String(data.gasWebUrl).trim();
      console.log("[gas] loaded from vessel");
    } else {
      console.warn("[gas] vessel has no saved GAS URL");
    }
  } catch (error) {
    console.warn(`[gas] load failed ${error instanceof Error ? error.message : error}`);
  }
}

async function main() {
  if (!base || !token) throw new Error("OPENBELL_URL and NAS_WORKER_TOKEN are required");
  console.log(`[${workerName}] mode=poll claim=${enabled} headless=${enabledFlag("PLAYWRIGHT_HEADLESS", false)}`);
  console.log("noVNC http://<nas-ip>:6080/vnc.html");
  await loadGasUrl();
  if (mode === "login") {
    await saveLogin();
  }
  if (!enabled) {
    console.log(`[${workerName}] AGENT_ENABLED=0. Reporter may run. This container will not claim jobs.`);
    setInterval(() => {}, 1 << 30);
    return;
  }
  for (;;) {
    let job = null;
    let claimFailed = false;
    try {
      const data = await Promise.race([
        api("/api/nas-jobs?claim=1"),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 3000)),
      ]);
      job = data.job || null;
    } catch (error) {
      claimFailed = true;
      console.warn(`[claim] ${error instanceof Error ? error.message : error}`);
    }
    if (!job && claimFailed) {
      try {
        job = await claimGasJob();
        if (job) job.fromGas = true;
      } catch (error) {
        console.warn(`[claim-gas] ${error instanceof Error ? error.message : error}`);
      }
    }
    const key = jobKey(job);
    if (job && key && seenJobKeys.has(key)) job = null;
    if (!job) {
      await new Promise((resolve) => setTimeout(resolve, pollMs));
      continue;
    }
    console.log(`[job] ${job.id} ${job.movieTitle} ${job.playDate} ${job.startTime}`);
    if (!isCgv(job)) {
      await finish(job.id, "failed", "NAS agent is CGV-only");
      continue;
    }
    const result = await runJob(job);
    if (/LOGIN_REQUIRED|login/i.test(result.output) && !result.output.includes("PAYMENT_READY")) {
      console.log("CGV session missing. Open noVNC http://<nas-ip>:6080/vnc.html and log in. No restart.");
      await saveLogin();
      continue;
    }
    if (job.fromGas && key) {
      seenJobKeys.add(key);
      await ackGasJob(key);
    }
    const ready = result.output.includes("PAYMENT_READY");
    if (ready) {
      await finish(job.id, "need_user", `PAYMENT_READY hard stop. Pay in noVNC. worker=${workerName}`);
    } else {
      await finish(job.id, "failed", result.output.split("\n").filter(Boolean).slice(-3).join(" ").slice(0, 400));
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
