/**
 * 예매 도우미 본문 (Playwright)
 * - 결제 확정 클릭 금지
 * - 캡차 우회 금지
 * - 체인별 storageState 로 로그인 쿠키 유지
 */

import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const PAY_BLOCK_RE =
  /결제하기|결제완료|결제\s*하기|pay\s*now|confirm\s*payment|카드결제|간편결제\s*완료/i;
const CAPTCHA_RE =
  /captcha|캡차|자동입력\s*방지|recaptcha|로봇이\s*아닙니다|보안문자/i;
const LOGIN_RE = /로그인|sign\s*in|log\s*in|cj\s*one|아이디.*비밀번호/i;
const SEAT_HINT_RE = /좌석|seat|선점|선택\s*완료|인원/i;

const STATE_DIR = process.env.PLAYWRIGHT_STATE_DIR || "/data";

function chainOf(theaterId = "") {
  if (String(theaterId).startsWith("megabox")) return "megabox";
  return "cgv";
}

function statePath(chain) {
  return path.join(STATE_DIR, `storage-${chain}.json`);
}

function zoneRowHint(zone) {
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
      if (preferred.length && !preferred.some((p) => label.includes(p))) continue;
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
  const nextLabels = ["다음", "선택완료", "선택 완료", "확인", "예매", "계속", "Next"];
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

async function saveState(context, chain) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    await context.storageState({ path: statePath(chain) });
    console.log("[book] storage saved", statePath(chain));
  } catch (err) {
    console.warn("[book] storage save failed", err?.message || err);
  }
}

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

  const storage = statePath(chain);
  const contextOpts = {
    locale: "ko-KR",
    viewport: { width: 1280, height: 900 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  };
  if (fs.existsSync(storage)) {
    contextOpts.storageState = storage;
    console.log("[book] using storage", storage);
  }

  const context = await browser.newContext(contextOpts);
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
        message:
          "로그인 필요 — nas/worker 에서 login-setup 한 번 실행해 쿠키를 저장하세요",
        url: page.url(),
      };
    }

    const clicked = await tryClickPreferredSeats(page, job);
    console.log("[book] seats clicked:", clicked.join(", ") || "(없음)");

    if (clicked.length) {
      await tryProceedTowardPayment(page);
    }

    sig = await pageSignals(page);
    if (!sig.hasLogin && !sig.hasCaptcha) {
      await saveState(context, chain);
    }

    if (sig.hasCaptcha) {
      return {
        status: "need_user",
        message: `좌석 ${clicked.length} 시도 후 캡차 — 직접 결제`,
        url: page.url(),
      };
    }

    if (sig.hasPayWall || /결제/i.test(sig.url)) {
      return {
        status: "done",
        message: `결제 직전 도달(자동 결제 없음). 좌석시도=${clicked.join(",") || "없음"} chain=${chain}`,
        url: page.url(),
      };
    }

    if (clicked.length > 0) {
      return {
        status: "need_user",
        message: `좌석 ${clicked.length}개 클릭 추정, 결제 화면 미확인 — 직접 확인`,
        url: page.url(),
      };
    }

    return {
      status: "need_user",
      message: `좌석 UI를 못 찾음(${chain}). 로그인 쿠키 또는 예매 URL 확인`,
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
