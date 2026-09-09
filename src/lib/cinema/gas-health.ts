export type ChannelLog = {
  at?: number;
  mail?: string;
  telegram?: string;
  kakao?: string;
  x?: string;
};

export type GasHealth = {
  ok: boolean;
  gasAlive: boolean;
  gasAgeMs: number;
  intervalMin: number;
  lastNotify?: ChannelLog | null;
};

export async function probeGasHealth(url: string): Promise<GasHealth | null> {
  const raw = url.trim();
  if (!raw) return null;
  const fromJsonp = await jsonpGasHealth(raw).catch(() => null);
  if (fromJsonp) return fromJsonp;
  try {
    const { pullGasAlertStatus } = await import("./cloud");
    const gas = await pullGasAlertStatus({ data: { url: raw } });
    if (gas.status !== "ok") return null;
    return {
      ok: true,
      gasAlive: Boolean(gas.gasAlive),
      gasAgeMs: Number(gas.gasAgeMs || 0),
      intervalMin: Number(gas.intervalMin || 5),
      lastNotify: gas.lastNotify ?? null,
    };
  } catch {
    return null;
  }
}

function jsonpGasHealth(url: string): Promise<GasHealth> {
  return new Promise((resolve, reject) => {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      reject(new Error("url"));
      return;
    }
    const cb = `__obGas_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    target.searchParams.set("op", "status");
    target.searchParams.set("callback", cb);
    const script = document.createElement("script");
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("timeout"));
    }, 12000);
    const cleanup = () => {
      window.clearTimeout(timer);
      script.remove();
      delete (window as unknown as Record<string, unknown>)[cb];
    };
    (window as unknown as Record<string, (data: Partial<GasHealth> & { lastNotify?: ChannelLog | null }) => void>)[cb] = (data) => {
      cleanup();
      if (!data || data.ok !== true) {
        reject(new Error("status"));
        return;
      }
      resolve({
        ok: true,
        gasAlive: Boolean(data.gasAlive),
        gasAgeMs: Number(data.gasAgeMs || 0),
        intervalMin: Number(data.intervalMin || 5),
        lastNotify: data.lastNotify ?? null,
      });
    };
    script.onerror = () => {
      cleanup();
      reject(new Error("jsonp"));
    };
    script.src = target.toString();
    document.head.appendChild(script);
  });
}
