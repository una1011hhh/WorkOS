import { formatLocalDate, getEffectiveSessionDuration, getRunningSeconds } from "@/lib/workos/time-service";
import { Contact, Project, Task, WorkData } from "@/lib/types";
import { todayISO } from "@/lib/utils";

export type DateRange = { start: string; end: string };

export const isCompletedStatus = (status: string | undefined) =>
  ["done", "completed", "已完成", "完成"].includes(String(status || "").trim().toLocaleLowerCase("zh-CN"));

export const getStoredTrackingSeconds = (task: Task) => {
  const sessions = task.timeTracking?.sessions || [];
  if (sessions.length) return sessions.reduce((sum, session) => sum + getEffectiveSessionDuration(session), 0);
  const accumulated = task.timeTracking?.accumulatedSeconds;
  if (accumulated !== undefined && accumulated !== null) return Math.max(0, Math.round(Number(accumulated)));
  return Math.max(0, Math.round(Number(task.actualHours || 0) * 3600));
};

export const getActualSeconds = (task: Task, now: Date | string = new Date()) =>
  getStoredTrackingSeconds(task) + (task.timeTracking?.isRunning ? getRunningSeconds(task.timeTracking.startedAt, now) : 0);

export const getActualHours = (task: Task, now: Date | string = new Date()) => getActualSeconds(task, now) / 3600;

export const getSortedSubtasks = (task: Task) => [...(task.subtasks || [])].sort((a, b) => a.order - b.order);

export const getSubtaskProgress = (task: Task) => {
  const subtasks = task.subtasks || [];
  const completed = subtasks.filter(item => item.done).length;
  return { total: subtasks.length, completed, percent: subtasks.length ? Math.round((completed / subtasks.length) * 100) : 0 };
};

export const applySubtaskCompletion = (task: Task): Task => {
  const progress = getSubtaskProgress(task);
  if ((task.autoCompleteOnSubtasksDone ?? true) && progress.total > 0 && progress.completed === progress.total) {
    return { ...task, status: "Done", completedAt: task.completedAt || todayISO(), actualHours: getActualHours(task) };
  }
  if (task.status === "Done" && progress.total > 0 && progress.completed < progress.total) {
    return { ...task, status: "Doing", completedAt: undefined };
  }
  return task;
};

export const isCompleted = (task: Task) => isCompletedStatus(task.status);

export const isTodayCompleted = (task: Task, now: Date | string = new Date()) =>
  isCompleted(task) && !!task.completedAt && formatLocalDate(task.completedAt) === formatLocalDate(now);

export const isInRange = (date: string | undefined, range: DateRange) => {
  const local = formatLocalDate(date);
  return !!local && local >= range.start && local <= range.end;
};

export const getCompletedInRange = (tasks: Task[], range: DateRange) =>
  tasks.filter(task => isCompleted(task) && isInRange(task.completedAt, range));

export const getActiveTasks = (tasks: Task[]) => tasks.filter(task => !isCompleted(task) && task.status !== "Inbox");

const contactLabel = (contact?: Contact) =>
  contact ? [contact.departmentName || contact.team, contact.role].filter(Boolean).join(" · ") || contact.email || "联系人" : "";

export const getWaitingTarget = (task: Task, contacts: Contact[]) => {
  const waitingIds = Array.from(new Set([...(task.waitingForIds || []), task.waitingForId || ""].filter(Boolean)));
  if (task.waitingForType === "contact" && waitingIds.length) {
    const people = waitingIds.map(id => contacts.find(item => item.id === id)).filter(Boolean) as Contact[];
    if (people.length) {
      const first = people[0];
      return {
        name: people.map(contact => contact.name).join("、"),
        meta: people.length > 1 ? `${people.length} 位等待人` : contactLabel(first),
        avatar: first.avatar,
        initial: first.name.slice(0, 1),
      };
    }
  }
  return { name: task.waitingFor || "未选择", meta: task.waitingFor ? "旧等待人" : "请在任务中选择联系人", initial: (task.waitingFor || "?").slice(0, 1) };
};

const priorityRank: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

export const getTaskPriorityScore = (task: Task, today = todayISO()) => {
  const priority = priorityRank[task.priority] ?? 9;
  const dueScore = task.dueDate && task.dueDate < today ? -8 : task.dueDate === today ? -5 : task.dueDate ? 0 : 4;
  const statusScore = task.status === "Doing" ? -2 : task.status === "Waiting" ? 8 : task.status === "Todo" ? 0 : 12;
  return priority * 10 + dueScore + statusScore;
};

export const sortTasksByExecutionPriority = (tasks: Task[]) =>
  [...tasks].sort((a, b) => getTaskPriorityScore(a) - getTaskPriorityScore(b) || String(a.dueDate || "9999").localeCompare(String(b.dueDate || "9999")));

export const getTaskLoggedDate = (task: Task) => task.completedAt || task.timeTracking?.lastPausedAt?.slice(0, 10) || task.createdAt;

export const getRelatedProjectTasks = (data: WorkData, project: Project) => {
  const relatedIds = new Set(project.relatedTaskIds || []);
  return data.tasks.filter(task => task.projectId === project.id || relatedIds.has(task.id));
};

export const getProjectProgress = (project: Project, tasks: Task[]) => {
  const total = tasks.length;
  const completed = tasks.filter(task => isCompleted(task)).length;
  const progress = total > 0 ? Math.round((completed / total) * 100) : project.progress;
  return { total, completed, progress: Math.max(0, Math.min(100, progress)) };
};
