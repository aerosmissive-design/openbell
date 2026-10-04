import { createFileRoute } from "@tanstack/react-router";
import { auth, authConfigured } from "@/lib/auth/server";
import { resolveGasExec } from "@/lib/cinema/gas-fallback.server";
import {
  approveDevicePair,
  deviceKeyFromRequest,
  devicePairStatus,
  heartbeatDevice,
  listDevicesForSettings,
  rejectDevicePair,
  replaceDevice,
  requestDevicePair,
  revokeDevice,
  shareDevice,
} from "@/lib/cinema/devices.server";

function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

function tail(request: Request) {
  const path = new URL(request.url).pathname.replace(/\/+$/, "");
  const mark = "/api/device/";
  const index = path.indexOf(mark);
  return index >= 0 ? path.slice(index + mark.length) : "";
}

async function userId(request: Request) {
  if (!authConfigured) {
    if (process.env.DATABASE_URL?.trim()) return "";
    return "dev-user";
  }
  const session = await auth.api.getSession({ headers: request.headers });
  return session?.user?.id || "";
}

export const Route = createFileRoute("/api/device/$")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (tail(request) !== "list") return json({ ok: false, error: "not_found" }, 404);
        const uid = await userId(request);
        if (!uid) return json({ ok: false, error: "unauthorized" }, 401);
        const data = await listDevicesForSettings();
        return json({ ok: true, userId: uid, ...data });
      },
      POST: async ({ request }) => {
        const action = tail(request);
        let body: Record<string, unknown> = {};
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          body = {};
        }
        if (action === "pair/request") {
          const result = await requestDevicePair({
            deviceName: String(body.deviceName || ""),
            hostname: String(body.hostname || ""),
            agentVersion: String(body.agentVersion || ""),
          });
          if (!result.ok) return json({ ok: false, error: result.error }, result.status);
          return json(result);
        }
        if (action === "pair/status") {
          const result = await devicePairStatus({
            pairingRequestId: String(body.pairingRequestId || ""),
            pairingCode: String(body.pairingCode || ""),
          });
          if (result.status === "NOT_FOUND") return json({ ok: false, error: "NOT_FOUND" }, 404);
          if (result.status !== "APPROVED" || !result.deviceKey) {
            return json({ ok: true, status: result.status, deviceName: result.deviceName });
          }
          const gas = await resolveGasExec();
          const origin = new URL(request.url).origin;
          return json({
            ok: true,
            status: "APPROVED",
            deviceId: result.deviceId,
            deviceKey: result.deviceKey,
            deviceName: result.deviceName,
            serverUrl: origin,
            gasUrl: gas.url,
            routes: { claim: "vercel", paymentReady: "vercel", fallback: "gas" },
          });
        }
        const uid = await userId(request);
        if (!uid) return json({ ok: false, error: "unauthorized" }, 401);
        if (action === "pair/approve") {
          const mode = body.mode === "replace" ? "replace" : "approve";
          const result = await approveDevicePair({
            pairingRequestId: String(body.pairingRequestId || ""),
            userId: uid,
            mode,
          });
          if (!result.ok) return json(result, result.error === "NEED_TRANSFER" ? 409 : 400);
          return json(result);
        }
        if (action === "pair/reject") {
          const result = await rejectDevicePair(String(body.pairingRequestId || ""));
          return json(result, result.ok ? 200 : 404);
        }
        if (action === "heartbeat") {
          const result = await heartbeatDevice(deviceKeyFromRequest(request), String(body.agentVersion || ""));
          if (!result.ok) return json(result, 401);
          return json(result);
        }
        if (action === "revoke") {
          const result = await revokeDevice({ deviceId: String(body.deviceId || ""), userId: uid });
          return json(result, result.ok ? 200 : result.error === "FORBIDDEN" ? 403 : 404);
        }
        if (action === "share") {
          const result = await shareDevice({ deviceId: String(body.deviceId || ""), userId: uid });
          return json(result, result.ok ? 200 : 404);
        }
        if (action === "replace") {
          const result = await replaceDevice({ deviceId: String(body.deviceId || ""), userId: uid });
          return json(result, result.ok ? 200 : 404);
        }
        return json({ ok: false, error: "not_found" }, 404);
      },
    },
  },
});
