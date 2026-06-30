import {
  addLocalMinutes,
  calculateDurationMinutes,
  formatLocalDate,
  formatLocalTime,
  hasExplicitLocalTime,
  parseLocalDateTime,
} from "@/lib/workos/time-service";
import { Meeting } from "@/lib/types";
import { DateRange, isInRange } from "@/lib/workos/task-service";

export type MeetingEvent = {
  id: string;
  title: string;
  meeting: Meeting;
  localStart: Date;
  localEnd: Date;
  durationMinutes: number;
  dayKey: string;
  startMinutesOfDay: number;
  endMinutesOfDay: number;
  displayedTime: string;
};

const rawObject = (value: unknown) => value && typeof value === "object" ? value as Record<string, any> : {};

const hasExplicitOffHoursTime = (meeting: Meeting) => {
  const raw = rawObject(meeting.rawPayload);
  return meeting.manualTimeOverride === true || raw.manualTimeOverride === true || raw.timeSource === "manual-form-v2" || Boolean(raw.start_time?.timestamp);
};

const getRawStart = (meeting: Meeting) => {
  if (meeting.startTime) return meeting.startTime;
  if (meeting.date && hasExplicitLocalTime(meeting.date)) return meeting.date;
  return "";
};

const getRawEnd = (meeting: Meeting, rawStart: string) => {
  if (meeting.endTime) return meeting.endTime;
  if (rawStart && meeting.durationMinutes && meeting.durationMinutes > 0) return addLocalMinutes(rawStart, meeting.durationMinutes);
  return "";
};

export const toMeetingEvent = (meeting: Meeting): MeetingEvent | null => {
  const rawStart = getRawStart(meeting);
  const rawEnd = getRawEnd(meeting, rawStart);
  if (!rawStart || !rawEnd) return null;

  const localStart = parseLocalDateTime(rawStart);
  const localEnd = parseLocalDateTime(rawEnd);
  if (!localStart || !localEnd || localEnd.getTime() <= localStart.getTime()) return null;

  const durationMinutes = calculateDurationMinutes(rawStart, rawEnd);
  const startMinutesOfDay = localStart.getHours() * 60 + localStart.getMinutes();
  const endMinutesOfDay = localEnd.getHours() * 60 + localEnd.getMinutes();
  const isOffHours = startMinutesOfDay < 8 * 60 || startMinutesOfDay >= 22 * 60;
  if (isOffHours && !hasExplicitOffHoursTime(meeting)) return null;

  return {
    id: meeting.id,
    title: meeting.title,
    meeting,
    localStart,
    localEnd,
    durationMinutes,
    dayKey: formatLocalDate(localStart),
    startMinutesOfDay,
    endMinutesOfDay,
    displayedTime: `${formatLocalTime(localStart)} - ${formatLocalTime(localEnd)}`,
  };
};

export const getMeetingTimeRange = (meeting: Meeting) => toMeetingEvent(meeting)?.displayedTime || "时间未设置";

export const getMeetingDurationMinutes = (meeting: Meeting) => toMeetingEvent(meeting)?.durationMinutes || 0;

export const isMeetingInRange = (meeting: Meeting, range: DateRange) => {
  const event = toMeetingEvent(meeting);
  return !!event && isInRange(event.dayKey, range);
};

export const getMeetingsInRange = (meetings: Meeting[], range: DateRange) =>
  meetings.filter(meeting => isMeetingInRange(meeting, range));

export const getMeetingDayKey = (meeting: Meeting) => toMeetingEvent(meeting)?.dayKey || "";

export const getCalendarPosition = (meeting: Meeting) => {
  const event = toMeetingEvent(meeting);
  if (!event) return null;
  return {
    topPercent: ((event.startMinutesOfDay - 8 * 60) / ((22 - 8) * 60)) * 100,
    heightPercent: Math.max(7, (event.durationMinutes / ((22 - 8) * 60)) * 100),
    startMinutesOfDay: event.startMinutesOfDay,
    endMinutesOfDay: event.endMinutesOfDay,
    durationMinutes: event.durationMinutes,
  };
};

export const getMeetingDisplayTime = (meeting: Meeting) => getMeetingTimeRange(meeting);

export const hasMeetingTime = (meeting: Meeting) => Boolean(toMeetingEvent(meeting));

export const getMeetingStartValue = (meeting: Meeting) => toMeetingEvent(meeting) ? getRawStart(meeting) : "";
