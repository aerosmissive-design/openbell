// 오픈벨 집 리포터 (PC / NAS)
// 집 인터넷으로 CGV 공홈 잔여석을 읽어 오픈벨(/api/seat-report)에 올린다.
// 좌석을 클릭하거나 예매하지 않는다.
const fs = require("fs");
const path = require("path");
loadEnvFile(path.join(__dirname, "config.env"));
loadEnvFile(path.join(process.cwd(), "config.env"));
const OPENBELL_URL = (process.env.OPENBELL_URL || "https://openbell-fawn.vercel.app").replace(/\/$/, "");
const TOKEN = process.env.NAS_REPORT_TOKEN || process.env.NAS_WORKER_TOKEN || "";
const GAS_WEB_URL = (process.env.GAS_WEB_URL || process.env.OPENBELL_GAS_URL || "").replace(/\/$/, "");
const GAS_SYNC_KEY = process.env.GAS_SYNC_KEY || process.env.GAS_REPORT_KEY || "";
const REPORT_SOURCE = (process.env.REPORT_SOURCE || "pc").trim().toLowerCase();
const INTERVAL_MS = Number(process.env.INTERVAL_MS || 60_000);
const IMAX_INTERVAL_MS = Number(process.env.IMAX_INTERVAL_MS || 30_000);
const DAYS = Math.min(Math.max(Number(process.env.DAYS || 2), 1), 7);
const ALL_SITES = { cgv_yongsan: { siteNo: "0013", theaterName: "CGV 용산아이파크몰" }, cgv_yeongdeungpo: { siteNo: "0059", theaterName: "CGV 영등포타임스퀘어" } };
const THEATERS = (process.env.THEATERS || "cgv_yongsan,cgv_yeongdeungpo").split(",").map(s => s.trim()).filter(id => ALL_SITES[id]);
function loadEnvFile(file) { try { if (!fs.existsSync(file)) return; for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) { const line = raw.trim(); if (!line || line.startsWith("#")) continue; const eq=line.indexOf("="); if(eq<1) continue; const key=line.slice(0,eq).trim(); let val=line.slice(eq+1).trim(); if((val.startsWith('"')&&val.endsWith('"'))||(val.startsWith("'")&&val.endsWith("'"))) val=val.slice(1,-1); if(!process.env[key]) process.env[key]=val; } } catch {} }
function kstDateKeys(days) { const out=[]; const now=new Date(Date.now()+9*60*60*1000); for(let i=0;i<days;i++){const d=new Date(now);d.setUTCDate(d.getUTCDate()+i);out.push(`${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,"0")}${String(d.getUTCDate()).padStart(2,"0")}`);} return out; }
function decodeHtml(s){return String(s||"").replace(/&/g,"&").replace(/</g,"<").replace(/>/g,">").replace(/&quot;/g,'"').replace(/&#39;/g,"'");}
function isImaxHall(theaterId,hall){const compact=String(hall||"").toUpperCase().replace(/\s+/g,""); if(compact.includes("IMAX")) return true; return theaterId==="cgv_yongsan" && /(^|[^\d])20관/.test(compact);}
async function fetchCgvOfficial(siteNo,scnYmd){const url=`https://api.cgv.co.kr/cnm/atkt/searchMovScnInfo?coCd=A420&siteNo=${siteNo}&scnYmd=${scnYmd}&rtctlScopCd=08`; const res=await fetch(url,{headers:{accept:"application/json, text/plain, */*","accept-language":"ko-KR,ko;q=0.9",origin:"https://cgv.co.kr",referer:"https://cgv.co.kr/","user-agent":"Mozilla/5.0 (Linux; Android 13; SM-S918N) AppleWebKit/537.36 Chrome/122.0.0.0 Mobile Safari/537.36"},signal:AbortSignal.timeout(8000)}); if(!res.ok) throw new Error(`HTTP ${res.status}`); const json=await res.json(); const rows=json.data??json.body??[]; const out=[]; const seen=new Set(); for(const row of rows){const title=decodeHtml(row.movNm||row.movieName||"").trim(); const hall=String(row.scrnNm||row.scnNm||row.soundTypNm||row.scnsrtNm||"").trim(); if(!title||!hall) continue; const raw=String(row.scnsrtTm||row.startTime||""); const startTime=raw.length===4?`${raw.slice(0,2)}:${raw.slice(2)}`:raw; if(!/^\d{2}:\d{2}$/.test(startTime)) continue; const key=`${scnYmd}:${startTime}:${hall}:${title}`; if(seen.has(key)) continue; seen.add(key); const rest=Number(row.frSeatCnt), total=Number(row.stcnt); if(!Number.isFinite(rest)) continue; out.push({playDate:`${scnYmd.slice(0,4)}-${scnYmd.slice(4,6)}-${scnYmd.slice(6,8)}`,startTime,hallName:hall,movieTitle:title,movieNo:String(row.movNo??row.movieNo??row.movieCode??""),restSeats:rest,totalSeats:Number.isFinite(total)?total:rest});} return out;}
async function collect(theaterId){const site=ALL_SITES[theaterId];const showtimes=[];for(const ymd of kstDateKeys(DAYS)){try{showtimes.push(...await fetchCgvOfficial(site.siteNo,ymd));}catch(e){console.log(`[${theaterId}] ${ymd} 조회 실패:`,e.message||e);}}return showtimes;}
async function postOne(url, headers, body) {
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  const text = await res.text();
  return { status: res.status, text };
}
async function reportTheater(theaterId, showtimes, mode) {
  if (!showtimes.length) { console.log(`[${theaterId}] ${mode} 회차 없음`); return; }
  const payload = { theaterId, mode, source: REPORT_SOURCE || "pc", showtimes };
  if (GAS_SYNC_KEY) payload.key = GAS_SYNC_KEY;
  const imaxN = showtimes.filter((r) => isImaxHall(theaterId, r.hallName)).length;
  if (TOKEN) {
    try {
      const r = await postOne(`${OPENBELL_URL}/api/seat-report`, { "content-type": "application/json", authorization: `Bearer ${TOKEN}` }, payload);
      console.log(`[${theaterId}] Vercel ${mode} ${showtimes.length}건 (IMAX ${imaxN}) -> ${r.status} ${r.text.slice(0, 160)}`);
    } catch (e) {
      console.log(`[${theaterId}] Vercel 전송 실패:`, e.message || e);
    }
  } else {
    console.log("NAS_REPORT_TOKEN 없음 — Vercel 전송 건너뜀");
  }
  if (GAS_WEB_URL) {
    try {
      const r = await postOne(GAS_WEB_URL, { "content-type": "application/json" }, payload);
      console.log(`[${theaterId}] GAS ${mode} ${showtimes.length}건 -> ${r.status} ${r.text.slice(0, 160)}`);
    } catch (e) {
      console.log(`[${theaterId}] GAS 전송 실패:`, e.message || e);
    }
  }
}] ${mode} 회차 없음`);return;}if(!TOKEN){console.log("토큰이 없습니다. config.env의 NAS_REPORT_TOKEN을 베셀과 같게 넣으세요.");return;}try{const res=await fetch(`${OPENBELL_URL}/api/seat-report`,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${TOKEN}`},body:JSON.stringify({theaterId,mode,showtimes})});const text=await res.text();const imaxN=showtimes.filter(r=>isImaxHall(theaterId,r.hallName)).length;console.log(`[${theaterId}] ${mode} 전송 ${showtimes.length}건 (IMAX ${imaxN}) -> ${res.status} ${text}`);}catch(e){console.log(`[${theaterId}] 전송 실패:`,e.message||e);}}
async function tickFull(){for(const theaterId of THEATERS){const rows=await collect(theaterId);await reportTheater(theaterId,rows,"full");}}
async function tickImax(){for(const theaterId of THEATERS){const rows=(await collect(theaterId)).filter(r=>isImaxHall(theaterId,r.hallName));if(rows.length) await reportTheater(theaterId,rows,"imax");}}
if(!THEATERS.length){console.log("THEATERS가 비었습니다.");process.exit(1);}
console.log(`오픈벨 집 리포터 시작 → ${OPENBELL_URL}` + (GAS_WEB_URL ? ` + GAS` : '') + `\n극장: ${THEATERS.join(", ")} / 전체 ${INTERVAL_MS}ms / IMAX ${IMAX_INTERVAL_MS}ms`);
tickFull(); setInterval(tickFull,Math.max(INTERVAL_MS,15000)); if(IMAX_INTERVAL_MS>0&&IMAX_INTERVAL_MS<INTERVAL_MS)setInterval(tickImax,Math.max(IMAX_INTERVAL_MS,15000));
