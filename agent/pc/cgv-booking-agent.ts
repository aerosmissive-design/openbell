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

const CGV_BOOKING_URL = "https://cgv.co.kr/cnm/movieBook/movie";
const FINAL_PAYMENT_WORDS = /결제|주문|구매|최종/i;
const SAFE_NEXT_WORDS = /다음|선택완료|좌석선택완료|예매하기/i;

/**
 * PC-side CGV booking automation.
 *
 * The flow is deliberately stopped at the payment stage. This class contains
 * no final-payment click and rejects any attempt to use a final-payment label.
 */
export class CgvBookingAgent {
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private stopped = false;
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

  async openMovie(target: BookingTarget) {
    const page = this.getPage();
    await page.goto(this.options.baseUrl ?? CGV_BOOKING_URL, { waitUntil: "domcontentloaded" });
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
      const safeId = escapeCssAttribute(seatId);
      const seat = page.locator(`[data-seat-id="${safeId}"], [data-seat="${safeId}"]`).first();
      if (await seat.count()) {
        await seat.click();
        continue;
      }
      const textSeat = page.getByText(seatId, { exact: true }).first();
      if (await textSeat.count()) {
        await textSeat.click();
        continue;
      }
      throw new Error(`CGV_SEAT_NOT_FOUND:${seatId}`);
    }
    await this.clickSafeNext(page);
  }

  async fillBookingInfo(info: Record<string, string>) {
    const page = this.getPage();
    for (const [label, value] of Object.entries(info)) {
      const field = page.getByLabel(label, { exact: false }).first();
      if (await field.count()) await field.fill(value);
    }
    await this.clickSafeNext(page);
  }

  /** Move through non-payment confirmation UI and stop when payment is shown. */
  async goToPaymentPage(target: BookingTarget) {
    const page = this.getPage();
    await this.advanceUntilPayment(page);
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

  private async advanceUntilPayment(page: Page) {
    for (let step = 0; step < 4; step += 1) {
      if (await this.isPaymentStage(page)) return;
      const clicked = await this.clickSafeNext(page);
      if (!clicked) {
        if (await this.isPaymentStage(page)) return;
        throw new Error("CGV_PAYMENT_STAGE_NOT_REACHED");
      }
      await page.waitForLoadState("domcontentloaded").catch(() => undefined);
      await page.waitForTimeout(300);
    }
    if (!(await this.isPaymentStage(page))) throw new Error("CGV_PAYMENT_STAGE_NOT_REACHED");
  }

  private async isPaymentStage(page: Page) {
    const url = page.url().toLowerCase();
    if (url.includes("payment") || url.includes("pay")) return true;
    const body = await page.locator("body").innerText().catch(() => "");
    return /최종결제금액|결제수단|결제하기|결제 정보/.test(body);
  }

  private async clickSafeNext(page: Page) {
    const candidates = [
      page.getByRole("button", { name: SAFE_NEXT_WORDS }).first(),
      page.getByRole("link", { name: SAFE_NEXT_WORDS }).first(),
    ];
    for (const candidate of candidates) {
      if (!(await candidate.count())) continue;
      const name = await candidate.getAttribute("aria-label").catch(() => null);
      const text = (await candidate.innerText().catch(() => "")) || name || "";
      if (FINAL_PAYMENT_WORDS.test(text)) continue;
      await candidate.click();
      return true;
    }
    return false;
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

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeCssAttribute(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
