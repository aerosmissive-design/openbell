// 오픈벨 NAS 잔여석 리포터
// 집 인터넷으로 CGV 공홈 잔여석을 읽어 베셀 + GAS 웹앱(여러 개 가능)에 전송합니다.
const fs = require("fs");
const path = require("path");
loadEnvFile(path.join(__dirname, "config.env"));
loadEnvFile(path.join(process.cwd(), "config.env"));

const OPENBELL_URL = (process.env.OPENBELL_URL || "https://openbell-fawn.vercel.app").replace(/\/$/, "");
const TOKEN = process.env.NAS_REPORT_TOKEN || process.env.NAS_WORKER_TOKEN || "";
const GAS_WEB_URLS = parseGasUrls(
  process.env.GAS_WEB_URLS || process.env.GAS_WEB_URL || process.env.OPENBELL_GAS_URL || ""
);
const GAS_SYNC_KEY = process.env.GAS_SYNC_KEY || process.env.GAS_REPORT_KEY || "";
const REPORT_SOURCE = (process.env.REPORT_SOURCE || "nas423").trim().toLowerCase();
const INTERVAL_MS = Number(process.env.INTERVAL_MS || 60000);
const IMAX_INTERVAL_MS = Number(process.env.IMAX_INTERVAL_MS || 30000);
const DAYS = Math.min(Math.max(Number(process.env.DAYS || 2), 1), 7);
const ALL_SITES = {
  cgv_yongsan: { siteNo: "0013" },
  cgv_yeongdeungpo: { siteNo: "0059" },
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
      const k = line.slice(0, eq).trim();
      const v = line.slice(eq + 1).trim();
      if (!process.env[k]) process.env[k] = v.replace(/^['"]|['"]$/g, "");
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

function dates(n) {
  const out = [];
  const now = new Date(Date.now() + 9 * 3600000);
  for (let i = 0; i < n; i++) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() + i);
    out.push(
      `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`
    );
  }
  return out;
}

function isImax(id, h) {
  const x = String(h || "")
    .toUpperCase()
    .replace(/\s+/g, "");
  return x.includes("IMAX") || (id === "cgv_yongsan" && /(^|[^\d])20관/.test(x));
}

async function fetchRows(site, ymd) {
  const u = `https://api.cgv.co.kr/cnm/atkt/searchMovScnInfo?coCd=A420&siteNo=${site}&scnYmd=${ymd}&rtctlScopCd=08`;
  const r = await fetch(u, {
    headers: {
      accept: "application/json, text/plain, */*",
      origin: "https://cgv.co.kr",
      referer: "https://cgv.co.kr/",
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw Error(`HTTP ${r.status}`);
  const j = await r.json();
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
    const k = `${ymd}|${time}|${hall}|${title}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({
      playDate: `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`,
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

async function collect(id) {
  const out = [];
  for (const d of dates(DAYS)) {
    try {
      out.push(...(await fetchRows(ALL_SITES[id].siteNo, d)));
    } catch (e) {
      console.log(`[${id}] ${d} 실패`, e.message);
    }
  }
  return out;
}

async function send(id, rows, mode) {
  if (!rows.length) return;
  const payload = {
    theaterId: id,
    mode,
    source: REPORT_SOURCE || "nas423",
    showtimes: rows,
  };
  if (GAS_SYNC_KEY) payload.key = GAS_SYNC_KEY;

  if (TOKEN) {
    try {
      const r = await fetch(`${OPENBELL_URL}/api/seat-report`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${TOKEN}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20000),
      });
      console.log(`[${id}] Vercel ${mode} ${rows.length}건 -> ${r.status} ${await r.text()}`);
    } catch (e) {
      console.log(`[${id}] Vercel 실패`, e.message || e);
    }
  } else {
    console.log("NAS_REPORT_TOKEN 없음");
  }

  for (const gasUrl of GAS_WEB_URLS) {
    try {
      const r = await postJsonPreserve(gasUrl, { "content-type": "application/json" }, payload);
      const body = (r.text || "").trim();
      if (!body.startsWith("{")) {
        console.log(`[${id}] GAS HTML 응답 — /exec 설치(새 배포) 확인 (${gasUrl.slice(-24)})`);
      } else {
        console.log(`[${id}] GAS ${mode} ${rows.length}건 -> ${r.status} ${body.slice(0, 120)} (${gasUrl.slice(-24)})`);
      }
    } catch (e) {
      console.log(`[${id}] GAS 실패 (${gasUrl.slice(-24)})`, e.message || e);
    }
  }
}

async function full() {
  for (const id of THEATERS) await send(id, await collect(id), "full");
}
async function imax() {
  for (const id of THEATERS)
    await send(
      id,
      (await collect(id)).filter((x) => isImax(id, x.hallName)),
      "imax"
    );
}

console.log(
  `오픈벨 NAS 리포터 시작: ${OPENBELL_URL}` +
    (GAS_WEB_URLS.length ? ` + GAS×${GAS_WEB_URLS.length}` : "") +
    ` / 출처: ${REPORT_SOURCE}`
);
if (GAS_WEB_URLS.length) {
  GAS_WEB_URLS.forEach((u, i) => console.log(`  GAS[${i + 1}] ${u}`));
}
full();
setInterval(full, Math.max(15000, INTERVAL_MS));
if (IMAX_INTERVAL_MS < INTERVAL_MS) {
  setInterval(imax, Math.max(15000, IMAX_INTERVAL_MS));
}
