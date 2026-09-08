import { createFileRoute } from "@tanstack/react-router";
import { recordGasBind } from "@/lib/cinema/gas-bind.server";

export const Route = createFileRoute("/api/gas-bind")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { key?: string; url?: string; id?: string; email?: string } = {};
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return Response.json({ ok: false }, { status: 400 });
        }
        const result = await recordGasBind({
          key: String(body.key ?? ""),
          url: String(body.url ?? ""),
          scriptId: String(body.id ?? ""),
          email: String(body.email ?? ""),
        });
        return Response.json(result);
      },
    },
  },
});
