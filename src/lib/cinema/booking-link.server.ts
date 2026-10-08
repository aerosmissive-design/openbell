import { readAppMeta, writeAppMeta } from "./app-meta.server";
import { bookingDeviceName, mergeAgentSeen, mergeSeenMaps, readAgentSeen } from "./booking-link";

const SEEN_KEY = "agent_seen_v1";
const SEEN_CACHE_NS = "openbell";
const SEEN_CACHE_KEY = "agent-seen-v1";
const SEEN_CACHE_TTL_SEC = 10 * 60;

// Neon이 용량 한도로 기록을 버리면 인스턴스마다 메모리가 비어 조회가 빈 시각을 돌려준다.
let seenMem = "";

function asSeenRaw(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
  return "";
}

function within<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

async function readSeenCache(): Promise<string> {
  try {
    const { getCache } = await import("@vercel/functions");
    const hit = await within(getCache({ namespace: SEEN_CACHE_NS }).get(SEEN_CACHE_KEY), 1500, null);
    return asSeenRaw(hit);
  } catch {
    return "";
  }
}

async function writeSeenCache(raw: string): Promise<boolean> {
  try {
    const { getCache } = await import("@vercel/functions");
    const ok = await within(
      getCache({ namespace: SEEN_CACHE_NS })
        .set(SEEN_CACHE_KEY, raw, { ttl: SEEN_CACHE_TTL_SEC, name: "agent-seen" })
        .then(() => true),
      1500,
      false,
    );
    return ok;
  } catch {
    return false;
  }
}

export async function recordAgentSeen(name: string) {
  const device = bookingDeviceName(name);
  if (!device) return { ok: false as const, error: "device" };
  const now = new Date().toISOString();
  let prevDb = "";
  try {
    prevDb = await readAppMeta(SEEN_KEY);
  } catch {
    prevDb = "";
  }
  const prev = mergeSeenMaps([seenMem, await readSeenCache(), prevDb]);
  const next = mergeAgentSeen(prev, device, now);
  seenMem = next;
  let stored = false;
  try {
    const wrote = await writeAppMeta(SEEN_KEY, next);
    stored = wrote.ok;
  } catch {
    stored = false;
  }
  const cached = await writeSeenCache(next);
  return { ok: true as const, stored: stored || cached, name: device };
}

export async function listAgentSeen() {
  let fromDb = "";
  try {
    fromDb = await readAppMeta(SEEN_KEY);
  } catch {
    fromDb = "";
  }
  return readAgentSeen(mergeSeenMaps([seenMem, await readSeenCache(), fromDb]));
}
