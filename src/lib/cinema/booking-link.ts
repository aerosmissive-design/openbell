export const BOOKING_DEVICES = ["G_PC", "G_DS225+", "G_DS423+"] as const;

export type BookingDevice = (typeof BOOKING_DEVICES)[number];

export const BOOKING_DEVICE_KEY = "openbell-booking-device";
export const NOTIFY_EMAIL_KEY = "openbell-notify-email";
export const AUTO_PAY_KEY = "openbell-auto-pay";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function bookingDeviceName(value: unknown): BookingDevice | "" {
  const name = String(value || "").trim();
  return (BOOKING_DEVICES as readonly string[]).includes(name) ? (name as BookingDevice) : "";
}

/** 켜짐만 참이다. 빈 값과 그 밖의 값은 꺼짐이다. */
export function autoPayEnabled(value: unknown): boolean {
  if (value === true) return true;
  const text = String(value ?? "").trim().toLowerCase();
  return text === "1" || text === "on" || text === "true";
}

export function notifyMailbox(value: unknown): string {
  const email = String(value || "").trim().toLowerCase();
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) return "";
  return email;
}

/** 스크립트가 알려 준 메일과 등록 메일이 같은 주소만 고른다. */
export function gasUrlForNotifyEmail(found: { url: string; email: string }[], wanted: string): string {
  const target = notifyMailbox(wanted);
  if (!target) return "";
  const hit = found.find((row) => notifyMailbox(row.email) === target && /^https:\/\//i.test(String(row.url || "")));
  return hit ? String(hit.url).trim() : "";
}

export function mergeAgentSeen(raw: string, name: string, nowIso: string): string {
  const device = bookingDeviceName(name);
  let parsed: Record<string, unknown> = {};
  try {
    const value = JSON.parse(raw) as unknown;
    if (value && typeof value === "object" && !Array.isArray(value)) parsed = value as Record<string, unknown>;
  } catch {
    parsed = {};
  }
  const next: Record<string, string> = {};
  for (const item of BOOKING_DEVICES) {
    const prev = String(parsed[item] || "");
    next[item] = item === device ? nowIso : prev;
  }
  return JSON.stringify(next);
}

export function readAgentSeen(raw: string): { name: BookingDevice; seenAt: string }[] {
  let parsed: Record<string, unknown> = {};
  try {
    const value = JSON.parse(raw) as unknown;
    if (value && typeof value === "object" && !Array.isArray(value)) parsed = value as Record<string, unknown>;
  } catch {
    parsed = {};
  }
  return BOOKING_DEVICES.map((name) => ({ name, seenAt: String(parsed[name] || "") }));
}
