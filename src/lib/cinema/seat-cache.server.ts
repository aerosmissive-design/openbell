import { readAppMeta, writeAppMeta } from "./app-meta.server";
import type { SeatHitMap } from "./seats";

const KEY = "seat_last_known";

export async function loadSeatLastKnown(): Promise<SeatHitMap> {
  try {
    const raw = await readAppMeta(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as SeatHitMap;
  } catch {
    return {};
  }
}

export async function saveSeatLastKnown(incoming: SeatHitMap) {
  if (!Object.keys(incoming).length) return;
  const prev = await loadSeatLastKnown();
  const next: SeatHitMap = { ...prev };
  for (const [key, hit] of Object.entries(incoming)) {
    const old = next[key];
    const at = hit.at ?? Date.now();
    if (!old || (old.at ?? 0) <= at) next[key] = { ...hit, at };
  }
  const keys = Object.keys(next);
  let trimmed = next;
  if (keys.length > 2000) {
    const keep = keys
      .sort((a, b) => (next[b].at ?? 0) - (next[a].at ?? 0))
      .slice(0, 1500);
    trimmed = Object.fromEntries(keep.map((k) => [k, next[k]]));
  }
  await writeAppMeta(KEY, JSON.stringify(trimmed));
}
