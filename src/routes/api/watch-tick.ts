import { createFileRoute } from "@tanstack/react-router";
import { runWatchTick } from "@/lib/cinema/watch-tick.server";
import { writeAppMeta } from "@/lib/cinema/app-meta.server";
import { WAKE_AT_KEY, wakeKindFromRequest } from "@/lib/cinema/wake-kind";

async function handle(request: Request) {
  const kind = wakeKindFromRequest(request);
  if (kind) {
    await writeAppMeta("watch_wake_kind", kind);
    await writeAppMeta(WAKE_AT_KEY[kind], String(Date.now()));
  }
  const secret = process.env.CRON_SECRET;
  const vercelCron = request.headers.get("x-vercel-cron") === "1";
  const auth = request.headers.get("authorization") ?? "";
  if (secret && !vercelCron && auth !== `Bearer ${secret}`) {
    if (kind) return Response.json({ ok: true, woke: true, tick: false, kind });
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await runWatchTick();
    return Response.json({ ok: true, kind: kind || undefined, ...result });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : "tick failed" },
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
