import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const PREFIX = "obn1.";

function keyBuf() {
  const dedicated = process.env.ENCRYPTION_KEY?.trim() || "";
  if (/^[0-9a-fA-F]{64}$/.test(dedicated)) return Buffer.from(dedicated, "hex");
  if (dedicated.length >= 16) {
    try {
      const decoded = Buffer.from(dedicated, "base64");
      if (decoded.length === 32) return decoded;
    } catch {
      /* fall through to scrypt */
    }
    return scryptSync(dedicated, "openbell-notify-v1", 32);
  }
  const fallback =
    process.env.BETTER_AUTH_SECRET?.trim() || process.env.AUTH_SECRET?.trim() || "";
  if (fallback.length < 8) return null;
  return scryptSync(fallback, "openbell-notify-v1", 32);
}

export function encryptionKeySource() {
  const dedicated = process.env.ENCRYPTION_KEY?.trim() || "";
  if (dedicated.length >= 16 || /^[0-9a-fA-F]{64}$/.test(dedicated)) return "ENCRYPTION_KEY";
  return "BETTER_AUTH_SECRET";
}

export function sealNotifySecret(plain: string) {
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

export function openNotifySecret(value: string) {
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
