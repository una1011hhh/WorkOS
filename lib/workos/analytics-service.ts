import { formatLocalDate, getEffectiveSessionDuration, getRunningSeconds, parseLocalDateTime } from "@/lib/workos/time-service";
import {
  DateRange,
  getActualSeconds,
  getCompletedInRange,
  getTaskLoggedDate,
  isCompleted,
  isInRange,
} from "@/lib/workos/task-service";
import {
  getMeetingDurationMinutes,
  getMeetingsInRange,
  getMeetingStartValue,
  toMeetingEvent,
} from "@/lib/workos/meeting-service";
import { Meeting, Project, Reflection, Task, WorkData } from "@/lib/types";

export type AnalyticsEvent = {
  id: string;
  kind: "任务" | "会议" | "复盘";
  title: string;
  projectId: string;
  date: string;
  startHour: number;
  durationSeconds: number;
  task?: Task;
  meeting?: Meeting;
  reflection?: Reflection;
  color: string;
};

const localHour = (value?: string) => {
  const date = parseLocalDateTime(value);
  return date ? date.getHours() + date.getMinutes() / 60 : 0;
};

export const getAnalyticsEvents = (data: WorkData, range: DateRange): AnalyticsEvent[] => {
  const taskEvents = data.tasks.flatMap(task => {
    const seen = new Set<string>();
    const sessions = task.timeTracking?.sessions || [];
    const realSessions = sessions.filter(session => {
      const startTime = session.correctedStartTime || session.startTime;
      const duration = getEffectiveSessionDuration(session);
      const key = [task.id, session.originalStartTime, session.originalEndTime, session.originalDuration, session.startTime, session.endTime, session.correctedStartTime, session.correctedEndTime, duration].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return isInRange(startTime, range);
    }).map((session, index) => {
      const startTime = session.correctedStartTime || session.startTime;
      const duration = getEffectiveSessionDuration(session);
      return { id: `${task.id}-s-${index}`, kind: "任务" as const, title: task.title, projectId: task.projectId, date: formatLocalDate(startTime), startHour: localHour(startTime), durationSeconds: duration, task, color: "#5b7cfa" };
    });
    const running = task.timeTracking?.isRunning && task.timeTracking.startedAt && isInRange(task.timeTracking.startedAt, range)
      ? [{ id: `${task.id}-running`, kind: "任务" as const, title: task.title, projectId: task.projectId, date: formatLocalDate(task.timeTracking.startedAt), startHour: localHour(task.timeTracking.startedAt), durationSeconds: getRunningSeconds(task.timeTracking.startedAt), task, color: "#5b7cfa" }]
      : [];
    return [...realSessions, ...running];
  });
  const meetingEvents = data.meetings.flatMap(meeting => {
    const event = toMeetingEvent(meeting);
    if (!event || !isInRange(event.dayKey, range) || event.durationMinutes <= 0) return [];
    return [{ id: meeting.id, kind: "会议" as const, title: meeting.title, projectId: meeting.relatedProjectId, date: event.dayKey, startHour: event.startMinutesOfDay / 60, durationSeconds: event.durationMinutes * 60, meeting, color: "#8a63d2" }];
  });
  const reflectionEvents = data.reflections
    .filter(reflection => isInRange(reflection.date, range) && (reflection.durationMinutes || 0) > 0)
    .map(reflection => ({ id: reflection.id, kind: "复盘" as const, title: reflection.title, projectId: reflection.relatedProjectId, date: reflection.date, startHour: 17, durationSeconds: (reflection.durationMinutes || 0) * 60, reflection, color: "#e86cae" }));
  return [...taskEvents, ...meetingEvents, ...reflectionEvents].filter(event => event.durationSeconds > 0);
};

export const getRangeStats = (data: WorkData, range: DateRange) => {
  const tasks = data.tasks.filter(task => isInRange(task.createdAt, range) || isInRange(task.completedAt, range) || isInRange(getTaskLoggedDate(task), range));
  const completed = getCompletedInRange(data.tasks, range);
  const overdue = data.tasks.filter(task => !isCompleted(task) && !!task.dueDate && task.dueDate < range.end);
  const waiting = data.tasks.filter(task => task.status === "Waiting");
  const meetings = getMeetingsInRange(data.meetings, range);
  const reflections = data.reflections.filter(reflection => isInRange(reflection.date, range));
  const events = getAnalyticsEvents(data, range);
  const taskSecondsInRange = tasks.filter(task => isInRange(getTaskLoggedDate(task), range)).reduce((sum, task) => sum + getActualSeconds(task), 0);
  const meetingSeconds = meetings.reduce((sum, meeting) => sum + getMeetingDurationMinutes(meeting) * 60, 0);
  const reflectionSeconds = reflections.reduce((sum, reflection) => sum + (reflection.durationMinutes || 0) * 60, 0);
  const totalSeconds = taskSecondsInRange + meetingSeconds + reflectionSeconds;
  const projectSeconds = data.projects.map(project => {
    const projectTasks = tasks.filter(task => task.projectId === project.id);
    const seconds = projectTasks.filter(task => isInRange(getTaskLoggedDate(task), range)).reduce((sum, task) => sum + getActualSeconds(task), 0)
      + meetings.filter(meeting => meeting.relatedProjectId === project.id).reduce((sum, meeting) => sum + getMeetingDurationMinutes(meeting) * 60, 0)
      + reflections.filter(reflection => reflection.relatedProjectId === project.id).reduce((sum, reflection) => sum + (reflection.durationMinutes || 0) * 60, 0);
    return { project, seconds, tasks: projectTasks };
  }).filter(row => row.seconds > 0 || row.tasks.length).sort((a, b) => b.seconds - a.seconds);
  const byKind = (kind: AnalyticsEvent["kind"]) => kind === "任务" ? taskSecondsInRange : kind === "会议" ? meetingSeconds : reflectionSeconds;
  return { tasks, completed, overdue, waiting, meetings, reflections, events, totalSeconds, projectSeconds, byKind };
};

export type RangeStats = ReturnType<typeof getRangeStats>;

export const getExecutiveSummary = (data: WorkData, range: DateRange) => {
  const stats = getRangeStats(data, range);
  const created = data.tasks.filter(task => isInRange(task.createdAt, range));
  const completionRate = created.length ? stats.completed.length / created.length * 100 : 0;
  return { ...stats, completionRate, averageTaskSeconds: stats.completed.length ? stats.completed.reduce((sum, task) => sum + getActualSeconds(task), 0) / stats.completed.length : 0 };
};

export const getTimeAllocation = (data: WorkData, range: DateRange) => {
  const stats = getRangeStats(data, range);
  return { projectSeconds: stats.projectSeconds, taskSeconds: stats.byKind("任务"), meetingSeconds: stats.byKind("会议"), reflectionSeconds: stats.byKind("复盘"), totalSeconds: stats.totalSeconds };
};

export const getTaskAnalytics = (data: WorkData, range: DateRange) => {
  const stats = getRangeStats(data, range);
  const created = data.tasks.filter(task => isInRange(task.createdAt, range));
  return {
    completed: stats.completed,
    completionRate: created.length ? stats.completed.length / created.length * 100 : 0,
    waiting: stats.waiting,
    overdue: stats.overdue,
    highPriorityOpen: stats.tasks.filter(task => !isCompleted(task) && ["P0", "P1"].includes(task.priority)).length,
    averageTaskSeconds: stats.completed.length ? stats.completed.reduce((sum, task) => sum + getActualSeconds(task), 0) / stats.completed.length : 0,
  };
};

export const getMeetingAnalytics = (data: WorkData, range: DateRange) => {
  const meetings = getMeetingsInRange(data.meetings, range);
  const totalSeconds = meetings.reduce((sum, meeting) => sum + getMeetingDurationMinutes(meeting) * 60, 0);
  return { meetings, totalSeconds, averageSeconds: meetings.length ? totalSeconds / meetings.length : 0 };
};

export const getProjectTimeStats = (data: WorkData, range: DateRange) => getRangeStats(data, range).projectSeconds;

export const getTopTasksByDuration = (data: WorkData, range: DateRange, limit = 5) =>
  getRangeStats(data, range).tasks.sort((a, b) => getActualSeconds(b) - getActualSeconds(a)).slice(0, limit);

export const getTopMeetingsByDuration = (data: WorkData, range: DateRange, limit = 5) =>
  getRangeStats(data, range).meetings.sort((a, b) => getMeetingDurationMinutes(b) - getMeetingDurationMinutes(a)).slice(0, limit);

export const getProjectTotalSeconds = (project: Project, tasks: Task[]) =>
  tasks.filter(task => task.projectId === project.id || project.relatedTaskIds?.includes(task.id)).reduce((sum, task) => sum + getActualSeconds(task), 0);

export const getMeetingStartDate = (meeting: Meeting) => formatLocalDate(getMeetingStartValue(meeting));
