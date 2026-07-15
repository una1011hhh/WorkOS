"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Archive, ArrowDown, ArrowRight, ArrowUp, BarChart3, Bell, BookOpen, Brain, CalendarDays, Check, CheckCircle2,
  ChevronDown, Circle, Clipboard, Clock3, Download, FileText, FolderKanban, Inbox, LayoutDashboard,
  ListTodo, Menu, MoreHorizontal, Pause, Play, Plus, RefreshCw, Save, Search, Settings, Sparkles,
  Target, Timer, Trash2, Users, X, Zap,
} from "lucide-react";
import { addDays, addWeeks, endOfMonth, endOfQuarter, endOfWeek, format, isBefore, parseISO, startOfMonth, startOfQuarter, startOfWeek, subDays } from "date-fns";
import { zhCN } from "date-fns/locale";
import { cn, hoursLabel, todayISO, uid } from "@/lib/utils";
import { Contact, Meeting, Priority, Project, ProjectStatus, Reflection, ReflectionType, Report, ReportOptions, ReportType, Task, TaskStatus, TimeSession, WorkData } from "@/lib/types";
import { seedData } from "@/lib/seed";
import { hasLocalWorkData, localWorkDataRepository } from "@/lib/storage";
import { generateReportContent } from "@/lib/report";
import { useAuth } from "@/lib/auth/auth-context";
import { createWorkDataRepository } from "@/repositories/workDataRepository";
import { RepositoryMode, WorkDataEntity } from "@/repositories/work-data-repository";
import {
  addLocalMinutes,
  buildLocalDateTimeString,
  calculateDurationMinutes,
  calculateDurationSeconds,
  formatDurationLabel,
  formatLocalDate,
  formatLocalDateTime,
  formatLocalTime,
  getEffectiveSessionDuration,
  getRunningSeconds,
  getSessionEnd,
  getSessionOriginalDuration,
  getSessionOriginalEnd,
  getSessionOriginalStart,
  getSessionStart,
  isInvalidTimeRange,
  isSuspectedForgotToStop as serviceIsSuspectedForgotToStop,
  localNow,
  parseLocalDateTime,
} from "@/lib/workos/time-service";
import {
  applySubtaskCompletion as serviceApplySubtaskCompletion,
  getActualHours,
  getActualSeconds,
  getProjectProgress,
  getRelatedProjectTasks,
  getSortedSubtasks,
  getStoredTrackingSeconds,
  getSubtaskProgress,
  getTaskLoggedDate,
  getWaitingTarget,
  isCompletedStatus,
  isTodayCompleted,
  sortTasksByExecutionPriority,
} from "@/lib/workos/task-service";
import {
  getMeetingDisplayTime,
  getMeetingDurationMinutes,
  getMeetingStartValue,
  toMeetingEvent,
  hasMeetingTime,
  type MeetingEvent as CalendarEvent,
} from "@/lib/workos/meeting-service";
import {
  getAnalyticsEvents,
  getExecutiveSummary,
  getMeetingAnalytics,
  getRangeStats,
  getTaskAnalytics,
  getTimeAllocation,
  getTopMeetingsByDuration,
  getTopTasksByDuration,
  type AnalyticsEvent,
} from "@/lib/workos/analytics-service";

type View = "today" | "inbox" | "tasks" | "projects" | "meetings" | "waiting" | "contacts" | "log" | "weekly" | "reports" | "analytics" | "workAnalytics" | "thinking" | "display";
type Modal = "capture" | "task" | "project" | "meeting" | "reflection" | "settings" | null;
type FontScale = "small" | "normal" | "large" | "extra-large";
type ContentWidth = "compact" | "standard" | "wide" | "full";
type Density = "compact" | "standard" | "comfortable";
type DisplaySettings = { fontScale: FontScale; contentWidth: ContentWidth; density: Density };
type AnalyticsDetailKind = "time" | "tasks" | "meetings" | "reflections" | "meetingProjects" | "meetingAttendees";
type DashboardDetailKind = "focus" | "today" | "timeline" | "risks" | "projects" | "insights";

const DISPLAY_SETTINGS_KEY = "workos-display-settings-v1";
const defaultDisplaySettings: DisplaySettings = { fontScale: "normal", contentWidth: "standard", density: "compact" };
const isFontScale = (value: unknown): value is FontScale => ["small", "normal", "large", "extra-large"].includes(String(value));
const isContentWidth = (value: unknown): value is ContentWidth => ["compact", "standard", "wide", "full"].includes(String(value));
const isDensity = (value: unknown): value is Density => ["compact", "standard", "comfortable"].includes(String(value));
const loadDisplaySettings = (): DisplaySettings => {
  if (typeof window === "undefined") return defaultDisplaySettings;
  try {
    const raw = window.localStorage.getItem(DISPLAY_SETTINGS_KEY);
    if (!raw) return defaultDisplaySettings;
    const parsed = JSON.parse(raw) as Partial<DisplaySettings>;
    return {
      fontScale: isFontScale(parsed.fontScale) ? parsed.fontScale : defaultDisplaySettings.fontScale,
      contentWidth: isContentWidth(parsed.contentWidth) ? parsed.contentWidth : defaultDisplaySettings.contentWidth,
      density: isDensity(parsed.density) ? parsed.density : defaultDisplaySettings.density,
    };
  } catch {
    return defaultDisplaySettings;
  }
};

const nav: { group: string; items: { id: View; label: string; icon: typeof Inbox }[] }[] = [
  { group: "工作台", items: [{ id: "today", label: "今日概览", icon: LayoutDashboard }, { id: "inbox", label: "收集箱", icon: Inbox }, { id: "tasks", label: "任务中心", icon: ListTodo }, { id: "projects", label: "项目中心", icon: FolderKanban }, { id: "meetings", label: "会议中心", icon: CalendarDays }, { id: "waiting", label: "等待看板", icon: Clock3 }] },
  { group: "协作中心", items: [{ id: "contacts", label: "联系人", icon: Users }] },
  { group: "复盘与沉淀", items: [{ id: "log", label: "工作日志", icon: BookOpen }, { id: "weekly", label: "每周复盘", icon: FileText }, { id: "reports", label: "报告中心", icon: Clipboard }] },
  { group: "洞察", items: [{ id: "analytics", label: "工时分析", icon: BarChart3 }, { id: "workAnalytics", label: "工作分析中心", icon: Sparkles }, { id: "thinking", label: "思考空间", icon: Brain }] },
  { group: "系统", items: [{ id: "display", label: "显示设置", icon: Settings }] },
];
const viewMeta: Record<View, { title: string; subtitle: string }> = {
  today: { title: "早上好，专注于重要的事", subtitle: "这是你的每日工作简报，而不只是任务清单。" }, inbox: { title: "收集箱", subtitle: "先记录，稍后再决定如何处理。" },
  tasks: { title: "任务中心", subtitle: "让所有承诺都可见、可追踪。" }, projects: { title: "项目中心", subtitle: "项目不是标签，而是一份持续生长的工作档案。" },
  meetings: { title: "会议中心", subtitle: "把讨论变成决策，把决策变成行动。" }, waiting: { title: "等待看板", subtitle: "你的工作停在哪里，一眼看清。" },
  contacts: { title: "联系人", subtitle: "维护 WorkOS 原生联系人，用于任务、等待人和会议参与人。" }, log: { title: "工作日志", subtitle: "每天做过什么，由系统替你记住。" },
  weekly: { title: "每周复盘", subtitle: "从真实工作记录中生成，而不是靠回忆拼凑。" }, reports: { title: "报告中心", subtitle: "将任务、项目与复盘组织成有逻辑的工作报告。" },
  analytics: { title: "工时分析", subtitle: "认识自己的工作节奏，让预估越来越准。" }, workAnalytics: { title: "工作分析中心", subtitle: "从周、月和项目维度看清时间、产出与风险。" },
  thinking: { title: "思考空间", subtitle: "让复盘回到它所发生的项目和任务中。" },
  display: { title: "显示设置", subtitle: "让字体、内容宽度和页面密度适配你的屏幕。" },
};
const projectName = (projects: Project[], id: string) => projects.find(p => p.id === id)?.name || "未关联项目";
const defaultReportOptions: ReportOptions = { reflections: true, projectProgress: true, timeStats: true, waiting: true, nextPlan: true };
const NEW_PROJECT_VALUE = "__new_project__";
const normalizeSearch = (value: unknown) => String(value ?? "").toLocaleLowerCase("zh-CN").trim();
const flattenSearchValues = (values: unknown[]): unknown[] => values.flatMap(v => Array.isArray(v) ? flattenSearchValues(v) : [v]);
const fuzzyMatch = (query: string, values: unknown[]) => {
  const q = normalizeSearch(query);
  if (!q) return true;
  const haystack = normalizeSearch(flattenSearchValues(values).join(" "));
  return haystack.includes(q) || q.split(/\s+/).filter(Boolean).every(part => haystack.includes(part));
};
const taskSearchFields = (task: Task, data: WorkData) => [task.title, task.description, task.subtasks?.map(item => item.title), projectName(data.projects, task.projectId), task.requester, task.createdBy, task.source, task.waitingFor, task.waitingReason, task.followUpDate, task.status, task.priority];
const projectSearchFields = (project: Project, data: WorkData) => [project.name, project.type, project.background, project.goal, project.status, project.priority, project.risks, project.nextAction, data.tasks.filter(t => t.projectId === project.id).map(t => [t.title, t.description, t.requester, t.source, t.subtasks?.map(item => item.title)])];
const meetingSearchFields = (meeting: Meeting, data: WorkData) => [meeting.title, meeting.notes, meeting.attendees, meeting.decisions, meeting.actionItems.map(a => [a.text, a.owner]), projectName(data.projects, meeting.relatedProjectId)];
const reflectionSearchFields = (reflection: Reflection, data: WorkData) => [reflection.title, reflection.content, reflection.type, reflection.tags, projectName(data.projects, reflection.relatedProjectId), data.tasks.find(t => t.id === reflection.relatedTaskId)?.title];
const reportSearchFields = (report: Report) => [report.title, report.type, report.startDate, report.endDate, report.generatedContent];
const contactSearchFields = (contact: Contact) => [contact.name, rawObject(contact).displayName, contact.role, contact.team, contact.departmentName, contact.company, contact.email, contact.phone, contact.notes];
const uniqueNames = (names: string[]) => Array.from(new Set(names.map(n => n.trim()).filter(Boolean)));
const serializeMeetingActions = (actions: Meeting["actionItems"]) => actions.filter(a => a.text.trim()).map(a => `${a.text.trim()} | ${(a.owner || "我").trim()} | ${(a.dueDate || todayISO()).trim()}`).join("\n");
const parseMeetingActions = (text: string, existing: Meeting["actionItems"] = []) => text.split("\n").map(line => line.trim()).filter(Boolean).map((line, i) => {
  const [rawText, rawOwner, rawDueDate] = line.split("|").map(x => x.trim());
  return { id: existing[i]?.id || uid("action"), text: rawText || "未命名行动项", owner: rawOwner || "我", dueDate: rawDueDate || todayISO(), taskId: existing[i]?.taskId };
});
const nextWeekdayDate = (weekday: number) => {
  const d = new Date();
  const delta = (weekday + 7 - d.getDay()) % 7 || 7;
  d.setDate(d.getDate() + delta);
  return formatLocalDate(d);
};
const dueDateFromText = (text: string) => {
  const iso = text.match(/20\d{2}[-/年.]\d{1,2}[-/月.]\d{1,2}/)?.[0];
  if (iso) {
    const parts = iso.replace(/[年月/.]/g, "-").replace(/日/g, "").split("-").map(v => v.padStart(2, "0"));
    return `${parts[0]}-${parts[1]}-${parts[2]}`;
  }
  if (/明天/.test(text)) return formatLocalDate(addDays(new Date(), 1));
  if (/下周三/.test(text)) return nextWeekdayDate(3);
  if (/周五|星期五/.test(text)) return nextWeekdayDate(5);
  if (/月底|月末/.test(text)) return format(endOfMonth(new Date()), "yyyy-MM-dd");
  return "";
};
const extractActionsFromNotes = (notes: string): Meeting["actionItems"] => notes.split(/[。；;\n]/).map(s => s.trim()).filter(Boolean).map(sentence => {
  const owner = sentence.match(/由(.+?)(?:负责|推进|处理|确认|整理|完成)/)?.[1]?.trim() || sentence.match(/(.+?)(?:负责|推进)/)?.[1]?.trim() || "";
  const dueDate = dueDateFromText(sentence);
  const text = sentence.replace(/本周|下周|月底|月末|前|完成|负责|推进|由|确认/g, "").replace(owner, "").trim();
  return text && (owner || dueDate) ? { id: uid("action"), text: text.slice(0, 40), owner: owner || "我", dueDate: dueDate || todayISO() } : null;
}).filter(Boolean) as Meeting["actionItems"];
const dateOnly = (value: string | Date) => value instanceof Date ? formatLocalDate(value) : (formatLocalDate(value) || value.slice(0, 10));
const toDateTimeLocal = (value?: string) => formatLocalDateTime(value);
const localDateTime = (value?: string) => parseLocalDateTime(value) || parseISO(`${todayISO()}T00:00`);
const localHour = (value?: string) => {
  const date = parseLocalDateTime(value);
  return date ? date.getHours() + date.getMinutes() / 60 : 0;
};
const inDateRange = (date: string | undefined, start: string, end: string) => {
  const local = formatLocalDate(date);
  return !!local && local >= start && local <= end;
};
const daysBetween = (start: string, end: string) => Math.max(1, Math.round((parseISO(end).getTime() - parseISO(start).getTime()) / 86400000) + 1);
const runningSeconds = (task: Task) => task.timeTracking?.isRunning ? getRunningSeconds(task.timeTracking.startedAt) : 0;
const sessionDuration = getEffectiveSessionDuration;
const sessionStart = getSessionStart;
const sessionEnd = getSessionEnd;
const sessionOriginalStart = getSessionOriginalStart;
const sessionOriginalEnd = getSessionOriginalEnd;
const sessionOriginalDuration = getSessionOriginalDuration;
const isSuspectedForgotToStop = serviceIsSuspectedForgotToStop;
const computedSessionDuration = calculateDurationSeconds;
const recalcTrackingSeconds = getStoredTrackingSeconds;
const taskSeconds = getActualSeconds;
const taskHours = getActualHours;
const sortedSubtasks = getSortedSubtasks;
const subtaskProgress = getSubtaskProgress;
const applySubtaskCompletion = serviceApplySubtaskCompletion;
const contactLabel = (contact?: Contact) => contact ? [contact.departmentName || contact.team, contact.role].filter(Boolean).join(" · ") || contact.email || "联系人" : "";
const contactSearchValues = (contact?: Contact) => contact ? [contact.name, rawObject(contact).displayName, contact.email, contact.phone, contact.departmentName, contact.team, contact.role] : [];
const findContact = (contacts: Contact[], id?: string) => contacts.find(contact => contact.id === id);
const findContactByText = (contacts: Contact[], value?: string) => {
  const key = normalizeSearch(value);
  if (!key) return undefined;
  return contacts.find(contact => [contact.name, rawObject(contact).displayName, contact.email].some(item => normalizeSearch(item) === key));
};
const contactName = (contacts: Contact[], id?: string, fallback = "") => findContact(contacts, id)?.name || fallback;
const waitingTarget = (task: Task, data: WorkData) => getWaitingTarget(task, data.contacts || []);
const isCompletedTaskStatus = isCompletedStatus;
const relatedProjectTasks = getRelatedProjectTasks;
const projectProgressSummary = getProjectProgress;
const projectProgressFromData = (data: WorkData, project: Project) => projectProgressSummary(project, relatedProjectTasks(data, project));
const taskLoggedDate = getTaskLoggedDate;
const durationLabel = formatDurationLabel;
const rawObject = (value: unknown) => value && typeof value === "object" ? value as Record<string, any> : {};
const toCalendarEvent = toMeetingEvent;
const meetingStartValue = getMeetingStartValue;
const meetingHasTime = hasMeetingTime;
const meetingDurationMinutes = getMeetingDurationMinutes;
const meetingTimeRange = getMeetingDisplayTime;
const CONTACT_RECENTS_KEY = "workos-recent-contact-ids-v1";
const readRecentContactIds = () => {
  if (typeof window === "undefined") return [] as string[];
  try {
    const value = JSON.parse(window.localStorage.getItem(CONTACT_RECENTS_KEY) || "[]");
    return Array.isArray(value) ? value.filter(Boolean).map(String).slice(0, 8) : [];
  } catch {
    return [];
  }
};
const rememberRecentContact = (id: string) => {
  if (typeof window === "undefined" || !id) return;
  const ids = [id, ...readRecentContactIds().filter(item => item !== id)].slice(0, 8);
  window.localStorage.setItem(CONTACT_RECENTS_KEY, JSON.stringify(ids));
};
const downloadText = (content: string, filename: string, type: string) => {
  const blob = new Blob([content], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
};
const mdCell = (value: unknown) => String(value ?? "").replace(/\|/g, "｜").replace(/\n/g, " ");
const csvCell = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""').replace(/\n/g, " ")}"`;
const csv = (rows: unknown[][]) => "\ufeff" + rows.map(row => row.map(csvCell).join(",")).join("\n");
const timeSessionExportRows = (data: WorkData) => data.tasks.flatMap(task => (task.timeTracking?.sessions || []).map((session, index) => {
  const originalStart = sessionOriginalStart(session);
  const originalEnd = sessionOriginalEnd(session);
  const correctedStart = session.correctedStartTime || "";
  const correctedEnd = session.correctedEndTime || "";
  return {
    task,
    index: index + 1,
    project: projectName(data.projects, task.projectId),
    originalStart,
    originalEnd,
    originalDuration: sessionOriginalDuration(session),
    correctedStart,
    correctedEnd,
    correctedDuration: session.correctedDuration,
    effectiveDuration: sessionDuration(session),
    editReason: session.editReason || "",
    editedBy: session.editedBy || "",
    editedAt: session.editedAt || "",
    note: session.correctedNote || session.note || "",
    suspectedForgotToStop: isSuspectedForgotToStop(session),
  };
}));
const buildMarkdownExport = (data: WorkData) => {
  const taskRows = data.tasks.map(t => `| ${mdCell(t.createdAt)} | ${mdCell(t.title)} | ${mdCell(projectName(data.projects,t.projectId))} | ${mdCell(t.status)} | ${mdCell(t.priority)} | ${mdCell(t.estimatedHours)} | ${mdCell(taskHours(t).toFixed(2))} | ${mdCell(t.requester)} |`);
  const projectRows = data.projects.map(p => {
    const progress = projectProgressFromData(data, p);
    return `| ${mdCell(p.name)} | ${mdCell(p.status)} | ${mdCell(`${progress.progress}%`)} | ${mdCell(`${progress.completed}/${progress.total}`)} | ${mdCell(p.priority)} | ${mdCell(p.dueDate)} |`;
  });
  const meetingRows = data.meetings.map(m => `| ${mdCell(formatLocalDate(meetingStartValue(m)) || "时间未设置")} | ${mdCell(m.title)} | ${mdCell(projectName(data.projects,m.relatedProjectId))} | ${mdCell(meetingDurationMinutes(m) ? `${meetingDurationMinutes(m)} 分钟` : "未记录")} | ${mdCell(m.actionItems.map(a=>`${a.text}（${a.owner}）`).join("；"))} |`);
  const reflectionRows = data.reflections.map(r => `| ${mdCell(r.date)} | ${mdCell(r.title)} | ${mdCell(r.type)} | ${mdCell(projectName(data.projects,r.relatedProjectId))} | ${mdCell(data.tasks.find(t=>t.id===r.relatedTaskId)?.title||"未关联任务")} |`);
  const timeRows = timeSessionExportRows(data).map(row => `| ${mdCell(row.task.title)} | ${mdCell(row.project)} | ${mdCell(row.index)} | ${mdCell(toDateTimeLocal(row.originalStart).replace("T"," "))} | ${mdCell(toDateTimeLocal(row.originalEnd).replace("T"," "))} | ${mdCell(durationLabel(row.originalDuration))} | ${mdCell(row.correctedStart ? toDateTimeLocal(row.correctedStart).replace("T"," ") : "")} | ${mdCell(row.correctedEnd ? toDateTimeLocal(row.correctedEnd).replace("T"," ") : "")} | ${mdCell(row.correctedDuration !== undefined ? durationLabel(row.correctedDuration) : "")} | ${mdCell(durationLabel(row.effectiveDuration))} | ${mdCell(row.editReason)} | ${mdCell(row.editedBy)} | ${mdCell(row.editedAt ? toDateTimeLocal(row.editedAt).replace("T"," ") : "")} | ${mdCell(row.suspectedForgotToStop ? "是" : "否")} |`);
  return ["# 工作记录导出", "", "导出时间：", todayISO(), "", "## 任务记录", "", "| 日期 | 任务 | 项目 | 状态 | 优先级 | 预估工时 | 实际工时 | 提出人 |", "|---|---|---|---|---|---|---|---|", ...taskRows, "", "## 工时记录", "", "| 任务 | 项目 | 序号 | 原始开始 | 原始结束 | 原始耗时 | 修正开始 | 修正结束 | 修正耗时 | 展示耗时 | 修正原因 | 修正人 | 修正时间 | 疑似忘关 |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|", ...timeRows, "", "## 项目记录", "", "| 项目 | 状态 | 进度 | 任务完成 | 优先级 | 截止时间 |", "|---|---|---|---|---|---|", ...projectRows, "", "## 会议记录", "", "| 日期 | 会议 | 关联项目 | 会议耗时 | Action Items |", "|---|---|---|---|---|", ...meetingRows, "", "## 复盘思考", "", "| 日期 | 标题 | 类型 | 关联项目 | 关联任务 |", "|---|---|---|---|---|", ...reflectionRows, ""].join("\n");
};
const exportCsvFiles = (data: WorkData) => {
  downloadText(csv([["日期","任务","项目","状态","优先级","预估工时","实际工时","提出人","来源","子任务进度"], ...data.tasks.map(t=>{const progress=subtaskProgress(t);return [t.createdAt,t.title,projectName(data.projects,t.projectId),t.status,t.priority,t.estimatedHours,taskHours(t).toFixed(2),t.requester,t.source,progress.total?`${progress.completed}/${progress.total}`:""]})]), `workos-tasks-${todayISO()}.csv`, "text/csv;charset=utf-8");
  downloadText(csv([["任务","项目","序号","原始开始","原始结束","原始耗时秒","修正开始","修正结束","修正耗时秒","展示耗时秒","修正原因","修正人","修正时间","疑似忘记关闭","备注"], ...timeSessionExportRows(data).map(row=>[row.task.title,row.project,row.index,row.originalStart,row.originalEnd,row.originalDuration,row.correctedStart,row.correctedEnd,row.correctedDuration ?? "",row.effectiveDuration,row.editReason,row.editedBy,row.editedAt,row.suspectedForgotToStop ? "是" : "否",row.note])]), `workos-time-sessions-${todayISO()}.csv`, "text/csv;charset=utf-8");
  downloadText(csv([["项目","类型","状态","进度","任务完成","优先级","开始日期","截止时间","目标"], ...data.projects.map(p=>{const progress=projectProgressFromData(data,p);return [p.name,p.type,p.status,`${progress.progress}%`,`${progress.completed}/${progress.total}`,p.priority,p.startDate,p.dueDate,p.goal]})]), `workos-projects-${todayISO()}.csv`, "text/csv;charset=utf-8");
  downloadText(csv([["日期","会议","关联项目","会议耗时分钟","参会人","会议纪要","决策事项","Action Items"], ...data.meetings.map(m=>[meetingStartValue(m) || "时间未设置", m.title, projectName(data.projects,m.relatedProjectId), meetingDurationMinutes(m), m.attendees.join("；"), m.notes, m.decisions.join("；"), m.actionItems.map(a=>`${a.text} / ${a.owner} / ${a.dueDate}`).join("；")])]), `workos-meetings-${todayISO()}.csv`, "text/csv;charset=utf-8");
  downloadText(csv([["日期","标题","类型","关联项目","关联任务","复盘耗时分钟","标签","内容"], ...data.reflections.map(r=>[r.date,r.title,r.type,projectName(data.projects,r.relatedProjectId),data.tasks.find(t=>t.id===r.relatedTaskId)?.title||"",r.durationMinutes || 0,r.tags.join("；"),r.content])]), `workos-reflections-${todayISO()}.csv`, "text/csv;charset=utf-8");
};
const withActualFromTracking = (task: Task): Task => ({ ...task, actualHours: taskSeconds(task) / 3600 });
const blankTracking = () => ({ isRunning: false, startedAt: null, accumulatedSeconds: 0, lastPausedAt: null, sessions: [] });
const blankProject = (): Project => ({ id: uid("project"), name: "", type: "业务项目", background: "", goal: "", status: "Planning", priority: "P1", progress: 0, startDate: todayISO(), dueDate: formatLocalDate(addDays(new Date(), 30)), relatedTaskIds: [], risks: [], nextAction: "" });
const blankTask = (patch: Partial<Task> = {}): Task => ({ id: uid("task"), title: "", description: "", source: "手动创建", requester: "", requesterContactId: "", createdBy: "", createdByContactId: "", projectId: "", status: "Todo", priority: "P1", dueDate: formatLocalDate(addDays(new Date(), 2)), estimatedHours: 1, actualHours: 0, createdAt: todayISO(), subtasks: [], autoCompleteOnSubtasksDone: true, tags: [], notes: "", waitingForType: undefined, waitingForId: "", waitingForIds: [], waitingFor: "", waitingReason: "", followUpDate: "", timeTracking: blankTracking(), ...patch });
const eventTimeLabel = (event: AnalyticsEvent) => {
  const start = Math.round(event.startHour * 60), endMinute = start + Math.max(1, Math.round(event.durationSeconds / 60));
  const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return `${fmt(start)} - ${fmt(endMinute)}`;
};
const analyticsEvents = (data: WorkData, start: string, end: string): AnalyticsEvent[] => getAnalyticsEvents(data, { start, end });
const rangeStats = (data: WorkData, start: string, end: string) => getRangeStats(data, { start, end });

const MIGRATION_PROMPT_KEY = "workos-cloud-import-prompted";
const isEmptyWorkData = (data: WorkData) => !data.tasks.length && !data.projects.length && !data.meetings.length && !data.reflections.length && !data.reports.length && !(data.contacts?.length) && !(data.contactGroups?.length);
const syncStatusLabel = (status: ReturnType<typeof useAuth>["syncStatus"], mode: RepositoryMode, isLoggedIn = false) => {
  if (isLoggedIn) {
    if (status === "syncing") return "已登录 · 同步中";
    if (status === "failed") return "已登录 · 同步失败";
    if (mode === "supabase" || status === "synced") return "已登录 · 云端已同步";
    return "已登录 · 本地数据";
  }
  if (status === "syncing") return "检查登录状态";
  if (status === "failed") return "同步失败";
  return "未登录 · 本地模式";
};

function useWorkData() {
  const auth = useAuth();
  const [data, setData] = useState<WorkData>(seedData);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<RepositoryMode>("local");
  const [showImportPrompt, setShowImportPrompt] = useState(false);
  const skipNextSave = useRef(false);
  const latestDataRef = useRef(data);
  const saveTimerRef = useRef<number | null>(null);
  const savingRef = useRef(false);
  const pendingSaveRef = useRef(false);

  useEffect(() => {
    latestDataRef.current = data;
  }, [data]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setReady(false);
      const localData = localWorkDataRepository.load();
      if (cancelled) return;
      skipNextSave.current = true;
      setData(localData);
      setMode("local");
      setShowImportPrompt(false);
      setReady(true);

      try {
        if (auth.user && auth.isCloudEnabled) {
          const localExists = hasLocalWorkData();
          const localPrompted = localStorage.getItem(`${MIGRATION_PROMPT_KEY}:${auth.user.id}`) === "true";
          setShowImportPrompt(localExists && !localPrompted);
          auth.setSyncStatus("synced");
        } else {
          auth.setSyncStatus("local");
        }
      } catch (error) {
        console.error(error);
        if (!cancelled) {
          setMode("local");
          auth.setSyncStatus("failed");
        }
      }
    };
    load();
    return () => { cancelled = true; };
  }, [auth.user?.id, auth.isCloudEnabled]);

  useEffect(() => {
    if (!ready) return;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    const runSave = async () => {
      if (savingRef.current) {
        pendingSaveRef.current = true;
        return;
      }
      savingRef.current = true;
      pendingSaveRef.current = false;
      const startedAt = performance.now();
      const snapshot = latestDataRef.current;
      try {
        localWorkDataRepository.save(snapshot);
        if (mode !== "supabase" && auth.syncStatus !== "local") auth.setSyncStatus("local");
        console.info("[workos:perf]", { operation: "local-save", ms: Math.round(performance.now() - startedAt), tasks: snapshot.tasks.length, meetings: snapshot.meetings.length });
      } catch (error) {
        console.error(error);
        auth.setSyncStatus("failed");
      } finally {
        savingRef.current = false;
        if (pendingSaveRef.current) {
          window.setTimeout(runSave, 0);
        }
      }
    };
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(runSave, 800);
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [data, ready, mode, auth.user?.id, auth.isCloudEnabled]);

  const importLocalToCloud = async () => {
    if (!auth.user || !auth.isCloudEnabled) return;
    const localData = localWorkDataRepository.load();
    auth.setSyncStatus("syncing");
    const repo = await createWorkDataRepository("supabase");
    await repo.save(localData);
    localStorage.setItem(`${MIGRATION_PROMPT_KEY}:${auth.user.id}`, "true");
    skipNextSave.current = true;
    setData(localData);
    setMode("supabase");
    setShowImportPrompt(false);
    auth.setSyncStatus("synced");
  };

  const useCloudOnly = async () => {
    if (!auth.user || !auth.isCloudEnabled) return;
    localStorage.setItem(`${MIGRATION_PROMPT_KEY}:${auth.user.id}`, "true");
    auth.setSyncStatus("syncing");
    const repo = await createWorkDataRepository("supabase");
    const cloudData = await repo.load();
    skipNextSave.current = true;
    setData(cloudData);
    setMode("supabase");
    setShowImportPrompt(false);
    auth.setSyncStatus("synced");
  };

  const reloadCloudData = async () => {
    if (!auth.user || !auth.isCloudEnabled) return;
    const startedAt = performance.now();
    auth.setSyncStatus("syncing");
    try {
      const repo = await createWorkDataRepository("supabase");
      const cloudData = await repo.load();
      skipNextSave.current = true;
      setData(cloudData);
      setMode("supabase");
      auth.setSyncStatus("synced");
      console.info("[workos:perf]", { operation: "cloud-refresh", ms: Math.round(performance.now() - startedAt), tasks: cloudData.tasks.length, meetings: cloudData.meetings.length, contacts: cloudData.contacts?.length || 0 });
    } catch (error) {
      console.error(error);
      auth.setSyncStatus("failed");
      throw error;
    }
  };

  const syncNow = async () => {
    if (!auth.user || !auth.isCloudEnabled) {
      throw new Error("请先登录后再同步");
    }
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const waitStartedAt = Date.now();
    while (savingRef.current && Date.now() - waitStartedAt < 2_000) {
      await new Promise<void>(resolve => window.setTimeout(resolve, 50));
    }
    if (savingRef.current) throw new Error("本地数据仍在保存，请稍后重试");

    const startedAt = performance.now();
    const snapshot = latestDataRef.current;
    auth.setSyncStatus("syncing");
    savingRef.current = true;
    pendingSaveRef.current = false;
    try {
      localWorkDataRepository.save(snapshot);
      const repo = await createWorkDataRepository("supabase");
      await repo.save(snapshot);
      const cloudData = await repo.load();
      localWorkDataRepository.save(cloudData);
      latestDataRef.current = cloudData;
      skipNextSave.current = true;
      setData(cloudData);
      setMode("supabase");
      auth.setSyncStatus("synced");
      console.info("[workos:perf]", { operation: "manual-sync", ms: Math.round(performance.now() - startedAt), tasks: cloudData.tasks.length, meetings: cloudData.meetings.length, contacts: cloudData.contacts?.length || 0 });
    } catch (error) {
      console.error(error);
      auth.setSyncStatus("failed");
      throw error;
    } finally {
      savingRef.current = false;
    }
  };

  const deleteCloudEntity = async (entity: WorkDataEntity, id: string) => {
    if (!auth.user || !auth.isCloudEnabled || mode !== "supabase") return;
    const startedAt = performance.now();
    try {
      const repo = await createWorkDataRepository("supabase");
      await repo.deleteEntity?.(entity, id);
      console.info("[workos:perf]", { operation: `delete-${entity}`, ms: Math.round(performance.now() - startedAt), id });
    } catch (error) {
      console.error(error);
      auth.setSyncStatus("failed");
    }
  };

  const persistDataNow = async (snapshot: WorkData) => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    latestDataRef.current = snapshot;
    const waitStartedAt = Date.now();
    while (savingRef.current && Date.now() - waitStartedAt < 2_000) {
      await new Promise<void>(resolve => window.setTimeout(resolve, 50));
    }
    if (savingRef.current) {
      throw new Error("Previous save did not finish within 2000ms");
    }
    savingRef.current = true;
    pendingSaveRef.current = false;
    const startedAt = performance.now();
    try {
      if (mode === "supabase" && auth.user && auth.isCloudEnabled) {
        localWorkDataRepository.save(snapshot);
        auth.setSyncStatus("synced");
        console.info("[workos:perf]", { operation: "local-save-now-cloud-mode", ms: Math.round(performance.now() - startedAt), tasks: snapshot.tasks.length, meetings: snapshot.meetings.length, contacts: snapshot.contacts?.length || 0 });
      } else {
        localWorkDataRepository.save(snapshot);
        auth.setSyncStatus(auth.user ? "local" : "local");
        console.info("[workos:perf]", { operation: "local-save-now", ms: Math.round(performance.now() - startedAt), tasks: snapshot.tasks.length, meetings: snapshot.meetings.length });
      }
    } catch (error) {
      console.error(error);
      auth.setSyncStatus("failed");
      throw error;
    } finally {
      savingRef.current = false;
    }
  };

  const remindLater = () => setShowImportPrompt(false);

  return { data, setData, persistDataNow, mode, ready, showImportPrompt, importLocalToCloud, useCloudOnly, reloadCloudData, syncNow, deleteCloudEntity, remindLater } as const;
}

export function WorkOS() {
  const auth = useAuth();
  const { data, setData, persistDataNow, mode, showImportPrompt, importLocalToCloud, useCloudOnly, reloadCloudData, syncNow, deleteCloudEntity, remindLater } = useWorkData();
  const [view, setView] = useState<View>("today");
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<Modal>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [editingMeeting, setEditingMeeting] = useState<Meeting | null>(null);
  const [editingReflection, setEditingReflection] = useState<Reflection | null>(null);
  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const [detailProject, setDetailProject] = useState<Project | null>(null);
  const [detailReflection, setDetailReflection] = useState<Reflection | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [displaySettings, setDisplaySettings] = useState<DisplaySettings>(() => loadDisplaySettings());
  const [, setClock] = useState(0);
  const [toast, setToast] = useState("");
  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 2400); };
  const hasRunningTask = data.tasks.some(task => task.timeTracking?.isRunning);

  useEffect(() => {
    const listener = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setModal("capture"); } };
    window.addEventListener("keydown", listener); return () => window.removeEventListener("keydown", listener);
  }, []);
  useEffect(() => {
    if (!hasRunningTask) return;
    const id = window.setInterval(() => setClock(v => v + 1), 1000);
    return () => window.clearInterval(id);
  }, [hasRunningTask]);
  useEffect(() => { setMobileNavOpen(false); }, [view]);
  const updateDisplaySettings = (patch: Partial<DisplaySettings>) => setDisplaySettings(current => {
    const next = { ...current, ...patch };
    window.localStorage.setItem(DISPLAY_SETTINGS_KEY, JSON.stringify(next));
    return next;
  });

  const saveTask = (task: Task) => setData(d => {
    const requesterContact = findContact(d.contacts || [], task.requesterContactId) || findContactByText(d.contacts || [], task.requester);
    const waitingForIds = Array.from(new Set([...(task.waitingForIds || []), task.waitingForId || ""].filter(Boolean)));
    const validWaitingContacts = waitingForIds.map(id => findContact(d.contacts || [], id)).filter(Boolean) as Contact[];
    if (task.status === "Waiting" && !validWaitingContacts.length) {
      notify("请选择有效等待人");
      return d;
    }
    task = applySubtaskCompletion({
      ...task,
      requesterContactId: requesterContact?.id || "",
      requester: requesterContact?.name || task.requester || "",
      createdByContactId: task.createdByContactId || "",
      createdBy: task.createdBy || auth.user?.email || "自己",
      actualHours: taskHours(task) / 1,
      subtasks: sortedSubtasks(task).map((item, index) => ({ ...item, order: index })),
      tags: task.tags || [],
      notes: task.notes || "",
    });
    if (task.status !== "Waiting") task = { ...task, waitingForType: undefined, waitingForId: "", waitingForIds: [], waitingFor: "", waitingReason: "", followUpDate: "" };
    if (task.status === "Waiting") {
      const names = validWaitingContacts.map(contact => contact.name);
      task = { ...task, waitingForType: "contact", waitingForIds: validWaitingContacts.map(contact => contact.id), waitingForId: validWaitingContacts[0]?.id || "", waitingFor: names.join("、") };
    }
    const exists = d.tasks.some(t => t.id === task.id);
    const tasks = exists ? d.tasks.map(t => t.id === task.id ? task : t) : [task, ...d.tasks];
    const projects = d.projects.map(p => ({ ...p, relatedTaskIds: tasks.filter(t => t.projectId === p.id).map(t => t.id) }));
    return { ...d, tasks, projects };
  });
  const deleteTask = (id: string) => { setData(d => ({ ...d, tasks: d.tasks.filter(t => t.id !== id), projects: d.projects.map(p => ({ ...p, relatedTaskIds: p.relatedTaskIds.filter(x => x !== id) })), meetings: d.meetings.map(m => ({ ...m, actionItems: m.actionItems.map(a => a.taskId === id ? { ...a, taskId: undefined } : a) })), reflections: d.reflections.map(r => r.relatedTaskId === id ? { ...r, relatedTaskId: "" } : r) })); void deleteCloudEntity("tasks", id); };
  const updateTask = (id: string, patch: Partial<Task>) => setData(d => ({ ...d, tasks: d.tasks.map(t => t.id === id ? applySubtaskCompletion({ ...t, ...patch }) : t) }));
  const pauseRunningTask = (task: Task, now: Date | string = new Date()) => {
    const endTime = formatLocalDateTime(now);
    const startTime = task.timeTracking?.startedAt || endTime;
    const durationSeconds = calculateDurationSeconds(startTime, endTime);
    const accumulatedSeconds = recalcTrackingSeconds(task) + durationSeconds;
    const session = { startTime, endTime, durationSeconds, suspectedForgotToStop: durationSeconds >= 8 * 3600 };
    console.info("[workos:time-session]", {
      rawStartTime: startTime,
      rawEndTime: endTime,
      parsedStartTime: parseLocalDateTime(startTime)?.toString() || null,
      parsedEndTime: parseLocalDateTime(endTime)?.toString() || null,
      durationSeconds,
      displayedRange: `${formatLocalTime(startTime)} - ${formatLocalTime(endTime)}`,
    });
    return {
      ...task,
      actualHours: accumulatedSeconds / 3600,
      timeTracking: {
        ...(task.timeTracking || blankTracking()),
        isRunning: false,
        startedAt: null,
        accumulatedSeconds,
        lastPausedAt: endTime,
        sessions: durationSeconds > 0 ? [...(task.timeTracking?.sessions || []), session] : (task.timeTracking?.sessions || []),
      },
    };
  };
  const completeTask = (task: Task) => {
    const now = new Date();
    setData(d => ({ ...d, tasks: d.tasks.map(t => {
      if (t.id !== task.id) return t;
      const settled = t.timeTracking?.isRunning ? pauseRunningTask(t, now) : { ...t, actualHours: taskHours(t) };
      return { ...settled, status: "Done", completedAt: todayISO() };
    }) }));
    notify("任务已完成，耗时已结算");
  };
  const startTimer = (task: Task) => {
    const running = data.tasks.find(t => t.timeTracking?.isRunning && t.id !== task.id);
    if (running && !confirm("已有任务正在计时，是否暂停当前任务并开始新任务？")) return;
    const now = localNow();
    setData(d => ({ ...d, tasks: d.tasks.map(t => {
      if (running && t.id === running.id) return pauseRunningTask(t, now);
      if (t.id === task.id) return { ...t, status: t.status === "Done" ? t.status : "Doing", timeTracking: { ...(t.timeTracking || blankTracking()), isRunning: true, startedAt: now, lastPausedAt: null }, actualHours: taskHours(t) };
      return t;
    }) }));
    notify(`开始计时：${task.title}`);
  };
  const pauseTimer = (task: Task) => {
    const now = new Date();
    setData(d => ({ ...d, tasks: d.tasks.map(t => t.id === task.id ? pauseRunningTask(t, now) : t) }));
    notify("计时已暂停");
  };
  const stopTimer = (task: Task) => {
    const now = new Date();
    setData(d => ({ ...d, tasks: d.tasks.map(t => t.id === task.id ? (t.timeTracking?.isRunning ? pauseRunningTask(t, now) : { ...t, actualHours: taskHours(t) }) : t) }));
    notify("计时已结束，实际耗时已写入任务");
  };
  const correctTimeSession = (taskId: string, sessionIndex: number, session: TimeSession) => setData(d => ({ ...d, tasks: d.tasks.map(t => {
    if (t.id !== taskId) return t;
    const start = sessionStart(session), end = sessionEnd(session);
    if (!start || !end || isInvalidTimeRange(start, end)) {
      notify("结束时间必须晚于开始时间");
      return t;
    }
    const fixedSession = { ...session, durationSeconds: computedSessionDuration(start, end), correctedDuration: session.correctedStartTime && session.correctedEndTime ? computedSessionDuration(session.correctedStartTime, session.correctedEndTime) : session.correctedDuration };
    const sessions = (t.timeTracking?.sessions || []).map((s, index) => index === sessionIndex ? fixedSession : s);
    const accumulatedSeconds = sessions.reduce((sum, item) => sum + sessionDuration(item), 0);
    return {
      ...t,
      actualHours: accumulatedSeconds / 3600,
      timeTracking: {
        ...(t.timeTracking || blankTracking()),
        accumulatedSeconds,
        sessions,
      },
    };
  }) }));
  const saveProject = (p: Project) => setData(d => ({ ...d, projects: d.projects.some(x => x.id === p.id) ? d.projects.map(x => x.id === p.id ? p : x) : [p, ...d.projects] }));
  const createProject = (p: Project) => { saveProject(p); notify(`项目已创建：${p.name}`); return p; };
  const deleteProject = (id: string) => { setData(d => ({ ...d, projects: d.projects.filter(p => p.id !== id), tasks: d.tasks.map(t => t.projectId === id ? { ...t, projectId: "" } : t), meetings: d.meetings.map(m => m.relatedProjectId === id ? { ...m, relatedProjectId: "" } : m), reflections: d.reflections.map(r => r.relatedProjectId === id ? { ...r, relatedProjectId: "" } : r) })); void deleteCloudEntity("projects", id); };
  const saveMeeting = async (m: Meeting) => {
    const previousData = data;
    const nextData = { ...data, meetings: data.meetings.some(x => x.id === m.id) ? data.meetings.map(x => x.id === m.id ? m : x) : [m, ...data.meetings] };
    setData(nextData);
    try {
      await persistDataNow(nextData);
      return true;
    } catch {
      setData(previousData);
      notify("会议保存失败，已回滚到保存前状态");
      return false;
    }
  };
  const saveReflection = (r: Reflection) => setData(d => ({ ...d, reflections: d.reflections.some(x => x.id === r.id) ? d.reflections.map(x => x.id === r.id ? r : x) : [r, ...d.reflections] }));
  const saveContact = (c: Contact) => setData(d => ({ ...d, contacts: (d.contacts || []).some(x => x.id === c.id) ? d.contacts.map(x => x.id === c.id ? c : x) : [c, ...(d.contacts || [])] }));
  const createNativeContact = (rawName: string) => {
    const name = rawName.trim();
    let selected: Contact | null = null;
    if (!name) return selected;
    setData(d => {
      const existing = (d.contacts || []).find(contact => [contact.name, rawObject(contact).displayName].some(value => normalizeSearch(value) === normalizeSearch(name)));
      if (existing) {
        selected = existing;
        return d;
      }
      const now = localNow();
      const contact = { id: uid("contact"), name, role: "", team: "", company: "", email: "", phone: "", notes: "", externalSource: "manual" as const, externalId: "", createdAt: now, updatedAt: now };
      selected = contact;
      return { ...d, contacts: [contact, ...(d.contacts || [])] };
    });
    if (selected) rememberRecentContact((selected as Contact).id);
    return selected;
  };
  const deleteContact = (id: string) => { setData(d => ({
    ...d,
    contacts: (d.contacts || []).filter(c => c.id !== id),
    tasks: d.tasks.map(t => ({
      ...t,
      requesterContactId: t.requesterContactId === id ? "" : t.requesterContactId,
      createdByContactId: t.createdByContactId === id ? "" : t.createdByContactId,
      waitingForType: (t.waitingForIds || [t.waitingForId]).includes(id) ? "legacy" : t.waitingForType,
      waitingForIds: (t.waitingForIds || []).filter(x => x !== id),
      waitingForId: t.waitingForId === id ? ((t.waitingForIds || []).filter(x => x !== id)[0] || "") : t.waitingForId,
    })),
    contactGroups: (d.contactGroups || []).map(g => ({ ...g, contactIds: g.contactIds.filter(x => x !== id), updatedAt: localNow() })),
  })); void deleteCloudEntity("contacts", id); };
  const openTask = (task?: Task) => { setEditingTask(task || null); setModal("task"); };
  const openProject = (p?: Project) => { setEditingProject(p || null); setModal("project"); };
  const openMeeting = (m?: Meeting) => { setEditingMeeting(m || null); setModal("meeting"); };
  const openReflection = (r?: Reflection) => { setEditingReflection(r || null); setModal("reflection"); };
  const openWaitingTask = () => openTask(blankTask({ status: "Waiting", dueDate: "", followUpDate: formatLocalDate(addDays(new Date(), 2)) }));
  const openPrimary = () => view === "display" ? notify("显示设置已实时生效") : view === "today" ? setModal("capture") : view === "meetings" ? openMeeting() : view === "thinking" ? openReflection() : view === "projects" ? openProject() : view === "contacts" ? notify("请在联系人页面内新增联系人") : view === "inbox" ? setModal("capture") : view === "reports" ? notify("请在下方选择报告范围后生成") : view === "workAnalytics" ? notify("请在分析中心内切换周期或时间范围") : view === "waiting" ? openWaitingTask() : openTask();
  const primaryLabel = view === "display" ? "设置已生效" : view === "today" ? "快速记录" : view === "meetings" ? "新建会议" : view === "thinking" ? "记录复盘" : view === "projects" ? "新建项目" : view === "contacts" ? "管理联系人" : view === "inbox" ? "快速记录" : view === "reports" ? "生成报告" : view === "workAnalytics" ? "调整分析" : view === "waiting" ? "新增等待事项" : "新建任务";

  return <div className={cn("app-shell", mobileNavOpen && "nav-open", `display-font-${displaySettings.fontScale}`, `display-width-${displaySettings.contentWidth}`, `display-density-${displaySettings.density}`)}>
    {mobileNavOpen && <button className="mobile-sidebar-scrim" aria-label="关闭导航" onClick={() => setMobileNavOpen(false)} />}
    <aside className="sidebar"><div className="brand"><div className="brand-mark"><Zap size={17} fill="currentColor" /></div><span>WorkOS</span><span className="version">PERSONAL</span><button className="mobile-nav-close" aria-label="关闭导航" onClick={() => setMobileNavOpen(false)}><X size={18}/></button></div>
      <button className="quick-capture" onClick={() => setModal("capture")}><Plus size={16} /> 快速记录 <kbd>⌘ K</kbd></button>
      <nav className="nav-wrap">{nav.map(s => <div className="nav-section" key={s.group}><div className="nav-label">{s.group}</div>{s.items.map(item => { const Icon = item.icon; const count = item.id === "inbox" ? data.tasks.filter(t => t.status === "Inbox").length : item.id === "waiting" ? data.tasks.filter(t => t.status === "Waiting").length : 0; return <button key={item.id} className={cn("nav-item", view === item.id && "active")} onClick={() => setView(item.id)}><Icon size={17} /><span>{item.label}</span>{count > 0 && <b>{count}</b>}</button> })}</div>)}</nav>
      <div className="sidebar-footer"><div className="memory-status"><div className="memory-title"><span><Sparkles size={14} /> 工作记忆</span><b>{Math.min(100, data.tasks.length * 5 + data.reflections.length * 7)}%</b></div><div className="progress"><i style={{ width: `${Math.min(100, data.tasks.length * 5 + data.reflections.length * 7)}%` }} /></div><p>已沉淀 {data.tasks.length + data.meetings.length + data.reflections.length} 条记录</p></div><button className="profile" onClick={() => setModal("settings")}><div className="avatar">{auth.user?.email?.slice(0,1).toUpperCase() || "U"}</div><div><strong>{auth.user?.email || "我的工作空间"}</strong><span>{syncStatusLabel(auth.syncStatus, mode, Boolean(auth.user))}</span></div><MoreHorizontal size={18} /></button></div>
    </aside>
    <main className="main"><header className="topbar"><button className="mobile-menu-button" aria-label="打开导航" onClick={() => setMobileNavOpen(true)}><Menu size={19}/></button><div className="search"><Search size={16} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索任务、项目、会议、复盘..." /><kbd>⌘ /</kbd></div><div className="top-actions"><button className="icon-button" aria-label="通知" onClick={() => notify("当前没有新的提醒")}><Bell size={18} /></button><button className="icon-button" aria-label="设置" onClick={() => setModal("settings")}><Settings size={18} /></button><div className="today-pill"><CalendarDays size={15} />{format(new Date(), "M月d日 EEEE", { locale: zhCN })}</div></div></header>
      <div className={cn("page", view === "today" && "today-page")}><div className="page-head"><div><h1>{viewMeta[view].title}</h1><p>{viewMeta[view].subtitle}</p></div><button className="primary" onClick={openPrimary}><Plus size={16} />{primaryLabel}</button></div>
        {search.trim() ? <GlobalSearchResults data={data} query={search} onTask={setDetailTask} onProject={setDetailProject} onReflection={setDetailReflection} onView={setView} /> : <>
          {view === "today" && <Dashboard data={data} setView={setView} onTask={setDetailTask} />}
          {view === "inbox" && <InboxView data={data} updateTask={updateTask} deleteTask={deleteTask} query={search} notify={notify} />}
          {view === "tasks" && <TaskCenter data={data} query={search} updateTask={updateTask} deleteTask={deleteTask} notify={notify} onOpen={setDetailTask} onAdd={openTask} onComplete={completeTask} onStartTimer={startTimer} onPauseTimer={pauseTimer} onStopTimer={stopTimer} />}
          {view === "projects" && <ProjectCenter data={data} query={search} onOpen={setDetailProject} onEdit={openProject} onAdd={openProject} />}
          {view === "meetings" && <MeetingCenter data={data} setData={setData} query={search} onEdit={openMeeting} onTask={setDetailTask} onDelete={m => { if (confirm(`删除会议“${m.title}”？`)) { setData(d => ({ ...d, meetings: d.meetings.filter(x => x.id !== m.id) })); void deleteCloudEntity("meetings", m.id); notify("会议已删除"); } }} />}
          {view === "contacts" && <ContactCenter data={data} query={search} onSaveContact={c => { saveContact(c); notify("联系人已保存"); }} onDeleteContact={c => { if (confirm(`删除联系人“${c.name}”？历史任务和会议中的文本会保留。`)) { deleteContact(c.id); notify("联系人已删除"); } }} />}
          {view === "log" && <WorkLog data={data} onTask={setDetailTask} onMeeting={openMeeting} onReflection={setDetailReflection} />}
          {view === "weekly" && <WeeklyReview data={data} setData={setData} setView={setView} notify={notify} />}
          {view === "reports" && <ReportCenter data={data} setData={setData} query={search} notify={notify} />}
          {view === "analytics" && <Analytics data={data} />}
          {view === "workAnalytics" && <WorkAnalytics data={data} onTask={setDetailTask} onMeeting={openMeeting} onReflection={setDetailReflection} />}
          {view === "waiting" && <WaitingDashboard data={data} updateTask={updateTask} onTask={setDetailTask} />}
          {view === "thinking" && <ThinkingSpace data={data} query={search} onOpen={setDetailReflection} onAdd={openReflection} />}
          {view === "display" && <DisplaySettingsPage settings={displaySettings} onChange={updateDisplaySettings} />}
        </>}
      </div>
    </main>
    <CaptureDialog open={modal === "capture"} contacts={data.contacts} onCreateContact={createNativeContact} onOpenChange={o => !o && setModal(null)} onAdd={saveTask} />
    <TaskDialog open={modal === "task"} task={editingTask} projects={data.projects} contacts={data.contacts} onCreateContact={createNativeContact} onCreateProject={createProject} onOpenChange={o => !o && setModal(null)} onSave={t => { const existed = data.tasks.some(task => task.id === t.id); saveTask(t); setModal(null); notify(existed ? "任务已更新" : "任务已创建"); }} />
    <ProjectDialog open={modal === "project"} project={editingProject} onOpenChange={o => !o && setModal(null)} onSave={p => { saveProject(p); setModal(null); notify(editingProject ? "项目已更新" : "项目已创建"); }} />
    <MeetingDialogV2 open={modal === "meeting"} meeting={editingMeeting} data={data} onCreateContact={createNativeContact} onCreateProject={createProject} onOpenChange={o => !o && setModal(null)} onSave={async m => { const ok = await saveMeeting(m); if (ok) { setModal(null); notify(editingMeeting ? "会议已更新并保存" : "会议已创建并保存"); } }} />
    <ReflectionDialog open={modal === "reflection"} reflection={editingReflection} data={data} onCreateProject={createProject} onOpenChange={o => !o && setModal(null)} onSave={r => { saveReflection(r); setModal(null); notify(editingReflection ? "复盘已更新" : "复盘已记录"); }} />
    <TaskDetail open={!!detailTask} task={detailTask && data.tasks.find(t => t.id === detailTask.id) || null} data={data} editedBy={auth.user?.email || "本地用户"} onClose={() => setDetailTask(null)} onEdit={t => { setDetailTask(null); openTask(t); }} onDelete={t => { if (confirm(`删除任务“${t.title}”？`)) { deleteTask(t.id); setDetailTask(null); notify("任务已删除"); } }} onReflection={() => { if (detailTask) { setEditingReflection({ id: uid("reflection"), title: "", content: "", type: "问题复盘", relatedProjectId: detailTask.projectId, relatedTaskId: detailTask.id, date: todayISO(), durationMinutes: 0, tags: [] }); setDetailTask(null); setModal("reflection"); } }} onProject={p => { setDetailTask(null); setDetailProject(p); }} onStartTimer={startTimer} onPauseTimer={pauseTimer} onStopTimer={stopTimer} onCorrectSession={(taskId,index,session)=>{correctTimeSession(taskId,index,session); notify("计时记录已修正，原始记录已保留");}} />
    <ProjectDetail open={!!detailProject} project={detailProject && data.projects.find(p => p.id === detailProject.id) || null} data={data} onClose={() => setDetailProject(null)} onEdit={p => { setDetailProject(null); openProject(p); }} onDelete={p => { if (confirm(`删除项目“${p.name}”？关联记录会保留但解除关联。`)) { deleteProject(p.id); setDetailProject(null); notify("项目已删除，关联记录已保留"); } }} onTask={t => { setDetailProject(null); setDetailTask(t); }} onReflection={r => { setDetailProject(null); setDetailReflection(r); }} />
    <ReflectionDetail open={!!detailReflection} reflection={detailReflection && data.reflections.find(r => r.id === detailReflection.id) || null} data={data} onClose={() => setDetailReflection(null)} onEdit={r => { setDetailReflection(null); openReflection(r); }} onDelete={r => { if (confirm(`删除复盘“${r.title}”？`)) { setData(d => ({ ...d, reflections: d.reflections.filter(x => x.id !== r.id) })); void deleteCloudEntity("reflections", r.id); setDetailReflection(null); notify("复盘已删除"); } }} />
    <SettingsDialog open={modal === "settings"} onClose={() => setModal(null)} data={data} mode={mode} displaySettings={displaySettings} onDisplayChange={updateDisplaySettings} onSync={syncNow} onReset={() => { localWorkDataRepository.clear(); setData(JSON.parse(JSON.stringify(seedData))); notify("演示数据已恢复"); }} notify={notify} />
    <LocalImportDialog open={showImportPrompt} data={localWorkDataRepository.load()} onImport={async()=>{try{await importLocalToCloud();notify("本地数据已导入云端，本地备份仍然保留");}catch(error){console.error(error);notify("导入失败，请检查 Supabase 配置或网络");}}} onLater={remindLater} onCloudOnly={async()=>{try{await useCloudOnly();notify("已切换为仅使用云端数据，本地数据仍保留");}catch(error){console.error(error);notify("读取云端数据失败");}}} />
    {toast && <div className="toast"><CheckCircle2 size={16} />{toast}</div>}
  </div>;
}

function GlobalSearchResults({ data, query, onTask, onProject, onReflection, onView }: { data: WorkData; query: string; onTask: (t: Task) => void; onProject: (p: Project) => void; onReflection: (r: Reflection) => void; onView: (v: View) => void }) {
  const tasks = data.tasks.filter(t => fuzzyMatch(query, taskSearchFields(t, data)));
  const projects = data.projects.filter(p => fuzzyMatch(query, projectSearchFields(p, data)));
  const meetings = data.meetings.filter(m => fuzzyMatch(query, meetingSearchFields(m, data)));
  const reflections = data.reflections.filter(r => fuzzyMatch(query, reflectionSearchFields(r, data)));
  const reports = data.reports.filter(r => fuzzyMatch(query, reportSearchFields(r)));
  const contacts = (data.contacts || []).filter(c => fuzzyMatch(query, contactSearchFields(c)));
  const total = tasks.length + projects.length + meetings.length + reflections.length + reports.length + contacts.length;
  if (!total) return <EmptyState icon={Search} title="没有找到匹配结果" text="可以试试项目名、提出人、来源、标签或复盘关键词。" />;
  return <div className="search-results">
    <section className="panel search-summary"><span className="eyebrow">GLOBAL SEARCH</span><h2>找到 {total} 条结果</h2><p>搜索范围包含任务、项目、会议、复盘、报告和联系人。清空搜索框即可回到原页面。</p></section>
    <div className="search-result-grid">
      <SearchGroup title="任务" count={tasks.length}>{tasks.map(t => <button className="linked-row" key={t.id} onClick={() => onTask(t)}><ListTodo size={16}/><div><strong>{t.title}</strong><span>{projectName(data.projects,t.projectId)} · {t.requester} · {t.source}</span></div><ArrowRight size={15}/></button>)}</SearchGroup>
      <SearchGroup title="项目" count={projects.length}>{projects.map(p => { const progress = projectProgressFromData(data, p); return <button className="linked-row" key={p.id} onClick={() => onProject(p)}><FolderKanban size={16}/><div><strong>{p.name}</strong><span>{p.type} · {progress.progress}% · 任务 {progress.completed}/{progress.total} · {p.priority}</span></div><ArrowRight size={15}/></button> })}</SearchGroup>
      <SearchGroup title="会议" count={meetings.length}>{meetings.map(m => <button className="linked-row" key={m.id} onClick={() => onView("meetings")}><CalendarDays size={16}/><div><strong>{m.title}</strong><span>{meetingTimeRange(m)} · {projectName(data.projects,m.relatedProjectId)}</span></div><ArrowRight size={15}/></button>)}</SearchGroup>
      <SearchGroup title="复盘" count={reflections.length}>{reflections.map(r => <button className="linked-row" key={r.id} onClick={() => onReflection(r)}><Brain size={16}/><div><strong>{r.title}</strong><span>{r.type} · {projectName(data.projects,r.relatedProjectId)}</span></div><ArrowRight size={15}/></button>)}</SearchGroup>
      <SearchGroup title="报告" count={reports.length}>{reports.map(r => <button className="linked-row" key={r.id} onClick={() => onView("reports")}><FileText size={16}/><div><strong>{r.title}</strong><span>{r.type} · {r.startDate} — {r.endDate}</span></div><ArrowRight size={15}/></button>)}</SearchGroup>
      <SearchGroup title="联系人" count={contacts.length}>{contacts.map(c => <button className="linked-row" key={c.id} onClick={() => onView("contacts")}><Users size={16}/><div><strong>{c.name}</strong><span>{[c.team,c.company,c.role].filter(Boolean).join(" · ")}</span></div><ArrowRight size={15}/></button>)}</SearchGroup>
    </div>
  </div>;
}
function SearchGroup({ title, count, children }: { title: string; count: number; children: React.ReactNode }) { return <section className="panel search-group"><PanelHead title={`${title} · ${count}`} sub={count ? "点击查看详情" : "暂无匹配"} />{count ? children : <p className="meeting-notes">没有匹配内容</p>}</section> }

function WorkAnalytics({ data, onTask, onMeeting, onReflection }: { data: WorkData; onTask: (t: Task) => void; onMeeting: (m: Meeting) => void; onReflection: (r: Reflection) => void }) {
  const [period, setPeriod] = useState<"week" | "month" | "custom">("week");
  const [customStart, setCustomStart] = useState(format(subDays(new Date(), 14), "yyyy-MM-dd"));
  const [customEnd, setCustomEnd] = useState(todayISO());
  const [detail, setDetail] = useState<AnalyticsDetailKind | null>(null);
  const range = period === "week"
    ? { start: format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd"), end: format(endOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd"), label: "本周" }
    : period === "month"
      ? { start: format(startOfMonth(new Date()), "yyyy-MM-dd"), end: format(endOfMonth(new Date()), "yyyy-MM-dd"), label: "本月" }
      : { start: customStart, end: customEnd < customStart ? customStart : customEnd, label: "自定义" };
  const stats = rangeStats(data, range.start, range.end);
  const span = daysBetween(range.start, range.end);
  const previousEnd = format(subDays(parseISO(range.start), 1), "yyyy-MM-dd");
  const previousStart = format(subDays(parseISO(range.start), span), "yyyy-MM-dd");
  const previous = rangeStats(data, previousStart, previousEnd);
  const summary = getExecutiveSummary(data, { start: range.start, end: range.end });
  const previousSummary = getExecutiveSummary(data, { start: previousStart, end: previousEnd });
  const allocation = getTimeAllocation(data, { start: range.start, end: range.end });
  const taskAnalytics = getTaskAnalytics(data, { start: range.start, end: range.end });
  const meetingAnalytics = getMeetingAnalytics(data, { start: range.start, end: range.end });
  const completionRate = summary.completionRate;
  const previousCompletionRate = previousSummary.completionRate;
  const avgTaskSeconds = summary.averageTaskSeconds;
  const previousAvgTaskSeconds = previousSummary.averageTaskSeconds;
  const meetingSeconds = meetingAnalytics.totalSeconds;
  const avgMeetingSeconds = meetingAnalytics.averageSeconds;
  const meetingProjectRows = data.projects.map(project => ({
    project,
    seconds: stats.meetings.filter(meeting => meeting.relatedProjectId === project.id).reduce((sum, meeting) => sum + meetingDurationMinutes(meeting) * 60, 0),
    count: stats.meetings.filter(meeting => meeting.relatedProjectId === project.id).length,
  })).filter(row => row.seconds > 0).sort((a, b) => b.seconds - a.seconds).slice(0, 5);
  const attendeeRows = [...stats.meetings.reduce((map, meeting) => {
    (meeting.attendees.length ? meeting.attendees : ["未记录"]).forEach(name => {
      const current = map.get(name) || { count: 0, seconds: 0 };
      map.set(name, { count: current.count + 1, seconds: current.seconds + meetingDurationMinutes(meeting) * 60 });
    });
    return map;
  }, new Map<string, { count: number; seconds: number }>()).entries()].sort((a, b) => b[1].seconds - a[1].seconds).slice(0, 5);
  const topTasks = getTopTasksByDuration(data, { start: range.start, end: range.end }, 5);
  const topMeetings = getTopMeetingsByDuration(data, { start: range.start, end: range.end }, 5);
  const highPriorityOpen = taskAnalytics.highPriorityOpen;
  const isSafeMetric = (value: number, limit = 1_000_000) => Number.isFinite(value) && Math.abs(value) <= limit;
  const trend = (current: number, prev: number, kind: "seconds" | "percent" | "count") => {
    if (!isSafeMetric(current) || !isSafeMetric(prev)) return "暂无对比";
    if (prev <= 0) return current > 0 ? "本期新增" : "暂无对比";
    const diff = current - prev;
    if (kind === "seconds") {
      const hours = diff / 3600;
      if (!isSafeMetric(hours, 10_000)) return "暂无对比";
      return `较上期 ${hours >= 0 ? "+" : ""}${hours.toFixed(1)}h`;
    }
    if (kind === "percent") {
      if (!isSafeMetric(diff, 100)) return "暂无对比";
      return `较上期 ${diff >= 0 ? "+" : ""}${diff.toFixed(0)}%`;
    }
    const count = Math.round(diff);
    if (!isSafeMetric(count, 100_000)) return "暂无对比";
    return `较上期 ${count >= 0 ? "+" : ""}${count}`;
  };
  const insights = [
    stats.projectSeconds[0] && stats.totalSeconds ? `本周期 ${Math.round(stats.projectSeconds[0].seconds / stats.totalSeconds * 100)}% 时间投入 ${stats.projectSeconds[0].project.name}。` : "",
    stats.totalSeconds && meetingSeconds / stats.totalSeconds > 0.4 ? `会议占工时 ${Math.round(meetingSeconds / stats.totalSeconds * 100)}%，需要关注会议密度。` : "",
    highPriorityOpen ? `仍有 ${highPriorityOpen} 个高优任务未完成，建议优先处理。` : "高优任务压力较低，可以安排深度工作。",
    avgTaskSeconds && previousAvgTaskSeconds ? `平均任务耗时${trend(avgTaskSeconds, previousAvgTaskSeconds, "seconds")}。` : "",
    stats.overdue.length ? `有 ${stats.overdue.length} 个延期任务，需要重新确认截止时间。` : "",
  ].filter(Boolean).slice(0, 3);
  const days = Array.from({ length: 7 }, (_, index) => format(subDays(parseISO(range.end), 6 - index), "yyyy-MM-dd"));
  const maxDayDone = Math.max(1, ...days.map(day => data.tasks.filter(task => task.status === "Done" && formatLocalDate(task.completedAt) === day).length));
  const taskPercent = allocation.totalSeconds ? allocation.taskSeconds / allocation.totalSeconds * 100 : 0;
  const meetingPercent = allocation.totalSeconds ? allocation.meetingSeconds / allocation.totalSeconds * 100 : 0;
  const reflectionPercent = Math.max(0, 100 - taskPercent - meetingPercent);

  return <div className="analytics-v2">
    <div className="analytics-v2-toolbar panel">
      <div><span className="eyebrow">ANALYTICS DASHBOARD</span><h2>工作分析中心</h2><p>{range.start} - {range.end}</p></div>
      <div className="analytics-tabs">{[["week","本周"],["month","本月"],["custom","自定义"]].map(([id,label]) => <button key={id} className={cn(period===id&&"active")} onClick={()=>setPeriod(id as typeof period)}>{label}</button>)}</div>
      {period === "custom" && <div className="period-actions"><input type="date" value={customStart} onChange={event=>setCustomStart(event.target.value)} /><input type="date" value={customEnd} onChange={event=>setCustomEnd(event.target.value)} /></div>}
    </div>

    <section className="panel executive-summary-v2">
      <div className="analytics-section-head"><span>01</span><div><h2>Executive Summary</h2><p>最近工作得怎么样</p></div></div>
      <div className="executive-hero-grid">
        <div className="executive-hero-card"><span>{range.label}总工时</span><strong>{(summary.totalSeconds / 3600).toFixed(1)}<small>h</small></strong><em>{trend(summary.totalSeconds, previousSummary.totalSeconds, "seconds")}</em></div>
        <div className="executive-mini-grid">
          <AnalyticsMetric label="完成率" value={completionRate.toFixed(0)} unit="%" trend={trend(completionRate, previousCompletionRate, "percent")} />
          <AnalyticsMetric label="会议" value={meetingAnalytics.meetings.length} unit="场" trend={trend(meetingAnalytics.meetings.length, previous.meetings.length, "count")} />
          <AnalyticsMetric label="项目" value={summary.projectSeconds.length} unit="个" trend={trend(summary.projectSeconds.length, previousSummary.projectSeconds.length, "count")} />
          <AnalyticsMetric label="平均任务耗时" value={(avgTaskSeconds / 3600).toFixed(1)} unit="h" trend={trend(avgTaskSeconds, previousAvgTaskSeconds, "seconds")} />
        </div>
      </div>
    </section>

    <section className="panel time-allocation-v2">
      <div className="analytics-section-head"><span>02</span><div><h2>Time Allocation</h2><p>时间花到哪里去了</p></div><button className="text-action" onClick={()=>setDetail("time")}>查看更多 <ArrowRight size={14}/></button></div>
      <div className="allocation-dashboard-grid">
        <div className="donut-card">
          <div className="donut-chart" style={{ background: `conic-gradient(#6d5df5 0 ${taskPercent}%, #22c55e ${taskPercent}% ${taskPercent + meetingPercent}%, #f59e0b ${taskPercent + meetingPercent}% 100%)` }}><div><strong>{(allocation.totalSeconds / 3600).toFixed(1)}h</strong><span>总投入</span></div></div>
          <div className="donut-legend"><span><i className="purple-dot"/>任务 {taskPercent.toFixed(0)}%</span><span><i className="green-dot"/>会议 {meetingPercent.toFixed(0)}%</span><span><i className="amber-dot"/>其它 {reflectionPercent.toFixed(0)}%</span></div>
        </div>
        <div className="top-project-card"><h3>Top 5 项目投入</h3>{allocation.projectSeconds.slice(0, 5).length ? allocation.projectSeconds.slice(0, 5).map(row => <MetricBar key={row.project.id} label={row.project.name} value={`${(row.seconds / 3600).toFixed(1)}h`} percent={allocation.totalSeconds ? row.seconds / allocation.totalSeconds * 100 : 0} />) : <div className="compact-empty"><FolderKanban size={18}/><span>暂无项目投入</span></div>}</div>
      </div>
    </section>

    <section className="panel performance-v2">
      <div className="analytics-section-head"><span>03</span><div><h2>Performance</h2><p>执行状态、任务耗时与会议负载</p></div><button className="text-action" onClick={()=>setDetail("tasks")}>查看明细 <ArrowRight size={14}/></button></div>
      <div className="performance-kpis">
        <span>完成率 <b>{taskAnalytics.completionRate.toFixed(0)}%</b></span>
        <span>延期 <b>{taskAnalytics.overdue.length}</b></span>
        <span>Waiting <b>{taskAnalytics.waiting.length}</b></span>
        <span>高优未完成 <b>{highPriorityOpen}</b></span>
        <span>平均耗时 <b>{(taskAnalytics.averageTaskSeconds / 3600).toFixed(1)}h</b></span>
      </div>
      <div className="performance-grid">
        <div><h3>Top 5 耗时任务</h3>{topTasks.length ? topTasks.map(task => <button className="analytics-mini-row" key={task.id} onClick={()=>onTask(task)}><span>{task.title}</span><b>{durationLabel(taskSeconds(task))}</b></button>) : <div className="compact-empty"><ListTodo size={18}/><span>暂无任务耗时</span></div>}</div>
        <div><h3>最近 7 天趋势</h3><div className="trend-bars">{days.map(day => { const count = data.tasks.filter(task => task.status === "Done" && formatLocalDate(task.completedAt) === day).length; return <div key={day}><i style={{height:`${Math.max(8, count / maxDayDone * 70)}px`}}/><span>{format(parseISO(day), "MM/dd")}</span><b>{count}</b></div> })}</div></div>
      </div>
      <div className="meeting-summary-strip">
        <span>总会议 <b>{meetingAnalytics.meetings.length}</b></span>
        <span>总时长 <b>{(meetingSeconds / 3600).toFixed(1)}h</b></span>
        <span>平均时长 <b>{(avgMeetingSeconds / 60).toFixed(0)}min</b></span>
        <div>{topMeetings.slice(0, 3).length ? topMeetings.slice(0, 3).map(meeting => <button key={meeting.id} onClick={()=>onMeeting(meeting)}>{meeting.title}<b>{meetingDurationMinutes(meeting)}min</b></button>) : <em>暂无会议记录</em>}</div>
      </div>
    </section>

    <section className="panel ai-insights-v2">
      <div className="analytics-section-head"><span>04</span><div><h2>AI Insights</h2><p>只保留 3 条可行动洞察</p></div></div>
      <div className="insight-card-grid">
        {insights.length ? insights.map((insight, index) => <div key={insight} className={cn("analytics-insight-row", index === 1 && "warning", index === 2 && "idea")}><Sparkles size={18}/><strong>{index === 0 ? "重点投入" : index === 1 ? "风险信号" : "行动建议"}</strong><p>{insight}</p></div>) : <div className="analytics-insight-row"><Sparkles size={18}/><strong>暂无明显异常</strong><p>这个周期的数据较少，继续记录后会生成洞察。</p></div>}
      </div>
    </section>

    <AnalyticsDetailsDialog open={!!detail} kind={detail} data={data} stats={stats} start={range.start} end={range.end} onClose={()=>setDetail(null)} onTask={onTask} onMeeting={onMeeting} onReflection={onReflection} />
  </div>;
}

function AnalyticsMetric({ label, value, unit, trend }: { label: string; value: string | number; unit: string; trend: string }) {
  return <div className="executive-card"><span>{label}</span><strong>{value}<small>{unit}</small></strong><em>{trend}</em></div>;
}

function MetricBar({ label, value, percent }: { label: string; value: string; percent: number }) {
  return <div className="metric-bar-row"><div><span>{label}</span><b>{value}</b></div><div className="rank-bar"><i style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} /></div><small>{percent.toFixed(0)}%</small></div>;
}

function WeeklyAnalytics({ data, weekStart, setWeekStart, onTask, onMeeting, onReflection }: { data: WorkData; weekStart: string; setWeekStart: (s: string) => void; onTask: (t: Task) => void; onMeeting: (m: Meeting) => void; onReflection: (r: Reflection) => void }) {
  const startDate = parseISO(weekStart), end = format(endOfWeek(startDate, { weekStartsOn: 1 }), "yyyy-MM-dd"), stats = rangeStats(data, weekStart, end);
  const days = Array.from({ length: 7 }, (_, i) => addDays(startDate, i));
  const [detail, setDetail] = useState<AnalyticsDetailKind | null>(null);
  const openEvent = (event: AnalyticsEvent) => event.task ? onTask(event.task) : event.meeting ? onMeeting(event.meeting) : event.reflection ? onReflection(event.reflection) : undefined;
  return <div className="analytics-section">
    <div className="analytics-period panel"><div><span className="eyebrow">WEEKLY OVERVIEW</span><h2>{format(startDate, "yyyy 'W'II")} </h2><p>{weekStart} - {end}</p></div><div className="period-actions"><button className="secondary" onClick={()=>setWeekStart(format(addWeeks(startDate,-1),"yyyy-MM-dd"))}>上一周</button><input type="date" value={weekStart} onChange={e=>setWeekStart(format(startOfWeek(parseISO(e.target.value),{weekStartsOn:1}),"yyyy-MM-dd"))}/><button className="secondary" onClick={()=>setWeekStart(format(addWeeks(startDate,1),"yyyy-MM-dd"))}>下一周</button></div></div>
    <AnalyticsStatCards stats={stats} rangeLabel="本周范围" onDetail={setDetail} />
    <section className="panel weekly-timeline"><PanelHead title="周工作时间轴" sub="按日期纵向展示真实计时、会议与复盘记录" />{stats.events.length ? <div className="vertical-timeline">{days.map(day => { const date = format(day,"yyyy-MM-dd"), events = stats.events.filter(e=>e.date===date).sort((a,b)=>a.startHour-b.startHour); return <section className="vertical-timeline-day" key={date}><div className="vertical-day-head"><div><b>{format(day,"EEEE",{locale:zhCN})}</b><span>{format(day,"MM/dd")}</span></div><em>{events.length ? `${events.length} 条记录` : "无记录"}</em></div><div className="vertical-day-events">{events.length?events.map(e=><button key={e.id} className="vertical-event-card" onClick={()=>openEvent(e)}><i style={{background:e.color}}/><div className="vertical-event-time">{eventTimeLabel(e)}</div><div className="vertical-event-main"><span style={{color:e.color}}>{e.kind}</span><strong>{e.title}</strong><small>{durationLabel(e.durationSeconds)} · {projectName(data.projects,e.projectId)}</small></div></button>):<p>这一天还没有记录。</p>}</div></section> })}</div> : <EmptyState icon={Timer} title="本周还没有可分析时间记录" text="开始任务计时或记录会议后，这里会出现时间轴。"/>}</section>
    <div className="analytics-grid"><ProjectRank data={data} rows={stats.projectSeconds.slice(0,10)} title="本周项目投入排行" /><MeetingRank data={data} meetings={stats.meetings} title="会议排行" onMeeting={onMeeting} /><TaskStatusPanel stats={stats} /></div>
    <MeetingAnalysis data={data} stats={stats} onDetail={setDetail} onMeeting={onMeeting} />
    <AnalyticsDetailsDialog open={!!detail} kind={detail} data={data} stats={stats} start={weekStart} end={end} onClose={()=>setDetail(null)} onTask={onTask} onMeeting={onMeeting} onReflection={onReflection} />
  </div>;
}

function MonthlyAnalytics({ data, month, setMonth, onTask, onMeeting, onReflection }: { data: WorkData; month: string; setMonth: (m: string) => void; onTask: (t: Task) => void; onMeeting: (m: Meeting) => void; onReflection: (r: Reflection) => void }) {
  const start = `${month}-01`, end = format(endOfMonth(parseISO(start)), "yyyy-MM-dd"), stats = rangeStats(data, start, end);
  const [detail, setDetail] = useState<AnalyticsDetailKind | null>(null);
  const kinds: [AnalyticsEvent["kind"], string][] = [["任务","任务"],["会议","会议"],["复盘","思考"]];
  return <div className="analytics-section">
    <div className="analytics-period panel"><div><span className="eyebrow">MONTHLY OVERVIEW</span><h2>{format(parseISO(start),"yyyy年M月")}</h2><p>{start} - {end}</p></div><div className="period-actions"><input type="month" value={month} onChange={e=>setMonth(e.target.value)}/></div></div>
    <AnalyticsStatCards stats={stats} rangeLabel="本月范围" onDetail={setDetail} />
    <div className="analytics-grid"><section className="panel donut-panel"><PanelHead title="月度时间投入统计" sub="按记录类型拆分时间" />{stats.totalSeconds ? <div className="time-split">{kinds.map(([kind,label])=>{const seconds=stats.byKind(kind),pct=stats.totalSeconds?seconds/stats.totalSeconds*100:0;return <div key={kind} className="rank-row"><span>{label}</span><div className="rank-bar"><i style={{width:`${pct}%`}}/></div><b>{(seconds/3600).toFixed(1)}h · {pct.toFixed(0)}%</b></div>})}</div> : <EmptyState icon={BarChart3} title="本月暂无时间记录" text="记录任务计时、会议或复盘后会自动统计。"/>}</section><ProjectRank data={data} rows={stats.projectSeconds.slice(0,10)} title="项目耗时排行" /></div>
    <div className="analytics-grid"><MeetingRank data={data} meetings={stats.meetings} title="会议排行" onMeeting={onMeeting} /><MeetingAnalysis data={data} stats={stats} onDetail={setDetail} onMeeting={onMeeting} /></div>
    <section className="panel reflection-month"><PanelHead title="本月复盘思考汇总" sub="按项目归类展示 Reflection" />{stats.reflections.length ? data.projects.map(p=>({project:p,refs:stats.reflections.filter(r=>r.relatedProjectId===p.id)})).filter(x=>x.refs.length).map(x=><div className="reflection-group" key={x.project.id}><h3>{x.project.name}</h3>{x.refs.map(r=><div className="linked-row" key={r.id}><Brain size={16}/><div><strong>{r.title}</strong><span>{r.type} · {r.tags.join("、") || "无标签"}</span></div></div>)}</div>) : <EmptyState icon={Brain} title="本月暂无复盘" text="复盘会在这里按项目自动聚合。"/>}</section>
    <AnalyticsDetailsDialog open={!!detail} kind={detail} data={data} stats={stats} start={start} end={end} onClose={()=>setDetail(null)} onTask={onTask} onMeeting={onMeeting} onReflection={onReflection} />
  </div>;
}

function CustomAnalytics({ data, start, end, setStart, setEnd, onTask, onMeeting, onReflection }: { data: WorkData; start: string; end: string; setStart: (s: string) => void; setEnd: (s: string) => void; onTask: (t: Task) => void; onMeeting: (m: Meeting) => void; onReflection: (r: Reflection) => void }) {
  const safeEnd = end < start ? start : end, stats = rangeStats(data, start, safeEnd);
  const [detail, setDetail] = useState<AnalyticsDetailKind | null>(null);
  return <div className="analytics-section"><FilterBar><label>开始 <input type="date" value={start} onChange={e=>setStart(e.target.value)}/></label><label>结束 <input type="date" value={end} onChange={e=>setEnd(e.target.value)}/></label><span>{start} - {safeEnd}</span></FilterBar>
    <AnalyticsStatCards stats={stats} rangeLabel={`${daysBetween(start,safeEnd)} 天范围`} onDetail={setDetail} />
    <div className="analytics-grid"><ProjectRank data={data} rows={stats.projectSeconds.slice(0,10)} title="项目排行" /><TaskRank tasks={stats.tasks} /><MeetingRank data={data} meetings={stats.meetings} title="会议排行" onMeeting={onMeeting} /></div>
    <MeetingAnalysis data={data} stats={stats} onDetail={setDetail} onMeeting={onMeeting} />
    <section className="panel"><PanelHead title="复盘汇总" sub="所选时间范围内的思考沉淀" />{stats.reflections.length ? stats.reflections.map(r=><div className="linked-row" key={r.id}><Brain size={16}/><div><strong>{r.title}</strong><span>{r.type} · {projectName(data.projects,r.relatedProjectId)}</span></div></div>) : <EmptyState icon={Brain} title="暂无复盘记录" text="调整时间范围或新增复盘后再查看。"/>}</section>
    <AnalyticsDetailsDialog open={!!detail} kind={detail} data={data} stats={stats} start={start} end={safeEnd} onClose={()=>setDetail(null)} onTask={onTask} onMeeting={onMeeting} onReflection={onReflection} />
  </div>;
}

function AnalyticsStatCards({ stats, rangeLabel, onDetail }: { stats: ReturnType<typeof rangeStats>; rangeLabel: string; onDetail: (kind: AnalyticsDetailKind) => void }) {
  return <div className="stats-grid">
    <StatCard label="时间统计" value={+(stats.totalSeconds/3600).toFixed(1)} unit="h" detail={rangeLabel} icon={Timer} tone="purple" onClick={()=>onDetail("time")} />
    <StatCard label="任务记录" value={stats.tasks.length} unit="项" detail={`${stats.completed.length} 项完成`} icon={ListTodo} tone="green" onClick={()=>onDetail("tasks")} />
    <StatCard label="会议记录" value={stats.meetings.length} unit="场" detail={`${(stats.byKind("会议")/3600).toFixed(1)}h 会议投入`} icon={CalendarDays} tone="blue" onClick={()=>onDetail("meetings")} />
    <StatCard label="复盘记录" value={stats.reflections.length} unit="条" detail="所选范围内复盘" icon={Brain} tone="orange" onClick={()=>onDetail("reflections")} />
  </div>;
}

function AnalyticsDetailsDialog({ open, kind, data, stats, start, end, onClose, onTask, onMeeting, onReflection }: { open: boolean; kind: AnalyticsDetailKind | null; data: WorkData; stats: ReturnType<typeof rangeStats>; start: string; end: string; onClose: () => void; onTask: (t: Task) => void; onMeeting: (m: Meeting) => void; onReflection: (r: Reflection) => void }) {
  const title = kind === "time" ? "时间统计明细" : kind === "tasks" ? "任务记录明细" : kind === "meetings" ? "会议记录明细" : kind === "meetingProjects" ? "会议项目耗时构成" : kind === "meetingAttendees" ? "会议参会人构成" : "复盘记录明细";
  const empty = <EmptyState icon={Search} title="当前时间范围内暂无记录" text={`${start} - ${end} 没有可展示的明细。`} />;
  const meetingProjectRows = data.projects.map(p => ({ project:p, meetings: stats.meetings.filter(m=>m.relatedProjectId===p.id), seconds: stats.meetings.filter(m=>m.relatedProjectId===p.id).reduce((s,m)=>s+meetingDurationMinutes(m)*60,0) })).filter(x=>x.seconds>0).sort((a,b)=>b.seconds-a.seconds);
  const attendeeMap = new Map<string,{count:number;seconds:number;meetings:Meeting[]}>();
  stats.meetings.forEach(m => (m.attendees.length?m.attendees:["未记录"]).forEach(name => attendeeMap.set(name,{count:(attendeeMap.get(name)?.count||0)+1,seconds:(attendeeMap.get(name)?.seconds||0)+meetingDurationMinutes(m)*60,meetings:[...(attendeeMap.get(name)?.meetings||[]),m]})));
  const attendeeRows = [...attendeeMap.entries()].sort((a,b)=>b[1].seconds-a[1].seconds);
  return <DrillDownDrawer open={open} onClose={onClose} title={title} subtitle={`${start} - ${end}`}>
    <div className="analytics-detail-list">
      {kind === "time" && (stats.events.length ? [...stats.events].sort((a,b)=>a.date.localeCompare(b.date)||a.startHour-b.startHour).map(e=><button className="analytics-detail-card" key={e.id} onClick={()=>e.task?onTask(e.task):e.meeting?onMeeting(e.meeting):e.reflection?onReflection(e.reflection):undefined}><span className="detail-type" style={{color:e.color}}>{e.kind}</span><div><strong>{e.title}</strong><p>{e.date} · {eventTimeLabel(e)} · {durationLabel(e.durationSeconds)}</p><small>{projectName(data.projects,e.projectId)}</small></div></button>) : empty)}
      {kind === "tasks" && (stats.tasks.length ? stats.tasks.map(t=><button className="analytics-detail-card" key={t.id} onClick={()=>onTask(t)}><span className={`priority ${t.priority.toLowerCase()}`}>{t.priority}</span><div><strong>{t.title}</strong><p>{t.status} · {projectName(data.projects,t.projectId)} · 截止 {t.dueDate || "未设置"}</p><small>实际耗时 {durationLabel(taskSeconds(t))}</small></div></button>) : empty)}
      {kind === "meetings" && (stats.meetings.length ? stats.meetings.map(m=><button className="analytics-detail-card" key={m.id} onClick={()=>onMeeting(m)}><span className="detail-type meeting">会议</span><div><strong>{m.title}</strong><p>{meetingTimeRange(m)} · {projectName(data.projects,m.relatedProjectId)} · {meetingDurationMinutes(m)} 分钟</p><small>{m.attendees.join("、") || "未记录参会人"} · {m.actionItems.length} 个行动项</small></div></button>) : empty)}
      {kind === "reflections" && (stats.reflections.length ? stats.reflections.map(r=><button className="analytics-detail-card" key={r.id} onClick={()=>onReflection(r)}><span className="detail-type reflection">复盘</span><div><strong>{r.title}</strong><p>{r.date} · {r.type} · {projectName(data.projects,r.relatedProjectId)}</p><small>{(r.content || "暂无内容").slice(0,80)}{(r.content || "").length>80?"...":""} · {r.durationMinutes || 0} 分钟</small></div></button>) : empty)}
      {kind === "meetingProjects" && (meetingProjectRows.length ? meetingProjectRows.map(row=><div className="analytics-detail-card" key={row.project.id}><span className="detail-type meeting">项目</span><div><strong>{row.project.name}</strong><p>{(row.seconds/3600).toFixed(1)}h · {row.meetings.length} 场会议</p><small>{row.meetings.map(m=>m.title).join("、")}</small></div></div>) : empty)}
      {kind === "meetingAttendees" && (attendeeRows.length ? attendeeRows.map(([name,row])=><div className="analytics-detail-card" key={name}><span className="detail-type meeting">人员</span><div><strong>{name}</strong><p>{row.count} 场会议 · {(row.seconds/3600).toFixed(1)}h</p><small>{row.meetings.map(m=>m.title).join("、")}</small></div></div>) : empty)}
    </div>
    <div className="drawer-foot"><span>点击明细可进入对应详情</span><button className="secondary" onClick={onClose}>关闭</button></div>
  </DrillDownDrawer>;
}

function MeetingAnalysis({ data, stats, onDetail, onMeeting }: { data: WorkData; stats: ReturnType<typeof rangeStats>; onDetail: (kind: AnalyticsDetailKind) => void; onMeeting: (m: Meeting) => void }) {
  const total = stats.byKind("会议"), meetings = [...stats.meetings].sort((a,b)=>meetingDurationMinutes(b)-meetingDurationMinutes(a)), actionCount = stats.meetings.reduce((s,m)=>s+m.actionItems.length,0), avg = stats.meetings.length ? total / stats.meetings.length : 0;
  const byProject = data.projects.map(p => ({ name: p.name, seconds: stats.meetings.filter(m=>m.relatedProjectId===p.id).reduce((s,m)=>s+meetingDurationMinutes(m)*60,0) })).filter(x=>x.seconds>0).sort((a,b)=>b.seconds-a.seconds);
  const attendeeMap = new Map<string,{count:number;seconds:number}>();
  stats.meetings.forEach(m => (m.attendees.length?m.attendees:["未记录"]).forEach(name => attendeeMap.set(name,{count:(attendeeMap.get(name)?.count||0)+1,seconds:(attendeeMap.get(name)?.seconds||0)+meetingDurationMinutes(m)*60})));
  const attendees = [...attendeeMap.entries()].sort((a,b)=>b[1].seconds-a[1].seconds).slice(0,8);
  return <section className="panel meeting-analysis"><PanelHead title="会议分析" sub="会议占用时间、行动项与协作对象" />{stats.meetings.length ? <>
    <div className="meeting-metrics"><button onClick={()=>onDetail("meetings")}><b>{stats.meetings.length}</b><span>本周期会议</span></button><button onClick={()=>onDetail("meetings")}><b>{(total/3600).toFixed(1)}h</b><span>会议总时长</span></button><button onClick={()=>onDetail("meetings")}><b>{(avg/3600).toFixed(1)}h</b><span>平均时长</span></button><button onClick={()=>onDetail("meetings")}><b>{stats.totalSeconds ? (total/stats.totalSeconds*100).toFixed(0) : 0}%</b><span>占总时间</span></button><button onClick={()=>onDetail("meetings")}><b>{actionCount}</b><span>行动项</span></button></div>
    <div className="meeting-analysis-grid"><div><h3>最耗时会议</h3>{meetings.slice(0,5).map(m=><button className="meeting-mini-row" key={m.id} onClick={()=>onMeeting(m)}><span>{m.title}</span><b>{(meetingDurationMinutes(m)/60).toFixed(1)}h</b></button>)}</div><div><h3>按项目统计</h3>{byProject.length?byProject.map(x=><button className="meeting-mini-row" key={x.name} onClick={()=>onDetail("meetingProjects")}><span>{x.name}</span><b>{(x.seconds/3600).toFixed(1)}h</b></button>):<p>暂无关联项目会议</p>}</div><div><h3>按参会人员统计</h3>{attendees.map(([name,row])=><button className="meeting-mini-row" key={name} onClick={()=>onDetail("meetingAttendees")}><span>{name} · {row.count} 场</span><b>{(row.seconds/3600).toFixed(1)}h</b></button>)}</div></div>
  </> : <EmptyState icon={CalendarDays} title="暂无会议分析" text="所选范围内没有会议记录。"/>}</section>;
}

function ProjectTimeline({ data }: { data: WorkData }) {
  const projects = data.projects.map(p => { const tasks = relatedProjectTasks(data,p), progress = projectProgressSummary(p,tasks), seconds = tasks.reduce((s,t)=>s+taskSeconds(t),0), estimated = tasks.reduce((s,t)=>s+t.estimatedHours*3600,0), overdue = p.dueDate && p.dueDate < todayISO() && p.status !== "Done"; return { project:p, tasks, progress, seconds, estimated, overdue, overBudget: estimated > 0 && seconds > estimated }; });
  if (!projects.length) return <EmptyState icon={FolderKanban} title="暂无项目" text="创建项目后会生成项目时间线。"/>;
  return <div className="analytics-section"><section className="panel project-timeline"><PanelHead title="项目时间线" sub="项目开始时间、截止时间、进度、实际耗时与风险" />{projects.map(row => <div className={cn("project-line", row.overdue && "late", row.overBudget && "over")} key={row.project.id}><div><strong>{row.project.name}</strong><span>{row.project.startDate || "未设置"} → {row.project.dueDate || "未设置"} · {row.progress.progress}% · 任务 {row.progress.completed}/{row.progress.total}</span></div><div className="project-line-track"><i style={{width:`${Math.max(4,row.progress.progress)}%`}}/></div><b>{(row.seconds/3600).toFixed(1)}h</b><em>{row.overdue ? "已超期" : row.overBudget ? "超预计" : "正常"}</em></div>)}</section></div>;
}

function ProjectRank({ data, rows, title }: { data: WorkData; rows: { project: Project; seconds: number; tasks: Task[] }[]; title: string }) {
  const max = Math.max(1, ...rows.map(r=>r.seconds));
  return <section className="panel rank-panel"><PanelHead title={title} sub="按实际耗时排序" />{rows.length ? rows.map(r=><div className="rank-row" key={r.project.id}><span>{r.project.name}</span><div className="rank-bar"><i style={{width:`${r.seconds/max*100}%`}}/></div><b>{(r.seconds/3600).toFixed(1)}h</b></div>) : <EmptyState icon={FolderKanban} title="暂无项目投入数据" text="任务计时或会议关联项目后会自动统计。"/>}</section>;
}
function MeetingRank({ data, meetings, title, onMeeting }: { data: WorkData; meetings: Meeting[]; title: string; onMeeting: (m: Meeting) => void }) {
  const list = [...meetings].sort((a,b)=>meetingDurationMinutes(b)-meetingDurationMinutes(a)).slice(0,10);
  const max = Math.max(1, ...list.map(m=>meetingDurationMinutes(m)*60));
  return <section className="panel rank-panel"><PanelHead title={title} sub="按会议耗时排序" />{list.length ? list.map(m=>{const seconds=meetingDurationMinutes(m)*60;return <button className="meeting-rank-row" key={m.id} onClick={()=>onMeeting(m)}><div><strong title={m.title}>{m.title}</strong><span>{projectName(data.projects,m.relatedProjectId)} · {meetingTimeRange(m)} · {m.actionItems.length} 个行动项</span></div><div className="rank-bar"><i style={{width:`${seconds/max*100}%`}}/></div><b>{(seconds/3600).toFixed(1)}h</b></button>}) : <EmptyState icon={CalendarDays} title="暂无会议排行" text="所选范围内没有会议记录。"/>}</section>;
}
function TaskStatusPanel({ stats }: { stats: ReturnType<typeof rangeStats> }) { return <section className="panel task-status-panel"><PanelHead title="任务完成情况" sub="本周期完成、进行中、延期和等待事项" /><div className="status-list"><div><b>{stats.completed.length}</b><span>完成任务</span></div><div><b>{stats.tasks.filter(t=>t.status==="Doing").length}</b><span>进行中任务</span></div><div><b>{stats.overdue.length}</b><span>延期任务</span></div><div><b>{stats.waiting.length}</b><span>等待事项</span></div></div></section> }
function TaskRank({ tasks }: { tasks: Task[] }) { const list=[...tasks].sort((a,b)=>taskSeconds(b)-taskSeconds(a)).slice(0,10);return <section className="panel rank-panel"><PanelHead title="任务排行" sub="按实际耗时排序" />{list.length?list.map(t=><div className="rank-row" key={t.id}><span>{t.title}</span><div className="rank-bar"><i style={{width:`${Math.min(100,taskSeconds(t)/Math.max(1,taskSeconds(list[0]))*100)}%`}}/></div><b>{(taskSeconds(t)/3600).toFixed(1)}h</b></div>):<EmptyState icon={ListTodo} title="暂无任务数据" text="所选范围内没有任务记录。"/>}</section> }

function Dashboard({ data, setView, onTask }: { data: WorkData; setView: (v: View) => void; onTask: (t: Task) => void }) {
  const today = todayISO();
  const weekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd");
  const weekEnd = format(endOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd");
  const openTasks = data.tasks.filter(task => task.status !== "Done" && task.status !== "Inbox");
  const todayDue = openTasks.filter(task => task.dueDate === today);
  const overdue = openTasks.filter(task => !!task.dueDate && task.dueDate < today);
  const todayMeetings = data.meetings.filter(meeting => meetingHasTime(meeting) && formatLocalDate(meetingStartValue(meeting)) === today).sort((a, b) => meetingStartValue(a).localeCompare(meetingStartValue(b)));
  const waiting = openTasks.filter(task => task.status === "Waiting");
  const oldWaiting = waiting.filter(task => {
    const base = task.followUpDate || task.createdAt;
    return !!base && daysBetween(formatLocalDate(base), today) > 5;
  });
  const highNotStarted = openTasks.filter(task => task.status === "Todo" && ["P0", "P1"].includes(task.priority));
  const heavyTasks = openTasks.filter(task => task.estimatedHours >= 4);
  const weekDone = data.tasks.filter(task => task.status === "Done" && inDateRange(task.completedAt, weekStart, weekEnd));
  const weekStats = rangeStats(data, weekStart, weekEnd);
  const focusTasks = sortTasksByExecutionPriority(openTasks.filter(task => task.status !== "Waiting")).slice(0, 5);
  const suggestedTask = sortTasksByExecutionPriority([
    ...todayDue.filter(task => ["P0", "P1"].includes(task.priority)),
    ...overdue.filter(task => ["P0", "P1"].includes(task.priority)),
    ...highNotStarted,
    ...todayDue,
    ...focusTasks,
  ])[0];
  const focusReason = suggestedTask
    ? suggestedTask.dueDate === today && ["P0", "P1"].includes(suggestedTask.priority) ? "P0/P1 且今天截止"
      : suggestedTask.dueDate && suggestedTask.dueDate < today ? "高优任务已延期"
        : suggestedTask.status === "Todo" && ["P0", "P1"].includes(suggestedTask.priority) ? "高优任务尚未开始"
          : "今天可推进的关键任务"
    : todayMeetings.length >= 4 ? "今日会议密集，需要预留缓冲"
      : oldWaiting.length ? "Waiting 事项已超过 5 天"
        : "今日没有明显阻塞，适合安排深度工作";
  const timeline = [
    ...todayMeetings.map(meeting => ({ id: meeting.id, kind: "meeting" as const, time: formatLocalTime(meetingStartValue(meeting)), minute: localHour(meetingStartValue(meeting)) * 60, title: meeting.title, detail: meetingTimeRange(meeting), onClick: () => setView("meetings") })),
    ...todayDue.map(task => ({ id: task.id, kind: "task" as const, time: "18:00", minute: 18 * 60, title: `截止：${task.title}`, detail: `${task.priority} · ${projectName(data.projects, task.projectId)}`, onClick: () => onTask(task) })),
    ...openTasks.filter(task => task.status === "Doing").slice(0, 4).map((task, index) => ({ id: `doing-${task.id}`, kind: "task" as const, time: "现在", minute: 7 * 60 + index, title: task.title, detail: `进行中 · ${projectName(data.projects, task.projectId)}`, onClick: () => onTask(task) })),
  ].sort((a, b) => a.minute - b.minute);
  const riskGroups = [
    { title: "今天截止", rows: todayDue },
    { title: "已延期", rows: overdue },
    { title: "Waiting 超过 5 天", rows: oldWaiting },
    { title: "高优任务未开始", rows: highNotStarted },
    { title: "预计工时过高", rows: heavyTasks },
  ];
  const activeProjects = data.projects.filter(project => project.status === "Active").map(project => {
    const tasks = data.tasks.filter(task => task.projectId === project.id);
    const progress = projectProgressFromData(data, project);
    const risks = tasks.filter(task => task.status !== "Done" && ((task.dueDate && task.dueDate < today) || task.status === "Waiting")).length;
    return { project, tasks, progress, risks };
  }).sort((a, b) => b.tasks.length - a.tasks.length || b.risks - a.risks).slice(0, 5);
  const insights = [
    weekStats.projectSeconds[0] && weekStats.totalSeconds ? `本周 ${Math.round(weekStats.projectSeconds[0].seconds / weekStats.totalSeconds * 100)}% 工时投入 ${weekStats.projectSeconds[0].project.name}` : "",
    todayMeetings.length ? `今天有 ${todayMeetings.length} 场会议，注意保留会后处理时间` : "今日会议较少，适合安排深度工作",
  ].filter(Boolean).slice(0, 2);
  const [detail, setDetail] = useState<DashboardDetailKind | null>(null);
  return <div className="daily-brief daily-simple-stack">
    <div className="stats-grid daily-kpis">
      <StatCard label="今日待办" value={todayDue.length} unit="项" detail="今天截止和需要处理" icon={Target} tone="purple" onClick={()=>setDetail("today")} />
      <StatCard label="进行中" value={openTasks.filter(task=>task.status==="Doing").length} unit="项" detail="正在推进的任务" icon={Play} tone="blue" onClick={()=>setView("tasks")} />
      <StatCard label="今日会议" value={todayMeetings.length} unit="场" detail="按本地时间展示" icon={CalendarDays} tone="green" onClick={()=>setView("meetings")} />
      <StatCard label="等待反馈" value={waiting.length} unit="项" detail="依赖他人反馈" icon={Clock3} tone="orange" onClick={()=>setDetail("risks")} />
      <StatCard label="超时风险" value={overdue.length + highNotStarted.length} unit="项" detail="延期或高优未开始" icon={BarChart3} tone="blue" onClick={()=>setDetail("risks")} />
      <StatCard label="本周完成" value={weekDone.length} unit="项" detail={`累计 ${durationLabel(weekDone.reduce((sum, task) => sum + taskSeconds(task), 0))}`} icon={CheckCircle2} tone="green" onClick={()=>setView("tasks")} />
    </div>
    <section className="panel focus-panel"><PanelHead title="今日重点任务" sub="高优、今天截止和已延期任务优先展示" action="查看全部任务" onAction={()=>setView("tasks")} />
      <div className="daily-focus-list">{focusTasks.length ? focusTasks.map(task => <button className="focus-task-row" key={task.id} onClick={()=>onTask(task)}><span className={`priority ${task.priority.toLowerCase()}`}>{task.priority}</span><div><strong>{task.title}</strong><p>{projectName(data.projects, task.projectId)} · 截止 {task.dueDate || "未设置"} · 预计 {hoursLabel(task.estimatedHours)}</p></div><em>{task.status}</em><Play size={15}/></button>) : <EmptyState icon={ListTodo} title="今天没有重点任务" text="可以从收集箱整理输入，或安排一段深度工作。"/>}</div>
    </section>
    <section className="panel daily-timeline"><PanelHead title="今日时间轴" sub="会议、截止任务和正在进行的工作" action="会议中心" onAction={()=>setView("meetings")} />
      {timeline.length ? <div className="timeline-list">{timeline.map(item => <button className="timeline-item" key={`${item.kind}-${item.id}`} onClick={item.onClick}><span>{item.time}</span><i>{item.kind === "meeting" ? <CalendarDays size={15}/> : <ListTodo size={15}/>}</i><div><strong>{item.title}</strong><small>{item.detail}</small></div></button>)}</div> : <EmptyState icon={Clock3} title="今天暂无固定安排" text="适合安排 1-2 段深度工作时间，先处理高优任务。"/>}
    </section>
    <DashboardDetailsDrawer kind={detail} data={data} suggestedTask={suggestedTask} focusReason={focusReason} todayTasks={todayDue} timeline={timeline} riskGroups={riskGroups} projects={activeProjects} insights={insights} onClose={()=>setDetail(null)} onTask={onTask} setView={setView} />
  </div>;
}

function DashboardDetailsDrawer({ kind, data, suggestedTask, focusReason, todayTasks, timeline, riskGroups, projects, insights, onClose, onTask, setView }: { kind: DashboardDetailKind | null; data: WorkData; suggestedTask?: Task; focusReason: string; todayTasks: Task[]; timeline: { id: string; kind: "meeting" | "task"; time: string; title: string; detail: string; onClick: () => void }[]; riskGroups: { title: string; rows: Task[] }[]; projects: { project: Project; tasks: Task[]; progress: { progress: number; completed: number; total: number }; risks: number }[]; insights: string[]; onClose: () => void; onTask: (t: Task) => void; setView: (v: View) => void }) {
  const title = kind === "focus" ? "今日行动建议原因" : kind === "today" ? "今日待办明细" : kind === "timeline" ? "今日时间轴明细" : kind === "projects" ? "项目进度明细" : kind === "insights" ? "最近洞察" : "风险提醒明细";
  return <DrillDownDrawer open={!!kind} onClose={onClose} title={title} subtitle="点击记录可进入对应详情">
    {kind === "focus" && <div className="drill-list">{suggestedTask ? <button className="drill-row" onClick={()=>onTask(suggestedTask)}><span className={`priority ${suggestedTask.priority.toLowerCase()}`}>{suggestedTask.priority}</span><div><strong>{suggestedTask.title}</strong><p>命中规则：{focusReason}</p><small>截止 {suggestedTask.dueDate || "未设置"} · 预计 {hoursLabel(suggestedTask.estimatedHours)} · {projectName(data.projects, suggestedTask.projectId)}</small></div></button> : <EmptyState icon={Sparkles} title="今天适合深度工作" text={focusReason}/>}</div>}
    {kind === "today" && <div className="drill-list">{todayTasks.length ? todayTasks.map(task => <button className="drill-row" key={task.id} onClick={()=>onTask(task)}><span className={`priority ${task.priority.toLowerCase()}`}>{task.priority}</span><div><strong>{task.title}</strong><p>{projectName(data.projects, task.projectId)} · {task.status}</p><small>截止 {task.dueDate || "未设置"} · 预计 {hoursLabel(task.estimatedHours)}</small></div></button>) : <EmptyState icon={Target} title="今日暂无截止任务" text="可以从重点任务中挑选一项推进。"/>}</div>}
    {kind === "timeline" && <div className="drill-list">{timeline.length ? timeline.map(item => <button className="drill-row" key={`${item.kind}-${item.id}`} onClick={item.onClick}><span>{item.time}</span><div><strong>{item.title}</strong><p>{item.detail}</p></div></button>) : <EmptyState icon={Clock3} title="今天暂无固定安排" text="建议安排深度工作时间。"/>}</div>}
    {kind === "risks" && <div className="drill-list">{riskGroups.some(group=>group.rows.length) ? riskGroups.map(group => group.rows.map(task => <button className="drill-row" key={`${group.title}-${task.id}`} onClick={()=>onTask(task)}><span className={`priority ${task.priority.toLowerCase()}`}>{task.priority}</span><div><strong>{task.title}</strong><p>{group.title} · {projectName(data.projects, task.projectId)}</p><small>操作：打开任务、更新状态或设置跟进日期</small></div></button>)) : <EmptyState icon={CheckCircle2} title="暂无明显风险" text="当前没有需要立即干预的风险。"/>}</div>}
    {kind === "projects" && <div className="drill-list">{projects.map(row => <button className="drill-row" key={row.project.id} onClick={()=>setView("projects")}><span>{row.progress.progress}%</span><div><strong>{row.project.name}</strong><p>任务 {row.tasks.length} · 风险 {row.risks}</p><small>{row.project.nextAction || "暂无下一步"}</small></div></button>)}</div>}
    {kind === "insights" && <div className="drill-list">{insights.map(insight => <button className="drill-row" key={insight} onClick={()=>setView("workAnalytics")}><Sparkles size={16}/><div><strong>{insight}</strong><p>进入工作分析中心查看完整数据</p></div></button>)}</div>}
    <div className="drawer-foot"><span>Daily Brief 只负责今天行动，深度分析请进入工作分析中心。</span><button className="secondary" onClick={onClose}>关闭</button></div>
  </DrillDownDrawer>;
}

function InboxView({ data, updateTask, deleteTask, query, notify }: { data: WorkData; updateTask:(id:string,p:Partial<Task>)=>void; deleteTask:(id:string)=>void; query:string; notify:(s:string)=>void }) {
  const list=data.tasks.filter(t=>t.status==="Inbox"&&fuzzyMatch(query, taskSearchFields(t, data)));
  return <section className="panel wide-panel"><div className="inbox-toolbar"><div><b>{list.length} 条待处理</b><span>把它们变成任务，或放心删掉</span></div><button className="ghost" onClick={()=>notify(list.length?"请逐条明确任务归属，避免误删":"收集箱已经是空的")}><Archive size={15}/> 整理提示</button></div><div className="inbox-list">{list.length?list.map(t=><div className="inbox-item" key={t.id}><div className="source-icon"><Inbox size={17}/></div><div className="inbox-content"><strong>{t.title}</strong><p>来自 {t.source} · {t.requester} · {t.createdAt}</p></div><div className="inbox-actions"><button className="secondary" onClick={()=>updateTask(t.id,{status:"Todo",dueDate:formatLocalDate(addDays(new Date(),3))})}>转为任务 <ArrowRight size={14}/></button><button className="icon-button" aria-label="删除" onClick={()=>{if(confirm(`删除“${t.title}”？`))deleteTask(t.id)}}><X size={16}/></button></div></div>):<EmptyState icon={Inbox} title="收集箱已清空" text="所有输入都已经有了去处。"/>}</div></section>;
}

type TaskCenterTab = "kanban" | "list" | "completed";
type CompletedQuickRange = "today" | "yesterday" | "week" | "month" | "all";
type CompletedSort = "completedAt" | "createdAt" | "dueDate" | "duration" | "priority";
type CompletedMetricKind = "weekDone" | "monthDone" | "weekTime" | "completionRate";
const priorityRank: Record<Priority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
const completedRange = (range: CompletedQuickRange) => {
  const now = new Date();
  if (range === "today") return { start: todayISO(), end: todayISO() };
  if (range === "yesterday") { const day = formatLocalDate(subDays(now, 1)); return { start: day, end: day }; }
  if (range === "week") return { start: formatLocalDate(startOfWeek(now, { weekStartsOn: 1 })), end: formatLocalDate(endOfWeek(now, { weekStartsOn: 1 })) };
  if (range === "month") return { start: formatLocalDate(startOfMonth(now)), end: formatLocalDate(endOfMonth(now)) };
  return { start: "", end: "" };
};
const requesterName = (task: Task, data: WorkData) => contactName(data.contacts || [], task.requesterContactId, task.requester || "未设置");
const isMeetingActionTask = (task: Task) => /会议|行动项|action/i.test(task.source || "");

function TaskCenter({ data, query, updateTask, deleteTask, notify, onOpen, onAdd, onComplete, onStartTimer, onPauseTimer, onStopTimer }: { data:WorkData; query:string; updateTask:(id:string,p:Partial<Task>)=>void; deleteTask:(id:string)=>void; notify:(s:string)=>void; onOpen:(t:Task)=>void; onAdd:(t?:Task)=>void; onComplete:(t:Task)=>void; onStartTimer:(t:Task)=>void; onPauseTimer:(t:Task)=>void; onStopTimer:(t:Task)=>void }) {
  const [tab,setTab]=useState<TaskCenterTab>("kanban");
  const [project,setProject]=useState("全部"),[priority,setPriority]=useState("全部"),[contact,setContact]=useState("全部");
  const [quick,setQuick]=useState<CompletedQuickRange>("week"),[source,setSource]=useState("全部"),[link,setLink]=useState("全部"),[sort,setSort]=useState<CompletedSort>("completedAt"),[start,setStart]=useState(""),[end,setEnd]=useState(""),[page,setPage]=useState(1);
  const [metric,setMetric]=useState<CompletedMetricKind|null>(null);
  const today = todayISO();
  const baseMatch = (t: Task) => t.status!=="Inbox" && fuzzyMatch(query, taskSearchFields(t, data)) && (project==="全部"||t.projectId===project) && (priority==="全部"||t.priority===priority) && (contact==="全部"||t.requesterContactId===contact||t.createdByContactId===contact||t.waitingForId===contact||(t.waitingForIds||[]).includes(contact));
  const updateStatus = (task: Task, value: TaskStatus) => value==="Done" ? onComplete(task) : updateTask(task.id,{status:value,completedAt:undefined,...(value==="Waiting"?{}:{waitingForType:undefined,waitingForId:"",waitingForIds:[],waitingFor:"",waitingReason:"",followUpDate:""})});
  const renderTask = (t: Task) => <TaskCard key={t.id} task={t} data={data} project={projectName(data.projects,t.projectId)} onOpen={()=>onOpen(t)} onComplete={()=>onComplete(t)} onDelete={()=>{if(confirm(`确定要删除任务“${t.title}”吗？此操作不可恢复。`)){deleteTask(t.id);notify("任务已删除")}}} onStatus={v=>updateStatus(t,v)} onStartTimer={()=>onStartTimer(t)} onPauseTimer={()=>onPauseTimer(t)} onStopTimer={()=>onStopTimer(t)}/>;
  const kanbanTasks = data.tasks.filter(t=>baseMatch(t) && (t.status!=="Done" || isTodayCompleted(t)));
  const listTasks = data.tasks.filter(t=>baseMatch(t) && ["Todo","Doing","Waiting"].includes(t.status)).sort((a,b)=>(a.dueDate||"9999").localeCompare(b.dueDate||"9999") || priorityRank[a.priority]-priorityRank[b.priority]);
  const range = completedRange(quick);
  const effectiveStart = start || range.start, effectiveEnd = end || range.end;
  const completedTasks = data.tasks.filter(t=>baseMatch(t) && t.status==="Done" && (!effectiveStart || (t.completedAt||"")>=effectiveStart) && (!effectiveEnd || (t.completedAt||"")<=effectiveEnd) && (source==="全部"||t.source===source) && (link==="全部" || (link==="linked" ? Boolean(t.projectId) : !t.projectId)));
  const sortedCompleted = [...completedTasks].sort((a,b)=>{
    if (sort==="duration") return taskSeconds(b)-taskSeconds(a);
    if (sort==="priority") return priorityRank[a.priority]-priorityRank[b.priority];
    const field = sort === "completedAt" ? "completedAt" : sort === "createdAt" ? "createdAt" : "dueDate";
    return String(b[field] || "").localeCompare(String(a[field] || ""));
  });
  const visibleCompleted = sortedCompleted.slice(0,page*30);
  const weekRange=completedRange("week"), monthRange=completedRange("month");
  const weekDone=data.tasks.filter(t=>t.status==="Done"&&inDateRange(t.completedAt,weekRange.start,weekRange.end));
  const monthDone=data.tasks.filter(t=>t.status==="Done"&&inDateRange(t.completedAt,monthRange.start,monthRange.end));
  const weekCreated=data.tasks.filter(t=>t.createdAt>=weekRange.start&&t.createdAt<=weekRange.end&&t.status!=="Inbox");
  const completionRate=weekCreated.length?Math.round(weekDone.length/weekCreated.length*100):0;
  const metricRows = metric==="monthDone" ? monthDone : metric==="completionRate" ? weekCreated : weekDone;
  const metricTitle = metric==="monthDone" ? "本月完成明细" : metric==="weekTime" ? "本周工时明细" : metric==="completionRate" ? "本周完成率明细" : "本周完成明细";
  const metricSubtitle = metric==="completionRate" ? `本周创建 ${weekCreated.length} 项，完成 ${weekDone.length} 项，完成率 ${completionRate}%` : "点击任务可进入详情";
  const sources=Array.from(new Set(data.tasks.map(t=>t.source).filter(Boolean)));
  useEffect(()=>setPage(1),[tab,query,project,priority,contact,quick,source,link,sort,start,end]);
  const columns:TaskStatus[]=["Todo","Doing","Waiting","Done"];
  return <div className="task-center-v2">
    <div className="task-center-tabs"><button className={cn(tab==="kanban"&&"active")} onClick={()=>setTab("kanban")}>看板</button><button className={cn(tab==="list"&&"active")} onClick={()=>setTab("list")}>列表</button><button className={cn(tab==="completed"&&"active")} onClick={()=>setTab("completed")}>已完成</button></div>
    {tab!=="completed"&&<FilterBar><select value={project} onChange={e=>setProject(e.target.value)}><option value="全部">全部项目</option>{data.projects.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select><select value={contact} onChange={e=>setContact(e.target.value)}><option value="全部">全部联系人</option>{(data.contacts||[]).map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select><select value={priority} onChange={e=>setPriority(e.target.value)}><option>全部</option><option>P0</option><option>P1</option><option>P2</option><option>P3</option></select><button onClick={()=>{setProject("全部");setContact("全部");setPriority("全部")}}>清除筛选</button><span>{tab==="kanban"?"Done 仅显示今日完成":`未完成任务 ${listTasks.length} 项`}</span></FilterBar>}
    {tab==="kanban"&&<div className="kanban">{columns.map(s=><section className="kanban-col" key={s}><div className="kanban-head"><span className={`status-dot ${s.toLowerCase()}`}/>{{Todo:"待开始",Doing:"进行中",Waiting:"等待中",Done:"今日完成",Inbox:"收集箱"}[s]}<b>{kanbanTasks.filter(t=>t.status===s).length}</b></div><div className="kanban-stack">{kanbanTasks.filter(t=>t.status===s).map(renderTask)}{s!=="Done"&&<button className="add-card" onClick={()=>onAdd(s==="Waiting"?blankTask({status:"Waiting",dueDate:"",followUpDate:formatLocalDate(addDays(new Date(),2))}):blankTask({status:s}))}><Plus size={15}/> 添加任务</button>}</div></section>)}</div>}
    {tab==="list"&&<section className="panel task-list-panel">{listTasks.length?listTasks.map(t=><button className="task-list-row" key={t.id} onClick={()=>onOpen(t)}><span className={`priority ${t.priority.toLowerCase()}`}>{t.priority}</span><div><strong>{t.title}</strong><p>{projectName(data.projects,t.projectId)} · {t.status} · 提出人 {requesterName(t,data)}</p></div><span>{t.dueDate||"无截止"}</span><b>{durationLabel(taskSeconds(t))}</b></button>):<EmptyState icon={ListTodo} title="暂无未完成任务" text="所有执行任务都已完成，新的任务会出现在这里。"/>}</section>}
    {tab==="completed"&&<>
      <div className="completed-stats"><StatCard label="本周完成" value={weekDone.length} unit="项" detail={`${weekRange.start.slice(5)} - ${weekRange.end.slice(5)}`} icon={CheckCircle2} tone="green" onClick={()=>setMetric("weekDone")}/><StatCard label="本月完成" value={monthDone.length} unit="项" detail={format(new Date(),"yyyy年M月")} icon={CalendarDays} tone="purple" onClick={()=>setMetric("monthDone")}/><StatCard label="本周工时" value={Math.round(weekDone.reduce((s,t)=>s+taskSeconds(t),0)/360)/10} unit="h" detail="来自 time_sessions 汇总" icon={Timer} tone="blue" onClick={()=>setMetric("weekTime")}/><StatCard label="完成率" value={completionRate} unit="%" detail={`${weekDone.length}/${weekCreated.length || 0} 本周创建`} icon={Target} tone="orange" onClick={()=>setMetric("completionRate")}/></div>
      <div className="task-quick-ranges">{(["today","yesterday","week","month","all"] as CompletedQuickRange[]).map(v=><button key={v} className={cn(quick===v&&"active")} onClick={()=>{setQuick(v);setStart("");setEnd("");}}>{{today:"今天",yesterday:"昨天",week:"本周",month:"本月",all:"全部"}[v]}</button>)}</div>
      <FilterBar><select value={project} onChange={e=>setProject(e.target.value)}><option value="全部">全部项目</option>{data.projects.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select><select value={contact} onChange={e=>setContact(e.target.value)}><option value="全部">全部联系人</option>{(data.contacts||[]).map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select><select value={priority} onChange={e=>setPriority(e.target.value)}><option>全部优先级</option><option>P0</option><option>P1</option><option>P2</option><option>P3</option></select><select value={source} onChange={e=>setSource(e.target.value)}><option>全部来源</option>{sources.map(s=><option key={s}>{s}</option>)}</select><select value={link} onChange={e=>setLink(e.target.value)}><option value="全部">项目不限</option><option value="linked">有关联项目</option><option value="unlinked">未关联项目</option></select><select value={sort} onChange={e=>setSort(e.target.value as CompletedSort)}><option value="completedAt">按完成时间</option><option value="createdAt">按创建时间</option><option value="dueDate">按截止日期</option><option value="duration">按工时</option><option value="priority">按优先级</option></select><label>从 <input type="date" value={start} onChange={e=>setStart(e.target.value)}/></label><label>至 <input type="date" value={end} onChange={e=>setEnd(e.target.value)}/></label></FilterBar>
      <section className="panel completed-task-list">{visibleCompleted.length?visibleCompleted.map(t=><button className="completed-task-row" key={t.id} onClick={()=>onOpen(t)}><span className={`priority ${t.priority.toLowerCase()}`}>{t.priority}</span><div><strong>{t.title}</strong><p>{projectName(data.projects,t.projectId)} · 提出人 {requesterName(t,data)} · 来源 {t.source}</p><small>{isMeetingActionTask(t)?"会议行动项":"普通任务"} · {t.projectId?"已关联项目":"未关联项目"}</small></div><span>完成 {t.completedAt||"未记录"}</span><b>{durationLabel(taskSeconds(t))}</b></button>):<EmptyState icon={CheckCircle2} title="没有完成任务" text="换个时间范围或筛选条件试试。"/>}{visibleCompleted.length<sortedCompleted.length&&<button className="load-more" onClick={()=>setPage(p=>p+1)}>加载更多</button>}</section>
      <DrillDownDrawer open={!!metric} onClose={()=>setMetric(null)} title={metricTitle} subtitle={metricSubtitle}>
        <div className="drill-list">{metricRows.length?metricRows.map(t=><button className="drill-row" key={t.id} onClick={()=>{setMetric(null);onOpen(t)}}><span className={`priority ${t.priority.toLowerCase()}`}>{t.priority}</span><div><strong>{t.title}</strong><p>{projectName(data.projects,t.projectId)} · {t.status} · 提出人 {requesterName(t,data)}</p><small>{metric==="completionRate" ? `创建 ${t.createdAt} · ${t.status==="Done" ? `完成 ${t.completedAt || "未记录"}` : "尚未完成"}` : `完成 ${t.completedAt || "未记录"} · 实际工时 ${durationLabel(taskSeconds(t))}`}</small></div></button>):<EmptyState icon={Search} title="没有明细" text="当前统计卡没有可展开的任务。"/>}</div>
      </DrillDownDrawer>
    </>}
  </div>;
  }

function ProjectCenter({data,query,onOpen,onEdit,onAdd}:{data:WorkData;query:string;onOpen:(p:Project)=>void;onEdit:(p?:Project)=>void;onAdd:(p?:Project)=>void}) {
  const [status,setStatus]=useState("全部"); const list=data.projects.filter(p=>fuzzyMatch(query, projectSearchFields(p, data))&&(status==="全部"||p.status===status));
  return <><FilterBar><select value={status} onChange={e=>setStatus(e.target.value)}><option>全部</option><option value="Planning">规划中</option><option value="Active">进行中</option><option value="Paused">已暂停</option><option value="Done">已完成</option></select><button onClick={()=>onAdd()}><Plus size={14}/> 新增项目</button></FilterBar><div className="project-grid">{list.map(p=>{const tasks=relatedProjectTasks(data,p),progress=projectProgressSummary(p,tasks),hours=tasks.reduce((s,t)=>s+taskHours(t),0);return <article className="project-card" key={p.id}><div className="project-card-top"><span className={`priority ${p.priority.toLowerCase()}`}>{p.priority}</span><span className="project-status">{{Planning:"规划中",Active:"进行中",Paused:"暂停",Done:"完成"}[p.status]}</span></div><h3>{p.name}</h3><p>{p.goal}</p><div className="project-progress"><i style={{width:`${progress.progress}%`}}/></div><div className="project-numbers"><span><b>{progress.progress}%</b> 进度</span><span><b>{progress.completed}/{progress.total}</b> 任务</span><span><b>{hours.toFixed(1)}h</b> 已用</span></div><div className="project-card-actions"><button onClick={()=>onOpen(p)}>查看档案 <ArrowRight size={14}/></button><button onClick={()=>onEdit(p)}>编辑</button></div></article>})}</div></>;
}

function ContactCenter({data,query,onSaveContact,onDeleteContact}:{data:WorkData;query:string;onSaveContact:(c:Contact)=>void;onDeleteContact:(c:Contact)=>void}) {
  const contacts=data.contacts||[];
  const [team,setTeam]=useState("全部"),[company,setCompany]=useState("全部");
  const [editingContact,setEditingContact]=useState<Contact|null>(null);
  const [favoriteIds,setFavoriteIds]=useState<string[]>([]);
  const [recentIds,setRecentIds]=useState<string[]>([]);
  useEffect(()=>{setRecentIds(readRecentContactIds());},[]);
  const blankContact=():Contact=>({id:uid("contact"),name:"",role:"",team:"",company:"",email:"",phone:"",notes:"",externalSource:"manual",externalId:"",createdAt:localNow(),updatedAt:localNow()});
  const contactList=contacts.filter(c=>fuzzyMatch(query,contactSearchFields(c))&&(team==="全部"||c.team===team)&&(company==="全部"||c.company===company));
  const teams=Array.from(new Set(contacts.map(c=>c.team).filter(Boolean)));
  const companies=Array.from(new Set(contacts.map(c=>c.company).filter(Boolean)));
  const recentContacts=recentIds.map(id=>contacts.find(c=>c.id===id)).filter(Boolean) as Contact[];
  const toggleFavorite=(id:string)=>setFavoriteIds(ids=>ids.includes(id)?ids.filter(item=>item!==id):[id,...ids]);
  return <div className="contacts-layout">
    <section className="panel contacts-panel">
      <FilterBar><select value={team} onChange={e=>setTeam(e.target.value)}><option>全部团队</option>{teams.map(x=><option key={x}>{x}</option>)}</select><select value={company} onChange={e=>setCompany(e.target.value)}><option>全部公司</option>{companies.map(x=><option key={x}>{x}</option>)}</select><button onClick={()=>setEditingContact(blankContact())}><Plus size={14}/> 新增联系人</button></FilterBar>
      {!!recentContacts.length&&<div className="recent-contact-strip"><span>最近联系人</span>{recentContacts.slice(0,8).map(contact=><button key={contact.id} onClick={()=>setEditingContact(contact)}>{contact.name}</button>)}</div>}
      <div className="contact-list">{contactList.length?contactList.map(c=>{
        const incomplete=!(c.email&&c.role&&(c.departmentName||c.team));
        return <article className="contact-card" key={c.id}><div className="person-avatar">{c.name.slice(0,1)}</div><div><strong>{c.name}{incomplete&&<em className="contact-incomplete">信息待补充</em>}</strong><p>{[c.team || c.departmentName,c.company,c.role].filter(Boolean).join(" · ")||"未填写团队信息"}</p><span>{c.email||c.phone||c.notes||"暂无联系方式"}</span></div><div><button className="secondary small" onClick={()=>toggleFavorite(c.id)}>{favoriteIds.includes(c.id)?"已收藏":"收藏"}</button><button className="secondary small" onClick={()=>setEditingContact(c)}>编辑</button><button className="secondary small danger" onClick={()=>onDeleteContact(c)}>删除</button></div></article>;
      }):<EmptyState icon={Users} title="没有联系人" text="新增常用对接人，任务和会议就能直接选择。"/>}</div>
    </section>
    <section className="panel contacts-editor">{editingContact?<ContactForm contact={editingContact} onCancel={()=>setEditingContact(null)} onSave={c=>{onSaveContact({...c,externalSource:"manual",updatedAt:localNow()});setEditingContact(null)}}/>:<EmptyState icon={Users} title="选择或新建联系人" text="联系人是 WorkOS 原生数据，可在本地或云端使用。"/>}</section>
  </div>
}

function ContactForm({contact,onSave,onCancel}:{contact:Contact;onSave:(c:Contact)=>void;onCancel:()=>void}) {
  const [form,setForm]=useState<Contact>(contact);
  useEffect(()=>setForm(contact),[contact]);
  const f=<K extends keyof Contact>(k:K,v:Contact[K])=>setForm(x=>({...x,[k]:v}));
  return <div className="contact-form"><h3>{contact.name?"编辑联系人":"新增联系人"}</h3><div className="form-grid compact"><Field label="姓名" wide><input autoFocus value={form.name} onChange={e=>f("name",e.target.value)}/></Field><Field label="角色"><input value={form.role||""} onChange={e=>f("role",e.target.value)}/></Field><Field label="团队"><input value={form.team||""} onChange={e=>f("team",e.target.value)}/></Field><Field label="公司"><input value={form.company||""} onChange={e=>f("company",e.target.value)}/></Field><Field label="邮箱"><input type="email" value={form.email||""} onChange={e=>f("email",e.target.value)}/></Field><Field label="电话"><input value={form.phone||""} onChange={e=>f("phone",e.target.value)}/></Field><Field label="备注" wide><textarea value={form.notes||""} onChange={e=>f("notes",e.target.value)}/></Field></div><div className="inline-actions"><button className="ghost" onClick={onCancel}>取消</button><button className="primary" disabled={!form.name.trim()} onClick={()=>onSave(form)}><Save size={14}/> 保存联系人</button></div></div>
}

function MeetingCenter({data,query,onEdit,onTask,onDelete}:{data:WorkData;setData:React.Dispatch<React.SetStateAction<WorkData>>;query:string;onEdit:(m?:Meeting)=>void;onTask:(t:Task)=>void;onDelete:(m:Meeting)=>void}) {
  type CalendarMode = "day" | "week" | "month";
  const [mode,setMode]=useState<CalendarMode>("week");
  const [anchor,setAnchor]=useState(new Date());
  const [selected,setSelected]=useState<CalendarEvent|null>(null);
  const events=data.meetings
    .map(toCalendarEvent)
    .filter((event): event is CalendarEvent => Boolean(event))
    .filter(event => fuzzyMatch(query, meetingSearchFields(event.meeting, data)))
    .sort((a,b)=>a.localStart.getTime()-b.localStart.getTime());
  const rangeStart = mode==="day" ? new Date(anchor.getFullYear(),anchor.getMonth(),anchor.getDate()) : mode==="week" ? startOfWeek(anchor,{weekStartsOn:1}) : startOfWeek(startOfMonth(anchor),{weekStartsOn:1});
  const rangeEnd = mode==="day" ? addDays(rangeStart,1) : mode==="week" ? addDays(rangeStart,7) : addDays(startOfWeek(endOfMonth(anchor),{weekStartsOn:1}),7);
  const days = Array.from({length: Math.round((rangeEnd.getTime()-rangeStart.getTime())/86400000)},(_,i)=>addDays(rangeStart,i));
  const visibleEvents = events.filter(event=>event.localStart>=rangeStart&&event.localStart<rangeEnd);
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    console.table(visibleEvents.map(event => ({
      title: event.title,
      rawDate: event.meeting.date,
      rawStartTime: event.meeting.startTime,
      rawEndTime: event.meeting.endTime,
      localDateKey: event.dayKey,
      weekStart: formatLocalDate(rangeStart),
      columnIndex: Math.max(0, Math.round(((parseLocalDateTime(event.dayKey)?.getTime() ?? rangeStart.getTime()) - rangeStart.getTime()) / 86400000)),
      startHour: Math.floor(event.startMinutesOfDay / 60),
      startMinute: event.startMinutesOfDay % 60,
      renderedTop: ((event.startMinutesOfDay / 60) - 8) * 56,
      displayedTime: event.displayedTime,
    })));
  }, [visibleEvents, rangeStart]);
  const hours = Array.from({length:14},(_,i)=>i+8);
  const periodLabel = mode==="day" ? format(anchor,"yyyy年M月d日 EEEE",{locale:zhCN}) : mode==="week" ? `${format(rangeStart,"M月d日")} - ${format(addDays(rangeEnd,-1),"M月d日")}` : format(anchor,"yyyy年M月");
  const shift = (delta:number) => setAnchor(current => mode==="day" ? addDays(current,delta) : mode==="week" ? addWeeks(current,delta) : new Date(current.getFullYear(),current.getMonth()+delta,1));
  const dayEvents = (day: Date) => visibleEvents.filter(event=>event.dayKey===formatLocalDate(day));
  const eventStyle = (event: CalendarEvent) => {
    const duration=Math.max(30,event.durationMinutes);
    return { top: Math.max(0,((event.startMinutesOfDay / 60)-8)*56), height: Math.max(28,duration/60*56) };
  };
  return <div className="calendar-system">
    <section className="panel calendar-toolbar">
      <div><span className="eyebrow">CALENDAR</span><h2>{periodLabel}</h2></div>
      <div className="calendar-actions"><button className="secondary" onClick={()=>shift(-1)}>上一段</button><button className="secondary" onClick={()=>setAnchor(new Date())}>今天</button><button className="secondary" onClick={()=>shift(1)}>下一段</button><div className="calendar-mode"><button className={cn(mode==="day"&&"active")} onClick={()=>setMode("day")}>日</button><button className={cn(mode==="week"&&"active")} onClick={()=>setMode("week")}>周</button><button className={cn(mode==="month"&&"active")} onClick={()=>setMode("month")}>月</button></div></div>
    </section>
    {mode==="month" ? <section className="panel month-calendar">
      <div className="month-weekdays">{["一","二","三","四","五","六","日"].map(day=><span key={day}>{day}</span>)}</div>
      <div className="month-grid">{days.map(day=>{const dayKey=formatLocalDate(day),items=dayEvents(day);return <div className={cn("month-cell",day.getMonth()!==anchor.getMonth()&&"muted",dayKey===todayISO()&&"today")} key={dayKey}><b>{format(day,"d")}</b>{items.slice(0,4).map(event=><button key={event.id} onClick={()=>setSelected(event)}><span>{formatLocalTime(event.localStart)}</span>{event.title}</button>)}{items.length>4&&<em>+{items.length-4} 场</em>}</div>})}</div>
    </section> : <section className="panel calendar-board" style={{"--calendar-days": days.length} as any}>
      <div className="calendar-day-head"><div />{days.map(day=>{const dayKey=formatLocalDate(day);return <div className={cn(dayKey===todayISO()&&"today")} key={dayKey}><span>{format(day,"EEE",{locale:zhCN})}</span><b>{format(day,"d")}</b></div>})}</div>
      <div className="calendar-time-grid">
        <div className="calendar-hours">{hours.map(hour=><span key={hour}>{String(hour).padStart(2,"0")}:00</span>)}</div>
        {days.map(day=>{const dayKey=formatLocalDate(day);return <div className="calendar-day-column" key={dayKey}>{hours.map(hour=><i key={hour}/>)}{dayEvents(day).map(event=>{const style=eventStyle(event);return <button className="calendar-event" key={event.id} style={{top:style.top,height:style.height}} onClick={()=>setSelected(event)}><strong>{event.title}</strong><span>{event.displayedTime}</span><small>{projectName(data.projects,event.meeting.relatedProjectId)}</small></button>})}</div>})}
      </div>
    </section>}
    <DrillDownDrawer open={!!selected} onClose={()=>setSelected(null)} title={selected?.title || "会议详情"} subtitle={selected ? `${selected.dayKey} · ${selected.displayedTime}` : ""}>
      {selected&&<div className="calendar-detail">
        <div className="detail-kpis"><span>时长<b>{selected.durationMinutes} 分钟</b></span><span>参与人<b>{selected.meeting.attendees.length}</b></span><span>项目<b>{projectName(data.projects,selected.meeting.relatedProjectId)}</b></span><span>地点<b>{selected.meeting.location || "未填写"}</b></span></div>
        <DetailSection title="参与人"><div className="attendees">{selected.meeting.attendees.length?selected.meeting.attendees.map(a=><span key={a}>{a}</span>):<span>未记录</span>}</div></DetailSection>
        <DetailSection title="关联任务">{selected.meeting.relatedTaskId ? (()=>{const task=data.tasks.find(t=>t.id===selected.meeting.relatedTaskId);return task?<button className="linked-row" onClick={()=>onTask(task)}><ListTodo size={16}/><div><strong>{task.title}</strong><span>{task.status} · {durationLabel(taskSeconds(task))}</span></div><ArrowRight size={15}/></button>:<p>关联任务已不存在</p>})() : <p>未关联任务</p>}</DetailSection>
        <DetailSection title="会议纪要"><p>{selected.meeting.notes || "暂无纪要"}</p></DetailSection>
        <DetailSection title="行动项">{selected.meeting.actionItems.length?selected.meeting.actionItems.map(action=><div className="action-item" key={action.id}><Circle size={15}/><div><strong>{action.text}</strong><p>{action.owner} · {action.dueDate}</p></div></div>):<p>暂无行动项</p>}</DetailSection>
        <div className="inline-actions"><button className="secondary danger" onClick={()=>{onDelete(selected.meeting);setSelected(null)}}>删除会议</button><button className="primary" onClick={()=>{onEdit(selected.meeting);setSelected(null)}}>编辑会议</button></div>
      </div>}
    </DrillDownDrawer>
  </div>
}

function WorkLog({data,onTask,onMeeting,onReflection}:{data:WorkData;onTask:(t:Task)=>void;onMeeting:(m:Meeting)=>void;onReflection:(r:Reflection)=>void}) {
  const [start,setStart]=useState(format(subDays(new Date(),7),"yyyy-MM-dd")),[end,setEnd]=useState(todayISO());
  type LogItem = { id:string; date:string; stamp:string; time:string; kind:"任务"|"会议"|"行动项"|"复盘"; title:string; meta:string; seconds:number; onClick?:()=>void };
  const taskItems: LogItem[] = data.tasks.filter(t=>t.completedAt&&t.completedAt>=start&&t.completedAt<=end).map(t=>({id:`task-${t.id}`,date:t.completedAt!,stamp:`${t.completedAt}T18:00`,time:"完成",kind:"任务",title:t.title,meta:`${projectName(data.projects,t.projectId)} · 实际用时 ${durationLabel(taskSeconds(t))}`,seconds:taskSeconds(t),onClick:()=>onTask(t)}));
  const meetingItems: LogItem[] = data.meetings.filter(m=>meetingHasTime(m)&&inDateRange(meetingStartValue(m),start,end)).map(m=>({id:`meeting-${m.id}`,date:formatLocalDate(meetingStartValue(m)),stamp:meetingStartValue(m),time:formatLocalTime(meetingStartValue(m)),kind:"会议",title:m.title,meta:`${projectName(data.projects,m.relatedProjectId)} · ${meetingDurationMinutes(m)} 分钟 · ${m.attendees.length} 人`,seconds:meetingDurationMinutes(m)*60,onClick:()=>onMeeting(m)}));
  const actionItems: LogItem[] = data.meetings.flatMap(m=>m.actionItems.map(a=>({meeting:m,action:a}))).filter(x=>x.action.dueDate>=start&&x.action.dueDate<=end).map(x=>{const task=x.action.taskId?data.tasks.find(t=>t.id===x.action.taskId):undefined;return {id:`action-${x.meeting.id}-${x.action.id}`,date:x.action.dueDate,stamp:`${x.action.dueDate}T12:00`,time:"跟进",kind:"行动项" as const,title:x.action.text,meta:`负责人 ${x.action.owner||"未设置"} · 来自会议：${x.meeting.title}`,seconds:0,onClick:task?()=>onTask(task):()=>onMeeting(x.meeting)}});
  const reflectionItems: LogItem[] = data.reflections.filter(r=>r.date>=start&&r.date<=end).map(r=>({id:`reflection-${r.id}`,date:r.date,stamp:`${r.date}T17:00`,time:"复盘",kind:"复盘",title:r.title,meta:`${r.type} · ${projectName(data.projects,r.relatedProjectId)} · ${r.durationMinutes||0} 分钟`,seconds:(r.durationMinutes||0)*60,onClick:()=>onReflection(r)}));
  const items = [...taskItems,...meetingItems,...actionItems,...reflectionItems].sort((a,b)=>b.stamp.localeCompare(a.stamp));
  const groups=Object.entries(items.reduce<Record<string,LogItem[]>>((a,item)=>{(a[item.date]||=[]).push(item);return a},{})).sort((a,b)=>b[0].localeCompare(a[0]));
  const totalSeconds = items.reduce((s,i)=>s+i.seconds,0);
  return <><FilterBar><label>从 <input type="date" value={start} onChange={e=>setStart(e.target.value)}/></label><label>至 <input type="date" value={end} onChange={e=>setEnd(e.target.value)}/></label><span>共 {items.length} 条 · {durationLabel(totalSeconds)}</span></FilterBar><p className="form-helper-block">工作日志会按时间顺序汇总任务、会议、会议行动项和复盘。日期筛选只影响当前展示，不修改云端数据。</p><div className="log-layout"><section className="panel log-summary"><span className="eyebrow">所选周期已记录</span><b>{durationLabel(totalSeconds)}</b><p>{taskItems.length} 项任务 · {meetingItems.length} 场会议 · {reflectionItems.length} 条复盘</p><div className="mini-bars">{[taskItems.length,meetingItems.length,actionItems.length,reflectionItems.length].map((n,i)=><i key={i} style={{height:`${Math.max(8,Math.min(92,n*18))}%`}}/>)}</div></section><section className="panel log-main">{groups.length?groups.map(([date,list])=><div className="log-day" key={date}><div className="log-date"><b>{format(parseISO(date),"dd")}</b><span>{format(parseISO(date),"M月 · EEE",{locale:zhCN})}</span></div><div className="log-items">{list.map(item=><button className={cn("log-item",`log-${item.kind}`)} key={item.id} onClick={item.onClick}><LogIcon kind={item.kind}/><div><strong>{item.time} · {item.title}</strong><p><span>{item.kind}</span> · {item.meta}</p></div><span className="variance good">{item.seconds?durationLabel(item.seconds):"待跟进"}</span></button>)}</div></div>):<EmptyState icon={FileText} title="当前时间范围暂无日志" text="完成任务、记录会议或复盘后会自动出现在这里。"/>}</section></div></>
}

function LogIcon({kind}:{kind:"任务"|"会议"|"行动项"|"复盘"}) {
  const Icon = kind === "会议" ? CalendarDays : kind === "行动项" ? Clipboard : kind === "复盘" ? Brain : CheckCircle2;
  return <Icon size={17}/>;
}

function WeeklyReview({data,setData,setView,notify}:{data:WorkData;setData:React.Dispatch<React.SetStateAction<WorkData>>;setView:(v:View)=>void;notify:(s:string)=>void}) { const start=format(startOfWeek(new Date(),{weekStartsOn:1}),"yyyy-MM-dd"),end=format(endOfWeek(new Date(),{weekStartsOn:1}),"yyyy-MM-dd"); const completed=data.tasks.filter(t=>t.completedAt&&t.completedAt>=start&&t.completedAt<=end),risks=data.tasks.filter(t=>t.status==="Waiting"||(t.dueDate&&t.dueDate<todayISO()&&t.status!=="Done")),next=data.tasks.filter(t=>!["Done","Inbox"].includes(t.status)).slice(0,5); const generate=()=>{const content=generateReportContent(data,start,end,defaultReportOptions);const report:Report={id:uid("report"),title:`${format(parseISO(start),"M月d日")}周报`,type:"周报",startDate:start,endDate:end,generatedContent:content,includedTaskIds:data.tasks.map(t=>t.id),includedReflectionIds:data.reflections.map(r=>r.id),createdAt:new Date().toISOString(),options:defaultReportOptions};setData(d=>({...d,reports:[report,...d.reports]}));notify("周报已生成并保存到报告中心");setView("reports")}; return <div className="review-layout"><div className="review-header-card"><div><span className="eyebrow">WEEKLY REVIEW · {start.slice(5)} — {end.slice(5)}</span><h2>本周工作复盘</h2><p>基于任务、项目、会议与复盘记录自动生成</p></div><button className="primary" onClick={generate}><Sparkles size={16}/> 生成完整周报</button></div><ReviewSection n="01" title="本周完成" desc="真实完成记录，不靠周五下午的记忆。" tasks={completed} data={data}/><ReviewSection n="02" title="风险与问题" desc="需要持续跟进或可能影响交付的事项。" tasks={risks} data={data} tone="risk"/><ReviewSection n="03" title="下周计划" desc="根据未完成事项、优先级与截止时间生成。" tasks={next} data={data} tone="next"/></div> }

function ReportCenter({data,setData,query,notify}:{data:WorkData;setData:React.Dispatch<React.SetStateAction<WorkData>>;query:string;notify:(s:string)=>void}) { const [type,setType]=useState<ReportType>("周报"),[title,setTitle]=useState("本周期工作总结"),[start,setStart]=useState(format(startOfWeek(new Date(),{weekStartsOn:1}),"yyyy-MM-dd")),[end,setEnd]=useState(todayISO()),[options,setOptions]=useState(defaultReportOptions),[active,setActive]=useState<Report|null>(data.reports[0]||null); const reports=data.reports.filter(r=>fuzzyMatch(query,reportSearchFields(r))); useEffect(()=>{if(!active&&reports.length)setActive(reports[0]);if(active&&query&&!reports.some(r=>r.id===active.id))setActive(reports[0]||null)},[reports,active,query]); const reportData={...data,tasks:data.tasks.map(withActualFromTracking)}; const setRange=(t:ReportType)=>{setType(t);const now=new Date();if(t==="日报"){setStart(todayISO());setEnd(todayISO())}if(t==="周报"){setStart(format(startOfWeek(now,{weekStartsOn:1}),"yyyy-MM-dd"));setEnd(format(endOfWeek(now,{weekStartsOn:1}),"yyyy-MM-dd"))}if(t==="月报"){setStart(format(startOfMonth(now),"yyyy-MM-dd"));setEnd(format(endOfMonth(now),"yyyy-MM-dd"))}if(t==="季度报"){setStart(format(startOfQuarter(now),"yyyy-MM-dd"));setEnd(format(endOfQuarter(now),"yyyy-MM-dd"))}}; const generate=()=>{if(!title.trim()){notify("请填写报告标题");return}if(start>end){notify("开始日期不能晚于结束日期");return}const r:Report={id:uid("report"),title,type,startDate:start,endDate:end,generatedContent:generateReportContent(reportData,start,end,options),includedTaskIds:data.tasks.filter(t=>t.createdAt>=start&&t.createdAt<=end||t.completedAt&&t.completedAt>=start&&t.completedAt<=end).map(t=>t.id),includedReflectionIds:data.reflections.filter(r=>r.date>=start&&r.date<=end).map(r=>r.id),createdAt:new Date().toISOString(),options};setData(d=>({...d,reports:[r,...d.reports]}));setActive(r);notify("报告已生成并保存")}; const copy=async()=>{if(active){await navigator.clipboard.writeText(active.generatedContent);notify("报告已复制到剪贴板")}}; const download=()=>{if(!active)return;const blob=new Blob([active.generatedContent],{type:"text/markdown;charset=utf-8"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`${active.title}.md`;a.click();URL.revokeObjectURL(a.href);notify("Markdown 已导出")}; return <div className="report-layout"><section className="panel report-builder"><h3>生成新报告</h3><div className="form-grid compact"><Field label="报告类型" helper="选择系统预设周期会自动填入日期；选择自定义后可以手动指定任意时间段。" tip="只影响报告汇总范围，不修改原始数据。"><select value={type} onChange={e=>setRange(e.target.value as ReportType)}><option>日报</option><option>周报</option><option>月报</option><option>季度报</option><option>自定义</option></select></Field><Field label="自定义标题" helper="会作为报告标题和 Markdown 导出文件名，建议写清楚周期或主题。" tip="例如：6月客户项目推进复盘。"><input value={title} onChange={e=>setTitle(e.target.value)} placeholder="例如：本周工作总结 / 6月项目推进复盘"/></Field><Field label="开始日期" helper="用于筛选该日期之后的任务、会议、复盘和耗时记录。" tip="如果开始日期晚于结束日期，系统会提示修正。"><input type="date" value={start} onChange={e=>{setType("自定义");setStart(e.target.value)}}/></Field><Field label="结束日期" helper="用于筛选该日期之前的任务、会议、复盘和耗时记录。" tip="自定义时间段报告会根据开始和结束日期生成。"><input type="date" value={end} onChange={e=>{setType("自定义");setEnd(e.target.value)}}/></Field></div><p className="form-helper-block">勾选下面模块，决定报告是否包含复盘、项目进展、真实耗时、Waiting 事项和下阶段计划；不会改变任何业务数据。</p><div className="report-options">{([['reflections','复盘思考'],['projectProgress','项目进展'],['timeStats','耗时统计'],['waiting','Waiting 事项'],['nextPlan','下阶段计划']] as [keyof ReportOptions,string][]).map(([k,l])=><label key={k}><input type="checkbox" checked={options[k]} onChange={e=>setOptions(o=>({...o,[k]:e.target.checked}))}/><span>{l}</span></label>)}</div><button className="primary report-generate" onClick={generate}><Sparkles size={16}/> 生成报告</button><div className="saved-reports"><span className="eyebrow">历史报告</span>{reports.length?reports.map(r=><button className={cn(active?.id===r.id&&"active")} key={r.id} onClick={()=>setActive(r)}><div><strong>{r.title}</strong><span>{r.type} · {r.startDate} — {r.endDate}</span></div><ArrowRight size={14}/></button>):<p className="meeting-notes">没有匹配的报告</p>}</div></section><section className="panel report-preview"><div className="report-preview-head"><div><span className="eyebrow">REPORT PREVIEW</span><h2>{active?.title||"尚未生成报告"}</h2></div><div><button className="secondary" disabled={!active} onClick={copy}><Clipboard size={14}/> 一键复制</button><button className="secondary" disabled={!active} onClick={download}><Download size={14}/> 导出 Markdown</button></div></div>{active?<pre className="markdown-preview">{active.generatedContent}</pre>:<EmptyState icon={FileText} title="配置并生成第一份报告" text="报告会关联任务、项目和复盘，而不是简单流水账。"/>}</section></div> }

function Analytics({data}:{data:WorkData}) { const measured=data.tasks.filter(t=>taskHours(t)>0&&t.estimatedHours>0),est=measured.reduce((s,t)=>s+t.estimatedHours,0),act=measured.reduce((s,t)=>s+taskHours(t),0),accuracy=measured.length?Math.max(0,Math.round(100-measured.reduce((s,t)=>s+Math.abs(taskHours(t)-t.estimatedHours)/t.estimatedHours*100,0)/measured.length)):0; return <><div className="analytics-top"><StatCard label="总预估工时" value={+est.toFixed(1)} unit="h" detail={`${measured.length} 个有记录的任务`} icon={Clock3} tone="purple"/><StatCard label="总实际工时" value={+act.toFixed(1)} unit="h" detail={act>est?`超出 ${hoursLabel(act-est)}`:`节省 ${hoursLabel(est-act)}`} icon={Timer} tone="blue"/><StatCard label="预估准确率" value={accuracy} unit="%" detail="持续记录会更准确" icon={Target} tone="green"/></div><div className="analytics-grid"><section className="panel chart-panel"><PanelHead title="预估 vs 实际" sub="最近有工时记录的任务"/><div className="bar-chart">{measured.map(t=>{const actual=taskHours(t),max=Math.max(t.estimatedHours,actual);return <div className="bar-row" key={t.id}><span>{t.title}</span><div className="bar-track"><i className="est" style={{width:`${t.estimatedHours/max*85}%`}}/><i className="act" style={{width:`${actual/max*85}%`}}/></div><b>{hoursLabel(actual)}</b></div>})}</div></section><section className="panel insight-card"><div className="insight-icon"><Sparkles size={20}/></div><span className="eyebrow">智能校准</span><h3>给自己多留 18% 的缓冲</h3><p>根据最近完成记录，分析与跨团队协作任务更容易低估。</p><div className="ddl-box"><span>原始预估</span><b>2.0h</b><ArrowRight size={16}/><span>建议预估</span><b className="accent">2.4h</b></div></section></div></> }

function WaitingDashboard({data,updateTask,onTask}:{data:WorkData;updateTask:(id:string,p:Partial<Task>)=>void;onTask:(t:Task)=>void}) {
  const list=data.tasks.filter(t=>t.status==="Waiting");
  const longest=list.length?Math.max(...list.map(t=>Math.max(0,Math.floor((Date.now()-parseISO(t.createdAt).getTime())/86400000)))):0;
  return <div className="waiting-layout">
    <div className="waiting-summary"><div><span className="eyebrow">正在等待</span><b>{list.length}</b><p>个事项依赖他人反馈，不计入普通待办</p></div><div className="wait-ring"><b>{longest}</b><span>最长等待天数</span></div></div>
    <section className="panel waiting-table">
      <div className="table-head"><span>事项</span><span>等待人</span><span>等待内容</span><span>跟进日期</span><span>已等待</span><span/></div>
      {list.length?list.map(t=>{const days=Math.max(0,Math.floor((Date.now()-parseISO(t.createdAt).getTime())/86400000));const target=waitingTarget(t,data);return <div className="table-row" key={t.id}>
        <button className="table-task" onClick={()=>onTask(t)}><strong>{t.title}</strong><p>{projectName(data.projects,t.projectId)}</p></button>
        <span className="person">{target.avatar?<img className="person-avatar" src={target.avatar} alt=""/>:<span className="person-avatar">{target.initial}</span>}<span>{target.name}<small>{target.meta}</small></span></span>
        <span className="waiting-reason">{t.waitingReason||"未填写等待内容"}</span>
        <span>{t.followUpDate||t.dueDate||"未设置"}</span>
        <span className={cn("days",days>=3&&"late")}>{days} 天</span>
        <button className="secondary small" onClick={()=>updateTask(t.id,{status:"Todo",waitingForType:undefined,waitingForId:"",waitingForIds:[],waitingFor:"",waitingReason:"",followUpDate:""})}>收到反馈</button>
      </div>}):<EmptyState icon={Clock3} title="没有等待事项" text="当任务状态设为等待后，会在这里显示等待人、内容和跟进日期。"/>}
    </section>
  </div>
}

function ThinkingSpace({data,query,onOpen,onAdd}:{data:WorkData;query:string;onOpen:(r:Reflection)=>void;onAdd:(r?:Reflection)=>void}) { const [type,setType]=useState("全部"),[project,setProject]=useState("全部"); const list=data.reflections.filter(r=>(type==="全部"||r.type===type)&&(project==="全部"||r.relatedProjectId===project)&&fuzzyMatch(query,reflectionSearchFields(r,data)));return <><FilterBar><select value={type} onChange={e=>setType(e.target.value)}><option>全部</option>{["问题复盘","流程优化","风险提醒","经验沉淀","自动化想法","管理思考"].map(x=><option key={x}>{x}</option>)}</select><select value={project} onChange={e=>setProject(e.target.value)}><option value="全部">全部项目</option>{data.projects.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select><button onClick={()=>{setType("全部");setProject("全部")}}>清除筛选</button></FilterBar><div className="thought-grid"><button className="new-thought-card" onClick={()=>onAdd()}><div><Plus size={23}/></div><strong>记录一个新复盘</strong><span>关联具体项目或任务</span></button>{list.length?list.map(r=><article className="thought-card" key={r.id}><div className="thought-top"><span className="thought-tag">{r.type}</span><button aria-label="查看详情" onClick={()=>onOpen(r)}><MoreHorizontal size={17}/></button></div><h3>{r.title}</h3><p>{r.content}</p><div className="linked-context"><span>{projectName(data.projects,r.relatedProjectId)}</span>{r.relatedTaskId&&<span>{data.tasks.find(t=>t.id===r.relatedTaskId)?.title}</span>}</div><div className="thought-foot"><span>{r.date}</span><button onClick={()=>onOpen(r)}><ArrowRight size={15}/></button></div></article>):<EmptyState icon={Brain} title="没有匹配的复盘" text="换个关键词，或清空搜索恢复全部思考。"/>}</div></> }

function DisplaySettingsPage({settings,onChange}:{settings:DisplaySettings;onChange:(patch:Partial<DisplaySettings>)=>void}) {
  const fontOptions: { value: FontScale; label: string; hint: string }[] = [
    { value: "small", label: "Small · 13px", hint: "信息密度更高" },
    { value: "normal", label: "Medium · 14px", hint: "默认桌面体验" },
    { value: "large", label: "Large · 15px", hint: "适合 27 寸屏幕" },
    { value: "extra-large", label: "Extra Large · 16px", hint: "远距离或高分屏更舒服" },
  ];
  const widthOptions: { value: ContentWidth; label: string; hint: string }[] = [
    { value: "compact", label: "Compact", hint: "更聚焦的阅读宽度" },
    { value: "standard", label: "Standard", hint: "当前默认宽度" },
    { value: "wide", label: "Wide", hint: "适合 32 寸显示器" },
    { value: "full", label: "Full Width", hint: "尽量使用完整窗口" },
  ];
  const densityOptions: { value: Density; label: string; hint: string }[] = [
    { value: "compact", label: "Compact", hint: "更紧凑，适合快速扫视" },
    { value: "comfortable", label: "Comfortable", hint: "更松弛，适合长时间使用" },
  ];
  return <div className="display-settings">
    <section className="panel display-hero"><div><span className="eyebrow">DISPLAY PREFERENCES</span><h2>让 WorkOS 适合你的屏幕，而不是让你适应屏幕。</h2><p>这些设置只保存在当前浏览器，不修改任务、项目、会议或 Supabase 数据。</p></div><div className="display-current"><span>{fontOptions.find(o=>o.value===settings.fontScale)?.label}</span><span>{widthOptions.find(o=>o.value===settings.contentWidth)?.label}</span><span>{densityOptions.find(o=>o.value===settings.density)?.label}</span></div></section>
    <div className="display-settings-grid">
      <DisplayOptionGroup title="Font Scale" description="调整桌面端整体文字大小。" value={settings.fontScale} options={fontOptions} onSelect={value=>onChange({fontScale:value as FontScale})} />
      <DisplayOptionGroup title="Content Width" description="调整页面内容区域的最大宽度。" value={settings.contentWidth} options={widthOptions} onSelect={value=>onChange({contentWidth:value as ContentWidth})} />
      <DisplayOptionGroup title="Density" description="调整卡片、列表和页面的呼吸感。" value={settings.density} options={densityOptions} onSelect={value=>onChange({density:value as Density})} />
    </div>
    <section className="panel display-preview"><PanelHead title="实时预览" sub="切换选项后，当前页面和其他页面会立即继承。" /><div className="display-preview-body"><div className="display-preview-card"><span className="priority p1">P1</span><h3>确认新版埋点方案</h3><p>这是一个示例任务卡片，用于感受字体大小、内容宽度和页面密度变化。</p><div className="project-progress"><i style={{width:"68%"}} /></div></div><div className="display-preview-note"><strong>移动端说明</strong><p>iPhone 和窄屏设备会继续使用移动端专属布局，不会被大屏字体和宽度设置撑坏。</p></div></div></section>
  </div>;
}

function DisplayOptionGroup({title,description,value,options,onSelect}:{title:string;description:string;value:string;options:{value:string;label:string;hint:string}[];onSelect:(value:string)=>void}) {
  return <section className="panel display-option-card"><div className="display-option-head"><h3>{title}</h3><p>{description}</p></div><div className="display-choice-grid">{options.map(option => <button key={option.value} className={cn("display-choice", value === option.value && "active")} onClick={() => onSelect(option.value)}><strong>{option.label}</strong><span>{option.hint}</span></button>)}</div></section>;
}

function TaskCard({task,data,project,onOpen,onComplete,onDelete,onStatus,onStartTimer,onPauseTimer,onStopTimer}:{task:Task;data:WorkData;project:string;onOpen:()=>void;onComplete:()=>void;onDelete:()=>void;onStatus:(s:TaskStatus)=>void;onStartTimer:()=>void;onPauseTimer:()=>void;onStopTimer:()=>void}) { const running=!!task.timeTracking?.isRunning,progress=subtaskProgress(task),target=waitingTarget(task,data),waitingText=[target.name,task.waitingReason,task.followUpDate&&`${task.followUpDate} 跟进`].filter(Boolean).join(" · "); return <article className={cn("task-card",running&&"is-running")}><div className="task-card-top"><span className={`priority ${task.priority.toLowerCase()}`}>{task.priority}</span>{running&&<span className="running-badge">计时中</span>}<button aria-label="查看任务详情" onClick={onOpen}><MoreHorizontal size={16}/></button></div><button className="task-card-title" onClick={onOpen}><h3>{task.title}</h3><p>{task.description}</p></button><div className="project-tag">{project}</div>{progress.total>0&&<div className="card-subtasks"><span style={{width:`${progress.percent}%`}}/><b>{progress.completed}/{progress.total}</b></div>}{task.status==="Waiting"&&<div className="waiting-note"><Clock3 size={13}/> 等待 {waitingText}</div>}<div className="task-card-bottom"><span><CalendarDays size={14}/>{task.dueDate||"无截止"}</span><span><Timer size={14}/>{durationLabel(taskSeconds(task))} / {hoursLabel(task.estimatedHours)}</span></div><div className="card-actions timer-actions">{running?<><button onClick={onPauseTimer} className="active"><Pause size={14}/> 暂停</button><button onClick={onStopTimer}><Check size={14}/>结束计时</button></>:<button onClick={onStartTimer}><Play size={14}/> 开始计时</button>}{task.status!=="Done"&&<button onClick={onComplete}><Check size={14}/>完成</button>}<select aria-label="更新状态" value={task.status} onChange={e=>onStatus(e.target.value as TaskStatus)}><option value="Todo">待开始</option><option value="Doing">进行中</option><option value="Waiting">等待中</option><option value="Done">已完成</option></select><button className="danger-mini" onClick={onDelete}><Trash2 size={13}/> 删除</button></div></article> }
function StatCard({label,value,unit,detail,icon:Icon,tone,onClick}:{label:string;value:number;unit:string;detail:string;icon:typeof Target;tone:string;onClick?:()=>void}) {
  const body = <><div className={`stat-icon ${tone}`}><Icon size={19}/></div><div><span>{label}</span><div className="stat-value">{value}<small>{unit}</small></div><p>{detail}</p></div></>;
  return onClick ? <button type="button" className="stat-card stat-card-button" onClick={onClick} aria-label={`查看${label}明细`}>{body}</button> : <div className="stat-card">{body}</div>;
}
function PanelHead({title,sub,action,onAction}:{title:string;sub:string;action?:string;onAction?:()=>void}){return <div className="panel-head"><div><h2>{title}</h2><p>{sub}</p></div>{action&&<button onClick={onAction}>{action}<ArrowRight size={14}/></button>}</div>}
function MeetingSection({icon:Icon,title,badge,children}:{icon:typeof BookOpen;title:string;badge?:string;children:React.ReactNode}){return <section className="meeting-section"><h3><Icon size={17}/>{title}{badge&&<span>{badge}</span>}</h3>{children}</section>}
function ReviewSection({n,title,desc,tasks,data,tone}:{n:string;title:string;desc:string;tasks:Task[];data:WorkData;tone?:string}){return <section className={cn("review-section",tone)}><div className="review-number">{n}</div><div><h3>{title}</h3><p className="section-desc">{desc}</p>{tasks.length?tasks.map(t=><div className="review-line" key={t.id}><CheckCircle2 size={17}/><div><strong>{t.title}</strong><span>{projectName(data.projects,t.projectId)} · {hoursLabel(taskHours(t))}</span></div></div>):<p className="meeting-notes">暂无相关事项</p>}</div></section>}
function FilterBar({children}:{children:React.ReactNode}){return <div className="filter-bar">{children}</div>}
function EmptyState({icon:Icon,title,text}:{icon:typeof Inbox;title:string;text:string}){return <div className="empty"><Icon size={26}/><strong>{title}</strong><p>{text}</p></div>}

function DrillDownDrawer({open,onClose,title,subtitle,children}:{open:boolean;onClose:()=>void;title:string;subtitle:string;children:React.ReactNode}) {
  return <Dialog.Root open={open} onOpenChange={o=>!o&&onClose()}><Dialog.Portal><Dialog.Overlay className="drawer-overlay"/><Dialog.Content className="drilldown-drawer"><div className="drawer-head"><div><Dialog.Title>{title}</Dialog.Title><Dialog.Description>{subtitle}</Dialog.Description></div><Dialog.Close className="icon-button"><X size={18}/></Dialog.Close></div>{children}</Dialog.Content></Dialog.Portal></Dialog.Root>;
}

function BaseDialog({open,onOpenChange,title,subtitle,children,wide}:{open:boolean;onOpenChange:(o:boolean)=>void;title:string;subtitle:string;children:React.ReactNode;wide?:boolean}){return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="dialog-overlay"/><Dialog.Content className={cn("dialog-content",wide&&"dialog-wide")}><div className="dialog-head"><div><Dialog.Title>{title}</Dialog.Title><Dialog.Description>{subtitle}</Dialog.Description></div><Dialog.Close className="icon-button"><X size={18}/></Dialog.Close></div>{children}</Dialog.Content></Dialog.Portal></Dialog.Root>}
function Field({label,children,wide,helper}:{label:string;children:React.ReactNode;wide?:boolean;helper?:string;tip?:string}){return <label className={cn("field",wide&&"wide")}><span className="field-label">{label}</span>{children}{helper&&<small className="field-helper">{helper}</small>}</label>}
function ProjectSelect({label,value,projects,onChange,onCreateProject,helper,tip}:{label:string;value:string;projects:Project[];onChange:(id:string)=>void;onCreateProject:(p:Project)=>Project;helper?:string;tip?:string}) { const [open,setOpen]=useState(false); return <><Field label={label} helper={helper || "选择后，这条记录会出现在对应项目档案中；也会用于报告和分析归类。"} tip={tip || "可以不关联，也可以直接新建项目。"}><select value={value} onChange={e=>{if(e.target.value===NEW_PROJECT_VALUE)setOpen(true);else onChange(e.target.value)}}><option value="">不关联</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}<option value={NEW_PROJECT_VALUE}>+ 新建项目</option></select></Field><MiniProjectDialog open={open} onOpenChange={setOpen} onSave={project=>{const saved=onCreateProject(project);onChange(saved.id);setOpen(false)}}/></> }
function MiniProjectDialog({open,onOpenChange,onSave}:{open:boolean;onOpenChange:(o:boolean)=>void;onSave:(p:Project)=>void}) {
  const [form,setForm]=useState<Project>(blankProject());
  useEffect(()=>{if(open)setForm(blankProject())},[open]);
  const f=<K extends keyof Project>(k:K,v:Project[K])=>setForm(x=>({...x,[k]:v}));
  return <BaseDialog open={open} onOpenChange={onOpenChange} title="新建关联项目" subtitle="创建后会自动选中到当前表单。" wide>
    <div className="form-grid">
      <Field label="项目名称" wide helper="给项目一个能被搜索和识别的名称。" tip="会显示在任务、会议、复盘和报告中。"><input autoFocus value={form.name} onChange={e=>f("name",e.target.value)} placeholder="例如：WorkOS 移动端适配"/></Field>
      <Field label="项目类型" helper="用于粗略分类项目，无固定格式。" tip="例如业务增长、内部能力、产品体验、研究。"><input value={form.type} onChange={e=>f("type",e.target.value)} placeholder="例如：产品体验"/></Field>
      <Field label="项目状态" helper="用于项目看板和报告判断当前阶段。"><select value={form.status} onChange={e=>f("status",e.target.value as ProjectStatus)}><option value="Planning">规划中</option><option value="Active">进行中</option><option value="Paused">已暂停</option><option value="Done">已完成</option></select></Field>
      <Field label="优先级" helper="P0 最高，P3 最低。用于首页和项目排序。"><select value={form.priority} onChange={e=>f("priority",e.target.value as Priority)}><option>P0</option><option>P1</option><option>P2</option><option>P3</option></select></Field>
      <Field label="截止时间" helper="用于到期提醒、延期判断和项目时间线。"><input type="date" value={form.dueDate} onChange={e=>f("dueDate",e.target.value)} /></Field>
      <Field label="项目背景" wide helper="用于记录项目为什么开始、当前问题和业务背景。无固定格式。" tip="后续项目档案、复盘和报告会引用这部分上下文。"><textarea value={form.background} onChange={e=>f("background",e.target.value)} placeholder="例如：当前 WorkOS 已完成桌面端基础能力，但移动端适配不足，需要优化响应式布局。"/></Field>
      <Field label="项目目标" wide helper="用于记录项目最终希望达成的结果。建议写成可验证的目标。" tip="目标越具体，周报/月报里的项目推进就越清晰。"><textarea value={form.goal} onChange={e=>f("goal",e.target.value)} placeholder="例如：完成 iPhone 15 Pro Max Chrome 移动端适配，无横向滚动，核心流程可用。"/></Field>
    </div>
    <div className="dialog-foot"><span>保存后自动关联</span><button className="primary" disabled={!form.name.trim()} onClick={()=>onSave(form)}><Save size={15}/> 创建并选中</button></div>
  </BaseDialog>
}

function CaptureDialog({open,contacts,onCreateContact,onOpenChange,onAdd}:{open:boolean;contacts:Contact[];onCreateContact:(name:string)=>Contact|null;onOpenChange:(o:boolean)=>void;onAdd:(t:Task)=>void}) {
  const [title,setTitle]=useState(""),[source,setSource]=useState("快速记录"),[requesterContactId,setRequesterContactId]=useState("");
  const requester = findContact(contacts, requesterContactId);
  const submit=()=>{if(!title.trim())return;onAdd(blankTask({title,description:"",source,requester:requester?.name||"",requesterContactId:requester?.id||"",createdBy:"",createdByContactId:"",projectId:"",status:"Inbox",priority:"P2",dueDate:"",estimatedHours:.5,actualHours:0,createdAt:todayISO()}));setTitle("");setRequesterContactId("");onOpenChange(false)};
  return <BaseDialog open={open} onOpenChange={onOpenChange} title="快速记录" subtitle="先捕捉，不必现在就整理。">
    <div className="capture-box">
      <textarea autoFocus value={title} onChange={e=>setTitle(e.target.value)} placeholder="例如：客户反馈新版看板筛选有问题，需要本周确认原因。" aria-label="快速记录内容"/>
      <p className="capture-helper">无固定格式。这里适合先记下收到的任务、想法或提醒，保存后会进入 Inbox，稍后再整理成正式任务。</p>
      <div className="form-grid">
        <Field label="来源" helper="记录任务从哪里来，后续搜索和复盘时会用到。" tip="例如会议、邮件、私聊、项目群。"><select value={source} onChange={e=>setSource(e.target.value)}><option>快速记录</option><option>会议</option><option>邮件</option><option>私聊</option><option>项目群</option></select></Field>
        <ContactPicker label="提出人" contacts={contacts} selectedId={requesterContactId} legacy="" onSelect={setRequesterContactId} onCreateContact={onCreateContact} allowEmpty helper="谁提出或触发了这件事。必须来自联系人表。" />
      </div>
    </div>
    <div className="dialog-foot"><span>将进入 Inbox，稍后再处理</span><button className="primary" onClick={submit}>保存记录</button></div>
  </BaseDialog>
}

function TaskDialog({open,task,projects,contacts,onCreateProject,onCreateContact,onOpenChange,onSave}:{open:boolean;task:Task|null;projects:Project[];contacts:Contact[];onCreateProject:(p:Project)=>Project;onCreateContact:(name:string)=>Contact|null;onOpenChange:(o:boolean)=>void;onSave:(t:Task)=>void}) {
  const [form,setForm]=useState<Task>(blankTask());
  const [newSubtask,setNewSubtask]=useState("");
  const [error,setError]=useState("");
  const isExisting = !!task?.title?.trim();
  useEffect(()=>{if(open){const requesterMatch=task?.requesterContactId?findContact(contacts,task.requesterContactId):findContactByText(contacts,task?.requester);const waitingIds=Array.from(new Set([...(task?.waitingForIds || []), task?.waitingForId || ""].filter(Boolean)));const legacyWaiting=findContactByText(contacts,task?.waitingFor);const resolvedWaitingIds=waitingIds.length?waitingIds:(legacyWaiting?[legacyWaiting.id]:[]);setForm(task?{...blankTask(),...task,requesterContactId:requesterMatch?.id||task.requesterContactId||"",requester:requesterMatch?.name||task.requester||"",subtasks:sortedSubtasks(task),autoCompleteOnSubtasksDone:task.autoCompleteOnSubtasksDone??true,tags:[...(task.tags || [])],timeTracking:task.timeTracking||blankTracking(),actualHours:taskHours(task),waitingForType:resolvedWaitingIds.length?"contact":(task.waitingFor ? "legacy" : undefined),waitingForIds:resolvedWaitingIds,waitingForId:resolvedWaitingIds[0]||"",waitingFor:resolvedWaitingIds.map(id=>contactName(contacts,id)).filter(Boolean).join("、")||task.waitingFor||"",waitingReason:task.waitingReason||"",followUpDate:task.followUpDate||""}:blankTask());setNewSubtask("");setError("");}},[open,task,contacts]);
  const f=<K extends keyof Task>(k:K,v:Task[K])=>setForm(x=>({...x,[k]:v}));
  const patchSubtask=(id:string,patch:Partial<Task["subtasks"][number]>)=>setForm(x=>applySubtaskCompletion({...x,subtasks:sortedSubtasks(x).map(item=>item.id===id?{...item,...patch,updatedAt:new Date().toISOString()}:item)}));
  const moveSubtask=(id:string,delta:number)=>setForm(x=>{const items=sortedSubtasks(x);const index=items.findIndex(item=>item.id===id);const nextIndex=index+delta;if(index<0||nextIndex<0||nextIndex>=items.length)return x;const next=[...items];const [item]=next.splice(index,1);next.splice(nextIndex,0,item);return {...x,subtasks:next.map((entry,order)=>({...entry,order}))};});
  const deleteSubtask=(id:string)=>setForm(x=>applySubtaskCompletion({...x,subtasks:sortedSubtasks(x).filter(item=>item.id!==id).map((item,order)=>({...item,order}))}));
  const addSubtask=()=>{const title=newSubtask.trim();if(!title)return;setForm(x=>({...x,subtasks:[...sortedSubtasks(x),{id:uid("subtask"),title,done:false,order:x.subtasks.length,createdAt:todayISO()}]}));setNewSubtask("");};
  const save=()=>{const requester=findContact(contacts,form.requesterContactId);const waitingContacts=form.status==="Waiting"?(form.waitingForIds || []).map(id=>findContact(contacts,id)).filter(Boolean) as Contact[]:[];if(form.status==="Waiting"&&!waitingContacts.length){setError("请选择有效等待人");return}onSave(applySubtaskCompletion({...form,requesterContactId:requester?.id||"",requester:requester?.name||"",actualHours:taskHours(form),completedAt:form.status==="Done"?(form.completedAt||todayISO()):undefined,waitingForType:form.status==="Waiting"?"contact":undefined,waitingForIds:form.status==="Waiting"?waitingContacts.map(contact=>contact.id):[],waitingForId:form.status==="Waiting"?(waitingContacts[0]?.id||""):"",waitingFor:form.status==="Waiting"?waitingContacts.map(contact=>contact.name).join("、"):"",waitingReason:form.status==="Waiting"?form.waitingReason:"",followUpDate:form.status==="Waiting"?form.followUpDate:""}));};
  return <BaseDialog open={open} onOpenChange={onOpenChange} title={isExisting?"编辑任务":"新建任务"} subtitle="补全上下文，未来的你会感谢现在的你。" wide>
    <div className="form-grid">
      <Field label="任务标题" wide helper="写成一个清晰可完成的结果，会显示在首页、任务中心和报告里。" tip="建议用动词开头，例如“确认新版埋点方案”。"><input autoFocus value={form.title} onChange={e=>f("title",e.target.value)} placeholder="例如：确认新版埋点方案"/></Field>
      <Field label="描述" wide helper="补充任务背景、完成标准或上下文。无固定格式。" tip="后续任务详情、搜索和报告会读取这部分内容。"><textarea value={form.description} onChange={e=>f("description",e.target.value)} placeholder="例如：和数据团队确认埋点口径，输出最终字段清单和上线检查项。"/></Field>
      <ProjectSelect label="关联项目" value={form.projectId} projects={projects} onChange={v=>f("projectId",v)} onCreateProject={onCreateProject}/>
      <Field label="状态" helper="决定任务出现在 Inbox、待办、进行中、等待或完成区域。" tip="Waiting 状态会进入等待看板。"><select value={form.status} onChange={e=>f("status",e.target.value as TaskStatus)}><option value="Inbox">Inbox</option><option value="Todo">待开始</option><option value="Doing">进行中</option><option value="Waiting">等待中</option><option value="Done">已完成</option></select></Field>
      <Field label="优先级" helper="P0 最高，P3 最低。用于今日重点和排序。"><select value={form.priority} onChange={e=>f("priority",e.target.value as Priority)}><option>P0</option><option>P1</option><option>P2</option><option>P3</option></select></Field>
      <Field label="截止日期" helper="用于到期提醒、延期统计和报告风险项。"><input type="date" value={form.dueDate} onChange={e=>f("dueDate",e.target.value)}/></Field>
      <Field label="预估工时" helper="单位是小时，可填 0.25、0.5、1.5。后续会和真实计时做偏差分析。" tip="实际工时由计时器自动汇总。"><input type="number" step="0.25" min="0" value={form.estimatedHours} onChange={e=>f("estimatedHours",+e.target.value)} placeholder="例如：1.5"/></Field>
      <Field label="实际工时" helper="只读字段，由开始/暂停/结束计时自动生成，不需要手填。"><input value={`${durationLabel(taskSeconds(form))}（由计时自动生成）`} readOnly /></Field>
      <Field label="来源" wide helper="记录任务来源，支持自由输入。" tip="例如会议、客户、老板、项目群。"><input value={form.source} onChange={e=>f("source",e.target.value)} placeholder="例如：会议 / 邮件 / 项目群"/></Field>
      <div className="field wide subtask-editor">
        <span>子任务</span>
        <div className="subtask-progress"><b>{subtaskProgress(form).completed}/{subtaskProgress(form).total}</b><span style={{width:`${subtaskProgress(form).percent}%`}}/></div>
        <div className="subtask-add"><input value={newSubtask} onChange={e=>setNewSubtask(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();addSubtask();}}} placeholder="添加子任务"/><button className="secondary" type="button" onClick={addSubtask}><Plus size={14}/> 添加</button></div>
        {sortedSubtasks(form).map((item,index)=><div className="subtask-row" key={item.id}>
          <input type="checkbox" checked={item.done} onChange={e=>patchSubtask(item.id,{done:e.target.checked})}/>
          <input value={item.title} onChange={e=>patchSubtask(item.id,{title:e.target.value})}/>
          <button className="secondary small" type="button" disabled={index===0} onClick={()=>moveSubtask(item.id,-1)} aria-label="上移子任务"><ArrowUp size={13}/></button>
          <button className="secondary small" type="button" disabled={index===form.subtasks.length-1} onClick={()=>moveSubtask(item.id,1)} aria-label="下移子任务"><ArrowDown size={13}/></button>
          <button className="secondary small danger" type="button" onClick={()=>deleteSubtask(item.id)} aria-label="删除子任务"><Trash2 size={13}/></button>
        </div>)}
      </div>
      <ContactPicker label="提出人" contacts={contacts} selectedId={form.requesterContactId || ""} legacy={form.requester && !form.requesterContactId ? form.requester : ""} onSelect={id=>setForm(x=>({...x,requesterContactId:id,requester:contactName(contacts,id)}))} onCreateContact={onCreateContact} allowEmpty helper="单选。必须从联系人表选择；旧文本只读显示，不再新写入。" />
      {form.status==="Waiting"&&<>
        <PersonPicker label="等待人" contacts={contacts} mode="multi" selectedIds={form.waitingForIds || []} legacy={form.waitingForType==="legacy" ? form.waitingFor || "" : ""} onChange={ids=>setForm(x=>({...x,waitingForType:ids.length?"contact":undefined,waitingForIds:ids,waitingForId:ids[0]||"",waitingFor:ids.map(id=>contactName(contacts,id)).filter(Boolean).join("、")}))} onCreateContact={onCreateContact} helper="可多选。已选择联系人不会重复出现在候选列表。" />
        <Field label="跟进日期" helper="到这个日期提醒自己主动跟进。"><input type="date" value={form.followUpDate||""} onChange={e=>f("followUpDate",e.target.value)}/></Field>
        <Field label="等待内容" wide helper="说明具体在等什么，避免等待事项变成普通待办。无固定格式。"><textarea value={form.waitingReason||""} onChange={e=>f("waitingReason",e.target.value)} placeholder="例如：等待对方确认新版埋点方案口径，确认后才能推进上线检查。"/></Field>
      </>}
    </div>
    {error&&<p className="form-error">{error}</p>}
    <div className="dialog-foot"><span>保存后会自动写入当前数据源</span><button className="primary" disabled={!form.title.trim()} onClick={save}><Save size={15}/> 保存任务</button></div>
  </BaseDialog>
}

function ContactPicker(props:{label:string;contacts:Contact[];selectedId:string;legacy:string;onSelect:(id:string)=>void;onCreateContact:(name:string)=>Contact|null;helper?:string;allowEmpty?:boolean}) {
  return <PersonPicker mode="single" {...props} selectedIds={props.selectedId ? [props.selectedId] : []} onChange={ids=>props.onSelect(ids[0] || "")} />;
}

function PersonPicker({label,contacts,mode,selectedIds,legacy,onChange,onCreateContact,helper,allowEmpty=false}:{label:string;contacts:Contact[];mode:"single"|"multi";selectedIds:string[];legacy?:string;onChange:(ids:string[])=>void;onCreateContact:(name:string)=>Contact|null;helper?:string;allowEmpty?:boolean}) {
  const [query,setQuery]=useState("");
  const [recentIds,setRecentIds]=useState<string[]>([]);
  useEffect(()=>{setRecentIds(readRecentContactIds())},[]);
  const normalized=normalizeSearch(query);
  const selectedContacts = selectedIds.map(id => contacts.find(contact => contact.id === id)).filter(Boolean) as Contact[];
  const selectedSet = new Set(selectedContacts.map(contact => contact.id));
  const selected = mode === "single" ? selectedContacts[0] : undefined;
  const contactMatches=contacts.filter(contact=>fuzzyMatch(normalized,contactSearchValues(contact)) && !selectedSet.has(contact.id));
  const recentContacts=recentIds.map(id=>contacts.find(contact=>contact.id===id)).filter(Boolean) as Contact[];
  const shownContacts=(normalized
    ? contactMatches
    : [...recentContacts.filter(contact=>!selectedSet.has(contact.id)),...contactMatches.filter(contact=>!recentIds.includes(contact.id))]
  ).slice(0,12);
  const selectContact=(id:string)=>{
    if(id){rememberRecentContact(id);setRecentIds(readRecentContactIds())}
    if (mode === "multi") onChange(selectedSet.has(id) ? selectedIds.filter(item => item !== id) : [...selectedIds, id]);
    else onChange(id ? [id] : []);
    setQuery("");
  };
  const removeContact=(id:string)=>onChange(selectedIds.filter(item => item !== id));
  const createContact=()=>{const name=query.trim();if(!name)return;const contact=onCreateContact(name);if(contact){rememberRecentContact(contact.id);setRecentIds(readRecentContactIds());selectContact(contact.id)}};
  const onKeyDown=(event:ReactKeyboardEvent<HTMLInputElement>)=>{
    if(event.key==="Enter"){event.preventDefault();if(shownContacts[0])selectContact(shownContacts[0].id);else createContact();}
    if(event.key==="Backspace" && !query && mode==="multi" && selectedIds.length){event.preventDefault();removeContact(selectedIds[selectedIds.length-1]);}
  };
  return <div className="field wide contact-picker">
    <span>{label}</span>
    {helper&&<small className="field-helper">{helper}</small>}
    {mode==="multi" && !!selectedContacts.length && <div className="person-tags">{selectedContacts.map(contact=><button type="button" key={contact.id} onClick={()=>removeContact(contact.id)}>{contact.avatar?<img src={contact.avatar} alt=""/>:<span>{contact.name.slice(0,1)}</span>}<strong>{contact.name}</strong><X size={12}/></button>)}</div>}
    {mode==="single" && selected&&<div className="contact-picker-selected">{selected.avatar?<img src={selected.avatar} alt=""/>:<span className="person-avatar">{selected.name.slice(0,1)}</span>}<div><strong>{selected.name}</strong><small>{[selected.role,selected.departmentName || selected.team,selected.email].filter(Boolean).join(" · ") || "联系人"}</small></div>{allowEmpty&&<button type="button" onClick={()=>selectContact("")}>清除</button>}</div>}
    <input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={onKeyDown} placeholder="搜索姓名、邮箱、电话或部门"/>
    {legacy && <p className="contact-picker-legacy">旧文本：{legacy}。请选择一个联系人完成结构化。</p>}
    <div className="contact-picker-list">
      {!normalized && !!recentContacts.length && <p className="contact-picker-section-label">最近联系人</p>}
      {shownContacts.length ? <>
        {shownContacts.map(contact=><button type="button" className={cn("contact-picker-item",selectedSet.has(contact.id)&&"selected")} key={contact.id} onClick={()=>selectContact(contact.id)}>
          {contact.avatar?<img src={contact.avatar} alt=""/>:<span className="person-avatar">{contact.name.slice(0,1)}</span>}
          <div><strong>{contact.name}</strong><small>{[contact.role,contact.departmentName || contact.team,contact.email].filter(Boolean).join(" · ") || contactLabel(contact)}</small></div>
        </button>)}
      </> : <div className="contact-picker-empty"><p>未找到联系人</p>{query.trim()&&<button type="button" onClick={createContact}>+ 创建联系人「{query.trim()}」</button>}</div>}
    </div>
  </div>;
}

function ProjectDialog({open,project,onOpenChange,onSave}:{open:boolean;project:Project|null;onOpenChange:(o:boolean)=>void;onSave:(p:Project)=>void}) {
  const [form,setForm]=useState<Project>(blankProject());
  useEffect(()=>{if(open)setForm(project?{...project,risks:[...project.risks]}:blankProject())},[open,project]);
  const f=<K extends keyof Project>(k:K,v:Project[K])=>setForm(x=>({...x,[k]:v}));
  return <BaseDialog open={open} onOpenChange={onOpenChange} title={project?"编辑项目":"新建项目"} subtitle="建立一份包含背景、目标和行动的项目档案。" wide>
    <div className="form-grid">
      <Field label="项目名称" wide helper="项目会成为任务、会议、复盘和报告的共同上下文。" tip="名称建议稳定、可搜索。"><input autoFocus value={form.name} onChange={e=>f("name",e.target.value)} placeholder="例如：WorkOS 移动端体验优化"/></Field>
      <Field label="项目类型" helper="用于粗略分类项目，无固定格式。" tip="例如业务增长、内部能力、产品体验、研究。"><input value={form.type} onChange={e=>f("type",e.target.value)} placeholder="例如：产品体验"/></Field>
      <Field label="状态" helper="用于项目概览、项目档案和报告展示。"><select value={form.status} onChange={e=>f("status",e.target.value as Project["status"])}><option value="Planning">规划中</option><option value="Active">进行中</option><option value="Paused">已暂停</option><option value="Done">已完成</option></select></Field>
      <Field label="优先级" helper="P0 最高，P3 最低。用于项目排序和风险关注。"><select value={form.priority} onChange={e=>f("priority",e.target.value as Priority)}><option>P0</option><option>P1</option><option>P2</option><option>P3</option></select></Field>
      <Field label="进度" helper="填写 0-100 的数字，用于项目进度条和报告。" tip="例如 68 表示 68%。"><input type="number" min="0" max="100" value={form.progress} onChange={e=>f("progress",+e.target.value)} placeholder="例如：68"/></Field>
      <Field label="开始日期" helper="用于项目时间线和阶段分析。"><input type="date" value={form.startDate} onChange={e=>f("startDate",e.target.value)}/></Field>
      <Field label="截止日期" helper="用于项目时间线、即将到期和超期判断。"><input type="date" value={form.dueDate} onChange={e=>f("dueDate",e.target.value)}/></Field>
      <Field label="项目背景" wide helper="用于记录项目为什么开始、当前问题和业务背景。无固定格式。" tip="项目档案和报告会引用这段上下文。"><textarea value={form.background} onChange={e=>f("background",e.target.value)} placeholder="例如：当前 WorkOS 已完成桌面端基础能力，但移动端适配不足，需要优化响应式布局。"/></Field>
      <Field label="项目目标" wide helper="用于记录项目最终希望达成的结果。建议写成可验证的目标。" tip="目标越具体，后续复盘越容易判断是否达成。"><textarea value={form.goal} onChange={e=>f("goal",e.target.value)} placeholder="例如：完成 iPhone 15 Pro Max Chrome 移动端适配，无横向滚动，核心流程可用。"/></Field>
      <Field label="风险点（每行一条）" wide helper="每一行代表一个独立风险，后续可用于复盘和报告。" tip="格式：每行一条，不需要编号。"><textarea value={form.risks.join("\n")} onChange={e=>f("risks",e.target.value.split("\n").filter(Boolean))} placeholder={"例如：\n移动端 Modal 内容过长导致按钮不可见\n看板列过多导致横向溢出\n字体缩放可能影响桌面端布局"}/></Field>
      <Field label="下一步行动" wide helper="记录项目下一步最重要的行动。无固定格式，可写多条。" tip="会显示在项目档案和首页项目概览中。"><textarea value={form.nextAction} onChange={e=>f("nextAction",e.target.value)} placeholder={"例如：\n检查所有 Modal 移动端宽度\n补充字段填写说明\n新增显示设置页面"}/></Field>
    </div>
    <div className="dialog-foot"><span>任务关联会自动同步</span><button className="primary" disabled={!form.name.trim()} onClick={()=>onSave(form)}><Save size={15}/> 保存项目</button></div>
  </BaseDialog>
}

function MeetingDialogV2({open,meeting,data,onCreateProject,onCreateContact,onOpenChange,onSave}:{open:boolean;meeting:Meeting|null;data:WorkData;onCreateProject:(p:Project)=>Project;onCreateContact:(name:string)=>Contact|null;onOpenChange:(o:boolean)=>void;onSave:(m:Meeting)=>void|Promise<void>}) {
  const blank=():Meeting=>({id:uid("meeting"),title:"",startTime:`${todayISO()}T10:00`,date:`${todayISO()}T10:00`,endTime:`${todayISO()}T11:00`,durationMinutes:60,manualTimeOverride:true,attendees:[],location:"",notes:"",decisions:[],actionItems:[],relatedProjectId:"",relatedTaskId:""});
  const [form,setForm]=useState<Meeting>(blank());
  const [draftStart,setDraftStart]=useState("");
  const [draftEnd,setDraftEnd]=useState("");
  const startInputRef=useRef<HTMLInputElement|null>(null);
  const endInputRef=useRef<HTMLInputElement|null>(null);
  const [actionsText,setActionsText]=useState("");
  const [actionRows,setActionRows]=useState<Meeting["actionItems"]>([]);
  const [attendeePickerId,setAttendeePickerId]=useState("");
  const [error,setError]=useState("");
  useEffect(()=>{if(open){const event=meeting?toCalendarEvent(meeting):null;const base=meeting?{...meeting,startTime:event?formatLocalDateTime(event.localStart):"",date:event?formatLocalDateTime(event.localStart):(meeting.date || ""),endTime:event?formatLocalDateTime(event.localEnd):"",durationMinutes:event?.durationMinutes || 0,attendees:[...meeting.attendees],decisions:[...meeting.decisions],actionItems:[...meeting.actionItems]}:blank();setForm(base);setDraftStart(base.startTime || base.date || "");setDraftEnd(base.endTime || "");setActionRows(base.actionItems);setActionsText(serializeMeetingActions(base.actionItems));setError("")}},[open,meeting]);
  const f=<K extends keyof Meeting>(k:K,v:Meeting[K])=>setForm(x=>({...x,[k]:v}));
  const setRows=(rows:Meeting["actionItems"])=>{setActionRows(rows);setActionsText(serializeMeetingActions(rows))};
  const setText=(text:string)=>{setActionsText(text);setActionRows(parseMeetingActions(text,actionRows))};
  const addContact=(id:string)=>{const c=data.contacts?.find(x=>x.id===id);if(c){f("attendees",uniqueNames([...form.attendees,c.name]));setAttendeePickerId("")}};
  const submit=()=>{const startInput=startInputRef.current?.value||draftStart||form.startTime||form.date,endInput=endInputRef.current?.value||draftEnd||form.endTime;const inputDate=(startInput||todayISO()).slice(0,10),inputStartTime=(startInput||"").slice(11,16),inputEndTime=(endInput||"").slice(11,16);const startTime=inputDate&&inputStartTime?buildLocalDateTimeString(inputDate,inputStartTime):"",endTime=inputDate&&inputEndTime?buildLocalDateTimeString(inputDate,inputEndTime):"";if(!startTime||!endTime){setError("请填写有效的开始和结束时间");return}if(isInvalidTimeRange(startTime,endTime)){setError("会议结束时间必须晚于开始时间");return}const durationMinutes=calculateDurationMinutes(startTime,endTime);const payload={...form,startTime,date:startTime.slice(0,10),endTime,durationMinutes,manualTimeOverride:true,rawPayload:{...rawObject(form.rawPayload),manualTimeOverride:true,timeSource:"manual-form-v2",debugSave:{inputDate,inputStartTime,inputEndTime,dialogStartTime:draftStart,dialogEndTime:draftEnd,savePayloadStartTime:startTime,savePayloadEndTime:endTime,timezoneOffset:new Date().getTimezoneOffset()}},attendees:uniqueNames(form.attendees),actionItems:actionRows.filter(a=>a.text.trim()).map(a=>({id:a.id||uid("action"),text:a.text.trim(),owner:a.owner?.trim()||"我",dueDate:a.dueDate||todayISO(),taskId:a.taskId}))};console.info("[WorkOS meeting save trace]",payload.rawPayload.debugSave);void onSave(payload)};
  const extract=()=>{const rows=extractActionsFromNotes(form.notes);if(!rows.length){alert("未识别到可执行行动项");return}setRows([...actionRows,...rows])};
  return <BaseDialog open={open} onOpenChange={onOpenChange} title={meeting?"编辑会议":"新建会议"} subtitle="记录讨论、决策与可执行的行动项。" wide>
    <div className="form-grid">
      <Field label="会议名称" wide helper="写清楚会议主题，会显示在会议中心、项目档案和报告中。" tip="例如：埋点方案评审 / 售后复盘会。"><input autoFocus value={form.title} onChange={e=>f("title",e.target.value)} placeholder="例如：新版埋点方案评审"/></Field>
      <Field label="开始时间" helper="用于会议日历时间轴、工作日志和报告统计。"><input ref={startInputRef} type="datetime-local" value={toDateTimeLocal(draftStart)} onChange={e=>{const value=e.target.value;setDraftStart(value);f("startTime",value);f("date",value.slice(0,10));if(isInvalidTimeRange(value,draftEnd)){const nextEnd=addLocalMinutes(value,60);setDraftEnd(nextEnd);f("endTime",nextEnd);}}}/></Field>
      <Field label="结束时间" helper="结束时间必须晚于开始时间，保存时自动计算会议时长。"><input ref={endInputRef} type="datetime-local" value={toDateTimeLocal(draftEnd)} onChange={e=>{setDraftEnd(e.target.value);f("endTime",e.target.value)}}/></Field>
      <ProjectSelect label="关联项目" value={form.relatedProjectId} projects={data.projects} onChange={v=>f("relatedProjectId",v)} onCreateProject={onCreateProject}/>
      <Field label="关联任务" helper="可选。会议可以关联一个任务，但会议本身仍是独立时间实体。"><select value={form.relatedTaskId || ""} onChange={e=>f("relatedTaskId",e.target.value)}><option value="">不关联</option>{data.tasks.filter(t=>t.status!=="Inbox").map(t=><option key={t.id} value={t.id}>{t.title}</option>)}</select></Field>
      <Field label="地点" helper="会议室、线上链接或地点描述。"><input value={form.location || ""} onChange={e=>f("location",e.target.value)} placeholder="例如：线上会议 / 3F 会议室"/></Field>
      <div className="field wide attendee-field">
        <span>参与人</span>
        <small className="field-helper">参与人只从联系人表选择，找不到时可直接创建联系人。</small>
        <ContactPicker label="添加参与人" contacts={data.contacts||[]} selectedId={attendeePickerId} legacy="" onSelect={id=>{setAttendeePickerId(id);addContact(id)}} onCreateContact={onCreateContact} allowEmpty helper="搜索或创建联系人后自动加入会议。" />
        <div className="attendee-chips">{form.attendees.map(a=><span key={a}>{a}<button type="button" onClick={()=>f("attendees",form.attendees.filter(x=>x!==a))}>×</button></span>)}</div>
      </div>
      <Field label="会议纪要" wide helper="自由记录会议内容，无固定格式。可按自然语言、要点或段落记录。" tip="这里的内容可用于提取行动项，也会进入会议详情。"><textarea value={form.notes} onChange={e=>f("notes",e.target.value)} placeholder="例如：本次讨论确认了埋点字段口径，数据团队负责补充字段说明，产品侧下周三前确认上线范围。"/></Field>
      <Field label="决策事项（每行一条）" wide helper="每行一条决策，用于后续复盘和报告。" tip="格式：每行一条，不需要编号。"><textarea value={form.decisions.join("\n")} onChange={e=>f("decisions",e.target.value.split("\n").map(x=>x.trim()).filter(Boolean))} placeholder={"例如：\n新版埋点方案按 A 方案推进\n本周先覆盖核心转化漏斗\n异常数据由数据团队每日同步"}/></Field>
      <Field label="行动项快速输入（内容 | 负责人 | YYYY-MM-DD）" wide helper="推荐结构化格式：内容 | 负责人 | YYYY-MM-DD。每行一条。也可以用下方可视化编辑器填写。" tip="保存后仍写入原行动项结构，可一键生成任务。">
        <textarea value={actionsText} onChange={e=>setText(e.target.value)} placeholder={"整理复盘材料 | 我 | 2026-06-25\n确认新版埋点方案 | 小王 | 2026-06-28"}/>
        <div className="action-editor">
          <div className="action-editor-head"><span>可视化行动项</span><div><button type="button" className="secondary small" onClick={extract}><Sparkles size={13}/> 从纪要提取行动项</button><button type="button" className="secondary small" onClick={()=>setRows([...actionRows,{id:uid("action"),text:"",owner:"我",dueDate:todayISO()}])}><Plus size={13}/> 添加行动项</button></div></div>
          {actionRows.map((a,i)=><div className="action-row-editor" key={a.id}><input placeholder="任务内容" value={a.text} onChange={e=>setRows(actionRows.map((x,idx)=>idx===i?{...x,text:e.target.value}:x))}/><input placeholder="负责人" value={a.owner} onChange={e=>setRows(actionRows.map((x,idx)=>idx===i?{...x,owner:e.target.value}:x))}/><input type="date" value={a.dueDate} onChange={e=>setRows(actionRows.map((x,idx)=>idx===i?{...x,dueDate:e.target.value}:x))}/><button type="button" onClick={()=>setRows(actionRows.filter((_,idx)=>idx!==i))}><Trash2 size={14}/></button></div>)}
        </div>
      </Field>
    </div>
    {error&&<p className="form-error">{error}</p>}
    <div className="dialog-foot"><span>会议会进入日历时间轴</span><button className="primary" disabled={!form.title.trim()} onClick={submit}><Save size={15}/> 保存会议</button></div>
  </BaseDialog>
}

function ReflectionDialog({open,reflection,data,onCreateProject,onOpenChange,onSave}:{open:boolean;reflection:Reflection|null;data:WorkData;onCreateProject:(p:Project)=>Project;onOpenChange:(o:boolean)=>void;onSave:(r:Reflection)=>void}) {
  const blank=():Reflection=>({id:uid("reflection"),title:"",content:"",type:"问题复盘",relatedProjectId:"",relatedTaskId:"",date:todayISO(),durationMinutes:0,tags:[]});
  const [form,setForm]=useState<Reflection>(blank());
  useEffect(()=>{if(open)setForm(reflection?{...reflection,durationMinutes:reflection.durationMinutes||0,tags:[...reflection.tags]}:blank())},[open,reflection]);
  const f=<K extends keyof Reflection>(k:K,v:Reflection[K])=>setForm(x=>({...x,[k]:v}));
  const tasks=data.tasks.filter(t=>!form.relatedProjectId||t.projectId===form.relatedProjectId);
  const exists=!!reflection&&data.reflections.some(r=>r.id===reflection.id);
  return <BaseDialog open={open} onOpenChange={onOpenChange} title={exists?"编辑复盘":"记录复盘"} subtitle="把思考放回具体项目和任务的上下文中。" wide>
    <div className="form-grid">
      <Field label="复盘标题" wide helper="写清楚这次思考的主题，会显示在思考空间、项目档案和报告里。" tip="建议用一句话概括问题、经验或改进方向。">
        <input autoFocus value={form.title} onChange={e=>f("title",e.target.value)} placeholder="例如：移动端 Modal 表单填写体验复盘"/>
      </Field>
      <Field label="复盘类型" helper="用于复盘驾驶舱和报告归类。" tip="选择最贴近这条思考用途的类型即可。">
        <select value={form.type} onChange={e=>f("type",e.target.value as ReflectionType)}>{["问题复盘","流程优化","风险提醒","经验沉淀","自动化想法","管理思考"].map(x=><option key={x}>{x}</option>)}</select>
      </Field>
      <Field label="日期" helper="记录这条思考发生或整理的日期。" tip="报告会按这个日期归入对应周期。">
        <input type="date" value={form.date} onChange={e=>f("date",e.target.value)}/>
      </Field>
      <Field label="思考耗时（分钟）" helper="可选。用于分析复盘和深度思考投入时间。" tip="如果不想统计，可以保持 0。">
        <input type="number" min="0" step="5" value={form.durationMinutes||0} onChange={e=>f("durationMinutes",+e.target.value)} placeholder="例如：30"/>
      </Field>
      <ProjectSelect label="关联项目" value={form.relatedProjectId} projects={data.projects} onChange={v=>{f("relatedProjectId",v);if(!data.tasks.some(t=>t.id===form.relatedTaskId&&t.projectId===v))f("relatedTaskId","")}} onCreateProject={onCreateProject} helper="关联后，会出现在该项目详情和报告的问题与复盘部分。" tip="不确定归属时可以先不关联，之后再编辑。"/>
      <Field label="关联任务" helper="把复盘挂到具体任务上，任务详情会展示相关复盘。" tip="选择任务后，如果未选项目，系统会自动带入任务所属项目。">
        <select value={form.relatedTaskId} onChange={e=>{const t=data.tasks.find(x=>x.id===e.target.value);f("relatedTaskId",e.target.value);if(t&&!form.relatedProjectId)f("relatedProjectId",t.projectId)}}><option value="">不关联任务</option>{tasks.map(t=><option key={t.id} value={t.id}>{t.title}</option>)}</select>
      </Field>
      <Field label="复盘内容" wide helper="自由输入，无固定格式。建议写：发生了什么、为什么、下次怎么做。" tip="这部分会进入复盘汇总和报告。">
        <textarea value={form.content} onChange={e=>f("content",e.target.value)} placeholder={"例如：\n问题：移动端 Modal 底部按钮被遮挡\n原因：内容区没有独立滚动\n改进：固定底部按钮，正文区域滚动"}/>
      </Field>
      <Field label="标签（逗号分隔）" wide helper="用逗号分隔多个标签，便于后续搜索和聚合。" tip="支持中文标签。">
        <input value={form.tags.join(", ")} onChange={e=>f("tags",e.target.value.split(/[,，]/).map(x=>x.trim()).filter(Boolean))} placeholder="例如：移动端, 流程优化, 风险"/>
      </Field>
    </div>
    <div className="dialog-foot"><span>{form.relatedProjectId||form.relatedTaskId?"将显示在关联档案中":"当前选择：不关联"}</span><button className="primary" disabled={!form.title.trim()} onClick={()=>onSave(form)}><Save size={15}/> 保存复盘</button></div>
  </BaseDialog>
}

function TaskDetail({open,task,data,editedBy,onClose,onEdit,onDelete,onReflection,onProject,onStartTimer,onPauseTimer,onStopTimer,onCorrectSession}:{open:boolean;task:Task|null;data:WorkData;editedBy:string;onClose:()=>void;onEdit:(t:Task)=>void;onDelete:(t:Task)=>void;onReflection:()=>void;onProject:(p:Project)=>void;onStartTimer:(t:Task)=>void;onPauseTimer:(t:Task)=>void;onStopTimer:(t:Task)=>void;onCorrectSession:(taskId:string,index:number,session:TimeSession)=>void}) {
  const refs = task ? data.reflections.filter(r => r.relatedTaskId === task.id) : [];
  const project = task ? data.projects.find(p => p.id === task.projectId) : undefined;
  const projectProgress = project ? projectProgressFromData(data, project) : null;
  const running = !!task?.timeTracking?.isRunning;
  const progress = task ? subtaskProgress(task) : { total: 0, completed: 0, percent: 0 };
  const target = task ? waitingTarget(task, data) : null;
  return <BaseDialog open={open} onOpenChange={o=>!o&&onClose()} title={task?.title||"任务详情"} subtitle="任务上下文、耗时与相关复盘" wide>{task&&<>
    <div className="detail-body">
      <div className="detail-kpis"><span>状态<b>{task.status}</b></span><span>优先级<b>{task.priority}</b></span><span>子任务<b>{progress.total ? `${progress.completed}/${progress.total}` : "无"}</b></span><span>实际<b>{durationLabel(taskSeconds(task))}</b></span></div>
      <DetailSection title="真实计时">
        <div className={cn("timer-detail",running&&"running")}><Timer size={18}/><div><strong>{durationLabel(taskSeconds(task))}</strong><span>{running?"正在计时":"当前累计"}</span></div><div>{running?<><button className="secondary" onClick={()=>onPauseTimer(task)}><Pause size={14}/> 暂停</button><button className="primary" onClick={()=>onStopTimer(task)}><Check size={14}/> 结束计时</button></>:<button className="primary" onClick={()=>onStartTimer(task)}><Play size={14}/> 开始计时</button>}</div></div>
        <TimeSessionList task={task} editedBy={editedBy} onCorrectSession={onCorrectSession}/>
      </DetailSection>
      <DetailSection title="基础信息"><p>{task.description||"暂无描述"}</p><div className="detail-meta"><span>来源：{task.source}</span><span>提出人：{task.requester}</span><span>创建人：{task.createdBy || "自己"}</span><span>截止：{task.dueDate||"未设置"}</span></div>{task.status==="Waiting"&&target&&<p className="detail-note">等待 {target.name}{target.meta?` · ${target.meta}`:""}{task.waitingReason?`：${task.waitingReason}`:""}{task.followUpDate?` · ${task.followUpDate} 跟进`:""}</p>}</DetailSection>
      <DetailSection title={`子任务 · ${progress.completed}/${progress.total}`}>{sortedSubtasks(task).length?sortedSubtasks(task).map(item=><div className="linked-row" key={item.id}><CheckCircle2 size={16}/><div><strong>{item.title}</strong><span>{item.done ? "已完成" : "未完成"}</span></div></div>):<p>暂无子任务</p>}</DetailSection>
      <DetailSection title="相关项目">{project&&projectProgress?<button className="linked-row" onClick={()=>onProject(project)}><FolderKanban size={16}/><div><strong>{project.name}</strong><span>{projectProgress.progress}% · 任务 {projectProgress.completed}/{projectProgress.total} · {project.nextAction}</span></div><ArrowRight size={15}/></button>:<p>未关联项目</p>}</DetailSection>
      <DetailSection title={`相关复盘 · ${refs.length}`}>{refs.map(r=><div className="linked-row" key={r.id}><Brain size={16}/><div><strong>{r.title}</strong><span>{r.type} · {r.date}</span></div></div>)}<button className="secondary small" onClick={onReflection}><Plus size={13}/> 基于此任务写复盘</button></DetailSection>
    </div>
    <div className="dialog-foot"><button className="danger-link" onClick={()=>onDelete(task)}><Trash2 size={14}/> 删除</button><div><button className="secondary" onClick={()=>onEdit(task)}>编辑任务</button></div></div>
  </>}</BaseDialog>;
}

function TimeSessionList({task,editedBy,onCorrectSession}:{task:Task;editedBy:string;onCorrectSession:(taskId:string,index:number,session:TimeSession)=>void}) {
  const sessions = task.timeTracking?.sessions || [];
  const [editingIndex,setEditingIndex] = useState<number | null>(null);
  const [showOriginal,setShowOriginal] = useState<Record<number, boolean>>({});
  const sorted = sessions.map((session,index)=>({session,index})).sort((a,b)=>(parseLocalDateTime(sessionStart(b.session))?.getTime() || 0)-(parseLocalDateTime(sessionStart(a.session))?.getTime() || 0));
  if (!sorted.length) return <p className="meeting-notes">暂无单条计时记录。开始并暂停/结束计时后会显示。</p>;
  return <div className="time-session-list">{sorted.map(({session,index})=><TimeSessionRow key={`${session.startTime}-${index}`} task={task} session={session} index={index} editing={editingIndex===index} showOriginal={!!showOriginal[index]} editedBy={editedBy} onEdit={()=>setEditingIndex(index)} onCancel={()=>setEditingIndex(null)} onToggleOriginal={()=>setShowOriginal(s=>({...s,[index]:!s[index]}))} onOneClickFix={()=>setEditingIndex(index)} onSave={next=>{onCorrectSession(task.id,index,next);setEditingIndex(null)}} />)}</div>;
}

function TimeSessionRow({task,session,index,editing,showOriginal,editedBy,onEdit,onCancel,onToggleOriginal,onOneClickFix,onSave}:{task:Task;session:TimeSession;index:number;editing:boolean;showOriginal:boolean;editedBy:string;onEdit:()=>void;onCancel:()=>void;onToggleOriginal:()=>void;onOneClickFix:()=>void;onSave:(session:TimeSession)=>void}) {
  const suggestedDuration = Math.max(900, Math.round((task.estimatedHours || 1) * 3600));
  const suggestedEnd = addLocalMinutes(sessionOriginalStart(session), Math.ceil(suggestedDuration / 60));
  const initialStart = toDateTimeLocal(editing && isSuspectedForgotToStop(session) && !session.correctedStartTime ? sessionOriginalStart(session) : sessionStart(session));
  const initialEnd = toDateTimeLocal(editing && isSuspectedForgotToStop(session) && !session.correctedEndTime ? suggestedEnd : sessionEnd(session));
  const initialDuration = ((editing && isSuspectedForgotToStop(session) && !session.correctedDuration ? suggestedDuration : sessionDuration(session)) / 3600).toFixed(2);
  const [start,setStart] = useState(initialStart);
  const [end,setEnd] = useState(initialEnd);
  const [durationHours,setDurationHours] = useState(initialDuration);
  const [note,setNote] = useState(session.correctedNote || session.note || "");
  const [reason,setReason] = useState(isSuspectedForgotToStop(session) && !session.editReason ? "疑似忘记关闭计时，按实际工作时段修正。" : "");
  const [error,setError] = useState("");

  useEffect(()=>{ if (editing) { setStart(initialStart); setEnd(initialEnd); setDurationHours(initialDuration); setNote(session.correctedNote || session.note || ""); setReason(isSuspectedForgotToStop(session) && !session.editReason ? "疑似忘记关闭计时，按实际工作时段修正。" : ""); setError(""); } },[editing,initialStart,initialEnd,initialDuration,session]);

  const updateFromTimes = (nextStart: string, nextEnd: string) => {
    const seconds = calculateDurationSeconds(nextStart, nextEnd);
    setDurationHours((seconds / 3600).toFixed(2));
  };
  const save = () => {
    if (!start || !end) { setError("请填写开始时间和结束时间"); return; }
    if (isInvalidTimeRange(start, end)) { setError("结束时间必须晚于开始时间"); return; }
    const correctedDuration = calculateDurationSeconds(start, end);
    if (!reason.trim()) { setError("请填写修改原因"); return; }
    onSave({
      ...session,
      originalStartTime: session.originalStartTime || session.startTime,
      originalEndTime: session.originalEndTime || session.endTime,
      originalDuration: session.originalDuration ?? session.durationSeconds,
      correctedStartTime: toDateTimeLocal(start),
      correctedEndTime: toDateTimeLocal(end),
      correctedDuration,
      correctedNote: note.trim(),
      editedBy,
      editedAt: localNow(),
      editReason: reason.trim(),
    });
  };

  const displayStart = sessionStart(session);
  const displayEnd = sessionEnd(session);
  const hasValidEnd = !!displayEnd && !isInvalidTimeRange(displayStart, displayEnd);
  return <article className={cn("time-session-row", isSuspectedForgotToStop(session)&&"suspected", session.correctedDuration!==undefined&&"corrected")}>
    <div className="time-session-main"><span className="time-dot"/><div><strong>{toDateTimeLocal(displayStart).replace("T"," ")} — {hasValidEnd ? toDateTimeLocal(displayEnd).replace("T"," ") : "进行中"}</strong><p>{hasValidEnd ? durationLabel(sessionDuration(session)) : "进行中"}{session.correctedDuration!==undefined ? " · 已修正" : ""}{session.correctedNote ? ` · ${session.correctedNote}` : ""}</p></div></div>
    <div className="time-session-actions">{isSuspectedForgotToStop(session)&&<span className="suspect-badge">疑似忘记关闭</span>}<button className="secondary small" onClick={onEdit}>编辑时间</button>{isSuspectedForgotToStop(session)&&<button className="secondary small" onClick={onOneClickFix}>一键修正</button>}<button className="secondary small" onClick={onToggleOriginal}>{showOriginal?"隐藏原始记录":"查看原始记录"}</button></div>
    {showOriginal&&<div className="original-session"><span>原始：{toDateTimeLocal(sessionOriginalStart(session)).replace("T"," ")} — {toDateTimeLocal(sessionOriginalEnd(session)).replace("T"," ")} · {durationLabel(sessionOriginalDuration(session))}</span>{session.editReason&&<span>修正原因：{session.editReason} · {session.editedBy} · {toDateTimeLocal(session.editedAt).replace("T"," ")}</span>}</div>}
    {editing&&<div className="time-session-editor">
      <Field label="开始时间" helper="修正后的开始时间，不会覆盖原始记录。"><input type="datetime-local" value={start} onChange={e=>{setStart(e.target.value);updateFromTimes(e.target.value,end)}}/></Field>
      <Field label="结束时间" helper="结束时间不能早于开始时间。"><input type="datetime-local" value={end} onChange={e=>{setEnd(e.target.value);updateFromTimes(start,e.target.value)}}/></Field>
      <Field label="总耗时（小时）" helper="默认用于统计和导出，可以手动精确修正。"><input type="number" min="0" step="0.01" value={durationHours} onChange={e=>setDurationHours(e.target.value)}/></Field>
      <Field label="备注" helper="可选，记录这次工时修正后的说明。"><input value={note} onChange={e=>setNote(e.target.value)} placeholder="例如：实际只处理了需求同步"/></Field>
      <Field label="修改原因" helper="必填。用于审计，解释为什么修正这条记录。" wide><textarea value={reason} onChange={e=>setReason(e.target.value)} placeholder="例如：午休时忘记关闭计时，按实际工作时间修正。"/></Field>
      {error&&<p className="form-error">{error}</p>}
      <div className="inline-actions"><button className="secondary" onClick={onCancel}>取消</button><button className="primary" onClick={save}><Save size={14}/> 保存修正</button></div>
    </div>}
  </article>;
}

function ProjectDetail({open,project,data,onClose,onEdit,onDelete,onTask,onReflection}:{open:boolean;project:Project|null;data:WorkData;onClose:()=>void;onEdit:(p:Project)=>void;onDelete:(p:Project)=>void;onTask:(t:Task)=>void;onReflection:(r:Reflection)=>void}) {
  const tasks = project ? relatedProjectTasks(data, project) : [];
  const progress = project ? projectProgressSummary(project, tasks) : { completed: 0, total: 0, progress: 0 };
  const meetings = project ? data.meetings.filter(m => m.relatedProjectId === project.id) : [];
  const refs = project ? data.reflections.filter(r => r.relatedProjectId === project.id) : [];
  const hours = tasks.reduce((s,t)=>s+taskHours(t),0);
  return <BaseDialog open={open} onOpenChange={o=>!o&&onClose()} title={project?.name||"项目档案"} subtitle="项目任务、会议、复盘和风险的统一上下文" wide>{project&&<><div className="detail-body"><div className="detail-kpis"><span>项目状态<b>{project.status}</b></span><span>整体进度<b>{progress.progress}%</b></span><span>任务完成<b>{progress.completed}/{progress.total}</b></span><span>已用工时<b>{hours.toFixed(1)}h</b></span></div><DetailSection title="背景与目标"><p><b>背景：</b>{project.background}</p><p><b>目标：</b>{project.goal}</p></DetailSection><DetailSection title="下一步与风险"><p><b>下一步：</b>{project.nextAction||"待补充"}</p>{project.risks.length?project.risks.map(x=><div className="risk-chip" key={x}>{x}</div>):<p>暂无风险</p>}</DetailSection><DetailSection title={`相关任务 · ${tasks.length}`}>{tasks.map(t=><button className="linked-row" key={t.id} onClick={()=>onTask(t)}><CheckCircle2 size={16}/><div><strong>{t.title}</strong><span>{t.status} · {hoursLabel(taskHours(t))}/{hoursLabel(t.estimatedHours)}</span></div><ArrowRight size={15}/></button>)}</DetailSection><DetailSection title={`相关会议 · ${meetings.length}`}>{meetings.map(m=><div className="linked-row" key={m.id}><CalendarDays size={16}/><div><strong>{m.title}</strong><span>{meetingTimeRange(m)} · {m.actionItems.length} 个行动项</span></div></div>)}</DetailSection><DetailSection title={`相关复盘 · ${refs.length}`}>{refs.map(r=><button className="linked-row" key={r.id} onClick={()=>onReflection(r)}><Brain size={16}/><div><strong>{r.title}</strong><span>{r.type} · {r.date}</span></div><ArrowRight size={15}/></button>)}</DetailSection></div><div className="dialog-foot"><button className="danger-link" onClick={()=>onDelete(project)}><Trash2 size={14}/> 删除项目</button><button className="primary" onClick={()=>onEdit(project)}>编辑项目</button></div></>}</BaseDialog>;
}
function ReflectionDetail({open,reflection,data,onClose,onEdit,onDelete}:{open:boolean;reflection:Reflection|null;data:WorkData;onClose:()=>void;onEdit:(r:Reflection)=>void;onDelete:(r:Reflection)=>void}) { const p=reflection?data.projects.find(x=>x.id===reflection.relatedProjectId):undefined,t=reflection?data.tasks.find(x=>x.id===reflection.relatedTaskId):undefined;return <BaseDialog open={open} onOpenChange={o=>!o&&onClose()} title={reflection?.title||"复盘详情"} subtitle="有依据的工作思考" wide>{reflection&&<><div className="detail-body"><div className="detail-kpis"><span>类型<b>{reflection.type}</b></span><span>日期<b>{reflection.date}</b></span><span>关联项目<b>{p?.name||"无"}</b></span><span>关联任务<b>{t?.title||"无"}</b></span></div><DetailSection title="复盘内容"><p className="reflection-content">{reflection.content}</p></DetailSection><DetailSection title="标签"><div className="tag-list">{reflection.tags.map(x=><span key={x}>{x}</span>)}</div></DetailSection></div><div className="dialog-foot"><button className="danger-link" onClick={()=>onDelete(reflection)}><Trash2 size={14}/> 删除</button><button className="primary" onClick={()=>onEdit(reflection)}>编辑复盘</button></div></>}</BaseDialog> }
function DetailSection({title,children}:{title:string;children:React.ReactNode}){return <section className="detail-section"><h3>{title}</h3>{children}</section>}
function SettingsDialog({open,onClose,data,mode,displaySettings,onDisplayChange,onSync,onReset,notify}:{open:boolean;onClose:()=>void;data:WorkData;mode:RepositoryMode;displaySettings:DisplaySettings;onDisplayChange:(patch:Partial<DisplaySettings>)=>void;onSync:()=>Promise<void>;onReset:()=>void;notify:(s:string)=>void}) {
  const auth = useAuth();
  const [formatType,setFormatType]=useState<"markdown"|"csv"|"json">("markdown");
  const [authMode,setAuthMode]=useState<"login"|"signup">("login");
  const [email,setEmail]=useState("");
  const [password,setPassword]=useState("");
  const [busy,setBusy]=useState(false);
  const exportData=()=>{if(formatType==="markdown"){downloadText(buildMarkdownExport(data),`workos-export-${todayISO()}.md`,"text/markdown;charset=utf-8");notify("Markdown 工作记录已导出");return}if(formatType==="csv"){exportCsvFiles(data);notify("CSV 已按数据类型分别导出");return}downloadText(JSON.stringify(data,null,2),`workos-backup-${todayISO()}.json`,"application/json;charset=utf-8");notify("JSON 备份已导出")};
  const submitAuth=async()=>{if(!email.trim()||!password){notify("请填写邮箱和密码");return}setBusy(true);try{if(authMode==="login"){await auth.signIn(email.trim(),password);notify("登录成功，正在检查同步状态")}else{await auth.signUp(email.trim(),password);notify("注册成功，请根据 Supabase 邮箱确认设置完成登录")}setPassword("")}catch(error){console.error(error);notify(authMode==="login"?"登录失败，请检查账号密码":"注册失败，请检查邮箱或密码")}finally{setBusy(false)}};
  const logout=async()=>{setBusy(true);try{await auth.signOut();notify("已退出登录，当前回到本地模式")}catch(error){console.error(error);notify("退出失败，请稍后重试")}finally{setBusy(false)}};
  const sync=async()=>{setBusy(true);try{await onSync();notify("同步完成，当前设备已获取云端最新数据")}catch(error){console.error(error);notify("同步失败，请检查网络后重试")}finally{setBusy(false)}};
  return <BaseDialog open={open} onOpenChange={o=>!o&&onClose()} title="工作空间设置" subtitle="本地模式可离线使用，登录后可开启云端同步。">
    <div className="settings-body">
      <div className="cloud-panel">
        <div>
          <strong>账号与同步</strong>
          <p>{auth.isCloudEnabled ? syncStatusLabel(auth.syncStatus, mode, Boolean(auth.user)) : "Supabase 环境变量未配置，当前仅本地模式"}</p>
        </div>
        {auth.user ? <div className="account-card"><div className="avatar">{auth.user.email?.slice(0,1).toUpperCase() || "U"}</div><div><strong>{auth.user.email}</strong><span>{syncStatusLabel(auth.syncStatus, mode, true)}</span></div><div className="account-actions"><button className="primary sync-button" disabled={busy || !auth.isCloudEnabled} onClick={sync}><RefreshCw size={14} className={auth.syncStatus === "syncing" ? "spin" : undefined}/>{auth.syncStatus === "syncing" ? "同步中..." : "一键同步"}</button><button className="secondary" disabled={busy} onClick={logout}>退出登录</button></div></div> : <div className="auth-box">
          <div className="auth-tabs"><button className={cn(authMode==="login"&&"active")} onClick={()=>setAuthMode("login")}>登录</button><button className={cn(authMode==="signup"&&"active")} onClick={()=>setAuthMode("signup")}>注册</button></div>
          <Field label="邮箱"><input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" disabled={!auth.isCloudEnabled}/></Field>
          <Field label="密码"><input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="至少 6 位" disabled={!auth.isCloudEnabled}/></Field>
          <button className="primary" disabled={!auth.isCloudEnabled || busy} onClick={submitAuth}>{busy ? "处理中..." : authMode==="login" ? "登录并同步" : "注册账号"}</button>
          {auth.error && <p className="auth-error">{auth.error}</p>}
        </div>}
      </div>
      <div><strong>{mode==="supabase"?"当前数据":"本地数据"}</strong><p>{data.tasks.length} 个任务 · {data.projects.length} 个项目 · {data.contacts?.length || 0} 个联系人 · {data.reflections.length} 条复盘 · {data.reports.length} 份报告</p></div>
      <div className="appearance-settings">
        <strong>显示外观</strong>
        <p>调整全局字体和显示密度，适合长时间办公使用。</p>
        <label className="export-format"><span>字体大小</span><select value={displaySettings.fontScale} onChange={e=>onDisplayChange({fontScale:e.target.value as FontScale})}><option value="small">Small · 13px</option><option value="normal">Medium · 14px</option><option value="large">Large · 15px</option><option value="extra-large">Extra Large · 16px</option></select></label>
        <label className="export-format"><span>Display Density</span><select value={displaySettings.density} onChange={e=>onDisplayChange({density:e.target.value as Density})}><option value="compact">Compact</option><option value="comfortable">Comfortable</option></select></label>
      </div>
      <label className="export-format"><span>导出格式</span><select value={formatType} onChange={e=>setFormatType(e.target.value as "markdown"|"csv"|"json")}><option value="markdown">Markdown 工作记录（默认）</option><option value="csv">CSV 表格文件</option><option value="json">JSON 数据备份</option></select></label>
      <button className="secondary" onClick={exportData}><Download size={14}/> 导出数据</button>
      <button className="secondary danger" onClick={()=>{if(confirm(mode==="supabase"?"恢复演示数据？当前云端数据将被替换为演示数据，本地备份不会删除。":"恢复演示数据？当前本地修改将被覆盖。"))onReset()}}><Trash2 size={14}/> 恢复演示数据</button>
    </div>
    <div className="dialog-foot"><span>本地导出备份保留；登录不会删除本地数据</span><button className="primary" onClick={onClose}>完成</button></div>
  </BaseDialog>
}

function LocalImportDialog({open,data,onImport,onLater,onCloudOnly}:{open:boolean;data:WorkData;onImport:()=>Promise<void>;onLater:()=>void;onCloudOnly:()=>Promise<void>}) {
  const [busy,setBusy]=useState<"import"|"cloud"|null>(null);
  const hasData = !isEmptyWorkData(data);
  const run=async(kind:"import"|"cloud",fn:()=>Promise<void>)=>{setBusy(kind);try{await fn()}finally{setBusy(null)}};
  return <BaseDialog open={open && hasData} onOpenChange={o=>!o&&onLater()} title="检测到本地工作数据" subtitle="你可以导入云端，多设备同步；本地数据会继续保留。">
    <div className="settings-body">
      <div className="migration-card"><Sparkles size={18}/><div><strong>是否导入云端？</strong><p>将导入 {data.tasks.length} 个任务、{data.projects.length} 个项目、{data.meetings.length} 场会议、{data.contacts?.length || 0} 个联系人、{data.reflections.length} 条复盘和 {data.reports.length} 份报告。</p></div></div>
      <div className="migration-checks"><span>✓ 多设备同步</span><span>✓ 本地数据保留</span><span>✓ 可继续导出备份</span></div>
    </div>
    <div className="dialog-foot"><button className="ghost" disabled={!!busy} onClick={onLater}>稍后再说</button><div><button className="secondary" disabled={!!busy} onClick={()=>run("cloud",onCloudOnly)}>{busy==="cloud"?"读取中...":"仅使用云端数据"}</button><button className="primary" disabled={!!busy} onClick={()=>run("import",onImport)}>{busy==="import"?"导入中...":"导入云端"}</button></div></div>
  </BaseDialog>
}
