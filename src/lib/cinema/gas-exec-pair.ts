export type GasExecPair = { url: string; key: string };

export function isGasExecHost(raw: string) {
  try {
    const host = new URL(raw).hostname;
    return host.endsWith("script.google.com") || host.endsWith("googleusercontent.com");
  } catch {
    return false;
  }
}

/** A sync key stays with the URL it was stored for. A different URL without a new key drops it. */
export function pairGasExec(current: GasExecPair, next: { url: string; key?: string }): GasExecPair {
  const url = next.url.trim();
  if (!isGasExecHost(url)) return { url: current.url, key: current.key };
  const provided = String(next.key || "").trim();
  if (provided) return { url, key: provided };
  if (current.url === url) return { url, key: current.key };
  return { url, key: "" };
}

/** The env key belongs to the env URL only. Any other remembered URL is left as it is. */
export function envGasPair(current: GasExecPair, envUrl: string, envKey: string): GasExecPair | null {
  const url = envUrl.trim();
  if (!isGasExecHost(url)) return null;
  return pairGasExec(current, { url, key: envKey });
}
