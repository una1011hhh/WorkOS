import { format, parseISO } from "date-fns";

const LOCAL_DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TZ_SUFFIX_RE = /([zZ]|[+-]\d{2}:?\d{2})$/;

export const localNow = () => format(new Date(), "yyyy-MM-dd'T'HH:mm");

export const localDate = (date = new Date()) => format(date, "yyyy-MM-dd");

export const toDateInputValue = (date: Date) => format(date, "yyyy-MM-dd");

export const parseLocalDateTime = (value?: string | null): Date | null => {
  if (!value) return null;
  const normalized = String(value).replace(" ", "T").trim();
  if (!normalized) return null;
  if (DATE_ONLY_RE.test(normalized)) return parseISO(`${normalized}T00:00`);
  if (LOCAL_DATE_TIME_RE.test(normalized) && !TZ_SUFFIX_RE.test(normalized)) return parseISO(normalized.slice(0, 16));
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const formatLocalDateTime = (value?: string | Date | null) => {
  if (!value) return "";
  const date = value instanceof Date ? value : parseLocalDateTime(value);
  return date && !Number.isNaN(date.getTime()) ? format(date, "yyyy-MM-dd'T'HH:mm") : "";
};

export const formatLocalDate = (value?: string | Date | null) => {
  if (!value) return "";
  const date = value instanceof Date ? value : parseLocalDateTime(value);
  return date && !Number.isNaN(date.getTime()) ? format(date, "yyyy-MM-dd") : "";
};

export const formatLocalTime = (value?: string | Date | null) => {
  if (!value) return "";
  const date = value instanceof Date ? value : parseLocalDateTime(value);
  return date && !Number.isNaN(date.getTime()) ? format(date, "HH:mm") : "";
};

export const combineLocalDateAndTime = (date: string, time: string) => {
  const safeDate = DATE_ONLY_RE.test(date) ? date : localDate();
  const safeTime = /^\d{2}:\d{2}$/.test(time) ? time : "09:00";
  return `${safeDate}T${safeTime}`;
};

export const buildLocalDateTimeString = (date: string, time: string) => {
  const safeDate = DATE_ONLY_RE.test(date) ? date : localDate();
  const safeTime = /^\d{2}:\d{2}(:\d{2})?$/.test(time) ? time : "09:00";
  return `${safeDate}T${safeTime.length === 5 ? `${safeTime}:00` : safeTime}`;
};

export const addLocalMinutes = (value: string | Date, minutes: number) => {
  const start = value instanceof Date ? value : parseLocalDateTime(value);
  if (!start) return "";
  return formatLocalDateTime(new Date(start.getTime() + minutes * 60000));
};

export const calculateDurationSeconds = (start?: string | null, end?: string | null) => {
  const s = parseLocalDateTime(start), e = parseLocalDateTime(end);
  if (!s || !e || e.getTime() <= s.getTime()) return 0;
  return Math.round((e.getTime() - s.getTime()) / 1000);
};

export const calculateDurationMinutes = (start?: string | null, end?: string | null) => {
  const seconds = calculateDurationSeconds(start, end);
  return seconds ? Math.max(1, Math.round(seconds / 60)) : 0;
};

export const isInvalidTimeRange = (start?: string | null, end?: string | null) => {
  const s = parseLocalDateTime(start), e = parseLocalDateTime(end);
  return !s || !e || e.getTime() <= s.getTime();
};

export const hasExplicitLocalTime = (value?: string | null) => {
  if (!value) return false;
  const normalized = String(value).replace(" ", "T").trim();
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(normalized);
};
