import { readAppMeta, writeAppMeta } from "./app-meta.server";
import {
  cgvRelayWatchPublic,
  cgvTheatersMissingSeats,
  nextCgvRelayWatch,
  parseCgvRelayWatch,
  type CgvRelayWatchState,
} from "./relay-watch";
import type { TheaterScan } from "./types";

const META_KEY = "cgv_relay_watch";

async function readState(): Promise<CgvRelayWatchState> {
  const raw = await readAppMeta(META_KEY);
  if (!raw) return parseCgvRelayWatch(null);
  try {
    return parseCgvRelayWatch(JSON.parse(raw));
  } catch {
    return parseCgvRelayWatch(null);
  }
}

export async function readCgvRelayWatch(now = Date.now()) {
  return cgvRelayWatchPublic(await readState(), now);
}

export async function noteCgvRelayHealth(theaters: TheaterScan[], now = Date.now()) {
  const prev = await readState();
  const missing = cgvTheatersMissingSeats(theaters);
  const next = nextCgvRelayWatch(prev, missing, now);
  await writeAppMeta(META_KEY, JSON.stringify(next.state));
  return {
    ...cgvRelayWatchPublic(next.state, now),
    shouldAlert: next.shouldAlert,
  };
}
