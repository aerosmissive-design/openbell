/**
 * 예매 도우미 본문 (Playwright)
 *
 * 좌석: 황금점(맵 중앙)에 가까운 연속 N석 우선
 * 실패 시 다음 후보로 재시도 (결제 확정 클릭 없음)
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
const SEAT_SELECTORS = [
  "[data-seat]:not([disabled])",
  "[data-seatno]:not([disabled])",
  "button.seat:not(.disabled):not(.sold):not(.unavailable)",
  "a.seat:not(.disabled)",
  ".seat_available",
  ".seat-available",
  "td.seat:not(.disabled) button",
  "[class*='seat'][class*='avail']",
  "button[class*='Seat']:not([disabled])",
];

function chainOf(theaterId = "") {
  if (String(theaterId).startsWith("megabox")) return "megabox";
  return "cgv";
}

function statePath(chain) {
  return path.join(STATE_DIR, `storage-${chain}.json`);
}

function rowIndex(letter) {
  const c = String(letter || "").toUpperCase();
  if (c.length !== 1 || c < "A" || c > "Z") return null;
  return c.charCodeAt(0) - 65;
}

/** "G12", "g-12", "12열G" 등에서 행·열 추출 */
function parseSeatLabel(raw) {
  const s = String(raw || "")
    .toUpperCase()
    .replace(/\s+/g, "");
  if (!s || PAY_BLOCK_RE.test(s)) return null;
  let m = s.match(/^([A-Z])[-_]?(\d{1,2})$/);
  if (m) return { row: m[1], col: Number(m[2]), label: `${m[1]}${m[2]}` };
  m = s.match(/^(\d{1,2})[-_]?([A-Z])$/);
  if (m) return { row: m[2], col: Number(m[1]), label: `${m[2]}${m[1]}` };
  m = s.match(/([A-Z]).*?(\d{1,2})/);
  if (m) return { row: m[1], col: Number(m[2]), label: `${m[1]}${m[2]}` };
  return null;
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

async function readSeatLabel(el) {
  const parts = await Promise.all([
    el.getAttribute("data-seat").catch(() => null),
    el.getAttribute("data-seatno").catch(() => null),
    el.getAttribute("data-seeno").catch(() => null),
    el.getAttribute("title").catch(() => null),
    el.getAttribute("aria-label").catch(() => null),
    el.innerText().catch(() => ""),
  ]);
  return parts.filter(Boolean).join(" ");
}

/**
 * 페이지에서 예매 가능 좌석 수집 → 황금점 기준 연속 N석 후보 목록
 * 황금점 = (가용 좌석의 행 중앙, 열 중앙)
 */
async function collectGoldenCandidates(page, want) {
  const seats = [];
  const seen = new Set();

  for (const sel of SEAT_SELECTORS) {
    const loc = page.locator(sel);
    const n = await loc.count().catch(() => 0);
    for (let i = 0; i < n; i++) {
      const el = loc.nth(i);
      const raw = await readSeatLabel(el);
      const parsed = parseSeatLabel(raw);
      if (!parsed) continue;
      const key = parsed.label;
      if (seen.has(key)) continue;
      seen.add(key);
      seats.push({
        ...parsed,
        ri: rowIndex(parsed.row),
        selector: sel,
        index: i,
      });
    }
    if (seats.length >= 8) break;
  }

  // 셀렉터로 거의 못 모으면 느슨하게 한 번 더
  if (seats.length < want) {
    for (const sel of SEAT_SELECTORS) {
      const loc = page.locator(sel);
      const n = await loc.count().catch(() => 0);
      for (let i = 0; i < n; i++) {
        const el = loc.nth(i);
        const raw = await readSeatLabel(el);
        const key = `raw:${i}:${sel}:${String(raw).slice(0, 12)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        seats.push({
          row: "?",
          col: i,
          label: String(raw).slice(0, 16) || `S${i}`,
          ri: 12,
          selector: sel,
          index: i,
          loose: true,
        });
      }
      if (seats.length >= want * 3) break;
    }
  }

  const proper = seats.filter((s) => s.ri != null && !s.loose);
  const pool = proper.length >= want ? proper : seats;
  if (!pool.length) return [];

  const rows = pool.map((s) => s.ri).filter((x) => x != null);
  const cols = pool.map((s) => s.col).filter((x) => Number.isFinite(x));
  const goldenR =
    rows.length > 0
      ? rows.slice().sort((a, b) => a - b)[Math.floor(rows.length / 2)]
      : 12;
  const goldenC =
    cols.length > 0
      ? cols.slice().sort((a, b) => a - b)[Math.floor(cols.length / 2)]
      : 10;

  console.log(
    `[book] 황금점 행=${String.fromCharCode(65 + goldenR)} 열=${goldenC} 가용=${pool.length} N=${want}`,
  );

  // 같은 행에서 연속 N석 블록 만들기
  const byRow = new Map();
  for (const s of pool) {
    const k = s.ri != null ? s.ri : 99;
    if (!byRow.has(k)) byRow.set(k, []);
    byRow.get(k).push(s);
  }
  for (const list of byRow.values()) {
    list.sort((a, b) => a.col - b.col);
  }

  const blocks = [];
  for (const [ri, list] of byRow) {
    if (list[0]?.loose) {
      // 느슨 모드: 앞에서부터 N개
      for (let i = 0; i + want <= list.length; i++) {
        const chunk = list.slice(i, i + want);
        blocks.push({
          seats: chunk,
          score: Math.abs(ri - goldenR) * 100 + i,
        });
      }
      continue;
    }
    // 연속 번호만
    for (let i = 0; i < list.length; i++) {
      const chunk = [list[i]];
      for (let j = i + 1; j < list.length && chunk.length < want; j++) {
        const prev = chunk[chunk.length - 1];
        if (list[j].col === prev.col + 1) chunk.push(list[j]);
        else break;
      }
      if (chunk.length < want) continue;
      const mid =
        (chunk[0].col + chunk[chunk.length - 1].col) / 2;
      const score =
        Math.abs(ri - goldenR) * 1000 +
        Math.abs(mid - goldenC) * 10 +
        chunk[0].col * 0.01;
      blocks.push({ seats: chunk.slice(0, want), score });
    }
  }

  blocks.sort((a, b) => a.score - b.score);

  // 연속 블록이 없으면 황금점에서 거리순 개별 N석
  if (!blocks.length) {
    const ranked = pool
      .map((s) => ({
        s,
        d:
          Math.abs((s.ri ?? 12) - goldenR) * 100 +
          Math.abs((s.col ?? 0) - goldenC),
      }))
      .sort((a, b) => a.d - b.d);
    for (let i = 0; i + want <= ranked.length; i++) {
      blocks.push({
        seats: ranked.slice(i, i + want).map((x) => x.s),
        score: ranked[i].d + i * 0.01,
      });
    }
  }

  // 중복 블록 제거
  const uniq = [];
  const sigs = new Set();
  for (const b of blocks) {
    const sig = b.seats.map((x) => x.label).join(",");
    if (sigs.has(sig)) continue;
    sigs.add(sig);
    uniq.push(b);
  }
  return uniq.slice(0, 12);
}

async function clickSeatBlock(page, block) {
  const clicked = [];
  for (const s of block.seats) {
    const loc = page.locator(s.selector);
    const el = loc.nth(s.index);
    try {
      await el.click({ timeout: 2500, force: false });
      clicked.push(s.label);
      await page.waitForTimeout(350);
    } catch {
      // 인덱스가 밀렸을 수 있음 — 라벨로 재탐색
      let ok = false;
      for (const sel of SEAT_SELECTORS) {
        const all = page.locator(sel);
        const n = await all.count().catch(() => 0);
        for (let i = 0; i < n; i++) {
          const cand = all.nth(i);
          const raw = await readSeatLabel(cand);
          const p = parseSeatLabel(raw);
          if (p && p.label === s.label) {
            try {
              await cand.click({ timeout: 2000 });
              clicked.push(s.label);
              ok = true;
              await page.waitForTimeout(350);
              break;
            } catch {
              /* next */
            }
          }
        }
        if (ok) break;
      }
      if (!ok) return { ok: false, clicked };
    }
  }
  return { ok: clicked.length === block.seats.length, clicked };
}

async function clearSelection(page) {
  // 선택 해제 시도 (실패해도 무시)
  const labels = ["좌석선택 초기화", "초기화", "다시선택", "선택해제", "취소"];
  for (const name of labels) {
    const btn = page.getByRole("button", { name: new RegExp(name, "i") });
    if (await btn.count().catch(() => 0)) {
      try {
        await btn.first().click({ timeout: 1500 });
        await page.waitForTimeout(500);
        return;
      } catch {
        /* next */
      }
    }
  }
  // 선택된 좌석 다시 클릭해 토글 해제 시도
  for (const sel of [
    ".seat.selected",
    ".seat_selected",
    "[class*='seat'][class*='select']",
  ]) {
    const loc = page.locator(sel);
    const n = await loc.count().catch(() => 0);
    for (let i = 0; i < n; i++) {
      try {
        await loc.nth(i).click({ timeout: 800 });
      } catch {
        /* ignore */
      }
    }
  }
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

/**
 * 황금열 후보를 순서대로 시도. 실패하면 선택 해제 후 다음 블록.
 */
async function selectSeatsWithRetry(page, job) {
  const want = Math.max(1, Math.min(8, Number(job.seats) || 2));
  const preferred = Array.isArray(job.preferredSeats)
    ? job.preferredSeats.map((s) => String(s).toUpperCase().replace(/\s+/g, ""))
    : [];

  let candidates = await collectGoldenCandidates(page, want);

  // preferredSeats 가 있으면 그 조합을 맨 앞에
  if (preferred.length >= want) {
    const wantSet = preferred.slice(0, want);
    candidates = [
      {
        seats: wantSet.map((label, i) => ({
          label,
          row: label.charAt(0),
          col: Number(label.slice(1)) || i,
          ri: rowIndex(label.charAt(0)),
          selector: SEAT_SELECTORS[0],
          index: 0,
          preferred: true,
        })),
        score: -1,
      },
      ...candidates,
    ];
  }

  if (!candidates.length) {
    return { ok: false, clicked: [], tries: 0 };
  }

  const maxTries = Math.min(candidates.length, 8);
  for (let t = 0; t < maxTries; t++) {
    const block = candidates[t];
    const names = block.seats.map((s) => s.label).join(",");
    console.log(`[book] 시도 ${t + 1}/${maxTries}: ${names}`);

    if (t > 0) await clearSelection(page);

    // preferred 전용 블록은 라벨로만 클릭
    if (block.seats[0]?.preferred) {
      const clicked = [];
      for (const label of preferred.slice(0, want)) {
        let hit = false;
        for (const sel of SEAT_SELECTORS) {
          const all = page.locator(sel);
          const n = await all.count().catch(() => 0);
          for (let i = 0; i < n; i++) {
            const el = all.nth(i);
            const p = parseSeatLabel(await readSeatLabel(el));
            if (p && p.label === label) {
              try {
                await el.click({ timeout: 2000 });
                clicked.push(label);
                hit = true;
                await page.waitForTimeout(350);
                break;
              } catch {
                /* next */
              }
            }
          }
          if (hit) break;
        }
        if (!hit) break;
      }
      if (clicked.length === want) {
        const progressed = await tryProceedTowardPayment(page);
        const sig = await pageSignals(page);
        if (progressed || sig.hasPayWall || clicked.length === want) {
          return { ok: true, clicked, tries: t + 1, payish: sig.hasPayWall };
        }
      }
      continue;
    }

    const { ok, clicked } = await clickSeatBlock(page, block);
    if (!ok) {
      console.log("[book] 클릭 실패, 다음 후보");
      continue;
    }

    const progressed = await tryProceedTowardPayment(page);
    await page.waitForTimeout(800);
    const sig = await pageSignals(page);

    // 매진/오류 문구
    const failText = /좌석.*선택.*실패|이미\s*선택된|매진|선점.*실패|다시\s*선택/i.test(
      sig.text,
    );
    if (failText) {
      console.log("[book] 선점 실패 문구 → 재시도");
      continue;
    }

    if (sig.hasPayWall || progressed || /결제/i.test(sig.url)) {
      return { ok: true, clicked, tries: t + 1, payish: true };
    }

    // 좌석은 잡혔는데 다음 단계 불명확 → 일단 성공으로 보고
    if (clicked.length >= want) {
      return { ok: true, clicked, tries: t + 1, payish: false };
    }
  }

  return { ok: false, clicked: [], tries: maxTries };
}

export async function runBookingJob(job, opts = {}) {
  const headless = opts.headless !== false;
  const timeoutMs = Math.min(
    Math.max(Number(opts.timeoutMs) || 90_000, 20_000),
    180_000,
  );
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
        message: "로그인 필요 — login-setup 으로 쿠키 저장 후 재시도",
        url: page.url(),
      };
    }

    const result = await selectSeatsWithRetry(page, job);
    console.log(
      "[book] seats:",
      result.clicked.join(", ") || "(없음)",
      "tries=",
      result.tries,
    );

    sig = await pageSignals(page);
    if (!sig.hasLogin && !sig.hasCaptcha) {
      await saveState(context, chain);
    }

    if (sig.hasCaptcha) {
      return {
        status: "need_user",
        message: `좌석 시도 후 캡차 — 직접 결제 (${result.clicked.join(",")})`,
        url: page.url(),
      };
    }

    if (result.ok && (result.payish || sig.hasPayWall || /결제/i.test(sig.url))) {
      return {
        status: "done",
        message: `결제 직전(자동결제 없음). 좌석=${result.clicked.join(",")} 시도=${result.tries}회`,
        url: page.url(),
      };
    }

    if (result.ok) {
      return {
        status: "need_user",
        message: `좌석=${result.clicked.join(",")} 선택됨. 결제 화면 확인 필요`,
        url: page.url(),
      };
    }

    return {
      status: "need_user",
      message: `황금열 후보 ${result.tries}회 모두 실패 — 직접 선택`,
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
