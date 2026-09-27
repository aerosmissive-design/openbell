import { createFileRoute } from "@tanstack/react-router";
import { runWatchTick } from "@/lib/cinema/watch-tick.server";
import { writeAppMeta } from "@/lib/cinema/app-meta.server";

export type WakeKind = "github" | "gas" | "external" | "vercel" | "";

function wakeKindFromRequest(request: Request): WakeKind {
  const ua = request.headers.get("user-agent") || "";
  let src = "";
  try {
    src = new URL(request.url).searchParams.get("src") || "";
  } catch {
    src = "";
  }
  if (ua.includes("openbell-github-watch") || src === "github") return "github";
  if (ua.includes("openbell-gas-wake") || src === "gas") return "gas";
  if (src === "external" || ua.includes("openbell-external-cron")) return "external";
  if (request.headers.get("x-vercel-cron") === "1" || src === "vercel") return "vercel";
  return "";
}

const WAKE_AT_KEY: Record<Exclude<WakeKind, "">, string> = {
  github: "github_watch_at",
  gas: "gas_watch_at",
  external: "external_watch_at",
  vercel: "vercel_watch_at",
};

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
