import type { TheaterId } from "./types";

/** 여론(나무위키·익무·좌석후기) 기준. 에이전트는 이 순서로 잡고, 없으면 차순위. */
export const GOLDEN_ROWS: Record<TheaterId, { hallHint: string; rows: string[]; note: string }> = {
  cgv_yongsan: {
    hallHint: "IMAX",
    rows: ["J", "K", "I", "H", "L", "G"],
    note: "용산: 1순위 J·K 중앙, 없으면 I·H·L·G. 번호는 가운데부터.",
  },
  cgv_yeongdeungpo: {
    hallHint: "IMAX",
    rows: ["H", "I", "G", "J", "F"],
    note: "영등포: 1순위 H·I 중앙, 없으면 G·J·F. 번호는 가운데부터.",
  },
  megabox_coex: {
    hallHint: "Dolby",
    rows: ["H", "I", "G", "F", "J"],
    note: "코엑스 돌비: 1순위 H·I(애트모스)·G(화면), 없으면 F·J. 번호는 가운데부터.",
  },
  megabox_namyangju: {
    hallHint: "Dolby",
    rows: ["H", "I", "G", "J", "F"],
    note: "남양주 돌비: 1순위 H·I 중앙, 없으면 G·J·F. 번호는 가운데부터.",
  },
};

export function goldenHint(theaterId: TheaterId) {
  return GOLDEN_ROWS[theaterId]?.note ?? "중열 정중앙 우선, 없으면 옆·앞·뒤 순.";
}

export function preferredSeatHints(theaterId: TheaterId, seats: number): string[] {
  const spec = GOLDEN_ROWS[theaterId];
  const rows = spec?.rows ?? ["H", "G", "I"];
  const center = [22, 21, 23, 20, 24, 19, 25, 18, 16, 17, 15, 14, 13, 12];
  const out: string[] = [];
  for (const row of rows) {
    for (const n of center) out.push(`${row}${n}`);
    if (out.length >= seats * 8) break;
  }
  return out.slice(0, Math.max(12, seats * 6));
}
