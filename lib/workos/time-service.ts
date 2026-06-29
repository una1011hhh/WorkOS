import {
  addLocalMinutes,
  buildLocalDateTimeString,
  calculateDurationMinutes,
  calculateDurationSeconds,
  combineLocalDateAndTime,
  formatLocalDate,
  formatLocalDateTime,
  formatLocalTime,
  hasExplicitLocalTime,
  isInvalidTimeRange,
  localDate,
  localNow,
  parseLocalDateTime,
} from "@/lib/time";
import { TimeSession } from "@/lib/types";

export {
  addLocalMinutes,
  buildLocalDateTimeString,
  calculateDurationMinutes,
  calculateDurationSeconds,
  combineLocalDateAndTime,
  formatLocalDate,
  formatLocalDateTime,
  formatLocalTime,
  hasExplicitLocalTime,
  isInvalidTimeRange,
  localDate,
  localNow,
  parseLocalDateTime,
};

export const normalizeLocalDateTime = (value?: string | Date | null) => formatLocalDateTime(value);

export const getRunningSeconds = (startedAt?: string | null, now: Date | string = new Date()) => {
  const start = parseLocalDateTime(startedAt);
  const end = now instanceof Date ? now : parseLocalDateTime(now);
  if (!start || !end || end.getTime() <= start.getTime()) return 0;
  return Math.floor((end.getTime() - start.getTime()) / 1000);
};

export const getSessionStart = (session: TimeSession) => session.correctedStartTime || session.startTime;

export const getSessionEnd = (session: TimeSession) => session.correctedEndTime || session.endTime;

export const getSessionOriginalStart = (session: TimeSession) => session.originalStartTime || session.startTime;

export const getSessionOriginalEnd = (session: TimeSession) => session.originalEndTime || session.endTime;

export const getSessionOriginalDuration = (session: TimeSession) =>
  Math.max(0, Math.round(Number(session.originalDuration ?? session.durationSeconds ?? 0)));

export const getEffectiveSessionDuration = (session: TimeSession) => {
  const correctedRangeSeconds = session.correctedStartTime && session.correctedEndTime
    ? calculateDurationSeconds(session.correctedStartTime, session.correctedEndTime)
    : 0;
  if (correctedRangeSeconds > 0) return correctedRangeSeconds;

  const correctedDuration = Math.round(Number(session.correctedDuration ?? 0));
  if (correctedDuration > 0) return correctedDuration;

  const rangeSeconds = calculateDurationSeconds(session.startTime, session.endTime);
  if (rangeSeconds > 0) return rangeSeconds;

  return Math.max(0, Math.round(Number(session.durationSeconds ?? 0)));
};

export const isSuspectedForgotToStop = (session: TimeSession) =>
  Boolean(session.suspectedForgotToStop) || getSessionOriginalDuration(session) >= 8 * 3600;

export const formatDurationLabel = (seconds: number) => {
  const safe = Math.max(0, Math.floor(seconds));
  if (safe === 0) return "未计时";
  if (safe > 0 && safe < 60) return "少于 1 分钟";
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  return [h, m, s].map(v => String(v).padStart(2, "0")).join(":");
};
