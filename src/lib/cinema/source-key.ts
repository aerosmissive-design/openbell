export type SeatReportStatus = "available" | "soldout" | "scrape_failed" | "offline";
export type SeatSourceType = "official" | "fallback" | "cache";

export type NormalizedSource = {
  sourceId: string;
  displayGroup: string;
};

/** G_PC:PC01 → 저장 키는 인스턴스, 전광판 묶음은 G_PC. 옛 "G_PC" 는 G_PC:unknown. */
export function normalizeSourceKey(raw?: string): NormalizedSource {
  const text = String(raw || "").trim();
  const lower = text.toLowerCase();
  let displayGroup = "G_PC";
  if (
    lower.includes("423") ||
    lower === "nas" ||
    lower === "g-nas" ||
    lower.startsWith("g_ds423") ||
    lower.startsWith("g-ds423") ||
    lower.startsWith("g-nas423")
  ) {
    displayGroup = "G_DS423+";
  } else if (
    lower.includes("225") ||
    lower.startsWith("g_ds225") ||
    lower.startsWith("g-ds225") ||
    lower.startsWith("g-nas225")
  ) {
    displayGroup = "G_DS225+";
  }
  const colon = text.indexOf(":");
  const instance = colon >= 0 ? text.slice(colon + 1).trim() : "";
  const sourceId = instance ? `${displayGroup}:${instance}` : `${displayGroup}:unknown`;
  return { sourceId, displayGroup };
}

export function seatReportStatus(restSeats: number, hinted?: string): SeatReportStatus {
  const hint = String(hinted || "").trim().toLowerCase();
  if (hint === "scrape_failed" || hint === "offline" || hint === "soldout" || hint === "available") {
    return hint;
  }
  return restSeats > 0 ? "available" : "soldout";
}

/** 공홈 > 리포터·우회 > 지난 캐시. 선택 위치는 scan-impl 의 mergeShowtimes. */
export function sourceTypeOf(seatSource?: string): SeatSourceType {
  const s = String(seatSource || "").trim().toLowerCase();
  if (!s || s === "none" || s === "last-known" || s === "cache") return "cache";
  if (s === "official" || s === "megabox" || s === "cgv") return "official";
  return "fallback";
}

export function sourceTypeRank(seatSource?: string) {
  const kind = sourceTypeOf(seatSource);
  if (kind === "official") return 3;
  if (kind === "fallback") return 2;
  return 1;
}
