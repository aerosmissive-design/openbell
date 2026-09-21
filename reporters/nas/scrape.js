// 오픈벨 NAS 잔여석 리포터: 집 인터넷으로 CGV 공홈 잔여석을 읽어 서버에 전송합니다.
const fs=require("fs"),path=require("path");
loadEnvFile(path.join(__dirname,"config.env")); loadEnvFile(path.join(process.cwd(),"config.env"));
const OPENBELL_URL=(process.env.OPENBELL_URL||"https://openbell-fawn.vercel.app").replace(/\/$/,"");
const TOKEN=process.env.NAS_REPORT_TOKEN||process.env.NAS_WORKER_TOKEN||"";
const GAS_WEB_URL=(process.env.GAS_WEB_URL||process.env.OPENBELL_GAS_URL||"").replace(/\/$/,"");
const GAS_SYNC_KEY=process.env.GAS_SYNC_KEY||process.env.GAS_REPORT_KEY||"";
const REPORT_SOURCE=(process.env.REPORT_SOURCE||"nas423").trim().toLowerCase();
const INTERVAL_MS=Number(process.env.INTERVAL_MS||60000), IMAX_INTERVAL_MS=Number(process.env.IMAX_INTERVAL_MS||30000), DAYS=Math.min(Math.max(Number(process.env.DAYS||2),1),7);
const ALL_SITES={cgv_yongsan:{siteNo:"0013"},cgv_yeongdeungpo:{siteNo:"0059"}};
const THEATERS=(process.env.THEATERS||"cgv_yongsan,cgv_yeongdeungpo").split(",").map(s=>s.trim()).filter(id=>ALL_SITES[id]);
function loadEnvFile(file){try{if(!fs.existsSync(file))return;for(const raw of fs.readFileSync(file,"utf8").split(/\r?\n/)){const line=raw.trim();if(!line||line.startsWith("#"))continue;const eq=line.indexOf("=");if(eq<1)continue;const k=line.slice(0,eq).trim(),v=line.slice(eq+1).trim();if(!process.env[k])process.env[k]=v.replace(/^['"]|['"]$/g,"");}}catch{}}
function dates(n){const out=[],now=new Date(Date.now()+9*3600000);for(let i=0;i<n;i++){const d=new Date(now);d.setUTCDate(d.getUTCDate()+i);out.push(`${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,"0")}${String(d.getUTCDate()).padStart(2,"0")}`)}return out}
function isImax(id,h){const x=String(h||"").toUpperCase().replace(/\s+/g,"");return x.includes("IMAX")||(id==="cgv_yongsan"&&/(^|[^\d])20관/.test(x));}
async function fetchRows(site,ymd){const u=`https://api.cgv.co.kr/cnm/atkt/searchMovScnInfo?coCd=A420&siteNo=${site}&scnYmd=${ymd}&rtctlScopCd=08`;const r=await fetch(u,{headers:{accept:"application/json, text/plain, */*",origin:"https://cgv.co.kr",referer:"https://cgv.co.kr/"},signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error(`HTTP ${r.status}`);const j=await r.json(),rows=j.data??j.body??[],seen=new Set(),out=[];for(const x of rows){const title=String(x.movNm||x.movieName||"").trim(),hall=String(x.scrnNm||x.scnNm||x.soundTypNm||x.scnsrtNm||"").trim(),raw=String(x.scnsrtTm||x.startTime||""),time=raw.length===4?`${raw.slice(0,2)}:${raw.slice(2)}`:raw,rest=Number(x.frSeatCnt),total=Number(x.stcnt);if(!title||!hall||!/^(\d{2}):(\d{2})$/.test(time)||!Number.isFinite(rest))continue;const k=`${ymd}|${time}|${hall}|${title}`;if(seen.has(k))continue;seen.add(k);out.push({playDate:`${ymd.slice(0,4)}-${ymd.slice(4,6)}-${ymd.slice(6,8)}`,startTime:time,hallName:hall,movieTitle:title,movieNo:String(x.movNo??x.movieNo??x.movieCode??""),restSeats:rest,totalSeats:Number.isFinite(total)?total:rest})}return out}
async function collect(id){const out=[];for(const d of dates(DAYS)){try{out.push(...await fetchRows(ALL_SITES[id].siteNo,d))}catch(e){console.log(`[${id}] ${d} 실패`,e.message)}}return out}
async function send(id,rows,mode){
  if(!rows.length)return;
  const payload={theaterId:id,mode,source:REPORT_SOURCE||"nas423",showtimes:rows};
  if(GAS_SYNC_KEY)payload.key=GAS_SYNC_KEY;
  if(TOKEN){
    try{
      const r=await fetch(`${OPENBELL_URL}/api/seat-report`,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${TOKEN}`},body:JSON.stringify(payload),signal:AbortSignal.timeout(20000)});
      console.log(`[${id}] Vercel ${mode} ${rows.length}건 -> ${r.status} ${await r.text()}`);
    }catch(e){console.log(`[${id}] Vercel 실패`,e.message||e)}
  }else console.log("NAS_REPORT_TOKEN 없음");
  if(GAS_WEB_URL){
    try{
      const r=await fetch(GAS_WEB_URL,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload),signal:AbortSignal.timeout(20000)});
      console.log(`[${id}] GAS ${mode} ${rows.length}건 -> ${r.status} ${await r.text()}`);
    }catch(e){console.log(`[${id}] GAS 실패`,e.message||e)}
  }
}if(!rows.length)return;const r=await fetch(`${OPENBELL_URL}/api/seat-report`,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${TOKEN}`},body:JSON.stringify({theaterId:id,mode,showtimes:rows})});console.log(`[${id}] ${mode} ${rows.length}건 -> ${r.status} ${await r.text()}`)}
async function full(){for(const id of THEATERS)await send(id,await collect(id),"full")}
async function imax(){for(const id of THEATERS)await send(id,(await collect(id)).filter(x=>isImax(id,x.hallName)),"imax")}
console.log(`오픈벨 NAS 리포터 시작: ${OPENBELL_URL}`+(GAS_WEB_URL?` + GAS`:``));full();setInterval(full,Math.max(15000,INTERVAL_MS));if(IMAX_INTERVAL_MS<INTERVAL_MS)setInterval(imax,Math.max(15000,IMAX_INTERVAL_MS));
