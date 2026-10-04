import { randomBytes } from "node:crypto";
import { readAppMeta, writeAppMeta } from "./app-meta.server";
import { resolveGasExec } from "./gas-fallback.server";
import {
  applyApprove,
  applyPairRequest,
  applyReject,
  applyRevoke,
  applyShare,
  applyStatus,
  devicesPublic,
  emptyRegistry,
  gasPublishRows,
  hashDeviceKey,
  isDeviceName,
  pairingCodeFromBytes,
  pendingPublic,
  resolveDeviceKey,
  touchDevice,
  type DeviceName,
  type Registry,
} from "./devices-logic";

const META_KEY = "device_registry_v1";

let chain: Promise<unknown> = Promise.resolve();

function locked<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function load(): Promise<Registry> {
  const raw = await readAppMeta(META_KEY);
  if (!raw) return emptyRegistry();
  try {
    const parsed = JSON.parse(raw) as Registry;
    if (!parsed || !Array.isArray(parsed.devices) || !Array.isArray(parsed.creds)) return emptyRegistry();
    return {
      devices: parsed.devices,
      creds: parsed.creds,
      bindings: Array.isArray(parsed.bindings) ? parsed.bindings : [],
      pairing: Array.isArray(parsed.pairing) ? parsed.pairing : [],
      hits: Array.isArray(parsed.hits) ? parsed.hits : [],
    };
  } catch {
    return emptyRegistry();
  }
}

async function save(reg: Registry) {
  const wrote = await writeAppMeta(META_KEY, JSON.stringify(reg));
  if (!wrote.ok) throw new Error(wrote.reason === "dbQuota" ? "dbQuota" : wrote.reason === "dbConn" ? "dbConn" : "registry_write_failed");
}

function newId(prefix: string) {
  return `${prefix}_${randomBytes(9).toString("base64url")}`;
}

export function deviceKeyFromRequest(request: Request) {
  const header = request.headers.get("x-openbell-device-key")?.trim() || "";
  if (header) return header;
  const auth = request.headers.get("authorization") || "";
  const matched = /^Device\s+(\S+)/i.exec(auth);
  return matched?.[1]?.trim() || "";
}

export function legacyWorkerAllowed() {
  const flag = String(process.env.OPENBELL_LEGACY_WORKER_TOKEN ?? "1").trim().toLowerCase();
  return flag !== "0" && flag !== "false" && flag !== "off";
}

async function publishGas(reg: Registry) {
  const { url, key } = await resolveGasExec();
  if (!url) return;
  for (const device of gasPublishRows(reg)) {
    try {
      await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "deviceUpsert", key, device }),
        redirect: "follow",
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      /* GAS fallback sync is best-effort */
    }
  }
}

export async function readGasDeviceBoard(): Promise<
  { deviceName: string; status: string; lastSeen: string; lastJobClaim: string }[]
> {
  const { url, key } = await resolveGasExec();
  if (!url) return [];
  try {
    const target = new URL(url);
    target.searchParams.set("op", "devices");
    if (key) target.searchParams.set("key", key);
    const res = await fetch(target, { redirect: "follow", signal: AbortSignal.timeout(4000) });
    const text = await res.text();
    if (!res.ok || /<html/i.test(text)) return [];
    const json = JSON.parse(text) as { devices?: { deviceName?: string; status?: string; lastSeen?: string; lastJobClaim?: string }[] };
    if (!Array.isArray(json.devices)) return [];
    return json.devices.map((row) => ({
      deviceName: String(row.deviceName || ""),
      status: String(row.status || ""),
      lastSeen: String(row.lastSeen || ""),
      lastJobClaim: String(row.lastJobClaim || ""),
    }));
  } catch {
    return [];
  }
}

export async function requestDevicePair(input: { deviceName: string; hostname: string; agentVersion: string }) {
  if (!isDeviceName(input.deviceName)) return { ok: false as const, status: 400, error: "deviceName" };
  return locked(async () => {
    const reg = await load();
    const result = applyPairRequest(reg, {
      deviceName: input.deviceName,
      hostname: String(input.hostname || "").slice(0, 80),
      agentVersion: String(input.agentVersion || "").slice(0, 40),
      now: Date.now(),
      id: newId("pr"),
      code: pairingCodeFromBytes(randomBytes(6)),
    });
    if (!result.ok) return { ok: false as const, status: 429, error: result.error };
    if (result.reg !== reg) await save(result.reg);
    return {
      ok: true as const,
      pairingRequestId: result.pairingRequestId,
      pairingCode: result.pairingCode,
      expiresAt: result.expiresAt,
    };
  });
}

export async function approveDevicePair(input: { pairingRequestId: string; userId: string; mode: "approve" | "replace" }) {
  const issued = randomBytes(32).toString("base64url");
  return locked(async () => {
    const reg = await load();
    const result = applyApprove(reg, {
      pairingId: input.pairingRequestId,
      userId: input.userId,
      mode: input.mode,
      now: Date.now(),
      deviceId: newId("dev"),
      deviceKey: issued,
      keyHash: hashDeviceKey(issued),
    });
    if (!result.ok) return result;
    await save(result.reg);
    void publishGas(result.reg);
    return { ok: true as const, deviceId: result.deviceId, deviceName: result.deviceName };
  });
}

export async function rejectDevicePair(pairingRequestId: string) {
  return locked(async () => {
    const reg = await load();
    const result = applyReject(reg, { pairingId: pairingRequestId, now: Date.now() });
    if (result.ok) await save(result.reg);
    return { ok: result.ok };
  });
}

export async function devicePairStatus(input: { pairingRequestId: string; pairingCode: string }) {
  return locked(async () => {
    const reg = await load();
    const result = applyStatus(reg, {
      pairingId: input.pairingRequestId,
      code: input.pairingCode,
      now: Date.now(),
    });
    if (result.reg !== reg) await save(result.reg);
    return result;
  });
}

export async function listDevicesForSettings() {
  const reg = await load();
  const now = Date.now();
  const gas = await readGasDeviceBoard();
  return { pending: pendingPublic(reg, now), devices: devicesPublic(reg, now), gas };
}

export async function heartbeatDevice(deviceKey: string, agentVersion: string) {
  return locked(async () => {
    const reg = await load();
    const resolved = resolveDeviceKey(reg, deviceKey);
    if (!resolved.ok) return resolved;
    const next = touchDevice(reg, resolved.device.id, "lastSeenAt", Date.now());
    if (agentVersion) {
      next.devices = next.devices.map((row) =>
        row.id === resolved.device.id ? { ...row, agentVersion: agentVersion.slice(0, 40) } : row,
      );
    }
    await save(next);
    return { ok: true as const, deviceId: resolved.device.id, deviceName: resolved.device.name, userId: resolved.device.ownerUserId };
  });
}

export async function revokeDevice(input: { deviceId: string; userId: string }) {
  return locked(async () => {
    const reg = await load();
    const result = applyRevoke(reg, { ...input, now: Date.now() });
    if (!result.ok) return result;
    await save(result.reg);
    void publishGas(result.reg);
    return { ok: true as const };
  });
}

export async function shareDevice(input: { deviceId: string; userId: string }) {
  return locked(async () => {
    const reg = await load();
    const result = applyShare(reg, { ...input, now: Date.now() });
    if (!result.ok) return result;
    await save(result.reg);
    return { ok: true as const };
  });
}

export async function replaceDevice(input: { deviceId: string; userId: string }) {
  return locked(async () => {
    const reg = await load();
    const device = reg.devices.find((row) => row.id === input.deviceId);
    if (!device) return { ok: false as const, error: "NOT_FOUND" };
    const revoked = applyRevoke(
      { ...reg, devices: reg.devices.map((row) => (row.id === device.id ? { ...row, ownerUserId: input.userId } : row)) },
      { deviceId: device.id, userId: input.userId, now: Date.now() },
    );
    if (!revoked.ok) return revoked;
    await save(revoked.reg);
    void publishGas(revoked.reg);
    return { ok: true as const, rePair: true as const };
  });
}

export type AgentAuth =
  | { ok: true; via: "device"; userId: string; userIds: string[]; deviceId: string; deviceName: DeviceName }
  | { ok: true; via: "legacy" }
  | { ok: false; status: number; error: string; reason?: string };

export async function authorizeAgent(request: Request, touch: "seen" | "claim" | "payment"): Promise<AgentAuth> {
  const presented = deviceKeyFromRequest(request);
  if (presented) {
    return locked(async () => {
      const reg = await load();
      const resolved = resolveDeviceKey(reg, presented);
      if (!resolved.ok) return { ok: false as const, status: 401, error: resolved.error };
      const field = touch === "claim" ? "lastJobClaimAt" : touch === "payment" ? "lastPaymentReadyAt" : "lastSeenAt";
      await save(touchDevice(reg, resolved.device.id, field, Date.now()));
      return {
        ok: true as const,
        via: "device" as const,
        userId: resolved.device.ownerUserId,
        userIds: resolved.userIds,
        deviceId: resolved.device.id,
        deviceName: resolved.device.name,
      };
    });
  }
  if (!legacyWorkerAllowed()) return { ok: false, status: 401, error: "DEVICE_UNAUTHORIZED" };
  const { authorizeNasWorker, nasJobsConfigured } = await import("./nas-jobs.server");
  if (!nasJobsConfigured()) return { ok: false, status: 503, error: "no_token", reason: "no_token" };
  if (!authorizeNasWorker(request)) return { ok: false, status: 401, error: "unauthorized" };
  return { ok: true, via: "legacy" };
}
