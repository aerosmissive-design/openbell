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
  const config = useAppStore((s) => s.config);
  const setConfig = useAppStore((s) => s.setConfig);
  const { user } = useCurrentUserState();
  const loginEmail = user?.primaryEmail?.trim() ?? "";
  const [showGasSection, setShowGasSection] = useState(true);
  const [showGasHelp, setShowGasHelp] = useState(false);
  const [gasUrlDraft, setGasUrlDraft] = useState(config.gasWebUrl);
  const [remoteStamp, setRemoteStamp] = useState<string | null>(null);
  const [copiedWatch, setCopiedWatch] = useState("");
  const [showMail, setShowMail] = useState(!user);
  const [sendingTest, setSendingTest] = useState(false);
  useEffect(() => setGasUrlDraft(config.gasWebUrl), [config.gasWebUrl]);
  useEffect(() => {
    try {
      const saved = String(localStorage.getItem("openbell-gas-copied-fp") || "");
      if (saved) setCopiedWatch(saved);
    } catch {
      /* ignore */
    }
  }, []);
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

  const gasLinked = Boolean(config.gasWebUrl.trim());

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-xl bg-surface p-4 shadow-border">
        <h2 className="text-xs font-medium tracking-[0.16em] text-muted">예매 전광판</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          PC·NAS·우회·공홈 등 여러 출처 잔여석·상영을 한 화면에 합쳐 봅니다. Neon 로그인 없이도 열 수 있습니다.
        </p>
        <a
          href="/board"
          className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-pick px-3 text-sm text-fg ring-1 ring-border-strong"
        >
          베셀 전광판 열기
          <ExternalLink className="size-3.5" aria-hidden />
        </a>
        <a
          href="https://openbell-fawn.vercel.app/board"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-bg px-3 text-sm text-muted ring-1 ring-border"
        >
          새 탭 · 프로드 전광판
          <ExternalLink className="size-3.5" aria-hidden />
        </a>
      </section>

      <section className="rounded-xl bg-surface p-4 shadow-border">
        <CloudSettingsCard />
        <div className="mt-5 border-t border-border pt-4">
          <button type="button" onClick={() => setShowGasSection((v) => !v)} className="flex min-h-11 w-full items-center justify-between gap-3 text-left">
            <h2 className="text-xs font-medium tracking-[0.16em] text-muted">구글스크립트(예비)</h2>
            <span className="shrink-0 text-xs text-muted">{showGasSection ? "접기" : "펼치기"}</span>
          </button>
          {showGasSection ? (
            <>
              <p className="mt-2 text-sm leading-relaxed text-muted">베셀·Neon이 죽어도 구글스크립트가 알림을 보냅니다.</p>
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
                  <li>script.google.com에서 전부 지우고 붙여넣은 뒤 저장하세요.</li>
                  <li>위쪽 함수에서 설치를 실행하세요. 저장만 하면 웹앱은 예전 코드라 화면에 openbell 만 나옵니다.</li>
                  <li>배포된 /exec 주소를 아래에 붙이세요.</li>
                </ol>
              ) : null}
              <label className="mt-4 block text-xs text-muted">웹앱 주소</label>
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
                    ensureGasSyncKey();
                    setConfig({ gasWebUrl: raw });
                    void refreshGasMeta(raw).catch(() => "");
                    void flushSettings(Boolean(loginEmail));
                    toast.success("주소를 저장했습니다.");
                  }}
                >
                  웹앱 주소 연결
                </button>
              )}
              <a href={gasHomeUrl(loginEmail) || "https://script.google.com"} target="_blank" rel="noopener noreferrer" className="mt-3 flex min-h-11 w-full items-center justify-center rounded-md bg-pick px-3 text-sm text-fg ring-1 ring-border-strong">
                script.google.com 열기
              </a>
              {config.gasWebUrl.trim() ? (
                <a
                  href={(() => {
                    const base = config.gasWebUrl.trim().replace(/\/$/, "");
                    return base.includes("?") ? `${base}&op=board` : `${base}?op=board`;
                  })()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-pick px-3 text-sm text-fg ring-1 ring-border-strong"
                >
                  GAS 전광판 열기
                  <ExternalLink className="size-3.5" aria-hidden />
                </a>
                <p className="mt-1.5 text-[11px] leading-relaxed text-faint">
                  스크립트를 붙여넣은 뒤 설치를 실행해야 이 링크가 새 전광판을 엽니다. 저장만 하면 하얀 화면에 openbell 만 나옵니다.
                </p>
              ) : (
                <p className="mt-2 text-xs leading-relaxed text-faint">
                  웹앱 주소를 연결하면 여기에 GAS 전광판 링크가 나타납니다. (?op=board)
                </p>
              )}
              <button
                type="button"
                className="mt-2 min-h-11 w-full rounded-md bg-bg px-3 text-sm text-fg ring-1 ring-border"
                onClick={() => {
                  void navigator.clipboard.writeText(currentGasScript()).then(
                    () => {
                      setConfig({ gasSourceStamp: GAS_SOURCE_STAMP });
                      toast.success("복사했습니다. 붙여넣고 저장한 뒤 설치를 실행하세요.");
                    },
                    () => toast.error("복사하지 못했습니다."),
                  );
                }}
              >
                스크립트 복사
              </button>
            </>
          ) : null}
        </div>
      </section>

      <section className="rounded-xl bg-surface p-4 shadow-border">
        <SettingsTheaterPicks lastScan={lastScan} onChange={() => void pushWatchWindow()} />
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
          summary={config.email.trim() ? `예비 · ${config.email}` : "로그인 없이 예비 가능"}
          open={showMail}
          onToggle={() => setShowMail((v) => !v)}
        >
          <p className="text-sm leading-relaxed text-muted">Neon이 죽어도 구글스크립트가 이 주소로 메일을 보냅니다.</p>
          <GasBackupMailField />
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
          <p>Neon 한도면 계정 저장이 안 될 수 있습니다. 구글스크립트 예비 메일을 쓰세요.</p>
          {authEnabled ? (
            <Button variant="outline" className="w-full" disabled={signingOut} onClick={() => { setSigningOut(true); forgetGasLink(); void signOut("/"); }}>
              {signingOut ? "나가는 중…" : "로그아웃"}
            </Button>
          ) : null}
        </div>
      ) : (
        <div>
          <p className="mt-2 text-sm leading-relaxed text-muted">로그인은 Neon이 막혀 안 될 수 있습니다. 「메일로 받기」에 주소를 적으세요.</p>
          <Link to="/login" className="mt-3 flex min-h-11 items-center justify-center rounded-md bg-bg text-sm text-muted ring-1 ring-border">로그인</Link>
        </div>
      )}
    </div>
  );
}
