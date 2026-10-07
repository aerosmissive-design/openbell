import { useEffect, useState } from "react";
import { useAutoBook } from "@/lib/auto-book-store";
import { listAccountJobs, retryAccountJob } from "@/lib/cinema/account-jobs";
import { GOLDEN_ROWS } from "@/lib/cinema/golden-rows";
import { THEATERS } from "@/lib/cinema/theaters";
import { useAppStore } from "@/lib/store";
import { formatPlayDate } from "@/lib/utils";

type ListedJob = {
  id?: string;
  status?: string;
  movieTitle?: string;
  theaterId?: string;
  playDate?: string;
  startTime?: string;
  hallName?: string;
  account?: string;
};

const JOB_LABEL: Record<string, string> = {
  pending: "대기",
  running: "진행",
  failed: "실패",
  expired: "만료",
  need_user: "확인",
  done: "완료",
};

function canRequeue(status: string | undefined) {
  return status === "failed" || status === "expired";
}

export function BellView() {
  const watchTitles = useAppStore((s) => s.config.watchTitles);
  const toggleWatchTitle = useAppStore((s) => s.toggleWatchTitle);
  const movies = useAutoBook((s) => s.movies);
  const shows = useAutoBook((s) => s.shows);
  const removeMovie = useAutoBook((s) => s.removeMovie);
  const removeShow = useAutoBook((s) => s.removeShow);
  const gasWebUrl = useAppStore((s) => s.config.gasWebUrl);
  const gasSyncKey = useAppStore((s) => s.config.gasSyncKey);
  const [jobs, setJobs] = useState<ListedJob[]>([]);
  const [jobNote, setJobNote] = useState("작업을 불러오는 중");

  async function loadJobs() {
    const accounts = gasWebUrl.trim()
      ? [{ label: "GAS", url: gasWebUrl.trim(), key: gasSyncKey.trim() }]
      : [];
    try {
      const result = await listAccountJobs({ data: { accounts } });
      const fromNeon = (Array.isArray(result.neon) ? result.neon : []) as ListedJob[];
      const fromGas = result.accounts.flatMap((account) =>
        (account.jobs as ListedJob[]).map((job) => ({ ...job, account: account.label })),
      );
      const merged = fromNeon.length ? fromNeon : fromGas;
      setJobs(merged);
      if (result.neonReason === "dbQuota" || result.neonReason === "dbConn") {
        setJobNote(fromGas.length ? "Neon 쿼터 중이라 GAS 작업 목록을 표시합니다." : "Neon 쿼터 중이고 GAS 작업 목록이 비어 있습니다. GAS 스크립트를 다시 배포해야 목록이 옵니다.");
      } else if (!merged.length) {
        setJobNote("대기 중인 작업이 없습니다.");
      } else {
        setJobNote("");
      }
    } catch {
      setJobNote("작업 목록을 받지 못했습니다.");
    }
  }

  useEffect(() => {
    void loadJobs();
  }, [gasWebUrl]);

  return (
    <div className="flex flex-col gap-5">
      <section>
        <h2 className="text-xs font-medium tracking-[0.16em] text-muted">알림 설정 영화</h2>
        {watchTitles.length ? (
          <ul className="mt-2 flex flex-col gap-2">
            {watchTitles.map((title) => (
              <li key={title} className="flex items-center justify-between rounded-xl bg-surface px-3 py-3 shadow-border">
                <span className="text-sm text-fg">{title}</span>
                <button type="button" className="text-[11px] text-muted" onClick={() => toggleWatchTitle(title)}>빼기</button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted">차트에서 알림설정을 누르면 여기 모입니다.</p>
        )}
      </section>
      <section>
        <h2 className="text-xs font-medium tracking-[0.16em] text-muted">자동예매 영화</h2>
        <p className="mt-1 text-[11px] leading-relaxed text-muted">계정에 저장됩니다. 이 목록에 있는 영화는 지금 떠 있는 회차와 나중에 열리는 회차를 한 번씩 결제 직전까지 잡습니다.</p>
        {movies.length ? (
          <ul className="mt-2 flex flex-col gap-2">
            {movies.map((m) => (
              <li key={m.title} className="flex items-center justify-between rounded-xl bg-surface px-3 py-3 shadow-border">
                <span className="text-sm text-fg">{m.title} · {m.seats}명</span>
                <button type="button" className="text-[11px] text-muted" onClick={() => removeMovie(m.title)}>빼기</button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted">차트에서 자동예매를 누르세요.</p>
        )}
      </section>
      <section>
        <h2 className="text-xs font-medium tracking-[0.16em] text-muted">자동예매 회차</h2>
        <p className="mt-1 text-[11px] leading-relaxed text-muted">계정에 저장됩니다. 그 회차가 상영표에 있으면 잡고, 잔여석이 변하면 다시 잡습니다.</p>
        {shows.length ? (
          <ul className="mt-2 flex flex-col gap-2">
            {shows.map((row) => (
              <li key={row.id} className="flex items-center justify-between rounded-xl bg-surface px-3 py-3 shadow-border">
                <div className="min-w-0">
                  <p className="truncate text-sm text-fg">{row.title} · {row.seats}명</p>
                  <p className="truncate text-[11px] text-muted">{THEATERS.find((t) => t.id === row.theaterId)?.shortName || row.theaterId} · {formatPlayDate(row.playDate)} {row.startTime} · {row.hallName}</p>
                </div>
                <button type="button" className="shrink-0 text-[11px] text-muted" onClick={() => removeShow(row.id)}>빼기</button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted">별표한 회차에서 자동예매를 누르세요.</p>
        )}
      </section>
      <section>
        <h2 className="text-xs font-medium tracking-[0.16em] text-muted">예매 작업</h2>
        <p className="mt-1 text-[11px] leading-relaxed text-muted">실패하거나 만료된 회차만 다시 잡습니다. 대기·진행 중 작업은 그대로 둡니다.</p>
        {jobNote ? <p className="mt-2 text-sm text-muted">{jobNote}</p> : null}
        {jobs.length ? (
          <ul className="mt-2 flex flex-col gap-2">
            {jobs.map((job) => {
              const status = String(job.status || "");
              return (
                <li key={`${job.account || "job"}-${job.id}`} className="flex items-center justify-between gap-3 rounded-xl bg-surface px-3 py-3 shadow-border">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-fg">{job.movieTitle || "제목 없음"} · {JOB_LABEL[status] || status || "상태 없음"}</p>
                    <p className="truncate text-[11px] text-muted">{[job.account, job.theaterId, job.playDate, job.startTime, job.hallName].filter(Boolean).join(" · ")}</p>
                  </div>
                  {canRequeue(status) && job.id ? (
                    <button
                      type="button"
                      className="shrink-0 text-[11px] text-muted"
                      onClick={() => {
                        void retryAccountJob({
                          data: { url: gasWebUrl.trim(), key: gasSyncKey.trim(), id: String(job.id), status: status as "failed" | "expired" },
                        }).then(() => loadJobs());
                      }}
                    >
                      다시 잡기
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>
      <section>
        <h2 className="text-xs font-medium tracking-[0.16em] text-muted">황금열 (여론)</h2>
        <ul className="mt-2 flex flex-col gap-2">
          {THEATERS.map((t) => (
            <li key={t.id} className="rounded-xl bg-surface px-3 py-3 text-[12px] leading-relaxed text-muted shadow-border">
              <span className="text-fg">{t.shortName || t.name}</span>
              {" · "}
              {GOLDEN_ROWS[t.id]?.note}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
