export type WakeKind = "github" | "gas" | "external" | "vercel" | "";

export const WAKE_AT_KEY: Record<Exclude<WakeKind, "">, string> = {
  github: "github_watch_at",
  gas: "gas_watch_at",
  external: "external_watch_at",
  vercel: "vercel_watch_at",
};

/** 베셀 /api/watch-tick 을 누가 두드렸는지. src=external 은 GAS가 아니다. */
export function wakeKindFromRequest(request: {
  url: string;
  headers: { get(name: string): string | null };
}): WakeKind {
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
