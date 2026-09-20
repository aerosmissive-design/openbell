import { ExternalLink } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { authEnabled, signOut } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { extractKakaoCode, kakaoRedirectUri } from "@/lib/cinema/kakao";
import { currentGasScript, ensureGasSyncKey, forgetGasLink, gasHomeUrl, gasWatchFingerprint, refreshGasMeta } from "@/lib/cinema/gas-provision";
import { GAS_SOURCE_STAMP } from "@/lib/cinema/gas-script";
import { pullGasMeta } from "@/lib/cinema/cloud";
import { describeGasPush, flushSettings } from "./cloud-sync";
import { exchangeKakaoCode, peekTelegramChat, sendAlertEmail, sendGasTest } from "@/lib/cinema/scan";
import { sendReservationTest } from "@/lib/cinema/reservation-test";
import type { ScanResult } from "@/lib/cinema/types";
import { mailEnabled } from "@/lib/cinema/types";
import { THEME_MODES } from "@/lib/theme";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";
import { SettingsTheaterPicks } from "./theater-picks";
import { GasBackupMailField } from "./gas-backup-mail";

export function SettingsView({ lastScan }: { lastScan: ScanResult | null }) {
  void lastScan;
  const config = useAppStore((s) => s.config);
  const setConfig = useAppStore((s) => s.setConfig);
  const pushAlerts = useAppStore((s) => s.pushAlerts);
  const { user } = useCurrentUserState();
  const loginEmail = user?.primaryEmail?.trim() ?? "";
  const [kakaoCode, setKakaoCode] = useState("");
  const [showMail, setShowMail] = useState(!user);
  const [showKakao, setShowKakao] = useState(false);
  const [showTelegram, setShowTelegram] = useState(() => Boolean(useAppStore.getState().config.telegramToken || useAppStore.getState().config.telegramChatId));
  const [sendingTest, setSendingTest] = useState(false);
  const [showGasSection, setShowGasSection] = useState(true);
  const [showGasHelp, setShowGasHelp] = useState(false);
  const [redirectUri, setRedirectUri] = useState("");
  const [gasUrlDraft, setGasUrlDraft] = useState(config.gasWebUrl);
  const [remoteStamp, setRemoteStamp] = useState<string | null>(null);
  const [copiedWatch, setCopiedWatch] = useState("");
  useEffect(() => setRedirectUri(kakaoRedirectUri()), []);
  useEffect(() => setGasUrlDraft(config.gasWebUrl), [config.gasWebUrl]);
  useEffect(() => {
    try {
      const saved = String(localStorage.getItem("openbell-gas-copied-fp") || "");
      if (saved) {
        setCopiedWatch(saved);
        return;
      }
      if (config.gasWebUrl.trim() || config.gasScriptId.trim()) {
        const fp = gasWatchFingerprint();
        localStorage.setItem("openbell-gas-copied-fp", fp);
        setCopiedWatch(fp);
      }
    } catch {
      setCopiedWatch("");
    }
  }, [config.gasWebUrl, config.gasScriptId]);
  useEffect(() => {
    const url = config.gasWebUrl.trim();
    if (!url) {
      setRemoteStamp(null);
      return;
    }
    let cancelled = false;
    void pullGasMeta({ data: { url } })
      .then((meta) => {
        if (cancelled || meta.status !== "ok") return;
        setRemoteStamp(meta.stamp || "");
        if (meta.stamp === GAS_SOURCE_STAMP && config.gasSourceStamp !== GAS_SOURCE_STAMP)
          setConfig({ gasSourceStamp: GAS_SOURCE_STAMP });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [config.gasWebUrl]);

  async function pushWatchWindow() {
    const gas = await flushSettings(Boolean(loginEmail));
    const live = describeGasPush(gas);
    if (live) toast.success(live);
  }

  async function sendTestMail() {
    const email = (loginEmail || config.email).trim();
    if (!email) {
      toast.error("알림 받을 메일을 적으세요.");
      return;
    }
    if (!config.gasWebUrl.trim() && !config.gmailAppPassword.trim()) {
      toast.error("구글스크립트 웹앱 주소를 먼저 연결하세요.");
      return;
    }
    setSendingTest(true);
    try {
      setConfig({ email, emailNotify: true });
      const gas = await flushSettings(Boolean(loginEmail));
      if (config.gasWebUrl.trim()) {
        await sendGasTest({
          data: { url: config.gasWebUrl.trim(), op: "test", subject: "[오픈벨] 연결 테스트" },
        });
        pushAlerts([
          {
            id: `alert:test:${Date.now()}`,
            createdAt: new Date().toISOString(),
            kind: "open",
            title: "[오픈벨] 연결 테스트",
            body: `${email}로 구글스크립트가 테스트 메일을 보냈습니다.`,
            bookingUrl: "https://m.megabox.co.kr/booking",
            theaterId: "megabox_coex",
            movieTitle: "오픈벨",
            playDate: "",
            startTime: "",
            hallName: "연결 테스트",
            formats: [],
            restSeats: null,
          },
        ]);
        const live = describeGasPush(gas);
        toast.success(live ? `${email}로 보냈습니다. ${live}` : `${email}로 구글스크립트가 테스트 메일을 보냈습니다.`);
        return;
      }
      const result = await sendAlertEmail({
        data: {
          to: email,
          subject: "[오픈벨] 연결 테스트",
          text: "오픈벨 메일 연결이 됐습니다. 예매가 열리면 이 주소로 보냅니다.",
          url: "https://m.megabox.co.kr/booking",
          gasWebUrl: config.gasWebUrl || undefined,
          gmailAppPassword: config.gmailAppPassword || undefined,
        },
      });
      toast.success(result.needsConfirm ? "첫 메일은 확인 링크입니다. 받은편지함에서 한 번만 눌러 주세요." : `${email}로 보냈습니다.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "보내기에 실패했습니다.");
    } finally {
      setSendingTest(false);
    }
  }

  async function sendReservationChannelTest(channel: "mail" | "telegram" | "kakao") {
    if (channel === "mail") {
      if (!(loginEmail || config.email).trim()) {
        toast.error("알림 받을 메일을 적으세요.");
        return;
      }
      if (!mailEnabled(config) && !config.gasWebUrl.trim() && !config.gmailAppPassword.trim()) {
        toast.error("구글스크립트 웹앱을 먼저 연결하세요.");
        return;
      }
    }
    if (channel === "telegram" && (!config.telegramToken.trim() || !config.telegramChatId.trim())) {
      toast.error("텔레그램 봇 토큰과 채팅 ID를 먼저 넣으세요.");
      return;
    }
    if (channel === "kakao" && (!config.kakaoRestKey.trim() || !config.kakaoRefreshToken.trim())) {
      toast.error("카카오를 먼저 연결하세요.");
      return;
    }
    setSendingTest(true);
    try {
      const result = await sendReservationTest({
        data: {
          channel,
          email: loginEmail || config.email,
          gmailAppPassword: config.gmailAppPassword,
          gasWebUrl: config.gasWebUrl || undefined,
          telegramToken: config.telegramToken,
          telegramChatId: config.telegramChatId,
          kakaoRestKey: config.kakaoRestKey,
          kakaoRefreshToken: config.kakaoRefreshToken,
        },
      });
      const now = new Date().toISOString();
      pushAlerts(
        result.theaters.map((show, i) => ({
          id: `alert:test-reservation:${show.theaterId}:${Date.now()}:${i}`,
          createdAt: now,
          kind: "open" as const,
          title: `${show.movieTitle} 예매 오픈`,
          body: [show.theaterId, show.playDate, show.startTime, show.hallName].filter(Boolean).join(" · "),
          bookingUrl: show.bookingUrl,
          theaterId: show.theaterId,
          movieTitle: show.movieTitle,
          playDate: show.playDate,
          startTime: show.startTime,
          hallName: show.hallName,
          formats: [],
          restSeats: null,
        })),
      );
      toast.success(
        result.count >= 4
          ? "4개 극장 실제 회차로 보냈습니다. 「바로 예매」가 열리면 실제 오픈 알림도 같은 길입니다."
          : `${result.count}개 극장 실제 회차로 보냈습니다. 「바로 예매」가 열리면 실제 오픈 알림도 같은 길입니다.`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "예매 알림 테스트 실패");
    } finally {
      setSendingTest(false);
    }
  }

  const gasLinked = Boolean(config.gasWebUrl.trim());

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-xl bg-surface p-4 shadow-border">
        <CloudSettingsCard />
        <div className="mt-5 border-t border-border pt-4">
          <button type="button" onClick={() => setShowGasSection((v) => !v)} className="flex min-h-11 w-full items-center justify-between gap-3 text-left">
            <h2 className="text-xs font-medium tracking-[0.16em] text-muted">구글스크립트(예비)</h2>
            <span className="shrink-0 text-xs text-muted">{showGasSection ? "접기" : "펼치기"}</span>
          </button>
          {showGasSection ? (
            <>
              <p className="mt-2 text-sm leading-relaxed text-muted">베셀·Neon이 죽어도 구글스크립트가 알림을 보냅니다. 받을 메일은 아래 「메일로 받기」에만 적습니다.</p>
              <p className="mt-2 text-xs leading-relaxed text-faint">
                {config.email.trim() ? `알림 메일 ${config.email}` : "알림 메일이 없습니다. 「메일로 받기」에서 주소를 적으세요."}
              </p>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {[1, 5, 10].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => {
                      setConfig({ intervalMin: n });
                      void pushWatchWindow();
                    }}
                    className={cn("min-h-11 rounded-md text-sm tabular-nums", config.intervalMin === n ? "bg-pick text-fg ring-1 ring-border-strong" : "bg-bg text-muted")}
                  >
                    {n}분
                  </button>
                ))}
              </div>
              <button type="button" onClick={() => setShowGasHelp((v) => !v)} className="mt-3 flex min-h-11 w-full items-center justify-between gap-3 text-left">
                <p className="text-sm font-medium text-fg">설치 방법</p>
                <span className="shrink-0 text-xs text-muted">{showGasHelp ? "접기" : "펼치기"}</span>
              </button>
              {showGasHelp ? (
                <ol className="mt-1 list-decimal pl-5 text-sm leading-relaxed text-muted">
                  <li>스크립트 복사를 누르세요.</li>
                  <li>script.google.com에서 붙여넣고 저장한 뒤 설치를 실행하세요.</li>
                  <li>배포된 /exec 주소를 아래에 붙이세요.</li>
                </ol>
              ) : null}
              <label className="mt-4 block text-xs text-muted">웹앱 주소</label>
              {gasLinked ? <p className="mt-1 text-xs text-muted">연결됨. 주소를 바꾸려면 연결을 끊으세요.</p> : null}
              <input
                value={gasUrlDraft}
                readOnly={gasLinked}
                disabled={gasLinked}
                onChange={(e) => setGasUrlDraft(e.target.value)}
                placeholder="https://script.google.com/macros/s/…/exec"
                className={cn(
                  "mt-1.5 h-11 w-full rounded-md px-3 text-sm outline-none ring-1 ring-border",
                  gasLinked ? "cursor-not-allowed bg-bg text-faint opacity-60" : "bg-bg text-fg focus:ring-border-strong",
                )}
              />
              {gasLinked ? (
                <button
                  type="button"
                  className="mt-2 min-h-11 w-full text-sm text-muted"
                  onClick={() => {
                    forgetGasLink();
                    setGasUrlDraft("");
                    setRemoteStamp(null);
                    void flushSettings(Boolean(loginEmail));
                    toast.success("웹앱 연결을 끊었습니다.");
                  }}
                >
                  연결 끊기
                </button>
              ) : (
                <button
                  type="button"
                  className="mt-2 min-h-11 w-full rounded-md bg-bg px-3 text-sm text-fg ring-1 ring-border"
                  onClick={() => {
                    const raw = gasUrlDraft.trim();
                    if (!raw) {
                      toast.error("웹앱 주소를 붙여넣으세요.");
                      return;
                    }
                    try {
                      const parsed = new URL(raw);
                      if (!parsed.hostname.endsWith("script.google.com") && !parsed.hostname.endsWith("googleusercontent.com")) {
                        toast.error("구글 스크립트 웹앱 주소만 됩니다.");
                        return;
                      }
                    } catch {
                      toast.error("주소가 올바르지 않습니다.");
                      return;
                    }
                    ensureGasSyncKey();
                    setConfig({ gasWebUrl: raw });
                    void (async () => {
                      const id = await refreshGasMeta(raw).catch(() => "");
                      await flushSettings(Boolean(loginEmail));
                      try {
                        if (!localStorage.getItem("openbell-gas-copied-fp")) {
                          const fp = gasWatchFingerprint();
                          localStorage.setItem("openbell-gas-copied-fp", fp);
                          setCopiedWatch(fp);
                        }
                      } catch {
                        /* ignore */
                      }
                      toast.success(id ? "웹앱을 연결했습니다." : "주소를 저장했습니다.");
                    })();
                  }}
                >
                  웹앱 주소 연결
                </button>
              )}
              <a href={gasHomeUrl(loginEmail) || "https://script.google.com"} target="_blank" rel="noopener noreferrer" className="mt-3 flex min-h-11 w-full items-center justify-center rounded-md bg-pick px-3 text-sm text-fg ring-1 ring-border-strong">
                script.google.com 열기
              </a>
              <button
                type="button"
                className="mt-2 min-h-11 w-full rounded-md bg-bg px-3 text-sm text-fg ring-1 ring-border"
                onClick={() => {
                  void navigator.clipboard.writeText(currentGasScript()).then(
                    () => {
                      const fp = gasWatchFingerprint();
                      setConfig({ gasSourceStamp: GAS_SOURCE_STAMP });
                      setCopiedWatch(fp);
                      try {
                        localStorage.setItem("openbell-gas-copied-fp", fp);
                      } catch {
                        /* ignore */
                      }
                      toast.success("스크립트를 복사했습니다. script.google.com에 붙여넣고 저장하세요.");
                    },
                    () => toast.error("복사하지 못했습니다."),
                  );
                }}
              >
                스크립트 복사
              </button>
              {(() => {
                const linked = Boolean(config.gasWebUrl.trim() || config.gasScriptId.trim());
                if (!linked) return null;
                const stampStale =
                  (remoteStamp != null && remoteStamp !== GAS_SOURCE_STAMP) ||
                  (remoteStamp == null && Boolean(config.gasSourceStamp) && config.gasSourceStamp !== GAS_SOURCE_STAMP);
                const settingsStale = Boolean(copiedWatch) && copiedWatch !== gasWatchFingerprint();
                if (!stampStale && !settingsStale) return null;
                return (
                  <p className="mt-2 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
                    변경되었습니다. 복사한 코드를 붙여넣고 저장하세요.
                  </p>
                );
              })()}
            </>
          ) : null}
        </div>
      </section>

      <section className="rounded-xl bg-surface p-4 shadow-border">
        <SettingsTheaterPicks onChange={() => void pushWatchWindow()} />
      </section>

      <section className="rounded-xl bg-surface p-4 shadow-border">
        <h2 className="text-xs font-medium tracking-[0.16em] text-muted">알림 설정</h2>
        <div className="mt-3 grid grid-cols-5 gap-1.5">
          {[5, 7, 10, 15, 30].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => {
                setConfig({ daysAhead: n });
                void pushWatchWindow();
              }}
              className={cn("min-h-11 rounded-md text-sm", config.daysAhead === n ? "bg-pick text-fg ring-1 ring-border-strong" : "bg-bg text-muted")}
            >
              {n}일
            </button>
          ))}
        </div>

        <ChannelCard
          title="메일로 받기"
          summary={!user ? (config.email.trim() ? `예비 · ${config.email}` : "로그인 없이 예비 가능") : mailEnabled(config) ? `연결됨 · ${loginEmail || config.email}` : config.email.trim() ? `예비 · ${config.email}` : "꺼짐"}
          open={showMail}
          onToggle={() => setShowMail((v) => !v)}
        >
          <p className="text-sm leading-relaxed text-muted">Neon 로그인이 안 되어도 구글스크립트가 이 주소로 메일을 보냅니다.</p>
          <GasBackupMailField />
          <Button className="mt-3 w-full" disabled={sendingTest || !config.email.trim()} onClick={() => void sendTestMail()}>
            {sendingTest ? "보내는 중…" : "구글스크립트로 연결 확인"}
          </Button>
          <Button variant="outline" className="mt-2 w-full" disabled={sendingTest || !config.email.trim()} onClick={() => void sendReservationChannelTest("mail")}>
            {sendingTest ? "보내는 중…" : "4개 극장 바로예매 테스트"}
          </Button>
          <p className="mt-2 text-xs leading-relaxed text-faint">용산·영등포·코엑스·남양주에서 실제 회차를 골라 「바로 예매」가 붙은 알림을 보냅니다. 그 버튼이 열리면 실제 오픈 알림도 같은 경로입니다.</p>
          {user ? (
            <div className="mt-3">
              <Switch
                checked={config.emailNotify}
                onCheckedChange={(on) => setConfig({ emailNotify: on, email: loginEmail || config.email })}
                label={config.emailNotify ? "알림 켜짐" : "알림 꺼짐"}
              />
            </div>
          ) : (
            <Link to="/login" className="mt-3 flex min-h-11 items-center justify-center rounded-md bg-bg px-3 text-sm text-muted ring-1 ring-border">
              로그인 (베셀·Neon, 지금은 한도로 안 될 수 있음)
            </Link>
          )}
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
          <Button variant="outline" className="mt-2 w-full" disabled={sendingTest || !config.kakaoRefreshToken} onClick={() => void sendReservationChannelTest("kakao")}>
            {sendingTest ? "보내는 중…" : "4개 극장 바로예매 테스트"}
          </Button>
          <p className="mt-2 text-xs leading-relaxed text-faint">카톡 「바로 예매」가 실제 회차 좌석 페이지로 열리면, 오픈 알림도 같은 버튼으로 옵니다.</p>
        </ChannelCard>

        <ChannelCard title="텔레그램으로 받기" summary={config.telegramToken && config.telegramChatId ? "연결됨" : "꺼짐"} open={showTelegram} onToggle={() => setShowTelegram((v) => !v)}>
          <label className="block text-xs text-muted">봇 토큰</label>
          <input value={config.telegramToken} onChange={(e) => setConfig({ telegramToken: e.target.value })} className="mt-1.5 h-11 w-full rounded-md bg-bg px-3 text-sm text-fg outline-none ring-1 ring-border" />
          <label className="mt-3 block text-xs text-muted">채팅 ID</label>
          <input value={config.telegramChatId} onChange={(e) => setConfig({ telegramChatId: e.target.value })} className="mt-1.5 h-11 w-full rounded-md bg-bg px-3 text-sm text-fg outline-none ring-1 ring-border" />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={async () => {
              try {
                const hit = await peekTelegramChat({ data: { token: config.telegramToken } });
                setConfig({ telegramChatId: hit.chatId });
                toast.success("채팅 ID를 넣었습니다.");
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "찾지 못했습니다.");
              }
            }}>채팅 ID 찾기</Button>
            <Button variant="outline" disabled={sendingTest || !config.telegramToken.trim() || !config.telegramChatId.trim()} onClick={() => void sendReservationChannelTest("telegram")}>
              {sendingTest ? "보내는 중…" : "4개 극장 바로예매 테스트"}
            </Button>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-faint">텔레그램 「바로 예매」가 실제 회차로 열리면, 오픈 알림도 같은 링크로 옵니다.</p>
        </ChannelCard>
      </section>

      <section className="rounded-xl bg-surface p-4 shadow-border">
        <h2 className="text-xs font-medium tracking-[0.16em] text-muted">배경</h2>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {THEME_MODES.map((mode) => (
            <button key={mode.id} type="button" onClick={() => setConfig({ theme: mode.id })} className={cn("min-h-11 rounded-md text-sm", (config.theme ?? "dark") === mode.id ? "bg-pick text-fg ring-1 ring-border-strong" : "bg-bg text-muted")}>
              {mode.label}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

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

function CloudSettingsCard() {
  const { user, isPending } = useCurrentUserState();
  const [signingOut, setSigningOut] = useState(false);
  if (isPending) return <div className="h-16 rounded-md bg-bg" />;
  return (
    <div>
      <h2 className="text-xs font-medium tracking-[0.16em] text-muted">계정</h2>
      {user ? (
        <div className="mt-2 space-y-2 text-sm leading-relaxed text-muted">
          <p className="text-fg">{user.displayName ?? user.primaryEmail ?? "로그인됨"}</p>
          <p>지금은 Neon 한도로 계정 저장이 안 될 수 있습니다. 구글스크립트 예비 메일을 쓰세요.</p>
          {authEnabled ? (
            <Button variant="outline" className="w-full" disabled={signingOut} onClick={() => { setSigningOut(true); forgetGasLink(); void signOut("/"); }}>
              {signingOut ? "나가는 중…" : "로그아웃"}
            </Button>
          ) : null}
        </div>
      ) : (
        <div>
          <p className="mt-2 text-sm leading-relaxed text-muted">로그인은 Neon이 막혀 안 될 수 있습니다. 아래 「메일로 받기」에 주소를 적으세요.</p>
          <Link to="/login" className="mt-3 flex min-h-11 items-center justify-center rounded-md bg-bg text-sm text-muted ring-1 ring-border">로그인</Link>
        </div>
      )}
    </div>
  );
}
