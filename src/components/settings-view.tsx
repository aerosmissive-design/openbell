import { ExternalLink } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { authEnabled, signOut } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { extractKakaoCode, kakaoRedirectUri } from "@/lib/cinema/kakao";
import { exchangeKakaoCode, peekTelegramChat, sendAlertEmail, sendKakaoMemo, sendTelegram } from "@/lib/cinema/scan";
import { THEATERS } from "@/lib/cinema/theaters";
import type { ScanResult, ScanStage } from "@/lib/cinema/types";
import { SCAN_STAGE_META, mailEnabled, normalizeScanSources, sourceLabel } from "@/lib/cinema/types";
import { THEME_MODES } from "@/lib/theme";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";

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
  const sources = normalizeScanSources(config.scanSources);

  function toggleSource(id: ScanStage, on: boolean) {
    const next = { ...sources, [id]: on };
    if (!next.official && !next.naver && !next.gas) {
      toast.error("조회 단계는 하나 이상 켜 두세요.");
      return;
    }
    setConfig({ scanSources: next });
  }

  const [redirectUri, setRedirectUri] = useState("");

  useEffect(() => {
    setRedirectUri(kakaoRedirectUri());
  }, []);

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

  async function enableNotify() {
    if (typeof Notification === "undefined") {
      setConfig({ browserNotify: true });
      toast(
        "아이폰 사파리에서는 시스템 팝업이 없습니다. 화면이 열려 있으면 앱 안에서 뜨고, 꺼져 있으면 메일·텔레그램으로 갑니다.",
      );
      return;
    }
    const perm = await Notification.requestPermission();
    setConfig({ browserNotify: perm === "granted" });
    if (perm !== "granted") {
      toast("알림 권한이 꺼져 있습니다. 화면이 열려 있으면 앱 안에서만 뜹니다.");
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

  return (
    <div className="flex flex-col gap-6">
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
      <CloudSettingsCard />

      <section className="rounded-xl bg-surface p-4 shadow-border">
        <h2 className="text-xs font-medium tracking-[0.16em] text-muted">
          조회 순서
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          위에서부터 순서대로 봅니다. 그 단계가 막히거나 비어 있으면 다음으로
          넘어갑니다.
        </p>
        <p className="mt-1.5 text-xs leading-relaxed text-faint">
          메가박스 공홈은 이 서버에서 자주 막힙니다. 예전에 쓰던 구글 스크립트
          웹앱은 구글에서 조회해서 안 막힙니다. /exec 로 끝나는 주소를 붙이면
          코엑스·남양주 시간표를 거기서 가져옵니다.
        </p>
        <label className="mt-3 block">
          <span className="text-xs text-muted">구글 스크립트 웹앱</span>
          <input
            value={config.gasWebUrl}
            onChange={(e) => setConfig({ gasWebUrl: e.target.value.trim() })}
            placeholder="https://script.google.com/macros/s/…/exec"
            className="mt-1 min-h-11 w-full rounded-md bg-bg px-3 text-sm text-fg ring-1 ring-border"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
          />
        </label>
        <div className="mt-3 flex flex-col gap-3">
          {SCAN_STAGE_META.map((stage) => (
            <div
              key={stage.id}
              className="rounded-md bg-bg px-3 py-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-fg">
                    <span className="mr-1.5 tabular-nums text-muted">
                      {stage.step}.
                    </span>
                    {stage.title}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-faint">
                    {stage.body}
                  </p>
                </div>
                <Switch
                  checked={sources[stage.id]}
                  onCheckedChange={(on) => toggleSource(stage.id, on)}
                />
              </div>
            </div>
          ))}
        </div>
        {lastScan?.theaters.length ? (
          <p className="mt-3 text-xs leading-relaxed text-faint">
            방금 조회:{" "}
            {lastScan.theaters
              .map((t) => {
                const name =
                  THEATERS.find((x) => x.id === t.theaterId)?.shortName ??
                  t.theaterId;
                const tag = t.ok ? sourceLabel(t.source) : "실패";
                return `${name} ${tag}`;
              })
              .join(" · ")}
          </p>
        ) : null}
      </section>

      <section className="rounded-xl bg-surface p-4 shadow-border">
        <h2 className="text-xs font-medium tracking-[0.16em] text-muted">주기</h2>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {[1, 5, 10].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setConfig({ intervalMin: n })}
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
              onClick={() => setConfig({ daysAhead: n })}
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
      </section>

      <section className="rounded-xl bg-surface p-4 shadow-border">
        <h2 className="text-xs font-medium tracking-[0.16em] text-muted">
          앱을 꺼도 알림
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          로그인만 하면 됩니다. 아래 채널을 켜 두면 화면을 닫아도 서버가
          5분마다 조회해 보냅니다.
        </p>
        <div className="mt-3">
          <Switch
            checked={config.browserNotify}
            onCheckedChange={(on) => {
              if (on) void enableNotify();
              else setConfig({ browserNotify: false });
            }}
            label="이 화면이 열려 있을 때 앱 안 알림"
          />
        </div>
        <p className="mt-2 text-xs leading-relaxed text-faint">
          아이폰 사파리에서는 시스템 팝업이 없습니다. 홈 화면에 추가한 뒤에만
          팝업이 되고, 그 전에는 메일·텔레그램으로 받으세요.
        </p>
      </section>

      <ChannelCard
        title="메일로 받기"
        summary={
          !user
            ? "로그인 필요"
            : mailEnabled(config)
              ? `켜짐 · ${loginEmail || config.email}`
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
            <label className="mt-4 block text-xs text-muted">
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
              구글 계정 → 보안 → 2단계 인증 → 앱 비밀번호에서 메일용 16자리를
              만들어 붙이면, 스크립트 없이 바로 갑니다.
            </p>
            <a
              href="https://myaccount.google.com/apppasswords"
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex min-h-11 items-center text-xs text-fg underline-offset-2 hover:underline"
            >
              앱 비밀번호 만들기
              <ExternalLink className="ml-1 size-3.5" strokeWidth={1.75} />
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
              앱 비밀번호가 없으면 첫 메일에 확인 링크가 올 수 있습니다.
            </p>
          </div>
        )}
      </ChannelCard>

      <ChannelCard
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
                  "텔레그램 테스트 전송. 감시 탭에서 포스터를 누르면, 새 회차가 열릴 때 여기로 옵니다.",
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
    </div>
  );
}

function ChannelCard({
  title,
  summary,
  open,
  onToggle,
  children,
}: {
  title: string;
  summary: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl bg-surface p-4 shadow-border">
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
    </section>
  );
}

function CloudSettingsCard() {
  const { user, isPending } = useCurrentUserState();
  const [signingOut, setSigningOut] = useState(false);
  if (isPending) {
    return <div className="h-24 rounded-xl bg-surface shadow-border" />;
  }
  async function logout() {
    setSigningOut(true);
    try {
      await signOut("/");
    } catch (err) {
      setSigningOut(false);
      toast.error(err instanceof Error ? err.message : "로그아웃하지 못했습니다.");
    }
  }
  return (
    <section className="rounded-xl bg-surface p-4 shadow-border">
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
            로그인만 하면 별표·메일·텔레그램·카톡이 이 계정에 저장됩니다.
            고치면 바로 반영되고, 앱을 꺼도 알림이 갑니다. 스크립트는 필요
            없습니다.
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
    </section>
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
        이미 열린 회차는 보내지 않습니다. 새 날짜·새 시간이 열리면 옵니다.
        로그인돼 있으면 앱을 꺼도 텔레그램·메일로 갑니다. 메가박스가 비면
        설정에 구글 스크립트 웹앱 주소를 붙여 주세요.
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
          <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[11px] font-medium tabular-nums text-fg">
            {i + 1}
          </span>
          <div className="min-w-0 pt-px">{item}</div>
        </li>
      ))}
    </ol>
  );
}
