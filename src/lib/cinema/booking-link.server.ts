import { readAppMeta, writeAppMeta } from "./app-meta.server";
import { bookingDeviceName, mergeAgentSeen, readAgentSeen } from "./booking-link";

const SEEN_KEY = "agent_seen_v1";

export async function recordAgentSeen(name: string) {
  const device = bookingDeviceName(name);
  if (!device) return { ok: false as const, error: "device" };
  const now = new Date().toISOString();
  try {
    const prev = await readAppMeta(SEEN_KEY);
    const wrote = await writeAppMeta(SEEN_KEY, mergeAgentSeen(prev, device, now));
    return { ok: true as const, stored: wrote.ok, name: device };
  } catch {
    return { ok: true as const, stored: false, name: device };
  }
}

export async function listAgentSeen() {
  try {
    return readAgentSeen(await readAppMeta(SEEN_KEY));
  } catch {
    return readAgentSeen("");
  }
}
