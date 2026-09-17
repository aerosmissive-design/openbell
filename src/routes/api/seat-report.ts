import { createFileRoute } from "@tanstack/react-router";
import { readAppMeta, writeAppMeta } from "@/lib/cinema/app-meta.server";

const ALLOWED = new Set([
  "cgv_yongsan",
  "cgv_yeongdeungpo",
  "megabox_coex",
  "megabox_namyangju",
]);
const MAX_ROWS = 5000;
function reportToken() {
  return (
    process.env.NAS_REPORT_TOKEN?.trim() ||
    process.env.NAS_WORKER_TOKEN?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    ""
  );
}
function authorized(request: Request) {
  const token = reportToken();
  if (!token) return false;
  if (request.headers.get("authorization") === `Bearer ${token}`) return true;
  try {
    return new URL(request.url).searchParams.get("token") === token;
  } catch {
    return false;
  }
}
function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "authorization, content-type",
    },
  });
}
type SeatRow = {
  playDate?: string;
  startTime?: string;
  hallName?: string;
  movieTitle?: string;
  movieNo?: string;
  bookingUrl?: string;
  scnsNo?: string;
  scnSseq?: string;
  restSeats?: number;
  totalSeats?: number;
};
type ReporterSource = "pc" | "nas" | "nas423" | "nas225";
function rowKey(r: SeatRow) {
  return `${String(r.playDate || "").trim()}|${String(r.startTime || "").trim()}|${String(r.hallName || "").trim()}|${String(r.movieTitle || "").trim()}`;
}
function cleanRows(rows: SeatRow[]) {
  const out: SeatRow[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const restSeats = Number(r.restSeats);
    if (!Number.isFinite(restSeats)) continue;
    const playDate = String(r.playDate || "").trim(),
      startTime = String(r.startTime || "").trim(),
      hallName = String(r.hallName || "").trim(),
      movieTitle = String(r.movieTitle || "").trim();
    if (!playDate || !startTime || !hallName || !movieTitle) continue;
    const key = rowKey({ playDate, startTime, hallName, movieTitle });
    if (seen.has(key)) continue;
    seen.add(key);
    const totalSeats = Number(r.totalSeats);
    out.push({
      playDate,
      startTime,
      hallName,
      movieTitle,
      movieNo: r.movieNo ? String(r.movieNo) : "",
      bookingUrl: r.bookingUrl ? String(r.bookingUrl).trim() : "",
      scnsNo: r.scnsNo ? String(r.scnsNo).trim() : "",
      scnSseq: r.scnSseq ? String(r.scnSseq).trim() : "",
      restSeats,
      totalSeats: Number.isFinite(totalSeats) ? totalSeats : restSeats,
    });
    if (out.length >= MAX_ROWS) break;
  }
  return out;
}
function normalizeSource(value: unknown): ReporterSource {
  const source = String(value || "")
    .trim()
    .toLowerCase();
  if (source === "nas423" || source === "nas225" || source === "nas" || source === "pc")
    return source;
  return "pc";
}
async function handleGet(request: Request) {
  if (!reportToken()) return json({ ok: false, error: "NAS_REPORT_TOKEN 이 없습니다" }, 503);
  if (!authorized(request)) return json({ ok: false, error: "unauthorized" }, 401);
  const now = Date.now();
  const theaters: Record<string, { at: number; ageMs: number; count: number; source: string }> = {};
  for (const id of ALLOWED) {
    const raw = await readAppMeta(`nas_seats:${id}`);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as { at?: number; rows?: unknown[]; source?: string };
      const at = Number(parsed.at) || 0;
      theaters[id] = {
        at,
        ageMs: at ? now - at : 0,
        count: Array.isArray(parsed.rows) ? parsed.rows.length : 0,
        source: normalizeSource(parsed.source),
      };
    } catch {}
  }
  return json({ ok: true, theaters });
}
async function handlePost(request: Request) {
  if (!reportToken()) return json({ ok: false, error: "NAS_REPORT_TOKEN 이 없습니다" }, 503);
  if (!authorized(request)) return json({ ok: false, error: "unauthorized" }, 401);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "invalid json" }, 400);
  }
  const record = body as {
    theaterId?: string;
    mode?: string;
    source?: string;
    showtimes?: SeatRow[];
  };
  const theaterId = String(record?.theaterId || "").trim();
  if (!ALLOWED.has(theaterId)) return json({ ok: false, error: "unknown theater" }, 400);
  const incoming = cleanRows(Array.isArray(record?.showtimes) ? record.showtimes : []);
  if (!incoming.length) return json({ ok: false, error: "empty payload" }, 400);
  const source = normalizeSource(record.source);
  const merge = record.mode === "imax" || record.mode === "merge";
  let rows = incoming;
  if (merge) {
    const prevRaw = await readAppMeta(`nas_seats:${theaterId}`);
    const byKey = new Map<string, SeatRow>();
    if (prevRaw) {
      try {
        const prev = JSON.parse(prevRaw) as { rows?: SeatRow[] };
        for (const r of cleanRows(Array.isArray(prev.rows) ? prev.rows : [])) byKey.set(rowKey(r), r);
      } catch {}
    }
    for (const r of incoming) byKey.set(rowKey(r), r);
    rows = [...byKey.values()].slice(0, MAX_ROWS);
  }
  await writeAppMeta(
    `nas_seats:${theaterId}`,
    JSON.stringify({ at: Date.now(), rows, mode: merge ? "merge" : "full", source }),
  );
  return json({ ok: true, count: incoming.length, stored: rows.length, merge, source });
}
export const Route = createFileRoute("/api/seat-report")({
  server: {
    handlers: {
      OPTIONS: () => json({ ok: true }),
      GET: ({ request }) => handleGet(request),
      POST: ({ request }) => handlePost(request),
    },
  },
});
