import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

export function Switch({
  checked,
  onCheckedChange,
  label,
}: {
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  label?: string;
}) {
  return (
    <label className="flex min-h-11 items-center justify-between gap-3">
      {label ? (
        <span className="text-sm text-fg">{label}</span>
      ) : null}
      <SwitchPrimitive.Root
        checked={checked}
        onCheckedChange={onCheckedChange}
        className={cn(
          "relative h-7 w-12 shrink-0 rounded-full transition-colors duration-150",
          checked ? "bg-open" : "bg-surface-2 ring-1 ring-border",
        )}
      >
        <SwitchPrimitive.Thumb
          className={cn(
            "block size-5 translate-x-1 rounded-full transition-transform duration-150",
            checked ? "translate-x-6 bg-open-fg" : "bg-muted",
          )}
        />
      </SwitchPrimitive.Root>
    </label>
  );
}
