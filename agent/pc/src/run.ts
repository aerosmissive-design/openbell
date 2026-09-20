import { CgvBookingAgent, type BookingState, type BookingTarget } from "./cgv-agent.js";

export type RunBookingInput = BookingTarget & {
  bookingInfo?: Record<string, string>;
  storageStatePath?: string;
  headless?: boolean;
  holdAtPayment?: boolean;
  onStateChange?: (state: BookingState) => Promise<void>;
  onPaymentReady?: (result: { url: string; seats: string[] }) => Promise<void>;
};

/** Runs the full non-payment portion of a CGV booking. */
export async function runBooking(input: RunBookingInput) {
  const headless = input.headless ?? false;
  const holdAtPayment = input.holdAtPayment ?? !headless;
  const agent = new CgvBookingAgent({
    storageStatePath: input.storageStatePath,
    headless,
    onPaymentReady: input.onPaymentReady,
  });

  await agent.launch();
  try {
    await input.onStateChange?.("SEAT_FOUND");
    await input.onStateChange?.("BOOKING");

    await agent.openMovie(input);
    await input.onStateChange?.("MOVIE_SELECTED");

    await agent.openShowtime(input);
    await input.onStateChange?.("SHOWTIME_SELECTED");

    await agent.selectSeats(input);
    await input.onStateChange?.("SEAT_SELECTED");

    if (input.bookingInfo) {
      await agent.fillBookingInfo(input.bookingInfo);
    }
    await input.onStateChange?.("BOOKING_INFO");

    const result = await agent.goToPaymentPage(input);
    if (holdAtPayment) {
      await input.onStateChange?.("WAITING_USER");
      console.log("Payment hard stop reached. Browser remains open for manual completion.");
      await agent.waitForBrowserClose();
    } else {
      await agent.close();
    }
    return result;
  } catch (error) {
    // If we already hit PAYMENT_READY, never close the browser on a later API/callback error.
    if (agent.hasHardStopped() && holdAtPayment) {
      console.error("[HARD_STOP] Error after payment page. Browser stays open for manual payment.");
      console.error(error instanceof Error ? error.message : error);
      try {
        await input.onStateChange?.("WAITING_USER");
      } catch {
        /* ignore */
      }
      await agent.waitForBrowserClose();
      throw error;
    }
    await agent.close();
    throw error;
  }
}
