import { hostname } from "node:os";
import { readFileSync, appendFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { isExactCgvBookingUrl, type BookingState } from "./cgv-agent.js";
import { clearDevice, ensurePaired } from "./device.js";
import { PC_ROOT } from "./env.js";
import { createSession, notifyPaymentReady, updateState } from "./openbell-api.js";
import { runBooking, runMegabox } from "./run.js";

type Job = {
  id: string;
  movieTitle: string;
  theaterId: string;
  playDate: string;
  startTime: string;
  hallName: string;
  bookingUrl: string;
  seats: number;
  preferredSeats: string[];
  idempotencyKey?: string;
  source?: "vessel" | "gas";
};

const AGENT_VERSION = "2.0.22";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`MISSING_ENV:${name}`);
  return value;
}

async function api(path: string, body: unknown) {
  const base = required("OPENBELL_URL").replace(/\/$/, "");
  const token = process.env.NAS_WORKER_TOKEN?.trim() || process.env.NAS_REPORT_TOKEN?.trim() || "";
  const deviceKey = process.env.OPENBELL_DEVICE_KEY?.trim() || "";
  if (!token && !deviceKey) throw new Error("MISSING_ENV:NAS_WORKER_TOKEN");
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  if (deviceKey) headers["x-openbell-device-key"] = deviceKey;
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: { ok?: boolean; reason?: string; job?: Job | null; error?: string } = {};
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    json = { ok: false, error: text.slice(0, 200) };
  }
  if (json.error === "DEVICE_REVOKED") {
    clearDevice();
    const err = new Error("DEVICE_REVOKED");
    err.name = "DEVICE_REVOKED";
    throw err;
  }
  if (json.reason === "dbQuota" || json.reason === "dbConn") {
    const err = new Error(json.reason);
    err.name = json.reason;
    throw err;
  }
  if (!res.ok || json.ok === false) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}


function jobKey(job: Job) {
  return job.idempotencyKey || [job.theaterId, job.playDate, job.startTime, job.hallName, job.bookingUrl].join("|");
}
function seenPath() { return resolve(PC_ROOT, "logs", "gas-seen.txt"); }
function alreadySeen(key: string) {
  try { return readFileSync(seenPath(), "utf8").split(/\r?\n/).includes(key); } catch { return false; }
}
function remember(key: string) {
  mkdirSync(resolve(PC_ROOT, "logs"), { recursive: true });
  appendFileSync(seenPath(), key + "\n");
}
async function claimGas(): Promise<Job | null> {
  const url = process.env.GAS_WEB_URL?.trim();
  if (!url) return null;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "claim", claim: "1", deviceKey: process.env.OPENBELL_DEVICE_KEY || "" }),
  });
  const text = await res.text();
  let json: { ok?: boolean; job?: Job | null } = {};
  try { json = JSON.parse(text) as typeof json; } catch { return null; }
  const job = json.job;
  if (!job) return null;
  const key = jobKey(job);
  if (alreadySeen(key)) {
    await ackGas(key);
    return null;
  }
  job.source = "gas";
  job.idempotencyKey = key;
  return job;
}
async function ackGas(key: string) {
  const url = process.env.GAS_WEB_URL?.trim();
  if (!url || !key) return;
  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "ack", idempotencyKey: key, key }),
  }).catch(() => undefined);
}
function vesselDown(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return /fetch|network|ECONN|ENOTFOUND|ETIMEDOUT|HTTP 5/.test(msg);
}

async function loadGasFromVessel() {
  if (process.env.GAS_WEB_URL?.trim()) return;
  const base = process.env.OPENBELL_URL?.trim()?.replace(/\/$/, "");
  const token = process.env.NAS_WORKER_TOKEN?.trim() || process.env.NAS_REPORT_TOKEN?.trim();
  if (!base || !token) return;
  const res = await fetch(`${base}/api/booking/gas-url`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) return;
  const json = await res.json() as { gasWebUrl?: string };
  const url = json.gasWebUrl?.trim();
  if (!url) return;
  process.env.GAS_WEB_URL = url;
  console.log("[poll] GAS_WEB_URL loaded from vessel");
}

export async function runJobPoll() {
  let build = "dev";
  try {
    const pkg = JSON.parse(readFileSync(resolve(PC_ROOT, "package.json"), "utf8")) as { version?: string };
    build = pkg.version || build;
  } catch {
    /* keep dev */
  }
  const agentId = process.env.AGENT_ID?.trim() || `${hostname()}-pc`;
  const base = required("OPENBELL_URL").replace(/\/$/, "");
  await ensurePaired(base, AGENT_VERSION);
  await loadGasFromVessel().catch((err) => console.warn(`[poll] gas url ${err instanceof Error ? err.message : err}`));
  console.log(`[agent] APP_VERSION=${build} BUILD_HASH=${process.env.BUILD_HASH || "dev"} AGENT_VERSION=${AGENT_VERSION} mode=poll id=${agentId}`);
  let backoff = 15_000;
  let lastBeat = 0;
  for (;;) {
    try {
      if (Date.now() - lastBeat > 60_000) {
        lastBeat = Date.now();
        await api("/api/device/heartbeat", { agentVersion: AGENT_VERSION }).catch((err) => {
          if (err instanceof Error && err.name === "DEVICE_REVOKED") throw err;
        });
        const gasUrl = process.env.GAS_WEB_URL?.trim();
        if (gasUrl && process.env.OPENBELL_DEVICE_KEY) {
          await fetch(gasUrl, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "deviceHeartbeat", deviceKey: process.env.OPENBELL_DEVICE_KEY }),
          }).catch(() => undefined);
        }
      }
      const claimed = await api("/api/booking/jobs/claim", { agentId });
      backoff = 15_000;
      const job = claimed.job;
      if (!job) {
        await new Promise((r) => setTimeout(r, 15_000));
        continue;
      }
      job.source = "vessel";
      console.log(`[poll] vessel ${job.id} ${job.movieTitle || ""} ${job.playDate || ""} ${job.startTime || ""}`);
      await runOne(agentId, job);
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      if (name === "dbQuota" || name === "dbConn") {
        console.warn(`[poll] ${name} backoff ${backoff}ms`);
        await new Promise((r) => setTimeout(r, backoff));
        backoff = Math.min(backoff * 2, 120_000);
        continue;
      }
      if (name === "DEVICE_REVOKED") {
        console.warn("[poll] device revoked. pairing again");
        await ensurePaired(base, AGENT_VERSION);
        continue;
      }
      if (vesselDown(err)) {
        console.warn(`[poll] vessel down, GAS fallback: ${err instanceof Error ? err.message : err}`);
        const job = await claimGas().catch(() => null);
        if (job) {
          console.log(`[poll] gas ${job.idempotencyKey}`);
          await runOne(agentId, job);
          continue;
        }
      } else {
        console.error(err instanceof Error ? err.message : err);
      }
      await new Promise((r) => setTimeout(r, 15_000));
    }
  }
}

async function runOne(agentId: string, job: Job) {
  const beat = setInterval(() => {
    void api("/api/booking/jobs/heartbeat", { id: job.id, agentId }).catch((err) => {
      console.warn(`[poll] heartbeat ${err instanceof Error ? err.message : err}`);
    });
  }, 3 * 60 * 1000);
  const openbellUrl = required("OPENBELL_URL").replace(/\/$/, "");
  const workerToken = process.env.NAS_WORKER_TOKEN?.trim() || process.env.NAS_REPORT_TOKEN?.trim() || "";
  let status: "done" | "failed" | "need_user" = "failed";
  let message = "";
  try {
    const sessionId = await createSession({
      openbellUrl,
      workerToken,
      theaterId: job.theaterId || "cgv_yongsan",
      movieTitle: job.movieTitle,
      playDate: job.playDate,
      showtime: job.startTime,
      hall: job.hallName || "",
      requestedSeatCount: job.seats || 2,
      bookingUrl: job.bookingUrl,
    });
    const onState = async (state: BookingState) => {
      await updateState({ openbellUrl, workerToken, sessionId, state });
    };
    if (/megabox/i.test(job.theaterId || "") || /megabox/i.test(job.bookingUrl || "")) {
      await runMegabox({
        movieTitle: job.movieTitle,
        playDate: job.playDate,
        showtime: job.startTime,
        bookingUrl: job.bookingUrl,
        onPaymentReady: async ({ url, seats }) => {
          status = "need_user";
          message = "PAYMENT_READY hard stop";
          await notifyPaymentReady({ openbellUrl, workerToken, sessionId, url: "", seats });
        },
      });
      if (status !== "need_user") status = "done";
    } else {
    await runBooking({
      movieTitle: job.movieTitle,
      playDate: job.playDate,
      showtime: job.startTime,
      requestedSeatCount: job.seats || 2,
      bookingUrl: isExactCgvBookingUrl(job.bookingUrl) ? job.bookingUrl : undefined,
      seatIds: job.preferredSeats?.length ? job.preferredSeats : undefined,
      storageStatePath: process.env.CGV_STORAGE_STATE,
      headless: /^(1|true|yes|on)$/i.test(process.env.PLAYWRIGHT_HEADLESS || ""),
      holdAtPayment: true,
      onStateChange: onState,
      onPaymentReady: async ({ url, seats }) => {
        status = "need_user";
        message = "PAYMENT_READY hard stop";
        const callbackUrl = isExactCgvBookingUrl(url) ? url : isExactCgvBookingUrl(job.bookingUrl) ? job.bookingUrl : "";
        await notifyPaymentReady({ openbellUrl, workerToken, sessionId, url: callbackUrl, seats });
      },
    });
    if (status !== "need_user") status = "done";
    }
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
    if (!message.includes("PAYMENT_READY") && status !== "need_user") status = "failed";
  } finally {
    clearInterval(beat);
    if (job.source === "gas") {
      const key = jobKey(job);
      remember(key);
      await ackGas(key);
    } else {
      await api("/api/booking/jobs/complete", { id: job.id, agentId, status, resultMessage: message }).catch((err) => {
        console.warn(`[poll] complete failed ${err instanceof Error ? err.message : err}`);
      });
    }
  }
}
