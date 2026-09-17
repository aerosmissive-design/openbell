import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { rankSeatBlocks, type SeatPoint, type SeatPreference } from "../../src/lib/booking/seat-ranker";

export type BookingTarget = {
  movieTitle: string;
  playDate: string;
  showtime: string;
  requestedSeatCount: number;
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

const CGV_BOOKING_URL = "https://cgv.co.kr/cnm/movieBook/movie";
const FINAL_PAYMENT_WORDS = /결제|주문|구매|최종/i;
const SAFE_NEXT_WORDS = /다음|선택완료|좌석선택완료|예매하기/i;

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
    const explicit = target.seatIds?.filter(Boolean) ?? [];
    const seatIds = explicit.length ? explicit : await this.autoSelectSeats(target.requestedSeatCount, target.seatPreference);
    if (seatIds.length !== target.requestedSeatCount) throw new Error("SEAT_COUNT_MISMATCH");

    for (const seatId of seatIds) {
      const seat = this.findSeat(page, seatId);
      if (!(await seat.count())) throw new Error(`CGV_SEAT_NOT_FOUND:${seatId}`);
      await seat.click();
    }
    this.selectedSeats = seatIds;
    await this.clickSafeNext(page);
  }

  async autoSelectSeats(count: number, preference: Omit<SeatPreference, "count"> = {}) {
    const page = this.getPage();
    const seats = await this.readSeatMap(page);
    const blocks = rankSeatBlocks(seats, { count, ...preference });
    const block = blocks[0];
    if (!block) throw new Error("CGV_NO_CONTIGUOUS_SEATS");
    return block.seats.map((seat) => seat.id);
  }

  async fillBookingInfo(info: Record<string, string>) {
    const page = this.getPage();
    for (const [label, value] of Object.entries(info)) {
      const field = page.getByLabel(label, { exact: false }).first();
      if (await field.count()) await field.fill(value);
    }
    await this.clickSafeNext(page);
  }

  async goToPaymentPage(target: BookingTarget) {
    const page = this.getPage();
    await this.advanceUntilPayment(page);
    this.stopped = true;
    const url = page.url();
    const seats = this.selectedSeats.length ? this.selectedSeats : target.seatIds ?? [];
    await this.options.onPaymentReady?.({ url, seats });
    return { url, seats, hardStop: true as const };
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

  private async readSeatMap(page: Page): Promise<SeatPoint[]> {
    const raw = await page.locator('[data-seat-id], [data-seat], [aria-label*="좌석"], [aria-label*="seat"]').evaluateAll((elements) =>
      elements.map((el) => {
        const node = el as HTMLElement;
        const rawId = node.getAttribute("data-seat-id") || node.getAttribute("data-seat") || node.getAttribute("aria-label") || node.textContent || "";
        const label = (node.getAttribute("aria-label") || node.textContent || "").trim();
        const disabled = node.hasAttribute("disabled") || node.getAttribute("aria-disabled") === "true";
        const cls = `${String(node.className || "")} ${node.getAttribute("data-status") || ""}`.toLowerCase();
        const m = rawId.match(/([A-Z가-힣]+)\s*[-_ ]?\s*(\d{1,3})/i) || label.match(/([A-Z가-힣]+)\s*[-_ ]?\s*(\d{1,3})/i);
        if (!m) return null;
        const row = m[1].toUpperCase();
        const number = Number(m[2]);
        return {
          id: `${row}${number}`,
          row,
          number,
          available: !disabled && !/(disabled|unavailable|occupied|reserved|sold|매진|선택불가|예약)/.test(`${cls} ${label.toLowerCase()}`),
          aisle: /aisle|통로/.test(`${cls} ${label.toLowerCase()}`),
          edge: /edge|끝|사이드/.test(`${cls} ${label.toLowerCase()}`),
        } satisfies SeatPoint;
      }).filter(Boolean),
    );
    const seats = raw as SeatPoint[];
    if (!seats.length) throw new Error("CGV_SEAT_MAP_NOT_FOUND");
    return seats;
  }

  private findSeat(page: Page, seatId: string) {
    const safe = escapeCssAttribute(seatId);
    return page.locator(`[data-seat-id="${safe}"], [data-seat="${safe}"]`).first().or(page.getByText(seatId, { exact: true }).first());
  }

  private async advanceUntilPayment(page: Page) {
    for (let step = 0; step < 4; step += 1) {
      if (await this.isPaymentStage(page)) return;
      if (!(await this.clickSafeNext(page))) throw new Error("CGV_PAYMENT_STAGE_NOT_REACHED");
      await page.waitForLoadState("domcontentloaded").catch(() => undefined);
      await page.waitForTimeout(300);
    }
    if (!(await this.isPaymentStage(page))) throw new Error("CGV_PAYMENT_STAGE_NOT_REACHED");
  }

  private async isPaymentStage(page: Page) {
    const url = page.url().toLowerCase();
    if (url.includes("payment") || url.includes("pay")) return true;
    const body = await page.locator("body").innerText().catch(() => "");
    return /최종결제금액|결제수단|결제 정보/.test(body);
  }

  private async clickSafeNext(page: Page) {
    const candidates = [
      page.getByRole("button", { name: SAFE_NEXT_WORDS }).first(),
      page.getByRole("link", { name: SAFE_NEXT_WORDS }).first(),
    ];
    for (const candidate of candidates) {
      if (!(await candidate.count())) continue;
      const text = (await candidate.innerText().catch(() => "")) || (await candidate.getAttribute("aria-label").catch(() => null)) || "";
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
      if (await candidate.count()) { await candidate.click(); return; }
    }
    throw new Error(`SHOW_DATE_NOT_FOUND:${date}`);
  }

  private async clickTextOrRole(page: Page, text: string) {
    const exact = page.getByText(text, { exact: true }).first();
    if (await exact.count()) { await exact.click(); return; }
    const role = page.getByRole("button", { name: new RegExp(escapeRegExp(text), "i") }).first();
    if (await role.count()) { await role.click(); return; }
    throw new Error(`CGV_TARGET_NOT_FOUND:${text}`);
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeCssAttribute(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
