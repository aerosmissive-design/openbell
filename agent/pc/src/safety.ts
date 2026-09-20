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

/** Only exact CGV movie-book URLs may leave the PC as browserAccessUrl. Payment pages → "". */
export function safeBrowserAccessUrl(url: string): string {
  return isExactCgvBookingUrl(url) ? url : "";
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

/** Login URL + password form, or a password login overlay on another CGV page. Header "로그인" alone is not enough. */
export function looksLikeLoginPage(url: string, visibleText: string) {
  const formHit = /비밀번호/.test(visibleText) && /아이디|이메일|휴대전화/.test(visibleText);
  if (!formHit) return false;
  const u = url.toLowerCase();
  const pathHit = /\/(?:user\/)?login(?:\/|$|\?)|\/member\/login|\/signin/i.test(u);
  if (pathHit) return true;
  return /로그인/.test(visibleText);
}

/** Header cues after a real CGV login. Do not treat a home-page "로그인" link as success. */
export function looksLoggedInCgv(url: string, visibleText: string) {
  if (looksLikeLoginPage(url, visibleText)) return false;
  const t = visibleText.replace(/\s+/g, " ");
  return /로그아웃/.test(t) || /MY\s*CGV/i.test(t) || /마이\s*CGV/.test(t);
}

/**
 * Age-gate / cookie / 닫기 dialogs. Never if the label mentions 결제.
 */
export function isSafeDialogLabel(text: string) {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t || isForbiddenClickLabel(t) || /결제/.test(t)) return false;
  if (/^(닫기|확인|동의|동의합니다|다시\s*보지\s*않기)$/i.test(t)) return true;
  if (/관람등급/.test(t) && /확인|동의/.test(t)) return true;
  if (/만\s*\d+\s*세/.test(t) && /확인|동의/.test(t)) return true;
  return false;
}

export const OFFICIAL_OPENBELL_HOST = "openbell-fawn.vercel.app";

export function isOfficialOpenBellUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.toLowerCase() === OFFICIAL_OPENBELL_HOST;
  } catch {
    return false;
  }
}

export function isBookingDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

export function isBookingShowtime(value: string) {
  return /^\d{1,2}:\d{2}$/.test(value.trim());
}

/** Calendar labels to try for BOOKING_DATE=YYYY-MM-DD. DOM not E2E-verified. */
export function dateClickLabels(iso: string): string[] {
  const m = iso.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return [iso.trim()];
  const [, y, mo, d] = m;
  const mon = String(Number(mo));
  const day = String(Number(d));
  return Array.from(
    new Set([
      iso.trim(),
      `${y}${mo}${d}`,
      `${y}.${mo}.${d}`,
      `${mo}/${d}`,
      `${mon}/${day}`,
      `${mon}월 ${day}일`,
      `${mon}월${day}일`,
    ]),
  );
}

/** Showtime labels to try for BOOKING_SHOWTIME=HH:MM. */
export function showtimeClickLabels(hhmm: string): string[] {
  const m = hhmm.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return [hhmm.trim()];
  const hour = String(Number(m[1]));
  const min = m[2];
  const padded = `${hour.padStart(2, "0")}:${min}`;
  return Array.from(
    new Set([hhmm.trim(), padded, `${hour}:${min}`, `${hour}시 ${min}분`, `${hour}시${min}분`]),
  );
}
