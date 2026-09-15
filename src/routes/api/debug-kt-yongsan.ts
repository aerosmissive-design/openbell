import { createFileRoute } from "@tanstack/react-router";
import { fetchCgvKtSeatmap } from "@/lib/cinema/kt.server";

// 임시 디버그 라우트: KT 소스(kt.server.ts)가 용산 IMAX를 실제로 잡아주는지 확인.
// 확인 끝나면 이 파일은 지우세요.
export const Route = createFileRoute("/api/debug-kt-yongsan")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const dateParam = url.searchParams.get("date"); // "YYYY-MM-DD"
        const today = kstTodayDash();
        const dates = dateParam ? [dateParam] : [today];

        let result: Awaited<ReturnType<typeof fetchCgvKtSeatmap>>;
        let error: string | null = null;
        try {
          result = await fetchCgvKtSeatmap({
            theaters: ["cgv_yongsan"],
            dates,
          });
        } catch (e) {
          error = e instanceof Error ? e.message : String(e);
          result = { map: {}, showtimes: [] };
        }

        const imaxRows = result.showtimes.filter(
          (s) =>
            s.formats?.includes("imax") ||
            /imax|아이맥스|20\s*관/i.test(s.hallName || ""),
        );

        return Response.json(
          {
            requestedDates: dates,
            error,
            totalShowtimes: result.showtimes.length,
            imaxRows,
            sampleAllRows: result.showtimes.slice(0, 10),
          },
          {
            headers: {
              "access-control-allow-origin": "*",
              "access-control-allow-methods": "GET",
              "cache-control": "no-store",
            },
          },
        );
      },
    },
  },
});

function kstTodayDash(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const yy = kst.getUTCFullYear();
  const mm = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(kst.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}
// retrigger 1789451623
