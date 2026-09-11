import { ExternalLink } from "lucide-react";
import { type ReactNode, Fragment, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { authEnabled, signIn, signOut } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { extractKakaoCode, kakaoRedirectUri } from "@/lib/cinema/kakao";
import {
  currentGasScript,
  ensureGasSyncKey,
  forgetGasLink,
  gasHomeUrl,
  refreshGasMeta,
} from "@/lib/cinema/gas-provision";
import { GAS_SOURCE_STAMP } from "@/lib/cinema/gas-script";
import { pullGasMeta } from "@/lib/cinema/cloud";
import { probeGasHealth } from "@/lib/cinema/gas-health";
import { describeGasPush, flushSettings } from "./cloud-sync";
import { exchangeKakaoCode, peekTelegramChat, sendAlertEmail, sendKakaoMemo, sendTelegram } from "@/lib/cinema/scan";
import { THEATERS } from "@/lib/cinema/theaters";
import type { ScanResult, WatchConfig } from "@/lib/cinema/types";
import { SEAT_HELP, TIMETABLE_HELP, CHART_HELP, mailEnabled, seatSourceLabel, timetableSourceLabel } from "@/lib/cinema/types";
import { THEME_MODES } from "@/lib/theme";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";
import { SettingsTheaterPicks } from "./theater-picks";

export function SettingsView({ lastScan }: { lastScan: ScanResult | null }) {
  const config = useAppStore((s) => s.config);
  const setConfig = useAppStore((s) => s.setConfig);
  const pushAlerts = useAppStore((s) => s.pushAlerts);
  const { user } = useCurrentUserState();
  const loginEmail = user?.primaryEmail?.trim() ?? "";
  const [kakaoCode, setKakaoCode] = useState("");
  const [showMail, setShowMail] = useState(false);
  const [showKakao, setShowKakao] = useState(false);
  const [showTelegram, setShowTelegram] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [showStages, setShowStages] = useState(false);
  const [showStatus, setShowStatus] = useState(false);
  const [showGasSection, setShowGasSection] = useState(false);
  const [showGasHelp, setShowGasHelp] = useState(false);
  const [showGasUrlHelp, setShowGasUrlHelp] = useState(false);
  const [remoteStamp, setRemoteStamp] = useState<string | null>(null);
  const setTab = useAppStore((s) => s.setTab);
  const [redirectUri, setRedirectUri] = useState("");
  const [gasUrlDraft, setGasUrlDraft] = useState(config.gasWebUrl);
  const notifyHealth = useNotifyHealth(config);

  useEffect(() => {
    setRedirectUri(kakaoRedirectUri());
  }, []);

  useEffect(() => {
    setGasUrlDraft(config.gasWebUrl);
  }, [config.gasWebUrl]);

  useEffect(() => {
    const url = config.gasWebUrl.trim();
    if (!url) {
      setRemoteStamp(null);
      return;
    }
    let cancelled = false;
    void pullGasMeta({ data: { url } })
      .then((meta) => {
        if (cancelled) return;
        if (meta.status !== "ok") return;
        setRemoteStamp(meta.stamp || "");
        if (meta.stamp === GAS_SOURCE_STAMP) {
          if (config.gasSourceStamp !== GAS_SOURCE_STAMP) {
            setConfig({ gasSourceStamp: GAS_SOURCE_STAMP });
          }
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [config.gasWebUrl]);

  function markScriptCurrent() {
    setConfig({ gasSourceStamp: GAS_SOURCE_STAMP });
  }

  async function sendTestMail() {
    const email = loginEmail || config.email.trim();
    if (!email) {
      toast.error("먼저 로그인해 주세요.");
      return;
    }
    setSendingTest(true);
    try {
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
      pushAlerts([
        {
          id: `alert:test:${Date.now()}`,
          createdAt: new Date().toISOString(),
          kind: "open",
          title: "[오픈벨] 연결 테스트",
          body: `${email}로 테스트 메일을 보냈습니다.`,
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
      if (result.needsConfirm) {
        toast.success("첫 메일은 확인 링크입니다. 받은편지함에서 한 번만 눌러 주세요.");
      } else {
        toast.success(`${email}로 보냈습니다. 받은편지함을 확인하세요.`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "보내기에 실패했습니다.");
    } finally {
      setSendingTest(false);
    }
  }

  function openKakaoAuth() {
    const key = config.kakaoRestKey.trim();
    if (!key) {
      toast.error("REST API 키를 먼저 붙여넣으세요.");
      return;
    }
    const url =
      "https://kauth.kakao.com/oauth/authorize" +
      `?client_id=${encodeURIComponent(key)}` +
      `&redirect_uri=${encodeURIComponent(kakaoRedirectUri())}` +
      "&response_type=code&scope=talk_message";
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function copyGasScript() {
    return navigator.clipboard
      .writeText(currentGasScript())
      .then(() => true)
      .catch(() => false);
  }

  async function pushWatchWindow() {
    const gas = await flushSettings(Boolean(loginEmail));
    const live = describeGasPush(gas);
    if (live) toast.success(live);
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-xl bg-surface p-4 shadow-border">
        <CloudSettingsCard />
        <div className="mt-5 border-t border-border pt-4">
        <button
          type="button"
          onClick={() => setShowGasSection((v) => !v)}
          className="flex min-h-11 w-full items-center justify-between gap-3 text-left"
        >
          <h2 className="text-xs font-medium tracking-[0.16em] text-muted">
            구글스크립트(예비)
          </h2>
          <span className="shrink-0 text-xs text-muted">
            {showGasSection ? "접기" : "펼치기"}
          </span>
        </button>
        {showGasSection ? (
          <>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          이중으로 알림이 갈 수 있지만, 베셀 서버에 문제가 있을 때도 확실하게
          알림을 받고 싶으면 예비로 설정합니다.
        </p>
        <h3 className="mt-4 text-xs font-medium tracking-[0.16em] text-muted">주기</h3>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {[1, 5, 10].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => {
                setConfig({ intervalMin: n });
                void pushWatchWindow();
              }}
              className={cn(
                "min-h-11 rounded-md text-sm tabular-nums",
                config.intervalMin === n
                  ? "bg-pick text-fg ring-1 ring-border-strong"
                  : "bg-bg text-muted",
              )}
            >
              {n}분
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-faint">
          구글 트리거에는 1분 아니면 5분(또는 10분)만 있습니다. 하루 종일
          받으려면 5분을 쓰세요. 1분은 더 빠르지만 오후에 끊길 수 있습니다.
        </p>
        <button
          type="button"
          onClick={() => setShowGasHelp((v) => !v)}
          className="mt-3 flex min-h-11 w-full items-center justify-between gap-3 text-left"
        >
          <p className="text-sm font-medium text-fg">설치 방법</p>
          <span className="shrink-0 text-xs text-muted">
            {showGasHelp ? "접기" : "펼치기"}
          </span>
        </button>
        {showGasHelp ? (
          <>
        <p className="mt-1 text-sm font-medium text-fg">처음 설치</p>
        <ol className="mt-1 list-decimal pl-5 text-sm leading-relaxed text-muted">
          <li>
            <a
              href="https://script.google.com/home/usersettings"
              target="_blank"
              rel="noopener noreferrer"
              className="text-fg underline underline-offset-2"
            >
              script.google.com/home/usersettings
            </a>
            에서 Google Apps Script API를 켜세요.
          </li>
          <li>스크립트 복사를 누르세요.</li>
          <li>
            <a
              href={gasHomeUrl(loginEmail) || "https://script.google.com"}
              target="_blank"
              rel="noopener noreferrer"
              className="text-fg underline underline-offset-2"
            >
              script.google.com
            </a>
            에서 새 프로젝트를 만드세요.
          </li>
          <li>코드를 붙여넣고 저장하세요.</li>
          <li>위쪽 함수를 설치 로 실행하고 권한을 허용하세요.</li>
          <li>배포된 웹앱 주소(/exec)를 아래 칸에 붙이세요.</li>
        </ol>
        <p className="mt-3 text-sm font-medium text-fg">이후 업데이트</p>
        <ol className="mt-1 list-decimal pl-5 text-sm leading-relaxed text-muted">
          <li>스크립트 복사를 누르세요.</li>
          <li>
            script.google.com 열기로 오픈벨을 연 뒤, 붙여넣고 저장하세요.
          </li>
        </ol>
          </>
        ) : null}
        <label className="mt-4 block text-xs text-muted">웹앱 주소</label>
        <button
          type="button"
          onClick={() => setShowGasUrlHelp((v) => !v)}
          className="mt-1 flex min-h-11 w-full items-center justify-between gap-3 text-left"
        >
          <p className="text-sm font-medium text-fg">웹앱 주소 찾는 법</p>
          <span className="shrink-0 text-xs text-muted">
            {showGasUrlHelp ? "접기" : "펼치기"}
          </span>
        </button>
        {showGasUrlHelp ? (
        <ol className="mt-1 list-decimal pl-5 text-sm leading-relaxed text-muted">
          <li>
            <a
              href={gasHomeUrl(loginEmail) || "https://script.google.com"}
              target="_blank"
              rel="noopener noreferrer"
              className="text-fg underline underline-offset-2"
            >
              script.google.com
            </a>
            에서 오픈벨 프로젝트를 여세요.
          </li>
          <li>오른쪽 위 배포 → 새 배포를 누르세요. 이미 있으면 배포 관리입니다.</li>
          <li>유형은 웹 앱, 실행은 나, 액세스는 모든 사용자로 두세요.</li>
          <li>배포 후 나온 주소 끝이 /exec 인지 확인하세요.</li>
          <li>그 주소를 아래 칸에 붙이고 웹앱 주소 연결을 누르세요.</li>
        </ol>
        ) : null}
        <input
          value={gasUrlDraft}
          onChange={(e) => setGasUrlDraft(e.target.value)}
          placeholder="https://script.google.com/macros/s/…/exec"
          className="mt-1.5 h-11 w-full rounded-md bg-bg px-3 text-sm text-fg outline-none ring-1 ring-border focus:ring-border-strong"
        />
        <button
          type="button"
          className="mt-2 min-h-11 w-full rounded-md bg-bg px-3 text-sm text-fg ring-1 ring-border"
          onClick={() => {
            const raw = gasUrlDraft.trim();
            if (!raw) {
              toast.error("웹앱 주소를 붙여넣으세요.");
              return;
            }
            let parsed: URL;
            try {
              parsed = new URL(raw);
            } catch {
              toast.error("주소가 올바르지 않습니다.");
              return;
            }
            if (
              !parsed.hostname.endsWith("script.google.com") &&
              !parsed.hostname.endsWith("googleusercontent.com")
            ) {
              toast.error("구글 스크립트 웹앱 주소만 됩니다.");
              return;
            }
            ensureGasSyncKey();
            setConfig({ gasWebUrl: raw });
            void (async () => {
              const id = await refreshGasMeta(raw).catch(() => "");
              await flushSettings(Boolean(loginEmail));
              toast.success(
                id
                  ? "웹앱을 연결했습니다. 알림 경로에서 구글 스크립트를 확인하세요."
                  : "주소를 저장했습니다. 알림 경로에서 확인하세요.",
              );
            })();
          }}
        >
          웹앱 주소 연결
        </button>
        {config.gasWebUrl.trim() ? (
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
        ) : null}
        <a
          href={gasHomeUrl(loginEmail) || "https://script.google.com"}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 flex min-h-11 w-full items-center justify-center rounded-md bg-pick px-3 text-sm text-fg ring-1 ring-border-strong"
        >
          script.google.com 열기
        </a>
        <button
          type="button"
          className="mt-2 min-h-11 w-full rounded-md bg-bg px-3 text-sm text-fg ring-1 ring-border"
          onClick={() => {
            void copyGasScript().then((ok) => {
              if (!ok) {
                toast.error("복사하지 못했습니다.");
                return;
              }
              toast.success(
                `스크립트를 복사했습니다. ${config.intervalMin}분 · ${config.daysAhead}일. script.google.com에 붙여넣고 저장하세요.`,
              );
              markScriptCurrent();
            });
          }}
        >
          스크립트 복사
        </button>
        {(config.gasWebUrl.trim() || config.gasScriptId.trim()) &&
        ((remoteStamp != null && remoteStamp !== GAS_SOURCE_STAMP) ||
          (remoteStamp == null &&
            Boolean(config.gasSourceStamp) &&
            config.gasSourceStamp !== GAS_SOURCE_STAMP)) ? (
          <p className="mt-2 text-sm text-danger">
            변경되었습니다. 복사한 코드를 붙여넣고 저장하세요
          </p>
        ) : null}
          </>
        ) : null}
        </div>
      </section>

      {/* rest of file continues - truncated for tool limit - NEED FULL FILE */}
