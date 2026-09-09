import { ExternalLink, Share2 } from "lucide-react";
import { formatLabel, theaterById } from "@/lib/cinema/theaters";
import { useAppStore } from "@/lib/store";
import { formatClock, formatPlayDate } from "@/lib/utils";
import { Button } from "./ui/button";

export function AlertsView() {
  const alerts = useAppStore((s) => s.alerts);
  const clearAlerts = useAppStore((s) => s.clearAlerts);

  if (!alerts.length) {
    return (
      <div className="rounded-xl bg-surface px-5 py-10 text-center shadow-border">
        <p className="text-xl font-bold text-fg">아직 오픈 없음</p>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          새 상영이 열리거나 별표한 상영의 잔여석이 변하면 여기와 메일·텔레그램으로
          옵니다.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-medium tracking-[0.16em] text-muted">
          오픈 기록 {alerts.length}건
        </h2>
        <Button size="sm" variant="ghost" onClick={clearAlerts}>
          비우기
        </Button>
      </div>
      {alerts.map((alert) => (
        <article key={alert.id} className="rounded-xl bg-surface p-4 shadow-border">
          <p className="text-[11px] tabular-nums text-muted">
            {formatClock(alert.createdAt)}
          </p>
          <h3 className="mt-1 text-[15px] font-medium text-fg">{alert.title}</h3>
          <p className="mt-1 text-sm text-muted">
            {theaterById(alert.theaterId).name}
            {" · "}
            {formatPlayDate(alert.playDate)} {alert.startTime}
          </p>
          <p className="mt-1 text-xs text-faint">
            {alert.hallName}
            {alert.formats.length
              ? ` · ${alert.formats.map(formatLabel).join(" · ")}`
              : ""}
            {alert.restSeats != null
              ? ` · ${alert.restSeats}${alert.totalSeats != null ? "/" + alert.totalSeats : ""}`
              : ""}
          </p>
          <div className="mt-3 flex gap-2">
            <a
              href={alert.bookingUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-md bg-pick text-sm font-medium text-fg ring-1 ring-border-strong"
            >
              바로 예매
              <ExternalLink className="size-3.5" strokeWidth={1.75} />
            </a>
            <Button
              variant="outline"
              onClick={() => {
                const text = `${alert.title}\n${alert.body}\n${alert.bookingUrl}`;
                if (navigator.share) {
                  void navigator.share({ title: alert.title, text, url: alert.bookingUrl });
                } else {
                  void navigator.clipboard.writeText(text);
                }
              }}
            >
              <Share2 className="size-4" strokeWidth={1.75} />
              공유
            </Button>
          </div>
        </article>
      ))}
    </div>
  );
}
