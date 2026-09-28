import { ExternalLink } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import { extractKakaoCode, kakaoRedirectUri } from "@/lib/cinema/kakao";
import { exchangeKakaoCode, peekTelegramChat, sendAlertEmail, sendGasTest, sendKakaoMemo, sendTelegram } from "@/lib/cinema/scan";
import { sendReservationTest } from "@/lib/cinema/reservation-test";
import { mailEnabled } from "@/lib/cinema/types";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { useAppStore } from "@/lib/store";
import { describeGasPush, flushSettings } from "./cloud-sync";
import { GasBackupMailField } from "./gas-backup-mail";
import { Button } from "./ui/button";

function ChannelCard({ title, summary, open, onToggle, children }: { title: string; summary: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className="border-t border-border pt-3">
      <button type="button" onClick={onToggle} className="flex min-h-11 w-full items-center justify-between gap-3 text-left">
        <div className="min-w-0">
          <h2 className="text-xs font-medium tracking-[0.16em] text-muted">{title}</h2>
          <p className="mt-1 text-sm text-fg">{summary}</p>
        </div>
        <span className="shrink-0 text-xs text-muted">{open ? "접기" : "펼치기"}</span>
      </button>
      {open ? <div className="mt-3 border-t border-border pt-3">{children}</div> : null}
    </div>
  );
}

export function NotifyChannelCards() {
  const config = useAppStore((s) => s.config);
  const setConfig = useAppStore((s) => s.setConfig);
  const pushAlerts = useAppStore((s) => s.pushAlerts);
  const { user } = useCurrentUserState();
  const loginEmail = user?.primaryEmail?.trim() ?? "";
  const [showMail, setShowMail] = useState(!user);
  const [showKakao, setShowKakao] = useState(false);
  const [showTelegram, setShowTelegram] = useState(() => Boolean(useAppStore.getState().config.telegramToken || useAppStore.getState().config.telegramChatId));
  const [kakaoCode, setKakaoCode] = useState("");
  const [redirectUri, setRedirectUri] = useState("");
  const [sendingTest, setSendingTest] = useState(false);
  useEffect(() => setRedirectUri(kakaoRedirectUri()), []);

  async function sendTestMail() {
    const email = (loginEmail || config.email).trim();
    if (!email) { toast.error("알림 받을 메일을 적으세요."); return; }
    if (!config.gasWebUrl.trim() && !config.gmailAppPassword.trim()) { toast.error("구글스크립트 웹앱 주소를 먼저 연결하세요."); return; }
    setSendingTest(true);
    try {
      setConfig({ email, emailNotify: true });
      const gas = await flushSettings(Boolean(loginEmail));
      if (config.gasWebUrl.trim()) {
        await sendGasTest({ data: { url: config.gasWebUrl.trim(), op: "test", subject: "[오픈벨] 연결 테스트" } });
        pushAlerts([{ id: `alert:test:${Date.now()}`, createdAt: new Date().toISOString(), kind: "open", title: "[오픈벨] 연결 테스트", body: `${email}로 구글스크립트가 테스트 메일을 보냈습니다.`, bookingUrl: "https://m.megabox.co.kr/booking", theaterId: "megabox_coex", movieTitle: "오픈벨", playDate: "", startTime: "", hallName: "연결 테스트", formats: [], restSeats: null }]);
        const live = describeGasPush(gas);
        toast.success(live ? `${email}로 보냈습니다. ${live}` : `${email}로 구글스크립트가 테스트 메일을 보냈습니다.`);
        return;
      }
      const result = await sendAlertEmail({ data: { to: email, subject: "[오픈벨] 연결 테스트", text: "오픈벨 메일 연결이 됐습니다. 예매가 열리면 이 주소로 보냅니다.", url: "https://m.megabox.co.kr/booking", gasWebUrl: config.gasWebUrl || undefined, gmailAppPassword: config.gmailAppPassword || undefined } });
      toast.success(result.needsConfirm ? "첫 메일은 확인 링크입니다. 받은편지함에서 한 번만 눌러 주세요." : `${email}로 보냈습니다.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "보내기에 실패했습니다.");
    } finally {
      setSendingTest(false);
    }
  }

  async function sendChannelPing(channel: "kakao" | "telegram") {
    setSendingTest(true);
    try {
      if (channel === "kakao") {
        await sendKakaoMemo({ data: { restKey: config.kakaoRestKey, refreshToken: config.kakaoRefreshToken, text: "오픈벨 카톡 연결 테스트입니다. 예매가 열리면 여기로 옵니다." } });
        toast.success("나와의 채팅을 확인해 보세요.");
        return;
      }
      await sendTelegram({ data: { token: config.telegramToken, chatId: config.telegramChatId, text: "오픈벨 연결 테스트입니다." } });
      toast.success("텔레그램 테스트 전송");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "보내기에 실패했습니다.");
    } finally {
      setSendingTest(false);
    }
  }

  async function sendReservationChannelTest(channel: "mail" | "telegram" | "kakao") {
    if (channel === "mail") {
      if (!(loginEmail || config.email).trim()) { toast.error("알림 받을 메일을 적으세요."); return; }
      if (!mailEnabled(config) && !config.gasWebUrl.trim() && !config.gmailAppPassword.trim()) { toast.error("구글스크립트 웹앱을 먼저 연결하세요."); return; }
    }
    if (channel === "telegram" && (!config.telegramToken.trim() || !config.telegramChatId.trim())) { toast.error("텔레그램 봇 토큰과 채팅 ID를 먼저 넣으세요."); return; }
    if (channel === "kakao" && (!config.kakaoRestKey.trim() || !config.kakaoRefreshToken.trim())) { toast.error("카카오를 먼저 연결하세요."); return; }
    setSendingTest(true);
    try {
      const result = await sendReservationTest({ data: { channel, email: loginEmail || config.email, gmailAppPassword: config.gmailAppPassword, gasWebUrl: config.gasWebUrl || undefined, telegramToken: config.telegramToken, telegramChatId: config.telegramChatId, kakaoRestKey: config.kakaoRestKey, kakaoRefreshToken: config.kakaoRefreshToken } });
      const now = new Date().toISOString();
      pushAlerts(result.theaters.map((show, i) => ({ id: `alert:test-reservation:${show.theaterId}:${Date.now()}:${i}`, createdAt: now, kind: "open" as const, title: `${show.movieTitle} 예매 오픈`, body: [show.theaterId, show.playDate, show.startTime, show.hallName].filter(Boolean).join(" · "), bookingUrl: show.bookingUrl, theaterId: show.theaterId, movieTitle: show.movieTitle, playDate: show.playDate, startTime: show.startTime, hallName: show.hallName, formats: [], restSeats: null })));
      toast.success(result.count >= 4 ? "4개 극장 실제 회차로 보냈습니다. 「바로 예매」가 열리면 실제 오픈 알림도 같은 길입니다." : `${result.count}개 극장 실제 회차로 보냈습니다.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "예매 알림 테스트 실패");
    } finally {
      setSendingTest(false);
    }
  }

  return (
    <>
      <ChannelCard title="메일로 받기" summary={config.email.trim() ? `예비 · ${config.email}` : "로그인 없이 예비 가능"} open={showMail} onToggle={() => setShowMail((v) => !v)}>
        <p className="text-sm leading-relaxed text-muted">Neon이 죽어도 구글스크립트가 이 주소로 메일을 보냅니다.</p>
        <GasBackupMailField />
        <Button className="mt-3 w-full bg-black text-white ring-0 hover:bg-black" disabled={sendingTest || !config.email.trim()} onClick={() => void sendTestMail()}>{sendingTest ? "보내는 중…" : "테스트하기"}</Button>
        <Button variant="outline" className="mt-2 w-full" disabled={sendingTest || !config.email.trim()} onClick={() => void sendReservationChannelTest("mail")}>{sendingTest ? "보내는 중…" : "4개극장 랜덤 예매테스트보내기"}</Button>
      </ChannelCard>
      <ChannelCard title="카톡으로 받기" summary={config.kakaoRefreshToken ? "연결됨" : "꺼짐"} open={showKakao} onToggle={() => setShowKakao((v) => !v)}>
        <label className="block text-xs text-muted">REST API 키</label>
        <input value={config.kakaoRestKey} onChange={(e) => setConfig({ kakaoRestKey: e.target.value })} className="mt-1.5 h-11 w-full rounded-md bg-bg px-3 text-sm text-fg outline-none ring-1 ring-border" />
        <Button variant="outline" className="mt-3 w-full" onClick={() => { const key = config.kakaoRestKey.trim(); if (!key) { toast.error("REST API 키를 먼저 붙여넣으세요."); return; } window.open(`https://kauth.kakao.com/oauth/authorize?client_id=${encodeURIComponent(key)}&redirect_uri=${encodeURIComponent(kakaoRedirectUri() || redirectUri)}&response_type=code&scope=talk_message`, "_blank", "noopener,noreferrer"); }}>카카오 허용 열기 <ExternalLink className="size-3.5" /></Button>
        <input value={kakaoCode} onChange={(e) => setKakaoCode(e.target.value)} placeholder="인가 코드" className="mt-3 h-11 w-full rounded-md bg-bg px-3 text-sm text-fg outline-none ring-1 ring-border" />
        <Button className="mt-3 w-full bg-black text-white ring-0 hover:bg-black" onClick={async () => { try { const result = await exchangeKakaoCode({ data: { restKey: config.kakaoRestKey, code: extractKakaoCode(kakaoCode), redirectUri: kakaoRedirectUri() || redirectUri } }); setConfig({ kakaoRefreshToken: result.refreshToken }); setKakaoCode(""); toast.success("카카오가 연결되었습니다."); } catch (err) { toast.error(err instanceof Error ? err.message : "카카오 연결 실패"); } }}>카카오 연결</Button>
        <Button variant="outline" className="mt-2 w-full" disabled={sendingTest || !config.kakaoRefreshToken} onClick={() => void sendChannelPing("kakao")}>{sendingTest ? "보내는 중…" : "테스트하기"}</Button>
        <Button variant="outline" className="mt-2 w-full" disabled={sendingTest || !config.kakaoRefreshToken} onClick={() => void sendReservationChannelTest("kakao")}>{sendingTest ? "보내는 중…" : "4개극장 랜덤 예매테스트보내기"}</Button>
      </ChannelCard>
      <ChannelCard title="텔레그램으로 받기" summary={config.telegramToken && config.telegramChatId ? "연결됨" : "꺼짐"} open={showTelegram} onToggle={() => setShowTelegram((v) => !v)}>
        <label className="block text-xs text-muted">봇 토큰</label>
        <input value={config.telegramToken} onChange={(e) => setConfig({ telegramToken: e.target.value })} className="mt-1.5 h-11 w-full rounded-md bg-bg px-3 text-sm text-fg outline-none ring-1 ring-border" />
        <label className="mt-3 block text-xs text-muted">채팅 ID</label>
        <input value={config.telegramChatId} onChange={(e) => setConfig({ telegramChatId: e.target.value })} className="mt-1.5 h-11 w-full rounded-md bg-bg px-3 text-sm text-fg outline-none ring-1 ring-border" />
        <Button variant="outline" className="mt-3 w-full" onClick={async () => { try { const hit = await peekTelegramChat({ data: { token: config.telegramToken } }); setConfig({ telegramChatId: hit.chatId }); toast.success("채팅 ID를 넣었습니다."); } catch (err) { toast.error(err instanceof Error ? err.message : "찾지 못했습니다."); } }}>채팅 ID 찾기</Button>
        <Button variant="outline" className="mt-2 w-full" disabled={sendingTest || !config.telegramToken.trim() || !config.telegramChatId.trim()} onClick={() => void sendChannelPing("telegram")}>{sendingTest ? "보내는 중…" : "테스트하기"}</Button>
        <Button variant="outline" className="mt-2 w-full" disabled={sendingTest || !config.telegramToken.trim() || !config.telegramChatId.trim()} onClick={() => void sendReservationChannelTest("telegram")}>{sendingTest ? "보내는 중…" : "4개극장 랜덤 예매테스트보내기"}</Button>
      </ChannelCard>
    </>
  );
}
