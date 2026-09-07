export function kakaoRedirectUri(): string {
  if (typeof window === "undefined") return "";
  return `${window.location.origin}/kakao`;
}

export function bookingJumpUrl(bookingUrl: string): string {
  if (typeof window === "undefined" || !bookingUrl) return bookingUrl;
  return `${window.location.origin}/go?u=${encodeURIComponent(bookingUrl)}`;
}

export function extractKakaoCode(raw: string): string {
  const trimmed = raw.trim();
  const matched =
    trimmed.match(/[?&]code=([^&\s#]+)/) || trimmed.match(/(?:^|\s)code=([^&\s#]+)/);
  if (matched?.[1]) {
    try {
      return decodeURIComponent(matched[1]);
    } catch {
      return matched[1];
    }
  }
  if (/^https?:\/\//i.test(trimmed) || trimmed.includes("/")) return "";
  return trimmed;
}
