import { createFileRoute } from "@tanstack/react-router";
import { runWatchTick } from "@/lib/cinema/watch-tick.server";
import { writeAppMeta } from "@/lib/cinema/app-meta.server";

async function handle(request: Request) {
  const ua = request.headers.get("user-agent") || "";
  if (ua.includes("openbell-github-watch")) {
    await writeAppMeta("github_watch_at", String(Date.now()));
  }
  const secret = process.env.CRON_SECRET;
  const vercelCron = request.headers.get("x-vercel-cron") === "1";
  const auth = request.headers.get("authorization") ?? "";
  if (secret && !vercelCron && auth !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await runWatchTick();
    return Response.json({ ok: true, ...result });
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
