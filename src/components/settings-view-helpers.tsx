import { type ReactNode, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { authEnabled, signIn, signOut } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { forgetGasLink } from "@/lib/cinema/gas-provision";
import { probeGasHealth } from "@/lib/cinema/gas-health";
import type { ScanResult, WatchConfig } from "@/lib/cinema/types";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";

export function ChannelCard({
  title,
  summary,
  detail,
  open,
  onToggle,
  children,
  embedded = false,
  flush = false,
}: {
  title: string;
  summary: string;
  detail?: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  embedded?: boolean;
  flush?: boolean;
}) {
  return (
    <div
      className={
        embedded
          ? flush
            ? "pt-3"
            : "border-t border-border pt-3"
          : "rounded-xl bg-surface p-4 shadow-border"
      }
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex min-h-11 w-full items-center justify-between gap-3 text-left"
      >
        <div className="min-w-0">
          <h2 className="text-xs font-medium tracking-[0.16em] text-muted">
            {title}
          </h2>
          <p className="mt-1 text-sm text-fg">{summary}</p>
          {detail ? (
            <p className="mt-0.5 text-[10px] leading-4 text-muted">{detail}</p>
          ) : null}
        </div>
        <span className="shrink-0 text-xs text-muted">
          {open ? "접기" : "펼치기"}
        </span>
      </button>
      {open ? <div className="mt-3 border-t border-border pt-3">{children}</div> : null}
    </div>
  );
}
