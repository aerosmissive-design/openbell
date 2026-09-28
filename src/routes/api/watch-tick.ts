import { createFileRoute } from "@tanstack/react-router";
import { runWatchTick } from "@/lib/cinema/watch-tick.server";
import { clockPushGas, clockPushNeon } from "@/lib/cinema/gas-fallback.server";
import { wakeKindFromRequest } from "@/lib/cinema/wake-kind";

function clockBody(kind: string, db: "ok" | "dbQuota" | "error", gasClock: "ok" | "fail" | "skip", extra: Record<string, unknown> = {}) {
  const neonOk = db === "ok";
  const bothFail = !neonOk && gasClock === "fail";
  if (bothFail) console.error("clock_both_fail");
  return {
    ok: !bothFail,
    kind,
    db: neonOk ? "ok" : "dbQuota",
    gasClock,
    skipped: !neonOk,
    ...extra,
  };
}

async function handle(request: Request) {
  const kind = wakeKindFromRequest(request);
  const now = Date.now();
  let gasClock: "ok" | "fail" | "skip" = "skip";
  let db: "ok" | "dbQuota" | "error" = "ok";
  if (kind) {
    gasClock = await clockPushGas(now, kind);
    const neon = await clockPushNeon(kind, now);
    db = neon.ok ? "ok" : neon.reason === "dbQuota" ? "dbQuota" : "error";
  }
  const secret = process.env.CRON_SECRET;
  const vercelCron = request.headers.get("x-vercel-cron") === "1";
  const auth = request.headers.get("authorization") ?? "";
  if (secret && !vercelCron && auth !== `Bearer ${secret}`) {
    if (kind) return Response.json(clockBody(kind, db, gasClock, { woke: true, tick: false }));
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (kind && db !== "ok") return Response.json(clockBody(kind, db, gasClock));
  try {
    const result = await runWatchTick();
    if (kind) return Response.json({ ...clockBody(kind, "ok", gasClock), ...result, ok: true, skipped: result.skipped });
    return Response.json({ ok: true, db: result.dbQuota ? "dbQuota" : "ok", gas: "skip", ...result });
  } catch (err) {
    return Response.json(
      { ok: false, db: "error", gasClock: kind ? gasClock : "skip", error: err instanceof Error ? err.message : "tick failed" },
      { status: 500 },
    );
  }
}

export const Route = createFileRoute("/api/watch-tick")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      POST: ({ request }) => handle(request),
    },
  },
});
