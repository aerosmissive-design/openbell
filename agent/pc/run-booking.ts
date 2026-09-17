import { CgvBookingAgent, type BookingTarget } from "./cgv-booking-agent";

export type RunBookingInput = BookingTarget & {
  bookingInfo?: Record<string, string>;
  storageStatePath?: string;
  headless?: boolean;
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
    await agent.openMovie(input);
    await agent.openShowtime(input);
    await agent.selectSeats(input);
    if (input.bookingInfo) await agent.fillBookingInfo(input.bookingInfo);
    return await agent.goToPaymentPage(input);
  } catch (error) {
    await agent.close();
    throw error;
  }
}
