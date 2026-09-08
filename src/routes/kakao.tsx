import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { extractKakaoCode, kakaoRedirectUri } from "@/lib/cinema/kakao";
import { exchangeKakaoCode } from "@/lib/cinema/scan";
import { useAppStore } from "@/lib/store";

export const Route = createFileRoute("/kakao")({
  component: KakaoCallback,
});

function KakaoCallback() {
  const restKey = useAppStore((s) => s.config.kakaoRestKey);
  const setConfig = useAppStore((s) => s.setConfig);
  const [hydrated, setHydrated] = useState(false);
  const [status, setStatus] = useState<"wait" | "ok" | "needKey" | "fail">("wait");
  const [message, setMessage] = useState("");
  const [code, setCode] = useState("");

  useEffect(() => {
    const done = () => setHydrated(true);
    if (useAppStore.persist.hasHydrated()) done();
    return useAppStore.persist.onFinishHydration(done);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const params = new URLSearchParams(window.location.search);
    const err = params.get("error_description") || params.get("error");
    const found = extractKakaoCode(window.location.href);
    setCode(found);
    if (err) {
      setStatus("fail");
      setMessage(err);
      return;
    }
    if (!found) {
      setStatus("fail");
      setMessage("인가 코드가 없습니다. 설정에서 카카오 허용을 다시 눌러 주세요.");
      return;
    }
    if (!restKey.trim()) {
      setStatus("needKey");
      return;
    }
    let cancelled = false;
    void exchangeKakaoCode({
      data: {
        restKey,
        code: found,
        redirectUri: kakaoRedirectUri(),
      },
    })
      .then((result) => {
        if (cancelled) return;
        setConfig({ kakaoRefreshToken: result.refreshToken });
        setStatus("ok");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setStatus("fail");
        setMessage(err instanceof Error ? err.message : "카카오 연결에 실패했습니다.");
      });
    return () => {
      cancelled = true;
    };
  }, [hydrated, restKey, setConfig]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center bg-bg px-5 py-10">
      <p className="text-xs tracking-[0.18em] text-muted">오픈벨</p>
      <h1 className="mt-2 text-3xl font-bold text-fg">카카오 연결</h1>
      {status === "wait" ? (
        <p className="mt-4 text-sm leading-relaxed text-muted">연결하는 중입니다.</p>
      ) : null}
      {status === "ok" ? (
        <>
          <p className="mt-4 text-sm leading-relaxed text-open">
            카카오가 연결되었습니다. 나와의 채팅으로 알림이 갑니다.
          </p>
          <Link
            to="/"
            className="mt-6 inline-flex min-h-11 items-center justify-center rounded-md bg-pick px-4 text-sm font-medium text-fg ring-1 ring-border-strong"
          >
            설정으로 돌아가기
          </Link>
        </>
      ) : null}
      {status === "needKey" ? (
        <>
          <p className="mt-4 text-sm leading-relaxed text-muted">
            REST API 키가 저장되어 있지 않습니다. 아래 코드를 복사한 뒤 설정에
            붙여넣으세요.
          </p>
          <code className="mt-3 block break-all rounded-md bg-surface px-3 py-3 text-xs text-fg">
            {code}
          </code>
          <Link
            to="/"
            className="mt-6 inline-flex min-h-11 items-center justify-center rounded-md bg-pick px-4 text-sm font-medium text-fg ring-1 ring-border-strong"
          >
            설정으로 돌아가기
          </Link>
        </>
      ) : null}
      {status === "fail" ? (
        <>
          <p className="mt-4 text-sm leading-relaxed text-danger">{message}</p>
          <p className="mt-2 text-xs leading-relaxed text-faint">
            카카오 콘솔의 리다이렉트 URI가 이 주소와 같은지, 클라이언트 시크릿이
            꺼져 있는지 확인해 주세요.
          </p>
          <code className="mt-3 block break-all rounded-md bg-surface px-3 py-3 text-xs text-muted">
            {kakaoRedirectUri()}
          </code>
          <Link
            to="/"
            className="mt-6 inline-flex min-h-11 items-center justify-center rounded-md bg-pick px-4 text-sm font-medium text-fg ring-1 ring-border-strong"
          >
            설정으로 돌아가기
          </Link>
        </>
      ) : null}
    </main>
  );
}
