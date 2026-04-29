import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, parseISO } from "date-fns";
import { sv } from "date-fns/locale";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(dateStr: string, fmt = "d MMMM yyyy"): string {
  try {
    return format(parseISO(dateStr), fmt, { locale: sv });
  } catch {
    return dateStr;
  }
}

export function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

export function dateRangeISO(daysBack: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - daysBack);
  return {
    from: from.toISOString().split("T")[0],
    to: to.toISOString().split("T")[0],
  };
}

export function minsToHoursStr(minutes: number | null): string {
  if (minutes == null) return "–";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/** Determine the "state" of a day for the heatmap calendar. */
export type DayState = "balanced" | "manic" | "depressed" | "mixed" | "nodata";

export function dayState(
  maniaScore: number,
  depressionScore: number
): DayState {
  const manic = maniaScore >= 4;
  const depressed = depressionScore >= 2;
  if (manic && depressed) return "mixed";
  if (manic) return "manic";
  if (depressed) return "depressed";
  return "balanced";
}

export const DAY_STATE_COLORS: Record<DayState, string> = {
  balanced: "#22c55e",
  manic: "#f59e0b",
  depressed: "#6366f1",
  mixed: "#ec4899",
  nodata: "#e5e7eb",
};

export const DAY_STATE_LABELS: Record<DayState, string> = {
  balanced: "Balanserad",
  manic: "Hypoman tendens",
  depressed: "Depressiv tendens",
  mixed: "Blandtillstånd",
  nodata: "Ingen data",
};
