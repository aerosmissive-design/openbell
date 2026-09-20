import { chromium, type Browser, type BrowserContext, type Page, type Frame, type Locator } from "playwright";
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { rankSeatBlocks, type SeatPoint, type SeatPreference } from "./seat-ranker.js";
import {
  FORBIDDEN_CLICK_WORDS,
  SAFE_NEXT_WORDS,
  dateClickLabels,
  isCaptchaFrameUrl,
  isExactCgvBookingUrl,
  isForbiddenClickLabel,
  isPaymentStageSignal,
  isSafeDialogLabel,
  looksLikeCaptchaChallenge,
  looksLikeLoginPage,
  showtimeClickLabels,
} from "./safety.js";

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

export { isExactCgvBookingUrl };

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

  hasHardStopped() {
    return this.stopped;
  }

  async launch() {
    this.browser = await chromium.launch({ headless: this.options.headless });
    const storagePath = this.options.storageStatePath?.trim();
    const storage =
      storagePath && existsSync(storagePath)
        ? { storageState: storagePath }
        : undefined;
    if (storagePath && !storage) {
      console.warn("[storage] CGV_STORAGE_STATE file missing; launching without saved login");
    }
    this.context = await this.browser.newContext({
      locale: "ko-KR",
      timezoneId: "Asia/Seoul",
      ...storage,
    });
    this.context.setDefaultTimeout(this.options.timeoutMs);
    this.page = await this.context.newPage();
    // Do not navigate here. openMovie / openShowtime own the first URL (avoids a wasted generic load).
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

  /** Main page + same-origin frames (next / 인원 / captcha / payment checks). */
  private async interactiveRoots(): Promise<SeatRoot[]> {
    const page = this.getPage();
    const roots: SeatRoot[] = [page];
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      try {
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

  private async saveFailureShot(page: Page, tag: string) {
    try {
      const dir = join(process.cwd(), "logs");
      mkdirSync(dir, { recursive: true });
      const file = join(dir, `${tag}-${Date.now()}.png`);
      await page.screenshot({ path: file, fullPage: true });
      console.warn(`[screenshot] saved ${file}`);
    } catch {
      console.warn("[screenshot] failed (non-fatal)");
    }
  }

  /** Safe diagnostics only — no cookies, tokens, or storageState. */
  private async logSeatMapDiagnostics(page: Page) {
    await this.saveFailureShot(page, "seat-map");
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
    if (isPaymentStageSignal(page.url(), body)) {
      console.warn("[seat-map diagnostics] payment-stage words appear in main body (HARD STOP region?)");
    } else {
      console.warn("[seat-map diagnostics] payment-stage words: not detected in main body");
    }
  }

  async openMovie(target: BookingTarget) {
    const page = this.getPage();

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
    await this.waitForProgress(page);
    await this.assertNoCaptcha(page);
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
    await this.clickTextOrRole(page, target.showtime, showtimeClickLabels(target.showtime));
    await this.assertNoCaptcha(page);
  }

  /**
   * Best-effort 인원/일반/성인 count before the seat map.
   * Never click a bare number on the whole page (that can hit a seat).
   * Skip if a seat map is already visible. DOM not E2E-verified.
   */
  async selectAudienceCount(count: number) {
    const page = this.getPage();
    await this.assertNoCaptcha(page);
    if (count < 1 || count > 10) return false;

    try {
      const map = await this.seatRoots();
      if ((await map.locator(SEAT_MAP_SELECTOR).count()) > 0) {
        console.log("[audience] seat map already visible; skipping person-count step");
        return false;
      }
    } catch {
      /* continue */
    }

    const countStr = String(count);
    const roots = await this.interactiveRoots();
    for (const root of roots) {
      const labeled: Locator[] = [
        root.getByLabel(/일반|성인|인원/).first(),
        root.getByRole("spinbutton", { name: /일반|성인|인원/ }).first(),
        root.getByRole("combobox", { name: /일반|성인|인원/ }).first(),
        root.locator("[data-seat-count], [name*='person' i], [name*='cntPerson' i], [id*='person' i]").first(),
      ];
      for (const candidate of labeled) {
        if (await this.trySetAudienceControl(candidate, countStr)) return true;
      }

      const scoped = root.locator(
        "[class*='person' i], [class*='audience' i], [class*='cnt' i], [id*='person' i], [class*='인원']",
      );
      const numberBtn = scoped
        .getByRole("button", { name: new RegExp(`^\\s*${escapeRegExp(countStr)}\\s*$`) })
        .first();
      if (await this.trySetAudienceControl(numberBtn, countStr, { clickOnly: true })) return true;
    }

    console.warn(
      `[audience] no person-count control matched for count=${count}; continuing (DOM not E2E-verified)`,
    );
    return false;
  }

  private async trySetAudienceControl(
    candidate: Locator,
    countStr: string,
    opts?: { clickOnly?: boolean },
  ) {
    try {
      if (!(await candidate.count())) return false;
      const text = `${await candidate.innerText().catch(() => "")} ${await candidate.getAttribute("aria-label").catch(() => "")}`;
      if (isForbiddenClickLabel(text) || isPaymentStageSignal("", text)) {
        console.warn(`[audience] refusing payment-like control: ${text.trim().slice(0, 60)}`);
        return false;
      }
      const tag = await candidate.evaluate((el) => el.tagName.toLowerCase()).catch(() => "");
      const role = await candidate.getAttribute("role").catch(() => "");
      if (!opts?.clickOnly && (tag === "input" || tag === "select" || role === "spinbutton" || role === "combobox")) {
        await candidate.fill(countStr);
      } else {
        await candidate.click();
      }
      console.log(`[audience] selected count=${countStr} (DOM not E2E-verified)`);
      const page = this.getPage();
      await this.waitForProgress(page);
      await this.assertNoCaptcha(page);
      return true;
    } catch {
      return false;
    }
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
    const root = await this.waitForSeatMap();
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
    const roots = await this.interactiveRoots();
    for (const [label, value] of Object.entries(info)) {
      if (isForbiddenClickLabel(label) || isForbiddenClickLabel(value)) {
        throw new Error(`FORBIDDEN_BOOKING_INFO:${label}`);
      }
      let filled = false;
      for (const root of roots) {
        const field = root.getByLabel(label, { exact: false }).first();
        if (await field.count()) {
          await field.fill(value);
          filled = true;
          break;
        }
      }
      if (!filled) console.warn(`[booking-info] no field matched label=${label}`);
    }
    if (!(await this.clickSafeNext(page))) throw new Error("CGV_BOOKING_INFO_NEXT_NOT_FOUND");
    await this.assertNoCaptcha(page);
  }

  async goToPaymentPage(target: BookingTarget) {
    const page = this.getPage();
    await this.advanceUntilPayment(page);
    this.stopped = true;
    await this.saveFailureShot(page, "payment-ready");
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
    const browser = this.browser;
    if (!page || page.isClosed()) return;
    console.log("[hold] Pay in this browser, then close the window. Agent will wait.");
    await new Promise<void>((resolve) => {
      const done = () => {
        clearInterval(tick);
        resolve();
      };
      const tick = setInterval(() => {
        console.log("[hold] Browser still open. Pay yourself. Agent will not click payment.");
      }, 30_000);
      page.once("close", done);
      browser?.once("disconnected", done);
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
    await this.dismissSafeDialogs(page);
    await this.assertNoLogin(page);
  }

  /**
   * Click age-gate / 닫기 only. Never payment. At most 3 clicks.
   */
  private async dismissSafeDialogs(page: Page) {
    for (let i = 0; i < 3; i += 1) {
      if (await this.isPaymentStage(page)) return;
      let clicked = false;
      for (const root of await this.interactiveRoots()) {
        const buttons = root.locator("button, [role='button'], a");
        const n = Math.min(await buttons.count().catch(() => 0), 24);
        for (let j = 0; j < n; j += 1) {
          const btn = buttons.nth(j);
          const text = `${await btn.innerText().catch(() => "")} ${await btn.getAttribute("aria-label").catch(() => "")}`;
          if (!isSafeDialogLabel(text)) continue;
          if (isForbiddenClickLabel(text)) continue;
          await btn.click().catch(() => undefined);
          clicked = true;
          await new Promise((r) => setTimeout(r, 200));
          break;
        }
        if (clicked) break;
      }
      if (!clicked) return;
    }
  }

  private async assertNoLogin(page: Page) {
    const body = await page.locator("body").innerText().catch(() => "");
    if (looksLikeLoginPage(page.url(), body)) {
      this.stopped = true;
      await this.saveFailureShot(page, "login");
      throw new Error("LOGIN_REQUIRED: CGV login page detected. Save storageState after a manual login; agent will not enter credentials.");
    }
  }

  private async isPaymentStage(page: Page) {
    const main = await page.locator("body").innerText().catch(() => "");
    if (isPaymentStageSignal(page.url(), main)) return true;
    for (const frame of page.frames()) {
      try {
        const body = await frame.locator("body").innerText().catch(() => "");
        if (isPaymentStageSignal(frame.url(), body)) return true;
      } catch {
        /* cross-origin */
      }
    }
    return false;
  }

  /**
   * Click only safe "next" controls. Never click payment/purchase/order buttons.
   * Search main page and same-origin frames (seat confirm often lives in an iframe).
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
        try {
          if (!(await candidate.count())) continue;
          const text = `${await candidate.innerText().catch(() => "")} ${await candidate.getAttribute("aria-label").catch(() => "")}`;
          if (isForbiddenClickLabel(text) || FORBIDDEN_CLICK_WORDS.test(text)) {
            console.warn(`[HARD_STOP] Refusing forbidden control: ${text.trim().slice(0, 80)}`);
            continue;
          }
          if (!SAFE_NEXT_WORDS.test(text)) continue;
          await candidate.click();
          return true;
        } catch {
          // cross-origin / detached frame
        }
      }
    }
    return false;
  }

  private async assertNoCaptcha(page: Page) {
    const body = await page.locator("body").innerText().catch(() => "");
    if (looksLikeCaptchaChallenge(body)) {
      this.stopped = true;
      await this.saveFailureShot(page, "captcha");
      throw new Error("CAPTCHA_DETECTED: agent will not bypass CAPTCHA. Solve manually or stop.");
    }
    for (const frame of page.frames()) {
      try {
        if (isCaptchaFrameUrl(frame.url())) {
          this.stopped = true;
          await this.saveFailureShot(page, "captcha");
          throw new Error("CAPTCHA_DETECTED: agent will not bypass CAPTCHA. Solve manually or stop.");
        }
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("CAPTCHA_DETECTED")) throw error;
      }
    }
  }

  private async selectDate(page: Page, date: string) {
    const labels = dateClickLabels(date);
    for (const label of labels) {
      const candidates = [
        page.locator(`[data-date="${escapeCssAttribute(label)}"]`).first(),
        page.locator(`[data-play-date="${escapeCssAttribute(label)}"]`).first(),
        page.locator(`[data-ymd="${escapeCssAttribute(label)}"]`).first(),
        page.getByText(label, { exact: true }).first(),
      ];
      for (const candidate of candidates) {
        if (await candidate.count()) {
          const text = `${await candidate.innerText().catch(() => "")} ${await candidate.getAttribute("aria-label").catch(() => "")}`;
          if (isForbiddenClickLabel(text)) continue;
          await candidate.click();
          return;
        }
      }
    }
    throw new Error(`SHOW_DATE_NOT_FOUND:${date}`);
  }

  private async clickTextOrRole(page: Page, text: string, aliases: string[] = [text]) {
    if (await this.isPaymentStage(page)) throw new Error("AUTOMATION_HARD_STOP");
    if (aliases.some((item) => isForbiddenClickLabel(item))) throw new Error(`FORBIDDEN_CLICK_TARGET:${text}`);

    for (const label of aliases) {
      const exact = page.getByText(label, { exact: true }).first();
      if (await exact.count()) {
        await exact.click();
        return;
      }
      const role = page.getByRole("button", { name: new RegExp(escapeRegExp(label), "i") }).first();
      if (await role.count()) {
        await role.click();
        return;
      }
    }
    throw new Error(`CGV_TARGET_NOT_FOUND:${text}`);
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeCssAttribute(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
