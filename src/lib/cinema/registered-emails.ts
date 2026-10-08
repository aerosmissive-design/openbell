const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeAccountEmail(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function isAccountEmail(value: string): boolean {
  return value.length <= 254 && EMAIL_RE.test(value);
}

/** Keeps real mailboxes only. Short names, blanks, and duplicates are dropped. */
export function collectRegisteredEmails(...groups: Array<Iterable<unknown>>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const group of groups) {
    for (const item of group) {
      const email = normalizeAccountEmail(item);
      if (!isAccountEmail(email) || seen.has(email)) continue;
      seen.add(email);
      out.push(email);
    }
  }
  out.sort();
  return out;
}
