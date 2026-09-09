import { createFileRoute } from "@tanstack/react-router";
import { watchTickHealth } from "@/lib/cinema/watch-tick.server";

export const Route = createFileRoute("/api/watch-alive")({
  server: {
    handlers: {
      GET: async () =>
        Response.json(
          { ok: true, host: process.env.VERCEL ? "vercel" : "grok", ...(await watchTickHealth()) },
          {
            headers: {
              "access-control-allow-origin": "*",
              "access-control-allow-methods": "GET",
            },
          },
        ),
    },
  },
});
