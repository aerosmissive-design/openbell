import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Showtime, TheaterId } from "./types";
import { THEATERS } from "./theaters";
import { mergeShowtimes } from "./seats";

const IDS: TheaterId[] = [
  "cgv_yongsan",
  "cgv_yeongdeungpo",
  "megabox_coex",
  "megabox_namyangju",
];

export type BoardTheaterBlock = {
  theaterId: TheaterId;
  theaterName: string;
  source: string;
  reportedAt: string | null;
  count: number;
  showtimes: Showtime[];
};

export type BoardPayload = {
  scannedAt: string;
  theaters: BoardTheaterBlock[];
};

/**
 * 전광판 전용: PC Reporter / NAS 등이 /api/seat-report 로 넣은 데이터를
 * 신선도와 무관하게 읽어 취합한다. 공홈 전체 스캔은 하지 않는다.
 */
export const loadBoardData = createServerFn({ method: "POST" })
  .validator(
    z.object({
      theaters: z
        .array(
          z.enum([
            "cgv_yongsan",
            "cgv_yeongdeungpo",
            "megabox_coex",
            "megabox_namyangju",
          ]),
        )
        .optional(),
    }),
  )
  .handler(async ({ data }): Promise<BoardPayload> => {
    const { readNasSeatmap } = await import("./nas.server");
    const { readAppMeta } = await import("./app-meta.server");
    const wanted = (data.theaters?.length ? data.theaters : IDS) as TheaterId[];

    // maxAgeMs: 0 → 오래된 리포트도 표시 (전광판은 "마지막 성공값 유지")
    const packed = await readNasSeatmap(wanted, { maxAgeMs: 0 });

    const byTheater = new Map<TheaterId, Showtime[]>();
    for (const id of wanted) byTheater.set(id, []);
    for (const row of packed.showtimes) {
      const list = byTheater.get(row.theaterId as TheaterId);
      if (list) list.push(row);
    }

    const blocks: BoardTheaterBlock[] = [];
    for (const id of wanted) {
      const meta = THEATERS.find((t) => t.id === id);
      let reportedAt: string | null = null;
      let source = "none";
      try {
        const raw = await readAppMeta(`nas_seats:${id}`);
        if (raw) {
          const parsed = JSON.parse(raw) as { at?: number; source?: string };
          if (parsed.at) reportedAt = new Date(parsed.at).toISOString();
          const s = String(parsed.source || "pc").toLowerCase();
          source =
            s === "nas423"
              ? "g-nas423+"
              : s === "nas225"
                ? "g-nas225+"
                : s === "nas"
                  ? "g-nas"
                  : s === "pc"
                    ? "g-pc"
                    : s;
        }
      } catch {}

      const rows = (byTheater.get(id) || [])
        .slice()
        .sort((a, b) =>
          `${a.playDate}${a.startTime}`.localeCompare(`${b.playDate}${b.startTime}`),
        );

      const merged = mergeShowtimes([], rows);

      blocks.push({
        theaterId: id,
        theaterName: meta?.name || id,
        source,
        reportedAt,
        count: merged.length,
        showtimes: merged,
      });
    }

    return { scannedAt: new Date().toISOString(), theaters: blocks };
  });
