import { createFileRoute } from "@tanstack/react-router";
import { listRegisteredEmails, recordGasBind, registeredEmailFailure } from "@/lib/cinema/gas-bind.server";
import { decideAccountList, emailsFromGasSlots, gasAccountSlots } from "@/lib/cinema/gas-account-list";

export const Route = createFileRoute("/api/booking/accounts")({
  server: {
    handlers: {
      GET: async () => {
        const slots = gasAccountSlots(process.env);
        const gasTask = emailsFromGasSlots(slots, fetch);
        let vesselEmails: string[] | null = null;
        let vesselError: unknown = null;
        try {
          vesselEmails = await listRegisteredEmails();
        } catch (err) {
          vesselError = err;
        }
        const gasRows = await gasTask;
        const decision = decideAccountList(vesselEmails, [
          ...slots.map((slot) => slot.email),
          ...gasRows.map((row) => row.email),
        ]);
        if (decision.status === 503) {
          return Response.json(
            { ok: false, error: "unavailable", ...registeredEmailFailure(vesselError) },
            { status: 503, headers: { "cache-control": "no-store" } },
          );
        }
        if (vesselEmails) {
          for (const row of gasRows) {
            if (row.key.length < 8) continue;
            try {
              await recordGasBind({
                key: row.key,
                url: row.url,
                scriptId: row.scriptId,
                email: row.email,
              });
            } catch {
              break;
            }
          }
        }
        return Response.json(
          { ok: true, accounts: decision.accounts },
          { headers: { "cache-control": "no-store" } },
        );
      },
    },
  },
});
