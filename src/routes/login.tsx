import { createFileRoute, Navigate } from "@tanstack/react-router";
import { GROK_PROVIDERS, authEnabled, signIn } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

export const Route = createFileRoute("/login")({ component: Login });

function Login() {
  const { user, isPending } = useCurrentUserState();
  if (isPending) {
    return (
      <main className="grid min-h-dvh place-items-center bg-bg p-6">
        <div className="h-12 w-48 animate-pulse rounded-md bg-surface" />
      </main>
    );
  }
  if (user) return <Navigate to="/" />;
  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-6">
      <div className="w-full max-w-sm">
        <p className="font-display text-[11px] tracking-[0.18em] text-muted">
          특별관 예매 알람
        </p>
        <h1 className="mt-2 font-display text-4xl italic text-fg">오픈벨</h1>
        <p className="mt-4 text-sm leading-relaxed text-muted">
          로그인하면 별표·감시 영화·텔레그램·카톡·메일이 따라오고, 앱을 꺼도
          알림이 갑니다. 웹앱 주소는 필요 없습니다.
        </p>
        {authEnabled ? (
          <div className="mt-6 flex flex-col gap-2">
            {GROK_PROVIDERS.map((p) => (
              <button
                key={p.providerId}
                type="button"
                onClick={() => signIn(p.providerId, { callbackURL: "/" })}
                className="min-h-11 w-full rounded-md bg-surface px-4 text-sm text-fg shadow-border"
              >
                {p.label}로 계속
              </button>
            ))}
          </div>
        ) : (
          <p className="mt-6 text-sm text-muted">지금은 로그인할 수 없습니다.</p>
        )}
      </div>
    </main>
  );
}
