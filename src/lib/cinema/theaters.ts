import type { FormatId, TheaterId } from "./types";

export const THEATERS: {
  id: TheaterId;
  chain: "megabox" | "cgv";
  shortName: string;
  name: string;
  area: string;
  bookingUrl: string;
  formats: { id: FormatId; label: string }[];
}[] = [
  {
    id: "cgv_yongsan",
    chain: "cgv",
    shortName: "용산",
    name: "CGV 용산아이파크몰",
    area: "서울 용산",
    bookingUrl:
      "https://cgv.co.kr/cnm/movieBook/cinema?siteNo=0013&siteNm=CGV%EC%9A%A9%EC%82%B0%EC%95%84%EC%9D%B4%ED%8C%8C%ED%81%AC%EB%AA%B0",
    formats: [
      { id: "screenx", label: "스크린X" },
      { id: "4dx", label: "4DX" },
      { id: "ultra4dx", label: "울트라 4DX" },
      { id: "atmos", label: "돌비 애트모스" },
      { id: "imax", label: "IMAX" },
      { id: "other", label: "그 외 관" },
    ],
  },
  {
    id: "cgv_yeongdeungpo",
    chain: "cgv",
    shortName: "영등포",
    name: "CGV 영등포",
    area: "서울 영등포 타임스퀘어",
    bookingUrl:
      "https://cgv.co.kr/cnm/movieBook/cinema?siteNo=0059&siteNm=CGV%EC%98%81%EB%93%B1%ED%8F%AC",
    formats: [
      { id: "screenx", label: "스크린X" },
      { id: "4dx", label: "4DX" },
      { id: "atmos", label: "돌비 애트모스" },
      { id: "imax", label: "IMAX" },
      { id: "other", label: "그 외 관" },
    ],
  },
  {
    id: "megabox_coex",
    chain: "megabox",
    shortName: "코엑스",
    name: "메가박스 코엑스",
    area: "서울 강남",
    bookingUrl: "https://www.megabox.co.kr/theater/time?brchNo=1351",
    formats: [
      { id: "dolby", label: "돌비 시네마" },
      { id: "mx4d", label: "MX4D" },
      { id: "mega_led", label: "메가 LED" },
      { id: "other", label: "그 외 관" },
    ],
  },
  {
    id: "megabox_namyangju",
    chain: "megabox",
    shortName: "남양주",
    name: "메가박스 남양주",
    area: "남양주 스페이스원",
    bookingUrl: "https://www.megabox.co.kr/theater/time?brchNo=0019",
    formats: [
      { id: "dolby", label: "돌비 시네마" },
      { id: "other", label: "그 외 관" },
    ],
  },
];

export const DEFAULT_FORMATS: Record<TheaterId, FormatId[]> = {
  megabox_coex: ["dolby", "mx4d", "mega_led"],
  megabox_namyangju: ["dolby"],
  cgv_yongsan: ["screenx", "4dx", "ultra4dx", "atmos", "imax"],
  cgv_yeongdeungpo: ["screenx", "4dx", "atmos", "imax"],
};

export function theaterById(id: TheaterId) {
  const found = THEATERS.find((t) => t.id === id);
  if (!found) throw new Error(`알 수 없는 극장 ${id}`);
  return found;
}

export function formatLabel(id: FormatId): string {
  const map: Record<FormatId, string> = {
    dolby: "돌비 시네마",
    mx4d: "MX4D",
    mega_led: "메가 LED",
    screenx: "스크린X",
    "4dx": "4DX",
    ultra4dx: "울트라 4DX",
    atmos: "돌비 애트모스",
    imax: "IMAX",
    other: "일반",
  };
  return map[id];
}

export function megaboxFormats(
  kindCd: string | null | undefined,
  hallName: string,
): FormatId[] {
  const kind = (kindCd ?? "").toUpperCase();
  const hall = hallName.toUpperCase();
  const compact = hall.replace(/[\s|/._-]+/g, "");
  if (kind === "DBC" || compact.includes("DOLBY") || hall.includes("돌비")) {
    return ["dolby"];
  }
  if (kind === "MX4D" || compact.includes("MX4D")) return ["mx4d"];
  if (
    kind === "LUMINEON" ||
    compact.includes("MEGALED") ||
    compact.includes("LUMINEON") ||
    (hall.includes("메가") && compact.includes("LED"))
  ) {
    return ["mega_led"];
  }
  return ["other"];
}

export function cgvFormats(hallName: string): FormatId[] {
  const compact = hallName.toUpperCase().replace(/\s+/g, "");
  const raw = hallName.toUpperCase();
  if (
    compact.includes("ULTRA4DX") ||
    compact.includes("4DXSCREEN") ||
    raw.includes("ULTRA 4DX")
  ) {
    return ["ultra4dx"];
  }
  const out: FormatId[] = [];
  if (compact.includes("SCREENX") || hallName.includes("스크린X")) out.push("screenx");
  if (compact.includes("4DX")) out.push("4dx");
  if (compact.includes("IMAX")) out.push("imax");
  if (
    compact.includes("ATMOS") ||
    hallName.includes("애트모스") ||
    compact.includes("DOLBYATMOS")
  ) {
    out.push("atmos");
  }
  // 용산 20관 = IMAX (관 이름에 IMAX 텍스트가 없을 때)
  if (/\b20\s*관\b/.test(hallName) || compact === "20관" || compact.includes("20관")) {
    if (!out.includes("imax")) out.push("imax");
  }
  // 용산 3관 = ULTRA 4DX
  if (/\b3\s*관\b/.test(hallName) || compact === "3관" || compact.includes("3관")) {
    if (!out.includes("ultra4dx") && !out.includes("4dx")) out.push("ultra4dx");
  }
  // 용산 4관 = SCREENX (+ Atmos)
  if (/\b4\s*관\b/.test(hallName) || compact === "4관" || compact.includes("4관")) {
    if (!out.includes("screenx")) out.push("screenx");
  }
  return out.length ? out : ["other"];
}

/**
 * relay 등에서 screenName에 IMAX/SCREENX 텍스트가 없고 좌석수만 올 때 사용.
 * 용산: IMAX 624 / ULTRA4DX 144 / SCREENX(리클라이너) 192~200
 * 영등포: IMAX 387 / 4DX 144 / ATMOS 195 / SCREENX 240
 */
const CGV_CAPACITY: Partial<
  Record<TheaterId, Record<number, { hall: string; formats: FormatId[] }>>
> = {
  cgv_yeongdeungpo: {
    387: { hall: "IMAX관", formats: ["imax"] },
    144: { hall: "4DX관", formats: ["4dx"] },
    195: { hall: "4관[DOLBY ATMOS] (Laser)", formats: ["atmos"] },
    240: { hall: "SCREENX관 (리클라이너) with PRIVATE BOX", formats: ["screenx"] },
  },
  cgv_yongsan: {
    // 3관 ULTRA 4DX
    144: { hall: "ULTRA 4DX관", formats: ["ultra4dx"] },
    // 4관 SCREENX with Dolby Atmos (192 일반 + 8 프라이빗박스 = 200)
    192: { hall: "SCREENX관 (리클라이너)", formats: ["screenx", "atmos"] },
    200: { hall: "SCREENX관 (리클라이너)", formats: ["screenx", "atmos"] },
    // 20관 IMAX LASER GT — 이전에는 624가 SCREENX로 잘못 매핑되어 있었음
    624: { hall: "IMAX관", formats: ["imax"] },
  },
};

export function cgvHallFromCapacity(
  theaterId: TheaterId,
  hallName: string,
  totalSeats: number | null,
): { hall: string; formats: FormatId[] } {
  const named = hallName ? cgvFormats(hallName) : (["other"] as FormatId[]);
  if (named.some((f) => f !== "other")) {
    return { hall: hallName, formats: named };
  }
  const hit =
    totalSeats != null ? CGV_CAPACITY[theaterId]?.[totalSeats] : undefined;
  if (hit) return hit;
  return { hall: hallName || "일반", formats: ["other"] };
}
