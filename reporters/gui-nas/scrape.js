// OpenBell Windows PC seat reporter + GUI + real Edge/CGV browser capture
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";

function loadEnvFile(filePath) {
  try {
    const text = fs.readFileSync(filePath, "utf8");
    for (const rawLine of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      if (!process.env[key]) process.env[key] = value;
    }
  } catch (err) { console.error(`[OpenBell] config.env 읽기 실패: ${err.message || err}`); }
}
loadEnvFile(path.join(process.cwd(), "config.env"));

const OPENBELL_URL = (process.env.OPENBELL_URL || "https://openbell-fawn.vercel.app").replace(/\/$/, "");

function parseGasUrls(raw) {
  const seen = new Set();
  const out = [];
  String(raw || "").split(/[\n,;]+/).map(s => s.trim().replace(/\/$/, "")).filter(Boolean).forEach(u => {
    if (!/^https:\/\//i.test(u)) return;
    if (seen.has(u)) return;
    seen.add(u);
    out.push(u);
  });
  return out;
}
let gasWebUrls = parseGasUrls(process.env.GAS_WEB_URLS || process.env.GAS_WEB_URL || process.env.OPENBELL_GAS_URL || "");
let gasSyncKey = String(process.env.GAS_SYNC_KEY || process.env.GAS_REPORT_KEY || "").trim();
async function postJsonPreserve(url, headers, body) {
  const payload = JSON.stringify(body);
  const make = (target, redirect) => fetch(target, { method: "POST", headers, body: payload, redirect, signal: AbortSignal.timeout(20000) });
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
  if (res.status >= 300 && res.status < 400) {
    res = await make(url, "follow");
  }
  const text = await res.text();
  return { status: res.status, text, url: current };
}
const TOKEN = (process.env.NAS_WORKER_TOKEN || process.env.NAS_REPORT_TOKEN || "").trim();
const INTERVAL_MS = Math.max(30_000, Number(process.env.INTERVAL_MS || 60_000));
const DAY_OPTIONS = [5,7,10,15,20];
const DEFAULT_DAYS = Number(process.env.DAYS || 15);
let daysAhead = DAY_OPTIONS.includes(DEFAULT_DAYS) ? DEFAULT_DAYS : 15;
/** 서버에 찍히는 출처: pc | nas423 | nas225 → 전광판 g-pc / g-nas423+ / g-nas225+ */
const SOURCE_OPTIONS = ["pc", "nas423", "nas225"];
const SOURCE_LABELS = { pc: "G_PC", nas423: "G_DS423+", nas225: "G_DS225+" };
function normalizeReportSource(v) {
  const s = String(v || "").trim().toLowerCase();
  if (s === "nas423" || s === "g_nas423+" || s === "g-nas423+" || s === "g-ds423+" || s === "g_ds423+" || s === "ds423") return "nas423";
  if (s === "nas225" || s === "g_nas225+" || s === "g-nas225+" || s === "g-ds225+" || s === "g_ds225+" || s === "ds225") return "nas225";
  if (s === "nas") return "nas423"; // 구버전 호환 → 423으로
  return "pc";
}
let reportSource = normalizeReportSource(process.env.REPORT_SOURCE || process.env.OPENBELL_SOURCE || "pc");
const GUI_PORT_START = Number(process.env.GUI_PORT || 17653);
const GUI_HOST = (process.env.GUI_HOST || "0.0.0.0").trim() || "0.0.0.0";
let GUI_PORT = GUI_PORT_START;
const CGV_WAIT_MS = Math.max(3000, Number(process.env.CGV_WAIT_MS || 6000));
const VERSION = "11.26";

const ALL_SITES = {
  cgv_yongsan: { chain:"cgv", siteNo: "0013", theaterName: "CGV 용산아이파크몰" },
  cgv_yeongdeungpo: { chain:"cgv", siteNo: "0059", theaterName: "CGV 영등포타임스퀘어" },
  megabox_coex: { chain:"megabox", brchNo:"1351", brchNm:"코엑스", theaterName:"메가박스 코엑스" },
  megabox_namyangju: { chain:"megabox", brchNo:"0019", brchNm:"남양주", theaterName:"메가박스 남양주" },
};
const THEATER_ORDER = Object.keys(ALL_SITES);
let selectedTheaters = (process.env.THEATERS || "cgv_yongsan,cgv_yeongdeungpo,megabox_coex,megabox_namyangju").split(",").map(s => s.trim()).filter(id => ALL_SITES[id]);

const state = { version:VERSION, startedAt:new Date().toISOString(), lastFull:null, running:false, browserReady:false, loginChecked:false, logs:[], counts:{full:0}, errors:0, queue:"대기", schedules:{}, days:daysAhead, source:reportSource, theaters:selectedTheaters.slice() };

const settingsPath = path.join(process.env.LOCALAPPDATA || process.cwd(), "OpenBell", "pc-settings.json");
function loadPcSettings(){ try { const x=JSON.parse(fs.readFileSync(settingsPath,"utf8")); if(Array.isArray(x.theaters)) selectedTheaters=x.theaters.filter(id=>ALL_SITES[id]); if(Number.isFinite(Number(x.days)) && DAY_OPTIONS.includes(Number(x.days))) daysAhead=Number(x.days); if(x.source) reportSource=normalizeReportSource(x.source); if(x.gasWebUrls) gasWebUrls=parseGasUrls(Array.isArray(x.gasWebUrls)?x.gasWebUrls.join(","):x.gasWebUrls); if(typeof x.gasSyncKey==="string") gasSyncKey=x.gasSyncKey.trim(); } catch {} state.theaters=selectedTheaters.slice(); state.days=daysAhead; state.source=reportSource; }
function savePcSettings(){
  try {
    fs.mkdirSync(path.dirname(settingsPath),{recursive:true});
    fs.writeFileSync(settingsPath,JSON.stringify({theaters:selectedTheaters,days:daysAhead,source:reportSource,gasWebUrls,gasSyncKey},null,2),"utf8");
  } catch(err){ log(`[설정] 저장 실패: ${err.message||err}`); }
}
loadPcSettings();

// Windows CMD에서도 읽기 쉬운 색상 로그를 사용한다. 최신 Windows 10/11 CMD는 ANSI 색상을 지원한다.
const ANSI = { reset:"\x1b[0m", bold:"\x1b[1m", cyan:"\x1b[36m", blue:"\x1b[34m", green:"\x1b[32m", yellow:"\x1b[33m", red:"\x1b[31m", magenta:"\x1b[35m", white:"\x1b[37m", gray:"\x1b[90m" };
function seatColor(n){ if(n===0) return ANSI.red; if(n<=5) return ANSI.yellow; return ANSI.green; }
function fmtSeat(n,total){ return Number.isFinite(total) && total>0 ? `${n}/${total}` : `${n}`; }
function scheduleKey(r){ return `${r.playDate}|${r.hallName}|${r.movieTitle}|${r.startTime}|${r.movieNo||""}`; }
const printedSeats = new Map();
function printScheduleChanges(theaterId, rows, mode="full") {
  const site=ALL_SITES[theaterId];
  const prefix=mode==="imax" ? ANSI.magenta+"[IMAX]"+ANSI.reset : "[전체]";
  const changed=[];
  for(const r of rows){
    const key=`${theaterId}|${scheduleKey(r)}`;
    const val=Number(r.restSeats);
    const prev=printedSeats.get(key);
    if(prev===undefined || prev!==val){
      printedSeats.set(key,val);
      changed.push({...r,prevSeats:prev});
    }
  }
  if(!changed.length) return;
  console.log(`${ANSI.cyan}${ANSI.bold}\n${prefix} ${site.theaterName} · 좌석 정보 ${changed.length}건 확인/변경${ANSI.reset}`);
  for(const r of changed.sort((a,b)=>`${a.playDate}${a.startTime}`.localeCompare(`${b.playDate}${b.startTime}`))){
    const date=r.playDate.slice(5).replace("-","/");
    const hall=r.hallName||site.theaterName;
    const seat=fmtSeat(r.restSeats,r.totalSeats);
    const tag=/imax|아이맥스/i.test(`${hall} ${r.movieTitle}`) ? ANSI.magenta+" [IMAX]"+ANSI.reset : "";
    const prevText=Number.isFinite(r.prevSeats) ? ` ${r.prevSeats}→${r.restSeats}석` : ` ${r.restSeats}석`;
    const delta=Number.isFinite(r.prevSeats) ? r.restSeats-r.prevSeats : null;
    const deltaText=delta===null ? "" : delta<0 ? ` ${ANSI.red}▼${Math.abs(delta)}석${ANSI.reset}` : delta>0 ? ` ${ANSI.green}▲${delta}석${ANSI.reset}` : "";
    const stateText=Number(r.restSeats)===0 ? `${ANSI.red}[매진]${ANSI.reset}` : Number(r.restSeats)<=5 ? `${ANSI.yellow}[잔여 적음]${ANSI.reset}` : `${ANSI.green}[잔여]${ANSI.reset}`;
    console.log(`  ${ANSI.blue}${date} ${r.startTime}${ANSI.reset}  ${ANSI.white}${hall}${ANSI.reset}  ${r.movieTitle}${tag}  ${stateText}${seatColor(r.restSeats)} ${prevText}${deltaText}${ANSI.reset}`);
  }
}
function setScheduleState(theaterId, rows){
  const existing=state.schedules[theaterId]||[];
  const imaxKeys=new Set(existing.filter(r=>r.imax).map(scheduleKey));
  state.schedules[theaterId]=(rows||[]).map(r=>({...r,imax:imaxKeys.has(scheduleKey(r)) || /imax|아이맥스/i.test(`${r.hallName} ${r.movieTitle}`)}));
}
function markImaxState(theaterId, rows){
  const imaxKeys=new Set((rows||[]).map(scheduleKey));
  state.schedules[theaterId]=(state.schedules[theaterId]||[]).map(r=>({...r,imax:r.imax||imaxKeys.has(scheduleKey(r))}));
}
// 최근 전체 수집 결과를 IMAX 주기에서 재사용한다. CGV에 같은 날짜를 다시 요청하지 않는다.
const scheduleCache = new Map();
function cacheKey(theaterId, ymd){ return `${theaterId}:${ymd}`; }
function cacheSchedule(theaterId, ymd, rows){ scheduleCache.set(cacheKey(theaterId,ymd), {rows, at:Date.now()}); }
function getCachedSchedule(theaterId, ymd){ return scheduleCache.get(cacheKey(theaterId,ymd))?.rows || null; }

// printedSeats/scheduleCache는 지나간 날짜의 항목을 스스로 지우지 않으면
// PC를 몇 주씩 계속 켜둘 때 조금씩 메모리가 쌓인다(누수). 어제 이전 날짜는
// 더 이상 쓸 일이 없으므로, 매 수집 주기마다 그런 항목만 정리한다.
function pruneOldCaches(){
  const kstNow = new Date(Date.now() + 9*60*60*1000);
  const y = new Date(kstNow); y.setUTCDate(y.getUTCDate() - 1); // 어제(KST)
  const yy = y.getUTCFullYear(), mm = String(y.getUTCMonth()+1).padStart(2,"0"), dd = String(y.getUTCDate()).padStart(2,"0");
  const yesterdayDash = `${yy}-${mm}-${dd}`;
  const yesterdayCompact = `${yy}${mm}${dd}`;
  let removed = 0;
  for (const key of printedSeats.keys()) {
    const playDate = key.split("|")[0];
    if (playDate && playDate < yesterdayDash) { printedSeats.delete(key); removed++; }
  }
  for (const key of scheduleCache.keys()) {
    const ymd = key.split(":")[1];
    if (ymd && ymd < yesterdayCompact) { scheduleCache.delete(key); removed++; }
  }
  if (removed) log(`[정리] 지난 날짜 캐시 ${removed}건 정리 (printedSeats ${printedSeats.size} · scheduleCache ${scheduleCache.size})`);
}
function log(message) { const line=`[${new Date().toLocaleTimeString("ko-KR",{hour12:false})}] ${message}`; console.log(line); state.logs.push(line); if(state.logs.length>160) state.logs.shift(); }
function kstDateKeys(days) { const out=[]; const now=new Date(Date.now()+9*60*60*1000); for(let i=0;i<days;i++){const d=new Date(now);d.setUTCDate(d.getUTCDate()+i);out.push(`${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,"0")}${String(d.getUTCDate()).padStart(2,"0")}`);} return out; }
function decodeHtml(s){return String(s||"").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;/g,"'");}
function collectCandidateRows(value, out = [], depth = 0) {
  if (depth > 12 || value == null) return out;
  if (typeof value === "string") {
    const t = value.trim();
    if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
      try { collectCandidateRows(JSON.parse(t), out, depth + 1); } catch {}
    }
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectCandidateRows(item, out, depth + 1);
    return out;
  }
  if (typeof value !== "object") return out;
  const keys = Object.keys(value);
  const joined = keys.join(" ");
  // CGV's current schedule rows contain these fields. Accept a row even when
  // some display-only fields are absent; parseRows() does the final validation.
  if (/movNm|movieName|movNo|scnsrtTm|scnendTm|frSeatCnt|stcnt|scnSseq/i.test(joined)) out.push(value);
  for (const [k, v] of Object.entries(value)) {
    // Some CGV responses wrap JSON again as a string (data/result/etc.).
    if (typeof v === "string" && /data|result|list|schedule|scn|movie/i.test(k)) {
      const t = v.trim();
      if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
        try { collectCandidateRows(JSON.parse(t), out, depth + 1); } catch {}
      }
    } else {
      collectCandidateRows(v, out, depth + 1);
    }
  }
  return out;
}
function normalizeTime(raw) {
  const s = String(raw ?? "").trim();
  if (/^\d{4}$/.test(s)) return `${s.slice(0,2)}:${s.slice(2)}`;
  const m = s.match(/(?:^|\D)(\d{1,2}):?(\d{2})(?:\D|$)/);
  return m ? `${String(m[1]).padStart(2,"0")}:${m[2]}` : "";
}
function parseRows(json,scnYmd,defaultHall="",siteInfo=null) {
  const rows=collectCandidateRows(json),out=[],seen=new Set();
  for(const row of rows){
    const title=decodeHtml(row.movNm??row.movieName??row.movNmKo??row.movieNm??row.title??"").trim();
    // searchMovScnInfo does not always return a screen/hall field.  In that
    // case keep the theater name as the hall placeholder so the schedule is
    // not discarded before it reaches the server.
    const hall=String(row.scrnNm??row.scnNm??row.scnNmKo??row.screenName??row.hallName??row.scrnName??row.roomName??defaultHall??"").trim();
    const startTime=normalizeTime(row.scnsrtTm??row.scnStartTm??row.startTime??row.startTm??row.playStartTime??row.playStartTm??"");
    const restRaw=row.frSeatCnt??row.remainSeatCnt??row.restSeatCnt??row.remainSeats??row.seatCnt??row.remainSeat??row.freeSeatCnt;
    const restSeats=Number(String(restRaw??"").replace(/,/g,""));
    if(!title||!hall||!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(startTime)||!Number.isFinite(restSeats))continue;
    const totalRaw=row.stcnt??row.totalSeatCnt??row.totalSeats??row.seatTotalCnt??row.seatCntTotal;
    const totalSeats=Number(String(totalRaw??"").replace(/,/g,""));
    const movieNo=String(row.movNo??row.movieNo??row.movieCode??row.movCd??"");
    const scnsNo=String(row.scnsNo??row.scnsNoCd??row.screeningNo??"");
    const scnSseq=String(row.scnSseq??row.scnsSeq??row.screeningSeq??"");
    const key=`${scnYmd}:${startTime}:${hall}:${title}:${movieNo}`;
    if(seen.has(key))continue; seen.add(key);
    const siteNo=String(siteInfo?.siteNo??(defaultHall.includes("영등포")?"0059":defaultHall.includes("용산")?"0013":""));
    const siteNm=String(siteInfo?.theaterName??defaultHall).replace(/^CGV\s*/i,"");
    const bookingUrl=(movieNo && scnsNo && scnSseq && siteNo)
      ? `https://cgv.co.kr/cnm/movieBook/movie?${new URLSearchParams({movNo:movieNo,scnYmd:`${scnYmd.slice(0,4)}-${scnYmd.slice(4,6)}-${scnYmd.slice(6,8)}`,siteNo,siteNm,scnsNo,scnSseq}).toString()}`
      : (movieNo && siteNo)
        ? `https://cgv.co.kr/cnm/movieBook/movie?${new URLSearchParams({movNo:movieNo,scnYmd:`${scnYmd.slice(0,4)}-${scnYmd.slice(4,6)}-${scnYmd.slice(6,8)}`,siteNo,siteNm}).toString()}`
        : "";
    out.push({playDate:`${scnYmd.slice(0,4)}-${scnYmd.slice(4,6)}-${scnYmd.slice(6,8)}`,startTime,hallName:hall,movieTitle:title,movieNo,restSeats,totalSeats:Number.isFinite(totalSeats)?totalSeats:restSeats,bookingUrl});
  }
  return out;
}
function edgePath(){const candidates=[process.env.EDGE_PATH,process.env.CHROME_PATH,`${process.env['PROGRAMFILES(X86)']||"C:\\Program Files (x86)"}\\Microsoft\\Edge\\Application\\msedge.exe`,`${process.env.PROGRAMFILES||"C:\\Program Files"}\\Microsoft\\Edge\\Application\\msedge.exe`].filter(Boolean);return candidates.find(p=>fs.existsSync(p));}

let browser, page;
function minimizeOpenBellBrowser(profileDir){
  if(process.platform!=="win32") return;
  const marker=String(profileDir).replace(/\\/g,"\\\\").replace(/'/g,"''");
  // Edge may create several processes and the main window handle can appear a little later.
  // Find every OpenBell CGV Edge process and minimize any visible top-level window.
  const ps=`$ErrorActionPreference='SilentlyContinue';$items=Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*${marker}*' };if($items){Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class W{[DllImport("user32.dll")]public static extern bool ShowWindowAsync(IntPtr hWnd,int nCmdShow);}' -ErrorAction SilentlyContinue;foreach($x in $items){$p=Get-Process -Id $x.ProcessId -ErrorAction SilentlyContinue;if($p -and $p.MainWindowHandle -ne 0){[W]::ShowWindowAsync($p.MainWindowHandle,6)|Out-Null}}}`;
  spawn("powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-WindowStyle","Hidden","-Command",ps],{windowsHide:true,stdio:"ignore"}).unref();
}
function scheduleBrowserMinimize(profileDir){
  if(process.platform!=="win32") return;
  for(const ms of [300,800,1500,2500,4000]) setTimeout(()=>minimizeOpenBellBrowser(profileDir),ms);
}

async function ensureBrowser(){
  if(browser&&page&&!page.isClosed())return page;
  let executablePath=edgePath();
  // NAS/Linux: PLAYWRIGHT_CHROMIUM_PATH 또는 일반 chromium
  if(!executablePath && process.platform!=="win32"){
    const linuxCands=[
      process.env.PLAYWRIGHT_CHROMIUM_PATH,
      process.env.CHROMIUM_PATH,
      process.env.CHROME_PATH,
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/usr/bin/google-chrome-stable",
      "/ms-playwright/chromium-*/chrome-linux/chrome",
    ].filter(Boolean);
    for(const c of linuxCands){
      try{
        if(c.includes("*")){
          const {globSync}=await import("node:fs"); // skip
        }else if(fs.existsSync(c)){ executablePath=c; break; }
      }catch{}
    }
  }
  if(!executablePath)throw new Error(process.platform==="win32"?"Microsoft Edge를 찾지 못했습니다.":"Chromium을 찾지 못했습니다. PLAYWRIGHT_CHROMIUM_PATH 또는 chromium 설치 필요(NAS Docker 권장).");
  const baseDir=path.join(process.env.LOCALAPPDATA||process.env.HOME||process.cwd(),"OpenBell");
  const preferred=path.join(baseDir,`CGVBrowserProfile_OpenBell_${process.pid}`);
  fs.mkdirSync(baseDir,{recursive:true});

  // Edge persistent profiles are locked by Edge itself. If another Edge window
  // (or a previous crashed OpenBell process) is using the preferred profile,
  // Playwright launches Edge and Edge immediately exits, which used to surface
  // as an about:blank / Target page, context or browser has been closed error.
  // Do NOT kill the user's Edge. Retry with an OpenBell-only fallback profile.
  const candidates=[path.join(baseDir,`CGVBrowserProfile_OpenBell_${process.pid}`)];
  let lastErr=null;
  for(const profileDir of candidates){
    try{
      fs.mkdirSync(profileDir,{recursive:true});
      log(`[브라우저] Edge 프로필 사용: ${path.basename(profileDir)}`);
      browser=await (async()=>{
        // NAS/Docker has no X display → must be headless. Windows PC keeps headed Edge for CGV realism.
        const wantHeadless =
          process.env.HEADLESS === "1" ||
          process.env.HEADLESS === "true" ||
          (process.platform !== "win32" && process.env.HEADLESS !== "0");
        const args = [
          "--disable-blink-features=AutomationControlled",
          "--no-first-run",
          "--no-default-browser-check",
          "--disable-extensions",
          "--no-sandbox",
          "--disable-dev-shm-usage",
        ];
        if (!wantHeadless) args.push("--start-minimized");
        const ctx = await chromium.launchPersistentContext(profileDir, {
          executablePath,
          headless: wantHeadless,
          viewport: { width: 1440, height: 900 },
          locale: "ko-KR",
          timezoneId: "Asia/Seoul",
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          args,
        });
        try {
          await ctx.addInitScript(() => {
            Object.defineProperty(navigator, "webdriver", { get: () => undefined });
          });
        } catch {}
        return ctx;
      })();
      page=browser.pages()[0]||await browser.newPage();
      // Never leave the user with a visible about:blank window. Navigate first,
      // then minimize the actual CGV window repeatedly until Edge exposes its HWND.
      if(!/cgv\.co\.kr/i.test(page.url())){
        await page.goto("https://cgv.co.kr/cnm/movieBook/cinema",{waitUntil:"domcontentloaded",timeout:30000}).catch(e=>log(`[브라우저] CGV 초기 이동 실패: ${e.message||e}`));
      }
      state.browserReady=true;
      log("CGV 브라우저 연결 완료" + (process.platform!=="win32" || process.env.HEADLESS==="1" ? " (headless)" : ""));
      if(process.platform==="win32" && process.env.HEADLESS!=="1") scheduleBrowserMinimize(profileDir);

      return page;
    }catch(err){
      lastErr=err;
      try{if(browser) await browser.close();}catch{}
      browser=null; page=null;
      log(`[브라우저] 프로필 시작 실패: ${path.basename(profileDir)} · ${err.message||err}`);
    }
  }
  throw lastErr||new Error("CGV Edge 브라우저를 시작하지 못했습니다.");
}
async function textClick(p, text){
  try{
    const loc=p.getByText(text,{exact:true}).first();
    if(await loc.count()){await loc.scrollIntoViewIfNeeded().catch(()=>{});await loc.click({timeout:5000}).catch(()=>{});return true;}
  }catch{}
  try{
    const loc=p.getByText(text,{exact:false}).first();
    if(await loc.count()){await loc.scrollIntoViewIfNeeded().catch(()=>{});await loc.click({timeout:5000}).catch(()=>{});return true;}
  }catch{}
  return false;
}
async function forceClickByText(p, names){
  // DOM-level click: more reliable in headless SPA than Playwright getByText alone.
  return await p.evaluate((names)=>{
    const norm=s=>String(s||"").replace(/\s+/g,"").toLowerCase();
    const targets=names.map(norm).filter(Boolean);
    const nodes=[...document.querySelectorAll("button,a,li,div,span,label,p")];
    for(const want of targets){
      for(const el of nodes){
        const t=norm(el.innerText||el.textContent||"");
        if(!t || t.length>80) continue;
        if(t===want || t.includes(want)){
          try{ el.scrollIntoView({block:"center"}); }catch{}
          try{ el.click(); return true; }catch{}
        }
      }
    }
    return false;
  }, names);
}
async function openBooking(p){
  const current=p.url();
  if(!/cgv\.co\.kr\/cnm\/movieBook\/cinema/i.test(current)){
    await p.goto("https://cgv.co.kr/cnm/movieBook/cinema",{waitUntil:"domcontentloaded",timeout:45000}).catch(e=>log(`[CGV] 예매 페이지 이동: ${e.message||e}`));
  }
  await p.waitForTimeout(process.platform==="win32" && process.env.HEADLESS!=="1" ? 2500 : 4000);
  state.loginChecked=true;
}
async function selectTheater(p,site){
  const short=site.theaterName.replace(/^CGV\s*/i,"").trim();
  const names=[short, site.theaterName, short.replace(/\s+/g,"")];
  // Region first (서울) helps reveal the theater list on some CGV layouts.
  await textClick(p,"서울").catch(()=>{});
  await forceClickByText(p,["서울"]).catch(()=>{});
  await p.waitForTimeout(600);
  let clicked=await textClick(p, short);
  if(!clicked) clicked=await textClick(p, site.theaterName);
  if(!clicked) clicked=await forceClickByText(p, names);
  return clicked;
}
async function selectDate(p,ymd){
  const day=String(Number(ymd.slice(6,8)));
  const candidates=[
    p.locator(`[data-date="${ymd}"]`),
    p.locator(`[data-ymd="${ymd}"]`),
    p.locator(`[data-date*="${ymd}"]`),
    p.getByText(day,{exact:true}),
  ];
  for(const loc of candidates){
    try{
      const n=await loc.count();
      if(!n) continue;
      for(let i=0;i<Math.min(n,8);i++){
        const el=loc.nth(i);
        if(await el.isVisible().catch(()=>false)){
          await el.click({timeout:5000}).catch(()=>{});
          return true;
        }
      }
    }catch{}
  }
  // Fallback: click day number via evaluate
  return await p.evaluate((day, ymd)=>{
    const nodes=[...document.querySelectorAll("button,a,li,div,span,td")];
    for(const el of nodes){
      const d=el.getAttribute("data-date")||el.getAttribute("data-ymd")||"";
      if(d && d.includes(ymd)){ try{el.click();return true;}catch{} }
    }
    for(const el of nodes){
      const t=(el.innerText||"").trim();
      if(t===day && t.length<=2){ try{el.click();return true;}catch{} }
    }
    return false;
  }, day, ymd);
}

// One browser job at a time. CGV navigation cancels concurrent navigations, which caused the old ERR_ABORTED loop.
let browserQueue=Promise.resolve();
function browserClosedError(err){return /Target page, context or browser has been closed|browserType\.launchPersistentContext|locator\.(count|click).*closed|context.*closed/i.test(String(err?.message||err||""));}
async function resetBrowser(){
  state.browserReady=false;
  const old=browser;
  browser=null; page=null;
  try{if(old) await old.close();}catch{}
}
function withBrowserLock(fn){
  const run=browserQueue.then(async()=>{
    try{return await fn();}
    catch(err){
      if(!browserClosedError(err)) throw err;
      log("[브라우저] 페이지/컨텍스트가 닫혀 자동 재연결합니다.");
      await resetBrowser();
      return await fn();
    }
  },async()=>{
    try{return await fn();}
    catch(err){
      if(!browserClosedError(err)) throw err;
      log("[브라우저] 페이지/컨텍스트가 닫혀 자동 재연결합니다.");
      await resetBrowser();
      return await fn();
    }
  });
  browserQueue=run.catch(()=>{});
  return run;
}

async function fetchScheduleDirectFromBrowser(p, site, scnYmd, authHeaders=null) {
  const url=`https://api.cgv.co.kr/cnm/atkt/searchMovScnInfo?coCd=A420&siteNo=${encodeURIComponent(site.siteNo)}&scnYmd=${encodeURIComponent(scnYmd)}&rtctlScopCd=08`;
  const headers={"Accept":"application/json","Accept-Language":"ko-KR"};
  if(authHeaders){
    for(const [k,v] of Object.entries(authHeaders)){ if(v) headers[k]=v; }
  }
  return await p.evaluate(async ({u,h})=>{
    try {
      const r=await fetch(u,{method:"GET",credentials:"include",headers:h});
      const text=await r.text();
      let json=null; try { json=JSON.parse(text); } catch {}
      return {ok:r.ok,status:r.status,url:r.url,text:json?null:text,json};
    } catch(e) { return {ok:false,status:0,url:u,text:String(e?.message||e),json:null}; }
  },{u:url,h:headers});
}

async function fetchCgvViaBrowser(site,scnYmd){
  return withBrowserLock(async()=>{
    const p=await ensureBrowser();
    const captured={seen:false,rows:[],url:"",status:0,contentType:"",authHeaders:null};
    const onResponse=async response=>{
      const url=response.url();
      if(!/searchMovScnInfo/i.test(url))return;
      captured.seen=true;captured.url=url;captured.status=response.status();captured.contentType=response.headers()["content-type"]||"";
      try{
        const json=await response.json();
        // Preserve the exact auth material CGV used for this successful browser
        // request.  The current CGV API commonly requires x-timestamp,
        // x-signature and cookies; a plain in-page fetch can therefore return 401.
        try {
          const h=await response.request().allHeaders();
          captured.authHeaders={};
          for(const k of ["accept","accept-language","cookie","x-timestamp","x-signature","authorization","referer","origin"]){
            if(h[k]) captured.authHeaders[k]=h[k];
          }
        } catch {}
        const rows=parseRows(json,scnYmd,site.theaterName,site);
        if(rows.length || !captured.rows.length) captured.rows=rows;
        log(`[${site.theaterName}] ${scnYmd} ${response.status()===200?'상영정보 확인 성공':'상영정보 확인 실패'} · ${rows.length}회차 확인`);
        if(!rows.length) log(`[${site.theaterName}] ${scnYmd} API 응답은 왔지만 회차 필드 분석이 필요함`);
      }catch(err){log(`[${site.theaterName}] ${scnYmd} API JSON 읽기 실패: ${err.message||err}`);}
    };
    p.on("response",onResponse);
    try{
      // IMPORTANT: response listener is attached BEFORE navigation.
      // Reload the booking page for every theater/date so CGV is forced to rebuild
      // its own searchMovScnInfo request instead of silently reusing the previous UI state.
      await p.goto("https://cgv.co.kr/cnm/movieBook/cinema",{waitUntil:"domcontentloaded",timeout:30000}).catch(e=>log(`[CGV] 예매 페이지 새로고침: ${e.message||e}`));
      await p.waitForTimeout(2200);
      state.loginChecked=true;
      const clicked=await selectTheater(p,site);
      log(`[${site.theaterName}] 극장 선택 ${clicked?"완료":"확인 필요"}`);
      await p.waitForTimeout(700);
      const dateClicked=await selectDate(p,scnYmd);
      log(`[${site.theaterName}] ${scnYmd} 날짜 선택 ${dateClicked?"완료":"자동 선택 실패"}`);
      // Give CGV time to lazy-load the schedule.
      const isHeadless = process.env.HEADLESS==="1" || process.env.HEADLESS==="true" || process.platform!=="win32";
      await p.waitForTimeout(isHeadless ? Math.max(CGV_WAIT_MS, 8000) : CGV_WAIT_MS);
      // Headless: try in-page API early (cookies from SPA session may be enough)
      if(!captured.seen && isHeadless){
        const direct=await fetchScheduleDirectFromBrowser(p,site,scnYmd,captured.authHeaders);
        if(direct.status===200){
          const rows=parseRows(direct.json ?? direct.text,scnYmd,site.theaterName,site);
          log(`[${site.theaterName}] ${scnYmd} headless API ${direct.status} · ${rows.length}회차`);
          if(rows.length || direct.ok){
            captured.seen=true; captured.status=direct.status; captured.url=direct.url; captured.rows=rows;
          }
        } else if(direct.status){
          log(`[${site.theaterName}] ${scnYmd} headless API HTTP ${direct.status}`);
        }
      }
      if(!captured.seen){
        await p.mouse.wheel(0,900).catch(()=>{});
        await p.waitForTimeout(1800);
      }
      if(!captured.seen){
        // Re-click the selected theater/date to force CGV's own request.
        await selectTheater(p,site);
        await p.waitForTimeout(500);
        await selectDate(p,scnYmd);
        await p.waitForTimeout(4500);
      }
      // If the page's own request was not observable (CGV sometimes changes
      // the UI without emitting the request after a repeated click), call the
      // same current schedule endpoint from inside the real CGV browser
      // context. This keeps cookies/session/CORS in the browser.
      if(!captured.seen){
        const direct=await fetchScheduleDirectFromBrowser(p,site,scnYmd,captured.authHeaders);
        if(direct.status){
          const rows=parseRows(direct.json ?? direct.text,scnYmd,site.theaterName,site);
          log(`[${site.theaterName}] ${scnYmd} 브라우저 상영정보 ${direct.status===200?'확인 성공':'확인 실패'} · ${rows.length}회차 확인`);
          if(rows.length || direct.ok){
            captured.seen=true; captured.status=direct.status; captured.url=direct.url; captured.rows=rows;
            if(!rows.length) log(`[${site.theaterName}] ${scnYmd} 브라우저 직접 API 응답은 왔지만 회차 필드 분석이 필요함`);
          }
        }
      }
      // Last-resort DOM extraction: the schedule can be visibly rendered even if
      // the network response is unavailable to the automation layer.
      if(!captured.seen){
        const domRows=await extractScheduleFromDom(p,scnYmd).catch(()=>[]);
        if(domRows.length){
          log(`[${site.theaterName}] ${scnYmd} 화면 DOM에서 ${domRows.length}회차 직접 읽음`);
          return domRows;
        }
      }
      // CGV can briefly answer HTTP 200 with only a small, partially-built schedule.
      // Retry once or twice before accepting that snapshot; if it remains small,
      // keep it rather than dropping the theater entirely.
      if(captured.seen && captured.rows.length>0 && captured.rows.length<8){
        for(let retry=1;retry<=2 && captured.rows.length<8;retry++){
          log(`[${site.theaterName}] ${scnYmd} 회차 ${captured.rows.length}건은 준비 중일 수 있어 ${retry}/2 재조회합니다.`);
          await p.waitForTimeout(1800);
          const direct=await fetchScheduleDirectFromBrowser(p,site,scnYmd,captured.authHeaders).catch(()=>null);
          if(direct?.status){
            const retryRows=parseRows(direct.json ?? direct.text,scnYmd,site.theaterName,site);
            log(`[${site.theaterName}] ${scnYmd} 재조회 ${direct.status===200?'확인 성공':'확인 실패'} · ${retryRows.length}회차 확인`);
            if(retryRows.length>captured.rows.length){
              captured.rows=retryRows; captured.status=direct.status; captured.url=direct.url;
            }
          }
        }
      }
    } finally {p.off("response",onResponse); scheduleBrowserMinimize(path.join(process.env.LOCALAPPDATA||process.cwd(),"OpenBell",`CGVBrowserProfile_OpenBell_${process.pid}`));}
    if(!captured.seen)throw new Error("CGV 예매 화면은 열렸지만 상영시간 요청을 감지하지 못했습니다. 브라우저를 닫지 말고 다시 시도합니다.");
    return captured.rows;
  });
}
async function extractImaxHintsFromDom(p,scnYmd){
  const data=await p.evaluate(()=>{
    const out=[];
    for(const el of [...document.querySelectorAll("body *")]){
      const txt=(el.innerText||"").trim();
      if(!/imax|아이맥스/i.test(txt) || txt.length>1800) continue;
      const times=[...new Set((txt.match(/\b(?:[01]?\d|2[0-3]):[0-5]\d\b/g)||[]))];
      if(!times.length) continue;
      const lines=txt.split(/\n+/).map(x=>x.trim()).filter(Boolean);
      const movieLine=lines.find(x=>!/(imax|아이맥스|상영관|좌석|예매|\b(?:[01]?\d|2[0-3]):[0-5]\d\b)/i.test(x) && x.length>=2 && x.length<=120) || "";
      for(const time of times) out.push({time,movie:movieLine});
    }
    return out;
  });
  const out=[],seen=new Set();
  for(const x of data){const key=`${x.time}|${x.movie}`;if(seen.has(key))continue;seen.add(key);out.push({startTime:x.time,movieTitle:x.movie});}
  return out;
}
async function extractScheduleFromDom(p,scnYmd){
  const data=await p.evaluate(()=>{
    const nodes=[...document.querySelectorAll("body *")];
    const out=[];
    for(const el of nodes){
      const txt=(el.innerText||"").trim();
      if(!txt || txt.length>1200) continue;
      const times=txt.match(/\b(?:[01]?\d|2[0-3]):[0-5]\d\b/g);
      if(!times || times.length===0 || times.length>30) continue;
      const parent=el.closest("li,article,section,div")||el;
      const pt=(parent.innerText||txt).trim();
      if(pt.length>2500) continue;
      const movie=(pt.match(/(?:영화|movie)\s*[:：]?\s*([^\n]+)/i)||[])[1]||"";
      const hall=(pt.match(/(?:상영관|관|screen|hall)\s*[:：]?\s*([^\n]+)/i)||[])[1]||"";
      const seat=(pt.match(/(?:잔여|남은|좌석|seat)\s*[:：]?\s*(\d+)/i)||[])[1];
      if(movie && hall && seat) for(const t of times) out.push({movie,hall,time:t,seat:Number(seat)});
    }
    return out;
  });
  const out=[],seen=new Set();
  for(const r of data){
    const key=`${r.time}:${r.hall}:${r.movie}`; if(seen.has(key))continue;seen.add(key);
    out.push({playDate:`${scnYmd.slice(0,4)}-${scnYmd.slice(4,6)}-${scnYmd.slice(6,8)}`,startTime:r.time,hallName:r.hall,movieTitle:r.movie,movieNo:"",restSeats:r.seat,totalSeats:r.seat});
  }
  return out;
}

function parseMegaboxRows(json, scnYmd, site){
  const root = json?.megaMap ?? json?.data?.megaMap ?? json;
  const list = Array.isArray(root?.movieFormList) ? root.movieFormList : [];
  return list.map(row=>{
    const title=String(row.rpstMovieNm??row.movieNm??row.movieName??"").replace(/;[^;]*$/,"" ).trim();
    const hall=String(row.theabExpoNm??row.theabNm??row.screenName??row.hallName??"").trim();
    const start=String(row.playStartTime??row.playStartTm??"").trim();
    const rest=Number(row.restSeatCnt??row.remainSeatCnt);
    const total=Number(row.totSeatCnt??row.theabSeatCnt??row.totalSeatCnt);
    const movieNo=String(row.movieNo??row.rpstMovieNo??"");
    const playSchdlNo=String(row.playSchdlNo??"");
    if(!title||!hall||!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(start)||!Number.isFinite(rest)||!Number.isFinite(total)) return null;
    return {playDate:`${scnYmd.slice(0,4)}-${scnYmd.slice(4,6)}-${scnYmd.slice(6,8)}`,startTime:start,hallName:hall,movieTitle:title,movieNo,totalSeats:total,restSeats:rest,bookingUrl:playSchdlNo?`https://www.megabox.co.kr/booking`:undefined};
  }).filter(Boolean);
}
async function fetchMegabox(site, scnYmd){
  const body=new URLSearchParams({masterType:"brch",detailType:"movie",brchNo:site.brchNo,brchNo1:site.brchNo,brchNm:site.brchNm,firstAt:"N",crtDe:kstDateKeys(1)[0],playDe:scnYmd.replace(/-/g,"")}).toString();
  const r=await fetch("https://www.megabox.co.kr/on/oh/ohc/Brch/schedulePage.do",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded; charset=UTF-8","accept":"application/json, text/plain, */*","user-agent":"Mozilla/5.0 OpenBell-PC-Reporter/11.12"},body,signal:AbortSignal.timeout(15000)});
  const text=await r.text(); if(!r.ok) throw new Error(`MegaBox HTTP ${r.status}`);
  let json; try{json=JSON.parse(text.replace(/""/g,'"'));}catch{throw new Error("MegaBox JSON 응답 해석 실패");}
  const rows=parseMegaboxRows(json,scnYmd,site); log(`[${site.theaterName}] ${scnYmd} 메가박스 상영정보 ${r.status===200?'확인 성공':'확인 실패'} · ${rows.length}회차 확인`); return rows;
}
async function collectMegabox(theaterId){
  const site=ALL_SITES[theaterId],showtimes=[];
  for(const ymd of kstDateKeys(daysAhead)){
    try{const rows=await fetchMegabox(site,ymd); showtimes.push(...rows); setScheduleState(theaterId,showtimes); printScheduleChanges(theaterId,rows,"full");}
    catch(err){state.errors++;log(`[${theaterId}] ${ymd} 조회 실패: ${err.message||err}`);}
  }
  return showtimes;
}

async function collectTheater(theaterId){
  if(ALL_SITES[theaterId]?.chain==="megabox") return collectMegabox(theaterId);
  const site=ALL_SITES[theaterId],showtimes=[];
  for(const ymd of kstDateKeys(daysAhead)){
    try{
      const rows=await fetchCgvViaBrowser(site,ymd);
      cacheSchedule(theaterId,ymd,rows);
      showtimes.push(...rows);
      setScheduleState(theaterId, showtimes);
      printScheduleChanges(theaterId, rows, "full");
    }catch(err){
      state.errors++;
      log(`[${theaterId}] ${ymd} 조회 실패: ${err.message||err}`);
    }
  }
  return showtimes;
}
async function collectImaxFromCache(theaterId){
  const out=[];
  for(const ymd of kstDateKeys(daysAhead)){
    let rows=getCachedSchedule(theaterId,ymd);
    if(!rows){
      log(`[${theaterId}/imax] ${ymd} 전체 수집 캐시 없음 → 이번 IMAX 주기에서는 건너뜁니다.`);
      continue;
    }
    // API 응답에 IMAX/상영관 정보가 들어오는 경우를 우선 사용한다.
    let imax=rows.filter(r=>/imax|아이맥스/i.test(`${r.hallName} ${r.movieTitle}`));
    // 현재 searchMovScnInfo는 일부 필드에서 상영관 형식을 생략한다.
    // 이 경우 실제 CGV 화면에서 IMAX라고 표시된 회차의 시작시간/영화명을
    // 읽어 API 회차와 매칭한다. 실패해도 전체 수집 데이터는 그대로 보존한다.
    if(!imax.length){
      try{
        const p=await ensureBrowser();
        const dom=await extractImaxHintsFromDom(p,ymd);
        if(dom.length){
          const keys=new Set(dom.map(x=>`${x.startTime}|${x.movieTitle}`));
          imax=rows.filter(r=>keys.has(`${r.startTime}|${r.movieTitle}`));
          if(imax.length) log(`[${ALL_SITES[theaterId].theaterName}] ${ymd} 화면 IMAX 표시와 API 회차 ${imax.length}건 매칭`);
        }
      }catch{}
    }
    out.push(...imax);
  }
  markImaxState(theaterId,out);
  if(out.length) printScheduleChanges(theaterId,out,"imax");
  return out;
}
async function postReport(theaterId,showtimes,mode="full"){
  if(!showtimes.length){log(`[${theaterId}/${mode}] 보낼 상영회차가 없습니다.`);return;}
  const chunks=[]; for(let i=0;i<showtimes.length;i+=700) chunks.push(showtimes.slice(i,i+700));
  for(let i=0;i<chunks.length;i++){
    const chunkMode=mode==="full" && i>0 ? "merge" : mode;
    let lastErr=null;
    const payload={theaterId,mode:chunkMode,source:reportSource,showtimes:chunks[i]};
    if(gasSyncKey) payload.key=gasSyncKey;
    for(let attempt=1; attempt<=2; attempt++){
      try{
        const res=await fetch(`${OPENBELL_URL}/api/seat-report`,{
          method:"POST",
          headers:{
            authorization:`Bearer ${TOKEN}`,
            "content-type":"application/json",
            accept:"application/json",
            "user-agent":"openbell-reporter/11.26"
          },
          body:JSON.stringify(payload),
          signal:AbortSignal.timeout(15000)
        });
        const text=await res.text();
        if(!res.ok) throw new Error(`OpenBell 서버 오류 ${res.status}: ${text.slice(0,200)}`);
        state.counts[mode]=(state.counts[mode]||0)+chunks[i].length;
        lastErr=null;
        break;
      }catch(err){
        lastErr=err;
        log(`[${theaterId}/${mode}] 서버 전송 실패 (시도 ${attempt}/2): ${err.message||err}`);
        if(attempt<2) await new Promise(r=>setTimeout(r,800));
      }
    }
    for(const gasUrl of gasWebUrls){
      try{
        const gr=await postJsonPreserve(gasUrl,{"content-type":"application/json"},payload);
        const body=(gr.text||"").trim();
        if(!body.startsWith("{") && !body.startsWith("[")){
          log(`${ANSI.yellow}[GAS] HTML 응답${ANSI.reset} · 웹앱 설치(새 배포)를 했는지, 주소가 /exec 인지 확인 (${gasUrl.slice(-32)})`);
        } else {
          log(`${ANSI.green}[GAS 저장]${ANSI.reset} ${ALL_SITES[theaterId].theaterName} · ${gr.status} ${body.slice(0,140)}`);
        }
      }catch(gerr){
        log(`${ANSI.yellow}[GAS 전송 실패]${ANSI.reset} ${gerr.message||gerr} (${gasUrl.slice(-32)})`);
      }
    }
    if(lastErr){
      if(!gasWebUrls.length) throw lastErr;
      log(`[${theaterId}/${mode}] 베셀은 실패했지만 GAS ${gasWebUrls.length}곳 전송은 시도했습니다.`);
    }
  }
  const label=mode==="imax" ? "IMAX 좌석정보" : "전체 좌석정보";
  log(`${ANSI.green}[서버 저장 완료]${ANSI.reset} ${ALL_SITES[theaterId].theaterName} · ${label} ${showtimes.length}건 저장됨 (${chunks.length}회 전송)`);
  log(`${ANSI.gray}  ※ 베셀 저장 성공.`+(gasWebUrls.length?` GAS ${gasWebUrls.length}곳으로도 보냈습니다.`: ` GAS 주소가 없으면 전광판 G_PC/G_DS 칸은 안 채워집니다.`)+`${ANSI.reset}`);
}
async function fullTick(){
  if(state.running){log("[스케줄러] 전체 수집은 이전 작업이 끝난 뒤 실행합니다.");return;}
  pruneOldCaches();
  state.running=true;
  const targets = selectedTheaters.slice();
  state.queue = targets.length ? `병렬 수집 ${targets.length}곳` : "대기";
  log(`[스케줄러] 병렬 수집 시작 · ${targets.join(", ") || "없음"}`);
  try{
    // 4개 극장을 동시에 돌린다.
    // - 메가박스: 순수 HTTP → 진짜 병렬
    // - CGV: withBrowserLock 으로 Edge 한 창을 순차 공유 (안전)
    // 각 극장은 수집이 끝나는 즉시 서버로 POST 한다.
    const results = await Promise.allSettled(targets.map(async (id) => {
      const t0 = Date.now();
      try{
        const rows = await collectTheater(id);
        await postReport(id, rows, "full");
        log(`[${id}/full] 완료 · ${rows.length}회차 · ${((Date.now()-t0)/1000).toFixed(1)}s`);
        return {id, ok:true, count:rows.length};
      }catch(e){
        state.errors++;
        log(`[${id}/full] 실패: ${e.message||e}`);
        return {id, ok:false, error:String(e.message||e)};
      }
    }));
    const ok = results.filter(r => r.status==="fulfilled" && r.value?.ok).length;
    const fail = results.length - ok;
    state.lastFull = new Date().toISOString();
    log(`[스케줄러] 병렬 수집 종료 · 성공 ${ok} / 실패 ${fail}`);
  } finally {
    state.running=false;
    state.queue="대기";
  }
}
/* IMAX is part of the normal full scan. No separate IMAX timer or manual action exists. */

const html=`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="3"><title>OpenBell PC Reporter</title><style>
:root{color-scheme:dark}*{box-sizing:border-box}body{font-family:Segoe UI,Malgun Gothic,sans-serif;background:#090d16;color:#eef2f8;margin:0}.wrap{max-width:1320px;margin:0 auto;padding:22px}.card{background:#111827;border:1px solid #25324b;border-radius:16px;padding:18px;margin-bottom:14px;box-shadow:0 8px 28px #0005}.head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}.title{font-size:25px;font-weight:800}.sub{color:#94a3b8;font-size:13px;margin-top:5px}.grid{display:grid;grid-template-columns:repeat(5,1fr);gap:10px}.stat{background:#0d1422;border:1px solid #202b41;border-radius:12px;padding:13px}.label{color:#8fa0b8;font-size:11px}.value{font-size:21px;font-weight:800;margin-top:5px}.ok{color:#62e6a1}.warn{color:#ffd166}.bad{color:#ff6b7a}.toolbar{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}.toolbar select,.toolbar input{background:#0b1220;color:#e8edf5;border:1px solid #31405d;border-radius:9px;padding:9px 11px}.toolbar input{min-width:230px}.toolbar label{display:flex;align-items:center;gap:6px;color:#aab7cb;font-size:13px}button{border:0;border-radius:9px;padding:9px 13px;cursor:pointer;font-weight:800}button.primary{background:#e7edf7;color:#0a1020}button.secondary{background:#25324b;color:#e7edf7}.tablewrap{max-height:560px;overflow:auto;border:1px solid #25324b;border-radius:12px}table{width:100%;border-collapse:collapse;font-size:13px}th{position:sticky;top:0;background:#0d1422;color:#93a4bd;text-align:left;padding:10px;border-bottom:1px solid #2a3852}td{padding:9px 10px;border-bottom:1px solid #1d273a}tr.zero{background:#3a1820}tr.low{background:#342c14}tr.good{background:#10271d}.seat{font-weight:900;font-size:14px}.imax{color:#e879f9;font-weight:800}.muted{color:#8391a7}.pill{display:inline-block;padding:4px 8px;border-radius:99px;background:#202d46;margin:3px}.theaterCheck{display:flex;align-items:center;justify-content:center;gap:8px;background:#0d1422;border:2px solid #25324b;border-radius:12px;padding:16px 13px;color:#dbe4f2;font-size:14px;cursor:pointer;transition:background .12s,border-color .12s}.theaterCheck:hover{border-color:#5d769f;background:#141f34}.theaterCheck.selected{background:#18243a;border-color:#62e6a1}.theaterCheck.selected:hover{border-color:#7bf0b3}.theaterCheck:disabled{opacity:.6;cursor:wait}.theaterGrid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:12px}@media(max-width:820px){.theaterGrid{grid-template-columns:repeat(2,1fr)}}@media(max-width:480px){.theaterGrid{grid-template-columns:1fr}}.checkMark{width:18px;text-align:center;font-weight:900}.legend{display:flex;gap:14px;font-size:12px;color:#9aa9be;margin-top:9px}.dot{font-weight:800}.logs{height:210px;overflow:auto;background:#070b12;border-radius:10px;padding:11px;font:11px ui-monospace,Consolas,monospace;white-space:pre-wrap;color:#b9c4d6}.count{color:#9daac0;font-size:12px;margin-left:auto}.statusline{margin-top:12px}.mobileHide{}@media(max-width:900px){.grid{grid-template-columns:repeat(2,1fr)}.wrap{padding:12px}.tablewrap{max-height:500px}.mobileHide{display:none}}
.theaterBoard{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:6px}@media(max-width:1100px){.theaterBoard{grid-template-columns:repeat(2,1fr)}}@media(max-width:640px){.theaterBoard{grid-template-columns:1fr}}.theaterCol{min-width:0;background:#0d1422;border:1px solid #25324b;border-radius:12px;padding:12px;max-height:640px;overflow:auto}.theaterColHead{font-weight:800;font-size:14px;margin-bottom:9px;padding-bottom:7px;border-bottom:1px solid #223047;position:sticky;top:-12px;background:#0d1422}.showRow{border-radius:10px;padding:9px 10px;margin-bottom:7px;background:#0b1220}.showRow.zero{background:#2a1319}.showRow.low{background:#2a2410}.showRow.good{background:#0c2118}.showTop{display:flex;justify-content:space-between;align-items:center;font-size:13px}.showTop b{font-variant-numeric:tabular-nums}.showTop .imax{color:#e879f9;font-weight:800;font-size:11px}.showTitle{margin:3px 0;font-size:12px;font-weight:600}.showBottom{display:flex;justify-content:space-between;font-size:11px;color:#c4cfe0}
</style></head><body><div class="wrap">
<div class="card"><div class="head"><div><div class="title">🎬 OpenBell PC Reporter <span style="font-size:14px;color:#8fa0b8;font-weight:700">v11.26</span></div><div class="sub">CGV 실제 예매 화면 + 메가박스 상영정보 기반 · 좌석 수집 현황을 자동 감시합니다.</div></div><div id="browser" class="statusline">__SERVER_STATUS__</div></div></div>
<div class="card"><h3 style="margin:0 0 4px">감시 극장 선택 <span class="count" id="theaterCount2"></span></h3><div class="sub">아래 극장을 눌러서 켜고 끄세요. 클릭 즉시 저장됩니다.</div><div class="theaterGrid" id="theaterChecks"></div></div>
<div class="grid"><div class="stat"><div class="label">자동 감시 주기</div><div class="value">${INTERVAL_MS/1000}s</div></div><div class="stat"><div class="label">감시 극장</div><div class="value" id="theaterCount">${selectedTheaters.length}곳</div></div><div class="stat"><div class="label">수집 기간</div><div class="value" id="daysValue">${daysAhead}일</div></div><div class="stat"><div class="label">현재 표시 회차</div><div class="value" id="rows">__SERVER_ROWCOUNT__</div></div><div class="stat"><div class="label">누적 저장 회차</div><div class="value" id="count">__SERVER_COUNT__</div></div></div>
<div class="card"><div class="head"><div><h2 style="margin:0">상영시간 · 잔여석</h2><div class="sub">🟢 6석 이상 · 🟡 1~5석 · 🔴 매진 · 좌석이 줄면 ▼ 표시</div></div><div id="updated" class="count">__SERVER_UPDATED__</div></div>
<div class="card" style="margin:10px 0 0;padding:12px;border:1px dashed #31405d"><div class="sub" style="margin:0 0 8px">GAS 웹앱으로도 보내기 · 오픈벨 설정에 있는 <b>/exec</b> 주소를 붙여넣으세요. 여러 개면 쉼표.</div>
<div class="toolbar" style="margin:0"><input id="gasUrls" placeholder="https://script.google.com/macros/s/…/exec" style="flex:1;min-width:280px"><input id="gasKey" placeholder="GAS 동기화 키 (있으면)" style="min-width:160px"><button class="secondary" onclick="saveGas()">GAS 저장</button></div>
<div class="sub" id="gasHint" style="margin-top:6px">아직 GAS 주소가 없습니다. 저장하면 베셀과 동시에 보냅니다.</div></div>
<div class="toolbar"><label>서버 출처 <select id="sourceSelect"><option value="pc">G_PC</option><option value="nas423">G_DS423+</option><option value="nas225">G_DS225+</option></select></label><label>감시 기간 <select id="daysSelect">${DAY_OPTIONS.map(d=>'<option value="'+d+'"'+(d===daysAhead?' selected':'')+' >'+d+'일</option>').join('')}</select></label><select id="dateFilter"><option value="all">전체 날짜</option></select><input id="search" placeholder="영화명 / 관 검색"><button class="primary" onclick="run()">지금 전체 수집</button></div>
<div class="theaterBoard" id="theaterBoard"></div><div class="legend"><span class="dot" style="color:#62e6a1">● 여유</span><span class="dot" style="color:#ffd166">● 임박</span><span class="dot" style="color:#ff6b7a">● 매진</span><span class="dot" style="color:#e879f9">● IMAX</span><span id="action"></span></div></div>
<div class="card"><h3 style="margin:0 0 8px">자동 감시</h3><div class="sub" style="line-height:1.8">선택한 극장을 정해진 주기로 자동 수집하고 OpenBell 서버와 (있으면) GAS 웹앱으로 전송합니다. IMAX도 별도 메뉴 없이 전체 수집에 포함됩니다.</div></div><div class="card"><h3 style="margin:0 0 8px">용어 안내</h3><div class="sub" style="line-height:1.8"><b>좌석 수집</b> = CGV 화면에서 영화·시간·잔여석을 읽어오는 작업<br><b>서버 저장 완료</b> = 읽어온 좌석정보를 OpenBell 서버에 정상 저장했다는 뜻<br><b>200</b> = 서버가 데이터를 정상적으로 받았다는 HTTP 성공 응답입니다. <b>잔여석 200이 아닙니다.</b><br><b>▼ 숫자</b> = 이전 확인보다 좌석이 그만큼 줄었다는 뜻입니다.</div></div><div class="card"><h3 style="margin-top:0">최근 로그</h3><div id="logs" class="logs">__SERVER_LOGS__</div></div>
</div><script>
// 이 값은 서버(Node.js)가 페이지를 만들 때 직접 채워 넣는 것으로,
// 브라우저 쪽 코드가 서버 전용 변수를 잘못 참조하던 버그(극장 버튼이 반응 없던 원인)를 없앤다.
const ALL_SITES=${JSON.stringify(Object.fromEntries(THEATER_ORDER.map(id=>[id,{theaterName:ALL_SITES[id].theaterName}])))};
let latest=[];
function esc(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
let theaterSaveBusy=false;
let theaterUiState=new Map();
let lastTheaterChecksHtml='';
function renderTheaterChecks(s){const box=document.getElementById('theaterChecks');if(!box||theaterSaveBusy)return;const list=Array.isArray(s?.theaters)?s.theaters:[];theaterUiState=new Map(list.map(t=>[t.id,Boolean(t.selected)]));const html=theaterListHtml(list);if(html===lastTheaterChecksHtml)return;lastTheaterChecksHtml=html;box.innerHTML=html;}
function theaterListHtml(list){return list.map(t=>{const on=Boolean(t.selected);return '<button type="button" class="theaterCheck '+(on?'selected':'')+'" data-theater="'+esc(t.id)+'" aria-pressed="'+on+'"><span class="checkMark">'+(on?'✓':'○')+'</span><span>'+esc(t.name)+'</span></button>';}).join('');}
document.getElementById('theaterChecks')?.addEventListener('click',async(e)=>{const btn=e.target.closest?.('button[data-theater]');if(!(btn instanceof HTMLButtonElement)||theaterSaveBusy)return;const id=btn.dataset.theater;if(!id||!ALL_SITES[id])return;const next=new Map(theaterUiState);next.set(id,!Boolean(next.get(id)));const ids=[...next.entries()].filter(([,on])=>on).map(([theaterId])=>theaterId);theaterSaveBusy=true;btn.disabled=true;btn.classList.toggle('selected',Boolean(next.get(id)));btn.querySelector('.checkMark').textContent=next.get(id)?'✓':'○';document.getElementById('action').textContent='극장 설정 저장 중…';try{const r=await fetch(location.origin+'/api/theaters?ids='+encodeURIComponent(ids.join(',')),{method:'POST',cache:'no-store'});if(!r.ok)throw new Error('HTTP '+r.status);theaterUiState=next;document.getElementById('action').textContent='감시 극장 설정 저장됨';}catch(err){document.getElementById('action').textContent='극장 설정 저장 실패: '+(err?.message||err);}finally{theaterSaveBusy=false;btn.disabled=false;renderTheaterChecks({theaters:[...theaterUiState.entries()].map(([theaterId,selected])=>({id:theaterId,name:ALL_SITES[theaterId].theaterName,selected}))});}});
function refreshFilters(){const df=document.getElementById('dateFilter'),dv=df.value;const dates=[...new Set(latest.map(r=>r.playDate))].sort();df.innerHTML='<option value="all">전체 날짜</option>'+dates.map(d=>'<option value="'+esc(d)+'">'+esc(d)+'</option>').join('');if([...df.options].some(o=>o.value===dv))df.value=dv;}
let lastColHtml=new Map();
function render(){
  const df=document.getElementById('dateFilter').value,q=document.getElementById('search').value.trim().toLowerCase();
  let rows=latest.filter(r=>(df==='all'||r.playDate===df)&&(!q||(String(r.movieTitle)+' '+String(r.hallName)).toLowerCase().includes(q)));
  rows.sort((a,b)=>(String(a.playDate)+String(a.startTime)).localeCompare(String(b.playDate)+String(b.startTime)));
  document.getElementById('rows').textContent=latest.length+' / '+rows.length;
  const byTheater=new Map();for(const id of Object.keys(ALL_SITES))byTheater.set(id,[]);
  for(const r of rows){if(!byTheater.has(r.theaterId))byTheater.set(r.theaterId,[]);byTheater.get(r.theaterId).push(r);}
  const active=[...theaterUiState.entries()].filter(([,on])=>on).map(([id])=>id);
  const showIds=active.length?active:Object.keys(ALL_SITES);
  const board=document.getElementById('theaterBoard');
  const existingCols=new Map([...board.querySelectorAll('.theaterCol')].map(el=>[el.dataset.theater,el]));
  // showIds 순서/구성이 지난번과 같으면 컨테이너는 그대로 두고, 바뀐 칸의 내용만 교체한다.
  // (칸 자체를 새로 안 만들면 그 칸의 스크롤 위치가 저절로 유지된다.)
  const sameSet=existingCols.size===showIds.length && showIds.every(id=>existingCols.has(id));
  if(!sameSet){
    board.innerHTML=showIds.map(id=>'<div class="theaterCol" data-theater="'+esc(id)+'"><div class="theaterColHead">'+esc(ALL_SITES[id]?.theaterName||id)+'</div><div class="theaterColBody"></div></div>').join('');
  }
  for(const id of showIds){
    const list=(byTheater.get(id)||[]).slice(0,800);
    const bodyHtml=list.length?list.map(r=>{const n=Number(r.restSeats),cls=n===0?'zero':n<=5?'low':'good',status=n===0?'매진':n<=5?'잔여 적음':'잔여';const imax=r.imax||/imax|아이맥스/i.test((r.hallName||'')+' '+(r.movieTitle||''));return '<div class="showRow '+cls+'"><div class="showTop"><b>'+esc(r.startTime)+'</b><span class="'+(imax?'imax':'muted')+'">'+(imax?'IMAX':esc(r.hallName||''))+'</span></div><div class="showTitle">'+esc(r.movieTitle||'')+'</div><div class="showBottom"><b>'+esc(r.restSeats)+' / '+esc(r.totalSeats)+'석</b><span>'+status+' · '+esc((r.playDate||'').slice(5))+'</span></div></div>';}).join(''):'<div class="muted" style="padding:16px;text-align:center;font-size:12px">회차 없음</div>';
    if(lastColHtml.get(id)===bodyHtml) continue; // 이 칸은 내용이 안 바뀌었으니 손대지 않는다 → 스크롤 그대로 유지
    lastColHtml.set(id,bodyHtml);
    const col=document.getElementById('theaterBoard').querySelector('.theaterCol[data-theater="'+CSS.escape(id)+'"] .theaterColBody')
      || document.getElementById('theaterBoard').querySelector('.theaterCol[data-theater="'+CSS.escape(id)+'"]');
    if(col && col.classList?.contains('theaterColBody')) col.innerHTML=bodyHtml;
    else if(col){ let bodyEl=col.querySelector('.theaterColBody'); if(!bodyEl){bodyEl=document.createElement('div');bodyEl.className='theaterColBody';col.appendChild(bodyEl);} bodyEl.innerHTML=bodyHtml; }
  }
}
let refreshBusy=false, refreshFailStreak=0;
async function refresh(){
  if(refreshBusy) return; // 이전 요청이 아직 안 끝났으면 새로 쌓지 않는다(펜딩 누적 방지)
  refreshBusy=true;
  try{
    const apiBase=location.origin;
    const r=await fetch(apiBase+"/api/status?ts="+Date.now(),{cache:"no-store",credentials:"same-origin",signal:AbortSignal.timeout(5000)});
    if(!r.ok) throw new Error("HTTP "+r.status);
    const s=await r.json();
    refreshFailStreak=0;
    const theaterList=Array.isArray(s.theaters)?s.theaters:[];
    const theaterMap=new Map(theaterList.map(t=>[t.id,t.name]));
    latest=Object.entries(s.schedules||{}).flatMap(([theaterId,rows])=>Array.isArray(rows)?rows.map(row=>({...row,theaterId,theaterName:theaterMap.get(theaterId)||theaterId})):[]);
    document.getElementById('browser').innerHTML='GUI 서버 연결됨 · 브라우저: <b class="'+(s.browserReady?'ok':'warn')+'">'+(s.browserReady?'연결됨':'대기 중')+'</b> · 작업: <b>'+esc(s.queue||'대기')+'</b> · 오류 '+Number(s.errors||0);
    document.getElementById('theaterCount2').textContent='('+theaterList.filter(x=>x.selected).length+'곳 감시 중)';document.getElementById('theaterCount').textContent=theaterList.filter(x=>x.selected).length+'곳';renderTheaterChecks({theaters:theaterList});
    document.getElementById('count').textContent=Number(s.counts?.full||0)+Number(s.counts?.imax||0);
    document.getElementById('daysValue').textContent=(s.days||daysAhead)+'일';
    document.getElementById('daysSelect').value=String(s.days||daysAhead);try{document.getElementById('sourceSelect').value=String(s.source||'pc');}catch(e){}
    try{const urls=Array.isArray(s.gasWebUrls)?s.gasWebUrls:[]; const gasEl=document.getElementById('gasUrls'); if(gasEl && document.activeElement!==gasEl) gasEl.value=urls.join(', '); const keyEl=document.getElementById('gasKey'); if(keyEl && document.activeElement!==keyEl) keyEl.value=s.gasSyncKey||''; const hint=document.getElementById('gasHint'); if(hint) hint.textContent=urls.length?('GAS '+urls.length+'곳으로 전송 중'):'아직 GAS 주소가 없습니다. 저장하면 베셀과 동시에 보냅니다.';}catch(e){}
    document.getElementById('updated').textContent='마지막 전체: '+(s.lastFull?new Date(s.lastFull).toLocaleTimeString('ko-KR',{hour12:false}):'-')+' · IMAX: '+(s.lastImax?new Date(s.lastImax).toLocaleTimeString('ko-KR',{hour12:false}):'-');
    refreshFilters();render();
    document.getElementById('logs').textContent=Array.isArray(s.logs)?s.logs.join('\n'):'';
    const el=document.getElementById('logs');if(el.dataset.userScrolled!=='1') el.scrollTop=el.scrollHeight;
  }catch(e){
    refreshFailStreak++;
    const kind=e?.name==='TimeoutError'||e?.name==='AbortError'?'응답 없음(타임아웃)':(e?.message||e);
    document.getElementById('browser').innerHTML='<b class="bad">GUI 화면이 서버에 응답을 못 받고 있습니다</b> · '+esc(kind)+' · 재시도 '+refreshFailStreak+'회째 · 1.2초마다 자동 재시도 중';
  }finally{
    refreshBusy=false;
  }
}
async function saveGas(){const urls=document.getElementById('gasUrls').value; const key=document.getElementById('gasKey').value; document.getElementById('action').textContent='GAS 주소 저장 중…'; try{const r=await fetch(location.origin+'/api/gas?urls='+encodeURIComponent(urls)+'&key='+encodeURIComponent(key),{method:'POST',cache:'no-store'}); const j=await r.json(); document.getElementById('action').textContent=j.ok?('GAS '+((j.urls||[]).length)+'곳 저장됨'):('GAS 저장 실패');}catch(e){document.getElementById('action').textContent='GAS 저장 실패';} refresh();}
async function run(){document.getElementById('action').textContent='전체 즉시 수집 요청됨';await fetch(location.origin+'/api/run?mode=full',{method:'POST',cache:'no-store'});refresh()}
document.getElementById('daysSelect').addEventListener('change',async e=>{await fetch(location.origin+'/api/days?days='+encodeURIComponent(e.target.value),{method:'POST',cache:'no-store'});refresh();});document.getElementById('sourceSelect')?.addEventListener('change',async e=>{await fetch(location.origin+'/api/source?source='+encodeURIComponent(e.target.value),{method:'POST',cache:'no-store'});refresh();});document.getElementById('logs')?.addEventListener('scroll',e=>{const x=e.currentTarget;x.dataset.userScrolled=(x.scrollTop+x.clientHeight>=x.scrollHeight-4?'0':'1');});['dateFilter','search'].forEach(id=>{document.getElementById(id).addEventListener(id==='search'?'input':'change',render)});refresh();setInterval(refresh,2500); // meta refresh(3s)가 주 복구 경로. JS는 보조.
</script></body></html>`;
function htmlEsc(s){return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;", "'":"&#39;"}[m]));}
function serverDashboard(){
  const theaters=THEATER_ORDER.map(id=>({id,name:ALL_SITES[id].theaterName,selected:selectedTheaters.includes(id)}));
  const rows=Object.entries(state.schedules||{}).flatMap(([theaterId,rs])=>(Array.isArray(rs)?rs:[]).map(r=>({...r,theaterId,theaterName:ALL_SITES[theaterId]?.theaterName||theaterId})));
  rows.sort((a,b)=>(`${a.playDate}${a.startTime}${a.theaterId}`).localeCompare(`${b.playDate}${b.startTime}${b.theaterId}`));
  const byTheater=new Map();for(const id of THEATER_ORDER) byTheater.set(id,[]);
  for(const r of rows){ if(!byTheater.has(r.theaterId)) byTheater.set(r.theaterId,[]); byTheater.get(r.theaterId).push(r); }
  const showIds=(selectedTheaters.length?selectedTheaters:THEATER_ORDER);
  const boardHtml=showIds.map(id=>{
    const name=ALL_SITES[id]?.theaterName||id;
    const list=(byTheater.get(id)||[]).slice(0,800);
    const body=list.length?list.map(r=>{const n=Number(r.restSeats),cls=n===0?"zero":n<=5?"low":"good",status=n===0?"매진":n<=5?"잔여 적음":"잔여";const imax=r.imax||/imax|아이맥스/i.test(`${r.hallName||""} ${r.movieTitle||""}`);return `<div class="showRow ${cls}"><div class="showTop"><b>${htmlEsc(r.startTime||"")}</b><span class="${imax?'imax':'muted'}">${imax?'IMAX':htmlEsc(r.hallName||"")}</span></div><div class="showTitle">${htmlEsc(r.movieTitle||"")}</div><div class="showBottom"><b>${htmlEsc(r.restSeats)} / ${htmlEsc(r.totalSeats)}석</b><span>${status} · ${htmlEsc((r.playDate||"").slice(5))}</span></div></div>`}).join(""):'<div class="muted" style="padding:16px;text-align:center;font-size:12px">회차 없음</div>';
    return `<div class="theaterCol" data-theater="${htmlEsc(id)}"><div class="theaterColHead">${htmlEsc(name)}</div><div class="theaterColBody">${body}</div></div>`;
  }).join("");
  const status=`GUI 서버 실행됨 · 브라우저: <b class="${state.browserReady?'ok':'warn'}">${state.browserReady?'연결됨':'대기 중'}</b> · 작업: <b>${htmlEsc(state.queue||'대기')}</b> · 오류 ${Number(state.errors||0)}`;
  const updated=`마지막 전체: ${state.lastFull?new Date(state.lastFull).toLocaleTimeString('ko-KR',{hour12:false}):'-'}`;
  const count=Number(state.counts?.full||0);
  const logs=Array.isArray(state.logs)?state.logs.map(htmlEsc).join('\n'):'';
  const theaterButtonsHtml=theaters.map(t=>`<button type="button" class="theaterCheck ${t.selected?'selected':''}" data-theater="${htmlEsc(t.id)}" aria-pressed="${t.selected}"><span class="checkMark">${t.selected?'✓':'○'}</span><span>${htmlEsc(t.name)}</span></button>`).join('');
  const theaterCountLabel=`(${theaters.filter(x=>x.selected).length}곳 감시 중)`;
  return html.replace('__SERVER_STATUS__',status).replace('__SERVER_ROWCOUNT__',String(rows.length)).replace('__SERVER_COUNT__',String(count)).replace('__SERVER_UPDATED__',updated).replace('__SERVER_LOGS__',logs).replace('<span class="count" id="theaterCount2"></span>',`<span class="count" id="theaterCount2">${htmlEsc(theaterCountLabel)}</span>`).replace('<div class="theaterGrid" id="theaterChecks"></div>',`<div class="theaterGrid" id="theaterChecks">${theaterButtonsHtml}</div>`).replace('<div class="theaterBoard" id="theaterBoard"></div>',`<div class="theaterBoard" id="theaterBoard">${boardHtml}</div>`);
}
const server=http.createServer(async(req,res)=>{const u=new URL(req.url,`http://127.0.0.1:${GUI_PORT}`);if(u.pathname==="/"){res.writeHead(200,{"content-type":"text/html; charset=utf-8","cache-control":"no-store, no-cache, must-revalidate","pragma":"no-cache"});return res.end(serverDashboard());}if(u.pathname==="/api/status"){res.writeHead(200,{"content-type":"application/json; charset=utf-8"});return res.end(JSON.stringify({...state,guiPort:GUI_PORT,gasWebUrls,gasSyncKey,theaters:THEATER_ORDER.map(id=>({id,name:ALL_SITES[id].theaterName,siteNo:ALL_SITES[id].siteNo,selected:selectedTheaters.includes(id)}))}));}if(u.pathname==="/api/theaters"&&req.method==="POST"){const ids=(u.searchParams.get("ids")||"").split(",").filter(id=>ALL_SITES[id]);if(ids.length===0){selectedTheaters=[];state.theaters=[];savePcSettings();log(`[설정] 감시 극장: 없음`);res.writeHead(200,{"content-type":"application/json; charset=utf-8"});return res.end(JSON.stringify({ok:true,theaters:[]}));}selectedTheaters=[...new Set(ids)];state.theaters=selectedTheaters.slice();savePcSettings();log(`[설정] 감시 극장: ${selectedTheaters.join(", ")}`);res.writeHead(200,{"content-type":"application/json; charset=utf-8"});return res.end(JSON.stringify({ok:true,theaters:selectedTheaters}));}if(u.pathname==="/api/days"&&req.method==="POST"){const d=Number(u.searchParams.get("days"));if(!DAY_OPTIONS.includes(d)){res.writeHead(400);return res.end("invalid days");}daysAhead=d;state.days=d;savePcSettings();log(`[설정] 감시 기간 ${d}일로 변경`);res.writeHead(200,{"content-type":"application/json; charset=utf-8"});return res.end(JSON.stringify({ok:true,days:d}));}if(u.pathname==="/api/source"&&req.method==="POST"){const s=normalizeReportSource(u.searchParams.get("source"));if(!SOURCE_OPTIONS.includes(s)){res.writeHead(400);return res.end("invalid source");}reportSource=s;state.source=s;savePcSettings();log(`[설정] 서버 출처 → ${SOURCE_LABELS[s]||s}`);res.writeHead(200,{"content-type":"application/json; charset=utf-8"});return res.end(JSON.stringify({ok:true,source:s,label:SOURCE_LABELS[s]}));}if(u.pathname==="/api/gas"&&req.method==="POST"){gasWebUrls=parseGasUrls(u.searchParams.get("urls")||"");gasSyncKey=String(u.searchParams.get("key")||"").trim();savePcSettings();log(`[설정] GAS 웹앱 ${gasWebUrls.length}곳`+(gasSyncKey?" · 키 있음":""));if(gasWebUrls.length) gasWebUrls.forEach((g,i)=>log(`  GAS[${i+1}] ${g}`));res.writeHead(200,{"content-type":"application/json; charset=utf-8"});return res.end(JSON.stringify({ok:true,urls:gasWebUrls,hasKey:Boolean(gasSyncKey)}));}if(u.pathname==="/api/run"&&req.method==="POST"){res.writeHead(202);res.end("ok");fullTick();return;}res.writeHead(404);res.end();});
function openGui(){
  if(process.platform!=="win32"){log("[GUI] 원격 접속: http://<이 NAS/PC IP>:"+GUI_PORT+"  (브라우저에서 열기)");return;}
  const edge=edgePath();
  if(!edge){log("[GUI] Microsoft Edge를 찾지 못했습니다. 브라우저로 http://127.0.0.1:"+GUI_PORT+" 접속하세요.");return;}
  const guiProfile=path.join(process.env.LOCALAPPDATA||process.cwd(),"OpenBell",`GUIPersistentProfile_${process.pid}`);
  fs.mkdirSync(guiProfile,{recursive:true});
  const url=`http://127.0.0.1:${GUI_PORT}/`;
  // Use a fresh per-process profile and a normal Edge window rather than --app.
  // This avoids Edge app-mode/profile reuse issues on some Windows installations.
  const child=spawn(edge,[`--user-data-dir=${guiProfile}`,"--no-first-run","--no-default-browser-check","--disable-extensions","--new-window",url],{detached:true,windowsHide:false,stdio:"ignore"});
  child.unref();
  log(`[GUI] 전용 Edge 창 실행 · ${url}`);
}
async function listenGui(){
  for(let port=GUI_PORT_START;port<GUI_PORT_START+20;port++){
    GUI_PORT=port;
    try{
      await new Promise((resolve,reject)=>{
        const onError=err=>{server.removeListener("listening",onListening);reject(err);};
        const onListening=()=>{server.removeListener("error",onError);resolve();};
        server.once("error",onError);server.once("listening",onListening);server.listen(port,GUI_HOST);
      });
      log(`GUI: http://127.0.0.1:${GUI_PORT}`);
      if(GUI_HOST!=="127.0.0.1") log(`[GUI] LAN 원격 제어: http://<이 PC의 IP>:${GUI_PORT}`);
      if(GUI_PORT!==GUI_PORT_START) log(`[GUI] 기본 포트 ${GUI_PORT_START} 사용 중 → ${GUI_PORT}로 자동 변경했습니다.`);
      openGui();
      return;
    }catch(err){
      if(err?.code!=="EADDRINUSE") throw err;
    }
  }
  throw new Error(`GUI 포트 ${GUI_PORT_START}~${GUI_PORT_START+19}를 모두 사용할 수 없습니다.`);
}
if(!TOKEN){console.error("[오류] NAS_WORKER_TOKEN이 없습니다.");process.exit(1);}
// 극장 0개 선택도 허용(GUI에서 나중에 선택 가능). 시작 시 경고만 남긴다.
if(!selectedTheaters.length){log("[경고] 감시 극장이 없습니다. GUI에서 극장을 선택하세요.");}
log(`OpenBell 리포터 v${VERSION} 시작 · 서버 ${OPENBELL_URL}`+(gasWebUrls.length?` · GAS×${gasWebUrls.length}`:" · GAS 없음"));log(`대상: ${selectedTheaters.join(", ")} · 전체 ${INTERVAL_MS/1000}s · ${daysAhead}일 · 출처 ${SOURCE_LABELS[reportSource]||reportSource}`); if(gasWebUrls.length) gasWebUrls.forEach((g,i)=>log(`  GAS[${i+1}] ${g}`));
try{await listenGui();}catch(e){state.errors++;log(`[GUI] ${e.message||e}`);process.exit(1);}
try{await ensureBrowser();}catch(e){state.errors++;log(`[브라우저] ${e.message||e}`);}
await fullTick();setInterval(fullTick,INTERVAL_MS);
