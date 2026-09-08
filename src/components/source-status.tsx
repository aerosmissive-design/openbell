import { seatSourceLabel, timetableSourceLabel } from "@/lib/cinema/types";
import { cn } from "@/lib/utils";

export function SourceStatus({
  source,
  seatSource,
  ok,
  quiet = false,
}: {
  source: string;
  seatSource?: string;
  ok: boolean;
  quiet?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p
        className={cn(
          "leading-relaxed",
          quiet ? "text-xs text-faint" : "text-xs text-muted",
        )}
      >
        극장 현황 출처 : {timetableSourceLabel(source, ok)}
      </p>
      <p
        className={cn(
          "leading-relaxed",
          quiet ? "text-xs text-faint" : "text-xs text-muted",
        )}
      >
        잔여석 현황 출처 : {seatSourceLabel(seatSource)}
      </p>
    </div>
  );
}
