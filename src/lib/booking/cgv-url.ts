/**
 * Booking-page URL helpers. Never a payment/checkout URL.
 * Exact showtime URLs get the CGV red border; movie/cinema pages are still usable.
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

export function isAllowedBookingPageUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const path = url.pathname.replace(/\/+$/, "");
    const blob = path + url.search;
    if (url.protocol !== "https:") return false;
    if (/payment|checkout|ticketpay/i.test(blob)) return false;
    if (host === "cgv.co.kr" || host === "www.cgv.co.kr") {
      return path.startsWith("/cnm/movieBook");
    }
    if (host === "megabox.co.kr" || host === "www.megabox.co.kr" || host === "m.megabox.co.kr") {
      return path.startsWith("/booking");
    }
    return false;
  } catch {
    return false;
  }
}

export function telegramSafeBrowserUrl(value: string | undefined) {
  const raw = String(value || "").trim();
  if (!raw) return undefined;
  if (isExactCgvMovieBookUrl(raw)) return raw;
  return isAllowedBookingPageUrl(raw) ? raw : undefined;
}
