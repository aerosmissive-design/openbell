import type { WatchConfig } from "./types";

/** 사용자가 직접 적은 값. 원격이 비어 있으면 로컬을 유지한다. */
const FILLED_TEXT = [
  "email",
  "gmailAppPassword",
  "telegramToken",
  "telegramChatId",
  "webhookUrl",
  "kakaoRestKey",
  "kakaoRefreshToken",
  "gasWebUrl",
  "gasSyncKey",
  "gasScriptId",
  "gasSourceStamp",
] as const satisfies readonly (keyof WatchConfig)[];

export function keepTypedConfig<T extends Partial<WatchConfig>>(
  remote: T,
  local: Partial<WatchConfig>,
): T {
  const next = { ...remote };
  for (const key of FILLED_TEXT) {
    const remoteValue = String(next[key] ?? "").trim();
    const localValue = String(local[key] ?? "").trim();
    if (!remoteValue && localValue) next[key] = localValue as T[typeof key];
  }
  const remoteEmail = String(remote.email ?? "").trim();
  if (!remoteEmail && local.emailNotify) next.emailNotify = true as T["emailNotify"];
  return next;
}

export function readLegacyWatchConfig(): Partial<WatchConfig> | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem("openbell-v1");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state?: { config?: Partial<WatchConfig> } };
    const config = parsed?.state?.config;
    if (!config || typeof config !== "object") return null;
    return config;
  } catch {
    return null;
  }
}
