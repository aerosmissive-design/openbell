import { CgvBookingAgent, type BookingTarget } from "./cgv-booking-agent";
import type { BookingState } from "../../src/lib/booking/types";

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
  const headless = input.headless ?? true;
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
      await input.onStateChange?.("BOOKING_INFO");
    } else {
      await input.onStateChange?.("BOOKING_INFO");
    }

    const result = await agent.goToPaymentPage(input);
    const holdAtPayment = input.holdAtPayment ?? !headless;
    if (holdAtPayment) {
      await input.onStateChange?.("WAITING_USER");
      console.log("Payment hard stop reached. Browser remains open for manual completion.");
      await agent.waitForBrowserClose();
    }
    return result;
  } catch (error) {
    await agent.close();
    throw error;
  }
}
