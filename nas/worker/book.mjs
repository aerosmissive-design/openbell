/**
 * 예매 도우미 본문 (Playwright)
 *
 * 목표: 예매 URL → (가능하면) 좌석 선택 → 결제 페이지 직전에서 멈춤
 * 금지: 결제 확정 버튼 클릭, 캡차 우회
 */

import { chromium } from "playwright";

const PAY_BLOCK_RE =
  /결제하기|결제완료|결제\s*하기|pay\s*now|confirm\s*payment|카드결제|간편결제\s*완료/i;
const CAPTCHA_RE =
  /captcha|캡차|자동입력\s*방지|recaptcha|로봇이\s*아닙니다|보안문자/i;
const LOGIN_RE = /로그인|sign\s*in|log\s*in|cj\s*one|아이디.*비밀번호/i;
const SEAT_HINT_RE = /좌석|seat|선점|선택\s*완료|인원/i;

function chainOf(theaterId = "") {
  if (String(theaterId).startsWith("megabox")) return "megabox";
  return "cgv";
}

function zoneRowHint(zone) {
  // 대략적 행 선호 (사이트마다 알파벳 다름 — 실패해도 다음 빈 자리)
  if (zone === "front") return /^[A-D]$/i;
  if (zone === "rear") return /^[K-Z]$/i;
  return /^[E-J]$/i;
}

async function pageSignals(page) {
  const url = page.url();
  let text = "";
  try {
    text = await page.locator("body").innerText({ timeout: 3000 });
  } catch {
    text = "";
  }
  const blob = `${url}\n${text}`;
  return {
    url,
    text: text.slice(0, 2000),
    hasCaptcha: CAPTCHA_RE.test(blob),
    hasLogin: LOGIN_RE.test(blob) && /password|비밀번호|login/i.test(blob),
    hasPayWall: /payment|checkout|\/pay|결제정보|결제수단/i.test(blob),
    hasSeatUi: SEAT_HINT_RE.test(blob),
  };
}

/** 결제 확정으로 보이는 클릭은 전부 차단 */
async function blockPayClicks(page) {
  await page.addInitScript(() => {
    const bad =
      /결제하기|결제완료|pay\s*now|confirm\s*payment|결제\s*요청/i;
    const guard = (ev) => {
      const t = ev.target;
      if (!t || !t.closest) return;
      const el = t.closest("button, a, input, [role=button]");
      if (!el) return;
      const label = `${el.innerText || ""} ${el.value || ""} ${el.getAttribute("aria-label") || ""}`;
      if (bad.test(label)) {
        ev.preventDefault();
        ev.stopPropagation();
        console.warn("[openbell] blocked pay click", label.slice(0, 40));
      }
    };
    document.addEventListener("click", guard, true);
  });
}

async function tryClickPreferredSeats(page, job) {
  const want = Math.max(1, Number(job.seats) || 2);
  const preferred = Array.isArray(job.preferredSeats)
    ? job.preferredSeats.map((s) => String(s).toUpperCase())
    : [];
  const zoneRe = zoneRowHint(job.zone);

  // 흔한 좌석 버튼 후보 (사이트 개편 시 여기만 손보면 됨)
  const seatSelectors = [
    "[data-seat]:not([disabled])",
    "[data-seatno]:not([disabled])",
    "button.seat:not(.disabled):not(.sold)",
    "a.seat:not(.disabled)",
    ".seat_available",
    ".seat-available",
    "td.seat:not(.disabled) button",
    "[class*='seat'][class*='avail']",
    "button[class*='Seat']:not([disabled])",
  ];

  const clicked = [];
  for (const sel of seatSelectors) {
    const loc = page.locator(sel);
    const n = await loc.count().catch(() => 0);
    if (!n) continue;
    for (let i = 0; i < n && clicked.length < want; i++) {
      const el = loc.nth(i);
      const label = (
        (await el.getAttribute("data-seat").catch(() => null)) ||
        (await el.getAttribute("data-seatno").catch(() => null)) ||
        (await el.getAttribute("title").catch(() => null)) ||
        (await el.innerText().catch(() => "")) ||
        ""
      )
        .trim()
        .toUpperCase()
        .replace(/\s+/g, "");
      if (PAY_BLOCK_RE.test(label)) continue;
      if (preferred.length && !preferred.some((p) => label.includes(p))) {
        // 선호 목록이 있으면 그것만
        continue;
      }
      if (!preferred.length && label && zoneRe) {
        const row = label.charAt(0);
        if (/[A-Z]/.test(row) && !zoneRe.test(row)) continue;
      }
      try {
        await el.click({ timeout: 2000, force: false });
        clicked.push(label || sel);
        await page.waitForTimeout(400);
      } catch {
        /* next */
      }
    }
    if (clicked.length >= want) break;
  }

  // 선호 못 맞추면 아무 빈 자리나
  if (clicked.length < want) {
    for (const sel of seatSelectors) {
      const loc = page.locator(sel);
      const n = await loc.count().catch(() => 0);
      for (let i = 0; i < n && clicked.length < want; i++) {
        try {
          const el = loc.nth(i);
          const label = ((await el.innerText().catch(() => "")) || "").slice(0, 20);
          if (PAY_BLOCK_RE.test(label)) continue;
          await el.click({ timeout: 1500 });
          clicked.push(label || "seat");
          await page.waitForTimeout(400);
        } catch {
          /* next */
        }
      }
      if (clicked.length >= want) break;
    }
  }
  return clicked;
}

async function tryProceedTowardPayment(page) {
  // 좌석 선택 후 "다음" / "결제하기 전 단계" 정도만 — 결제 확정 문구는 제외
  const nextLabels = [
    "다음",
    "선택완료",
    "선택 완료",
    "확인",
    "예매",
    "계속",
    "Next",
  ];
  for (const label of nextLabels) {
    if (PAY_BLOCK_RE.test(label)) continue;
    const btn = page.getByRole("button", { name: new RegExp(label, "i") });
    if (await btn.count().catch(() => 0)) {
      const text = await btn.first().innerText().catch(() => "");
      if (PAY_BLOCK_RE.test(text)) continue;
      try {
        await btn.first().click({ timeout: 2000 });
        await page.waitForTimeout(1200);
        return true;
      } catch {
        /* try next */
      }
    }
  }
  return false;
}

/**
 * @returns {{ status: 'done'|'need_user'|'failed', message: string, url?: string }}
 */
export async function runBookingJob(job, opts = {}) {
  const headless = opts.headless !== false;
  const timeoutMs = Math.min(Math.max(Number(opts.timeoutMs) || 90_000, 20_000), 180_000);
  const chain = chainOf(job.theaterId);

  if (!job.bookingUrl) {
    return { status: "failed", message: "bookingUrl 없음" };
  }

  const browser = await chromium.launch({
    headless,
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const context = await browser.newContext({
    locale: "ko-KR",
    viewport: { width: 1280, height: 900 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();
  await blockPayClicks(page);

  try {
    await page.goto(job.bookingUrl, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });
    await page.waitForTimeout(1500);

    let sig = await pageSignals(page);
    if (sig.hasCaptcha) {
      return {
        status: "need_user",
        message: "캡차/보안문자 감지 — 직접 진행 필요",
        url: page.url(),
      };
    }
    if (sig.hasLogin) {
      return {
        status: "need_user",
        message: "로그인 필요 — 브라우저에서 로그인 후 다시 시도하거나 쿠키 연동 필요",
        url: page.url(),
      };
    }

    const clicked = await tryClickPreferredSeats(page, job);
    console.log("[book] seats clicked:", clicked.join(", ") || "(없음)");

    if (clicked.length) {
      await tryProceedTowardPayment(page);
    }

    sig = await pageSignals(page);
    if (sig.hasCaptcha) {
      return {
        status: "need_user",
        message: `좌석 ${clicked.length} 시도 후 캡차 — 직접 결제`,
        url: page.url(),
      };
    }

    if (sig.hasPayWall || /결제/i.test(sig.url)) {
      // 결제 페이지까지 왔으면 성공으로 보고하고 멈춤 (클릭 안 함)
      return {
        status: "done",
        message: `결제 직전 도달(자동 결제 없음). 좌석시도=${clicked.join(",") || "없음"} chain=${chain}`,
        url: page.url(),
      };
    }

    if (clicked.length > 0) {
      return {
        status: "need_user",
        message: `좌석 ${clicked.length}개 클릭 추정, 결제 화면 미확인 — 직접 확인. url=${page.url()}`,
        url: page.url(),
      };
    }

    return {
      status: "need_user",
      message: `좌석 UI를 못 찾음(${chain}). 로그인·회차 선택 후 URL을 다시 넣어 보세요. url=${page.url()}`,
      url: page.url(),
    };
  } catch (err) {
    return {
      status: "failed",
      message: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await browser.close().catch(() => null);
  }
}
