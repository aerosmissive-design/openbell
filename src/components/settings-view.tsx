import { ExternalLink } from "lucide-react";
import { type ReactNode, Fragment, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { authEnabled, signIn, signOut } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { extractKakaoCode, kakaoRedirectUri } from "@/lib/cinema/kakao";
import {
  attachInstalledScript,
  connectedEditorUrl,
  currentGasScript,
  ensureGasSyncKey,
  existingScriptEditorUrl,
  forgetGasLink,
  gasHomeUrl,
  gasIsLinked,
  peekGasOauthClient,
  preloadGasOauth,
  pushLinkedGasSource,
  googleTokenFromClick,
  syncGasScript,
  waitForGasBind,
} from "@/lib/cinema/gas-provision";
import { GAS_SOURCE_STAMP } from "@/lib/cinema/gas-script";
import { pullGasMeta, loadCloudSettings } from "@/lib/cinema/cloud";
import { probeGasHealth } from "@/lib/cinema/gas-health";
import { describeGasPush, flushSettings } from "./cloud-sync";
import { exchangeKakaoCode, peekTelegramChat, sendAlertEmail, sendKakaoMemo, sendTelegram, sendXPost } from "@/lib/cinema/scan";
import { THEATERS } from "@/lib/cinema/theaters";
import type { ScanResult } from "@/lib/cinema/types";
import { SEAT_HELP, TIMETABLE_HELP, CHART_HELP, mailEnabled, seatSourceLabel, timetableSourceLabel, xEnabled } from "@/lib/cinema/types";
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
  const [showX, setShowX] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [wizard, setWizard] = useState(false);
  const [canOauth, setCanOauth] = useState(false);
  const [showStages, setShowStages] = useState(false);
  const [showStatus, setShowStatus] = useState(false);
  const [remoteStamp, setRemoteStamp] = useState<string | null>(null);
  const wizardAbort = useRef<AbortController | null>(null);
  const setTab = useAppStore((s) => s.setTab);
  const [redirectUri, setRedirectUri] = useState("");

  useEffect(() => {
    setRedirectUri(kakaoRedirectUri());
  }, []);

  useEffect(() => {
    void preloadGasOauth();
    void peekGasOauthClient()
      .then((id) => setCanOauth(Boolean(id)))
      .catch(() => setCanOauth(false));
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

  function listenForCopiedInstall() {
    wizardAbort.current?.abort();
    const ac = new AbortController();
    wizardAbort.current = ac;
    const started = Date.now();
    setWizard(true);
    setProvisioning(true);
    void (async () => {
      try {
        await waitForGasBind(ensureGasSyncKey(), ac.signal, started, loginEmail);
        await flushSettings(Boolean(loginEmail));
        markScriptCurrent();
        setWizard(false);
        toast.success("설치한 스크립트를 찾았습니다. 이제 최신화가 이 스크립트를 고칩니다.");
      } catch (err) {
        if (ac.signal.aborted) return;
        const message = err instanceof Error ? err.message : "스크립트를 찾지 못했습니다.";
        if (message !== "취소했습니다.") toast.error(message);
      } finally {
        if (!ac.signal.aborted) setProvisioning(false);
      }
    })();
  }

  function openConnected(url: string) {
    window.open(url, "openbell-connected");
  }

  async function pushWatchWindow() {
    const gas = await flushSettings(Boolean(loginEmail));
    const live = describeGasPush(gas);
    const source = await pushLinkedGasSource();
    if (source.status === "ok") {
      toast.success("구글 스크립트 코드를 지금 설정으로 고쳤습니다.");
      return;
    }
    if (live) toast.success(live);
  }

  function startSyncScript() {
    if (authEnabled && !loginEmail) {
      void signIn("grok-google", { callbackURL: "/" }).catch((err) =>
        toast.error(err instanceof Error ? err.message : "로그인하지 못했습니다."),
      );
      return;
    }
    const tokenPromise = canOauth
      ? googleTokenFromClick(loginEmail)
      : Promise.resolve("");
    setProvisioning(true);
    void (async () => {
      try {
        const accessToken = await tokenPromise;
        if (loginEmail) {
          const remote = await loadCloudSettings();
          if (remote.snapshot) {
            useAppStore.getState().hydrateCloud(remote.snapshot);
          }
        }
        await flushSettings(Boolean(loginEmail));
        const found = await attachInstalledScript(loginEmail);
        if (found && !accessToken) {
          wizardAbort.current?.abort();
          setWizard(false);
          markScriptCurrent();
          openConnected(await connectedEditorUrl(loginEmail));
          toast.success("설치한 스크립트를 찾았습니다. 이 스크립트와 동기화합니다.");
          return;
        }
        wizardAbort.current?.abort();
        const ac = new AbortController();
        wizardAbort.current = ac;
        const linked = gasIsLinked();
        void copyGasScript();
        if (!linked && !canOauth) {
          openConnected(gasHomeUrl(loginEmail));
          setWizard(true);
          toast.success(
            "코드를 복사했습니다. 오픈벨에 붙여넣고 설치하면 이 앱이 그 스크립트를 찾습니다.",
          );
        }
        const result = await syncGasScript(loginEmail, accessToken || undefined);
        if (result.mode === "oauth") {
          setWizard(false);
          await flushSettings(Boolean(loginEmail));
          if (result.scriptId) {
            openConnected(existingScriptEditorUrl(result.scriptId, loginEmail));
          } else {
            openConnected(await connectedEditorUrl(loginEmail));
          }
          toast.success(
            result.created
              ? "스크립트를 만들었습니다. 위쪽 함수를 설치 로 실행하세요."
              : "연결된 스크립트를 열었습니다.",
          );
          markScriptCurrent();
          return;
        }
        if (result.mode === "upgrade" || result.mode === "editor") {
          setWizard(false);
          await flushSettings(Boolean(loginEmail));
          openConnected(await connectedEditorUrl(loginEmail));
          toast.success("연결된 스크립트를 열었습니다. 저장하면 반영됩니다.");
          markScriptCurrent();
          return;
        }
        const hit = await waitForGasBind(
          ensureGasSyncKey(),
          ac.signal,
          undefined,
          loginEmail,
        );
        await flushSettings(Boolean(loginEmail));
        setWizard(false);
        markScriptCurrent();
        openConnected(await connectedEditorUrl(loginEmail));
        toast.success("연결됐습니다. 다시 누르면 이 스크립트만 엽니다.");
        void hit;
      } catch (err) {
        if (err instanceof Error && err.message === "취소했습니다.") return;
        const message = err instanceof Error ? err.message : "최신화하지 못했습니다.";
        toast.error(message);
        if (message.includes("앱스 스크립트 API")) {
          window.open("https://script.google.com/home/usersettings", "_blank", "noopener");
        }
      } finally {
        setProvisioning(false);
      }
    })();
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-xl bg-surface p-4 shadow-border">
        <CloudSettingsCard />
        <div className="mt-5 border-t border-border pt-4">
        <h2 className="text-xs font-medium tracking-[0.16em] text-muted">
          구글 스크립트
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          복사한 코드를 붙여넣고 설치하면 그 스크립트를 찾아 붙입니다. 그록과
          스크립트가 둘 다 메일·텔레그램·카톡·X 알림을 보냅니다. 같은 오픈이
          두 번 갈 수 있습니다.
        </p>
        <button
          type="button"
          disabled={provisioning}
          className="mt-3 min-h-11 w-full rounded-md bg-pick px-3 text-sm text-fg ring-1 ring-border-strong disabled:opacity-60"
          onClick={startSyncScript}
        >
          {provisioning
            ? wizard
              ? "설치되면 붙습니다…"
              : "같은 스크립트를 고치는 중…"
            : "스크립트 자동 최신화"}
        </button>
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
                `스크립트를 복사했습니다. ${config.intervalMin}분 · ${config.daysAhead}일. 붙여넣고 설치하면 이 앱이 그 스크립트를 찾습니다.`,
              );
              markScriptCurrent();
              listenForCopiedInstall();
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
            변경되었습니다. 업데이트해주십시오
          </p>
        ) : null}
        {wizard ? (
          <ol className="mt-3 rounded-md bg-bg px-3 py-3 text-sm leading-relaxed text-fg ring-1 ring-border">
            <li>1. 열린 오픈벨에서 기존 코드를 지우고 붙여넣기 → 저장</li>
            <li>2. 위쪽 함수를 설치 로 바꿔 실행 (권한 허용)</li>
            <li className="mt-1 text-muted">
              새 프로젝트·휴지통 복원은 열지 마세요. 배포는 설치가 합니다.
            </li>
          </ol>
        ) : null}
        </div>
      </section>

      <section className="rounded-xl bg-surface p-4 shadow-border">
        <SettingsTheaterPicks onChange={() => void pushWatchWindow()} />
        <div className="mt-4 border-t border-border pt-3">
        <button
          type="button"
          onClick={() => setShowStatus((v) => !v)}
          className="flex min-h-11 w-full items-center justify-between gap-3 text-left"
        >
          <h2 className="text-xs font-medium tracking-[0.16em] text-muted">
            극장 및 잔여석 현황
          </h2>
          <span className="shrink-0 text-xs text-muted">
            {showStatus ? "접기" : "펼치기"}
          </span>
        </button>
        {showStatus ? (
          <>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          상영시간과 잔여석을 어디서 받았는지입니다. 세 단계는 항상 켜져 있고,
          막히면 다음으로 넘어갑니다.
        </p>
        <div className="mt-3 grid grid-cols-3 gap-x-3 gap-y-2 text-sm">
          <p className="text-xs text-muted">극장</p>
          <p className="text-xs text-muted">극장 현황</p>
          <p className="text-xs text-muted">잔여석 현황</p>
          {THEATERS.map((theater) => {
            const row = lastScan?.theaters.find((t) => t.theaterId === theater.id);
            return (
              <Fragment key={theater.id}>
                <p className="text-fg">{theater.shortName}</p>
                <p className="text-muted">
                  {timetableSourceLabel(row?.source ?? "", row?.ok ?? true)}
                </p>
                <p className="text-muted">{seatSourceLabel(row?.seatSource)}</p>
              </Fragment>
            );
          })}
        </div>
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={() => setShowStages((v) => !v)}
            className="inline-flex min-h-9 items-baseline gap-1.5 bg-transparent p-0 text-right text-faint"
          >
            <span className="text-[11px]">출처</span>
            <span className="text-[11px]">{showStages ? "접기" : "펼치기"}</span>
          </button>
        </div>
        {showStages ? (
          <div className="mt-2 flex flex-col gap-5 text-sm leading-relaxed">
            <div>
              <p className="font-medium text-fg">극장 현황</p>
              <p className="mt-1 text-muted">
                몇 시에 무슨 관이 있는지는 이 순서로 받습니다.
              </p>
              <ol className="mt-2 flex flex-col gap-2 text-fg">
                {TIMETABLE_HELP.map((stage) => (
                  <li key={stage.step}>
                    {stage.step}. {stage.title}
                    <span className="mt-0.5 block text-muted">{stage.body}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <p className="font-medium text-fg">잔여석 현황</p>
              <p className="mt-1 text-muted">
                좌석 숫자는 시간표와 따로, 이 순서로 붙입니다.
              </p>
              <ol className="mt-2 flex flex-col gap-2 text-fg">
                {SEAT_HELP.map((stage) => (
                  <li key={stage.step}>
                    {stage.step}. {stage.title}
                    <span className="mt-0.5 block text-muted">{stage.body}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <p className="font-medium text-fg">무비차트 현황</p>
              <p className="mt-1 text-muted">
                감시 탭 위 포스터 9칸은 이 순서로 받습니다.
              </p>
              <ol className="mt-2 flex flex-col gap-2 text-fg">
                {CHART_HELP.map((stage) => (
                  <li key={stage.step}>
                    {stage.step}. {stage.title}
                    <span className="mt-0.5 block text-muted">{stage.body}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        ) : null}
          </>
        ) : null}
        </div>
      </section>

      <section className="rounded-xl bg-surface p-4 shadow-border">
        <h2 className="text-xs font-medium tracking-[0.16em] text-muted">
          알림 설정
        </h2>
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
        <h3 className="mt-5 text-xs font-medium tracking-[0.16em] text-muted">
          며칠 뒤까지
        </h3>
        <p className="mt-2 text-xs leading-relaxed text-faint">
          오늘부터 며칠 뒤 상영까지 볼지입니다. 극장이 아직 안 연 날짜는
          비어 있습니다.
        </p>
        <div className="mt-3 grid grid-cols-5 gap-1.5">
          {[5, 7, 10, 15, 30].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => {
                setConfig({ daysAhead: n });
                void pushWatchWindow();
              }}
              className={cn(
                "min-h-11 rounded-md text-sm",
                config.daysAhead === n
                  ? "bg-pick text-fg ring-1 ring-border-strong"
                  : "bg-bg text-muted",
              )}
            >
              {n}일
            </button>
          ))}
        </div>
        <h3 className="mt-5 text-xs font-medium tracking-[0.16em] text-muted">
          앱을 꺼도 알림
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          로그인이 메인입니다. 화면을 닫아도 그록 서버와 구글 스크립트가 각각
          조회해 메일·텔레그램·카톡·X를 보냅니다. 한쪽이 멈춰도 다른 쪽이 바로
          보냅니다.
        </p>
        <AlertPathStatus />

      <ChannelCard
        embedded
        title="메일로 받기"
        summary={
          !user
            ? "로그인 필요"
            : mailEnabled(config)
              ? `연결됨 · ${loginEmail || config.email}`
              : "꺼짐"
        }
        open={showMail}
        onToggle={() => setShowMail((v) => !v)}
      >
        {!user ? (
          <div>
            <p className="text-sm leading-relaxed text-muted">
              로그인한 구글 메일로 받습니다. 주소는 따로 적지 않아도 됩니다.
            </p>
            <Link
              to="/login"
              className="mt-3 flex min-h-11 items-center justify-center rounded-md bg-pick text-sm text-fg ring-1 ring-border-strong"
            >
              로그인
            </Link>
          </div>
        ) : (
          <div>
            <p className="text-sm leading-relaxed text-muted">
              이 계정 메일로 보냅니다. 구글 스크립트는 만들지 않아도 됩니다.
            </p>
            <p className="mt-3 text-sm font-medium text-fg">
              {loginEmail || config.email || "메일 없음"}
            </p>
            <div className="mt-3">
              <Switch
                checked={config.emailNotify}
                onCheckedChange={(on) => {
                  if (on) {
                    if (!loginEmail && !config.email.trim()) {
                      toast.error("이 계정에 메일이 없습니다.");
                      return;
                    }
                    setConfig({
                      emailNotify: true,
                      email: loginEmail || config.email,
                    });
                    return;
                  }
                  setConfig({ emailNotify: false });
                }}
                label={config.emailNotify ? "알림 켜짐" : "알림 꺼짐"}
              />
            </div>
            <details className="mt-4">
              <summary className="cursor-pointer text-xs text-muted">
                그록에서 바로 메일 (선택)
              </summary>
              <label className="mt-3 block text-xs text-muted">
                Gmail 앱 비밀번호
              </label>
              <input
                type="password"
                autoComplete="off"
                value={config.gmailAppPassword}
                onChange={(e) => setConfig({ gmailAppPassword: e.target.value })}
                placeholder="16자리 (띄어쓰기 없이)"
                className="mt-1.5 h-11 w-full rounded-md bg-bg px-3 text-sm text-fg outline-none ring-1 ring-border focus:ring-border-strong"
              />
              <p className="mt-2 text-xs leading-relaxed text-faint">
                구글 스크립트 없이 그록 서버가 Gmail SMTP로 보낼 때만 필요합니다.
                스크립트를 쓰면 비워 둬도 됩니다.
              </p>
              <a
                href="https://myaccount.google.com/apppasswords"
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex min-h-11 items-center text-xs text-fg underline-offset-2 hover:underline"
              >
                앱 비밀번호 만들기
              </a>
            </details>
            <Button
              className="mt-3 w-full"
              disabled={sendingTest || !mailEnabled(config)}
              onClick={() => {
                void sendTestMail();
              }}
            >
              {sendingTest ? "보내는 중…" : "테스트 메일 보내기"}
            </Button>
            <p className="mt-2 text-xs leading-relaxed text-faint">
              앱 비밀번호가 없으면 첫 메일에 확인 링크가 올 수 있습니다.
            </p>
          </div>
        )}
      </ChannelCard>

      <ChannelCard
        embedded
        title="카톡으로 받기"
        summary={config.kakaoRefreshToken ? "연결됨" : "꺼짐"}
        open={showKakao}
        onToggle={() => setShowKakao((v) => !v)}
      >
        <p className="text-sm leading-relaxed text-muted">
          카카오는 개인에게 자동 메시지를 거의 막아 둬서, 내 카톡의
          <span className="text-fg"> 나와의 채팅</span>으로만 보낼 수 있습니다.
          한 번만 연결하면 됩니다.
        </p>
        <Steps
          items={[
            <>
              <a
                href="https://developers.kakao.com/console/app"
                target="_blank"
                rel="noreferrer"
                className="text-fg underline-offset-2 hover:underline"
              >
                카카오 디벨로퍼스
              </a>
              에 카카오 계정으로 로그인. 처음이면 개발자 등록 후{" "}
              <span className="text-fg">앱 생성</span>. 이름은 오픈벨.
            </>,
            <>
              왼쪽 메뉴 <span className="text-fg">앱 → 플랫폼 키</span>. 목록에서{" "}
              <span className="text-fg">REST API 키</span> 옆 복사 버튼을 눌러
              아래에 붙여넣기. (예전 화면이면 앱 설정 → 일반 → 앱 키)
            </>,
            <>
              그 REST API 키 줄을 눌러 들어가서{" "}
              <span className="text-fg">리다이렉트 URI</span>에 아래 주소를
              그대로 넣고 저장. 예전에 localhost를 넣었다면 지우고 이걸로
              바꾸세요.
              <code className="mt-1 block break-all rounded-md bg-bg px-3 py-2 text-xs text-fg">
                {redirectUri || "주소를 불러오는 중"}
              </code>
            </>,
            <>
              같은 화면에서 <span className="text-fg">클라이언트 시크릿</span>이
              켜져 있으면 끄기. 켜 두면 연결이 안 됩니다.
            </>,
            <>
              왼쪽 <span className="text-fg">제품 설정 → 카카오 로그인</span>을
              켜고, 동의항목에서{" "}
              <span className="text-fg">카카오톡 메시지 전송</span>을 켜기.
            </>,
            <>
              아래 <span className="text-fg">카카오 허용 열기</span>를 누르면
              로그인 후 이 앱으로 돌아옵니다. 연결됨이 뜨면 성공입니다.
            </>,
          ]}
        />
        <label className="mt-4 block text-xs text-muted">REST API 키</label>
        <input
          value={config.kakaoRestKey}
          onChange={(e) => setConfig({ kakaoRestKey: e.target.value })}
          placeholder="카카오 앱 키"
          className="mt-1.5 h-11 w-full rounded-md bg-bg px-3 text-sm text-fg outline-none ring-1 ring-border focus:ring-border-strong"
        />
        <Button
          variant="outline"
          className="mt-3 w-full"
          onClick={async () => {
            if (!redirectUri) return;
            try {
              await navigator.clipboard.writeText(redirectUri);
              toast.success("리다이렉트 주소를 복사했습니다. 카카오 콘솔에 붙여넣으세요.");
            } catch {
              toast.error("복사에 실패했습니다. 위 주소를 길게 눌러 복사하세요.");
            }
          }}
        >
          리다이렉트 주소 복사
        </Button>
        <Button variant="outline" className="mt-3 w-full" onClick={openKakaoAuth}>
          카카오 허용 열기
          <ExternalLink className="size-3.5" strokeWidth={1.75} />
        </Button>
        <label className="mt-4 block text-xs text-muted">
          인가 코드 (지금 오류 화면이 떴다면 주소창 전체를 붙여넣어도 됩니다)
        </label>
        <input
          value={kakaoCode}
          onChange={(e) => setKakaoCode(e.target.value)}
          placeholder="주소창 전체 또는 code= 뒤"
          className="mt-1.5 h-11 w-full rounded-md bg-bg px-3 text-sm text-fg outline-none ring-1 ring-border focus:ring-border-strong"
        />
        <Button
          className="mt-3 w-full"
          onClick={async () => {
            try {
              const pasted = kakaoCode;
              const redirect = /localhost/i.test(pasted)
                ? "https://localhost"
                : kakaoRedirectUri() || redirectUri;
              const result = await exchangeKakaoCode({
                data: {
                  restKey: config.kakaoRestKey,
                  code: extractKakaoCode(pasted),
                  redirectUri: redirect,
                },
              });
              setConfig({ kakaoRefreshToken: result.refreshToken });
              setKakaoCode("");
              toast.success("카카오가 연결되었습니다. 테스트로 확인해 보세요.");
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "카카오 연결 실패");
            }
          }}
        >
          카카오 연결
        </Button>
        {config.kakaoRefreshToken ? (
          <p className="mt-3 text-xs text-open">카카오 연결됨 · 나와의 채팅으로 갑니다</p>
        ) : null}
        <Button
          variant="outline"
          className="mt-3 w-full"
          disabled={!config.kakaoRefreshToken}
          onClick={async () => {
            try {
              await sendKakaoMemo({
                data: {
                  restKey: config.kakaoRestKey,
                  refreshToken: config.kakaoRefreshToken,
                  text: "오픈벨 카톡 연결 테스트입니다. 예매가 열리면 여기로 옵니다.",
                },
              });
              toast.success("나와의 채팅을 확인해 보세요.");
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "카톡 테스트 실패");
            }
          }}
        >
          카톡 테스트 보내기
        </Button>
      </ChannelCard>

      <ChannelCard
        embedded
        title="텔레그램으로 받기"
        summary={
          config.telegramToken && config.telegramChatId ? "연결됨" : "꺼짐"
        }
        open={showTelegram}
        onToggle={() => setShowTelegram((v) => !v)}
      >
        <p className="text-xs leading-relaxed text-muted">
          텔레그램에서 @BotFather → /newbot 으로 봇을 만들고 토큰을 붙입니다.
          그 봇을 연 다음 아무 말이나 보내세요. 채팅 ID는 봇 이름(@…)이 아니라
          숫자입니다. @userinfobot 의 Id 값을 복사하거나, 아래 찾기를 누르세요.
        </p>
        <label className="mt-3 block text-xs text-muted">봇 토큰</label>
        <input
          value={config.telegramToken}
          onChange={(e) => setConfig({ telegramToken: e.target.value })}
          placeholder="123456:ABC..."
          className="mt-1.5 h-11 w-full rounded-md bg-bg px-3 text-sm text-fg outline-none ring-1 ring-border focus:ring-border-strong"
        />
        <label className="mt-3 block text-xs text-muted">채팅 ID (숫자)</label>
        <input
          value={config.telegramChatId}
          onChange={(e) => setConfig({ telegramChatId: e.target.value })}
          placeholder="123456789"
          className="mt-1.5 h-11 w-full rounded-md bg-bg px-3 text-sm text-fg outline-none ring-1 ring-border focus:ring-border-strong"
        />
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            onClick={async () => {
              try {
                const hit = await peekTelegramChat({
                  data: { token: config.telegramToken },
                });
                setConfig({ telegramChatId: hit.chatId });
                toast.success(
                  hit.name
                    ? `${hit.name} 채팅 ID를 넣었습니다.`
                    : "채팅 ID를 넣었습니다.",
                );
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "찾지 못했습니다.");
              }
            }}
          >
            채팅 ID 찾기
          </Button>
          <Button
            variant="outline"
            onClick={async () => {
              try {
                await sendTelegram({
                  data: {
                    token: config.telegramToken,
                    chatId: config.telegramChatId,
                    text: "오픈벨 연결 테스트입니다.",
                  },
                });
                toast.success(
                  "텔레그램 테스트 전송. 감시 탭에서 포스터를 누르면, 새 상영이 열릴 때 여기로 옵니다.",
                );
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "전송 실패");
              }
            }}
          >
            텔레그램 테스트
          </Button>
        </div>
        {config.telegramToken && config.telegramChatId ? (
          <WatchAlertHint lastScan={lastScan} />
        ) : null}
      </ChannelCard>

      <ChannelCard
        embedded
        title="X로 올리기"
        summary={xEnabled(config) ? "연결됨 · @aerosmissive2" : "꺼짐"}
        open={showX}
        onToggle={() => setShowX((v) => !v)}
      >
        <p className="text-xs leading-relaxed text-muted">
          예매가 열리면{" "}
          <a
            href="https://x.com/aerosmissive2"
            target="_blank"
            rel="noreferrer"
            className="text-fg underline-offset-2 hover:underline"
          >
            홀드현알리미 @aerosmissive2
          </a>
          로 글이 올라갑니다. developer.x.com → 앱 →{" "}
          <span className="font-medium text-fg">Keys and tokens</span>에서
          복사하세요. 맨 위 <span className="font-medium text-fg">앱 전용 Bearer Token</span>은
          넣지 마세요.
        </p>
        <label className="mt-3 block text-xs text-muted">
          액세스 토큰 (필수)
        </label>
        <p className="mt-1 text-[11px] leading-relaxed text-faint">
          OAuth 2.0 키 칸의 액세스 토큰입니다. tweet.write가 있어야 하고,
          @aerosmissive2용이어야 합니다.
        </p>
        <input
          value={config.xAccessToken}
          onChange={(e) => setConfig({ xAccessToken: e.target.value })}
          placeholder="AAAA..."
          className="mt-1.5 h-11 w-full rounded-md bg-bg px-3 text-sm text-fg outline-none ring-1 ring-border focus:ring-border-strong"
        />
        <label className="mt-3 block text-xs text-muted">갱신 토큰</label>
        <p className="mt-1 text-[11px] leading-relaxed text-faint">
          같은 OAuth 2.0 키 칸의 Refresh Token입니다. 있으면 만료 뒤에도 이어서
          올립니다.
        </p>
        <input
          value={config.xRefreshToken}
          onChange={(e) => setConfig({ xRefreshToken: e.target.value })}
          type="password"
          className="mt-1.5 h-11 w-full rounded-md bg-bg px-3 text-sm text-fg outline-none ring-1 ring-border focus:ring-border-strong"
        />
        <label className="mt-3 block text-xs text-muted">클라이언트 ID</label>
        <p className="mt-1 text-[11px] leading-relaxed text-faint">
          OAuth 2.0 키 칸의 클라이언트 ID입니다. 갱신 토큰과 같이 씁니다.
        </p>
        <input
          value={config.xClientId}
          onChange={(e) => setConfig({ xClientId: e.target.value })}
          className="mt-1.5 h-11 w-full rounded-md bg-bg px-3 text-sm text-fg outline-none ring-1 ring-border focus:ring-border-strong"
        />
        <label className="mt-3 block text-xs text-muted">클라이언트 시크릿</label>
        <p className="mt-1 text-[11px] leading-relaxed text-faint">
          OAuth 2.0 키 칸의 클라이언트 시크릿입니다.
        </p>
        <input
          value={config.xClientSecret}
          onChange={(e) => setConfig({ xClientSecret: e.target.value })}
          type="password"
          className="mt-1.5 h-11 w-full rounded-md bg-bg px-3 text-sm text-fg outline-none ring-1 ring-border focus:ring-border-strong"
        />
        <Button
          variant="outline"
          className="mt-3 w-full"
          disabled={!xEnabled(config)}
          onClick={async () => {
            try {
              const posted = await sendXPost({
                data: {
                  accessToken: config.xAccessToken,
                  clientId: config.xClientId || undefined,
                  clientSecret: config.xClientSecret || undefined,
                  refreshToken: config.xRefreshToken || undefined,
                  text: "홀드현알리미 연결 테스트입니다. 예매가 열리면 여기로 올립니다.",
                },
              });
              if (posted.accessToken || posted.refreshToken) {
                setConfig({
                  xAccessToken: posted.accessToken || config.xAccessToken,
                  xRefreshToken: posted.refreshToken || config.xRefreshToken,
                });
              }
              toast.success("X에 올렸습니다.");
              window.open(posted.url, "_blank", "noopener,noreferrer");
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "X 올리기 실패");
            }
          }}
        >
          테스트 글 올리기
        </Button>
      </ChannelCard>
      </section>

      <section className="rounded-xl bg-surface p-4 shadow-border">
        <h2 className="text-xs font-medium tracking-[0.16em] text-muted">
          배경
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          라이트, 다크, 또는 기기 설정을 따릅니다.
        </p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {THEME_MODES.map((mode) => (
            <button
              key={mode.id}
              type="button"
              onClick={() => setConfig({ theme: mode.id })}
              className={cn(
                "min-h-11 rounded-md text-sm",
                (config.theme ?? "dark") === mode.id
                  ? "bg-pick text-fg ring-1 ring-border-strong"
                  : "bg-bg text-muted",
              )}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function ChannelCard({
  title,
  summary,
  open,
  onToggle,
  children,
  embedded = false,
}: {
  title: string;
  summary: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  embedded?: boolean;
}) {
  return (
    <div
      className={
        embedded
          ? "border-t border-border pt-3"
          : "rounded-xl bg-surface p-4 shadow-border"
      }
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex min-h-11 w-full items-center justify-between gap-3 text-left"
      >
        <div className="min-w-0">
          <h2 className="text-xs font-medium tracking-[0.16em] text-muted">
            {title}
          </h2>
          <p className="mt-1 truncate text-sm text-fg">{summary}</p>
        </div>
        <span className="shrink-0 text-xs text-muted">
          {open ? "접기" : "펼치기"}
        </span>
      </button>
      {open ? <div className="mt-3 border-t border-border pt-3">{children}</div> : null}
    </div>
  );
}

function CloudSettingsCard() {
  const { user, isPending } = useCurrentUserState();
  const [signingOut, setSigningOut] = useState(false);
  if (isPending) {
    return <div className="h-16 rounded-md bg-bg" />;
  }
  async function logout() {
    setSigningOut(true);
    try {
      forgetGasLink();
      await signOut("/");
    } catch (err) {
      setSigningOut(false);
      toast.error(err instanceof Error ? err.message : "로그아웃하지 못했습니다.");
    }
  }
  return (
    <div>
      <h2 className="text-xs font-medium tracking-[0.16em] text-muted">
        계정
      </h2>
      {user ? (
        <div className="mt-2 space-y-2 text-sm leading-relaxed text-muted">
          <p className="text-fg">
            {user.displayName ?? user.primaryEmail ?? "로그인됨"}
          </p>
          {user.primaryEmail && user.displayName ? (
            <p>{user.primaryEmail}</p>
          ) : null}
          <p>
            로그인하면 별표·메일·텔레그램·카톡·X가 이 계정에 저장됩니다. 그록
            서버와 구글 스크립트가 둘 다 알림을 보냅니다.
          </p>
          {authEnabled ? (
            <Button
              variant="outline"
              className="w-full"
              disabled={signingOut}
              onClick={() => {
                void logout();
              }}
            >
              {signingOut ? "나가는 중…" : "로그아웃"}
            </Button>
          ) : null}
        </div>
      ) : (
        <div>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            로그인하면 설정이 이 계정에 맞춰지고, 앱을 꺼도 알림이 갑니다.
          </p>
          <Link
            to="/login"
            className="mt-3 flex min-h-11 items-center justify-center rounded-md bg-pick text-sm text-fg ring-1 ring-border-strong"
          >
            로그인
          </Link>
        </div>
      )}
    </div>
  );
}

function WatchAlertHint({ lastScan }: { lastScan: ScanResult | null }) {
  const config = useAppStore((s) => s.config);
  const setTab = useAppStore((s) => s.setTab);
  const names = [
    ...(lastScan?.ranking ?? [])
      .filter((m) => config.ranks.includes(m.rank))
      .map((m) => m.title),
    ...(config.watchTitles ?? []),
  ].filter((name, i, arr) => arr.indexOf(name) === i);
  return (
    <div className="mt-3 space-y-1.5 text-xs leading-relaxed text-faint">
      <p>
        텔레그램 연결됨.{" "}
        {names.length
          ? `지금 감시: ${names.slice(0, 6).join(" · ")}`
          : "감시 탭에서 포스터를 눌러 영화를 고르세요."}
      </p>
      <p>
        이미 열린 상영은 보내지 않습니다. 새 날짜·새 시간이 열리면 옵니다.
        로그인돼 있으면 앱을 꺼도 텔레그램·메일로 갑니다. 웹앱 주소는 필요
        없습니다.
      </p>
      <button
        type="button"
        className="min-h-11 text-left text-muted underline-offset-2 hover:underline"
        onClick={() => setTab("watch")}
      >
        감시 영화 고르러 가기
      </button>
    </div>
  );
}

function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="mt-3 flex flex-col gap-2.5">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3 text-sm leading-relaxed text-muted">
          <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-medium tabular-nums text-fg">
            {i + 1}
          </span>
          <div className="min-w-0 pt-px">{item}</div>
        </li>
      ))}
    </ol>
  );
}

function AlertPathStatus() {
  const gasWebUrl = useAppStore((s) => s.config.gasWebUrl);
  const [kind, setKind] = useState<"both" | "grok" | "gas" | "wait" | "none">(
    "wait",
  );
  const [summary, setSummary] = useState("현황을 확인하는 중…");
  const [grokLine, setGrokLine] = useState("확인 중");
  const [gasLine, setGasLine] = useState("확인 중");
  const [dbLine, setDbLine] = useState("");
  const [notifyLine, setNotifyLine] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const url = gasWebUrl.trim();
      let grokReachable = false;
      let grokAlive = false;
      let ageMs: number | null = null;
      let dbLabel = "";
      let notifyBits = "";
      try {
        const res = await fetch("/api/watch-alive", {
          signal: AbortSignal.timeout(8000),
        });
        const json = (await res.json()) as {
          alive?: boolean;
          ageMs?: number | null;
          db?: string;
          lastNotify?: {
            at?: number;
            telegram?: string;
            kakao?: string;
            mail?: string;
            x?: string;
            webhook?: string;
          } | null;
        };
        grokReachable = res.ok;
        grokAlive = Boolean(json.alive);
        ageMs = typeof json.ageMs === "number" ? json.ageMs : null;
        dbLabel =
          json.db === "neon" ? "Neon (유지됨)" : json.db === "pglite" ? "임시 저장 (새로고침하면 사라질 수 있음)" : "";
        if (json.lastNotify?.at) {
          const bits = ["telegram", "kakao", "mail", "x", "webhook"]
            .map((key) => {
              const val = json.lastNotify?.[key as keyof NonNullable<typeof json.lastNotify>];
              if (!val) return "";
              const name =
                key === "telegram"
                  ? "텔레그램"
                  : key === "kakao"
                    ? "카톡"
                    : key === "mail"
                      ? "메일"
                      : key === "x"
                        ? "X"
                        : "웹훅";
              return `${name} ${val === "ok" ? "됨" : val}`;
            })
            .filter(Boolean);
          notifyBits = bits.length
            ? `${Math.max(1, Math.round((Date.now() - json.lastNotify.at) / 60000))}분 전 · ${bits.join(" · ")}`
            : "";
        }
      } catch {
        grokReachable = false;
      }
      let gasOk = false;
      let gasRecent = false;
      let gasAgeMs: number | null = null;
      if (url) {
        const health = await probeGasHealth(url);
        gasOk = Boolean(health?.ok);
        gasRecent = Boolean(health?.gasAlive);
        gasAgeMs =
          health && health.gasAgeMs > 0 ? health.gasAgeMs : null;
      }
      if (cancelled) return;
      const grokOn = grokReachable;
      const nextGrok = !grokReachable
        ? "확인 못 함"
        : grokAlive
          ? ageMs != null
            ? `작동 중 · ${Math.max(1, Math.round(ageMs / 60000))}분 전 조회`
            : "작동 중"
          : "연결됨 · 다음 주기 대기";
      const nextGas = !url
        ? "없음"
        : gasRecent
          ? gasAgeMs != null
            ? `작동 중 · ${Math.max(1, Math.round(gasAgeMs / 60000))}분 전 감시`
            : "작동 중"
          : gasOk
            ? "웹앱은 응답 · 감시 기록이 없습니다. 스크립트를 최신화하세요."
            : "웹앱이 응답하지 않습니다";
      setGrokLine(nextGrok);
      setGasLine(nextGas);
      setDbLine(dbLabel);
      setNotifyLine(notifyBits);
      if (grokOn && gasRecent) {
        setKind("both");
        setSummary("그록 서버와 구글 스크립트가 둘 다 알림을 보냅니다.");
        return;
      }
      if (grokOn) {
        setKind("grok");
        setSummary(
          !url
            ? "그록 서버만 알림을 보냅니다. 구글 스크립트가 없습니다."
            : gasRecent
              ? "그록 서버와 구글 스크립트가 둘 다 알림을 보냅니다."
              : "그록 서버가 알림을 보냅니다. 구글 스크립트 감시는 아직 확인되지 않았습니다.",
        );
        return;
      }
      if (gasRecent) {
        setKind("gas");
        setSummary("구글 스크립트가 알림을 보냅니다. 그록 서버는 확인하지 못했습니다.");
        return;
      }
      setKind("none");
      setSummary(
        url
          ? "그록 서버와 구글 스크립트 감시를 아직 확인하지 못했습니다."
          : "그록 서버를 아직 확인하지 못했습니다. 구글 스크립트가 없습니다.",
      );
    }
    void load();
    const timer = window.setInterval(() => {
      void load();
    }, 20000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [gasWebUrl]);

  return (
    <div
      className={cn(
        "mt-3 rounded-lg px-3 py-3 text-sm leading-relaxed",
        kind === "both"
          ? "bg-pick text-fg ring-1 ring-border-strong"
          : "bg-bg text-fg ring-1 ring-border",
        kind === "wait" && "text-muted",
      )}
    >
      <p className="text-[11px] font-medium tracking-[0.16em] text-muted">
        알림 경로
      </p>
      <p className="mt-1.5 font-medium text-fg">{summary}</p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted">그록 서버</dt>
        <dd className="text-fg">{grokLine}</dd>
        <dt className="text-muted">구글 스크립트</dt>
        <dd className="text-fg">{gasLine}</dd>
        {dbLine ? (
          <>
            <dt className="text-muted">설정 저장</dt>
            <dd className="text-fg">{dbLine}</dd>
          </>
        ) : null}
        {notifyLine ? (
          <>
            <dt className="text-muted">마지막 발송</dt>
            <dd className="text-fg">{notifyLine}</dd>
          </>
        ) : null}
      </dl>
    </div>
  );
}
