// 오픈벨 집 리포터 (PC)
// 집 인터넷으로 CGV 공홈 잔여석을 읽어 베셀(/api/seat-report) + GAS 웹앱(여러 개 가능)에 올린다.
// 좌석을 클릭하거나 예매하지 않는다.
const fs = require("fs");
const path = require("path");
loadEnvFile(path.join(__dirname, "config.env"));
loadEnvFile(path.join(process.cwd(), "config.env"));

const OPENBELL_URL = (process.env.OPENBELL_URL || "https://openbell-fawn.vercel.app").replace(/\/$/, "");
const TOKEN = process.env.NAS_REPORT_TOKEN || process.env.NAS_WORKER_TOKEN || "";
// 여러 GAS /exec 주소: 쉼표·줄바꿈·세미콜론 구분. GAS_WEB_URL 단일값도 호환.
const GAS_WEB_URLS = parseGasUrls(
  process.env.GAS_WEB_URLS || process.env.GAS_WEB_URL || process.env.OPENBELL_GAS_URL || ""
);
const GAS_SYNC_KEY = process.env.GAS_SYNC_KEY || process.env.GAS_REPORT_KEY || "";
const REPORT_SOURCE = (process.env.REPORT_SOURCE || "pc").trim().toLowerCase();
const INTERVAL_MS = Number(process.env.INTERVAL_MS || 60_000);
const IMAX_INTERVAL_MS = Number(process.env.IMAX_INTERVAL_MS || 30_000);
const DAYS = Math.min(Math.max(Number(process.env.DAYS || 2), 1), 7);
const ALL_SITES = {
  cgv_yongsan: { siteNo: "0013", theaterName: "CGV 용산아이파크몰" },
  cgv_yeongdeungpo: { siteNo: "0059", theaterName: "CGV 영등포타임스퀘어" },
};
const THEATERS = (process.env.THEATERS || "cgv_yongsan,cgv_yeongdeungpo")
  .split(",")
  .map((s) => s.trim())
  .filter((id) => ALL_SITES[id]);

function loadEnvFile(file) {
  try {
    if (!fs.existsSync(file)) return;
    for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      )
        val = val.slice(1, -1);
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {}
}


async function postJsonPreserve(url, headers, body) {
  const payload = JSON.stringify(body);
  const make = (target, redirect) =>
    fetch(target, { method: "POST", headers, body: payload, redirect, signal: AbortSignal.timeout(20000) });
  let res = await make(url, "manual");
  let hops = 0;
  let current = url;
  while (res.status >= 300 && res.status < 400 && hops < 5) {
    const loc = res.headers.get("location");
    if (!loc) break;
    current = new URL(loc, current).href;
    hops++;
    res = await make(current, hops >= 4 ? "follow" : "manual");
  }
  if (res.status >= 300 && res.status < 400) res = await make(url, "follow");
  const text = await res.text();
  return { status: res.status, text };
}

function parseGasUrls(raw) {
  const seen = new Set();
  const out = [];
  String(raw || "")
    .split(/[\n,;]+/)
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter(Boolean)
    .forEach((u) => {
      if (!/^https:\/\//i.test(u)) return;
      if (seen.has(u)) return;
      seen.add(u);
      out.push(u);
    });
  return out;
}

function kstDateKeys(days) {
  const out = [];
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() + i);
    out.push(
      `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`
    );
  }
  return out;
}

function isImaxHall(theaterId, hall) {
  const compact = String(hall || "")
    .toUpperCase()
    .replace(/\s+/g, "");
  if (compact.includes("IMAX")) return true;
  return theaterId === "cgv_yongsan" && /(^|[^\d])20관/.test(compact);
}

async function fetchCgvOfficial(siteNo, scnYmd) {
  const url = `https://api.cgv.co.kr/cnm/atkt/searchMovScnInfo?coCd=A420&siteNo=${siteNo}&scnYmd=${scnYmd}&rtctlScopCd=08`;
  const res = await fetch(url, {
    headers: {
      accept: "application/json, text/plain, */*",
      origin: "https://cgv.co.kr",
      referer: "https://cgv.co.kr/",
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  const rows = j.data ?? j.body ?? [];
  const seen = new Set();
  const out = [];
  for (const x of rows) {
    const title = String(x.movNm || x.movieName || "").trim();
    const hall = String(x.scrnNm || x.scnNm || x.soundTypNm || x.scnsrtNm || "").trim();
    const raw = String(x.scnsrtTm || x.startTime || "");
    const time = raw.length === 4 ? `${raw.slice(0, 2)}:${raw.slice(2)}` : raw;
    const rest = Number(x.frSeatCnt);
    const total = Number(x.stcnt);
    if (!title || !hall || !/^(\d{2}):(\d{2})$/.test(time) || !Number.isFinite(rest)) continue;
    const k = `${scnYmd}|${time}|${hall}|${title}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({
      playDate: `${scnYmd.slice(0, 4)}-${scnYmd.slice(4, 6)}-${scnYmd.slice(6, 8)}`,
      startTime: time,
      hallName: hall,
      movieTitle: title,
      movieNo: String(x.movNo ?? x.movieNo ?? x.movieCode ?? ""),
      scnsNo: x.scnsNo != null ? String(x.scnsNo) : "",
      scnSseq: x.scnSseq != null ? String(x.scnSseq) : "",
      restSeats: rest,
      totalSeats: Number.isFinite(total) ? total : rest,
    });
  }
  return out;
}

async function collect(theaterId) {
  const site = ALL_SITES[theaterId];
  const out = [];
  for (const d of kstDateKeys(DAYS)) {
    try {
      out.push(...(await fetchCgvOfficial(site.siteNo, d)));
    } catch (e) {
      console.log(`[${theaterId}] ${d} 실패`, e.message || e);
    }
  }
  return out;
}

async function postOne(url, headers, body) {
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  return { status: res.status, text };
}

async function reportTheater(theaterId, showtimes, mode) {
  if (!showtimes.length) {
    console.log(`[${theaterId}] ${mode} 회차 없음`);
    return;
  }
  const payload = {
    theaterId,
    mode,
    source: REPORT_SOURCE || "pc",
    showtimes,
  };
  if (GAS_SYNC_KEY) payload.key = GAS_SYNC_KEY;
  const imaxN = showtimes.filter((r) => isImaxHall(theaterId, r.hallName)).length;

  if (TOKEN) {
    try {
      const r = await postOne(
        `${OPENBELL_URL}/api/seat-report`,
        { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
        payload
      );
      console.log(
        `[${theaterId}] Vercel ${mode} ${showtimes.length}건 (IMAX ${imaxN}) -> ${r.status} ${r.text.slice(0, 160)}`
      );
    } catch (e) {
      console.log(`[${theaterId}] Vercel 전송 실패:`, e.message || e);
    }
  } else {
    console.log("NAS_REPORT_TOKEN 없음 — Vercel 전송 건너뜀");
  }

  for (const gasUrl of GAS_WEB_URLS) {
    try {
      const r = await postJsonPreserve(gasUrl, { "content-type": "application/json" }, payload);
      const body = (r.text || "").trim();
      if (!body.startsWith("{")) {
        console.log(`[${theaterId}] GAS HTML 응답 — /exec 설치(새 배포) 확인 (${gasUrl.slice(-24)})`);
      } else {
        console.log(`[${theaterId}] GAS ${mode} ${showtimes.length}건 -> ${r.status} ${body.slice(0, 120)} (${gasUrl.slice(-24)})`);
      }
    } catch (e) {
      console.log(`[${theaterId}] GAS 전송 실패 (${gasUrl.slice(-24)}):`, e.message || e);
    }
  }
}

async function tickFull() {
  for (const theaterId of THEATERS) {
    const rows = await collect(theaterId);
    await reportTheater(theaterId, rows, "full");
  }
}

async function tickImax() {
  for (const theaterId of THEATERS) {
    const rows = (await collect(theaterId)).filter((r) => isImaxHall(theaterId, r.hallName));
    if (rows.length) await reportTheater(theaterId, rows, "imax");
  }
}

if (!THEATERS.length) {
  console.log("THEATERS가 비었습니다.");
  process.exit(1);
}
console.log(
  `오픈벨 집 리포터 시작 → ${OPENBELL_URL}` +
    (GAS_WEB_URLS.length ? ` + GAS×${GAS_WEB_URLS.length}` : "") +
    `\n출처: ${REPORT_SOURCE} / 극장: ${THEATERS.join(", ")} / 전체 ${INTERVAL_MS}ms / IMAX ${IMAX_INTERVAL_MS}ms`
);
if (GAS_WEB_URLS.length) {
  GAS_WEB_URLS.forEach((u, i) => console.log(`  GAS[${i + 1}] ${u}`));
}
tickFull();
setInterval(tickFull, Math.max(INTERVAL_MS, 15000));
if (IMAX_INTERVAL_MS > 0 && IMAX_INTERVAL_MS < INTERVAL_MS) {
  setInterval(tickImax, Math.max(IMAX_INTERVAL_MS, 15000));
}
