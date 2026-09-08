import { createFileRoute } from "@tanstack/react-router";
import { watchTickHealth } from "@/lib/cinema/watch-tick.server";

export const Route = createFileRoute("/api/watch-alive")({
  server: {
    handlers: {
      GET: () => Response.json({ ok: true, ...watchTickHealth() }),
    },
  },
});
