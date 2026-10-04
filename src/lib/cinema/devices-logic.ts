import { createHash, timingSafeEqual } from "node:crypto";

export const DEVICE_NAMES = ["G_PC", "G_DS225+", "G_DS423+"] as const;
export type DeviceName = (typeof DEVICE_NAMES)[number];
export type DeviceType = "PC" | "NAS";

const PAIR_MS = 10 * 60 * 1000;
const RATE_MS = 5 * 60 * 1000;
const RATE_MAX = 5;

export type DeviceRow = {
  id: string;
  name: DeviceName;
  type: DeviceType;
  hostname: string;
  agentVersion: string;
  status: "ACTIVE" | "REVOKED";
  createdAt: string;
  lastSeenAt: string;
  lastJobClaimAt: string;
  lastPaymentReadyAt: string;
  revokedAt: string;
  ownerUserId: string;
};

export type CredRow = {
  deviceId: string;
  keyHash: string;
  createdAt: string;
  revokedAt: string;
};

export type BindingRow = {
  deviceId: string;
  userId: string;
  role: "owner" | "shared";
  createdAt: string;
  revokedAt: string;
};

export type PairingRow = {
  id: string;
  deviceName: DeviceName;
  deviceType: DeviceType;
  hostname: string;
  agentVersion: string;
  code: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED";
  expiresAt: string;
  createdAt: string;
  userId: string;
  deviceId: string;
  /** Present until expiry. Status poll with the code can read it. */
  deviceKey: string;
};

export type Registry = {
  devices: DeviceRow[];
  creds: CredRow[];
  bindings: BindingRow[];
  pairing: PairingRow[];
  hits: { k: string; at: number }[];
};

export function emptyRegistry(): Registry {
  return { devices: [], creds: [], bindings: [], pairing: [], hits: [] };
}

export function hashDeviceKey(key: string) {
  return createHash("sha256").update(key).digest("hex");
}

export function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function pairingCodeFromBytes(bytes: Uint8Array) {
  const take = (i: number) => ALPHABET[bytes[i]! % ALPHABET.length];
  return `${take(0)}${take(1)}${take(2)}${take(3)}-${take(4)}${take(5)}`;
}

export function deviceTypeFor(name: DeviceName): DeviceType {
  return name === "G_PC" ? "PC" : "NAS";
}

export function isDeviceName(value: string): value is DeviceName {
  return (DEVICE_NAMES as readonly string[]).includes(value);
}

export type Freshness = "ONLINE" | "DELAYED" | "OFFLINE" | "NONE";

export function freshness(iso: string, now: number): Freshness {
  const t = Date.parse(iso);
  if (!Number.isFinite(t) || t <= 0) return "NONE";
  const age = now - t;
  if (age <= 2 * 60 * 1000) return "ONLINE";
  if (age <= 5 * 60 * 1000) return "DELAYED";
  return "OFFLINE";
}

function prune(reg: Registry, now: number): Registry {
  return {
    ...reg,
    hits: reg.hits.filter((hit) => now - hit.at < RATE_MS),
    pairing: reg.pairing
      .filter((row) => now - Date.parse(row.createdAt) < 24 * 60 * 60 * 1000)
      .map((row) => {
        if (row.status === "PENDING" && Date.parse(row.expiresAt) <= now) {
          return { ...row, status: "EXPIRED" as const, code: "", deviceKey: "" };
        }
        if (row.status !== "PENDING" && Date.parse(row.expiresAt) <= now && row.deviceKey) {
          return { ...row, deviceKey: "", code: "" };
        }
        return row;
      }),
  };
}

export function applyPairRequest(
  inputReg: Registry,
  input: { deviceName: DeviceName; hostname: string; agentVersion: string; now: number; id: string; code: string },
): { reg: Registry; ok: true; pairingRequestId: string; pairingCode: string; expiresAt: string } | { reg: Registry; ok: false; error: "RATE_LIMIT" } {
  const reg = prune(inputReg, input.now);
  const hostname = input.hostname.slice(0, 80);
  const pending = reg.pairing.find(
    (row) =>
      row.status === "PENDING" &&
      row.deviceName === input.deviceName &&
      row.hostname === hostname &&
      Date.parse(row.expiresAt) > input.now,
  );
  if (pending) {
    return { reg, ok: true, pairingRequestId: pending.id, pairingCode: pending.code, expiresAt: pending.expiresAt };
  }
  const bucket = input.deviceName;
  const recent = reg.hits.filter((hit) => hit.k === bucket).length;
  if (recent >= RATE_MAX) return { reg, ok: false, error: "RATE_LIMIT" };
  const expiresAt = new Date(input.now + PAIR_MS).toISOString();
  const row: PairingRow = {
    id: input.id,
    deviceName: input.deviceName,
    deviceType: deviceTypeFor(input.deviceName),
    hostname,
    agentVersion: input.agentVersion.slice(0, 40),
    code: input.code,
    status: "PENDING",
    expiresAt,
    createdAt: new Date(input.now).toISOString(),
    userId: "",
    deviceId: "",
    deviceKey: "",
  };
  return {
    reg: { ...reg, pairing: [...reg.pairing, row], hits: [...reg.hits, { k: bucket, at: input.now }] },
    ok: true,
    pairingRequestId: row.id,
    pairingCode: row.code,
    expiresAt,
  };
}

function activeBindings(reg: Registry, deviceId: string) {
  return reg.bindings.filter((row) => row.deviceId === deviceId && !row.revokedAt);
}

function rotate(
  reg: Registry,
  existing: DeviceRow,
  input: { userId: string; now: number; deviceKey: string; keyHash: string; hostname: string; agentVersion: string },
): Registry {
  const nowIso = new Date(input.now).toISOString();
  const devices = reg.devices.map((row) =>
    row.id === existing.id
      ? {
          ...row,
          status: "ACTIVE" as const,
          hostname: input.hostname,
          agentVersion: input.agentVersion,
          ownerUserId: input.userId,
          revokedAt: "",
        }
      : row,
  );
  const creds = reg.creds.map((row) => (row.deviceId === existing.id && !row.revokedAt ? { ...row, revokedAt: nowIso } : row));
  creds.push({ deviceId: existing.id, keyHash: input.keyHash, createdAt: nowIso, revokedAt: "" });
  const bindings = reg.bindings.map((row) =>
    row.deviceId === existing.id && !row.revokedAt ? { ...row, revokedAt: nowIso } : row,
  );
  bindings.push({ deviceId: existing.id, userId: input.userId, role: "owner", createdAt: nowIso, revokedAt: "" });
  return { ...reg, devices, creds, bindings };
}

export function applyApprove(
  inputReg: Registry,
  input: {
    pairingId: string;
    userId: string;
    mode: "approve" | "replace";
    now: number;
    deviceId: string;
    deviceKey: string;
    keyHash: string;
  },
):
  | { reg: Registry; ok: true; deviceId: string; deviceName: DeviceName }
  | { reg: Registry; ok: false; error: "NOT_FOUND" | "EXPIRED" | "NEED_TRANSFER" } {
  const reg = prune(inputReg, input.now);
  const pair = reg.pairing.find((row) => row.id === input.pairingId);
  if (!pair || pair.status !== "PENDING") return { reg, ok: false, error: "NOT_FOUND" };
  if (Date.parse(pair.expiresAt) <= input.now) return { reg, ok: false, error: "EXPIRED" };
  const existing = reg.devices.find((row) => row.name === pair.deviceName && row.status === "ACTIVE");
  if (existing && existing.ownerUserId !== input.userId && input.mode !== "replace") {
    return { reg, ok: false, error: "NEED_TRANSFER" };
  }
  const nowIso = new Date(input.now).toISOString();
  let next = reg;
  let deviceId = input.deviceId;
  if (existing) {
    deviceId = existing.id;
    next = rotate(reg, existing, {
      userId: input.userId,
      now: input.now,
      deviceKey: input.deviceKey,
      keyHash: input.keyHash,
      hostname: pair.hostname,
      agentVersion: pair.agentVersion,
    });
  } else {
    const revived = reg.devices.find((row) => row.name === pair.deviceName);
    if (revived) {
      deviceId = revived.id;
      next = rotate(reg, revived, {
        userId: input.userId,
        now: input.now,
        deviceKey: input.deviceKey,
        keyHash: input.keyHash,
        hostname: pair.hostname,
        agentVersion: pair.agentVersion,
      });
    } else {
      const device: DeviceRow = {
        id: deviceId,
        name: pair.deviceName,
        type: pair.deviceType,
        hostname: pair.hostname,
        agentVersion: pair.agentVersion,
        status: "ACTIVE",
        createdAt: nowIso,
        lastSeenAt: "",
        lastJobClaimAt: "",
        lastPaymentReadyAt: "",
        revokedAt: "",
        ownerUserId: input.userId,
      };
      next = {
        ...reg,
        devices: [...reg.devices, device],
        creds: [...reg.creds, { deviceId, keyHash: input.keyHash, createdAt: nowIso, revokedAt: "" }],
        bindings: [...reg.bindings, { deviceId, userId: input.userId, role: "owner", createdAt: nowIso, revokedAt: "" }],
      };
    }
  }
  next = {
    ...next,
    pairing: next.pairing.map((row) =>
      row.id === pair.id
        ? { ...row, status: "APPROVED" as const, userId: input.userId, deviceId, deviceKey: input.deviceKey }
        : row,
    ),
  };
  return { reg: next, ok: true, deviceId, deviceName: pair.deviceName };
}

export function applyReject(
  inputReg: Registry,
  input: { pairingId: string; now: number },
): { reg: Registry; ok: boolean } {
  const reg = prune(inputReg, input.now);
  const pair = reg.pairing.find((row) => row.id === input.pairingId && row.status === "PENDING");
  if (!pair) return { reg, ok: false };
  return {
    reg: {
      ...reg,
      pairing: reg.pairing.map((row) =>
        row.id === pair.id ? { ...row, status: "REJECTED" as const, code: "", deviceKey: "" } : row,
      ),
    },
    ok: true,
  };
}

export function applyStatus(
  inputReg: Registry,
  input: { pairingId: string; code: string; now: number },
): {
  reg: Registry;
  status: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | "NOT_FOUND";
  deviceKey: string;
  deviceId: string;
  deviceName: DeviceName | "";
} {
  const reg = prune(inputReg, input.now);
  const pair = reg.pairing.find((row) => row.id === input.pairingId);
  if (!pair) return { reg, status: "NOT_FOUND", deviceKey: "", deviceId: "", deviceName: "" };
  if (!safeEqual(pair.code, input.code)) return { reg, status: "NOT_FOUND", deviceKey: "", deviceId: "", deviceName: "" };
  if (pair.status === "PENDING" && Date.parse(pair.expiresAt) <= input.now) {
    return { reg, status: "EXPIRED", deviceKey: "", deviceId: "", deviceName: pair.deviceName };
  }
  return {
    reg,
    status: pair.status === "PENDING" ? "PENDING" : pair.status,
    deviceKey: pair.status === "APPROVED" ? pair.deviceKey : "",
    deviceId: pair.deviceId,
    deviceName: pair.deviceName,
  };
}

export function resolveDeviceKey(reg: Registry, deviceKey: string):
  | { ok: true; device: DeviceRow; userIds: string[] }
  | { ok: false; error: "DEVICE_UNAUTHORIZED" | "DEVICE_REVOKED" } {
  if (!deviceKey) return { ok: false, error: "DEVICE_UNAUTHORIZED" };
  const keyHash = hashDeviceKey(deviceKey);
  const cred = reg.creds.find((row) => safeEqual(row.keyHash, keyHash));
  if (!cred) return { ok: false, error: "DEVICE_UNAUTHORIZED" };
  const device = reg.devices.find((row) => row.id === cred.deviceId);
  if (!device || cred.revokedAt || device.status !== "ACTIVE") return { ok: false, error: "DEVICE_REVOKED" };
  const userIds = activeBindings(reg, device.id).map((row) => row.userId);
  if (!userIds.length) return { ok: false, error: "DEVICE_REVOKED" };
  return { ok: true, device, userIds };
}

export function touchDevice(
  reg: Registry,
  deviceId: string,
  field: "lastSeenAt" | "lastJobClaimAt" | "lastPaymentReadyAt",
  now: number,
): Registry {
  const iso = new Date(now).toISOString();
  return {
    ...reg,
    devices: reg.devices.map((row) => {
      if (row.id !== deviceId) return row;
      const next = { ...row, lastSeenAt: iso };
      if (field !== "lastSeenAt") next[field] = iso;
      return next;
    }),
  };
}

export function applyRevoke(reg: Registry, input: { deviceId: string; userId: string; now: number }): { reg: Registry; ok: boolean; error?: string } {
  const device = reg.devices.find((row) => row.id === input.deviceId);
  if (!device || device.status !== "ACTIVE") return { reg, ok: false, error: "NOT_FOUND" };
  if (device.ownerUserId !== input.userId) return { reg, ok: false, error: "FORBIDDEN" };
  const iso = new Date(input.now).toISOString();
  return {
    reg: {
      ...reg,
      devices: reg.devices.map((row) => (row.id === device.id ? { ...row, status: "REVOKED" as const, revokedAt: iso } : row)),
      creds: reg.creds.map((row) => (row.deviceId === device.id && !row.revokedAt ? { ...row, revokedAt: iso } : row)),
      bindings: reg.bindings.map((row) => (row.deviceId === device.id && !row.revokedAt ? { ...row, revokedAt: iso } : row)),
    },
    ok: true,
  };
}

export function applyShare(reg: Registry, input: { deviceId: string; userId: string; now: number }): { reg: Registry; ok: boolean; error?: string } {
  const device = reg.devices.find((row) => row.id === input.deviceId && row.status === "ACTIVE");
  if (!device) return { reg, ok: false, error: "NOT_FOUND" };
  if (activeBindings(reg, device.id).some((row) => row.userId === input.userId)) return { reg, ok: true };
  const iso = new Date(input.now).toISOString();
  return {
    reg: {
      ...reg,
      bindings: [...reg.bindings, { deviceId: device.id, userId: input.userId, role: "shared", createdAt: iso, revokedAt: "" }],
    },
    ok: true,
  };
}

export function pendingPublic(reg: Registry, now: number) {
  return prune(reg, now).pairing
    .filter((row) => row.status === "PENDING" && Date.parse(row.expiresAt) > now)
    .map((row) => ({
      pairingRequestId: row.id,
      deviceName: row.deviceName,
      deviceType: row.deviceType,
      hostname: row.hostname,
      agentVersion: row.agentVersion,
      pairingCode: row.code,
      expiresAt: row.expiresAt,
    }));
}

export function devicesPublic(reg: Registry, now: number) {
  return reg.devices.map((row) => ({
    deviceId: row.id,
    name: row.name,
    deviceType: row.type,
    status: row.status,
    hostname: row.hostname,
    agentVersion: row.agentVersion,
    ownerUserId: row.ownerUserId,
    sharedUserIds: activeBindings(reg, row.id).filter((b) => b.role === "shared").map((b) => b.userId),
    lastSeenAt: row.lastSeenAt,
    lastJobClaimAt: row.lastJobClaimAt,
    lastPaymentReadyAt: row.lastPaymentReadyAt,
    freshness: freshness(row.lastSeenAt, now),
  }));
}

export function gasPublishRows(reg: Registry) {
  return reg.devices
    .map((device) => {
      const cred = reg.creds.find((row) => row.deviceId === device.id && !row.revokedAt);
      return {
        deviceId: device.id,
        deviceName: device.name,
        userId: device.ownerUserId,
        keyHash: cred?.keyHash || "",
        status: device.status,
      };
    })
    .filter((row) => row.keyHash || row.status === "REVOKED");
}
