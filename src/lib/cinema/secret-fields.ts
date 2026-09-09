import type { WatchConfig } from "./types";

export const CONFIG_SECRET_KEYS = [
  "telegramToken",
  "kakaoRestKey",
  "kakaoRefreshToken",
  "gmailAppPassword",
  "xApiKey",
  "xApiSecret",
  "xAccessToken",
  "xAccessSecret",
  "xClientSecret",
  "xRefreshToken",
] as const;

export const CONFIG_ACCOUNT_KEYS = [
  "gasWebUrl",
  "gasScriptId",
  "gasSyncKey",
] as const;

export function stripConfigSecrets(config: WatchConfig): WatchConfig {
  const next = { ...config };
  for (const key of CONFIG_SECRET_KEYS) next[key] = "";
  for (const key of CONFIG_ACCOUNT_KEYS) next[key] = "";
  return next;
}
