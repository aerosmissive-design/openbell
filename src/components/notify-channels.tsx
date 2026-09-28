import { ExternalLink } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import { extractKakaoCode, kakaoRedirectUri } from "@/lib/cinema/kakao";
import { exchangeKakaoCode, peekTelegramChat } from "@/lib/cinema/scan";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { useAppStore } from "@/lib/store";
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
  const { user } = useCurrentUserState();
  const [showMail, setShowMail] = useState(!user);
  const [showKakao, setShowKakao] = useState(false);
  const [showTelegram, setShowTelegram] = useState(() =>
    Boolean(useAppStore.getState().config.telegramToken || useAppStore.getState().config.telegramChatId),
  );
  const [kakaoCode, setKakaoCode] = useState("");
  const [redirectUri, setRedirectUri] = useState("");
  useEffect(() => setRedirectUri(kakaoRedirectUri()), []);

  return (
    <>
      <ChannelCard title="메일로 받기" summary={config.email.trim() ? `예비 · ${config.email}` : "로그인 없이 예비 가능"} open={showMail} onToggle={() => setShowMail((v) => !v)}>
        <p className="text-sm leading-relaxed text-muted">Neon이 죽어도 구글스크립트가 이 주소로 메일을 보냅니다.</p>
        <GasBackupMailField />
      </ChannelCard>
      <ChannelCard title="카톡으로 받기" summary={config.kakaoRefreshToken ? "연결됨" : "꺼짐"} open={showKakao} onToggle={() => setShowKakao((v) => !v)}>
        <label className="block text-xs text-muted">REST API 키</label>
        <input value={config.kakaoRestKey} onChange={(e) => setConfig({ kakaoRestKey: e.target.value })} className="mt-1.5 h-11 w-full rounded-md bg-bg px-3 text-sm text-fg outline-none ring-1 ring-border" />
        <Button variant="outline" className="mt-3 w-full" onClick={() => {
          const key = config.kakaoRestKey.trim();
          if (!key) { toast.error("REST API 키를 먼저 붙여넣으세요."); return; }
          window.open(`https://kauth.kakao.com/oauth/authorize?client_id=${encodeURIComponent(key)}&redirect_uri=${encodeURIComponent(kakaoRedirectUri() || redirectUri)}&response_type=code&scope=talk_message`, "_blank", "noopener,noreferrer");
        }}>
          카카오 허용 열기 <ExternalLink className="size-3.5" />
        </Button>
        <input value={kakaoCode} onChange={(e) => setKakaoCode(e.target.value)} placeholder="인가 코드" className="mt-3 h-11 w-full rounded-md bg-bg px-3 text-sm text-fg outline-none ring-1 ring-border" />
        <Button className="mt-3 w-full" onClick={async () => {
          try {
            const result = await exchangeKakaoCode({ data: { restKey: config.kakaoRestKey, code: extractKakaoCode(kakaoCode), redirectUri: kakaoRedirectUri() || redirectUri } });
            setConfig({ kakaoRefreshToken: result.refreshToken });
            setKakaoCode("");
            toast.success("카카오가 연결되었습니다.");
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "카카오 연결 실패");
          }
        }}>카카오 연결</Button>
      </ChannelCard>
      <ChannelCard title="텔레그램으로 받기" summary={config.telegramToken && config.telegramChatId ? "연결됨" : "꺼짐"} open={showTelegram} onToggle={() => setShowTelegram((v) => !v)}>
        <label className="block text-xs text-muted">봇 토큰</label>
        <input value={config.telegramToken} onChange={(e) => setConfig({ telegramToken: e.target.value })} className="mt-1.5 h-11 w-full rounded-md bg-bg px-3 text-sm text-fg outline-none ring-1 ring-border" />
        <label className="mt-3 block text-xs text-muted">채팅 ID</label>
        <input value={config.telegramChatId} onChange={(e) => setConfig({ telegramChatId: e.target.value })} className="mt-1.5 h-11 w-full rounded-md bg-bg px-3 text-sm text-fg outline-none ring-1 ring-border" />
        <Button variant="outline" className="mt-3 w-full" onClick={async () => {
          try {
            const hit = await peekTelegramChat({ data: { token: config.telegramToken } });
            setConfig({ telegramChatId: hit.chatId });
            toast.success("채팅 ID를 넣었습니다.");
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "찾지 못했습니다.");
          }
        }}>채팅 ID 찾기</Button>
      </ChannelCard>
    </>
  );
}
