import { useEffect, useMemo, useState } from "react";
import {
  describeSeatGuide,
  formatHoldClock,
  holdPlaceLine,
  HOLD_STEPS,
  isGuideSeat,
  remainingHoldMs,
} from "@/lib/cinema/hold";
import { useAppStore } from "@/lib/store";
import { normalizeHold } from "@/lib/cinema/types";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";

export function HoldSheet() {
  const session = useAppStore((s) => s.hold);
  const prefs = normalizeHold(useAppStore((s) => s.config.hold));
  const setHoldStep = useAppStore((s) => s.setHoldStep);
  const markHoldArrived = useAppStore((s) => s.markHoldArrived);
  const clearHold = useAppStore((s) => s.clearHold);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!session || session.step !== "wait") return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [session?.step, session?.id]);

  const guide = useMemo(
    () => (session ? describeSeatGuide(session) : null),
    [session],
  );
  if (!session || !guide) return null;

  const remain = remainingHoldMs(session.holdStartedAt, prefs.minutes, now);
  const expired = session.step === "wait" && remain <= 0;
  const stepIndex = HOLD_STEPS.findIndex((s) => s.id === session.step);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <button
        type="button"
        className="absolute inset-0 bg-bg/70"
        aria-label="홀드 닫기"
        onClick={() => {
          if (session.step !== "wait") clearHold();
        }}
      />
      <section className="relative z-10 mx-auto flex max-h-[90dvh] w-full max-w-lg flex-col overflow-y-auto rounded-t-xl bg-surface px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 shadow-border">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border-strong" />
        <p className="text-[11px] font-medium tracking-[0.16em] text-muted">
          좌석 홀드 · 결제는 직접
        </p>
        <h2 className="mt-1 truncate text-lg font-bold text-fg">
          {session.movieTitle || "예매"}
        </h2>
        <p className="mt-0.5 truncate text-sm text-muted">
          {holdPlaceLine(session)}
        </p>

        <ol className="mt-4 grid grid-cols-3 gap-1">
          {HOLD_STEPS.map((step, i) => (
            <li
              key={step.id}
              className={cn(
                "rounded-md px-2 py-2 text-center",
                i === stepIndex
                  ? "bg-pick text-fg ring-1 ring-border-strong"
                  : "bg-bg text-muted",
              )}
            >
              <p className="text-[10px] tabular-nums">{i + 1}</p>
              <p className="mt-0.5 text-[11px] font-medium">{step.title}</p>
            </li>
          ))}
        </ol>

        {session.step === "seats" ? (
          <div className="mt-4">
            <SeatMap guide={guide} />
            <p className="mt-3 text-sm leading-relaxed text-fg">{guide.body}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              참고 구역입니다. 실제 좌석은 극장 화면에서 찍으세요. 오픈벨은
              좌석을 대신 누르지 않습니다.
            </p>
          </div>
        ) : null}

        {session.step === "pay" ? (
          <div className="mt-4 rounded-md bg-bg px-3 py-3">
            <p className="text-sm font-medium text-fg">
              결제하기만 누르고 멈추세요
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">
              극장 화면에서 결제하기를 누르면 좌석이 잠시 잡힙니다. 카드
              번호·비밀번호는 넣지 마세요. 오픈벨은 결제하지 않습니다.
            </p>
          </div>
        ) : null}

        {session.step === "wait" ? (
          <div className="mt-4 rounded-md bg-bg px-3 py-4 text-center">
            <p
              className={cn(
                "font-display text-5xl tabular-nums tracking-tight",
                expired ? "text-danger" : "text-fg",
              )}
            >
              {formatHoldClock(remain)}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              {expired
                ? "시간이 끝났을 수 있습니다. 극장 화면에서 좌석이 아직 잡혀 있는지 확인하세요."
                : `약 ${prefs.minutes}분 안에 직접 결제하세요. 끝나기 전에 극장에서 결제하면 됩니다.`}
            </p>
          </div>
        ) : null}

        <div className="mt-4 flex flex-col gap-2">
          {session.step === "seats" ? (
            <>
              <a
                href={session.bookingUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 items-center justify-center rounded-md bg-open px-4 text-sm font-medium text-open-fg"
              >
                극장에서 좌석 찍기
              </a>
              <Button onClick={() => setHoldStep("pay")}>찍었습니다</Button>
            </>
          ) : null}
          {session.step === "pay" ? (
            <>
              <a
                href={session.bookingUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 items-center justify-center rounded-md bg-open px-4 text-sm font-medium text-open-fg"
              >
                결제 화면으로
              </a>
              <Button
                onClick={() => {
                  markHoldArrived();
                  setNow(Date.now());
                }}
              >
                결제 화면에 도착 · 결제는 안 함
              </Button>
            </>
          ) : null}
          {session.step === "wait" ? (
            <a
              href={session.bookingUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center justify-center rounded-md bg-open px-4 text-sm font-medium text-open-fg"
            >
              직접 결제하러
            </a>
          ) : null}
          <Button variant="ghost" onClick={clearHold}>
            {session.step === "wait" ? "홀드 끝" : "닫기"}
          </Button>
        </div>
      </section>
    </div>
  );
}

function SeatMap({
  guide,
}: {
  guide: ReturnType<typeof describeSeatGuide>;
}) {
  const labels = "ABCDEFGHIJKL";
  return (
    <div className="rounded-md bg-bg px-3 py-3">
      <p className="mb-2 text-center text-[10px] tracking-[0.2em] text-faint">
        SCREEN
      </p>
      <div className="flex flex-col gap-0.5">
        {Array.from({ length: guide.grid.rows }, (_, row) => (
          <div key={row} className="flex items-center gap-1">
            <span className="w-3 text-[9px] text-faint">{labels[row]}</span>
            <div className="flex flex-1 gap-px">
              {Array.from({ length: guide.grid.cols }, (_, col) => {
                const on = isGuideSeat(guide, row, col);
                return (
                  <span
                    key={col}
                    className={cn(
                      "block h-2.5 flex-1 rounded-[2px]",
                      on ? "bg-open" : "bg-pick",
                    )}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-center text-[11px] text-muted">
        {guide.zoneLabel} · {guide.rows}
      </p>
    </div>
  );
}
