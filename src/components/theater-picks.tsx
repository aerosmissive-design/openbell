import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { THEATERS } from "@/lib/cinema/theaters";
import type { ScanResult, TheaterId } from "@/lib/cinema/types";
import { SEAT_SOURCE_COLUMNS, seatSourceLabel, timetableSourceLabel } from "@/lib/cinema/types";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { SourceStatus } from "./source-status";
import { ServerStatusBoard } from "./server-status";

/** UI-LOCK: 감시극장 아래 출처 표·라벨은 지시 없이 제거 금지. 칸을 늘리는 것만 허용. */
const SOURCE_COLS = SEAT_SOURCE_COLUMNS;
