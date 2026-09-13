import { createFileRoute } from "@tanstack/react-router";
import { runWatchTick } from "@/lib/cinema/watch-tick.server";
import { writeAppMeta } from "@/lib/cinema/app-meta.server";

function wakeKindFromRequest(request: Request): "github" | "gas" | "vercel" | "" {
  const ua = request.headers.get("user-agent") || "";
  let src = "";
  try {
    src = new URL(request.url).searchParams.get("src") || "";
  } catch {
    src = "";
  }
  if (ua.includes("openbell-github-watch") || src === "github") return "github";
  if (ua.includes("openbell-gas-wake") || src === "gas" || src === "external") {
    return "gas";
  }
  if (request.headers.get("x-vercel-cron") === "1" || src === "vercel") {
    return "vercel";
  }
  return "";
}

async function handle(request: Request) {
  const kind = wakeKindFromRequest(request);
  if (kind) {
    await writeAppMeta("watch_wake_kind", kind);
    if (kind === "github") {
      await writeAppMeta("github_watch_at", String(Date.now()));
    } else {
      await writeAppMeta("external_watch_at", String(Date.now()));
    }
  }
  const secret = process.env.CRON_SECRET;
  const vercelCron = request.headers.get("x-vercel-cron") === "1";
  const auth = request.headers.get("authorization") ?? "";
  if (secret && !vercelCron && auth !== `Bearer ${secret}`) {
    if (kind) return Response.json({ ok: true, woke: true, tick: false });
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
