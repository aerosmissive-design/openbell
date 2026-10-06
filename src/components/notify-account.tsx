import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { KAKAO_BUSINESS_NOTICE } from "@/lib/notify/policy";
import { loadNotifySettings, saveNotifySettings, sendNotifyTest, verifyNotifyTelegram } from "@/lib/notify/settings";
import type { MailProvider, NotifySettingsView } from "@/lib/notify/types";
import { cn } from "@/lib/utils";
import { settingsActionClass } from "./settings-controls";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch";

const inputClass = "mt-1.5 h-11 w-full rounded-md bg-bg px-3 text-sm text-fg outline-none ring-1 ring-border";

export function NotifyAccountPanel() {
  const { user, isPending } = useCurrentUserState();
  const [view, setView] = useState<NotifySettingsView | null>(null);
  const [token, setToken] = useState("");
  const [mailSecret, setMailSecret] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancel = false;
    void loadNotifySettings()
      .then((row) => {
        if (!cancel) setView(row);
      })
      .catch(() => {
        if (!cancel) setView(null);
      });
    return () => {
      cancel = true;
    };
  }, [user]);

  if (isPending) return null;
  if (!user) {
    return (
      <div className="border-t border-border pt-3 text-sm text-muted">
        계정별 알림은 로그인한 뒤에 저장됩니다. 위의 메일·카톡·텔레그램 카드는 그대로 동작합니다.
      </div>
    );
  }
  if (!view) {
    return <p className="border-t border-border pt-3 text-sm text-muted">계정 알림 설정을 불러오지 못했습니다.</p>;
  }

  function patch(partial: Partial<NotifySettingsView>) {
    setView((prev) => (prev ? { ...prev, ...partial } : prev));
  }

  async function save() {
    if (!view) return;
    setBusy(true);
    try {
      const saved = await saveNotifySettings({
        data: {
          telegramEnabled: view.telegramEnabled,
          telegramChatId: view.telegramChatId,
          telegramToken: token,
          mailProvider: view.mailProvider,
          mailAddress: view.mailAddress,
          mailCredential: mailSecret,
          mailEnabled: view.mailEnabled,
          kakaoChannelId: view.kakaoChannelId,
          gasMailEnabled: view.gasMailEnabled,
          gasWebUrl: view.gasWebUrl,
          notifyPaymentReady: view.notifyPaymentReady,
          notifyDailyReport: view.notifyDailyReport,
          notifyErrorAlert: view.notifyErrorAlert,
          notifySettlement: view.notifySettlement,
        },
      });
      setView(saved);
      setToken("");
      setMailSecret("");
      toast.success("계정 알림을 저장했습니다. 텔레그램은 연결 테스트 후에만 발송됩니다.");
    } catch (err) {
      toast.error(err instanceof Error && err.message === "FORBIDDEN" ? "본인 설정만 저장할 수 있습니다." : "저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (!view) return;
    setBusy(true);
    try {
      const saved = await saveNotifySettings({
        data: {
          telegramEnabled: true,
          telegramChatId: view.telegramChatId,
          telegramToken: token,
          mailProvider: view.mailProvider,
          mailAddress: view.mailAddress,
          mailCredential: mailSecret,
          mailEnabled: view.mailEnabled,
          kakaoChannelId: view.kakaoChannelId,
          gasMailEnabled: view.gasMailEnabled,
          gasWebUrl: view.gasWebUrl,
          notifyPaymentReady: view.notifyPaymentReady,
          notifyDailyReport: view.notifyDailyReport,
          notifyErrorAlert: view.notifyErrorAlert,
          notifySettlement: view.notifySettlement,
        },
      });
      const result = await verifyNotifyTelegram({ data: { chatId: view.telegramChatId } });
      if (!result.ok) {
        setView(saved);
        toast.error(result.error);
        return;
      }
      setView({ ...saved, telegramVerified: true, telegramEnabled: true });
      setToken("");
      setMailSecret("");
      toast.success("텔레그램 연결을 확인했습니다.");
    } catch {
      toast.error("텔레그램 연결 확인에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function testSend() {
    setBusy(true);
    try {
      const result = await sendNotifyTest({ data: { eventType: "PAYMENT_READY" } });
      const failed = result.results.filter((row) => !row.ok);
      if (result.results.length === 0) toast.message("보낼 채널이 없습니다. 저장하고 켠 뒤 다시 누르세요.");
      else if (failed.length === 0) toast.success("테스트 알림을 보냈습니다. 실제 예매 정보는 없습니다.");
      else toast.error(failed.map((row) => row.error || row.channel).join(" · "));
    } catch {
      toast.error("테스트 알림을 보내지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-t border-border pt-3">
      <h2 className="text-xs font-medium tracking-[0.16em] text-muted">계정 알림</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">{view.duplicateNotice}</p>
      <p className="mt-1 text-sm leading-relaxed text-muted">저장하면 이 계정 설정이 서버 환경변수보다 우선합니다. 비밀값은 **** 로만 보여 줍니다.</p>

      <div className="mt-3">
        <Switch label="텔레그램" checked={view.telegramEnabled} onCheckedChange={(telegramEnabled) => patch({ telegramEnabled })} />
        <p className="text-xs text-muted">{view.telegramVerified ? "연결됨" : "연결 테스트 전"}{view.telegramTokenSet ? " · 토큰 저장됨" : ""}</p>
        <input value={token} onChange={(e) => setToken(e.target.value)} placeholder={view.telegramTokenSet ? "****" : "봇 토큰"} type="password" autoComplete="off" className={inputClass} />
        <input value={view.telegramChatId} onChange={(e) => patch({ telegramChatId: e.target.value })} placeholder="채팅 ID" className={inputClass} />
        <Button className={cn(settingsActionClass, "mt-2")} disabled={busy} onClick={() => void verify()}>연결 테스트</Button>
      </div>

      <div className="mt-4">
        <Switch label="직접 메일 (메인)" checked={view.mailEnabled} onCheckedChange={(mailEnabled) => patch({ mailEnabled })} />
        <select value={view.mailProvider} onChange={(e) => patch({ mailProvider: e.target.value as MailProvider })} className={inputClass}>
          <option value="none">사용 안 함</option>
          <option value="gmail_smtp">Gmail 앱 비밀번호</option>
          <option value="resend">Resend</option>
        </select>
        <input value={view.mailAddress} onChange={(e) => patch({ mailAddress: e.target.value })} placeholder="메일 주소" className={inputClass} />
        <input value={mailSecret} onChange={(e) => setMailSecret(e.target.value)} placeholder={view.mailCredentialSet ? "****" : "앱 비밀번호 또는 API 키"} type="password" autoComplete="off" className={inputClass} />
      </div>

      <div className="mt-4">
        <Switch label="GAS 메일 (예비)" checked={view.gasMailEnabled} onCheckedChange={(gasMailEnabled) => patch({ gasMailEnabled })} />
        <input value={view.gasWebUrl} onChange={(e) => patch({ gasWebUrl: e.target.value })} placeholder="스크립트 웹앱 /exec 주소" className={inputClass} />
      </div>

      <div className="mt-4">
        <p className="text-sm text-fg">카카오 알림톡 · 지원 예정</p>
        <p className="mt-1 text-sm leading-relaxed text-muted">{KAKAO_BUSINESS_NOTICE}</p>
        <input value={view.kakaoChannelId} onChange={(e) => patch({ kakaoChannelId: e.target.value })} placeholder="채널 ID (저장만, 발송 안 함)" disabled className={inputClass} />
      </div>

      <div className="mt-4 space-y-1">
        <Switch label="결제 준비" checked={view.notifyPaymentReady} onCheckedChange={(notifyPaymentReady) => patch({ notifyPaymentReady })} />
        <Switch label="일일 리포트" checked={view.notifyDailyReport} onCheckedChange={(notifyDailyReport) => patch({ notifyDailyReport })} />
        <Switch label="오류" checked={view.notifyErrorAlert} onCheckedChange={(notifyErrorAlert) => patch({ notifyErrorAlert })} />
        <Switch label="정산" checked={view.notifySettlement} onCheckedChange={(notifySettlement) => patch({ notifySettlement })} />
      </div>

      <Button className={cn(settingsActionClass, "mt-3")} disabled={busy} onClick={() => void save()}>{busy ? "저장 중…" : "계정 알림 저장"}</Button>
      <Button className={cn(settingsActionClass, "mt-2")} disabled={busy} onClick={() => void testSend()}>테스트 발송 (가짜 내용)</Button>
    </div>
  );
}
