import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

export type BookingTarget = {
  movieTitle: string;
  playDate: string; // YYYY-MM-DD
  showtime: string; // HH:mm
  requestedSeatCount: number;
  seatIds: string[];
  browserAccessUrl?: string;
};

export type BookingAgentOptions = {
  baseUrl?: string;
  storageStatePath?: string;
  headless?: boolean;
  timeoutMs?: number;
  onPaymentReady?: (info: { url: string; seats: string[] }) => Promise<void>;
};

const CGV_URL = "https://www.cgv.co.kr";

/**
 * CGV booking automation.
 *
 * IMPORTANT: this class intentionally has no method that clicks a final
 * payment/order button. The flow ends at the payment-ready page and calls
 * onPaymentReady. This is a code-level hard stop, not merely a UI convention.
 */
export class CgvBookingAgent {
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private stopped = false;
  private readonly options: Required<Pick<BookingAgentOptions, "headless" | "timeoutMs">> & BookingAgentOptions;

  constructor(options: BookingAgentOptions = {}) {
    this.options = { headless: true, timeoutMs: 15_000, ...options };
  }

  async launch() {
    this.browser = await chromium.launch({ headless: this.options.headless });
    this.context = await this.browser.newContext(
      this.options.storageStatePath ? { storageState: this.options.storageStatePath } : undefined,
    );
    this.context.setDefaultTimeout(this.options.timeoutMs);
    this.page = await this.context.newPage();
    await this.page.goto(this.options.baseUrl ?? CGV_URL, { waitUntil: "domcontentloaded" });
  }

  private getPage() {
    if (!this.page) throw new Error("BOOKING_BROWSER_NOT_STARTED");
    if (this.stopped) throw new Error("AUTOMATION_HARD_STOP");
    return this.page;
  }

  async openMovie(target: BookingTarget) {
    const page = this.getPage();
    await page.goto(`${CGV_URL}/tickets`, { waitUntil: "domcontentloaded" });
    await this.clickTextOrRole(page, target.movieTitle);
  }

  async openShowtime(target: BookingTarget) {
    const page = this.getPage();
    await this.selectDate(page, target.playDate);
    await this.clickTextOrRole(page, target.showtime);
  }

  async selectSeats(target: BookingTarget) {
    const page = this.getPage();
    if (target.seatIds.length !== target.requestedSeatCount) {
      throw new Error("SEAT_COUNT_MISMATCH");
    }
    for (const seatId of target.seatIds) {
      const seat = page.locator(`[data-seat-id="${CSS.escape(seatId)}"]`).first();
      if (await seat.count()) {
        await seat.click();
        continue;
      }
      const textSeat = page.getByText(seatId, { exact: true }).first();
      await textSeat.click();
    }
    await this.clickIfPresent(page, /좌석.*선택|다음/i);
  }

  async fillBookingInfo(info: Record<string, string>) {
    const page = this.getPage();
    for (const [label, value] of Object.entries(info)) {
      const field = page.getByLabel(label, { exact: false }).first();
      if (await field.count()) await field.fill(value);
    }
  }

  /** Navigate to the pre-payment state and STOP. */
  async goToPaymentPage(target: BookingTarget) {
    const page = this.getPage();
    await this.clickIfPresent(page, /결제|payment/i);
    await page.waitForLoadState("domcontentloaded").catch(() => undefined);

    // Never click a final payment/order button.
    this.stopped = true;
    const url = page.url();
    await this.options.onPaymentReady?.({ url, seats: target.seatIds });
    return { url, seats: target.seatIds, hardStop: true as const };
  }

  async pauseAtPayment() {
    this.stopped = true;
    return this.page?.url() ?? null;
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

  private async selectDate(page: Page, date: string) {
    const candidates = [
      page.getByText(date, { exact: true }).first(),
      page.locator(`[data-date="${CSS.escape(date)}"]`).first(),
      page.locator(`[data-play-date="${CSS.escape(date)}"]`).first(),
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

  private async clickIfPresent(page: Page, pattern: RegExp) {
    const button = page.getByRole("button", { name: pattern }).first();
    if (await button.count()) {
      await button.click();
      return;
    }
    const link = page.getByRole("link", { name: pattern }).first();
    if (await link.count()) await link.click();
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
