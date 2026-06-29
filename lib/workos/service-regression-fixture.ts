import { getRangeStats } from "@/lib/workos/analytics-service";
import { getMeetingDisplayTime, toMeetingEvent } from "@/lib/workos/meeting-service";
import { getActualSeconds, isTodayCompleted } from "@/lib/workos/task-service";
import { getEffectiveSessionDuration } from "@/lib/workos/time-service";
import { Meeting, Task, TimeSession, WorkData } from "@/lib/types";

const today = "2026-06-29";
const yesterday = "2026-06-28";
const now = `${today}T12:00`;

const session = (patch: Partial<TimeSession>): TimeSession => ({
  id: "session",
  startTime: `${today}T09:00`,
  endTime: `${today}T10:00`,
  durationSeconds: 3600,
  ...patch,
});

const task = (patch: Partial<Task>): Task => ({
  id: "task",
  title: "Regression task",
  description: "",
  source: "test",
  requester: "",
  createdBy: "",
  projectId: "project",
  status: "Todo",
  priority: "P1",
  dueDate: today,
  estimatedHours: 1,
  actualHours: 99,
  createdAt: today,
  subtasks: [],
  timeTracking: {
    isRunning: false,
    startedAt: null,
    accumulatedSeconds: 0,
    lastPausedAt: null,
    sessions: [],
  },
  ...patch,
});

const meeting = (patch: Partial<Meeting>): Meeting => ({
  id: "meeting",
  title: "Regression meeting",
  date: `${today}T15:00`,
  startTime: `${today}T15:00`,
  endTime: `${today}T16:00`,
  durationMinutes: 60,
  attendees: [],
  notes: "",
  decisions: [],
  actionItems: [],
  relatedProjectId: "project",
  rawPayload: { timeSource: "manual-form-v2" },
  ...patch,
});

const taskWithSession = task({
  id: "task-with-session",
  timeTracking: {
    isRunning: false,
    startedAt: null,
    accumulatedSeconds: 0,
    lastPausedAt: null,
    sessions: [session({ id: "session-normal" })],
  },
});

const doneToday = task({ id: "task-done-today", status: "Done", completedAt: today });
const doneYesterday = task({ id: "task-done-yesterday", status: "Done", completedAt: yesterday });
const correctedSession = session({
  id: "session-corrected",
  startTime: `${today}T13:00`,
  endTime: `${today}T14:00`,
  durationSeconds: 0,
  correctedDuration: 2700,
});
const meeting1500 = meeting({ id: "meeting-1500" });
const legacyMeeting = meeting({
  id: "meeting-legacy",
  date: today,
  startTime: undefined,
  endTime: undefined,
  rawPayload: undefined,
});

const data: WorkData = {
  version: 2,
  tasks: [taskWithSession, doneToday, doneYesterday],
  projects: [{
    id: "project",
    name: "Regression project",
    type: "test",
    background: "",
    goal: "",
    status: "Active",
    priority: "P1",
    progress: 0,
    startDate: today,
    dueDate: today,
    relatedTaskIds: [],
    risks: [],
    nextAction: "",
  }],
  meetings: [meeting1500, legacyMeeting],
  reflections: [],
  reports: [],
  contacts: [],
  contactGroups: [],
};

const rangeStats = getRangeStats(data, { start: today, end: today });
const meetingEvent = toMeetingEvent(meeting1500);

export const workosServiceRegressionChecks = {
  taskWithSessionUsesTimeSessions: getActualSeconds(taskWithSession) === 3600,
  correctedDurationWins: getEffectiveSessionDuration(correctedSession) === 2700,
  doneTodayAppearsInKanbanDone: isTodayCompleted(doneToday, now),
  doneYesterdayDoesNotAppearInKanbanDone: !isTodayCompleted(doneYesterday, now),
  meeting1500DisplaysLocalTime: getMeetingDisplayTime(meeting1500) === "15:00 - 16:00",
  meeting1500StaysAt1500: meetingEvent?.startMinutesOfDay === 15 * 60,
  legacyMeetingHasNoTime: getMeetingDisplayTime(legacyMeeting) === "时间未设置",
  legacyMeetingDoesNotEnterCalendar: toMeetingEvent(legacyMeeting) === null,
  analyticsDoesNotCountLegacyMeeting: rangeStats.meetings.every(item => item.id !== legacyMeeting.id),
  analyticsTotalMatchesKinds: rangeStats.totalSeconds === rangeStats.byKind("任务") + rangeStats.byKind("会议") + rangeStats.byKind("复盘"),
};

export const assertWorkosServiceRegressionChecks = () => {
  const failures = Object.entries(workosServiceRegressionChecks).filter(([, passed]) => !passed);
  if (failures.length) throw new Error(`WorkOS service regression failed: ${failures.map(([name]) => name).join(", ")}`);
  return true;
};

