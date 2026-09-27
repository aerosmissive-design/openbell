import type { TheaterId } from "./types";

/** 여론(나무위키·익무·좌석후기) 기준. 에이전트는 이 순서로 잡고, 없으면 차순위. */
export const GOLDEN_ROWS: Record<TheaterId, { hallHint: string; rows: string[]; note: string }> = {
  cgv_yongsan: {
    hallHint: "IMAX",
    rows: ["J", "K", "I", "H", "L", "G"],
    note: "용아맥: J~K열 중앙이 가장 많이 꼬힘. H~I는 몰입, L은 자막·편안. 번호는 중앙.",
  },
  cgv_yeongdeungpo: {
    hallHint: "IMAX",
    rows: ["H", "I", "G", "J", "F", "K"],
    note: "영등포 특별관: 중열 중앙. 앞열·사이드는 차순위.",
  },
  megabox_coex: {
    hallHint: "Dolby",
    rows: ["H", "I", "G", "F", "J", "E"],
    note: "코돌비: 화면은 G, 애트모스 명당은 H~I. F는 몰입 선호. L 뒤는 피함.",
  },
  megabox_namyangju: {
    hallHint: "Dolby",
    rows: ["H", "I", "G", "J", "F", "K"],
    note: "남돌비: 중열 중앙. 코돌비와 같이 H~I를 1순위로 둠.",
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
