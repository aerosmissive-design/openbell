import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PC_ROOT } from "./env.js";
import { runBooking, runMegabox } from "./run.js";

function envFile() {
  const out: Record<string, string> = {};
  try {
    for (const line of readFileSync(resolve(PC_ROOT, "config.env"), "utf8").split(/\r?\n/)) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m) out[m[1].trim()] = m[2].trim();
    }
  } catch { /* empty */ }
  return out;
}

const env = envFile();
const base = (env.OPENBELL_URL || process.env.OPENBELL_URL || "https://openbell-fawn.vercel.app").replace(/\/$/, "");
const token = env.NAS_WORKER_TOKEN || process.env.NAS_WORKER_TOKEN || "99159915";

async function api(path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method: body ? "POST" : "GET",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (text.trim().startsWith("<")) {
    throw new Error("베셀이 JSON이 아니라 웹 화면을 줬다. 새 API가 아직 배포되지 않았다.");
  }
  return JSON.parse(text) as { ok?: boolean; job?: any; cgv?: any; megabox?: any; error?: string };
}

const shows = await api("/api/booking/test-shows");
if (!shows.cgv || !shows.megabox) {
  console.log("[FAIL] 전광판에 CGV 또는 메가박스 실제 회차가 없다. 리포터가 좌석을 보낸 뒤 다시 실행.");
  console.log(JSON.stringify(shows));
  process.exit(1);
}
const seats = 1 + Math.floor(Math.random() * 4);
async function make(show: any) {
  const created = await api("/api/booking/jobs", {
    movieTitle: show.movieTitle,
    theaterId: show.theaterId,
    playDate: show.playDate,
    startTime: show.startTime,
    hallName: show.hallName || "",
    bookingUrl: show.bookingUrl,
    seats,
  });
  if (!created.job) throw new Error(created.error || "job create failed");
  console.log(`[JOB] ${show.theaterId} ${created.job.movieTitle} ${created.job.playDate} ${created.job.startTime} ${created.job.seats}명`);
  return created.job;
}
const cgv = await make(shows.cgv);
const mega = await make(shows.megabox);
console.log("CGV 창과 메가박스 창을 따로 연다. 결제 버튼은 안 누른다.");
await Promise.all([
  runBooking({
    movieTitle: cgv.movieTitle,
    playDate: cgv.playDate,
    showtime: cgv.startTime,
    requestedSeatCount: cgv.seats,
    bookingUrl: cgv.bookingUrl,
    holdAtPayment: true,
    onPaymentReady: async () => console.log("[CGV] PAYMENT_READY hard stop"),
  }),
  runMegabox({
    movieTitle: mega.movieTitle,
    playDate: mega.playDate,
    showtime: mega.startTime,
    bookingUrl: mega.bookingUrl,
    onPaymentReady: async () => console.log("[메가박스] PAYMENT_READY hard stop"),
  }),
]);
console.log("TEST_DONE");
