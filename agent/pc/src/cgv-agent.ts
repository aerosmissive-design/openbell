import { chromium, type Browser, type BrowserContext, type Page, type Frame, type Locator } from "playwright";
import { rankSeatBlocks, type SeatPoint, type SeatPreference } from "./seat-ranker.js";

export type BookingTarget = {
  movieTitle: string;
  playDate: string;
  showtime: string;
  requestedSeatCount: number;
  bookingUrl?: string;
  seatIds?: string[];
  seatPreference?: Omit<SeatPreference, "count">;
};

export type BookingAgentOptions = {
  baseUrl?: string;
  storageStatePath?: string;
  headless?: boolean;
  timeoutMs?: number;
  onPaymentReady?: (info: { url: string; seats: string[] }) => Promise<void>;
};

export type BookingState =
  | "IDLE"
  | "WATCHING"
  | "SEAT_FOUND"
  | "BOOKING"
  | "MOVIE_SELECTED"
  | "SHOWTIME_SELECTED"
  | "SEAT_SELECTED"
  | "BOOKING_INFO"
  | "PAYMENT_READY"
  | "WAITING_USER"
  | "COMPLETED"
  | "CANCELLED"
  | "EXPIRED"
  | "FAILED"
  | "CAPTCHA_STOP";

/** Page or same-origin frame that may host the seat map. */
type SeatRoot = Page | Frame;

const CGV_BOOKING_URL = "https://cgv.co.kr/cnm/movieBook/movie";

/** Detect payment / order stage (hard stop). */
const PAYMENT_STAGE_WORDS = /결제수단|최종결제금액|결제\s*정보|결제하기|최종결제|주문서|payment|purchase|order/i;

/** Labels that must NEVER be clicked. */
const FORBIDDEN_CLICK_WORDS =
  /결제하기|최종결제|결제\s*완료|바로결제|구매하기|purchase|buy\s*now|place\s*order|complete\s*order|pay\s*now|checkout/i;

/** Safe advance buttons only (non-payment). */
const SAFE_NEXT_WORDS = /다음|선택완료|좌석선택완료|인원선택완료|예매정보입력|확인(?!\s*결제)/i;

const CAPTCHA_WORDS = /captcha|캡차|자동입력|보안문자|로봇이\s*아닙니다|recaptcha|hcaptcha|cloudflare/i;

/**
 * Seat-map locator fallbacks (DOM not E2E-verified on real CGV Windows).
 * Prefer data-* / role / seatmap containers; never used for payment controls.
 */
const SEAT_MAP_SELECTOR = [
  "[data-seat-id]",
  "[data-seat]",
  "[data-seat-no]",
  "[data-seatno]",
  "[data-seat-code]",
  "[data-seatcode]",
  "[data-row][data-col]",
  "[data-row][data-number]",
  ".seatmap [data-seat-id]",
  ".seat-map [data-seat-id]",
  "#seatmap [data-seat-id]",
  "[class*='seatmap'] button",
  "[class*='seat-map'] button",
  "[class*='SeatMap'] button",
  "[role='checkbox'][aria-label*='좌석']",
  "[role='checkbox'][aria-label*='seat']",
  "[role='button'][aria-label*='좌석']",
  "[role='button'][aria-label*='seat']",
  "button[aria-label*='좌석']",
  "button[aria-label*='seat']",
  "[aria-label*='좌석']",
  "[aria-label*='seat']",
].join(", ");

export class CgvBookingAgent {
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private stopped = false;
  private selectedSeats: string[] = [];
  private readonly options: Required<Pick<BookingAgentOptions, "headless" | "timeoutMs">> & BookingAgentOptions;

  constructor(options: BookingAgentOptions = {}) {
    this.options = { headless: false, timeoutMs: 15_000, ...options };
  }

  async launch() {
    this.browser = await chromium.launch({ headless: this.options.headless });
    this.context = await this.browser.newContext(
      this.options.storageStatePath ? { storageState: this.options.storageStatePath } : undefined,
    );
    this.context.setDefaultTimeout(this.options.timeoutMs);
    this.page = await this.context.newPage();
    await this.page.goto(this.options.baseUrl ?? CGV_BOOKING_URL, { waitUntil: "domcontentloaded" });
  }

  private getPage() {
    if (!this.page) throw new Error("BOOKING_BROWSER_NOT_STARTED");
    if (this.stopped) throw new Error("AUTOMATION_HARD_STOP");
    return this.page;
  }

  /**
   * Prefer the same-origin frame (or main page) whose seat-map locator has count > 0.
   * Falls back to the main page when no frame yet has seats.
   */
  private async seatRoots(): Promise<SeatRoot> {
    const page = this.getPage();
    let best: SeatRoot = page;
    let bestCount = 0;
    for (const frame of page.frames()) {
      try {
        const count = await frame.locator(SEAT_MAP_SELECTOR).count();
        if (count > bestCount) {
          bestCount = count;
          best = frame;
        }
      } catch {
        // Cross-origin / detached frames are skipped.
      }
    }
    return best;
  }

  /** Main page + same-origin frames that can be evaluated (for next/captcha/payment checks). */
  private async interactiveRoots(): Promise<SeatRoot[]> {
    const page = this.getPage();
    const roots: SeatRoot[] = [page];
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      try {
        // Touch document to detect same-origin; skip cross-origin.
        await frame.evaluate(() => document.readyState);
        roots.push(frame);
      } catch {
        // cross-origin / detached
      }
    }
    return roots;
  }


  private async waitForSeatMap(): Promise<SeatRoot> {
    const page = this.getPage();
    const deadline = Date.now() + this.options.timeoutMs;
    while (Date.now() < deadline) {
      const root = await this.seatRoots();
      try {
        const count = await root.locator(SEAT_MAP_SELECTOR).count();
        if (count > 0) {
          await root.locator(SEAT_MAP_SELECTOR).first().waitFor({
            state: "attached",
            timeout: Math.min(2_000, Math.max(200, deadline - Date.now())),
          });
          return root;
        }
      } catch {
        // keep polling
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    await this.logSeatMapDiagnostics(page);
    throw new Error("CGV_SEAT_MAP_NOT_FOUND");
  }

  /** Safe diagnostics only — no cookies, tokens, or storageState. */
  private async logSeatMapDiagnostics(page: Page) {
    const frames = page.frames();
    console.warn(
      `[seat-map diagnostics] url=${page.url()} frames=${frames.length} (incl. main)`,
    );
    for (const frame of frames) {
      let frameUrl = "(unavailable)";
      try {
        frameUrl = frame.url().slice(0, 160);
      } catch {
        /* ignore */
      }
      try {
        const sample = await frame.evaluate(() => {
          const names = new Set<string>();
          for (const el of Array.from(document.querySelectorAll("*"))) {
            for (const name of el.getAttributeNames()) {
              if (/^data-seat|^data-row$|^data-col$|^data-number$|^aria-label$/i.test(name)) {
                names.add(name);
              }
            }
          }
          return Array.from(names).slice(0, 24);
        });
        console.warn(
          `[seat-map diagnostics] frame=${frameUrl} seat-ish attrs=[${sample.join(", ") || "(none)"}]`,
        );
      } catch {
        console.warn(`[seat-map diagnostics] frame=${frameUrl} (evaluate skipped — likely cross-origin)`);
      }
    }
    const body = await page.locator("body").innerText().catch(() => "");
    if (PAYMENT_STAGE_WORDS.test(body)) {
      console.warn("[seat-map diagnostics] payment-stage words appear in main body (HARD STOP region?)");
    } else {
      console.warn("[seat-map diagnostics] payment-stage words: not detected in main body");
    }
  }

  async openMovie(target: BookingTarget) {
    const page = this.getPage();
    await this.assertNoCaptcha(page);

    if (target.bookingUrl) {
      if (!isExactCgvBookingUrl(target.bookingUrl)) {
        throw new Error("INVALID_EXACT_CGV_BOOKING_URL: need https://cgv.co.kr/cnm/movieBook/movie?...&movNo&scnYmd&scnsNo&scnSseq");
      }
      await page.goto(target.bookingUrl, { waitUntil: "domcontentloaded" });
      await this.waitForProgress(page);
      await this.assertNoCaptcha(page);
      return;
    }

    await page.goto(this.options.baseUrl ?? CGV_BOOKING_URL, { waitUntil: "domcontentloaded" });
    await this.clickTextOrRole(page, target.movieTitle);
    await this.assertNoCaptcha(page);
  }

  async openShowtime(target: BookingTarget) {
    const page = this.getPage();
    await this.assertNoCaptcha(page);

    if (target.bookingUrl) {
      if (page.url() !== target.bookingUrl) {
        await page.goto(target.bookingUrl, { waitUntil: "domcontentloaded" });
      }
      await this.waitForProgress(page);
      await this.assertNoCaptcha(page);
      return;
    }

    await this.selectDate(page, target.playDate);
    await this.clickTextOrRole(page, target.showtime);
    await this.assertNoCaptcha(page);
  }


  /**
   * Best-effort person/audience count selection before the seat map.
   * CGV often requires picking 일반/성인 count = BOOKING_SEAT_COUNT.
   * DOM is NOT Windows-E2E verified — if no control matches, warn and continue.
   */
  async selectAudienceCount(count: number) {
    const page = this.getPage();
    await this.assertNoCaptcha(page);

    const roots = await this.interactiveRoots();
    const countStr = String(count);

    for (const root of roots) {
      // Exact count button / spin (common patterns; unverified)
      const candidates: Locator[] = [
        root.getByRole("button", { name: new RegExp(`^\\s*${escapeRegExp(countStr)}\\s*$`) }).first(),
        root.getByRole("spinbutton").first(),
        root.locator(`[data-count="${escapeCssAttribute(countStr)}"]`).first(),
        root.locator(`[data-seat-count="${escapeCssAttribute(countStr)}"]`).first(),
        root.locator(`button, [role='button'], a`).filter({ hasText: new RegExp(`^\\s*${escapeRegExp(countStr)}\\s*$`) }).first(),
        root.getByLabel(/일반|성인|인원/i).first(),
      ];

      for (const candidate of candidates) {
        try {
          if (!(await candidate.count())) continue;
          const text = `${await candidate.innerText().catch(() => "")} ${await candidate.getAttribute("aria-label").catch(() => "")}`;
          if (FORBIDDEN_CLICK_WORDS.test(text) || PAYMENT_STAGE_WORDS.test(text)) {
            console.warn(`[audience] refusing payment-like control: ${text.trim().slice(0, 60)}`);
            continue;
          }
          const tag = await candidate.evaluate((el) => el.tagName.toLowerCase()).catch(() => "");
          const role = await candidate.getAttribute("role").catch(() => "");
          if (tag === "input" || role === "spinbutton") {
            await candidate.fill(countStr);
          } else {
            await candidate.click();
          }
          console.log(`[audience] selected count=${count} via hypothesized control (DOM not E2E-verified)`);
          await this.waitForProgress(page);
          await this.assertNoCaptcha(page);
          return true;
        } catch {
          // try next candidate
        }
      }
    }

    console.warn(
      `[audience] no person-count control matched for count=${count}; continuing (DOM not E2E-verified)`,
    );
    return false;
  }


  async selectSeats(target: BookingTarget) {
    const page = this.getPage();
    await this.assertNoCaptcha(page);

    await this.selectAudienceCount(target.requestedSeatCount);

    const explicit = target.seatIds?.filter(Boolean) ?? [];
    const seatIds = explicit.length
      ? explicit
      : await this.autoSelectSeats(target.requestedSeatCount, target.seatPreference);
    if (seatIds.length !== target.requestedSeatCount) throw new Error("SEAT_COUNT_MISMATCH");

    for (const seatId of seatIds) {
      const seat = await this.findSeat(page, seatId);
      if (!(await seat.count())) throw new Error(`CGV_SEAT_NOT_FOUND:${seatId}`);
      await seat.click();
    }
    this.selectedSeats = seatIds;

    if (!(await this.clickSafeNext(page))) throw new Error("CGV_SEAT_NEXT_NOT_FOUND");
    await this.assertNoCaptcha(page);
  }

  async autoSelectSeats(count: number, preference: Omit<SeatPreference, "count"> = {}) {
    let root: SeatRoot;
    try {
      root = await this.waitForSeatMap();
    } catch (error) {
      throw error;
    }
    const seats = await this.readSeatMap(root);
    let usedDistanceFallback = false;
    const blocks = rankSeatBlocks(
      seats,
      { count, ...preference },
      {
        onDistanceFallback: () => {
          usedDistanceFallback = true;
        },
      },
    );
    if (usedDistanceFallback) {
      console.warn(
        `[seat-ranker] preferredRowDistance filter yielded 0 blocks; falling back (row distance as score penalty only)`,
      );
    }
    const block = blocks[0];
    if (!block) throw new Error("CGV_NO_CONTIGUOUS_SEATS");
    return block.seats.map((seat) => seat.id);
  }

  async fillBookingInfo(info: Record<string, string>) {
    const page = this.getPage();
    await this.assertNoCaptcha(page);
    for (const [label, value] of Object.entries(info)) {
      const field = page.getByLabel(label, { exact: false }).first();
      if (await field.count()) await field.fill(value);
    }
    if (!(await this.clickSafeNext(page))) throw new Error("CGV_BOOKING_INFO_NEXT_NOT_FOUND");
    await this.assertNoCaptcha(page);
  }

  async goToPaymentPage(target: BookingTarget) {
    const page = this.getPage();
    await this.advanceUntilPayment(page);
    this.stopped = true;
    const url = page.url();
    const seats = this.selectedSeats.length ? this.selectedSeats : (target.seatIds ?? []);
    await this.options.onPaymentReady?.({ url, seats });
    return { url, seats, hardStop: true as const };
  }

  async pauseAtPayment() {
    this.stopped = true;
    return this.page?.url() ?? null;
  }

  async waitForBrowserClose() {
    const page = this.page;
    if (!page || page.isClosed()) return;
    await new Promise<void>((resolve) => {
      page.once("close", () => resolve());
    });
  }

  async getBrowserAccess() {
    return this.page?.url() ?? null;
  }

  async close() {
    await this.context?.close().catch(() => undefined);
    await this.browser?.close().catch(() => undefined);
    this.context = undefined;
    this.browser = undefined;
    this.page = undefined;
  }

  private async readSeatMap(root: SeatRoot): Promise<SeatPoint[]> {
    const raw = await root.locator(SEAT_MAP_SELECTOR).evaluateAll((elements) =>
      elements
        .map((el) => {
          const node = el as HTMLElement;
          const dataRow = node.getAttribute("data-row") || node.getAttribute("data-seat-row");
          const dataCol =
            node.getAttribute("data-col") ||
            node.getAttribute("data-number") ||
            node.getAttribute("data-seat-no") ||
            node.getAttribute("data-seatno");
          const rawId =
            node.getAttribute("data-seat-id") ||
            node.getAttribute("data-seat") ||
            node.getAttribute("data-seat-code") ||
            node.getAttribute("data-seatcode") ||
            (dataRow && dataCol ? `${dataRow}${dataCol}` : "") ||
            node.getAttribute("aria-label") ||
            node.textContent ||
            "";
          const label = (node.getAttribute("aria-label") || node.textContent || "").trim();
          const disabled =
            node.hasAttribute("disabled") ||
            node.getAttribute("aria-disabled") === "true" ||
            node.getAttribute("aria-checked") === "mixed";
          const cls = `${String(node.className || "")} ${node.getAttribute("data-status") || ""} ${node.getAttribute("data-state") || ""}`.toLowerCase();
          const m =
            rawId.match(/([A-Z가-힣]+)\s*[-_ ]?\s*(\d{1,3})/i) ||
            label.match(/([A-Z가-힣]+)\s*[-_ ]?\s*(\d{1,3})/i) ||
            (dataRow && dataCol ? ([null, dataRow, dataCol] as unknown as RegExpMatchArray) : null);
          if (!m) return null;
          const row = String(m[1]).toUpperCase();
          const number = Number(m[2]);
          if (!row || !Number.isFinite(number)) return null;
          return {
            id: `${row}${number}`,
            row,
            number,
            available:
              !disabled &&
              !/(disabled|unavailable|occupied|reserved|sold|매진|선택불가|예약)/.test(
                `${cls} ${label.toLowerCase()}`,
              ),
            aisle: /aisle|통로/.test(`${cls} ${label.toLowerCase()}`),
            edge: /edge|끝|사이드/.test(`${cls} ${label.toLowerCase()}`),
          } satisfies SeatPoint;
        })
        .filter(Boolean),
    );
    const seats = raw as SeatPoint[];
    if (!seats.length) {
      const page = this.getPage();
      await this.logSeatMapDiagnostics(page);
      throw new Error("CGV_SEAT_MAP_NOT_FOUND");
    }
    return seats;
  }

  private async findSeatInRoot(root: SeatRoot, seatId: string): Promise<Locator> {
    const safe = escapeCssAttribute(seatId);
    const byAttribute = root
      .locator(
        `[data-seat-id="${safe}"], [data-seat="${safe}"], [data-seat-code="${safe}"], [data-seatcode="${safe}"], [data-seat-no="${safe}"], [aria-label="${safe}"]`,
      )
      .first();
    if (await byAttribute.count()) return byAttribute;

    const m = seatId.match(/^([A-Z가-힣]+)(\d{1,3})$/i);
    if (m) {
      const row = escapeCssAttribute(m[1].toUpperCase());
      const num = escapeCssAttribute(m[2]);
      const byRowCol = root
        .locator(
          `[data-row="${row}"][data-col="${num}"], [data-row="${row}"][data-number="${num}"], [data-seat-row="${row}"][data-seat-no="${num}"]`,
        )
        .first();
      if (await byRowCol.count()) return byRowCol;
    }

    const byRole = root.getByRole("checkbox", { name: new RegExp(`^${escapeRegExp(seatId)}$`, "i") }).first();
    if (await byRole.count()) return byRole;
    const byButton = root.getByRole("button", { name: new RegExp(`^${escapeRegExp(seatId)}$`, "i") }).first();
    if (await byButton.count()) return byButton;

    return root.getByText(seatId, { exact: true }).first();
  }

  /** Search main page and same-origin frames for a seat control. */
  private async findSeat(page: Page, seatId: string): Promise<Locator> {
    const preferred = await this.seatRoots();
    const preferredHit = await this.findSeatInRoot(preferred, seatId);
    if (await preferredHit.count()) return preferredHit;

    for (const frame of page.frames()) {
      if (frame === preferred) continue;
      try {
        const hit = await this.findSeatInRoot(frame, seatId);
        if (await hit.count()) return hit;
      } catch {
        // cross-origin / detached
      }
    }
    return preferredHit;
  }

  private async advanceUntilPayment(page: Page) {
    for (let step = 0; step < 4; step += 1) {
      await this.assertNoCaptcha(page);
      if (await this.isPaymentStage(page)) return;
      if (!(await this.clickSafeNext(page))) throw new Error("CGV_PAYMENT_STAGE_NOT_REACHED");
      await this.waitForProgress(page);
    }
    if (!(await this.isPaymentStage(page))) throw new Error("CGV_PAYMENT_STAGE_NOT_REACHED");
  }

  private async waitForProgress(page: Page) {
    await page.waitForLoadState("domcontentloaded").catch(() => undefined);
    await page.locator("body").waitFor({ state: "visible", timeout: this.options.timeoutMs }).catch(() => undefined);
  }

  private async isPaymentStage(page: Page) {
    const url = page.url().toLowerCase();
    if (url.includes("payment") || url.includes("/pay") || url.includes("order")) return true;
    const body = await page.locator("body").innerText().catch(() => "");
    if (PAYMENT_STAGE_WORDS.test(body)) return true;

    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      try {
        const frameUrl = frame.url().toLowerCase();
        if (frameUrl.includes("payment") || frameUrl.includes("/pay") || frameUrl.includes("order")) {
          return true;
        }
        const frameBody = await frame.locator("body").innerText().catch(() => "");
        if (PAYMENT_STAGE_WORDS.test(frameBody)) return true;
      } catch {
        // cross-origin / detached
      }
    }
    return false;
  }

  /**
   * Click only safe "next" controls. Never click payment/purchase/order buttons.
   */
  private async clickSafeNext(page: Page) {
    if (await this.isPaymentStage(page)) return false;

    const roots = await this.interactiveRoots();
    for (const root of roots) {
      const candidates: Locator[] = [
        root.getByRole("button", { name: SAFE_NEXT_WORDS }).first(),
        root.getByRole("link", { name: SAFE_NEXT_WORDS }).first(),
        root.locator("button, a, [role='button']").filter({ hasText: SAFE_NEXT_WORDS }).first(),
      ];

      for (const candidate of candidates) {
        if (!(await candidate.count())) continue;
        const text = `${await candidate.innerText().catch(() => "")} ${await candidate.getAttribute("aria-label").catch(() => "")}`;
        if (FORBIDDEN_CLICK_WORDS.test(text)) {
          console.warn(`[HARD_STOP] Refusing forbidden control: ${text.trim().slice(0, 80)}`);
          continue;
        }
        if (!SAFE_NEXT_WORDS.test(text)) continue;
        await candidate.click();
        return true;
      }
    }
    return false;
  }

  private async assertNoCaptcha(page: Page) {
    const chunks: string[] = [];
    const body = await page.locator("body").innerText().catch(() => "");
    const html = await page.content().catch(() => "");
    chunks.push(body, html);

    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      try {
        const frameBody = await frame.locator("body").innerText().catch(() => "");
        if (frameBody) chunks.push(frameBody);
      } catch {
        // cross-origin / detached
      }
    }

    const blob = chunks.join("\n");
    if (CAPTCHA_WORDS.test(blob)) {
      this.stopped = true;
      throw new Error("CAPTCHA_DETECTED: agent will not bypass CAPTCHA. Solve manually or stop.");
    }
  }

  private async selectDate(page: Page, date: string) {
    const candidates = [
      page.locator(`[data-date="${escapeCssAttribute(date)}"]`).first(),
      page.locator(`[data-play-date="${escapeCssAttribute(date)}"]`).first(),
      page.getByText(date, { exact: true }).first(),
    ];
    for (const candidate of candidates) {
      if (await candidate.count()) {
        await candidate.click();
        return;
      }
    }
    throw new Error(`SHOW_DATE_NOT_FOUND:${date}`);
  }

  private async clickTextOrRole(page: Page, text: string) {
    if (await this.isPaymentStage(page)) throw new Error("AUTOMATION_HARD_STOP");
    if (FORBIDDEN_CLICK_WORDS.test(text)) throw new Error(`FORBIDDEN_CLICK_TARGET:${text}`);

    const exact = page.getByText(text, { exact: true }).first();
    if (await exact.count()) {
      await exact.click();
      return;
    }
    const role = page.getByRole("button", { name: new RegExp(escapeRegExp(text), "i") }).first();
    if (await role.count()) {
      await role.click();
      return;
    }
    throw new Error(`CGV_TARGET_NOT_FOUND:${text}`);
  }
}

/** Require movNo, scnYmd, scnsNo, scnSseq. siteNo is optional if present. */
export function isExactCgvBookingUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const pathname = url.pathname.replace(/\/+$/, "");
    const required = ["movNo", "scnYmd", "scnsNo", "scnSseq"];
    // siteNo may be present; do not require it
    return (
      url.protocol === "https:" &&
      (host === "cgv.co.kr" || host === "www.cgv.co.kr") &&
      pathname === "/cnm/movieBook/movie" &&
      required.every((key) => url.searchParams.get(key))
    );
  } catch {
    return false;
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeCssAttribute(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
