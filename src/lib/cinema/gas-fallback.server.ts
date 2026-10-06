import { readAppMeta, writeAppMeta, type MetaWriteResult } from "./app-meta.server";
import { postGasJson } from "./gas-post";
import { WAKE_AT_KEY, type WakeKind } from "./wake-kind";

const mem = { url: "", key: "" };

function isGasHost(raw: string) {
  try {
    const host = new URL(raw).hostname;
    return host.endsWith("script.google.com") || host.endsWith("googleusercontent.com");
  } catch {
    return false;
  }
}

export function rememberGasExec(url: string, key = "") {
  const raw = url.trim();
  if (!isGasHost(raw)) return;
  mem.url = raw;
  if (key.trim()) mem.key = key.trim();
}

export async function resolveGasExec(): Promise<{ url: string; key: string }> {
  const envUrl = process.env.GAS_WEB_URL?.trim() || "";
  if (isGasHost(envUrl)) mem.url = envUrl;
  const envKey = process.env.GAS_SYNC_KEY?.trim() || "";
  if (envKey) mem.key = envKey;
  if (!mem.url) {
    const stored = await readAppMeta("gas_exec_url");
    if (isGasHost(stored)) mem.url = stored;
    const storedKey = await readAppMeta("gas_sync_key");
    if (storedKey.trim()) mem.key = storedKey.trim();
  }
  return { url: mem.url, key: mem.key };
}

export async function clockPushGas(now: number, kind: string): Promise<"ok" | "fail"> {
  const envUrl = process.env.GAS_WEB_URL?.trim() || mem.url;
  if (!isGasHost(envUrl)) return "fail";
  try {
    const target = new URL(envUrl);
    target.searchParams.set("op", "clock");
    target.searchParams.set("kind", kind);
    target.searchParams.set("at", String(now));
    const res = await fetch(target, { redirect: "follow", signal: AbortSignal.timeout(2000) });
    const text = await res.text();
    if (!res.ok || /<html/i.test(text) || text.trim() === "openbell") return "fail";
    const json = JSON.parse(text) as { ok?: boolean };
    return json.ok ? "ok" : "fail";
  } catch {
    return "fail";
  }
}

export async function readGasExternalAt(): Promise<number> {
  const envUrl = process.env.GAS_WEB_URL?.trim() || mem.url;
  if (!isGasHost(envUrl)) return 0;
  try {
    const target = new URL(envUrl);
    target.searchParams.set("op", "clock");
    const res = await fetch(target, { redirect: "follow", signal: AbortSignal.timeout(2000) });
    const text = await res.text();
    if (!res.ok || /<html/i.test(text)) return 0;
    const json = JSON.parse(text) as { at?: number };
    const at = Number(json.at);
    return Number.isFinite(at) && at > 0 ? at : 0;
  } catch {
    return 0;
  }
}

export async function clockPushNeon(kind: Exclude<WakeKind, "">, now: number): Promise<MetaWriteResult> {
  const kindWrite = await writeAppMeta("watch_wake_kind", kind);
  if (!kindWrite.ok) return kindWrite;
  return writeAppMeta(WAKE_AT_KEY[kind], String(now));
}

export async function relaySeatToGas(body: unknown): Promise<"ok" | "fail" | "skip"> {
  const { url, key } = await resolveGasExec();
  if (!url) return "skip";
  try {
    const payload = typeof body === "object" && body ? { ...(body as Record<string, unknown>) } : {};
    if (key && !payload.key) payload.key = key;
    const { status, text } = await postGasJson(url, payload);
    if (status < 200 || status >= 300 || /<html/i.test(text) || text.trim() === "openbell") return "fail";
    const json = JSON.parse(text) as { ok?: boolean };
    return json.ok ? "ok" : "fail";
  } catch {
    return "fail";
  }
}

export async function relayJobToGas(job: {
  id: string;
  theaterId: string;
  movieTitle: string;
  playDate: string;
  startTime: string;
  hallName: string;
  bookingUrl: string;
  seats?: number;
}): Promise<void> {
  const { url, key } = await resolveGasExec();
  if (!url) return;
  const idempotencyKey = [job.theaterId, job.playDate, job.startTime, job.hallName, job.bookingUrl].join("|");
  try {
    await postGasJson(url, { op: "job", key, job: { ...job, idempotencyKey } });
  } catch {
    /* GAS 죽음은 베셀 잡을 막지 않는다 */
  }
}

export async function ackGasJob(idempotencyKey: string): Promise<void> {
  const { url, key } = await resolveGasExec();
  if (!url || !idempotencyKey) return;
  try {
    const target = new URL(url);
    target.searchParams.set("op", "job");
    target.searchParams.set("action", "ack");
    target.searchParams.set("key", idempotencyKey);
    if (key) target.searchParams.set("sync", key);
    await fetch(target, { redirect: "follow", signal: AbortSignal.timeout(3000) });
  } catch {
    /* ignore */
  }
}
