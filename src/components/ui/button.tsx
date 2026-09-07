import { cn } from "@/lib/utils";
import type { ButtonHTMLAttributes } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "outline" | "danger";
  size?: "sm" | "md";
};

export function Button({
  className,
  variant = "primary",
  size = "md",
  type = "button",
  ...props
}: Props) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium tracking-tight",
        "transition-[transform,background-color,opacity] duration-150 ease-out",
        "active:not-disabled:scale-[0.96] disabled:opacity-40",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70",
        size === "md" ? "min-h-11 px-4 text-sm" : "min-h-9 px-3 text-xs",
        variant === "primary" &&
          "bg-pick text-fg ring-1 ring-border-strong",
        variant === "ghost" && "bg-transparent text-fg hover:bg-surface-2",
        variant === "outline" &&
          "bg-transparent text-fg ring-1 ring-border-strong",
        variant === "danger" && "bg-danger text-fg",
        className,
      )}
      {...props}
    />
  );
}
