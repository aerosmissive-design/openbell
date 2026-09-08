import type { ErrorComponentProps } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";
import { isChunkLoadError, reloadIfStaleChunk } from "@/lib/reload-stale-chunk";

export function AppErrorComponent({ error }: ErrorComponentProps) {
  const chunk = isChunkLoadError(error);
  if (chunk) reloadIfStaleChunk(error);
  return (
    <main
      className={
        "flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center " +
        "bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50"
      }
    >
      <span className="text-red-500" aria-hidden="true">
        <TriangleAlert className="size-10" strokeWidth={2} />
      </span>
      <h1 className="text-lg font-semibold">문제가 생겼습니다</h1>
      <p className="max-w-md text-sm break-words text-zinc-500 dark:text-zinc-400">
        {chunk
          ? "방금 배포된 파일을 받는 중입니다. 새로고침해 주세요."
          : error.message || "잠시 후 다시 시도해 주세요."}
      </p>
      <button
        type="button"
        className="mt-2 min-h-11 rounded-md bg-zinc-900 px-4 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900"
        onClick={() => window.location.reload()}
      >
        새로고침
      </button>
    </main>
  );
}