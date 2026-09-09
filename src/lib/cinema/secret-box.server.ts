import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { CONFIG_SECRET_KEYS } from "./secret-fields";
import type { WatchConfig } from "./types";

const PREFIX = "ob1.";

function keyBuf() {
  const raw =
    (typeof process !== "undefined" &&
      (process.env.BETTER_AUTH_SECRET || process.env.AUTH_SECRET || "")) ||
    "";
  if (raw.trim().length < 8) return null;
  return scryptSync(raw.trim(), "openbell-settings-v1", 32);
}

export function sealSecret(plain: string) {
  const text = String(plain || "");
  if (!text) return "";
  if (text.startsWith(PREFIX)) return text;
  const key = keyBuf();
  if (!key) return text;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, enc]).toString("base64url");
}

export function openSecret(value: string) {
  const text = String(value || "");
  if (!text) return "";
  if (!text.startsWith(PREFIX)) return text;
  const key = keyBuf();
  if (!key) return "";
  try {
    const buf = Buffer.from(text.slice(PREFIX.length), "base64url");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}

export function sealConfigSecrets(config: WatchConfig): WatchConfig {
  const next = { ...config };
  for (const key of CONFIG_SECRET_KEYS) next[key] = sealSecret(next[key] || "");
  return next;
}

export function revealConfigSecrets(config: WatchConfig): WatchConfig {
  const next = { ...config };
  for (const key of CONFIG_SECRET_KEYS) next[key] = openSecret(next[key] || "");
  return next;
}
