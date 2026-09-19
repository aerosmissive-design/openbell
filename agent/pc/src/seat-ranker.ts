/**
 * Inline seat ranker (copied/adapted from src/lib/booking/seat-ranker.ts).
 * Prefers contiguous seats near the horizontal center of each row.
 */

export type SeatPoint = {
  id: string;
  row: string;
  number: number;
  x?: number;
  y?: number;
  available: boolean;
  aisle?: boolean;
  edge?: boolean;
};

export type SeatBlock = {
  seats: SeatPoint[];
  score: number;
};

export type SeatPreference = {
  count: number;
  preferredRow?: string;
  preferredRowDistance?: number;
  allowAisle?: boolean;
  allowEdge?: boolean;
};

function rowDistance(row: string, preferred?: string): number {
  if (!preferred || row === preferred) return 0;
  const a = row.charCodeAt(0);
  const b = preferred.charCodeAt(0);
  return Math.abs(a - b);
}

export function rankSeatBlocks(seats: SeatPoint[], preference: SeatPreference): SeatBlock[] {
  const groups = new Map<string, SeatPoint[]>();
  for (const seat of seats) {
    if (!seat.available) continue;
    const list = groups.get(seat.row) ?? [];
    list.push(seat);
    groups.set(seat.row, list);
  }

  const blocks: SeatBlock[] = [];
  for (const [row, rowSeats] of groups) {
    rowSeats.sort((a, b) => a.number - b.number);
    for (let i = 0; i <= rowSeats.length - preference.count; i++) {
      const block = rowSeats.slice(i, i + preference.count);
      if (block[block.length - 1].number - block[0].number !== preference.count - 1) continue;
      if (!preference.allowAisle && block.some((s) => s.aisle)) continue;
      if (!preference.allowEdge && block.some((s) => s.edge)) continue;

      const center = block.reduce((sum, s) => sum + (s.x ?? s.number), 0) / block.length;
      const allNumbers = rowSeats.map((s) => s.x ?? s.number);
      const min = Math.min(...allNumbers);
      const max = Math.max(...allNumbers);
      const ideal = (min + max) / 2;
      const centerPenalty = Math.abs(center - ideal) * 50;
      const rowPenalty = rowDistance(row, preference.preferredRow) * 20;
      const aislePenalty = block.some((s) => s.aisle) ? 10 : 0;
      const edgePenalty = block.some((s) => s.edge) ? 20 : 0;

      blocks.push({
        seats: block,
        score: centerPenalty + rowPenalty + aislePenalty + edgePenalty,
      });
    }
  }

  return blocks.sort((a, b) => a.score - b.score);
}
