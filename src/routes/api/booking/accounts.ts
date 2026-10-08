import { createFileRoute } from "@tanstack/react-router";
import { listRegisteredEmails } from "@/lib/cinema/gas-bind.server";

export const Route = createFileRoute("/api/booking/accounts")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const accounts = await listRegisteredEmails();
          return Response.json(
            { ok: true, accounts },
            { headers: { "cache-control": "no-store" } },
          );
        } catch {
          return Response.json({ ok: false, error: "unavailable" }, { status: 503 });
        }
      },
    },
  },
});
