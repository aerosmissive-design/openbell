import { cn } from "@/lib/utils";

/** 설정 화면의 일반 버튼. 선택 표시가 아닌 버튼은 이 모양만 쓴다. */
export const settingsCellClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-bg px-3 text-sm font-medium tracking-normal text-fg ring-1 ring-border";

export const settingsActionClass = cn(settingsCellClass, "w-full");

/** 여러 개 중 하나만 골랐을 때만 밝은 칸을 칠한다. */
export function settingsChoiceClass(selected: boolean) {
  return cn(settingsCellClass, "w-full", selected && "bg-pick ring-border-strong");
}
