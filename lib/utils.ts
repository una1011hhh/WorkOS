import { type ClassValue, clsx } from "clsx";
import { format } from "date-fns";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function uid(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function todayISO() {
  return format(new Date(), "yyyy-MM-dd");
}

export function hoursLabel(value: number | null | undefined) {
  const safe = Number.isFinite(value) ? Number(value) : 0;
  return safe < 1 ? `${Math.round(safe * 60)}m` : `${Number(safe.toFixed(1))}h`;
}
