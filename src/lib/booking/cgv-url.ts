/**
 * Exact CGV showtime URL only. Never a payment/checkout URL.
 * Telegram "open browser" must not send the user to a live payment session
 * on a different device.
 */
export function isExactCgvMovieBookUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const pathname = url.pathname.replace(/\/+$/, "");
    const required = ["movNo", "scnYmd", "scnsNo", "scnSseq"];
    if (url.protocol !== "https:") return false;
    if (host !== "cgv.co.kr" && host !== "www.cgv.co.kr") return false;
    if (pathname !== "/cnm/movieBook/movie") return false;
    if (/payment|checkout|ticketpay/i.test(url.pathname + url.search)) return false;
    return required.every((key) => Boolean(url.searchParams.get(key)));
  } catch {
    return false;
  }
}

export function telegramSafeBrowserUrl(value: string | undefined) {
  const raw = String(value || "").trim();
  if (!raw) return undefined;
  return isExactCgvMovieBookUrl(raw) ? raw : undefined;
}
