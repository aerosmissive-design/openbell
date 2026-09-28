import { createFileRoute } from "@tanstack/react-router";
import { watchTickHealth } from "@/lib/cinema/watch-tick.server";
import { watchHost } from "@/lib/cinema/app-meta.server";
import { rememberGasExec } from "@/lib/cinema/gas-fallback.server";

export const Route = createFileRoute("/api/watch-alive")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const gas = new URL(request.url).searchParams.get("gas") || "";
          if (gas) rememberGasExec(gas);
        } catch {
          /* ignore */
        }
        const health = await watchTickHealth();
        const alive = Boolean(health.alive);
        return Response.json(
          { ok: alive, host: watchHost(), ...health, alive },
          {
            headers: {
              "access-control-allow-origin": "*",
              "access-control-allow-methods": "GET",
            },
          },
        );
      },
    },
  },
});
