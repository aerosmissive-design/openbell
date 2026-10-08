import { createFileRoute } from "@tanstack/react-router";
import { listRegisteredEmails, registeredEmailFailure } from "@/lib/cinema/gas-bind.server";

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
        } catch (err) {
          return Response.json(
            { ok: false, error: "unavailable", ...registeredEmailFailure(err) },
            { status: 503 },
          );
        }
      },
    },
  },
});
