const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function safeDbText(value: unknown) {
  return String(value || "")
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/[A-Za-z0-9_+/=-]{16,}/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

/** Classifies a database failure without returning connection strings or keys. */
export function registeredEmailFailure(err: unknown) {
  const error = err as { code?: string; name?: string; message?: string; status?: number; cause?: { code?: string; name?: string; message?: string } };
  const message = String(error?.message || err || "");
  const code = /^[0-9A-Z]{5}$/.test(String(error?.code || "")) ? String(error.code) : "";
  const name = String(error?.name || "").slice(0, 40);
  const status = Number(error?.status || 0);
  const httpStatus = status >= 100 && status <= 599 ? status : 0;
  const causeCode = /^[0-9A-Z]{5}$/.test(String(error?.cause?.code || "")) ? String(error.cause?.code) : "";
  const detail = {
    code,
    name,
    httpStatus,
    causeCode,
    causeName: String(error?.cause?.name || "").slice(0, 40),
    detail: safeDbText(error?.cause?.message || message),
  };
  if (code === "53000" || causeCode === "53000" || /quota/i.test(message) || httpStatus === 402) {
    return { reason: "dbQuota" as const, ...detail };
  }
  return { reason: "unavailable" as const, ...detail };
}

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
