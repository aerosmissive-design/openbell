import { useAppStore } from "@/lib/store";
import { flushSettings } from "./cloud-sync";
import { describeGasPush } from "./cloud-sync";
import { toast } from "sonner";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

export function GasBackupMailField() {
  const email = useAppStore((s) => s.config.email);
  const setConfig = useAppStore((s) => s.setConfig);
  const { user } = useCurrentUserState();
  const signedIn = Boolean(user?.primaryEmail?.trim());
  return (
    <>
      <label className="mt-4 block text-xs text-muted">예비 메일 (구글스크립트)</label>
      <input
        type="email"
        inputMode="email"
        autoComplete="email"
        value={email}
        onChange={(e) =>
          setConfig({ email: e.target.value, emailNotify: Boolean(e.target.value.trim()) })
        }
        onBlur={() => {
          void flushSettings(signedIn).then((gas) => {
            const live = describeGasPush(gas);
            if (live) toast.success(live);
          });
        }}
        placeholder="알림 받을 메일"
        className="mt-1.5 h-11 w-full rounded-md bg-bg px-3 text-sm text-fg outline-none ring-1 ring-border focus:ring-border-strong"
      />
      <p className="mt-2 text-xs leading-relaxed text-faint">
        로그인 없이 구글스크립트가 이 주소로 메일을 보냅니다. 베셀 메일과는 별개입니다. 웹앱 주소가 연결돼 있으면 포커스를 밸때 반영됩니다.
      </p>
    </>
  );
}
