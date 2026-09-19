import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 1) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
    out[key] = value;
  }
  return out;
}

export function loadEnvFile(path: string): Record<string, string> {
  try {
    return parseEnvFile(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

/** Fill process.env without overwriting existing vars. */
export function applyEnvFile(path = resolve(PC_ROOT, "config.env")) {
  const parsed = loadEnvFile(path);
  for (const [key, value] of Object.entries(parsed)) {
    if (!process.env[key]) process.env[key] = value;
  }
  return parsed;
}

/** PAYMENT_HARD_STOP=false/0/off is ignored. Payment is never automated. */
export function isPaymentAutomationLocked(value: string | undefined) {
  void value;
  return true;
}

export function isFalseyFlag(value: string | undefined) {
  return Boolean(value && /^(0|false|no|off)$/i.test(value.trim()));
}

/** Server PAYMENT_READY TTL. Agent env PAYMENT_READY_TTL_MS is display-only. */
export const SERVER_PAYMENT_READY_TTL_MS = 10 * 60 * 1000;

export function paymentReadyTtlMinutes(raw = process.env.PAYMENT_READY_TTL_MS) {
  if (!raw?.trim()) return Math.round(SERVER_PAYMENT_READY_TTL_MS / 60_000);
  const ms = Number(raw);
  if (!Number.isFinite(ms) || ms < 60_000) return Math.round(SERVER_PAYMENT_READY_TTL_MS / 60_000);
  return Math.round(ms / 60_000);
}

