import { collectRegisteredEmails, isAccountEmail, normalizeAccountEmail } from "./registered-emails";

const URL_ENV = ["GAS_WEB_URL", "GAS_WEB_URL_AERO1", "GAS_WEB_URL_AERO2"] as const;
const KEY_ENV = ["GAS_SYNC_KEY", "GAS_SYNC_KEY_AERO1", "GAS_SYNC_KEY_AERO2"] as const;

export type GasAccountSlot = { url: string; key: string };

export type GasAccountMeta = { email: string; url: string; scriptId: string; key: string };

/** https GAS web-app URLs already configured on the server. The key stays server-side. */
export function gasAccountSlots(env: Record<string, string | undefined>): GasAccountSlot[] {
  const out: GasAccountSlot[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < URL_ENV.length; i += 1) {
    const url = gasExecUrl(env[URL_ENV[i]]);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ url, key: String(env[KEY_ENV[i]] || "").trim() });
  }
  return out;
}

function gasExecUrl(raw: string | undefined): string {
  try {
    const target = new URL(String(raw || "").trim());
    const host = target.hostname;
    if (target.protocol !== "https:") return "";
    if (!host.endsWith("script.google.com") && !host.endsWith("googleusercontent.com")) return "";
    return target.toString().replace(/\/dev$/, "/exec");
  } catch {
    return "";
  }
}

function readMeta(text: string): { email: string; scriptId: string } {
  const raw = text.trim();
  if (!raw || raw === "openbell" || /<html/i.test(raw)) return { email: "", scriptId: "" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { email: "", scriptId: "" };
  }
  if (!parsed || typeof parsed !== "object") return { email: "", scriptId: "" };
  const record = parsed as { email?: unknown; id?: unknown };
  const email = normalizeAccountEmail(record.email);
  const scriptId = String(record.id || "").trim();
  return {
    email: isAccountEmail(email) ? email : "",
    scriptId: /^[A-Za-z0-9_-]{8,80}$/.test(scriptId) ? scriptId : "",
  };
}

/** Mailbox only. A URL, script id, or token in the same JSON is dropped. */
export function emailFromGasMeta(text: string): string {
  return readMeta(text).email;
}

export async function emailsFromGasSlots(
  slots: GasAccountSlot[],
  fetchImpl: typeof fetch,
  timeoutMs = 7000,
): Promise<GasAccountMeta[]> {
  const rows = await Promise.all(
    slots.map(async (slot) => {
      try {
        const target = new URL(slot.url);
        target.searchParams.set("op", "meta");
        const res = await fetchImpl(target, {
          method: "GET",
          redirect: "follow",
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) return null;
        const meta = readMeta(await res.text());
        if (!meta.email) return null;
        return { email: meta.email, url: slot.url, scriptId: meta.scriptId, key: slot.key };
      } catch {
        return null;
      }
    }),
  );
  return rows.filter((row): row is GasAccountMeta => row !== null);
}

export function decideAccountList(
  vesselEmails: string[] | null,
  gasEmails: string[],
): { status: 200; accounts: string[] } | { status: 503 } {
  const accounts = collectRegisteredEmails(vesselEmails ?? [], gasEmails);
  if (vesselEmails === null && accounts.length === 0) return { status: 503 };
  return { status: 200, accounts };
}
