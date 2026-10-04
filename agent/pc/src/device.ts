import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { PC_ROOT } from "./env.js";

export type DeviceFile = {
  deviceId: string;
  deviceName: string;
  deviceKey: string;
  serverUrl: string;
  gasUrl: string;
  version: string;
};

const NAMES = new Set(["G_PC", "G_DS225+", "G_DS423+"]);

export function deviceFilePath() {
  const override = process.env.OPENBELL_DEVICE_FILE?.trim();
  if (override) return override;
  if (process.platform === "win32" && process.env.APPDATA) return join(process.env.APPDATA, "OpenBell", "device.json");
  return join(PC_ROOT, "device.json");
}

export function deviceName() {
  const named = process.env.DEVICE_NAME?.trim() || "";
  if (NAMES.has(named)) return named;
  return "G_PC";
}

export function loadDevice(): DeviceFile | null {
  try {
    const parsed = JSON.parse(readFileSync(deviceFilePath(), "utf8")) as DeviceFile;
    if (!parsed?.deviceKey || !parsed.deviceId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveDevice(data: DeviceFile) {
  const path = deviceFilePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), { mode: 0o600 });
  if (process.platform === "win32" && process.env.USERNAME) {
    execFile("icacls", [path, "/inheritance:r", "/grant:r", `${process.env.USERNAME}:(R,W)`], () => undefined);
  }
}

export function clearDevice() {
  rmSync(deviceFilePath(), { force: true });
  delete process.env.OPENBELL_DEVICE_KEY;
}

export function applySavedDevice() {
  const saved = loadDevice();
  if (!saved) return null;
  process.env.OPENBELL_DEVICE_KEY = saved.deviceKey;
  if (saved.gasUrl && !process.env.GAS_WEB_URL?.trim()) process.env.GAS_WEB_URL = saved.gasUrl;
  return saved;
}

export async function ensurePaired(base: string, agentVersion: string): Promise<DeviceFile> {
  const existing = applySavedDevice();
  if (existing) return existing;
  const name = deviceName();
  const host = hostname();
  for (;;) {
    const requested = await fetch(`${base}/api/device/pair/request`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceName: name, deviceType: name === "G_PC" ? "PC" : "NAS", agentVersion, hostname: host }),
    });
    const body = (await requested.json().catch(() => ({}))) as {
      ok?: boolean;
      pairingRequestId?: string;
      pairingCode?: string;
      error?: string;
    };
    if (!body.ok || !body.pairingRequestId || !body.pairingCode) {
      console.log(`[pair] ${body.error || requested.status}. retry 30s`);
      await new Promise((resolve) => setTimeout(resolve, 30_000));
      continue;
    }
    console.log("OpenBell Device Pairing");
    console.log(`Device: ${name}`);
    console.log(`Pairing Code: ${body.pairingCode}`);
    console.log("Status: WAITING_FOR_APPROVAL");
    const deadline = Date.now() + 10 * 60 * 1000;
    let approved = false;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const statusRes = await fetch(`${base}/api/device/pair/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pairingRequestId: body.pairingRequestId, pairingCode: body.pairingCode }),
      });
      const status = (await statusRes.json().catch(() => ({}))) as {
        status?: string;
        deviceKey?: string;
        deviceId?: string;
        deviceName?: string;
        serverUrl?: string;
        gasUrl?: string;
      };
      if (status.deviceKey && status.deviceId) {
        const saved: DeviceFile = {
          deviceId: status.deviceId,
          deviceName: status.deviceName || name,
          deviceKey: status.deviceKey,
          serverUrl: status.serverUrl || base,
          gasUrl: status.gasUrl || "",
          version: agentVersion,
        };
        saveDevice(saved);
        process.env.OPENBELL_DEVICE_KEY = saved.deviceKey;
        if (saved.gasUrl) process.env.GAS_WEB_URL = saved.gasUrl;
        console.log("[pair] approved");
        return saved;
      }
      if (status.status === "REJECTED" || status.status === "EXPIRED") break;
      approved = status.status === "APPROVED";
      void approved;
    }
    console.log("[pair] not approved. requesting again");
  }
}
