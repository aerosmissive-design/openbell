import { ExternalLink } from "lucide-react";
import { type ReactNode, Fragment, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { authEnabled, signIn, signOut } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { extractKakaoCode, kakaoRedirectUri } from "@/lib/cinema/kakao";
import { currentGasScript, ensureGasSyncKey, forgetGasLink, gasHomeUrl, refreshGasMeta } from "@/lib/cinema/gas-provision";
import { GAS_SOURCE_STAMP } from "@/lib/cinema/gas-script";
import { pullGasMeta } from "@/lib/cinema/cloud";
import { probeGasHealth } from "@/lib/cinema/gas-health";
import { describeGasPush, flushSettings } from "./cloud-sync";
import { exchangeKakaoCode, peekTelegramChat, sendAlertEmail, sendKakaoMemo, sendTelegram } from "@/lib/cinema/scan";
import { sendReservationTest } from "@/lib/cinema/reservation-test";
import { THEATERS } from "@/lib/cinema/theaters";
import type { ScanResult, WatchConfig } from "@/lib/cinema/types";
import { mailEnabled, seatSourceLabel, timetableSourceLabel } from "@/lib/cinema/types";
import { THEME_MODES } from "@/lib/theme";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";
import { SettingsTheaterPicks } from "./theater-picks";

function sourceTimeLabel(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

export function SettingsView({ lastScan }: { lastScan: ScanResult | null }) {
  const config = useAppStore((s) => s.config);
  const setConfig = useAppStore((s) => s.setConfig);
  const pushAlerts = useAppStore((s) => s.pushAlerts);
  const { user } = useCurrentUserState();
  const loginEmail = user?.primaryEmail?.trim() ?? "";
  const [showStatus, setShowStatus] = useState(false);
  const [showMail, setShowMail] = useState(false);
  const [showKakao, setShowKakao] = useState(false);
  const [showTelegram, setShowTelegram] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const setTab = useAppStore((s) => s.setTab);
  const notifyHealth = useNotifyHealth(config);
  async function pushWatchWindow() { const gas = await flushSettings(Boolean(loginEmail)); const live = describeGasPush(gas); if (live) toast.success(live); }
  async function sendReservationChannelTest(channel: "mail" | "telegram" | "kakao") { setSendingTest(true); try { const result = await sendReservationTest({data:{channel,email:loginEmail||config.email,gmailAppPassword:config.gmailAppPassword,gasWebUrl:config.gasWebUrl||undefined,telegramToken:config.telegramToken,telegramChatId:config.telegramChatId,kakaoRestKey:config.kakaoRestKey,kakaoRefreshToken:config.kakaoRefreshToken}}); toast.success(`${result.count}개 극장의 실제 상영 회차로 테스트했습니다.`); } catch(err) { toast.error(err instanceof Error?err.message:"예매 알림 테스트 실패"); } finally { setSendingTest(false); } }
  return <div className="flex flex-col gap-6">
    <section className="rounded-xl bg-surface p-4 shadow-border"><CloudSettingsCard/></section>
    <section className="rounded-xl bg-surface p-4 shadow-border"><SettingsTheaterPicks onChange={()=>void pushWatchWindow()}/><div className="mt-4 border-t border-border pt-3"><button type="button" onClick={()=>setShowStatus(v=>!v)} className="flex min-h-11 w-full items-center justify-between text-left"><h2 className="text-xs font-medium tracking-[0.16em] text-muted">상영시간 및 잔여석 현황 출처</h2><span className="text-xs text-muted">{showStatus?"접기":"펼치기"}</span></button>{showStatus?<><p className="mt-2 text-sm leading-relaxed text-muted">상영시간과 잔여석 현황은 실제 조회에 사용된 출처와 시각을 표시합니다. 잔여석은 출처 우선순위가 아니라 같은 회차의 가장 최근 성공 조회값을 현재값으로 사용합니다.</p><div className="mt-4"><p className="font-medium text-fg">상영시간 출처</p><div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-sm"><p className="text-xs text-muted">극장</p><p className="text-xs text-muted">극장 현황</p>{THEATERS.map(theater=>{const row=lastScan?.theaters.find(t=>t.theaterId===theater.id);return <Fragment key={theater.id}><p className="text-fg">{theater.shortName}</p><p className="text-muted">{timetableSourceLabel(row?.source??"",row?.ok??true)}</p></Fragment>})}</div></div><div className="mt-5"><p className="font-medium text-fg">잔여석 현황 출처</p><p className="mt-1 text-muted">각 출처에서 마지막으로 성공적으로 들어온 조회시각입니다. 극장별 가장 최근 시각은 빨간색으로 표시합니다.</p><div className="mt-3 overflow-x-auto rounded-lg ring-1 ring-border"><table className="w-full min-w-[640px] text-sm"><thead><tr className="border-b border-border bg-bg"><th className="px-3 py-2 text-left text-xs font-medium text-muted">극장</th>{[["official","공홈"],["nas","NAS"],["kt","KT"],["relay","CGV 우회조회"],["gas","GAS"]].map(([key,label])=><th key={key} className="px-3 py-2 text-left text-xs font-medium text-muted">{label}</th>)}</tr></thead><tbody>{THEATERS.map(theater=>{const sourceTimes=(lastScan as (ScanResult&{seatSourceTimes?:Record<string,Record<string,string>>})|null)?.seatSourceTimes;const times=sourceTimes?.[theater.id]??{};const entries=(["official","nas","kt","relay","gas"] as const).map(key=>({key,value:times[key],at:times[key]?new Date(times[key]!).getTime():0}));const latestAt=Math.max(0,...entries.map(e=>e.at));return <tr key={theater.id} className="border-b border-border"><th className="whitespace-nowrap px-3 py-2 text-left font-medium text-fg">{theater.shortName}</th>{entries.map(e=><td key={e.key} className={cn("whitespace-nowrap px-3 py-2 tabular-nums text-muted",e.at>0&&e.at===latestAt?"text-danger font-medium":"")}>{sourceTimeLabel(e.value)}</td>)}</tr>})}</tbody></table></div></div></>:null}</div></section>
    <section className="rounded-xl bg-surface p-4 shadow-border"><h2 className="text-xs font-medium tracking-[0.16em] text-muted">알림 설정</h2><AlertPathStatus health={notifyHealth}/><ChannelCard title="메일로 받기" summary={!user?"로그인 필요":mailEnabled(config)?"연결됨":"꺼짐"} open={showMail} onToggle={()=>setShowMail(v=>!v)}><Button disabled={sendingTest} onClick={()=>void sendReservationChannelTest("mail")}>예매 알림 테스트</Button></ChannelCard><ChannelCard title="카톡으로 받기" summary={config.kakaoRefreshToken?"연결됨":"꺼짐"} open={showKakao} onToggle={()=>setShowKakao(v=>!v)}><Button onClick={()=>toast.info("카카오 연결 기능은 기존 설정을 사용하세요.")}>연결 확인</Button></ChannelCard><ChannelCard title="텔레그램으로 받기" summary={config.telegramToken&&config.telegramChatId?"연결됨":"꺼짐"} open={showTelegram} onToggle={()=>setShowTelegram(v=>!v)}><p className="text-sm text-muted">텔레그램 연결 상태입니다.</p></ChannelCard></section>
  </div>;
}
function ChannelCard({title,summary,open,onToggle,children}:{title:string;summary:string;open:boolean;onToggle:()=>void;children:ReactNode}){return <div className="border-t border-border pt-3"><button type="button" onClick={onToggle} className="flex min-h-11 w-full items-center justify-between text-left"><span><span className="text-xs font-medium tracking-[0.16em] text-muted">{title}</span><span className="mt-1 block text-sm text-fg">{summary}</span></span><span className="text-xs text-muted">{open?"접기":"펼치기"}</span></button>{open?<div className="mt-3">{children}</div>:null}</div>}
function CloudSettingsCard(){const {user}=useCurrentUserState();return <div><h2 className="text-xs font-medium tracking-[0.16em] text-muted">계정</h2>{user?<p className="mt-2 text-sm text-fg">{user.displayName??user.primaryEmail??"로그인됨"}</p>:<Link to="/login" className="mt-3 flex min-h-11 items-center justify-center rounded-md bg-pick text-sm text-fg">로그인</Link>}</div>}
type AliveProbe={reachable:boolean;alive:boolean;ageMs:number|null;githubWakeAlive?:boolean;externalWakeAlive?:boolean;lastNotify:{at?:number;mail?:string;telegram?:string;kakao?:string}|null};type CgvRelayHealth={stale:boolean;durationMs:number;theaters:string[]};type NotifyHealth={vercel:AliveProbe;gasOk:boolean;gasAlive:boolean;gasAgeMs:number;gasNotify:AliveProbe["lastNotify"];dbLine:string;cgvRelay:CgvRelayHealth|null};const emptyProbe:AliveProbe={reachable:false,alive:false,ageMs:null,lastNotify:null};
async function probeWatchAlive(url:string):Promise<AliveProbe>{try{const res=await fetch(url,{signal:AbortSignal.timeout(8000)});if(!res.ok)return emptyProbe;const json=await res.json() as any;return{reachable:true,alive:Boolean(json.alive),ageMs:typeof json.ageMs==="number"?json.ageMs:null,githubWakeAlive:Boolean(json.githubWakeAlive),externalWakeAlive:Boolean(json.externalWakeAlive),lastNotify:json.lastNotify??null};}catch{return emptyProbe}}
function useNotifyHealth(config:WatchConfig):NotifyHealth{const[health,setHealth]=useState<NotifyHealth>({vercel:emptyProbe,gasOk:false,gasAlive:false,gasAgeMs:0,gasNotify:null,dbLine:"pending",cgvRelay:null});useEffect(()=>{let cancelled=false;async function load(){const vercel=await probeWatchAlive("/api/watch-alive");if(cancelled)return;setHealth(h=>({...h,vercel}));}void load();const timer=window.setInterval(()=>void load(),20000);return()=>{cancelled=true;window.clearInterval(timer)}},[]);return health}
function AlertPathStatus({health}:{health:NotifyHealth}){return <div className="mt-3 rounded-lg bg-bg px-3 py-2.5 text-sm text-muted ring-1 ring-border">알림 경로: {health.vercel.reachable?"베셀 서버 확인됨":"확인 중"}</div>}
function relayOutageLine(watch:CgvRelayHealth){return `CGV 우회조회가 ${Math.max(1,Math.round(watch.durationMs/60000))}분째 지연되고 있습니다.`}
