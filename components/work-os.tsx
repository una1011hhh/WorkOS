"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Archive, ArrowDown, ArrowRight, ArrowUp, BarChart3, Bell, BookOpen, Brain, CalendarDays, Check, CheckCircle2,
  ChevronDown, Circle, Clipboard, Clock3, Download, FileText, FolderKanban, Inbox, LayoutDashboard,
  ListTodo, Menu, MessageSquareMore, MoreHorizontal, Pause, Play, Plus, Save, Search, Settings, Sparkles,
  Target, Timer, Trash2, Users, X, Zap,
} from "lucide-react";
import { addDays, addWeeks, endOfMonth, endOfQuarter, endOfWeek, format, isBefore, parseISO, startOfMonth, startOfQuarter, startOfWeek, subDays } from "date-fns";
import { zhCN } from "date-fns/locale";
import { cn, hoursLabel, todayISO, uid } from "@/lib/utils";
import { Contact, ContactGroup, Meeting, Priority, Project, ProjectStatus, Reflection, ReflectionType, Report, ReportOptions, ReportType, Task, TaskStatus, TimeSession, WorkData } from "@/lib/types";
import { seedData } from "@/lib/seed";
import { hasLocalWorkData, localWorkDataRepository } from "@/lib/storage";
import { generateReportContent } from "@/lib/report";
import { useAuth } from "@/lib/auth/auth-context";
import { createWorkDataRepository } from "@/repositories/workDataRepository";
import { RepositoryMode } from "@/repositories/work-data-repository";
import { addLocalMinutes, calculateDurationMinutes, calculateDurationSeconds, formatLocalDate, formatLocalDateTime, formatLocalTime, isInvalidTimeRange, localNow, parseLocalDateTime } from "@/lib/time";

type View = "today" | "inbox" | "tasks" | "projects" | "meetings" | "waiting" | "collaboration" | "contacts" | "groups" | "log" | "weekly" | "reports" | "analytics" | "workAnalytics" | "thinking" | "display";
type Modal = "capture" | "task" | "project" | "meeting" | "reflection" | "settings" | null;
type FontScale = "small" | "normal" | "large" | "extra-large";
type ContentWidth = "compact" | "standard" | "wide" | "full";
type Density = "compact" | "standard" | "comfortable";
type DisplaySettings = { fontScale: FontScale; contentWidth: ContentWidth; density: Density };
type AnalyticsDetailKind = "time" | "tasks" | "meetings" | "reflections" | "meetingProjects" | "meetingAttendees";
type DashboardDetailKind = "today" | "done" | "waiting" | "risk";

const DISPLAY_SETTINGS_KEY = "workos-display-settings-v1";
const defaultDisplaySettings: DisplaySettings = { fontScale: "normal", contentWidth: "standard", density: "standard" };
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
  { group: "协作中心", items: [{ id: "collaboration", label: "协作总览", icon: Users }, { id: "contacts", label: "联系人", icon: Users }, { id: "groups", label: "群组", icon: MessageSquareMore }] },
  { group: "复盘与沉淀", items: [{ id: "log", label: "工作日志", icon: BookOpen }, { id: "weekly", label: "每周复盘", icon: FileText }, { id: "reports", label: "报告中心", icon: Clipboard }] },
  { group: "洞察", items: [{ id: "analytics", label: "工时分析", icon: BarChart3 }, { id: "workAnalytics", label: "工作分析中心", icon: Sparkles }, { id: "thinking", label: "思考空间", icon: Brain }] },
  { group: "系统", items: [{ id: "display", label: "显示设置", icon: Settings }] },
];
const viewMeta: Record<View, { title: string; subtitle: string }> = {
  today: { title: "早上好，专注于重要的事", subtitle: "这是你的工作记忆，而不只是任务清单。" }, inbox: { title: "收集箱", subtitle: "先记录，稍后再决定如何处理。" },
  tasks: { title: "任务中心", subtitle: "让所有承诺都可见、可追踪。" }, projects: { title: "项目中心", subtitle: "项目不是标签，而是一份持续生长的工作档案。" },
  meetings: { title: "会议中心", subtitle: "把讨论变成决策，把决策变成行动。" }, waiting: { title: "等待看板", subtitle: "你的工作停在哪里，一眼看清。" },
  collaboration: { title: "协作中心", subtitle: "联系人、群组与飞书同步状态集中在这里。" }, contacts: { title: "联系人", subtitle: "维护常用对接人与飞书通讯录联系人。" }, groups: { title: "群组", subtitle: "管理常用协作群组，会议创建时一键带入成员。" }, log: { title: "工作日志", subtitle: "每天做过什么，由系统替你记住。" },
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
const contactSearchFields = (contact: Contact) => [contact.name, contact.role, contact.team, contact.company, contact.email, contact.phone, contact.notes];
const groupSearchFields = (group: ContactGroup, contacts: Contact[]) => [group.name, group.description, group.contactIds.map(id => contacts.find(c => c.id === id)?.name)];
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
const runningSeconds = (task: Task) => {
  const startedAt = parseLocalDateTime(task.timeTracking?.startedAt);
  return task.timeTracking?.isRunning && startedAt ? Math.max(0, Math.floor((Date.now() - startedAt.getTime()) / 1000)) : 0;
};
const sessionDuration = (session: TimeSession) => Math.max(0, Math.round(Number(session.correctedDuration ?? session.durationSeconds ?? 0)));
const sessionStart = (session: TimeSession) => session.correctedStartTime || session.startTime;
const sessionEnd = (session: TimeSession) => session.correctedEndTime || session.endTime;
const sessionOriginalStart = (session: TimeSession) => session.originalStartTime || session.startTime;
const sessionOriginalEnd = (session: TimeSession) => session.originalEndTime || session.endTime;
const sessionOriginalDuration = (session: TimeSession) => Math.max(0, Math.round(Number(session.originalDuration ?? session.durationSeconds ?? 0)));
const isSuspectedForgotToStop = (session: TimeSession) => Boolean(session.suspectedForgotToStop) || sessionOriginalDuration(session) >= 8 * 3600;
const computedSessionDuration = (start: string, end: string) => {
  return calculateDurationSeconds(start, end);
};
const recalcTrackingSeconds = (task: Task) => {
  const sessions = task.timeTracking?.sessions || [];
  if (!sessions.length) return task.timeTracking?.accumulatedSeconds ?? Math.round((task.actualHours || 0) * 3600);
  return sessions.reduce((sum, session) => sum + sessionDuration(session), 0);
};
const taskSeconds = (task: Task) => recalcTrackingSeconds(task) + runningSeconds(task);
const taskHours = (task: Task) => taskSeconds(task) / 3600;
const sortedSubtasks = (task: Task) => [...(task.subtasks || [])].sort((a, b) => a.order - b.order);
const subtaskProgress = (task: Task) => {
  const subtasks = task.subtasks || [];
  const completed = subtasks.filter(item => item.done).length;
  return { total: subtasks.length, completed, percent: subtasks.length ? Math.round((completed / subtasks.length) * 100) : 0 };
};
const applySubtaskCompletion = (task: Task): Task => {
  const progress = subtaskProgress(task);
  if ((task.autoCompleteOnSubtasksDone ?? true) && progress.total > 0 && progress.completed === progress.total) return { ...task, status: "Done", completedAt: task.completedAt || todayISO(), actualHours: taskHours(task) };
  if (task.status === "Done" && progress.total > 0 && progress.completed < progress.total) return { ...task, status: "Doing", completedAt: undefined };
  return task;
};
const contactLabel = (contact?: Contact) => contact ? [contact.departmentName || contact.team, contact.role].filter(Boolean).join(" · ") || contact.email || "联系人" : "";
const contactSearchValues = (contact?: Contact) => contact ? [contact.name, contact.email, contact.departmentName, contact.team, contact.role] : [];
const findContact = (contacts: Contact[], id?: string) => contacts.find(contact => contact.id === id);
const findContactByText = (contacts: Contact[], value?: string) => {
  const key = normalizeSearch(value);
  if (!key) return undefined;
  return contacts.find(contact => [contact.name, contact.email].some(item => normalizeSearch(item) === key));
};
const contactName = (contacts: Contact[], id?: string, fallback = "") => findContact(contacts, id)?.name || fallback;
const waitingTarget = (task: Task, data: WorkData) => {
  if (task.waitingForType === "contact" && task.waitingForId) {
    const contact = data.contacts.find(item => item.id === task.waitingForId);
    if (contact) return { name: contact.name, meta: contactLabel(contact), avatar: contact.avatar, initial: contact.name.slice(0, 1) };
  }
  return { name: task.waitingFor || "未选择", meta: task.waitingFor ? "旧等待对象" : "请在任务中选择联系人", initial: (task.waitingFor || "?").slice(0, 1) };
};
const isCompletedTaskStatus = (status: string | undefined) => ["done", "completed", "已完成", "完成"].includes(String(status || "").trim().toLocaleLowerCase("zh-CN"));
const relatedProjectTasks = (data: WorkData, project: Project) => {
  const relatedIds = new Set(project.relatedTaskIds || []);
  return data.tasks.filter(task => task.projectId === project.id || relatedIds.has(task.id));
};
const projectProgressSummary = (project: Project, tasks: Task[]) => {
  const total = tasks.length;
  const completed = tasks.filter(task => isCompletedTaskStatus(task.status)).length;
  const progress = total > 0 ? Math.round((completed / total) * 100) : project.progress;
  return { total, completed, progress: Math.max(0, Math.min(100, progress)) };
};
const projectProgressFromData = (data: WorkData, project: Project) => projectProgressSummary(project, relatedProjectTasks(data, project));
const taskLoggedDate = (task: Task) => task.completedAt || task.timeTracking?.lastPausedAt?.slice(0, 10) || task.createdAt;
const durationLabel = (seconds: number) => {
  const safe = Math.max(0, Math.floor(seconds));
  if (safe > 0 && safe < 60) return "少于 1 分钟";
  const h = Math.floor(safe / 3600), m = Math.floor((safe % 3600) / 60), s = safe % 60;
  return [h, m, s].map(v => String(v).padStart(2, "0")).join(":");
};
const rawObject = (value: unknown) => value && typeof value === "object" ? value as Record<string, any> : {};
const hasExplicitOffHoursTime = (meeting: Meeting) => {
  const raw = rawObject(meeting.rawPayload);
  return raw.timeSource === "manual-form-v2" || Boolean(raw.start_time?.timestamp);
};
type CalendarEvent = {
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
const toCalendarEvent = (meeting: Meeting): CalendarEvent | null => {
  const rawStart = meeting.startTime || "";
  const rawEnd = meeting.endTime || "";
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
const meetingStartValue = (meeting: Meeting) => toCalendarEvent(meeting)?.dayKey ? meeting.startTime || "" : "";
const meetingHasTime = (meeting: Meeting) => Boolean(toCalendarEvent(meeting));
const meetingDurationMinutes = (meeting: Meeting) => toCalendarEvent(meeting)?.durationMinutes || 0;
const meetingTimeRange = (meeting: Meeting) => {
  return toCalendarEvent(meeting)?.displayedTime || "时间未设置";
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
const blankTask = (patch: Partial<Task> = {}): Task => ({ id: uid("task"), title: "", description: "", source: "手动创建", requester: "", requesterContactId: "", createdBy: "", createdByContactId: "", projectId: "", status: "Todo", priority: "P1", dueDate: formatLocalDate(addDays(new Date(), 2)), estimatedHours: 1, actualHours: 0, createdAt: todayISO(), subtasks: [], autoCompleteOnSubtasksDone: true, tags: [], notes: "", waitingForType: undefined, waitingForId: "", waitingFor: "", waitingReason: "", followUpDate: "", timeTracking: blankTracking(), ...patch });
type AnalyticsEvent = { id: string; kind: "任务" | "会议" | "复盘"; title: string; projectId: string; date: string; startHour: number; durationSeconds: number; task?: Task; meeting?: Meeting; reflection?: Reflection; color: string };
const eventTimeLabel = (event: AnalyticsEvent) => {
  const start = Math.round(event.startHour * 60), endMinute = start + Math.max(1, Math.round(event.durationSeconds / 60));
  const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return `${fmt(start)} - ${fmt(endMinute)}`;
};
const analyticsEvents = (data: WorkData, start: string, end: string): AnalyticsEvent[] => {
  const taskEvents = data.tasks.flatMap(task => {
    const sessions = task.timeTracking?.sessions || [];
    const seen = new Set<string>();
    const realSessions = sessions.filter(s => {
      const startTime = sessionStart(s);
      const key = [task.id, sessionOriginalStart(s), sessionOriginalEnd(s), sessionOriginalDuration(s), sessionStart(s), sessionEnd(s), sessionDuration(s)].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return inDateRange(startTime, start, end);
    }).map((s, i) => {
      const startTime = sessionStart(s);
      return { id: `${task.id}-s-${i}`, kind: "任务" as const, title: task.title, projectId: task.projectId, date: formatLocalDate(startTime), startHour: localHour(startTime), durationSeconds: sessionDuration(s), task, color: "#5b7cfa" };
    });
    const running = task.timeTracking?.isRunning && task.timeTracking.startedAt && inDateRange(task.timeTracking.startedAt, start, end) ? [{ id: `${task.id}-running`, kind: "任务" as const, title: task.title, projectId: task.projectId, date: formatLocalDate(task.timeTracking.startedAt), startHour: localHour(task.timeTracking.startedAt), durationSeconds: runningSeconds(task), task, color: "#5b7cfa" }] : [];
    return [...realSessions, ...running];
  });
  const meetingEvents = data.meetings.filter(m => meetingHasTime(m) && inDateRange(meetingStartValue(m), start, end) && meetingDurationMinutes(m) > 0).map(m => ({ id: m.id, kind: "会议" as const, title: m.title, projectId: m.relatedProjectId, date: formatLocalDate(meetingStartValue(m)), startHour: localHour(meetingStartValue(m)), durationSeconds: meetingDurationMinutes(m) * 60, meeting: m, color: "#8a63d2" }));
  const reflectionEvents = data.reflections.filter(r => inDateRange(r.date, start, end) && (r.durationMinutes || 0) > 0).map(r => ({ id: r.id, kind: "复盘" as const, title: r.title, projectId: r.relatedProjectId, date: r.date, startHour: 17, durationSeconds: (r.durationMinutes || 0) * 60, reflection: r, color: "#e86cae" }));
  return [...taskEvents, ...meetingEvents, ...reflectionEvents].filter(e => e.durationSeconds > 0);
};
const rangeStats = (data: WorkData, start: string, end: string) => {
  const tasks = data.tasks.filter(t => inDateRange(t.createdAt, start, end) || inDateRange(t.completedAt, start, end) || inDateRange(taskLoggedDate(t), start, end));
  const completed = data.tasks.filter(t => t.status === "Done" && inDateRange(t.completedAt, start, end));
  const overdue = data.tasks.filter(t => t.status !== "Done" && !!t.dueDate && t.dueDate < end);
  const waiting = data.tasks.filter(t => t.status === "Waiting");
  const meetings = data.meetings.filter(m => meetingHasTime(m) && inDateRange(meetingStartValue(m), start, end));
  const reflections = data.reflections.filter(r => inDateRange(r.date, start, end));
  const events = analyticsEvents(data, start, end);
  const taskSecondsInRange = tasks.filter(t => inDateRange(taskLoggedDate(t), start, end)).reduce((s, t) => s + taskSeconds(t), 0);
  const meetingSeconds = meetings.reduce((s, m) => s + (m.durationMinutes || 0) * 60, 0);
  const reflectionSeconds = reflections.reduce((s, r) => s + (r.durationMinutes || 0) * 60, 0);
  const totalSeconds = taskSecondsInRange + meetingSeconds + reflectionSeconds;
  const projectSeconds = data.projects.map(p => {
    const projectTasks = tasks.filter(t => t.projectId === p.id);
    const seconds = projectTasks.filter(t => inDateRange(taskLoggedDate(t), start, end)).reduce((s, t) => s + taskSeconds(t), 0)
      + meetings.filter(m => m.relatedProjectId === p.id).reduce((s, m) => s + (m.durationMinutes || 0) * 60, 0)
      + reflections.filter(r => r.relatedProjectId === p.id).reduce((s, r) => s + (r.durationMinutes || 0) * 60, 0);
    return { project: p, seconds, tasks: projectTasks };
  }).filter(x => x.seconds > 0 || x.tasks.length).sort((a, b) => b.seconds - a.seconds);
  const byKind = (kind: AnalyticsEvent["kind"]) => kind === "任务" ? taskSecondsInRange : kind === "会议" ? meetingSeconds : reflectionSeconds;
  return { tasks, completed, overdue, waiting, meetings, reflections, events, totalSeconds, projectSeconds, byKind };
};

const MIGRATION_PROMPT_KEY = "workos-cloud-import-prompted";
const isEmptyWorkData = (data: WorkData) => !data.tasks.length && !data.projects.length && !data.meetings.length && !data.reflections.length && !data.reports.length && !(data.contacts?.length) && !(data.contactGroups?.length);
const syncStatusLabel = (status: ReturnType<typeof useAuth>["syncStatus"], mode: RepositoryMode) => {
  if (mode === "local" || status === "local") return "本地模式";
  if (status === "syncing") return "云端同步中";
  if (status === "synced") return "云端已同步";
  return "同步失败";
};

function useWorkData() {
  const auth = useAuth();
  const [data, setData] = useState<WorkData>(seedData);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<RepositoryMode>("local");
  const [showImportPrompt, setShowImportPrompt] = useState(false);
  const skipNextSave = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setReady(false);
      try {
        if (auth.user && auth.isCloudEnabled) {
          auth.setSyncStatus("syncing");
          const localExists = hasLocalWorkData();
          const localPrompted = localStorage.getItem(`${MIGRATION_PROMPT_KEY}:${auth.user.id}`) === "true";
          const repo = await createWorkDataRepository("supabase");
          const cloudData = await repo.load();
          if (cancelled) return;
          skipNextSave.current = true;
          setData(cloudData);
          setMode("supabase");
          setShowImportPrompt(localExists && !localPrompted);
          auth.setSyncStatus("synced");
        } else {
          const localData = localWorkDataRepository.load();
          if (cancelled) return;
          skipNextSave.current = true;
          setData(localData);
          setMode("local");
          setShowImportPrompt(false);
          auth.setSyncStatus("local");
        }
      } catch (error) {
        console.error(error);
        if (!cancelled) {
          skipNextSave.current = true;
          setData(localWorkDataRepository.load());
          setMode("local");
          auth.setSyncStatus("failed");
        }
      } finally {
        if (!cancelled) setReady(true);
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
    const save = async () => {
      try {
        if (mode === "supabase" && auth.user && auth.isCloudEnabled) {
          auth.setSyncStatus("syncing");
          const repo = await createWorkDataRepository("supabase");
          await repo.save(data);
          auth.setSyncStatus("synced");
        } else {
          localWorkDataRepository.save(data);
          auth.setSyncStatus("local");
        }
      } catch (error) {
        console.error(error);
        auth.setSyncStatus("failed");
      }
    };
    save();
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
    auth.setSyncStatus("syncing");
    const repo = await createWorkDataRepository("supabase");
    const cloudData = await repo.load();
    skipNextSave.current = true;
    setData(cloudData);
    setMode("supabase");
    auth.setSyncStatus("synced");
  };

  const remindLater = () => setShowImportPrompt(false);

  return { data, setData, mode, ready, showImportPrompt, importLocalToCloud, useCloudOnly, reloadCloudData, remindLater } as const;
}

export function WorkOS() {
  const auth = useAuth();
  const { data, setData, mode, showImportPrompt, importLocalToCloud, useCloudOnly, reloadCloudData, remindLater } = useWorkData();
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

  useEffect(() => {
    const listener = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setModal("capture"); } };
    window.addEventListener("keydown", listener); return () => window.removeEventListener("keydown", listener);
  }, []);
  useEffect(() => { const id = window.setInterval(() => setClock(v => v + 1), 1000); return () => window.clearInterval(id); }, []);
  useEffect(() => { setMobileNavOpen(false); }, [view]);
  const updateDisplaySettings = (patch: Partial<DisplaySettings>) => setDisplaySettings(current => {
    const next = { ...current, ...patch };
    window.localStorage.setItem(DISPLAY_SETTINGS_KEY, JSON.stringify(next));
    return next;
  });

  const saveTask = (task: Task) => setData(d => {
    const requesterContact = findContact(d.contacts || [], task.requesterContactId) || findContactByText(d.contacts || [], task.requester);
    const createdByContact = findContact(d.contacts || [], task.createdByContactId) || findContactByText(d.contacts || [], task.createdBy);
    if (task.status === "Waiting" && (!task.waitingForId || !findContact(d.contacts || [], task.waitingForId))) {
      notify("请选择有效联系人");
      return d;
    }
    task = applySubtaskCompletion({
      ...task,
      requesterContactId: requesterContact?.id || "",
      requester: requesterContact?.name || task.requester || "",
      createdByContactId: createdByContact?.id || "",
      createdBy: createdByContact?.name || task.createdBy || "",
      actualHours: taskHours(task) / 1,
      subtasks: sortedSubtasks(task).map((item, index) => ({ ...item, order: index })),
      tags: task.tags || [],
      notes: task.notes || "",
    });
    if (task.status !== "Waiting") task = { ...task, waitingForType: undefined, waitingForId: "", waitingFor: "", waitingReason: "", followUpDate: "" };
    if (task.status === "Waiting") {
      const waitingContact = findContact(d.contacts || [], task.waitingForId);
      task = { ...task, waitingForType: "contact", waitingFor: waitingContact?.name || "" };
    }
    const exists = d.tasks.some(t => t.id === task.id);
    const tasks = exists ? d.tasks.map(t => t.id === task.id ? task : t) : [task, ...d.tasks];
    const projects = d.projects.map(p => ({ ...p, relatedTaskIds: tasks.filter(t => t.projectId === p.id).map(t => t.id) }));
    return { ...d, tasks, projects };
  });
  const deleteTask = (id: string) => setData(d => ({ ...d, tasks: d.tasks.filter(t => t.id !== id), projects: d.projects.map(p => ({ ...p, relatedTaskIds: p.relatedTaskIds.filter(x => x !== id) })), meetings: d.meetings.map(m => ({ ...m, actionItems: m.actionItems.map(a => a.taskId === id ? { ...a, taskId: undefined } : a) })), reflections: d.reflections.map(r => r.relatedTaskId === id ? { ...r, relatedTaskId: "" } : r) }));
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
  const deleteProject = (id: string) => setData(d => ({ ...d, projects: d.projects.filter(p => p.id !== id), tasks: d.tasks.map(t => t.projectId === id ? { ...t, projectId: "" } : t), meetings: d.meetings.map(m => m.relatedProjectId === id ? { ...m, relatedProjectId: "" } : m), reflections: d.reflections.map(r => r.relatedProjectId === id ? { ...r, relatedProjectId: "" } : r) }));
  const saveMeeting = (m: Meeting) => setData(d => ({ ...d, meetings: d.meetings.some(x => x.id === m.id) ? d.meetings.map(x => x.id === m.id ? m : x) : [m, ...d.meetings] }));
  const saveReflection = (r: Reflection) => setData(d => ({ ...d, reflections: d.reflections.some(x => x.id === r.id) ? d.reflections.map(x => x.id === r.id ? r : x) : [r, ...d.reflections] }));
  const saveContact = (c: Contact) => setData(d => ({ ...d, contacts: (d.contacts || []).some(x => x.id === c.id) ? d.contacts.map(x => x.id === c.id ? c : x) : [c, ...(d.contacts || [])] }));
  const deleteContact = (id: string) => setData(d => ({
    ...d,
    contacts: (d.contacts || []).filter(c => c.id !== id),
    tasks: d.tasks.map(t => ({
      ...t,
      requesterContactId: t.requesterContactId === id ? "" : t.requesterContactId,
      createdByContactId: t.createdByContactId === id ? "" : t.createdByContactId,
      waitingForType: t.waitingForId === id ? "legacy" : t.waitingForType,
      waitingForId: t.waitingForId === id ? "" : t.waitingForId,
    })),
    contactGroups: (d.contactGroups || []).map(g => ({ ...g, contactIds: g.contactIds.filter(x => x !== id), updatedAt: localNow() })),
  }));
  const saveContactGroup = (g: ContactGroup) => setData(d => ({ ...d, contactGroups: (d.contactGroups || []).some(x => x.id === g.id) ? d.contactGroups.map(x => x.id === g.id ? g : x) : [g, ...(d.contactGroups || [])] }));
  const deleteContactGroup = (id: string) => setData(d => ({ ...d, contactGroups: (d.contactGroups || []).filter(g => g.id !== id) }));
  const openTask = (task?: Task) => { setEditingTask(task || null); setModal("task"); };
  const openProject = (p?: Project) => { setEditingProject(p || null); setModal("project"); };
  const openMeeting = (m?: Meeting) => { setEditingMeeting(m || null); setModal("meeting"); };
  const openReflection = (r?: Reflection) => { setEditingReflection(r || null); setModal("reflection"); };
  const openWaitingTask = () => openTask(blankTask({ status: "Waiting", dueDate: "", followUpDate: formatLocalDate(addDays(new Date(), 2)) }));
  const openPrimary = () => view === "display" ? notify("显示设置已实时生效") : view === "meetings" ? openMeeting() : view === "thinking" ? openReflection() : view === "projects" ? openProject() : ["contacts","groups","collaboration"].includes(view) ? notify("请在页面内新增联系人或群组") : view === "inbox" ? setModal("capture") : view === "reports" ? notify("请在下方选择报告范围后生成") : view === "workAnalytics" ? notify("请在分析中心内切换周期或时间范围") : view === "waiting" ? openWaitingTask() : openTask();
  const primaryLabel = view === "display" ? "设置已生效" : view === "meetings" ? "新建会议" : view === "thinking" ? "记录复盘" : view === "projects" ? "新建项目" : view === "contacts" ? "管理联系人" : view === "groups" ? "管理群组" : view === "collaboration" ? "协作管理" : view === "inbox" ? "快速记录" : view === "reports" ? "生成报告" : view === "workAnalytics" ? "调整分析" : view === "waiting" ? "新增等待事项" : "新建任务";

  return <div className={cn("app-shell", mobileNavOpen && "nav-open", `display-font-${displaySettings.fontScale}`, `display-width-${displaySettings.contentWidth}`, `display-density-${displaySettings.density}`)}>
    {mobileNavOpen && <button className="mobile-sidebar-scrim" aria-label="关闭导航" onClick={() => setMobileNavOpen(false)} />}
    <aside className="sidebar"><div className="brand"><div className="brand-mark"><Zap size={17} fill="currentColor" /></div><span>WorkOS</span><span className="version">PERSONAL</span><button className="mobile-nav-close" aria-label="关闭导航" onClick={() => setMobileNavOpen(false)}><X size={18}/></button></div>
      <button className="quick-capture" onClick={() => setModal("capture")}><Plus size={16} /> 快速记录 <kbd>⌘ K</kbd></button>
      <nav className="nav-wrap">{nav.map(s => <div className="nav-section" key={s.group}><div className="nav-label">{s.group}</div>{s.items.map(item => { const Icon = item.icon; const count = item.id === "inbox" ? data.tasks.filter(t => t.status === "Inbox").length : item.id === "waiting" ? data.tasks.filter(t => t.status === "Waiting").length : 0; return <button key={item.id} className={cn("nav-item", view === item.id && "active")} onClick={() => setView(item.id)}><Icon size={17} /><span>{item.label}</span>{count > 0 && <b>{count}</b>}</button> })}</div>)}</nav>
      <div className="sidebar-footer"><div className="memory-status"><div className="memory-title"><span><Sparkles size={14} /> 工作记忆</span><b>{Math.min(100, data.tasks.length * 5 + data.reflections.length * 7)}%</b></div><div className="progress"><i style={{ width: `${Math.min(100, data.tasks.length * 5 + data.reflections.length * 7)}%` }} /></div><p>已沉淀 {data.tasks.length + data.meetings.length + data.reflections.length} 条记录</p></div><button className="profile" onClick={() => setModal("settings")}><div className="avatar">{auth.user?.email?.slice(0,1).toUpperCase() || "U"}</div><div><strong>{auth.user?.email || "我的工作空间"}</strong><span>{syncStatusLabel(auth.syncStatus, mode)}</span></div><MoreHorizontal size={18} /></button></div>
    </aside>
    <main className="main"><header className="topbar"><button className="mobile-menu-button" aria-label="打开导航" onClick={() => setMobileNavOpen(true)}><Menu size={19}/></button><div className="search"><Search size={16} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索任务、项目、会议、复盘..." /><kbd>⌘ /</kbd></div><div className="top-actions"><button className="icon-button" aria-label="通知" onClick={() => notify("当前没有新的提醒")}><Bell size={18} /></button><button className="icon-button" aria-label="设置" onClick={() => setModal("settings")}><Settings size={18} /></button><div className="today-pill"><CalendarDays size={15} />{format(new Date(), "M月d日 EEEE", { locale: zhCN })}</div></div></header>
      <div className="page"><div className="page-head"><div><h1>{viewMeta[view].title}</h1><p>{viewMeta[view].subtitle}</p></div><button className="primary" onClick={openPrimary}><Plus size={16} />{primaryLabel}</button></div>
        {search.trim() ? <GlobalSearchResults data={data} query={search} onTask={setDetailTask} onProject={setDetailProject} onReflection={setDetailReflection} onView={setView} /> : <>
          {view === "today" && <Dashboard data={data} setView={setView} onTask={setDetailTask} />}
          {view === "inbox" && <InboxView data={data} updateTask={updateTask} deleteTask={deleteTask} query={search} notify={notify} />}
          {view === "tasks" && <TaskCenter data={data} query={search} updateTask={updateTask} deleteTask={deleteTask} notify={notify} onOpen={setDetailTask} onAdd={openTask} onComplete={completeTask} onStartTimer={startTimer} onPauseTimer={pauseTimer} onStopTimer={stopTimer} />}
          {view === "projects" && <ProjectCenter data={data} query={search} onOpen={setDetailProject} onEdit={openProject} onAdd={openProject} />}
          {view === "meetings" && <MeetingCenter data={data} setData={setData} query={search} onEdit={openMeeting} onTask={setDetailTask} onDelete={m => { if (confirm(`删除会议“${m.title}”？`)) { setData(d => ({ ...d, meetings: d.meetings.filter(x => x.id !== m.id) })); notify("会议已删除"); } }} />}
          {view === "collaboration" && <CollaborationOverview data={data} setView={setView} />}
          {view === "contacts" && <ContactCenter initialTab="contacts" data={data} query={search} onSaveContact={c => { saveContact(c); notify("联系人已保存"); }} onDeleteContact={c => { if (confirm(`删除联系人“${c.name}”？会从群组中移除，但历史会议参会人文本会保留。`)) { deleteContact(c.id); notify("联系人已删除"); } }} onSaveGroup={g => { saveContactGroup(g); notify("群组已保存"); }} onDeleteGroup={g => { if (confirm(`删除群组“${g.name}”？联系人本身会保留。`)) { deleteContactGroup(g.id); notify("群组已删除"); } }} />}
          {view === "groups" && <ContactCenter initialTab="groups" data={data} query={search} onSaveContact={c => { saveContact(c); notify("联系人已保存"); }} onDeleteContact={c => { if (confirm(`删除联系人“${c.name}”？会从群组中移除，但历史会议参会人文本会保留。`)) { deleteContact(c.id); notify("联系人已删除"); } }} onSaveGroup={g => { saveContactGroup(g); notify("群组已保存"); }} onDeleteGroup={g => { if (confirm(`删除群组“${g.name}”？联系人本身会保留。`)) { deleteContactGroup(g.id); notify("群组已删除"); } }} />}
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
    <CaptureDialog open={modal === "capture"} contacts={data.contacts} onOpenChange={o => !o && setModal(null)} onAdd={saveTask} />
    <TaskDialog open={modal === "task"} task={editingTask} projects={data.projects} contacts={data.contacts} onCreateProject={createProject} onOpenChange={o => !o && setModal(null)} onSave={t => { const existed = data.tasks.some(task => task.id === t.id); saveTask(t); setModal(null); notify(existed ? "任务已更新" : "任务已创建"); }} />
    <ProjectDialog open={modal === "project"} project={editingProject} onOpenChange={o => !o && setModal(null)} onSave={p => { saveProject(p); setModal(null); notify(editingProject ? "项目已更新" : "项目已创建"); }} />
    <MeetingDialogV2 open={modal === "meeting"} meeting={editingMeeting} data={data} onCreateProject={createProject} onOpenChange={o => !o && setModal(null)} onSave={m => { saveMeeting(m); setModal(null); notify(editingMeeting ? "会议已更新" : "会议已创建"); }} />
    <ReflectionDialog open={modal === "reflection"} reflection={editingReflection} data={data} onCreateProject={createProject} onOpenChange={o => !o && setModal(null)} onSave={r => { saveReflection(r); setModal(null); notify(editingReflection ? "复盘已更新" : "复盘已记录"); }} />
    <TaskDetail open={!!detailTask} task={detailTask && data.tasks.find(t => t.id === detailTask.id) || null} data={data} editedBy={auth.user?.email || "本地用户"} onClose={() => setDetailTask(null)} onEdit={t => { setDetailTask(null); openTask(t); }} onDelete={t => { if (confirm(`删除任务“${t.title}”？`)) { deleteTask(t.id); setDetailTask(null); notify("任务已删除"); } }} onReflection={() => { if (detailTask) { setEditingReflection({ id: uid("reflection"), title: "", content: "", type: "问题复盘", relatedProjectId: detailTask.projectId, relatedTaskId: detailTask.id, date: todayISO(), durationMinutes: 0, tags: [] }); setDetailTask(null); setModal("reflection"); } }} onProject={p => { setDetailTask(null); setDetailProject(p); }} onStartTimer={startTimer} onPauseTimer={pauseTimer} onStopTimer={stopTimer} onCorrectSession={(taskId,index,session)=>{correctTimeSession(taskId,index,session); notify("计时记录已修正，原始记录已保留");}} />
    <ProjectDetail open={!!detailProject} project={detailProject && data.projects.find(p => p.id === detailProject.id) || null} data={data} onClose={() => setDetailProject(null)} onEdit={p => { setDetailProject(null); openProject(p); }} onDelete={p => { if (confirm(`删除项目“${p.name}”？关联记录会保留但解除关联。`)) { deleteProject(p.id); setDetailProject(null); notify("项目已删除，关联记录已保留"); } }} onTask={t => { setDetailProject(null); setDetailTask(t); }} onReflection={r => { setDetailProject(null); setDetailReflection(r); }} />
    <ReflectionDetail open={!!detailReflection} reflection={detailReflection && data.reflections.find(r => r.id === detailReflection.id) || null} data={data} onClose={() => setDetailReflection(null)} onEdit={r => { setDetailReflection(null); openReflection(r); }} onDelete={r => { if (confirm(`删除复盘“${r.title}”？`)) { setData(d => ({ ...d, reflections: d.reflections.filter(x => x.id !== r.id) })); setDetailReflection(null); notify("复盘已删除"); } }} />
    <SettingsDialog open={modal === "settings"} onClose={() => setModal(null)} data={data} mode={mode} onCloudRefresh={reloadCloudData} onReset={() => { localWorkDataRepository.clear(); setData(JSON.parse(JSON.stringify(seedData))); notify("演示数据已恢复"); }} notify={notify} />
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
  const groups = (data.contactGroups || []).filter(g => fuzzyMatch(query, groupSearchFields(g, data.contacts || [])));
  const total = tasks.length + projects.length + meetings.length + reflections.length + reports.length + contacts.length + groups.length;
  if (!total) return <EmptyState icon={Search} title="没有找到匹配结果" text="可以试试项目名、提出人、来源、标签或复盘关键词。" />;
  return <div className="search-results">
    <section className="panel search-summary"><span className="eyebrow">GLOBAL SEARCH</span><h2>找到 {total} 条结果</h2><p>搜索范围包含任务、项目、会议、复盘、报告、联系人和群组。清空搜索框即可回到原页面。</p></section>
    <div className="search-result-grid">
      <SearchGroup title="任务" count={tasks.length}>{tasks.map(t => <button className="linked-row" key={t.id} onClick={() => onTask(t)}><ListTodo size={16}/><div><strong>{t.title}</strong><span>{projectName(data.projects,t.projectId)} · {t.requester} · {t.source}</span></div><ArrowRight size={15}/></button>)}</SearchGroup>
      <SearchGroup title="项目" count={projects.length}>{projects.map(p => { const progress = projectProgressFromData(data, p); return <button className="linked-row" key={p.id} onClick={() => onProject(p)}><FolderKanban size={16}/><div><strong>{p.name}</strong><span>{p.type} · {progress.progress}% · 任务 {progress.completed}/{progress.total} · {p.priority}</span></div><ArrowRight size={15}/></button> })}</SearchGroup>
      <SearchGroup title="会议" count={meetings.length}>{meetings.map(m => <button className="linked-row" key={m.id} onClick={() => onView("meetings")}><CalendarDays size={16}/><div><strong>{m.title}</strong><span>{meetingTimeRange(m)} · {projectName(data.projects,m.relatedProjectId)}</span></div><ArrowRight size={15}/></button>)}</SearchGroup>
      <SearchGroup title="复盘" count={reflections.length}>{reflections.map(r => <button className="linked-row" key={r.id} onClick={() => onReflection(r)}><Brain size={16}/><div><strong>{r.title}</strong><span>{r.type} · {projectName(data.projects,r.relatedProjectId)}</span></div><ArrowRight size={15}/></button>)}</SearchGroup>
      <SearchGroup title="报告" count={reports.length}>{reports.map(r => <button className="linked-row" key={r.id} onClick={() => onView("reports")}><FileText size={16}/><div><strong>{r.title}</strong><span>{r.type} · {r.startDate} — {r.endDate}</span></div><ArrowRight size={15}/></button>)}</SearchGroup>
      <SearchGroup title="联系人" count={contacts.length}>{contacts.map(c => <button className="linked-row" key={c.id} onClick={() => onView("contacts")}><Users size={16}/><div><strong>{c.name}</strong><span>{[c.team,c.company,c.role].filter(Boolean).join(" · ")}</span></div><ArrowRight size={15}/></button>)}</SearchGroup>
      <SearchGroup title="群组" count={groups.length}>{groups.map(g => <button className="linked-row" key={g.id} onClick={() => onView("contacts")}><Users size={16}/><div><strong>{g.name}</strong><span>{g.contactIds.length} 位成员</span></div><ArrowRight size={15}/></button>)}</SearchGroup>
    </div>
  </div>;
}
function SearchGroup({ title, count, children }: { title: string; count: number; children: React.ReactNode }) { return <section className="panel search-group"><PanelHead title={`${title} · ${count}`} sub={count ? "点击查看详情" : "暂无匹配"} />{count ? children : <p className="meeting-notes">没有匹配内容</p>}</section> }

function WorkAnalytics({ data, onTask, onMeeting, onReflection }: { data: WorkData; onTask: (t: Task) => void; onMeeting: (m: Meeting) => void; onReflection: (r: Reflection) => void }) {
  const [tab, setTab] = useState<"week"|"month"|"custom"|"projects">("week");
  const [weekStart, setWeekStart] = useState(format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd"));
  const [month, setMonth] = useState(format(new Date(), "yyyy-MM"));
  const [customStart, setCustomStart] = useState(format(subDays(new Date(), 14), "yyyy-MM-dd"));
  const [customEnd, setCustomEnd] = useState(todayISO());
  return <div className="work-analytics">
    <div className="analytics-tabs">{[["week","周度概览"],["month","月度概览"],["custom","自定义分析"],["projects","项目时间线"]].map(([id,label]) => <button key={id} className={cn(tab===id&&"active")} onClick={()=>setTab(id as typeof tab)}>{label}</button>)}</div>
    {tab === "week" && <WeeklyAnalytics data={data} weekStart={weekStart} setWeekStart={setWeekStart} onTask={onTask} onMeeting={onMeeting} onReflection={onReflection} />}
    {tab === "month" && <MonthlyAnalytics data={data} month={month} setMonth={setMonth} onTask={onTask} onMeeting={onMeeting} onReflection={onReflection} />}
    {tab === "custom" && <CustomAnalytics data={data} start={customStart} end={customEnd} setStart={setCustomStart} setEnd={setCustomEnd} onTask={onTask} onMeeting={onMeeting} onReflection={onReflection} />}
    {tab === "projects" && <ProjectTimeline data={data} />}
  </div>;
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
  const meetingProjectRows = data.projects.map(p => ({ project:p, meetings: stats.meetings.filter(m=>m.relatedProjectId===p.id), seconds: stats.meetings.filter(m=>m.relatedProjectId===p.id).reduce((s,m)=>s+(m.durationMinutes||0)*60,0) })).filter(x=>x.seconds>0).sort((a,b)=>b.seconds-a.seconds);
  const attendeeMap = new Map<string,{count:number;seconds:number;meetings:Meeting[]}>();
  stats.meetings.forEach(m => (m.attendees.length?m.attendees:["未记录"]).forEach(name => attendeeMap.set(name,{count:(attendeeMap.get(name)?.count||0)+1,seconds:(attendeeMap.get(name)?.seconds||0)+(m.durationMinutes||0)*60,meetings:[...(attendeeMap.get(name)?.meetings||[]),m]})));
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
  const total = stats.byKind("会议"), meetings = [...stats.meetings].sort((a,b)=>(b.durationMinutes||0)-(a.durationMinutes||0)), actionCount = stats.meetings.reduce((s,m)=>s+m.actionItems.length,0), avg = stats.meetings.length ? total / stats.meetings.length : 0;
  const byProject = data.projects.map(p => ({ name: p.name, seconds: stats.meetings.filter(m=>m.relatedProjectId===p.id).reduce((s,m)=>s+(m.durationMinutes||0)*60,0) })).filter(x=>x.seconds>0).sort((a,b)=>b.seconds-a.seconds);
  const attendeeMap = new Map<string,{count:number;seconds:number}>();
  stats.meetings.forEach(m => (m.attendees.length?m.attendees:["未记录"]).forEach(name => attendeeMap.set(name,{count:(attendeeMap.get(name)?.count||0)+1,seconds:(attendeeMap.get(name)?.seconds||0)+(m.durationMinutes||0)*60})));
  const attendees = [...attendeeMap.entries()].sort((a,b)=>b[1].seconds-a[1].seconds).slice(0,8);
  return <section className="panel meeting-analysis"><PanelHead title="会议分析" sub="会议占用时间、行动项与协作对象" />{stats.meetings.length ? <>
    <div className="meeting-metrics"><button onClick={()=>onDetail("meetings")}><b>{stats.meetings.length}</b><span>本周期会议</span></button><button onClick={()=>onDetail("meetings")}><b>{(total/3600).toFixed(1)}h</b><span>会议总时长</span></button><button onClick={()=>onDetail("meetings")}><b>{(avg/3600).toFixed(1)}h</b><span>平均时长</span></button><button onClick={()=>onDetail("meetings")}><b>{stats.totalSeconds ? (total/stats.totalSeconds*100).toFixed(0) : 0}%</b><span>占总时间</span></button><button onClick={()=>onDetail("meetings")}><b>{actionCount}</b><span>行动项</span></button></div>
    <div className="meeting-analysis-grid"><div><h3>最耗时会议</h3>{meetings.slice(0,5).map(m=><button className="meeting-mini-row" key={m.id} onClick={()=>onMeeting(m)}><span>{m.title}</span><b>{((m.durationMinutes||0)/60).toFixed(1)}h</b></button>)}</div><div><h3>按项目统计</h3>{byProject.length?byProject.map(x=><button className="meeting-mini-row" key={x.name} onClick={()=>onDetail("meetingProjects")}><span>{x.name}</span><b>{(x.seconds/3600).toFixed(1)}h</b></button>):<p>暂无关联项目会议</p>}</div><div><h3>按参会人员统计</h3>{attendees.map(([name,row])=><button className="meeting-mini-row" key={name} onClick={()=>onDetail("meetingAttendees")}><span>{name} · {row.count} 场</span><b>{(row.seconds/3600).toFixed(1)}h</b></button>)}</div></div>
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
  const today = todayISO(), week = startOfWeek(new Date(), { weekStartsOn: 1 });
  const todayTasks = data.tasks.filter(t => t.status !== "Done" && t.status !== "Inbox" && (!t.dueDate || t.dueDate <= today)).slice(0, 4);
  const done = data.tasks.filter(t => t.completedAt && !isBefore(parseISO(t.completedAt), week));
  const dueSoon = data.tasks.filter(t => t.status !== "Done" && t.dueDate && t.dueDate <= formatLocalDate(addDays(new Date(), 3)));
  const risk = data.tasks.filter(t => t.actualHours > t.estimatedHours * .8 && t.status !== "Done");
  const waiting = data.tasks.filter(t=>t.status==="Waiting");
  const todayMeetings = data.meetings.filter(m => meetingHasTime(m) && formatLocalDate(meetingStartValue(m)) === today);
  const activeProjects = data.projects.filter(p => p.status === "Active");
  const contacts = data.contacts || [];
  const groups = data.contactGroups || [];
  const [detail, setDetail] = useState<DashboardDetailKind | null>(null);
  return <><div className="stats-grid"><StatCard label="今日待办" value={todayTasks.length} unit="项" detail={`${dueSoon.length} 项即将到期`} icon={Target} tone="purple" onClick={()=>setDetail("today")} /><StatCard label="本周已完成" value={done.length} unit="项" detail={`累计 ${hoursLabel(done.reduce((s,t)=>s+t.actualHours,0))}`} icon={CheckCircle2} tone="green" onClick={()=>setDetail("done")} /><StatCard label="等待反馈" value={waiting.length} unit="项" detail="依赖他人反馈" icon={Clock3} tone="orange" onClick={()=>setDetail("waiting")} /><StatCard label="超时风险" value={risk.length} unit="项" detail="已消耗 80% 以上预估" icon={BarChart3} tone="blue" onClick={()=>setDetail("risk")} /></div>
    <div className="collab-mini-stats"><button onClick={()=>setView("tasks")}><b>{data.tasks.filter(t=>t.status!=="Done"&&t.status!=="Inbox").length}</b><span>任务</span></button><button onClick={()=>setView("projects")}><b>{activeProjects.length}</b><span>进行中项目</span></button><button onClick={()=>setView("meetings")}><b>{todayMeetings.length}</b><span>今日会议</span></button><button onClick={()=>setView("contacts")}><b>{contacts.length}</b><span>联系人</span></button><button onClick={()=>setView("groups")}><b>{groups.length}</b><span>群组</span></button></div>
    <div className="dashboard-grid"><section className="panel focus-panel"><PanelHead title="今日待办与本周重点" sub="按优先级与截止时间排序" action="查看全部" onAction={()=>setView("tasks")} /><div className="focus-list">{todayTasks.map(t=><button className="dashboard-task" key={t.id} onClick={()=>onTask(t)}><span className={`priority ${t.priority.toLowerCase()}`}>{t.priority}</span><div><strong>{t.title}</strong><p>{projectName(data.projects,t.projectId)} · 截止 {t.dueDate||"未设置"}</p></div><ArrowRight size={15}/></button>)}</div></section>
      <section className="panel"><PanelHead title="项目进度概览" sub="正在推进的重点项目" action="项目中心" onAction={()=>setView("projects")} /><div className="project-mini-list">{data.projects.filter(p=>p.status==="Active").slice(0,4).map(p=>{const progress=projectProgressFromData(data,p);return <button key={p.id} onClick={()=>setView("projects")}><div><strong>{p.name}</strong><span>{progress.progress}% · {progress.completed}/{progress.total}</span></div><div className="project-progress"><i style={{width:`${progress.progress}%`}}/></div><p>{p.nextAction}</p></button>})}</div></section>
      <section className="panel"><PanelHead title="最近复盘" sub="与任务、项目关联的工作思考" action="思考空间" onAction={()=>setView("thinking")} /><div className="memory-feed">{data.reflections.slice(0,3).map(r=><div className="memory-item" key={r.id}><div className="purple"><Brain size={15}/></div><section><strong>{r.title}</strong><p>{r.type} · {projectName(data.projects,r.relatedProjectId)}</p></section></div>)}</div></section>
      <section className="panel"><PanelHead title="到期与风险提醒" sub="需要提前干预的事项" /><div className="risk-list">{[...dueSoon,...risk.filter(r=>!dueSoon.some(t=>t.id===r.id))].slice(0,4).map(t=><button key={t.id} onClick={()=>onTask(t)}><Clock3 size={15}/><div><strong>{t.title}</strong><p>{t.dueDate<today?"已延期":"即将到期"} · {hoursLabel(t.actualHours)}/{hoursLabel(t.estimatedHours)}</p></div></button>)}</div></section>
    </div>
    <DashboardDetailsDrawer kind={detail} data={data} todayTasks={todayTasks} done={done} waiting={waiting} risk={risk} onClose={()=>setDetail(null)} onTask={onTask} />
  </>;
}

function DashboardDetailsDrawer({ kind, data, todayTasks, done, waiting, risk, onClose, onTask }: { kind: DashboardDetailKind | null; data: WorkData; todayTasks: Task[]; done: Task[]; waiting: Task[]; risk: Task[]; onClose: () => void; onTask: (t: Task) => void }) {
  const rows = kind === "today" ? todayTasks : kind === "done" ? done : kind === "waiting" ? waiting : kind === "risk" ? risk : [];
  const title = kind === "today" ? "今日待办明细" : kind === "done" ? "本周已完成明细" : kind === "waiting" ? "等待反馈明细" : "超时风险明细";
  return <DrillDownDrawer open={!!kind} onClose={onClose} title={title} subtitle="点击记录可查看任务详情">
    <div className="drill-list">{rows.length ? rows.map(t=>{const target=waitingTarget(t,data);return <button className="drill-row" key={t.id} onClick={()=>onTask(t)}><span className={`priority ${t.priority.toLowerCase()}`}>{t.priority}</span><div><strong>{t.title}</strong><p>{projectName(data.projects,t.projectId)} · {t.status} · 截止 {t.dueDate || "未设置"}</p><small>{t.completedAt ? `完成 ${t.completedAt} · ` : ""}实际耗时 {durationLabel(taskSeconds(t))}</small>{t.status==="Waiting"&&<small>等待 {target.name}{t.waitingReason?`：${t.waitingReason}`:""}</small>}</div></button>}) : <EmptyState icon={Search} title="当前暂无记录" text="这个数字暂时没有来源明细。"/>}</div>
  </DrillDownDrawer>;
}

function InboxView({ data, updateTask, deleteTask, query, notify }: { data: WorkData; updateTask:(id:string,p:Partial<Task>)=>void; deleteTask:(id:string)=>void; query:string; notify:(s:string)=>void }) {
  const list=data.tasks.filter(t=>t.status==="Inbox"&&fuzzyMatch(query, taskSearchFields(t, data)));
  return <section className="panel wide-panel"><div className="inbox-toolbar"><div><b>{list.length} 条待处理</b><span>把它们变成任务，或放心删掉</span></div><button className="ghost" onClick={()=>notify(list.length?"请逐条明确任务归属，避免误删":"收集箱已经是空的")}><Archive size={15}/> 整理提示</button></div><div className="inbox-list">{list.length?list.map(t=><div className="inbox-item" key={t.id}><div className="source-icon"><Inbox size={17}/></div><div className="inbox-content"><strong>{t.title}</strong><p>来自 {t.source} · {t.requester} · {t.createdAt}</p></div><div className="inbox-actions"><button className="secondary" onClick={()=>updateTask(t.id,{status:"Todo",dueDate:formatLocalDate(addDays(new Date(),3))})}>转为任务 <ArrowRight size={14}/></button><button className="icon-button" aria-label="删除" onClick={()=>{if(confirm(`删除“${t.title}”？`))deleteTask(t.id)}}><X size={16}/></button></div></div>):<EmptyState icon={Inbox} title="收集箱已清空" text="所有输入都已经有了去处。"/>}</div></section>;
}

function TaskCenter({ data, query, updateTask, deleteTask, notify, onOpen, onAdd, onComplete, onStartTimer, onPauseTimer, onStopTimer }: { data:WorkData; query:string; updateTask:(id:string,p:Partial<Task>)=>void; deleteTask:(id:string)=>void; notify:(s:string)=>void; onOpen:(t:Task)=>void; onAdd:(t?:Task)=>void; onComplete:(t:Task)=>void; onStartTimer:(t:Task)=>void; onPauseTimer:(t:Task)=>void; onStopTimer:(t:Task)=>void }) {
  const [status,setStatus]=useState("全部"),[project,setProject]=useState("全部"),[priority,setPriority]=useState("全部");
  const tasks=data.tasks.filter(t=>t.status!=="Inbox"&&fuzzyMatch(query, taskSearchFields(t, data))&&(status==="全部"||t.status===status)&&(project==="全部"||t.projectId===project)&&(priority==="全部"||t.priority===priority));
  const columns:(TaskStatus)[] = status!=="全部"?[status as TaskStatus]:["Todo","Doing","Waiting","Done"];
  return <><FilterBar><select value={status} onChange={e=>setStatus(e.target.value)}><option>全部</option><option value="Todo">待开始</option><option value="Doing">进行中</option><option value="Waiting">等待中</option><option value="Done">已完成</option></select><select value={project} onChange={e=>setProject(e.target.value)}><option value="全部">全部项目</option>{data.projects.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select><select value={priority} onChange={e=>setPriority(e.target.value)}><option>全部</option><option>P0</option><option>P1</option><option>P2</option><option>P3</option></select><button onClick={()=>{setStatus("全部");setProject("全部");setPriority("全部")}}>清除筛选</button></FilterBar>
    <div className={cn("kanban",columns.length<4&&"filtered-kanban")}>{columns.map(s=><section className="kanban-col" key={s}><div className="kanban-head"><span className={`status-dot ${s.toLowerCase()}`}/>{{Todo:"待开始",Doing:"进行中",Waiting:"等待中",Done:"已完成",Inbox:"收集箱"}[s]}<b>{tasks.filter(t=>t.status===s).length}</b></div><div className="kanban-stack">{tasks.filter(t=>t.status===s).map(t=><TaskCard key={t.id} task={t} data={data} project={projectName(data.projects,t.projectId)} onOpen={()=>onOpen(t)} onComplete={()=>onComplete(t)} onDelete={()=>{if(confirm(`确定要删除任务“${t.title}”吗？此操作不可恢复。`)){deleteTask(t.id);notify("任务已删除")}}} onStatus={v=>v==="Done"?onComplete(t):updateTask(t.id,{status:v,completedAt:undefined,...(v==="Waiting"?{}:{waitingForType:undefined,waitingForId:"",waitingFor:"",waitingReason:"",followUpDate:""})})} onStartTimer={()=>onStartTimer(t)} onPauseTimer={()=>onPauseTimer(t)} onStopTimer={()=>onStopTimer(t)}/>) }<button className="add-card" onClick={()=>onAdd(s==="Waiting"?blankTask({status:"Waiting",dueDate:"",followUpDate:formatLocalDate(addDays(new Date(),2))}):undefined)}><Plus size={15}/> 添加任务</button></div></section>)}</div></>;
  }

function ProjectCenter({data,query,onOpen,onEdit,onAdd}:{data:WorkData;query:string;onOpen:(p:Project)=>void;onEdit:(p?:Project)=>void;onAdd:(p?:Project)=>void}) {
  const [status,setStatus]=useState("全部"); const list=data.projects.filter(p=>fuzzyMatch(query, projectSearchFields(p, data))&&(status==="全部"||p.status===status));
  return <><FilterBar><select value={status} onChange={e=>setStatus(e.target.value)}><option>全部</option><option value="Planning">规划中</option><option value="Active">进行中</option><option value="Paused">已暂停</option><option value="Done">已完成</option></select><button onClick={()=>onAdd()}><Plus size={14}/> 新增项目</button></FilterBar><div className="project-grid">{list.map(p=>{const tasks=relatedProjectTasks(data,p),progress=projectProgressSummary(p,tasks),hours=tasks.reduce((s,t)=>s+t.actualHours,0);return <article className="project-card" key={p.id}><div className="project-card-top"><span className={`priority ${p.priority.toLowerCase()}`}>{p.priority}</span><span className="project-status">{{Planning:"规划中",Active:"进行中",Paused:"暂停",Done:"完成"}[p.status]}</span></div><h3>{p.name}</h3><p>{p.goal}</p><div className="project-progress"><i style={{width:`${progress.progress}%`}}/></div><div className="project-numbers"><span><b>{progress.progress}%</b> 进度</span><span><b>{progress.completed}/{progress.total}</b> 任务</span><span><b>{hours.toFixed(1)}h</b> 已用</span></div><div className="project-card-actions"><button onClick={()=>onOpen(p)}>查看档案 <ArrowRight size={14}/></button><button onClick={()=>onEdit(p)}>编辑</button></div></article>})}</div></>;
}

function CollaborationOverview({data,setView}:{data:WorkData;setView:(v:View)=>void}) {
  const contacts = data.contacts || [], groups = data.contactGroups || [];
  const feishuContacts = contacts.filter(c => c.externalSource === "feishu");
  const feishuGroups = groups.filter(g => g.externalSource === "feishu");
  const groupMembers = new Set(groups.flatMap(g => g.contactIds)).size;
  const latestSync = [...contacts, ...groups].map(x => x.updatedAt).filter(Boolean).sort().at(-1);
  const favoriteHint = contacts.filter(c => /收藏|favorite/i.test(c.notes || "")).length;
  return <div className="collaboration-page">
    <section className="panel collaboration-hero">
      <div><span className="eyebrow">COLLABORATION CENTER</span><h2>跟谁协作、在哪些群推进，一眼能看清。</h2><p>联系人和群组会被会议创建器复用；飞书同步后的联系人也会自然出现在这里。</p></div>
      <div className="sync-pill"><Sparkles size={16}/><span>{latestSync ? `最近同步 ${format(parseISO(latestSync), "MM/dd HH:mm")}` : "尚未同步"}</span></div>
    </section>
    <div className="collab-overview-grid">
      <button className="collab-stat-card" onClick={()=>setView("contacts")}><Users size={20}/><span>联系人</span><b>{contacts.length}</b><small>{feishuContacts.length} 个来自飞书</small></button>
      <button className="collab-stat-card" onClick={()=>setView("groups")}><MessageSquareMore size={20}/><span>群组</span><b>{groups.length}</b><small>{feishuGroups.length} 个来自飞书</small></button>
      <button className="collab-stat-card" onClick={()=>setView("groups")}><Users size={20}/><span>群组成员</span><b>{groupMembers}</b><small>按群组去重统计</small></button>
      <button className="collab-stat-card" onClick={()=>setView("contacts")}><CheckCircle2 size={20}/><span>收藏线索</span><b>{favoriteHint}</b><small>备注含收藏/Favorite</small></button>
    </div>
    <div className="dashboard-grid">
      <section className="panel"><PanelHead title="最近联系人" sub="优先展示最近同步或编辑的人" action="联系人" onAction={()=>setView("contacts")} /><div className="contact-list compact-list">{contacts.slice(0,5).map(c=><article className="contact-card compact" key={c.id}><div className="person-avatar">{c.name.slice(0,1)}</div><div><strong>{c.name}<SourceBadge source={c.externalSource}/></strong><p>{[c.team,c.role,c.email].filter(Boolean).join(" · ") || "暂无更多信息"}</p></div></article>)}{!contacts.length&&<EmptyState icon={Users} title="暂无联系人" text="同步飞书或手动新增联系人后会出现在这里。"/>}</div></section>
      <section className="panel"><PanelHead title="最近群组" sub="常用协作群可用于会议一键选人" action="群组" onAction={()=>setView("groups")} /><div className="contact-list compact-list">{groups.slice(0,5).map(g=><article className="contact-card compact" key={g.id}><div className="group-avatar"><MessageSquareMore size={16}/></div><div><strong>{g.name}<SourceBadge source={g.externalSource}/></strong><p>{g.contactIds.length} 位成员 · {g.description || "暂无说明"}</p></div></article>)}{!groups.length&&<EmptyState icon={MessageSquareMore} title="暂无群组" text="创建群组或同步飞书群聊后会出现在这里。"/>}</div></section>
    </div>
  </div>
}

function ContactCenter({data,query,onSaveContact,onDeleteContact,onSaveGroup,onDeleteGroup,initialTab="contacts"}:{data:WorkData;query:string;onSaveContact:(c:Contact)=>void;onDeleteContact:(c:Contact)=>void;onSaveGroup:(g:ContactGroup)=>void;onDeleteGroup:(g:ContactGroup)=>void;initialTab?:"contacts"|"groups"}) {
  const contacts=data.contacts||[], groups=data.contactGroups||[];
  const [tab,setTab]=useState<"contacts"|"groups">(initialTab);
  const [team,setTeam]=useState("全部"),[company,setCompany]=useState("全部");
  const [editingContact,setEditingContact]=useState<Contact|null>(null);
  const [editingGroup,setEditingGroup]=useState<ContactGroup|null>(null);
  useEffect(()=>setTab(initialTab),[initialTab]);
  const blankContact=():Contact=>({id:uid("contact"),name:"",role:"",team:"",company:"",email:"",phone:"",notes:"",externalSource:"manual",externalId:"",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
  const blankGroup=():ContactGroup=>({id:uid("group"),name:"",description:"",contactIds:[],externalSource:"manual",externalId:"",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
  const contactList=contacts.filter(c=>fuzzyMatch(query,contactSearchFields(c))&&(team==="全部"||c.team===team)&&(company==="全部"||c.company===company));
  const groupList=groups.filter(g=>fuzzyMatch(query,groupSearchFields(g,contacts)));
  const teams=Array.from(new Set(contacts.map(c=>c.team).filter(Boolean)));
  const companies=Array.from(new Set(contacts.map(c=>c.company).filter(Boolean)));
  return <div className="contacts-layout">
    <section className="panel contacts-panel">
      <div className="contact-tabs"><button className={cn(tab==="contacts"&&"active")} onClick={()=>setTab("contacts")}>联系人</button><button className={cn(tab==="groups"&&"active")} onClick={()=>setTab("groups")}>群组</button></div>
      {tab==="contacts"&&<><FilterBar><select value={team} onChange={e=>setTeam(e.target.value)}><option>全部</option>{teams.map(x=><option key={x}>{x}</option>)}</select><select value={company} onChange={e=>setCompany(e.target.value)}><option>全部</option>{companies.map(x=><option key={x}>{x}</option>)}</select><button onClick={()=>setEditingContact(blankContact())}><Plus size={14}/> 新增联系人</button></FilterBar><div className="contact-list">{contactList.length?contactList.map(c=><article className="contact-card" key={c.id}><div className="person-avatar">{c.name.slice(0,1)}</div><div><strong>{c.name}<SourceBadge source={c.externalSource}/></strong><p>{[c.team,c.company,c.role].filter(Boolean).join(" · ")||"未填写团队信息"}</p><span>{c.notes||c.email||"暂无备注"}</span></div><div><button className="secondary small" onClick={()=>setEditingContact(c)}>编辑</button><button className="secondary small danger" onClick={()=>onDeleteContact(c)}>删除</button></div></article>):<EmptyState icon={Users} title="没有联系人" text="新增常用对接人，会议创建时就能直接选择。"/>}</div></>}
      {tab==="groups"&&<><FilterBar><button onClick={()=>setEditingGroup(blankGroup())}><Plus size={14}/> 新增群组</button></FilterBar><div className="contact-list">{groupList.length?groupList.map(g=><article className="contact-card" key={g.id}><div className="group-avatar"><Users size={16}/></div><div><strong>{g.name}<SourceBadge source={g.externalSource}/></strong><p>{g.contactIds.length} 位成员</p><span>{g.contactIds.map(id=>contacts.find(c=>c.id===id)?.name).filter(Boolean).join("、")||g.description||"暂无成员"}</span></div><div><button className="secondary small" onClick={()=>setEditingGroup(g)}>编辑</button><button className="secondary small danger" onClick={()=>onDeleteGroup(g)}>删除</button></div></article>):<EmptyState icon={Users} title="没有群组" text="把固定协作对象建成群组，创建会议时一键带入。"/>}</div></>}
    </section>
    <section className="panel contacts-editor">{editingContact?<ContactForm contact={editingContact} onCancel={()=>setEditingContact(null)} onSave={c=>{onSaveContact({...c,updatedAt:new Date().toISOString()});setEditingContact(null)}}/>:editingGroup?<GroupForm group={editingGroup} contacts={contacts} onCancel={()=>setEditingGroup(null)} onSave={g=>{onSaveGroup({...g,updatedAt:new Date().toISOString()});setEditingGroup(null)}}/>:<EmptyState icon={Users} title="选择或新建联系人" text="联系人和群组会同步到云端，也可在本地模式使用。"/>}</section>
  </div>
}

function SourceBadge({source}:{source?: Contact["externalSource"] | ContactGroup["externalSource"]}) {
  const feishu = source === "feishu";
  return <em className={cn("source-badge", feishu ? "feishu" : "manual")}>{feishu ? "飞书" : "手动"}</em>;
}

function ContactForm({contact,onSave,onCancel}:{contact:Contact;onSave:(c:Contact)=>void;onCancel:()=>void}) {
  const [form,setForm]=useState<Contact>(contact);
  useEffect(()=>setForm(contact),[contact]);
  const f=<K extends keyof Contact>(k:K,v:Contact[K])=>setForm(x=>({...x,[k]:v}));
  return <div className="contact-form"><h3>{contact.name?"编辑联系人":"新增联系人"}</h3><div className="form-grid compact"><Field label="姓名" wide><input autoFocus value={form.name} onChange={e=>f("name",e.target.value)}/></Field><Field label="角色"><input value={form.role||""} onChange={e=>f("role",e.target.value)}/></Field><Field label="团队"><input value={form.team||""} onChange={e=>f("team",e.target.value)}/></Field><Field label="公司"><input value={form.company||""} onChange={e=>f("company",e.target.value)}/></Field><Field label="邮箱"><input type="email" value={form.email||""} onChange={e=>f("email",e.target.value)}/></Field><Field label="电话"><input value={form.phone||""} onChange={e=>f("phone",e.target.value)}/></Field><Field label="备注" wide><textarea value={form.notes||""} onChange={e=>f("notes",e.target.value)}/></Field></div><div className="inline-actions"><button className="ghost" onClick={onCancel}>取消</button><button className="primary" disabled={!form.name.trim()} onClick={()=>onSave(form)}><Save size={14}/> 保存联系人</button></div></div>
}

function GroupForm({group,contacts,onSave,onCancel}:{group:ContactGroup;contacts:Contact[];onSave:(g:ContactGroup)=>void;onCancel:()=>void}) {
  const [form,setForm]=useState<ContactGroup>(group);
  useEffect(()=>setForm(group),[group]);
  const toggle=(id:string)=>setForm(g=>({...g,contactIds:g.contactIds.includes(id)?g.contactIds.filter(x=>x!==id):[...g.contactIds,id]}));
  return <div className="contact-form"><h3>{group.name?"编辑群组":"新增群组"}</h3><div className="form-grid compact"><Field label="群组名称" wide><input autoFocus value={form.name} onChange={e=>setForm(g=>({...g,name:e.target.value}))}/></Field><Field label="群组说明" wide><textarea value={form.description||""} onChange={e=>setForm(g=>({...g,description:e.target.value}))}/></Field></div><div className="member-picker"><span>群组成员</span>{contacts.length?contacts.map(c=><label key={c.id}><input type="checkbox" checked={form.contactIds.includes(c.id)} onChange={()=>toggle(c.id)}/><div><strong>{c.name}</strong><small>{[c.team,c.company].filter(Boolean).join(" · ")}</small></div></label>):<p>还没有联系人，请先新增联系人。</p>}</div><div className="inline-actions"><button className="ghost" onClick={onCancel}>取消</button><button className="primary" disabled={!form.name.trim()} onClick={()=>onSave(form)}><Save size={14}/> 保存群组</button></div></div>
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
  const hours = Array.from({length:14},(_,i)=>i+8);
  const periodLabel = mode==="day" ? format(anchor,"yyyy年M月d日 EEEE",{locale:zhCN}) : mode==="week" ? `${format(rangeStart,"M月d日")} - ${format(addDays(rangeEnd,-1),"M月d日")}` : format(anchor,"yyyy年M月");
  const shift = (delta:number) => setAnchor(current => mode==="day" ? addDays(current,delta) : mode==="week" ? addWeeks(current,delta) : new Date(current.getFullYear(),current.getMonth()+delta,1));
  const dayEvents = (day: Date) => visibleEvents.filter(event=>event.dayKey===formatLocalDate(day));
  const eventStyle = (event: CalendarEvent) => {
    const duration=Math.max(30,event.durationMinutes);
    return { top: Math.max(0,((event.startMinutesOfDay / 60)-8)*56), height: Math.max(28,duration/60*56) };
  };
  useEffect(()=>{
    console.table(data.meetings.map(meeting=>{
      const rawStart = meeting.startTime || "";
      const rawEnd = meeting.endTime || "";
      const parsedStart = parseLocalDateTime(rawStart);
      const parsedEnd = parseLocalDateTime(rawEnd);
      const event = toCalendarEvent(meeting);
      return {
        title: meeting.title,
        raw_date: meeting.date,
        raw_start_time: rawStart,
        raw_end_time: rawEnd,
        parsed_local_start: parsedStart ? formatLocalDateTime(parsedStart).replace("T"," ") : "",
        parsed_local_end: parsedEnd ? formatLocalDateTime(parsedEnd).replace("T"," ") : "",
        startMinutesOfDay: parsedStart ? parsedStart.getHours() * 60 + parsedStart.getMinutes() : "",
        displayedTime: event?.displayedTime || "时间未设置或已过滤",
      };
    }));
  },[data.meetings]);
  return <div className="calendar-system">
    <section className="panel calendar-toolbar">
      <div><span className="eyebrow">CALENDAR</span><h2>{periodLabel}</h2></div>
      <div className="calendar-actions"><button className="secondary" onClick={()=>shift(-1)}>上一段</button><button className="secondary" onClick={()=>setAnchor(new Date())}>今天</button><button className="secondary" onClick={()=>shift(1)}>下一段</button><div className="calendar-mode"><button className={cn(mode==="day"&&"active")} onClick={()=>setMode("day")}>日</button><button className={cn(mode==="week"&&"active")} onClick={()=>setMode("week")}>周</button><button className={cn(mode==="month"&&"active")} onClick={()=>setMode("month")}>月</button></div></div>
    </section>
    {mode==="month" ? <section className="panel month-calendar">
      <div className="month-weekdays">{["一","二","三","四","五","六","日"].map(day=><span key={day}>{day}</span>)}</div>
      <div className="month-grid">{days.map(day=>{const items=dayEvents(day);return <div className={cn("month-cell",day.getMonth()!==anchor.getMonth()&&"muted",format(day,"yyyy-MM-dd")===todayISO()&&"today")} key={day.toISOString()}><b>{format(day,"d")}</b>{items.slice(0,4).map(event=><button key={event.id} onClick={()=>setSelected(event)}><span>{formatLocalTime(event.localStart)}</span>{event.title}</button>)}{items.length>4&&<em>+{items.length-4} 场</em>}</div>})}</div>
    </section> : <section className="panel calendar-board" style={{"--calendar-days": days.length} as any}>
      <div className="calendar-day-head"><div />{days.map(day=><div className={cn(format(day,"yyyy-MM-dd")===todayISO()&&"today")} key={day.toISOString()}><span>{format(day,"EEE",{locale:zhCN})}</span><b>{format(day,"d")}</b></div>)}</div>
      <div className="calendar-time-grid">
        <div className="calendar-hours">{hours.map(hour=><span key={hour}>{String(hour).padStart(2,"0")}:00</span>)}</div>
        {days.map(day=><div className="calendar-day-column" key={day.toISOString()}>{hours.map(hour=><i key={hour}/>)}{dayEvents(day).map(event=>{const style=eventStyle(event);return <button className="calendar-event" key={event.id} style={{top:style.top,height:style.height}} onClick={()=>setSelected(event)}><strong>{event.title}</strong><span>{event.displayedTime}</span><small>{projectName(data.projects,event.meeting.relatedProjectId)}</small></button>})}</div>)}
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

function Analytics({data}:{data:WorkData}) { const measured=data.tasks.filter(t=>t.actualHours>0&&t.estimatedHours>0),est=measured.reduce((s,t)=>s+t.estimatedHours,0),act=measured.reduce((s,t)=>s+t.actualHours,0),accuracy=measured.length?Math.max(0,Math.round(100-measured.reduce((s,t)=>s+Math.abs(t.actualHours-t.estimatedHours)/t.estimatedHours*100,0)/measured.length)):0; return <><div className="analytics-top"><StatCard label="总预估工时" value={+est.toFixed(1)} unit="h" detail={`${measured.length} 个有记录的任务`} icon={Clock3} tone="purple"/><StatCard label="总实际工时" value={+act.toFixed(1)} unit="h" detail={act>est?`超出 ${hoursLabel(act-est)}`:`节省 ${hoursLabel(est-act)}`} icon={Timer} tone="blue"/><StatCard label="预估准确率" value={accuracy} unit="%" detail="持续记录会更准确" icon={Target} tone="green"/></div><div className="analytics-grid"><section className="panel chart-panel"><PanelHead title="预估 vs 实际" sub="最近有工时记录的任务"/><div className="bar-chart">{measured.map(t=>{const max=Math.max(t.estimatedHours,t.actualHours);return <div className="bar-row" key={t.id}><span>{t.title}</span><div className="bar-track"><i className="est" style={{width:`${t.estimatedHours/max*85}%`}}/><i className="act" style={{width:`${t.actualHours/max*85}%`}}/></div><b>{hoursLabel(t.actualHours)}</b></div>})}</div></section><section className="panel insight-card"><div className="insight-icon"><Sparkles size={20}/></div><span className="eyebrow">智能校准</span><h3>给自己多留 18% 的缓冲</h3><p>根据最近完成记录，分析与跨团队协作任务更容易低估。</p><div className="ddl-box"><span>原始预估</span><b>2.0h</b><ArrowRight size={16}/><span>建议预估</span><b className="accent">2.4h</b></div></section></div></> }

function WaitingDashboard({data,updateTask,onTask}:{data:WorkData;updateTask:(id:string,p:Partial<Task>)=>void;onTask:(t:Task)=>void}) {
  const list=data.tasks.filter(t=>t.status==="Waiting");
  const longest=list.length?Math.max(...list.map(t=>Math.max(0,Math.floor((Date.now()-parseISO(t.createdAt).getTime())/86400000)))):0;
  return <div className="waiting-layout">
    <div className="waiting-summary"><div><span className="eyebrow">正在等待</span><b>{list.length}</b><p>个事项依赖他人反馈，不计入普通待办</p></div><div className="wait-ring"><b>{longest}</b><span>最长等待天数</span></div></div>
    <section className="panel waiting-table">
      <div className="table-head"><span>事项</span><span>等待对象</span><span>等待内容</span><span>跟进日期</span><span>已等待</span><span/></div>
      {list.length?list.map(t=>{const days=Math.max(0,Math.floor((Date.now()-parseISO(t.createdAt).getTime())/86400000));const target=waitingTarget(t,data);return <div className="table-row" key={t.id}>
        <button className="table-task" onClick={()=>onTask(t)}><strong>{t.title}</strong><p>{projectName(data.projects,t.projectId)}</p></button>
        <span className="person">{target.avatar?<img className="person-avatar" src={target.avatar} alt=""/>:<span className="person-avatar">{target.initial}</span>}<span>{target.name}<small>{target.meta}</small></span></span>
        <span className="waiting-reason">{t.waitingReason||"未填写等待内容"}</span>
        <span>{t.followUpDate||t.dueDate||"未设置"}</span>
        <span className={cn("days",days>=3&&"late")}>{days} 天</span>
        <button className="secondary small" onClick={()=>updateTask(t.id,{status:"Todo",waitingForType:undefined,waitingForId:"",waitingFor:"",waitingReason:"",followUpDate:""})}>收到反馈</button>
      </div>}):<EmptyState icon={Clock3} title="没有等待事项" text="当任务状态设为等待后，会在这里显示等待对象、内容和跟进日期。"/>}
    </section>
  </div>
}

function ThinkingSpace({data,query,onOpen,onAdd}:{data:WorkData;query:string;onOpen:(r:Reflection)=>void;onAdd:(r?:Reflection)=>void}) { const [type,setType]=useState("全部"),[project,setProject]=useState("全部"); const list=data.reflections.filter(r=>(type==="全部"||r.type===type)&&(project==="全部"||r.relatedProjectId===project)&&fuzzyMatch(query,reflectionSearchFields(r,data)));return <><FilterBar><select value={type} onChange={e=>setType(e.target.value)}><option>全部</option>{["问题复盘","流程优化","风险提醒","经验沉淀","自动化想法","管理思考"].map(x=><option key={x}>{x}</option>)}</select><select value={project} onChange={e=>setProject(e.target.value)}><option value="全部">全部项目</option>{data.projects.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select><button onClick={()=>{setType("全部");setProject("全部")}}>清除筛选</button></FilterBar><div className="thought-grid"><button className="new-thought-card" onClick={()=>onAdd()}><div><Plus size={23}/></div><strong>记录一个新复盘</strong><span>关联具体项目或任务</span></button>{list.length?list.map(r=><article className="thought-card" key={r.id}><div className="thought-top"><span className="thought-tag">{r.type}</span><button aria-label="查看详情" onClick={()=>onOpen(r)}><MoreHorizontal size={17}/></button></div><h3>{r.title}</h3><p>{r.content}</p><div className="linked-context"><span>{projectName(data.projects,r.relatedProjectId)}</span>{r.relatedTaskId&&<span>{data.tasks.find(t=>t.id===r.relatedTaskId)?.title}</span>}</div><div className="thought-foot"><span>{r.date}</span><button onClick={()=>onOpen(r)}><ArrowRight size={15}/></button></div></article>):<EmptyState icon={Brain} title="没有匹配的复盘" text="换个关键词，或清空搜索恢复全部思考。"/>}</div></> }

function DisplaySettingsPage({settings,onChange}:{settings:DisplaySettings;onChange:(patch:Partial<DisplaySettings>)=>void}) {
  const fontOptions: { value: FontScale; label: string; hint: string }[] = [
    { value: "small", label: "Small", hint: "信息密度更高" },
    { value: "normal", label: "Normal", hint: "默认桌面体验" },
    { value: "large", label: "Large", hint: "适合 27 寸屏幕" },
    { value: "extra-large", label: "Extra Large", hint: "远距离或高分屏更舒服" },
  ];
  const widthOptions: { value: ContentWidth; label: string; hint: string }[] = [
    { value: "compact", label: "Compact", hint: "更聚焦的阅读宽度" },
    { value: "standard", label: "Standard", hint: "当前默认宽度" },
    { value: "wide", label: "Wide", hint: "适合 32 寸显示器" },
    { value: "full", label: "Full Width", hint: "尽量使用完整窗口" },
  ];
  const densityOptions: { value: Density; label: string; hint: string }[] = [
    { value: "compact", label: "Compact", hint: "更紧凑，适合快速扫视" },
    { value: "standard", label: "Standard", hint: "当前默认间距" },
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
function ReviewSection({n,title,desc,tasks,data,tone}:{n:string;title:string;desc:string;tasks:Task[];data:WorkData;tone?:string}){return <section className={cn("review-section",tone)}><div className="review-number">{n}</div><div><h3>{title}</h3><p className="section-desc">{desc}</p>{tasks.length?tasks.map(t=><div className="review-line" key={t.id}><CheckCircle2 size={17}/><div><strong>{t.title}</strong><span>{projectName(data.projects,t.projectId)} · {hoursLabel(t.actualHours)}</span></div></div>):<p className="meeting-notes">暂无相关事项</p>}</div></section>}
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

function CaptureDialog({open,contacts,onOpenChange,onAdd}:{open:boolean;contacts:Contact[];onOpenChange:(o:boolean)=>void;onAdd:(t:Task)=>void}) {
  const [title,setTitle]=useState(""),[source,setSource]=useState("快速记录"),[requesterContactId,setRequesterContactId]=useState("");
  const requester = findContact(contacts, requesterContactId);
  const submit=()=>{if(!title.trim())return;onAdd(blankTask({title,description:"",source,requester:requester?.name||"",requesterContactId:requester?.id||"",createdBy:"",createdByContactId:"",projectId:"",status:"Inbox",priority:"P2",dueDate:"",estimatedHours:.5,actualHours:0,createdAt:todayISO()}));setTitle("");setRequesterContactId("");onOpenChange(false)};
  return <BaseDialog open={open} onOpenChange={onOpenChange} title="快速记录" subtitle="先捕捉，不必现在就整理。">
    <div className="capture-box">
      <textarea autoFocus value={title} onChange={e=>setTitle(e.target.value)} placeholder="例如：客户反馈新版看板筛选有问题，需要本周确认原因。" aria-label="快速记录内容"/>
      <p className="capture-helper">无固定格式。这里适合先记下收到的任务、想法或提醒，保存后会进入 Inbox，稍后再整理成正式任务。</p>
      <div className="form-grid">
        <Field label="来源" helper="记录任务从哪里来，后续搜索和复盘时会用到。" tip="例如会议、邮件、私聊、项目群。"><select value={source} onChange={e=>setSource(e.target.value)}><option>快速记录</option><option>会议</option><option>邮件</option><option>私聊</option><option>项目群</option></select></Field>
        <ContactPicker label="提出人" contacts={contacts} selectedId={requesterContactId} legacy="" onSelect={setRequesterContactId} allowEmpty helper="谁提出或触发了这件事。必须来自联系人表。" />
      </div>
    </div>
    <div className="dialog-foot"><span>将进入 Inbox，稍后再处理</span><button className="primary" onClick={submit}>保存记录</button></div>
  </BaseDialog>
}

function TaskDialog({open,task,projects,contacts,onCreateProject,onOpenChange,onSave}:{open:boolean;task:Task|null;projects:Project[];contacts:Contact[];onCreateProject:(p:Project)=>Project;onOpenChange:(o:boolean)=>void;onSave:(t:Task)=>void}) {
  const [form,setForm]=useState<Task>(blankTask());
  const [newSubtask,setNewSubtask]=useState("");
  const [error,setError]=useState("");
  const isExisting = !!task?.title?.trim();
  useEffect(()=>{if(open){const requesterMatch=task?.requesterContactId?findContact(contacts,task.requesterContactId):findContactByText(contacts,task?.requester);const createdByMatch=task?.createdByContactId?findContact(contacts,task.createdByContactId):findContactByText(contacts,task?.createdBy);const waitingMatch=task?.waitingForId?findContact(contacts,task.waitingForId):findContactByText(contacts,task?.waitingFor);setForm(task?{...blankTask(),...task,requesterContactId:requesterMatch?.id||task.requesterContactId||"",requester:requesterMatch?.name||task.requester||"",createdByContactId:createdByMatch?.id||task.createdByContactId||"",createdBy:createdByMatch?.name||task.createdBy||"",subtasks:sortedSubtasks(task),autoCompleteOnSubtasksDone:task.autoCompleteOnSubtasksDone??true,tags:[...(task.tags || [])],timeTracking:task.timeTracking||blankTracking(),actualHours:taskHours(task),waitingForType:waitingMatch?"contact":(task.waitingFor ? "legacy" : undefined),waitingForId:waitingMatch?.id||task.waitingForId||"",waitingFor:waitingMatch?.name||task.waitingFor||"",waitingReason:task.waitingReason||"",followUpDate:task.followUpDate||""}:blankTask());setNewSubtask("");setError("");}},[open,task,contacts]);
  const f=<K extends keyof Task>(k:K,v:Task[K])=>setForm(x=>({...x,[k]:v}));
  const patchSubtask=(id:string,patch:Partial<Task["subtasks"][number]>)=>setForm(x=>applySubtaskCompletion({...x,subtasks:sortedSubtasks(x).map(item=>item.id===id?{...item,...patch,updatedAt:new Date().toISOString()}:item)}));
  const moveSubtask=(id:string,delta:number)=>setForm(x=>{const items=sortedSubtasks(x);const index=items.findIndex(item=>item.id===id);const nextIndex=index+delta;if(index<0||nextIndex<0||nextIndex>=items.length)return x;const next=[...items];const [item]=next.splice(index,1);next.splice(nextIndex,0,item);return {...x,subtasks:next.map((entry,order)=>({...entry,order}))};});
  const deleteSubtask=(id:string)=>setForm(x=>applySubtaskCompletion({...x,subtasks:sortedSubtasks(x).filter(item=>item.id!==id).map((item,order)=>({...item,order}))}));
  const addSubtask=()=>{const title=newSubtask.trim();if(!title)return;setForm(x=>({...x,subtasks:[...sortedSubtasks(x),{id:uid("subtask"),title,done:false,order:x.subtasks.length,createdAt:todayISO()}]}));setNewSubtask("");};
  const save=()=>{const requester=findContact(contacts,form.requesterContactId);const createdBy=findContact(contacts,form.createdByContactId);const waiting=form.status==="Waiting"?findContact(contacts,form.waitingForId):undefined;if(form.status==="Waiting"&&!waiting){setError("请选择有效联系人");return}onSave(applySubtaskCompletion({...form,requesterContactId:requester?.id||"",requester:requester?.name||"",createdByContactId:createdBy?.id||"",createdBy:createdBy?.name||"",actualHours:taskHours(form),completedAt:form.status==="Done"?(form.completedAt||todayISO()):undefined,waitingForType:form.status==="Waiting"?"contact":undefined,waitingForId:form.status==="Waiting"?(waiting?.id||""):"",waitingFor:form.status==="Waiting"?(waiting?.name||""):"",waitingReason:form.status==="Waiting"?form.waitingReason:"",followUpDate:form.status==="Waiting"?form.followUpDate:""}));};
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
      <Field label="来源" helper="记录任务来源，支持自由输入。" tip="例如会议、客户、老板、项目群。"><input value={form.source} onChange={e=>f("source",e.target.value)} placeholder="例如：会议 / 邮件 / 项目群"/></Field>
      <ContactPicker label="提出人" contacts={contacts} selectedId={form.requesterContactId || ""} legacy={form.requester && !form.requesterContactId ? form.requester : ""} onSelect={id=>setForm(x=>({...x,requesterContactId:id,requester:contactName(contacts,id)}))} allowEmpty helper="必须从联系人表选择；旧文本只读显示，不再新写入。" />
      <ContactPicker label="创建人" contacts={contacts} selectedId={form.createdByContactId || ""} legacy={form.createdBy && !form.createdByContactId ? form.createdBy : ""} onSelect={id=>setForm(x=>({...x,createdByContactId:id,createdBy:contactName(contacts,id)}))} allowEmpty helper="可选。选择后保存联系人 ID。" />
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
      {form.status==="Waiting"&&<>
        <ContactPicker label="等待对象" contacts={contacts} selectedId={form.waitingForId || ""} legacy={form.waitingForType==="legacy" ? form.waitingFor || "" : ""} onSelect={id=>setForm(x=>({...x,waitingForType:"contact",waitingForId:id,waitingFor:contactName(contacts,id)}))} helper="等待对象只能从联系人表选择。" />
        <Field label="跟进日期" helper="到这个日期提醒自己主动跟进。"><input type="date" value={form.followUpDate||""} onChange={e=>f("followUpDate",e.target.value)}/></Field>
        <Field label="等待内容" wide helper="说明具体在等什么，避免等待事项变成普通待办。无固定格式。"><textarea value={form.waitingReason||""} onChange={e=>f("waitingReason",e.target.value)} placeholder="例如：等待对方确认新版埋点方案口径，确认后才能推进上线检查。"/></Field>
      </>}
    </div>
    {error&&<p className="form-error">{error}</p>}
    <div className="dialog-foot"><span>保存后会自动写入当前数据源</span><button className="primary" disabled={!form.title.trim()} onClick={save}><Save size={15}/> 保存任务</button></div>
  </BaseDialog>
}

function ContactPicker({label,contacts,selectedId,legacy,onSelect,helper,allowEmpty=false}:{label:string;contacts:Contact[];selectedId:string;legacy:string;onSelect:(id:string)=>void;helper?:string;allowEmpty?:boolean}) {
  const [query,setQuery]=useState("");
  const normalized=normalizeSearch(query);
  const selected = contacts.find(contact => contact.id === selectedId);
  const contactMatches=contacts.filter(contact=>fuzzyMatch(normalized,contactSearchValues(contact))).slice(0,12);
  return <div className="field wide contact-picker">
    <span>{label}</span>
    {helper&&<small className="field-helper">{helper}</small>}
    {selected&&<div className="contact-picker-selected">{selected.avatar?<img src={selected.avatar} alt=""/>:<span className="person-avatar">{selected.name.slice(0,1)}</span>}<div><strong>{selected.name}</strong><small>{[selected.role,selected.departmentName || selected.team,selected.email].filter(Boolean).join(" · ") || "联系人"}</small></div>{allowEmpty&&<button type="button" onClick={()=>onSelect("")}>清除</button>}</div>}
    <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索联系人姓名、邮箱或部门"/>
    {legacy && <p className="contact-picker-legacy">旧文本：{legacy}。请选择一个联系人完成结构化。</p>}
    <div className="contact-picker-list">
      {contactMatches.length ? <>
        {contactMatches.map(contact=><button type="button" className={cn("contact-picker-item",selectedId===contact.id&&"selected")} key={contact.id} onClick={()=>onSelect(contact.id)}>
          {contact.avatar?<img src={contact.avatar} alt=""/>:<span className="person-avatar">{contact.name.slice(0,1)}</span>}
          <div><strong>{contact.name}</strong><small>{[contact.role,contact.departmentName || contact.team,contact.email].filter(Boolean).join(" · ") || contactLabel(contact)}</small></div>
        </button>)}
      </> : <p className="meeting-notes">没有匹配联系人。请先同步飞书联系人。</p>}
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

function MeetingDialog({open,meeting,projects,onCreateProject,onOpenChange,onSave}:{open:boolean;meeting:Meeting|null;projects:Project[];onCreateProject:(p:Project)=>Project;onOpenChange:(o:boolean)=>void;onSave:(m:Meeting)=>void}) { const blank=():Meeting=>({id:uid("meeting"),title:"",date:`${todayISO()}T10:00`,durationMinutes:60,attendees:[],notes:"",decisions:[],actionItems:[],relatedProjectId:""});const [form,setForm]=useState<Meeting>(blank()),[actions,setActions]=useState("");useEffect(()=>{if(open){const m=meeting?{...meeting,durationMinutes:meeting.durationMinutes||0,attendees:[...meeting.attendees],decisions:[...meeting.decisions],actionItems:[...meeting.actionItems]}:blank();setForm(m);setActions(m.actionItems.map(a=>`${a.text} | ${a.owner} | ${a.dueDate}`).join("\n"))}},[open,meeting]);const f=<K extends keyof Meeting>(k:K,v:Meeting[K])=>setForm(x=>({...x,[k]:v}));const submit=()=>onSave({...form,actionItems:actions.split("\n").filter(Boolean).map((line,i)=>{const [text,owner,dueDate]=line.split("|").map(x=>x.trim());return form.actionItems[i]?.taskId?{id:form.actionItems[i].id,text,owner:owner||"我",dueDate:dueDate||todayISO(),taskId:form.actionItems[i].taskId}:{id:uid("action"),text,owner:owner||"我",dueDate:dueDate||todayISO()}})});return <BaseDialog open={open} onOpenChange={onOpenChange} title={meeting?"编辑会议":"新建会议"} subtitle="记录讨论、决策与可执行的行动项。" wide><div className="form-grid"><Field label="会议名称" wide><input autoFocus value={form.title} onChange={e=>f("title",e.target.value)}/></Field><Field label="日期与时间"><input type="datetime-local" value={form.date} onChange={e=>f("date",e.target.value)}/></Field><Field label="会议耗时（分钟）"><input type="number" min="0" step="5" value={form.durationMinutes||0} onChange={e=>f("durationMinutes",+e.target.value)}/></Field><ProjectSelect label="关联项目" value={form.relatedProjectId} projects={projects} onChange={v=>f("relatedProjectId",v)} onCreateProject={onCreateProject}/><Field label="参会人（逗号分隔）" wide><input value={form.attendees.join(", ")} onChange={e=>f("attendees",e.target.value.split(/[,，]/).map(x=>x.trim()).filter(Boolean))}/></Field><Field label="会议纪要" wide><textarea value={form.notes} onChange={e=>f("notes",e.target.value)}/></Field><Field label="决策事项（每行一条）" wide><textarea value={form.decisions.join("\n")} onChange={e=>f("decisions",e.target.value.split("\n").filter(Boolean))}/></Field><Field label="行动项（内容 | 负责人 | YYYY-MM-DD）" wide><textarea value={actions} onChange={e=>setActions(e.target.value)} placeholder="整理复盘材料 | 我 | 2026-06-25"/></Field></div><div className="dialog-foot"><span>保存后可一键生成任务</span><button className="primary" disabled={!form.title.trim()} onClick={submit}><Save size={15}/> 保存会议</button></div></BaseDialog> }

function MeetingDialogV2({open,meeting,data,onCreateProject,onOpenChange,onSave}:{open:boolean;meeting:Meeting|null;data:WorkData;onCreateProject:(p:Project)=>Project;onOpenChange:(o:boolean)=>void;onSave:(m:Meeting)=>void}) {
  const blank=():Meeting=>({id:uid("meeting"),title:"",startTime:`${todayISO()}T10:00`,date:`${todayISO()}T10:00`,endTime:`${todayISO()}T11:00`,durationMinutes:60,attendees:[],location:"",notes:"",decisions:[],actionItems:[],relatedProjectId:"",relatedTaskId:""});
  const [form,setForm]=useState<Meeting>(blank());
  const [actionsText,setActionsText]=useState("");
  const [actionRows,setActionRows]=useState<Meeting["actionItems"]>([]);
  const [error,setError]=useState("");
  useEffect(()=>{if(open){const event=meeting?toCalendarEvent(meeting):null;const base=meeting?{...meeting,startTime:event?formatLocalDateTime(event.localStart):"",date:event?formatLocalDateTime(event.localStart):(meeting.date || ""),endTime:event?formatLocalDateTime(event.localEnd):"",durationMinutes:event?.durationMinutes || 0,attendees:[...meeting.attendees],decisions:[...meeting.decisions],actionItems:[...meeting.actionItems]}:blank();setForm(base);setActionRows(base.actionItems);setActionsText(serializeMeetingActions(base.actionItems));setError("")}},[open,meeting]);
  const f=<K extends keyof Meeting>(k:K,v:Meeting[K])=>setForm(x=>({...x,[k]:v}));
  const setRows=(rows:Meeting["actionItems"])=>{setActionRows(rows);setActionsText(serializeMeetingActions(rows))};
  const setText=(text:string)=>{setActionsText(text);setActionRows(parseMeetingActions(text,actionRows))};
  const addContact=(id:string)=>{const c=data.contacts?.find(x=>x.id===id);if(c)f("attendees",uniqueNames([...form.attendees,c.name]))};
  const submit=()=>{const startTime=toDateTimeLocal(form.startTime || form.date),endTime=toDateTimeLocal(form.endTime);if(!startTime||!endTime){setError("请填写有效的开始和结束时间");return}if(isInvalidTimeRange(startTime,endTime)){setError("会议结束时间必须晚于开始时间");return}const durationMinutes=calculateDurationMinutes(startTime,endTime);onSave({...form,startTime,date:startTime,endTime,durationMinutes,rawPayload:{...rawObject(form.rawPayload),timeSource:"manual-form-v2"},attendees:uniqueNames(form.attendees),actionItems:actionRows.filter(a=>a.text.trim()).map(a=>({id:a.id||uid("action"),text:a.text.trim(),owner:a.owner?.trim()||"我",dueDate:a.dueDate||todayISO(),taskId:a.taskId}))})};
  const extract=()=>{const rows=extractActionsFromNotes(form.notes);if(!rows.length){alert("未识别到可执行行动项");return}setRows([...actionRows,...rows])};
  return <BaseDialog open={open} onOpenChange={onOpenChange} title={meeting?"编辑会议":"新建会议"} subtitle="记录讨论、决策与可执行的行动项。" wide>
    <div className="form-grid">
      <Field label="会议名称" wide helper="写清楚会议主题，会显示在会议中心、项目档案和报告中。" tip="例如：埋点方案评审 / 售后复盘会。"><input autoFocus value={form.title} onChange={e=>f("title",e.target.value)} placeholder="例如：新版埋点方案评审"/></Field>
      <Field label="开始时间" helper="用于会议日历时间轴、工作日志和报告统计。"><input type="datetime-local" value={toDateTimeLocal(form.startTime || form.date)} onChange={e=>{f("startTime",e.target.value);f("date",e.target.value);if(isInvalidTimeRange(e.target.value,form.endTime))f("endTime",addLocalMinutes(e.target.value,60));}}/></Field>
      <Field label="结束时间" helper="结束时间必须晚于开始时间，保存时自动计算会议时长。"><input type="datetime-local" value={toDateTimeLocal(form.endTime)} onChange={e=>f("endTime",e.target.value)}/></Field>
      <ProjectSelect label="关联项目" value={form.relatedProjectId} projects={data.projects} onChange={v=>f("relatedProjectId",v)} onCreateProject={onCreateProject}/>
      <Field label="关联任务" helper="可选。会议可以关联一个任务，但会议本身仍是独立时间实体。"><select value={form.relatedTaskId || ""} onChange={e=>f("relatedTaskId",e.target.value)}><option value="">不关联</option>{data.tasks.filter(t=>t.status!=="Inbox").map(t=><option key={t.id} value={t.id}>{t.title}</option>)}</select></Field>
      <Field label="地点" helper="会议室、线上链接或地点描述。"><input value={form.location || ""} onChange={e=>f("location",e.target.value)} placeholder="例如：飞书会议 / 3F 会议室"/></Field>
      <Field label="参与人" wide helper="参与人只从联系人表选择，不再手动输入自由文本。">
        <div className="attendee-tools">
          <select value="" onChange={e=>{addContact(e.target.value);e.currentTarget.value=""}}><option value="">选择联系人</option>{(data.contacts||[]).map(c=><option key={c.id} value={c.id}>{c.name}{c.team?` · ${c.team}`:""}</option>)}</select>
        </div>
        <div className="attendee-chips">{form.attendees.map(a=><span key={a}>{a}<button type="button" onClick={()=>f("attendees",form.attendees.filter(x=>x!==a))}>×</button></span>)}</div>
      </Field>
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
  const hours = tasks.reduce((s,t)=>s+t.actualHours,0);
  return <BaseDialog open={open} onOpenChange={o=>!o&&onClose()} title={project?.name||"项目档案"} subtitle="项目任务、会议、复盘和风险的统一上下文" wide>{project&&<><div className="detail-body"><div className="detail-kpis"><span>项目状态<b>{project.status}</b></span><span>整体进度<b>{progress.progress}%</b></span><span>任务完成<b>{progress.completed}/{progress.total}</b></span><span>已用工时<b>{hours.toFixed(1)}h</b></span></div><DetailSection title="背景与目标"><p><b>背景：</b>{project.background}</p><p><b>目标：</b>{project.goal}</p></DetailSection><DetailSection title="下一步与风险"><p><b>下一步：</b>{project.nextAction||"待补充"}</p>{project.risks.length?project.risks.map(x=><div className="risk-chip" key={x}>{x}</div>):<p>暂无风险</p>}</DetailSection><DetailSection title={`相关任务 · ${tasks.length}`}>{tasks.map(t=><button className="linked-row" key={t.id} onClick={()=>onTask(t)}><CheckCircle2 size={16}/><div><strong>{t.title}</strong><span>{t.status} · {hoursLabel(t.actualHours)}/{hoursLabel(t.estimatedHours)}</span></div><ArrowRight size={15}/></button>)}</DetailSection><DetailSection title={`相关会议 · ${meetings.length}`}>{meetings.map(m=><div className="linked-row" key={m.id}><CalendarDays size={16}/><div><strong>{m.title}</strong><span>{meetingTimeRange(m)} · {m.actionItems.length} 个行动项</span></div></div>)}</DetailSection><DetailSection title={`相关复盘 · ${refs.length}`}>{refs.map(r=><button className="linked-row" key={r.id} onClick={()=>onReflection(r)}><Brain size={16}/><div><strong>{r.title}</strong><span>{r.type} · {r.date}</span></div><ArrowRight size={15}/></button>)}</DetailSection></div><div className="dialog-foot"><button className="danger-link" onClick={()=>onDelete(project)}><Trash2 size={14}/> 删除项目</button><button className="primary" onClick={()=>onEdit(project)}>编辑项目</button></div></>}</BaseDialog>;
}
function ReflectionDetail({open,reflection,data,onClose,onEdit,onDelete}:{open:boolean;reflection:Reflection|null;data:WorkData;onClose:()=>void;onEdit:(r:Reflection)=>void;onDelete:(r:Reflection)=>void}) { const p=reflection?data.projects.find(x=>x.id===reflection.relatedProjectId):undefined,t=reflection?data.tasks.find(x=>x.id===reflection.relatedTaskId):undefined;return <BaseDialog open={open} onOpenChange={o=>!o&&onClose()} title={reflection?.title||"复盘详情"} subtitle="有依据的工作思考" wide>{reflection&&<><div className="detail-body"><div className="detail-kpis"><span>类型<b>{reflection.type}</b></span><span>日期<b>{reflection.date}</b></span><span>关联项目<b>{p?.name||"无"}</b></span><span>关联任务<b>{t?.title||"无"}</b></span></div><DetailSection title="复盘内容"><p className="reflection-content">{reflection.content}</p></DetailSection><DetailSection title="标签"><div className="tag-list">{reflection.tags.map(x=><span key={x}>{x}</span>)}</div></DetailSection></div><div className="dialog-foot"><button className="danger-link" onClick={()=>onDelete(reflection)}><Trash2 size={14}/> 删除</button><button className="primary" onClick={()=>onEdit(reflection)}>编辑复盘</button></div></>}</BaseDialog> }
function DetailSection({title,children}:{title:string;children:React.ReactNode}){return <section className="detail-section"><h3>{title}</h3>{children}</section>}
function SettingsDialog({open,onClose,data,mode,onCloudRefresh,onReset,notify}:{open:boolean;onClose:()=>void;data:WorkData;mode:RepositoryMode;onCloudRefresh:()=>Promise<void>;onReset:()=>void;notify:(s:string)=>void}) {
  const auth = useAuth();
  const [formatType,setFormatType]=useState<"markdown"|"csv"|"json">("markdown");
  const [authMode,setAuthMode]=useState<"login"|"signup">("login");
  const [email,setEmail]=useState("");
  const [password,setPassword]=useState("");
  const [busy,setBusy]=useState(false);
  const exportData=()=>{if(formatType==="markdown"){downloadText(buildMarkdownExport(data),`workos-export-${todayISO()}.md`,"text/markdown;charset=utf-8");notify("Markdown 工作记录已导出");return}if(formatType==="csv"){exportCsvFiles(data);notify("CSV 已按数据类型分别导出");return}downloadText(JSON.stringify(data,null,2),`workos-backup-${todayISO()}.json`,"application/json;charset=utf-8");notify("JSON 备份已导出")};
  const submitAuth=async()=>{if(!email.trim()||!password){notify("请填写邮箱和密码");return}setBusy(true);try{if(authMode==="login"){await auth.signIn(email.trim(),password);notify("登录成功，正在检查同步状态")}else{await auth.signUp(email.trim(),password);notify("注册成功，请根据 Supabase 邮箱确认设置完成登录")}setPassword("")}catch(error){console.error(error);notify(authMode==="login"?"登录失败，请检查账号密码":"注册失败，请检查邮箱或密码")}finally{setBusy(false)}};
  const logout=async()=>{setBusy(true);try{await auth.signOut();notify("已退出登录，当前回到本地模式")}catch(error){console.error(error);notify("退出失败，请稍后重试")}finally{setBusy(false)}};
  return <BaseDialog open={open} onOpenChange={o=>!o&&onClose()} title="工作空间设置" subtitle="本地模式可离线使用，登录后可开启云端同步。">
    <div className="settings-body">
      <div className="cloud-panel">
        <div>
          <strong>账号与同步</strong>
          <p>{auth.isCloudEnabled ? syncStatusLabel(auth.syncStatus, mode) : "Supabase 环境变量未配置，当前仅本地模式"}</p>
        </div>
        {auth.user ? <div className="account-card"><div className="avatar">{auth.user.email?.slice(0,1).toUpperCase() || "U"}</div><div><strong>{auth.user.email}</strong><span>{syncStatusLabel(auth.syncStatus, mode)}</span></div><button className="secondary" disabled={busy} onClick={logout}>退出登录</button></div> : <div className="auth-box">
          <div className="auth-tabs"><button className={cn(authMode==="login"&&"active")} onClick={()=>setAuthMode("login")}>登录</button><button className={cn(authMode==="signup"&&"active")} onClick={()=>setAuthMode("signup")}>注册</button></div>
          <Field label="邮箱"><input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" disabled={!auth.isCloudEnabled}/></Field>
          <Field label="密码"><input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="至少 6 位" disabled={!auth.isCloudEnabled}/></Field>
          <button className="primary" disabled={!auth.isCloudEnabled || busy} onClick={submitAuth}>{busy ? "处理中..." : authMode==="login" ? "登录并同步" : "注册账号"}</button>
          {auth.error && <p className="auth-error">{auth.error}</p>}
        </div>}
      </div>
      <FeishuIntegrationPanel open={open} mode={mode} onCloudRefresh={onCloudRefresh} notify={notify}/>
      <div><strong>{mode==="supabase"?"当前数据":"本地数据"}</strong><p>{data.tasks.length} 个任务 · {data.projects.length} 个项目 · {data.contacts?.length || 0} 个联系人 · {data.contactGroups?.length || 0} 个群组 · {data.reflections.length} 条复盘 · {data.reports.length} 份报告</p></div>
      <label className="export-format"><span>导出格式</span><select value={formatType} onChange={e=>setFormatType(e.target.value as "markdown"|"csv"|"json")}><option value="markdown">Markdown 工作记录（默认）</option><option value="csv">CSV 表格文件</option><option value="json">JSON 数据备份</option></select></label>
      <button className="secondary" onClick={exportData}><Download size={14}/> 导出数据</button>
      <button className="secondary danger" onClick={()=>{if(confirm(mode==="supabase"?"恢复演示数据？当前云端数据将被替换为演示数据，本地备份不会删除。":"恢复演示数据？当前本地修改将被覆盖。"))onReset()}}><Trash2 size={14}/> 恢复演示数据</button>
    </div>
    <div className="dialog-foot"><span>本地导出备份保留；登录不会删除本地数据</span><button className="primary" onClick={onClose}>完成</button></div>
  </BaseDialog>
}

function FeishuIntegrationPanel({open,mode,onCloudRefresh,notify}:{open:boolean;mode:RepositoryMode;onCloudRefresh:()=>Promise<void>;notify:(s:string)=>void}) {
  const auth = useAuth();
  const today = todayISO();
  const weekEnd = formatLocalDate(addDays(parseISO(today), 6));
  const [status,setStatus]=useState<{configured:boolean;cliConnected?:boolean;personalCalendarConnected?:boolean;personalCalendarName?:string|null;personalCalendarExpiresAt?:string|null;lastSyncedAt:string|null;stats?:{contacts:number;groups:number;groupMembers:number;meetings:number}}|null>(null);
  const [busy,setBusy]=useState(false);
  const [busyAction,setBusyAction]=useState<string>("");
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  const [warnings,setWarnings]=useState<string[]>([]);
  const [logs,setLogs]=useState<Array<{type:string;command:string;endpoint:string;url?:string;code?:number;msg?:string;itemsLength?:number;returnedCount:number;hasMore:boolean;pageTokenPresent:boolean;pageToken?:string;upsertCount?:number;error?:string;message?:string}>>([]);
  const [meetingStart,setMeetingStart]=useState(today);
  const [meetingEnd,setMeetingEnd]=useState(weekEnd);
  const headers = useMemo(() => auth.accessToken ? { Authorization: `Bearer ${auth.accessToken}` } : undefined, [auth.accessToken]);
  const getFreshHeaders = useCallback(async () => {
    const token = await auth.refreshSession();
    const accessToken = token || auth.accessToken;
    return accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined;
  }, [auth]);

  const loadStatus = useCallback(async (quiet = false) => {
    if (!auth.user || !headers) return;
    try {
      const freshHeaders = await getFreshHeaders();
      if (!freshHeaders) throw new Error("请先登录 WorkOS 后再同步飞书。");
      const response = await fetch("/api/integrations/feishu/status", { headers: freshHeaders });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "无法读取飞书集成状态");
      setStatus(json);
      if (!quiet) setError("");
    } catch (err) {
      if (!quiet) setError(err instanceof Error ? err.message : "无法读取飞书集成状态");
    }
  }, [auth.user, headers, getFreshHeaders]);

  useEffect(() => { if (open) loadStatus(true); }, [open, loadStatus]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const calendar = params.get("feishu_calendar");
    if (!calendar) return;
    setMessage(calendar === "connected" ? "飞书已连接" : params.get("message") || "飞书个人日历连接失败");
    setError(calendar === "error" ? params.get("message") || "飞书个人日历连接失败" : "");
    window.history.replaceState({}, "", window.location.pathname);
    if (calendar === "connected") loadStatus(true);
  }, [loadStatus]);

  const connectFeishuCalendar = async () => {
    if (!auth.user || !headers) { setError("请先登录 WorkOS 后再连接飞书个人日历。"); return; }
    setBusy(true); setBusyAction("connectCalendar"); setError(""); setMessage("正在打开飞书授权...");
    try {
      const freshHeaders = await getFreshHeaders();
      if (!freshHeaders) throw new Error("登录状态已失效，请重新登录后再试。");
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 8000);
      const response = await fetch("/api/integrations/feishu/oauth/connect", { method: "POST", headers: freshHeaders, signal: controller.signal });
      window.clearTimeout(timeout);
      const json = await response.json();
      if (!response.ok || !json.ok || !json.url) throw new Error(json.error || "无法发起飞书个人日历授权");
      window.location.href = json.url;
    } catch (err) {
      const text = err instanceof DOMException && err.name === "AbortError" ? "飞书授权地址生成超时，请检查线上环境变量和回调地址。" : err instanceof Error ? err.message : "无法发起飞书个人日历授权";
      setError(text);
      setMessage("");
      setBusy(false); setBusyAction("");
    }
  };

  const disconnectFeishuCalendar = async () => {
    if (!auth.user || !headers) return;
    setBusy(true); setBusyAction("disconnectCalendar"); setError(""); setMessage("");
    try {
      const freshHeaders = await getFreshHeaders();
      if (!freshHeaders) throw new Error("登录状态已失效，请重新登录后再试。");
      const response = await fetch("/api/integrations/feishu/oauth/disconnect", { method: "POST", headers: freshHeaders });
      const json = await response.json();
      if (!response.ok || !json.ok) throw new Error(json.error || "无法断开飞书个人日历");
      setStatus(prev => prev ? { ...prev, personalCalendarConnected: false, personalCalendarName: null, personalCalendarExpiresAt: null } : prev);
      setMessage("飞书个人日历已断开");
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法断开飞书个人日历");
    } finally {
      setBusy(false); setBusyAction("");
    }
  };

  const syncFeishu = async (action:"test"|"contacts"|"groups"|"members"|"meetings"|"all") => {
    if (!auth.user || !headers) { setError("请先登录 WorkOS 后再同步飞书。"); return; }
    if ((action === "meetings" || action === "all") && !status?.personalCalendarConnected) {
      setError("请先连接飞书个人日历，再同步会议。");
      return;
    }
    setBusy(true); setBusyAction(action); setError(""); setMessage("正在同步..."); setWarnings([]); setLogs([]);
    try {
      const freshHeaders = await getFreshHeaders();
      if (!freshHeaders) throw new Error("登录状态已失效，请重新登录后再试。");
      const response = await fetch("/api/integrations/feishu/sync", {
        method: "POST",
        headers: { ...freshHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ action, startDate: meetingStart, endDate: meetingEnd }),
      });
      const json = await response.json();
      setLogs(json.logs ?? []);
      setWarnings(json.warnings ?? []);
      if (!response.ok || !json.ok) throw new Error(json.error || "飞书同步失败");
      const stats=json.stats ?? {};
      setStatus(prev => ({ configured: true, cliConnected: true, lastSyncedAt: json.lastSyncedAt, stats: {
        contacts: stats.contactsImported ?? prev?.stats?.contacts ?? 0,
        groups: stats.groupsImported ?? prev?.stats?.groups ?? 0,
        groupMembers: stats.groupMembersImported ?? prev?.stats?.groupMembers ?? 0,
        meetings: stats.meetingsImported ?? prev?.stats?.meetings ?? 0,
      }}));
      const result = action==="test"
        ? "飞书连接测试成功"
        : `已同步 ${stats.contactsImported ?? 0} 个联系人、${stats.groupsImported ?? 0} 个群组、${stats.groupMembersImported ?? 0} 条群成员关系、${stats.meetingsImported ?? 0} 场会议`;
      setMessage(result);
      notify(`飞书同步完成：${result}`);
      if (action !== "test") {
        try {
          await onCloudRefresh();
        } catch (refreshError) {
          setWarnings(prev => [...prev, refreshError instanceof Error ? `同步已完成，但刷新当前页面数据失败：${refreshError.message}` : "同步已完成，但刷新当前页面数据失败。"]);
        }
      }
      await loadStatus(true);
    } catch (err) {
      const rawText = err instanceof Error ? err.message : "飞书同步失败";
      const text = /failed to fetch|fetch failed|timeout|network/i.test(rawText)
        ? "暂时无法连接云端数据库，请检查网络或稍后重试。"
        : rawText;
      setError(text);
      setMessage("");
      notify(`飞书同步失败：${text}`);
    } finally {
      setBusy(false); setBusyAction("");
    }
  };

  const lastSynced = status?.lastSyncedAt ? format(new Date(status.lastSyncedAt), "yyyy-MM-dd HH:mm") : "尚未同步";
  const stats = status?.stats;
  const buttonText = (action:string,label:string) => busy && busyAction===action ? "处理中..." : label;
  return <div className="integration-panel">
    <div className="integration-panel-head">
      <div>
        <strong>集成设置 · 飞书组织同步</strong>
        <p>从飞书组织通讯录、群聊、群成员和日历会议导入 WorkOS，导入后可直接用于会议参会人选择。</p>
      </div>
      <div className="integration-status">
        <span className={status?.configured ? "ok" : "warn"}>{status?.configured ? "已配置" : "未配置"}</span>
        <span>{mode==="supabase" ? "云端模式" : "需登录云端"}</span>
        <span className={status?.personalCalendarConnected ? "ok" : "warn"}>{status?.personalCalendarConnected ? "个人日历已连接" : "个人日历未连接"}</span>
      </div>
    </div>
    <div className="integration-meta">
      <span>最近同步：{lastSynced}</span>
      <span>通讯录来源：飞书企业自建应用</span>
      <span>会议来源：飞书个人 OAuth{status?.personalCalendarName ? ` · ${status.personalCalendarName}` : ""}</span>
    </div>
    {stats && <div className="integration-stats">
      <span>联系人 {stats.contacts}</span>
      <span>群组 {stats.groups}</span>
      <span>群成员关系 {stats.groupMembers}</span>
      <span>会议 {stats.meetings}</span>
    </div>}
    <div className="feishu-meeting-range">
      <label><span>会议开始</span><input type="date" value={meetingStart} onChange={e=>setMeetingStart(e.target.value)}/></label>
      <label><span>会议结束</span><input type="date" value={meetingEnd} onChange={e=>setMeetingEnd(e.target.value)}/></label>
    </div>
    <div className="integration-actions">
      <button className="secondary" disabled={busy || mode!=="supabase" || !auth.user} onClick={()=>syncFeishu("test")}>{buttonText("test","测试飞书连接")}</button>
      <button className="secondary" disabled={busy || mode!=="supabase" || !auth.user} onClick={()=>syncFeishu("contacts")}>{buttonText("contacts","同步联系人")}</button>
      <button className="secondary" disabled={busy || mode!=="supabase" || !auth.user} onClick={()=>syncFeishu("groups")}>{buttonText("groups","同步群组")}</button>
      <button className="secondary" disabled={busy || mode!=="supabase" || !auth.user} onClick={()=>syncFeishu("members")}>{buttonText("members","同步群成员")}</button>
      <button className="secondary" disabled={busy || mode!=="supabase" || !auth.user || !status?.personalCalendarConnected} onClick={()=>syncFeishu("meetings")}>{buttonText("meetings","同步会议")}</button>
      <button className="secondary" disabled={busy || mode!=="supabase" || !auth.user} onClick={status?.personalCalendarConnected ? disconnectFeishuCalendar : connectFeishuCalendar}>{status?.personalCalendarConnected ? buttonText("disconnectCalendar","断开个人日历") : buttonText("connectCalendar","连接个人日历")}</button>
      <button className="primary" disabled={busy || mode!=="supabase" || !auth.user || !status?.personalCalendarConnected} onClick={()=>syncFeishu("all")}>{buttonText("all","一键同步全部")}</button>
    </div>
    {!auth.user && <p className="integration-hint">请先登录 WorkOS，再同步飞书联系人。</p>}
    {status && !status.configured && <p className="integration-hint">请在服务端环境变量中配置 FEISHU_APP_ID 和 FEISHU_APP_SECRET。</p>}
    {status && !status.personalCalendarConnected && <p className="integration-hint">线上同步会议前，需要先连接飞书个人日历；通讯录同步仍使用企业自建应用权限。</p>}
    {message && <p className="integration-result ok">{message}</p>}
    {warnings.map((warning,index)=><p className="integration-result warn" key={index}>{warning}</p>)}
    {error && <p className="integration-result error">同步失败：{error}</p>}
    {!!logs.length && <details className="integration-logs">
      <summary>同步日志（{logs.length} 条）</summary>
      <div>
        {logs.slice(-120).map((log,index)=><p key={`${log.command}-${index}`}>
          <strong>{log.type}</strong> · {log.command} · URL: {log.url || log.endpoint} · code: {log.code ?? "-"} · msg: {log.msg || "-"} · items.length: {log.itemsLength ?? log.returnedCount} · has_more: {String(log.hasMore)} · page_token: {log.pageToken || (log.pageTokenPresent ? "有" : "无")}{log.upsertCount!==undefined ? ` · upsert ${log.upsertCount}` : ""}{log.error ? ` · 错误：${log.error}` : ""}
        </p>)}
      </div>
    </details>}
  </div>;
}

function LocalImportDialog({open,data,onImport,onLater,onCloudOnly}:{open:boolean;data:WorkData;onImport:()=>Promise<void>;onLater:()=>void;onCloudOnly:()=>Promise<void>}) {
  const [busy,setBusy]=useState<"import"|"cloud"|null>(null);
  const hasData = !isEmptyWorkData(data);
  const run=async(kind:"import"|"cloud",fn:()=>Promise<void>)=>{setBusy(kind);try{await fn()}finally{setBusy(null)}};
  return <BaseDialog open={open && hasData} onOpenChange={o=>!o&&onLater()} title="检测到本地工作数据" subtitle="你可以导入云端，多设备同步；本地数据会继续保留。">
    <div className="settings-body">
      <div className="migration-card"><Sparkles size={18}/><div><strong>是否导入云端？</strong><p>将导入 {data.tasks.length} 个任务、{data.projects.length} 个项目、{data.meetings.length} 场会议、{data.contacts?.length || 0} 个联系人、{data.contactGroups?.length || 0} 个群组、{data.reflections.length} 条复盘和 {data.reports.length} 份报告。</p></div></div>
      <div className="migration-checks"><span>✓ 多设备同步</span><span>✓ 本地数据保留</span><span>✓ 可继续导出备份</span></div>
    </div>
    <div className="dialog-foot"><button className="ghost" disabled={!!busy} onClick={onLater}>稍后再说</button><div><button className="secondary" disabled={!!busy} onClick={()=>run("cloud",onCloudOnly)}>{busy==="cloud"?"读取中...":"仅使用云端数据"}</button><button className="primary" disabled={!!busy} onClick={()=>run("import",onImport)}>{busy==="import"?"导入中...":"导入云端"}</button></div></div>
  </BaseDialog>
}
