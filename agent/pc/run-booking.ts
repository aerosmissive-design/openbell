import { CgvBookingAgent, type BookingTarget } from "./cgv-booking-agent";
import type { BookingState } from "../../src/lib/booking/types";

export type RunBookingInput = BookingTarget & {
  bookingInfo?: Record<string, string>;
  storageStatePath?: string;
  headless?: boolean;
  onStateChange?: (state: BookingState) => Promise<void>;
  onPaymentReady?: (result: { url: string; seats: string[] }) => Promise<void>;
};

/** Runs the full non-payment portion of a CGV booking. */
export async function runBooking(input: RunBookingInput) {
  const agent = new CgvBookingAgent({
    storageStatePath: input.storageStatePath,
    headless: input.headless ?? true,
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

    return await agent.goToPaymentPage(input);
  } catch (error) {
    await agent.close();
    throw error;
  }
}
