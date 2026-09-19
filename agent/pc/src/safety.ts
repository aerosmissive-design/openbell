/**
 * Pure safety helpers (no Playwright). Unit-tested.
 * Final payment is never automated. CAPTCHA is never bypassed.
 */

export const FORBIDDEN_CLICK_WORDS =
  /결제하기|최종결제|결제\s*완료|바로결제|구매하기|purchase|buy\s*now|place\s*order|complete\s*order|pay\s*now|checkout/i;

export const SAFE_NEXT_WORDS = /다음|선택완료|좌석선택완료|인원선택완료|예매정보입력|확인(?!\s*결제)/i;

/** Require movNo, scnYmd, scnsNo, scnSseq. siteNo is optional. */
export function isExactCgvBookingUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const pathname = url.pathname.replace(/\/+$/, "");
    const required = ["movNo", "scnYmd", "scnsNo", "scnSseq"];
    return (
      url.protocol === "https:" &&
      (host === "cgv.co.kr" || host === "www.cgv.co.kr") &&
      pathname === "/cnm/movieBook/movie" &&
      required.every((key) => Boolean(url.searchParams.get(key)))
    );
  } catch {
    return false;
  }
}

/**
 * Payment STAGE (hard stop) — conservative.
 * A lone "결제하기" / English "order" is NOT enough: those appear as nav or as
 * a forbidden next-button on earlier steps. Do not treat "border" as payment.
 */
export function isPaymentStageSignal(url: string, visibleText: string) {
  const u = url.toLowerCase();
  if (
    u.includes("/payment") ||
    u.includes("/checkout") ||
    u.includes("ticketpay") ||
    /(?:^|\/)pay(?:ment)?(?:\/|$|\?)/.test(u)
  ) {
    return true;
  }
  return /최종결제금액|결제수단|신용카드\s*결제|결제\s*정보\s*입력|주문서/.test(visibleText);
}

/**
 * Visible challenge text only. Do NOT scan full HTML for "cloudflare"/"recaptcha"
 * script URLs — those false-positive on almost every CDN page.
 */
export function looksLikeCaptchaChallenge(visibleText: string) {
  return /보안문자|자동입력\s*방지|자동등록방지|\b캡차\b|\b캡챠\b|\bcaptcha\b|로봇이\s*아닙니다|i['’]?m not a robot|recaptcha challenge|h-?captcha|checking your browser before|just a moment\.\.\./i.test(
    visibleText,
  );
}

export function isForbiddenClickLabel(text: string) {
  return FORBIDDEN_CLICK_WORDS.test(text);
}

export function isCaptchaFrameUrl(url: string) {
  return /recaptcha|hcaptcha|h-captcha|\/captcha/i.test(url);
}
