import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AUTO_PAY_KEY, BOOKING_DEVICES, BOOKING_DEVICE_KEY, NOTIFY_EMAIL_KEY, autoPayEnabled, bookingDeviceName, notifyMailbox, type BookingDevice } from "@/lib/cinema/booking-link";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { flushSettings } from "./cloud-sync";
import { settingsActionClass, settingsChoiceClass } from "./settings-controls";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

type Freshness = "ONLINE" | "DELAYED" | "OFFLINE" | "NONE";

function hm(iso: string) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t) || t <= 0) return "";
  return new Date(t).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Seoul" });
}

function freshnessOf(iso: string): Freshness {
  const t = Date.parse(iso);
  if (!Number.isFinite(t) || t <= 0) return "NONE";
  const age = Date.now() - t;
  if (age <= 2 * 60 * 1000) return "ONLINE";
  if (age <= 5 * 60 * 1000) return "DELAYED";
  return "OFFLINE";
}

function dot(state: Freshness) {
  return cn(
    "inline-block size-2 rounded-full",
    state === "ONLINE" && "bg-emerald-500",
    state === "DELAYED" && "bg-amber-400",
    state === "OFFLINE" && "bg-red-500",
    state === "NONE" && "bg-zinc-500",
  );
}

function label(state: Freshness) {
  if (state === "ONLINE") return "켜짐";
  if (state === "DELAYED") return "지연";
  if (state === "OFFLINE") return "꺼짐";
  return "없음";
}

function readStored(key: string) {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function writeStored(key: string, value: string) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* 브라우저가 저장을 막으면 이번 화면만 유지한다 */
  }
}

export function DevicePanel() {
  const { user } = useCurrentUserState();
  const setConfig = useAppStore((s) => s.setConfig);
  const [seen, setSeen] = useState<Record<string, string>>({});
  const [connected, setConnected] = useState<BookingDevice | "">("");
  const [email, setEmail] = useState("");
  const [autoPay, setAutoPay] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setConnected(bookingDeviceName(readStored(BOOKING_DEVICE_KEY)));
    setEmail(readStored(NOTIFY_EMAIL_KEY));
    setAutoPay(autoPayEnabled(readStored(AUTO_PAY_KEY)));
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function reload() {
      const res = await fetch("/api/device/seen", { credentials: "include" });
      if (!res.ok) return;
      const data = (await res.json()) as { agents?: { name?: string; seenAt?: string }[] };
      if (cancelled) return;
      const next: Record<string, string> = {};
      for (const row of data.agents || []) {
        const name = bookingDeviceName(row.name);
        if (name) next[name] = String(row.seenAt || "");
      }
      setSeen(next);
    }
    const timer = window.setInterval(() => void reload().catch(() => undefined), 20_000);
    void reload().catch(() => undefined);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  function connect(name: BookingDevice) {
    writeStored(BOOKING_DEVICE_KEY, name);
    setConnected(name);
    toast.success(`${name}에 연결했습니다. 이제 자동예매가 이 기기로 갑니다.`);
  }

  function chooseAutoPay(on: boolean) {
    writeStored(AUTO_PAY_KEY, on ? "on" : "");
    setAutoPay(on);
    toast.success(on ? "자동결제를 켰습니다. 최종 결제 버튼을 누릅니다." : "자동결제를 껐습니다. 최종 결제 버튼은 직접 누릅니다.");
  }

  function disconnect() {
    writeStored(BOOKING_DEVICE_KEY, "");
    setConnected("");
    toast.success("기기 연결을 해제했습니다.");
  }

  async function registerEmail() {
    const mailbox = notifyMailbox(email);
    if (!mailbox) {
      toast.error("메일 주소를 확인하세요.");
      return;
    }
    setBusy(true);
    try {
      writeStored(NOTIFY_EMAIL_KEY, mailbox);
      setEmail(mailbox);
      setConfig({ email: mailbox, emailNotify: true });
      const gas = await flushSettings(Boolean(user));
      if (gas.status === "ok") toast.success("알림 메일을 등록했습니다.");
      else toast.success("이 브라우저에 알림 메일을 저장했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-5 border-t border-border pt-4">
      <h2 className="text-xs font-medium tracking-[0.16em] text-muted">에이전트</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">켜진 기기가 보이면 연결을 누르세요. 연결 전에는 자동예매가 가지 않습니다.</p>
      <div className="mt-3 flex flex-col gap-2">
        {BOOKING_DEVICES.map((name) => {
          const state = freshnessOf(seen[name] || "");
          const on = connected === name;
          return (
            <div key={name} className="rounded-md bg-bg px-3 py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-fg">{name}</span>
                <span className="flex items-center gap-1.5 text-sm text-muted">
                  <span className={dot(state)} />
                  {label(state)}
                  {hm(seen[name] || "") ? <span className="tabular-nums">{hm(seen[name] || "")}</span> : null}
                </span>
              </div>
              <button type="button" className={cn(settingsChoiceClass(on), "mt-2")} onClick={() => connect(name)}>
                {on ? "연결됨" : "연결"}
              </button>
            </div>
          );
        })}
      </div>
      {connected ? (
        <button type="button" className={cn(settingsActionClass, "mt-2")} onClick={disconnect}>연결 해제</button>
      ) : null}
      <p className="mt-5 text-xs text-muted">자동결제</p>
      <div className="mt-1.5 grid grid-cols-2 gap-2">
        <button type="button" className={settingsChoiceClass(!autoPay)} onClick={() => chooseAutoPay(false)}>꺼짐</button>
        <button type="button" className={settingsChoiceClass(autoPay)} onClick={() => chooseAutoPay(true)}>켜짐</button>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-muted">기본은 꺼짐입니다. 켜짐일 때만 결제 화면의 최종 금액 버튼을 한 번 누릅니다.</p>
      <label className="mt-5 block text-xs text-muted" htmlFor="openbell-notify-email">결제 대기 알림 메일</label>
      <input
        id="openbell-notify-email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        inputMode="email"
        autoComplete="email"
        placeholder="name@gmail.com"
        className="mt-1.5 h-11 w-full rounded-md bg-bg px-3 text-sm text-fg outline-none ring-1 ring-border"
      />
      <button type="button" className={cn(settingsActionClass, "mt-2")} disabled={busy} onClick={() => void registerEmail()}>
        {busy ? "등록 중…" : "등록"}
      </button>
      <p className="mt-2 text-sm leading-relaxed text-muted">로그인하지 않아도 이 브라우저에 남습니다. 데이터베이스가 받으면 계정에도 남고, 연결된 구글 스크립트에도 그 메일로 반영됩니다.</p>
    </div>
  );
}
