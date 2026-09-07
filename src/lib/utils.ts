import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function decodeHtml(value: string): string {
  return value
    .replace(/&#40;/g, "(")
    .replace(/&#41;/g, ")")
    .replace(/&#39;/g, "'")
    .replace(/"/g, '"')
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) =>
      String.fromCharCode(parseInt(n, 16)),
    );
}

export function normalizeTitle(value: string): string {
  return decodeHtml(value)
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .toLowerCase();
}

export function kstToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function kstDateKeys(days: number): string[] {
  const today = kstToday();
  const [y, m, d] = today.split("-").map(Number);
  const keys: string[] = [];
  for (let i = 0; i < days; i += 1) {
    const dt = new Date(Date.UTC(y, m - 1, d + i));
    const yy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(dt.getUTCDate()).padStart(2, "0");
    keys.push(`${yy}${mm}${dd}`);
  }
  return keys;
}

export function formatPlayDate(yyyymmdd: string): string {
  if (yyyymmdd.length !== 8) return yyyymmdd;
  const month = Number(yyyymmdd.slice(4, 6));
  const day = Number(yyyymmdd.slice(6, 8));
  const today = kstDateKeys(1)[0];
  const tomorrow = kstDateKeys(2)[1];
  if (yyyymmdd === today) return `오늘 ${month}/${day}`;
  if (yyyymmdd === tomorrow) return `내일 ${month}/${day}`;
  const utc = Date.UTC(
    Number(yyyymmdd.slice(0, 4)),
    month - 1,
    day,
  );
  const weekday = new Intl.DateTimeFormat("ko-KR", {
    weekday: "short",
    timeZone: "UTC",
  }).format(new Date(utc));
  return `${month}/${day} ${weekday}`;
}

export function formatClock(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}
