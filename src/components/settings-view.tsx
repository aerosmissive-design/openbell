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
import { SEAT_HELP, TIMETABLE_HELP, CHART_HELP, mailEnabled, normalizeHold, seatSourceLabel, timetableSourceLabel } from "@/lib/cinema/types";
import { HOLD_ZONE_OPTIONS } from "@/lib/cinema/hold";
import { THEME_MODES } from "@/lib/theme";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";
import { SettingsTheaterPicks } from "./theater-picks";

export function SettingsView({ lastScan }: { lastScan: ScanResult | null }) {
  const config = useAppStore((s) => s.config);
  const hold = normalizeHold(config.hold);
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
          베셀 서버에 문제가 있을 때도 알림을 받고 싶으면 예비로 켭니다.
          극장·잔여석 조회는 구글스크립트 없이 돌아갑니다.
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
        {notifyHealth.cgvRelay?.stale ? (
          <p className="mt-3 rounded-lg bg-bg px-3 py-2.5 text-sm leading-relaxed text-danger ring-1 ring-border">
            {relayOutageLine(notifyHealth.cgvRelay)}
          </p>
        ) : null}
        {showStatus ? (
          <>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          상영시간과 잔여석을 어디서 받았는지입니다. 구글스크립트는 없어도
          돌아갑니다. 막히면 다음으로 넘어갑니다.
        </p>
        <div className="mt-3 grid grid-cols-3 gap-x-3 gap-y-2 text-sm">
          <p className="text-xs text-muted">극장</p>
          <p className="text-xs text-muted">극장 현황</p>
          <p className="text-xs text-muted">잔여석 현황</p>
          {THEATERS.map((theater) => {
            const row = lastScan?.theaters.find((t) => t.theaterId === theater.id);
            const seatLabel = seatSourceLabel(row?.seatSource);
            const seatEmpty = theater.chain === "cgv" && seatLabel === "없음";
            return (
              <Fragment key={theater.id}>
                <p className="text-fg">{theater.shortName}</p>
                <p className="text-muted">
                  {timetableSourceLabel(row?.source ?? "", row?.ok ?? true)}
                </p>
                <p
                  className={
                    seatEmpty && notifyHealth.cgvRelay?.stale
                      ? "text-danger"
                      : "text-muted"
                  }
                >
                  {seatLabel}
                </p>
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
          좌석 홀드
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          지금 알림은 그대로입니다. 예매를 누르면 좌석을 찍고 결제 화면까지만
          갑니다. 결제는 극장에서 직접 합니다.
        </p>
        <div className="mt-3">
          <Switch
            checked={hold.enabled}
            onCheckedChange={(on) =>
              setConfig({ hold: normalizeHold({ ...hold, enabled: on }) })
            }
            label={hold.enabled ? "홀드 켜짐" : "홀드 꺼짐"}
          />
        </div>
        <h3 className="mt-5 text-xs font-medium tracking-[0.16em] text-muted">
          인원
        </h3>
        <div className="mt-3 grid grid-cols-4 gap-1.5">
          {[1, 2, 3, 4].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() =>
                setConfig({ hold: normalizeHold({ ...hold, seats: n }) })
              }
              className={cn(
                "min-h-11 rounded-md text-sm tabular-nums",
                hold.seats === n
                  ? "bg-pick text-fg ring-1 ring-border-strong"
                  : "bg-bg text-muted",
              )}
            >
              {n}명
            </button>
          ))}
        </div>
        <h3 className="mt-5 text-xs font-medium tracking-[0.16em] text-muted">
          선호 구역
        </h3>
        <div className="mt-3 grid grid-cols-3 gap-1.5">
          {HOLD_ZONE_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() =>
                setConfig({ hold: normalizeHold({ ...hold, zone: opt.id }) })
              }
              className={cn(
                "min-h-11 rounded-md text-sm",
                hold.zone === opt.id
                  ? "bg-pick text-fg ring-1 ring-border-strong"
                  : "bg-bg text-muted",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <h3 className="mt-5 text-xs font-medium tracking-[0.16em] text-muted">
          홀드 시간
        </h3>
        <div className="mt-3 grid grid-cols-3 gap-1.5">
          {[5, 10, 15].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() =>
                setConfig({ hold: normalizeHold({ ...hold, minutes: n }) })
              }
              className={cn(
                "min-h-11 rounded-md text-sm tabular-nums",
                hold.minutes === n
                  ? "bg-pick text-fg ring-1 ring-border-strong"
                  : "bg-bg text-muted",
              )}
            >
              {n}분
            </button>
          ))}
        </div>
        <div className="mt-4">
          <Switch
            checked={hold.autoOpen}
            onCheckedChange={(on) =>
              setConfig({ hold: normalizeHold({ ...hold, autoOpen: on }) })
            }
            label="알림 때 좌석 화면 열기"
          />
        </div>
        <p className="mt-2 text-xs leading-relaxed text-faint">
          켜면 예매 오픈·잔여석 알림이 올 때 극장 좌석 화면을 띄웁니다. 팝업이
          막히면 홀드에서 직접 누르세요.
        </p>
      </section>

      <section className="rounded-xl bg-surface p-4 shadow-border">
        <h2 className="text-xs font-medium tracking-[0.16em] text-muted">
          알림 설정
        </h2>
        <h3 className="mt-4 text-xs font-medium tracking-[0.16em] text-muted">
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
          베셀 서버가 알림을 보냅니다. 구글스크립트는 예비이며, 없어도
          극장·잔여석 조회는 돌아갑니다. 베셀은 깃허브가 5분마다 깨웁니다.
        </p>
        <AlertPathStatus health={notifyHealth} />

      <ChannelCard
        embedded
        flush
        title="메일로 받기"
        summary={
          !user
            ? "로그인 필요"
            : mailEnabled(config)
              ? `연결됨 · ${loginEmail || config.email}`
              : "꺼짐"
        }
        detail={
          user && mailEnabled(config)
            ? channelWorkLine("mail", notifyHealth)
            : undefined
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
            <label className="mt-4 block text-xs text-muted">
              웹(베셀) 메일용 앱 비밀번호
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
              구글 2단계 인증을 켠 뒤
              myaccount.google.com/apppasswords 에서 만듭니다. 로그인 6자리
              인증번호가 아닙니다. 베셀이 직접 메일을 보낼 때 필요합니다.
              스크립트만 쓰면 비워도 됩니다.
            </p>
            <a
              href="https://myaccount.google.com/apppasswords"
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex min-h-11 items-center text-xs text-fg underline-offset-2 hover:underline"
            >
              앱 비밀번호 만들기
            </a>
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
              스크립트가 있으면 그걸로 보냅니다. 없으면 16자리 앱 비밀번호가
              필요합니다. 로그인 인증번호와는 다릅니다.
            </p>
          </div>
        )}
      </ChannelCard>

      <ChannelCard
        embedded
        title="카톡으로 받기"
        summary={config.kakaoRefreshToken ? "연결됨" : "꺼짐"}
        detail={
          config.kakaoRefreshToken
            ? channelWorkLine("kakao", notifyHealth)
            : undefined
        }
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
        detail={
          config.telegramToken && config.telegramChatId
            ? channelWorkLine("telegram", notifyHealth)
            : undefined
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
  detail,
  open,
  onToggle,
  children,
  embedded = false,
  flush = false,
}: {
  title: string;
  summary: string;
  detail?: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  embedded?: boolean;
  flush?: boolean;
}) {
  return (
    <div
      className={
        embedded
          ? flush
            ? "pt-3"
            : "border-t border-border pt-3"
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
          <p className="mt-1 text-sm text-fg">{summary}</p>
          {detail ? (
            <p className="mt-0.5 text-[10px] leading-4 text-muted">{detail}</p>
          ) : null}
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
            로그인하면 별표·메일·텔레그램·카톡이 이 계정에 저장됩니다. 베셀
            서버가 알림을 보냅니다. 구글스크립트는 예비이며 없어도 됩니다.
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

type AliveProbe = {
  reachable: boolean;
  alive: boolean;
  ageMs: number | null;
  githubWakeAlive?: boolean;
  githubWakeAgeMs?: number | null;
  lastNotify: {
    at?: number;
    mail?: string;
    telegram?: string;
    kakao?: string;
    x?: string;
  } | null;
};

type CgvRelayHealth = {
  empty: boolean;
  since: number | null;
  durationMs: number;
  theaters: string[];
  stale: boolean;
};

type NotifyHealth = {
  vercel: AliveProbe;
  gasOk: boolean;
  gasAlive: boolean;
  gasAgeMs: number;
  gasNotify: AliveProbe["lastNotify"];
  dbLine: string;
  cgvRelay: CgvRelayHealth | null;
};

const emptyProbe: AliveProbe = {
  reachable: false,
  alive: false,
  ageMs: null,
  lastNotify: null,
};

function agoLabel(at?: number | null, ageMs?: number | null) {
  const ms = at ? Date.now() - at : ageMs;
  if (ms == null || ms < 0) return "";
  return `${Math.max(1, Math.round(ms / 60000))}분 전`;
}

function watchLine(probe: AliveProbe) {
  if (!probe.reachable) return "확인 못 함";
  if (probe.alive) return "켜짐";
  return "다음 주기 대기";
}

function queryLine(probe: AliveProbe) {
  if (!probe.reachable) return "확인 못 함";
  if (probe.ageMs != null) return agoLabel(null, probe.ageMs);
  if (probe.alive) return "대기";
  return "아직 없음";
}

function githubWakeLine(probe: AliveProbe) {
  if (probe.githubWakeAlive) {
    return probe.githubWakeAgeMs != null
      ? `됨 ${agoLabel(null, probe.githubWakeAgeMs)}`
      : "됨";
  }
  if (probe.reachable) return "아직 없음";
  return "확인 못 함";
}

function channelShot(
  on: boolean,
  result?: string,
  at?: number,
) {
  if (!on) return "꺼짐";
  if (!result || result === "off") return "대기";
  const when = agoLabel(at);
  if (result === "ok") return when ? `됨 ${when}` : "됨";
  return when ? `실패 ${when}` : "실패";
}

function channelWorkLine(
  key: "mail" | "telegram" | "kakao",
  health: NotifyHealth,
) {
  return [
    `베셀 ${channelShot(true, health.vercel.lastNotify?.[key], health.vercel.lastNotify?.at)}`,
    `스크립트 ${
      health.gasNotify
        ? channelShot(true, health.gasNotify[key], health.gasNotify.at)
        : health.gasOk
          ? "대기"
          : "확인 못 함"
    }`,
  ].join(" · ");
}

async function probeWatchAlive(url: string): Promise<AliveProbe> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { ...emptyProbe };
    const json = (await res.json()) as {
      alive?: boolean;
      ageMs?: number | null;
      githubWakeAlive?: boolean;
      githubWakeAgeMs?: number | null;
      lastNotify?: AliveProbe["lastNotify"];
    };
    return {
      reachable: true,
      alive: Boolean(json.alive),
      ageMs: typeof json.ageMs === "number" ? json.ageMs : null,
      githubWakeAlive: Boolean(json.githubWakeAlive),
      githubWakeAgeMs:
        typeof json.githubWakeAgeMs === "number" ? json.githubWakeAgeMs : null,
      lastNotify: json.lastNotify ?? null,
    };
  } catch {
    return { ...emptyProbe };
  }
}

function useNotifyHealth(config: WatchConfig): NotifyHealth {
  const [health, setHealth] = useState<NotifyHealth>({
    vercel: emptyProbe,
    gasOk: false,
    gasAlive: false,
    gasAgeMs: 0,
    gasNotify: null,
    dbLine: "pending",
    cgvRelay: null,
  });
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const url = config.gasWebUrl.trim();
      const here = window.location.hostname.includes("vercel.app");
      const local = await probeWatchAlive("/api/watch-alive");
      const vercel = here
        ? local
        : await probeWatchAlive(
            "https://openbell-fawn.vercel.app/api/watch-alive",
          );
      let dbLine = "";
      let relay: CgvRelayHealth | null = null;
      try {
        const res = await fetch("/api/watch-alive", {
          signal: AbortSignal.timeout(8000),
        });
        const json = (await res.json()) as {
          alive?: boolean;
          ageMs?: number | null;
          githubWakeAlive?: boolean;
          githubWakeAgeMs?: number | null;
          lastNotify?: AliveProbe["lastNotify"];
          db?: string;
          cgvRelay?: CgvRelayHealth;
        };
        dbLine =
          json.db === "neon"
            ? "neon"
            : json.db === "pglite"
              ? "pglite"
              : "";
        relay = json.cgvRelay ?? null;
      } catch {
        dbLine = "pending";
      }
      const gas = url ? await probeGasHealth(url) : null;
      if (cancelled) return;
      setHealth({
        vercel,
        gasOk: Boolean(gas?.ok),
        gasAlive: Boolean(gas?.gasAlive),
        gasAgeMs: Number(gas?.gasAgeMs || 0),
        gasNotify: gas?.lastNotify ?? null,
        dbLine,
        cgvRelay: relay,
      });
    }
    void load();
    const timer = window.setInterval(() => {
      void load();
    }, 20000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [config.gasWebUrl]);
  return health;
}

function durationLabel(ms: number) {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `${min}분째`;
  const hours = Math.floor(min / 60);
  const rest = min % 60;
  return rest ? `${hours}시간 ${rest}분째` : `${hours}시간째`;
}

function relayOutageLine(watch: CgvRelayHealth) {
  const names =
    watch.theaters
      .map((id) => THEATERS.find((row) => row.id === id)?.shortName)
      .filter(Boolean)
      .join("·") || "용산·영등포";
  return `${names} 잔여석 우회조회가 ${durationLabel(watch.durationMs)} 막혀 있습니다. 시간표는 네이버로 유지됩니다.`;
}

function PathLine({
  title,
  watch,
  query,
  github,
}: {
  title: string;
  watch: string;
  query: string;
  github?: string;
}) {
  return (
    <>
      <span className="font-medium text-fg">{title}</span>
      <span>{watch}</span>
      <span>{query}</span>
      <span>{github ?? "—"}</span>
    </>
  );
}

function AlertPathStatus({ health }: { health: NotifyHealth }) {
  const n =
    Number(health.vercel.alive || health.vercel.reachable) +
    Number(health.gasAlive);
  const summary =
    n >= 2
      ? "베셀 서버, 구글스크립트(예비)가 이중으로 알림을 보냅니다. 같은 오픈이 두 번 갈 수 있습니다."
      : health.vercel.reachable || health.vercel.alive
        ? "베셀 서버가 알림을 보냅니다. 구글스크립트는 없어도 됩니다."
        : health.gasAlive
          ? "구글스크립트(예비)가 알림을 보냅니다. 베셀은 확인하지 못했습니다."
          : "알림 경로를 확인하는 중입니다.";
  const dbTitle =
    health.dbLine === "pglite" ? "임시 저장" : "Neon";
  const dbValue =
    health.dbLine === "neon"
      ? "유지됨"
      : health.dbLine === "pglite"
        ? "새로고침하면 사라질 수 있음"
        : "확인 중";
  return (
    <div className="mt-3 rounded-lg bg-bg px-3 py-2.5 text-fg ring-1 ring-border">
      <p className="text-sm font-semibold leading-none text-fg">알림 경로</p>
      <p className="mt-1.5 text-[11px] leading-4 text-muted">{summary}</p>
      <div className="mt-2 grid grid-cols-[5.6rem_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,0.9fr)] gap-x-2 gap-y-1 text-[10px] leading-4 text-fg">
        <span />
        <span className="text-muted">24시간 감시</span>
        <span className="text-muted">극장시간표 조회</span>
        <span className="text-muted">깃허브 깨움</span>
        <PathLine
          title="베셀"
          watch={watchLine(health.vercel)}
          github={githubWakeLine(health.vercel)}
          query={queryLine(health.vercel)}
        />
        <PathLine
          title="구글스크립트(예비)"
          watch={
            health.gasAlive
              ? "켜짐"
              : health.gasOk
                ? "웹앱 응답"
                : "확인 못 함"
          }
          query={
            health.gasAlive && health.gasAgeMs > 0
              ? agoLabel(null, health.gasAgeMs)
              : health.gasOk
                ? "아직 없음"
                : "확인 못 함"
          }
        />
        <span className="font-medium text-fg">{dbTitle}</span>
        <span className="col-span-3">{dbValue}</span>
      </div>
    </div>
  );
}

