import { createFileRoute } from "@tanstack/react-router";

// 임시 디버그 라우트: mcp.aka.page가 용산(0013)에 대해 실제로 뭘 돌려주는지
// 가공 없이 그대로 확인하기 위한 용도. 확인 끝나면 이 파일은 지우세요.
export const Route = createFileRoute("/api/debug-relay-yongsan")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const playDate = url.searchParams.get("date") || todayYYYYMMDD();

        const res = await fetch(
          `https://mcp.aka.page/api/cgv/timetable?playDate=${playDate}&theaterCode=0013&limit=200`,
          {
            headers: {
              accept: "application/json",
              "user-agent":
                "Mozilla/5.0 (Linux; Android 13; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36",
            },
            redirect: "follow",
            signal: AbortSignal.timeout(8000),
          },
        );

        const status = res.status;
        const ok = res.ok;
        let json: unknown = null;
        let parseError: string | null = null;
        try {
          json = await res.json();
        } catch (e) {
          parseError = e instanceof Error ? e.message : String(e);
        }

        const rows =
          (json as { data?: { timetable?: Array<Record<string, unknown>> } })
            ?.data?.timetable ?? [];

        // IMAX로 추정되는 행만 골라서 필드를 그대로 보여줌
        // (screenName에 IMAX/20관 텍스트가 있거나, totalSeats가 624 근처인 것)
        const imaxLikely = rows.filter((r) => {
          const name = String(r.screenName ?? "");
          const total = r.totalSeats;
          return (
            /imax|아이맥스|20\s*관/i.test(name) ||
            (typeof total === "number" && total > 500)
          );
        });

        return Response.json(
          {
            requestedDate: playDate,
            upstreamStatus: status,
            upstreamOk: ok,
            parseError,
            totalRowsReturned: rows.length,
            imaxLikelyRows: imaxLikely,
            // 혹시 필터에 하나도 안 걸리면 전체를 다 보여줌 (필터 자체가 틀렸을 수도 있으니)
            allRowsIfEmpty: imaxLikely.length === 0 ? rows : undefined,
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

function todayYYYYMMDD(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const yy = kst.getUTCFullYear();
  const mm = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(kst.getUTCDate()).padStart(2, "0");
  return `${yy}${mm}${dd}`;
}
