"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Archive, ArrowRight, BarChart3, Bell, BookOpen, Brain, CalendarDays, Check, CheckCircle2,
  ChevronDown, Circle, Clipboard, Clock3, Download, FileText, FolderKanban, Inbox, LayoutDashboard,
  ListTodo, MessageSquareMore, MoreHorizontal, Pause, Play, Plus, Save, Search, Settings, Sparkles,
  Target, Timer, Trash2, Users, X, Zap,
} from "lucide-react";
import { addDays, addWeeks, endOfMonth, endOfQuarter, endOfWeek, format, isBefore, parseISO, startOfMonth, startOfQuarter, startOfWeek, subDays } from "date-fns";
import { zhCN } from "date-fns/locale";
import { cn, hoursLabel, todayISO, uid } from "@/lib/utils";
import { Meeting, Priority, Project, ProjectStatus, Reflection, ReflectionType, Report, ReportOptions, ReportType, Task, TaskStatus, WorkData } from "@/lib/types";
import { seedData } from "@/lib/seed";
import { hasLocalWorkData, localWorkDataRepository } from "@/lib/storage";
import { generateReportContent } from "@/lib/report";
import { useAuth } from "@/lib/auth/auth-context";
import { createWorkDataRepository } from "@/repositories/workDataRepository";
import { RepositoryMode } from "@/repositories/work-data-repository";

type View = "today" | "inbox" | "tasks" | "projects" | "meetings" | "log" | "weekly" | "reports" | "analytics" | "workAnalytics" | "waiting" | "thinking";
type Modal = "capture" | "task" | "project" | "meeting" | "reflection" | "settings" | null;

const nav: { group: string; items: { id: View; label: string; icon: typeof Inbox }[] }[] = [
  { group: "工作台", items: [{ id: "today", label: "今日概览", icon: LayoutDashboard }, { id: "inbox", label: "收集箱", icon: Inbox }, { id: "tasks", label: "任务中心", icon: ListTodo }, { id: "projects", label: "项目中心", icon: FolderKanban }] },
  { group: "工作记忆", items: [{ id: "meetings", label: "会议中心", icon: CalendarDays }, { id: "log", label: "工作日志", icon: BookOpen }, { id: "weekly", label: "每周复盘", icon: FileText }, { id: "reports", label: "报告中心", icon: Clipboard }] },
  { group: "洞察", items: [{ id: "analytics", label: "工时分析", icon: BarChart3 }, { id: "workAnalytics", label: "工作分析中心", icon: Sparkles }, { id: "waiting", label: "等待看板", icon: Clock3 }, { id: "thinking", label: "思考空间", icon: Brain }] },
];
const viewMeta: Record<View, { title: string; subtitle: string }> = {
  today: { title: "早上好，专注于重要的事", subtitle: "这是你的工作记忆，而不只是任务清单。" }, inbox: { title: "收集箱", subtitle: "先记录，稍后再决定如何处理。" },
  tasks: { title: "任务中心", subtitle: "让所有承诺都可见、可追踪。" }, projects: { title: "项目中心", subtitle: "项目不是标签，而是一份持续生长的工作档案。" },
  meetings: { title: "会议中心", subtitle: "把讨论变成决策，把决策变成行动。" }, log: { title: "工作日志", subtitle: "每天做过什么，由系统替你记住。" },
  weekly: { title: "每周复盘", subtitle: "从真实工作记录中生成，而不是靠回忆拼凑。" }, reports: { title: "报告中心", subtitle: "将任务、项目与复盘组织成有逻辑的工作报告。" },
  analytics: { title: "工时分析", subtitle: "认识自己的工作节奏，让预估越来越准。" }, workAnalytics: { title: "工作分析中心", subtitle: "从周、月和项目维度看清时间、产出与风险。" }, waiting: { title: "等待看板", subtitle: "你的工作停在哪里，一眼看清。" },
  thinking: { title: "思考空间", subtitle: "让复盘回到它所发生的项目和任务中。" },
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
const taskSearchFields = (task: Task, data: WorkData) => [task.title, task.description, task.tags, projectName(data.projects, task.projectId), task.requester, task.source, task.notes, task.waitingFor, task.status, task.priority];
const projectSearchFields = (project: Project, data: WorkData) => [project.name, project.type, project.background, project.goal, project.status, project.priority, project.risks, project.nextAction, data.tasks.filter(t => t.projectId === project.id).map(t => [t.title, t.description, t.requester, t.source, t.tags])];
const meetingSearchFields = (meeting: Meeting, data: WorkData) => [meeting.title, meeting.notes, meeting.attendees, meeting.decisions, meeting.actionItems.map(a => [a.text, a.owner]), projectName(data.projects, meeting.relatedProjectId)];
const reflectionSearchFields = (reflection: Reflection, data: WorkData) => [reflection.title, reflection.content, reflection.type, reflection.tags, projectName(data.projects, reflection.relatedProjectId), data.tasks.find(t => t.id === reflection.relatedTaskId)?.title];
const reportSearchFields = (report: Report) => [report.title, report.type, report.startDate, report.endDate, report.generatedContent];
const dateOnly = (value: string | Date) => typeof value === "string" ? value.slice(0, 10) : format(value, "yyyy-MM-dd");
const inDateRange = (date: string | undefined, start: string, end: string) => !!date && date.slice(0, 10) >= start && date.slice(0, 10) <= end;
const daysBetween = (start: string, end: string) => Math.max(1, Math.round((parseISO(end).getTime() - parseISO(start).getTime()) / 86400000) + 1);
const runningSeconds = (task: Task) => task.timeTracking?.isRunning && task.timeTracking.startedAt ? Math.max(0, Math.floor((Date.now() - new Date(task.timeTracking.startedAt).getTime()) / 1000)) : 0;
const taskSeconds = (task: Task) => (task.timeTracking?.accumulatedSeconds ?? Math.round((task.actualHours || 0) * 3600)) + runningSeconds(task);
const taskHours = (task: Task) => taskSeconds(task) / 3600;
const taskLoggedDate = (task: Task) => task.completedAt || task.timeTracking?.lastPausedAt?.slice(0, 10) || task.createdAt;
const durationLabel = (seconds: number) => {
  const safe = Math.max(0, Math.floor(seconds));
  const h = Math.floor(safe / 3600), m = Math.floor((safe % 3600) / 60), s = safe % 60;
  return [h, m, s].map(v => String(v).padStart(2, "0")).join(":");
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
const buildMarkdownExport = (data: WorkData) => {
  const taskRows = data.tasks.map(t => `| ${mdCell(t.createdAt)} | ${mdCell(t.title)} | ${mdCell(projectName(data.projects,t.projectId))} | ${mdCell(t.status)} | ${mdCell(t.priority)} | ${mdCell(t.estimatedHours)} | ${mdCell(taskHours(t).toFixed(2))} | ${mdCell(t.requester)} |`);
  const projectRows = data.projects.map(p => `| ${mdCell(p.name)} | ${mdCell(p.status)} | ${mdCell(`${p.progress}%`)} | ${mdCell(p.priority)} | ${mdCell(p.dueDate)} |`);
  const meetingRows = data.meetings.map(m => `| ${mdCell(m.date.slice(0,10))} | ${mdCell(m.title)} | ${mdCell(projectName(data.projects,m.relatedProjectId))} | ${mdCell(m.durationMinutes ? `${m.durationMinutes} 分钟` : "未记录")} | ${mdCell(m.actionItems.map(a=>`${a.text}（${a.owner}）`).join("；"))} |`);
  const reflectionRows = data.reflections.map(r => `| ${mdCell(r.date)} | ${mdCell(r.title)} | ${mdCell(r.type)} | ${mdCell(projectName(data.projects,r.relatedProjectId))} | ${mdCell(data.tasks.find(t=>t.id===r.relatedTaskId)?.title||"未关联任务")} |`);
  return ["# 工作记录导出", "", "导出时间：", todayISO(), "", "## 任务记录", "", "| 日期 | 任务 | 项目 | 状态 | 优先级 | 预估工时 | 实际工时 | 提出人 |", "|---|---|---|---|---|---|---|---|", ...taskRows, "", "## 项目记录", "", "| 项目 | 状态 | 进度 | 优先级 | 截止时间 |", "|---|---|---|---|---|", ...projectRows, "", "## 会议记录", "", "| 日期 | 会议 | 关联项目 | 会议耗时 | Action Items |", "|---|---|---|---|---|", ...meetingRows, "", "## 复盘思考", "", "| 日期 | 标题 | 类型 | 关联项目 | 关联任务 |", "|---|---|---|---|---|", ...reflectionRows, ""].join("\n");
};
const exportCsvFiles = (data: WorkData) => {
  downloadText(csv([["日期","任务","项目","状态","优先级","预估工时","实际工时","提出人","来源","标签"], ...data.tasks.map(t=>[t.createdAt,t.title,projectName(data.projects,t.projectId),t.status,t.priority,t.estimatedHours,taskHours(t).toFixed(2),t.requester,t.source,t.tags.join("；")])]), `workos-tasks-${todayISO()}.csv`, "text/csv;charset=utf-8");
  downloadText(csv([["项目","类型","状态","进度","优先级","开始日期","截止时间","目标"], ...data.projects.map(p=>[p.name,p.type,p.status,`${p.progress}%`,p.priority,p.startDate,p.dueDate,p.goal])]), `workos-projects-${todayISO()}.csv`, "text/csv;charset=utf-8");
  downloadText(csv([["日期","会议","关联项目","会议耗时分钟","参会人","会议纪要","决策事项","Action Items"], ...data.meetings.map(m=>[m.date, m.title, projectName(data.projects,m.relatedProjectId), m.durationMinutes || 0, m.attendees.join("；"), m.notes, m.decisions.join("；"), m.actionItems.map(a=>`${a.text} / ${a.owner} / ${a.dueDate}`).join("；")])]), `workos-meetings-${todayISO()}.csv`, "text/csv;charset=utf-8");
  downloadText(csv([["日期","标题","类型","关联项目","关联任务","复盘耗时分钟","标签","内容"], ...data.reflections.map(r=>[r.date,r.title,r.type,projectName(data.projects,r.relatedProjectId),data.tasks.find(t=>t.id===r.relatedTaskId)?.title||"",r.durationMinutes || 0,r.tags.join("；"),r.content])]), `workos-reflections-${todayISO()}.csv`, "text/csv;charset=utf-8");
};
const withActualFromTracking = (task: Task): Task => ({ ...task, actualHours: taskSeconds(task) / 3600 });
const blankProject = (): Project => ({ id: uid("project"), name: "", type: "业务项目", background: "", goal: "", status: "Planning", priority: "P1", progress: 0, startDate: todayISO(), dueDate: addDays(new Date(), 30).toISOString().slice(0, 10), relatedTaskIds: [], risks: [], nextAction: "" });
const blankTracking = () => ({ isRunning: false, startedAt: null, accumulatedSeconds: 0, lastPausedAt: null, sessions: [] });
type AnalyticsEvent = { id: string; kind: "任务" | "会议" | "复盘"; title: string; projectId: string; date: string; startHour: number; durationSeconds: number; task?: Task; color: string };
const analyticsEvents = (data: WorkData, start: string, end: string): AnalyticsEvent[] => {
  const taskEvents = data.tasks.flatMap(task => {
    const sessions = task.timeTracking?.sessions || [];
    const realSessions = sessions.filter(s => inDateRange(s.startTime, start, end)).map((s, i) => ({ id: `${task.id}-s-${i}`, kind: "任务" as const, title: task.title, projectId: task.projectId, date: s.startTime.slice(0, 10), startHour: new Date(s.startTime).getHours() + new Date(s.startTime).getMinutes() / 60, durationSeconds: s.durationSeconds, task, color: "#5b7cfa" }));
    const running = task.timeTracking?.isRunning && task.timeTracking.startedAt && inDateRange(task.timeTracking.startedAt, start, end) ? [{ id: `${task.id}-running`, kind: "任务" as const, title: task.title, projectId: task.projectId, date: task.timeTracking.startedAt.slice(0, 10), startHour: new Date(task.timeTracking.startedAt).getHours() + new Date(task.timeTracking.startedAt).getMinutes() / 60, durationSeconds: runningSeconds(task), task, color: "#5b7cfa" }] : [];
    return [...realSessions, ...running];
  });
  const meetingEvents = data.meetings.filter(m => inDateRange(m.date, start, end) && (m.durationMinutes || 0) > 0).map(m => ({ id: m.id, kind: "会议" as const, title: m.title, projectId: m.relatedProjectId, date: m.date.slice(0, 10), startHour: new Date(m.date).getHours() + new Date(m.date).getMinutes() / 60, durationSeconds: (m.durationMinutes || 0) * 60, color: "#8a63d2" }));
  const reflectionEvents = data.reflections.filter(r => inDateRange(r.date, start, end) && (r.durationMinutes || 0) > 0).map(r => ({ id: r.id, kind: "复盘" as const, title: r.title, projectId: r.relatedProjectId, date: r.date, startHour: 17, durationSeconds: (r.durationMinutes || 0) * 60, color: "#e86cae" }));
  return [...taskEvents, ...meetingEvents, ...reflectionEvents].filter(e => e.durationSeconds > 0);
};
const rangeStats = (data: WorkData, start: string, end: string) => {
  const tasks = data.tasks.filter(t => inDateRange(t.createdAt, start, end) || inDateRange(t.completedAt, start, end) || inDateRange(taskLoggedDate(t), start, end));
  const completed = data.tasks.filter(t => t.status === "Done" && inDateRange(t.completedAt, start, end));
  const overdue = data.tasks.filter(t => t.status !== "Done" && !!t.dueDate && t.dueDate < end);
  const waiting = data.tasks.filter(t => t.status === "Waiting");
  const meetings = data.meetings.filter(m => inDateRange(m.date, start, end));
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
const isEmptyWorkData = (data: WorkData) => !data.tasks.length && !data.projects.length && !data.meetings.length && !data.reflections.length && !data.reports.length;
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

  const remindLater = () => setShowImportPrompt(false);

  return { data, setData, mode, ready, showImportPrompt, importLocalToCloud, useCloudOnly, remindLater } as const;
}

export function WorkOS() {
  const auth = useAuth();
  const { data, setData, mode, showImportPrompt, importLocalToCloud, useCloudOnly, remindLater } = useWorkData();
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
  const [, setClock] = useState(0);
  const [toast, setToast] = useState("");
  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 2400); };

  useEffect(() => {
    const listener = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setModal("capture"); } };
    window.addEventListener("keydown", listener); return () => window.removeEventListener("keydown", listener);
  }, []);
  useEffect(() => { const id = window.setInterval(() => setClock(v => v + 1), 1000); return () => window.clearInterval(id); }, []);

  const saveTask = (task: Task) => setData(d => {
    task = { ...task, actualHours: taskSeconds(task) / 3600 };
    const exists = d.tasks.some(t => t.id === task.id);
    const tasks = exists ? d.tasks.map(t => t.id === task.id ? task : t) : [task, ...d.tasks];
    const projects = d.projects.map(p => ({ ...p, relatedTaskIds: tasks.filter(t => t.projectId === p.id).map(t => t.id) }));
    return { ...d, tasks, projects };
  });
  const deleteTask = (id: string) => setData(d => ({ ...d, tasks: d.tasks.filter(t => t.id !== id), projects: d.projects.map(p => ({ ...p, relatedTaskIds: p.relatedTaskIds.filter(x => x !== id) })), reflections: d.reflections.map(r => r.relatedTaskId === id ? { ...r, relatedTaskId: "" } : r) }));
  const updateTask = (id: string, patch: Partial<Task>) => setData(d => ({ ...d, tasks: d.tasks.map(t => t.id === id ? { ...t, ...patch } : t) }));
  const pauseRunningTask = (task: Task, now = new Date()) => {
    const start = task.timeTracking?.startedAt ? new Date(task.timeTracking.startedAt) : now;
    const durationSeconds = Math.max(0, Math.floor((now.getTime() - start.getTime()) / 1000));
    const accumulatedSeconds = (task.timeTracking?.accumulatedSeconds || 0) + durationSeconds;
    return {
      ...task,
      actualHours: accumulatedSeconds / 3600,
      timeTracking: {
        ...(task.timeTracking || blankTracking()),
        isRunning: false,
        startedAt: null,
        accumulatedSeconds,
        lastPausedAt: now.toISOString(),
        sessions: durationSeconds ? [...(task.timeTracking?.sessions || []), { startTime: start.toISOString(), endTime: now.toISOString(), durationSeconds }] : (task.timeTracking?.sessions || []),
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
    const now = new Date();
    setData(d => ({ ...d, tasks: d.tasks.map(t => {
      if (running && t.id === running.id) return pauseRunningTask(t, now);
      if (t.id === task.id) return { ...t, status: t.status === "Done" ? t.status : "Doing", timeTracking: { ...(t.timeTracking || blankTracking()), isRunning: true, startedAt: now.toISOString(), lastPausedAt: null }, actualHours: taskHours(t) };
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
  const saveProject = (p: Project) => setData(d => ({ ...d, projects: d.projects.some(x => x.id === p.id) ? d.projects.map(x => x.id === p.id ? p : x) : [p, ...d.projects] }));
  const createProject = (p: Project) => { saveProject(p); notify(`项目已创建：${p.name}`); return p; };
  const deleteProject = (id: string) => setData(d => ({ ...d, projects: d.projects.filter(p => p.id !== id), tasks: d.tasks.map(t => t.projectId === id ? { ...t, projectId: "" } : t), meetings: d.meetings.map(m => m.relatedProjectId === id ? { ...m, relatedProjectId: "" } : m), reflections: d.reflections.map(r => r.relatedProjectId === id ? { ...r, relatedProjectId: "" } : r) }));
  const saveMeeting = (m: Meeting) => setData(d => ({ ...d, meetings: d.meetings.some(x => x.id === m.id) ? d.meetings.map(x => x.id === m.id ? m : x) : [m, ...d.meetings] }));
  const saveReflection = (r: Reflection) => setData(d => ({ ...d, reflections: d.reflections.some(x => x.id === r.id) ? d.reflections.map(x => x.id === r.id ? r : x) : [r, ...d.reflections] }));
  const openTask = (task?: Task) => { setEditingTask(task || null); setModal("task"); };
  const openProject = (p?: Project) => { setEditingProject(p || null); setModal("project"); };
  const openMeeting = (m?: Meeting) => { setEditingMeeting(m || null); setModal("meeting"); };
  const openReflection = (r?: Reflection) => { setEditingReflection(r || null); setModal("reflection"); };
  const openPrimary = () => view === "meetings" ? openMeeting() : view === "thinking" ? openReflection() : view === "projects" ? openProject() : view === "inbox" ? setModal("capture") : view === "reports" ? notify("请在下方选择报告范围后生成") : view === "workAnalytics" ? notify("请在分析中心内切换周期或时间范围") : openTask();
  const primaryLabel = view === "meetings" ? "新建会议" : view === "thinking" ? "记录复盘" : view === "projects" ? "新建项目" : view === "inbox" ? "快速记录" : view === "reports" ? "生成报告" : view === "workAnalytics" ? "调整分析" : "新建任务";

  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><div className="brand-mark"><Zap size={17} fill="currentColor" /></div><span>WorkOS</span><span className="version">PERSONAL</span></div>
      <button className="quick-capture" onClick={() => setModal("capture")}><Plus size={16} /> 快速记录 <kbd>⌘ K</kbd></button>
      <nav className="nav-wrap">{nav.map(s => <div className="nav-section" key={s.group}><div className="nav-label">{s.group}</div>{s.items.map(item => { const Icon = item.icon; const count = item.id === "inbox" ? data.tasks.filter(t => t.status === "Inbox").length : item.id === "waiting" ? data.tasks.filter(t => t.status === "Waiting").length : 0; return <button key={item.id} className={cn("nav-item", view === item.id && "active")} onClick={() => setView(item.id)}><Icon size={17} /><span>{item.label}</span>{count > 0 && <b>{count}</b>}</button> })}</div>)}</nav>
      <div className="sidebar-footer"><div className="memory-status"><div className="memory-title"><span><Sparkles size={14} /> 工作记忆</span><b>{Math.min(100, data.tasks.length * 5 + data.reflections.length * 7)}%</b></div><div className="progress"><i style={{ width: `${Math.min(100, data.tasks.length * 5 + data.reflections.length * 7)}%` }} /></div><p>已沉淀 {data.tasks.length + data.meetings.length + data.reflections.length} 条记录</p></div><button className="profile" onClick={() => setModal("settings")}><div className="avatar">{auth.user?.email?.slice(0,1).toUpperCase() || "U"}</div><div><strong>{auth.user?.email || "我的工作空间"}</strong><span>{syncStatusLabel(auth.syncStatus, mode)}</span></div><MoreHorizontal size={18} /></button></div>
    </aside>
    <main className="main"><header className="topbar"><div className="search"><Search size={16} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索任务、项目、会议、复盘..." /><kbd>⌘ /</kbd></div><div className="top-actions"><button className="icon-button" aria-label="通知" onClick={() => notify("当前没有新的提醒")}><Bell size={18} /></button><button className="icon-button" aria-label="设置" onClick={() => setModal("settings")}><Settings size={18} /></button><div className="today-pill"><CalendarDays size={15} />{format(new Date(), "M月d日 EEEE", { locale: zhCN })}</div></div></header>
      <div className="page"><div className="page-head"><div><h1>{viewMeta[view].title}</h1><p>{viewMeta[view].subtitle}</p></div><button className="primary" onClick={openPrimary}><Plus size={16} />{primaryLabel}</button></div>
        {search.trim() ? <GlobalSearchResults data={data} query={search} onTask={setDetailTask} onProject={setDetailProject} onReflection={setDetailReflection} onView={setView} /> : <>
          {view === "today" && <Dashboard data={data} setView={setView} onTask={setDetailTask} />}
          {view === "inbox" && <InboxView data={data} updateTask={updateTask} deleteTask={deleteTask} query={search} notify={notify} />}
          {view === "tasks" && <TaskCenter data={data} query={search} updateTask={updateTask} onOpen={setDetailTask} onAdd={openTask} onComplete={completeTask} onStartTimer={startTimer} onPauseTimer={pauseTimer} onStopTimer={stopTimer} />}
          {view === "projects" && <ProjectCenter data={data} query={search} onOpen={setDetailProject} onEdit={openProject} onAdd={openProject} />}
          {view === "meetings" && <MeetingCenter data={data} setData={setData} query={search} onEdit={openMeeting} onTask={setDetailTask} onDelete={m => { if (confirm(`删除会议“${m.title}”？`)) { setData(d => ({ ...d, meetings: d.meetings.filter(x => x.id !== m.id) })); notify("会议已删除"); } }} />}
          {view === "log" && <WorkLog data={data} onTask={setDetailTask} />}
          {view === "weekly" && <WeeklyReview data={data} setData={setData} setView={setView} notify={notify} />}
          {view === "reports" && <ReportCenter data={data} setData={setData} query={search} notify={notify} />}
          {view === "analytics" && <Analytics data={data} />}
          {view === "workAnalytics" && <WorkAnalytics data={data} onTask={setDetailTask} />}
          {view === "waiting" && <WaitingDashboard data={data} updateTask={updateTask} onTask={setDetailTask} />}
          {view === "thinking" && <ThinkingSpace data={data} query={search} onOpen={setDetailReflection} onAdd={openReflection} />}
        </>}
      </div>
    </main>
    <CaptureDialog open={modal === "capture"} onOpenChange={o => !o && setModal(null)} onAdd={saveTask} />
    <TaskDialog open={modal === "task"} task={editingTask} projects={data.projects} onCreateProject={createProject} onOpenChange={o => !o && setModal(null)} onSave={t => { saveTask(t); setModal(null); notify(editingTask ? "任务已更新" : "任务已创建"); }} />
    <ProjectDialog open={modal === "project"} project={editingProject} onOpenChange={o => !o && setModal(null)} onSave={p => { saveProject(p); setModal(null); notify(editingProject ? "项目已更新" : "项目已创建"); }} />
    <MeetingDialog open={modal === "meeting"} meeting={editingMeeting} projects={data.projects} onCreateProject={createProject} onOpenChange={o => !o && setModal(null)} onSave={m => { saveMeeting(m); setModal(null); notify(editingMeeting ? "会议已更新" : "会议已创建"); }} />
    <ReflectionDialog open={modal === "reflection"} reflection={editingReflection} data={data} onCreateProject={createProject} onOpenChange={o => !o && setModal(null)} onSave={r => { saveReflection(r); setModal(null); notify(editingReflection ? "复盘已更新" : "复盘已记录"); }} />
    <TaskDetail open={!!detailTask} task={detailTask && data.tasks.find(t => t.id === detailTask.id) || null} data={data} onClose={() => setDetailTask(null)} onEdit={t => { setDetailTask(null); openTask(t); }} onDelete={t => { if (confirm(`删除任务“${t.title}”？`)) { deleteTask(t.id); setDetailTask(null); notify("任务已删除"); } }} onReflection={() => { if (detailTask) { setEditingReflection({ id: uid("reflection"), title: "", content: "", type: "问题复盘", relatedProjectId: detailTask.projectId, relatedTaskId: detailTask.id, date: todayISO(), durationMinutes: 0, tags: [] }); setDetailTask(null); setModal("reflection"); } }} onProject={p => { setDetailTask(null); setDetailProject(p); }} onStartTimer={startTimer} onPauseTimer={pauseTimer} onStopTimer={stopTimer} />
    <ProjectDetail open={!!detailProject} project={detailProject && data.projects.find(p => p.id === detailProject.id) || null} data={data} onClose={() => setDetailProject(null)} onEdit={p => { setDetailProject(null); openProject(p); }} onDelete={p => { if (confirm(`删除项目“${p.name}”？关联记录会保留但解除关联。`)) { deleteProject(p.id); setDetailProject(null); notify("项目已删除，关联记录已保留"); } }} onTask={t => { setDetailProject(null); setDetailTask(t); }} onReflection={r => { setDetailProject(null); setDetailReflection(r); }} />
    <ReflectionDetail open={!!detailReflection} reflection={detailReflection && data.reflections.find(r => r.id === detailReflection.id) || null} data={data} onClose={() => setDetailReflection(null)} onEdit={r => { setDetailReflection(null); openReflection(r); }} onDelete={r => { if (confirm(`删除复盘“${r.title}”？`)) { setData(d => ({ ...d, reflections: d.reflections.filter(x => x.id !== r.id) })); setDetailReflection(null); notify("复盘已删除"); } }} />
    <SettingsDialog open={modal === "settings"} onClose={() => setModal(null)} data={data} mode={mode} onReset={() => { localWorkDataRepository.clear(); setData(JSON.parse(JSON.stringify(seedData))); notify("演示数据已恢复"); }} notify={notify} />
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
  const total = tasks.length + projects.length + meetings.length + reflections.length + reports.length;
  if (!total) return <EmptyState icon={Search} title="没有找到匹配结果" text="可以试试项目名、提出人、来源、标签或复盘关键词。" />;
  return <div className="search-results">
    <section className="panel search-summary"><span className="eyebrow">GLOBAL SEARCH</span><h2>找到 {total} 条结果</h2><p>搜索范围包含任务、项目、会议、复盘和报告。清空搜索框即可回到原页面。</p></section>
    <div className="search-result-grid">
      <SearchGroup title="任务" count={tasks.length}>{tasks.map(t => <button className="linked-row" key={t.id} onClick={() => onTask(t)}><ListTodo size={16}/><div><strong>{t.title}</strong><span>{projectName(data.projects,t.projectId)} · {t.requester} · {t.source}</span></div><ArrowRight size={15}/></button>)}</SearchGroup>
      <SearchGroup title="项目" count={projects.length}>{projects.map(p => <button className="linked-row" key={p.id} onClick={() => onProject(p)}><FolderKanban size={16}/><div><strong>{p.name}</strong><span>{p.type} · {p.progress}% · {p.priority}</span></div><ArrowRight size={15}/></button>)}</SearchGroup>
      <SearchGroup title="会议" count={meetings.length}>{meetings.map(m => <button className="linked-row" key={m.id} onClick={() => onView("meetings")}><CalendarDays size={16}/><div><strong>{m.title}</strong><span>{m.date.slice(0,10)} · {projectName(data.projects,m.relatedProjectId)}</span></div><ArrowRight size={15}/></button>)}</SearchGroup>
      <SearchGroup title="复盘" count={reflections.length}>{reflections.map(r => <button className="linked-row" key={r.id} onClick={() => onReflection(r)}><Brain size={16}/><div><strong>{r.title}</strong><span>{r.type} · {projectName(data.projects,r.relatedProjectId)}</span></div><ArrowRight size={15}/></button>)}</SearchGroup>
      <SearchGroup title="报告" count={reports.length}>{reports.map(r => <button className="linked-row" key={r.id} onClick={() => onView("reports")}><FileText size={16}/><div><strong>{r.title}</strong><span>{r.type} · {r.startDate} — {r.endDate}</span></div><ArrowRight size={15}/></button>)}</SearchGroup>
    </div>
  </div>;
}
function SearchGroup({ title, count, children }: { title: string; count: number; children: React.ReactNode }) { return <section className="panel search-group"><PanelHead title={`${title} · ${count}`} sub={count ? "点击查看详情" : "暂无匹配"} />{count ? children : <p className="meeting-notes">没有匹配内容</p>}</section> }

function WorkAnalytics({ data, onTask }: { data: WorkData; onTask: (t: Task) => void }) {
  const [tab, setTab] = useState<"week"|"month"|"custom"|"projects">("week");
  const [weekStart, setWeekStart] = useState(format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd"));
  const [month, setMonth] = useState(format(new Date(), "yyyy-MM"));
  const [customStart, setCustomStart] = useState(format(subDays(new Date(), 14), "yyyy-MM-dd"));
  const [customEnd, setCustomEnd] = useState(todayISO());
  return <div className="work-analytics">
    <div className="analytics-tabs">{[["week","周度概览"],["month","月度概览"],["custom","自定义分析"],["projects","项目时间线"]].map(([id,label]) => <button key={id} className={cn(tab===id&&"active")} onClick={()=>setTab(id as typeof tab)}>{label}</button>)}</div>
    {tab === "week" && <WeeklyAnalytics data={data} weekStart={weekStart} setWeekStart={setWeekStart} onTask={onTask} />}
    {tab === "month" && <MonthlyAnalytics data={data} month={month} setMonth={setMonth} />}
    {tab === "custom" && <CustomAnalytics data={data} start={customStart} end={customEnd} setStart={setCustomStart} setEnd={setCustomEnd} />}
    {tab === "projects" && <ProjectTimeline data={data} />}
  </div>;
}

function WeeklyAnalytics({ data, weekStart, setWeekStart, onTask }: { data: WorkData; weekStart: string; setWeekStart: (s: string) => void; onTask: (t: Task) => void }) {
  const startDate = parseISO(weekStart), end = format(endOfWeek(startDate, { weekStartsOn: 1 }), "yyyy-MM-dd"), stats = rangeStats(data, weekStart, end);
  const days = Array.from({ length: 7 }, (_, i) => addDays(startDate, i));
  return <div className="analytics-section">
    <div className="analytics-period panel"><div><span className="eyebrow">WEEKLY OVERVIEW</span><h2>{format(startDate, "yyyy 'W'II")} </h2><p>{weekStart} - {end}</p></div><div className="period-actions"><button className="secondary" onClick={()=>setWeekStart(format(addWeeks(startDate,-1),"yyyy-MM-dd"))}>上一周</button><input type="date" value={weekStart} onChange={e=>setWeekStart(format(startOfWeek(parseISO(e.target.value),{weekStartsOn:1}),"yyyy-MM-dd"))}/><button className="secondary" onClick={()=>setWeekStart(format(addWeeks(startDate,1),"yyyy-MM-dd"))}>下一周</button></div></div>
    <div className="stats-grid"><StatCard label="本周总耗时" value={+(stats.totalSeconds/3600).toFixed(1)} unit="h" detail="来自计时、会议和复盘记录" icon={Timer} tone="purple"/><StatCard label="完成任务" value={stats.completed.length} unit="项" detail={`${stats.tasks.length} 项本周相关任务`} icon={CheckCircle2} tone="green"/><StatCard label="延期任务" value={stats.overdue.length} unit="项" detail="未完成且已过截止时间" icon={Clock3} tone="orange"/><StatCard label="等待事项" value={stats.waiting.length} unit="项" detail="依赖他人反馈" icon={Inbox} tone="blue"/></div>
    <section className="panel weekly-timeline"><PanelHead title="周工作时间轴" sub="根据真实计时、会议、复盘与等待记录生成" />{stats.events.length ? <div className="timeline-board">{days.map(day => { const date = format(day,"yyyy-MM-dd"), events = stats.events.filter(e=>e.date===date); return <div className="timeline-day" key={date}><div className="timeline-day-head"><b>{format(day,"EEE",{locale:zhCN}).toUpperCase()}</b><span>{format(day,"MM/dd")}</span></div><div className="timeline-lane">{events.map(e => <button key={e.id} title={`${e.kind}：${e.title} · ${durationLabel(e.durationSeconds)}`} onClick={()=>e.task&&onTask(e.task)} style={{ left: `${Math.min(92, Math.max(0, (e.startHour-8)/12*100))}%`, width: `${Math.min(80, Math.max(8, e.durationSeconds/3600/12*100))}%`, background: e.color }}><span>{e.title}</span></button>)}</div></div> })}</div> : <EmptyState icon={Timer} title="本周还没有可分析时间记录" text="开始任务计时或记录会议后，这里会出现时间轴。"/>}</section>
    <div className="analytics-grid"><ProjectRank data={data} rows={stats.projectSeconds.slice(0,10)} title="本周项目投入排行" /><TaskStatusPanel stats={stats} /></div>
  </div>;
}

function MonthlyAnalytics({ data, month, setMonth }: { data: WorkData; month: string; setMonth: (m: string) => void }) {
  const start = `${month}-01`, end = format(endOfMonth(parseISO(start)), "yyyy-MM-dd"), stats = rangeStats(data, start, end);
  const kinds: [AnalyticsEvent["kind"], string][] = [["任务","任务"],["会议","会议"],["复盘","思考"]];
  return <div className="analytics-section">
    <div className="analytics-period panel"><div><span className="eyebrow">MONTHLY OVERVIEW</span><h2>{format(parseISO(start),"yyyy年M月")}</h2><p>{start} - {end}</p></div><div className="period-actions"><input type="month" value={month} onChange={e=>setMonth(e.target.value)}/></div></div>
    <div className="stats-grid"><StatCard label="累计工作时长" value={+(stats.totalSeconds/3600).toFixed(1)} unit="h" detail="本月真实记录总和" icon={Timer} tone="purple"/><StatCard label="完成任务数量" value={stats.completed.length} unit="项" detail="本月完成任务" icon={CheckCircle2} tone="green"/><StatCard label="新增会议数" value={stats.meetings.length} unit="场" detail="本月会议记录" icon={CalendarDays} tone="blue"/><StatCard label="复盘思考" value={stats.reflections.length} unit="条" detail="本月沉淀内容" icon={Brain} tone="orange"/></div>
    <div className="analytics-grid"><section className="panel donut-panel"><PanelHead title="月度时间投入统计" sub="按记录类型拆分时间" />{stats.totalSeconds ? <div className="time-split">{kinds.map(([kind,label])=>{const seconds=stats.byKind(kind),pct=stats.totalSeconds?seconds/stats.totalSeconds*100:0;return <div key={kind} className="rank-row"><span>{label}</span><div className="rank-bar"><i style={{width:`${pct}%`}}/></div><b>{(seconds/3600).toFixed(1)}h · {pct.toFixed(0)}%</b></div>})}</div> : <EmptyState icon={BarChart3} title="本月暂无时间记录" text="记录任务计时、会议或复盘后会自动统计。"/>}</section><ProjectRank data={data} rows={stats.projectSeconds.slice(0,10)} title="项目耗时排行" /></div>
    <section className="panel reflection-month"><PanelHead title="本月复盘思考汇总" sub="按项目归类展示 Reflection" />{stats.reflections.length ? data.projects.map(p=>({project:p,refs:stats.reflections.filter(r=>r.relatedProjectId===p.id)})).filter(x=>x.refs.length).map(x=><div className="reflection-group" key={x.project.id}><h3>{x.project.name}</h3>{x.refs.map(r=><div className="linked-row" key={r.id}><Brain size={16}/><div><strong>{r.title}</strong><span>{r.type} · {r.tags.join("、") || "无标签"}</span></div></div>)}</div>) : <EmptyState icon={Brain} title="本月暂无复盘" text="复盘会在这里按项目自动聚合。"/>}</section>
  </div>;
}

function CustomAnalytics({ data, start, end, setStart, setEnd }: { data: WorkData; start: string; end: string; setStart: (s: string) => void; setEnd: (s: string) => void }) {
  const safeEnd = end < start ? start : end, stats = rangeStats(data, start, safeEnd);
  return <div className="analytics-section"><FilterBar><label>开始 <input type="date" value={start} onChange={e=>setStart(e.target.value)}/></label><label>结束 <input type="date" value={end} onChange={e=>setEnd(e.target.value)}/></label><span>{start} - {safeEnd}</span></FilterBar>
    <div className="stats-grid"><StatCard label="时间统计" value={+(stats.totalSeconds/3600).toFixed(1)} unit="h" detail={`${daysBetween(start,safeEnd)} 天范围`} icon={Timer} tone="purple"/><StatCard label="任务记录" value={stats.tasks.length} unit="项" detail={`${stats.completed.length} 项完成`} icon={ListTodo} tone="green"/><StatCard label="会议记录" value={stats.meetings.length} unit="场" detail="所选范围内会议" icon={CalendarDays} tone="blue"/><StatCard label="复盘记录" value={stats.reflections.length} unit="条" detail="所选范围内复盘" icon={Brain} tone="orange"/></div>
    <div className="analytics-grid"><ProjectRank data={data} rows={stats.projectSeconds.slice(0,10)} title="项目排行" /><TaskRank tasks={stats.tasks} /></div>
    <section className="panel"><PanelHead title="复盘汇总" sub="所选时间范围内的思考沉淀" />{stats.reflections.length ? stats.reflections.map(r=><div className="linked-row" key={r.id}><Brain size={16}/><div><strong>{r.title}</strong><span>{r.type} · {projectName(data.projects,r.relatedProjectId)}</span></div></div>) : <EmptyState icon={Brain} title="暂无复盘记录" text="调整时间范围或新增复盘后再查看。"/>}</section>
  </div>;
}

function ProjectTimeline({ data }: { data: WorkData }) {
  const projects = data.projects.map(p => { const tasks = data.tasks.filter(t=>t.projectId===p.id), seconds = tasks.reduce((s,t)=>s+taskSeconds(t),0), estimated = tasks.reduce((s,t)=>s+t.estimatedHours*3600,0), overdue = p.dueDate && p.dueDate < todayISO() && p.status !== "Done"; return { project:p, tasks, seconds, estimated, overdue, overBudget: estimated > 0 && seconds > estimated }; });
  if (!projects.length) return <EmptyState icon={FolderKanban} title="暂无项目" text="创建项目后会生成项目时间线。"/>;
  return <div className="analytics-section"><section className="panel project-timeline"><PanelHead title="项目时间线" sub="项目开始时间、截止时间、进度、实际耗时与风险" />{projects.map(row => <div className={cn("project-line", row.overdue && "late", row.overBudget && "over")} key={row.project.id}><div><strong>{row.project.name}</strong><span>{row.project.startDate || "未设置"} → {row.project.dueDate || "未设置"} · {row.project.progress}%</span></div><div className="project-line-track"><i style={{width:`${Math.max(4,row.project.progress)}%`}}/></div><b>{(row.seconds/3600).toFixed(1)}h</b><em>{row.overdue ? "已超期" : row.overBudget ? "超预计" : "正常"}</em></div>)}</section></div>;
}

function ProjectRank({ data, rows, title }: { data: WorkData; rows: { project: Project; seconds: number; tasks: Task[] }[]; title: string }) {
  const max = Math.max(1, ...rows.map(r=>r.seconds));
  return <section className="panel rank-panel"><PanelHead title={title} sub="按实际耗时排序" />{rows.length ? rows.map(r=><div className="rank-row" key={r.project.id}><span>{r.project.name}</span><div className="rank-bar"><i style={{width:`${r.seconds/max*100}%`}}/></div><b>{(r.seconds/3600).toFixed(1)}h</b></div>) : <EmptyState icon={FolderKanban} title="暂无项目投入数据" text="任务计时或会议关联项目后会自动统计。"/>}</section>;
}
function TaskStatusPanel({ stats }: { stats: ReturnType<typeof rangeStats> }) { return <section className="panel task-status-panel"><PanelHead title="任务完成情况" sub="本周期完成、进行中、延期和等待事项" /><div className="status-list"><div><b>{stats.completed.length}</b><span>完成任务</span></div><div><b>{stats.tasks.filter(t=>t.status==="Doing").length}</b><span>进行中任务</span></div><div><b>{stats.overdue.length}</b><span>延期任务</span></div><div><b>{stats.waiting.length}</b><span>等待事项</span></div></div></section> }
function TaskRank({ tasks }: { tasks: Task[] }) { const list=[...tasks].sort((a,b)=>taskSeconds(b)-taskSeconds(a)).slice(0,10);return <section className="panel rank-panel"><PanelHead title="任务排行" sub="按实际耗时排序" />{list.length?list.map(t=><div className="rank-row" key={t.id}><span>{t.title}</span><div className="rank-bar"><i style={{width:`${Math.min(100,taskSeconds(t)/Math.max(1,taskSeconds(list[0]))*100)}%`}}/></div><b>{(taskSeconds(t)/3600).toFixed(1)}h</b></div>):<EmptyState icon={ListTodo} title="暂无任务数据" text="所选范围内没有任务记录。"/>}</section> }

function Dashboard({ data, setView, onTask }: { data: WorkData; setView: (v: View) => void; onTask: (t: Task) => void }) {
  const today = todayISO(), week = startOfWeek(new Date(), { weekStartsOn: 1 });
  const todayTasks = data.tasks.filter(t => t.status !== "Done" && t.status !== "Inbox" && (!t.dueDate || t.dueDate <= today)).slice(0, 4);
  const done = data.tasks.filter(t => t.completedAt && !isBefore(parseISO(t.completedAt), week));
  const dueSoon = data.tasks.filter(t => t.status !== "Done" && t.dueDate && t.dueDate <= addDays(new Date(), 3).toISOString().slice(0, 10));
  const risk = data.tasks.filter(t => t.actualHours > t.estimatedHours * .8 && t.status !== "Done");
  return <><div className="stats-grid"><StatCard label="今日待办" value={todayTasks.length} unit="项" detail={`${dueSoon.length} 项即将到期`} icon={Target} tone="purple" /><StatCard label="本周已完成" value={done.length} unit="项" detail={`累计 ${hoursLabel(done.reduce((s,t)=>s+t.actualHours,0))}`} icon={CheckCircle2} tone="green" /><StatCard label="等待反馈" value={data.tasks.filter(t=>t.status==="Waiting").length} unit="项" detail="点击进入等待看板" icon={Clock3} tone="orange" /><StatCard label="超时风险" value={risk.length} unit="项" detail="已消耗 80% 以上预估" icon={BarChart3} tone="blue" /></div>
    <div className="dashboard-grid"><section className="panel focus-panel"><PanelHead title="今日待办与本周重点" sub="按优先级与截止时间排序" action="查看全部" onAction={()=>setView("tasks")} /><div className="focus-list">{todayTasks.map(t=><button className="dashboard-task" key={t.id} onClick={()=>onTask(t)}><span className={`priority ${t.priority.toLowerCase()}`}>{t.priority}</span><div><strong>{t.title}</strong><p>{projectName(data.projects,t.projectId)} · 截止 {t.dueDate||"未设置"}</p></div><ArrowRight size={15}/></button>)}</div></section>
      <section className="panel"><PanelHead title="项目进度概览" sub="正在推进的重点项目" action="项目中心" onAction={()=>setView("projects")} /><div className="project-mini-list">{data.projects.filter(p=>p.status==="Active").slice(0,4).map(p=><button key={p.id} onClick={()=>setView("projects")}><div><strong>{p.name}</strong><span>{p.progress}%</span></div><div className="project-progress"><i style={{width:`${p.progress}%`}}/></div><p>{p.nextAction}</p></button>)}</div></section>
      <section className="panel"><PanelHead title="最近复盘" sub="与任务、项目关联的工作思考" action="思考空间" onAction={()=>setView("thinking")} /><div className="memory-feed">{data.reflections.slice(0,3).map(r=><div className="memory-item" key={r.id}><div className="purple"><Brain size={15}/></div><section><strong>{r.title}</strong><p>{r.type} · {projectName(data.projects,r.relatedProjectId)}</p></section></div>)}</div></section>
      <section className="panel"><PanelHead title="到期与风险提醒" sub="需要提前干预的事项" /><div className="risk-list">{[...dueSoon,...risk.filter(r=>!dueSoon.some(t=>t.id===r.id))].slice(0,4).map(t=><button key={t.id} onClick={()=>onTask(t)}><Clock3 size={15}/><div><strong>{t.title}</strong><p>{t.dueDate<today?"已延期":"即将到期"} · {hoursLabel(t.actualHours)}/{hoursLabel(t.estimatedHours)}</p></div></button>)}</div></section>
    </div></>;
}

function InboxView({ data, updateTask, deleteTask, query, notify }: { data: WorkData; updateTask:(id:string,p:Partial<Task>)=>void; deleteTask:(id:string)=>void; query:string; notify:(s:string)=>void }) {
  const list=data.tasks.filter(t=>t.status==="Inbox"&&fuzzyMatch(query, taskSearchFields(t, data)));
  return <section className="panel wide-panel"><div className="inbox-toolbar"><div><b>{list.length} 条待处理</b><span>把它们变成任务，或放心删掉</span></div><button className="ghost" onClick={()=>notify(list.length?"请逐条明确任务归属，避免误删":"收集箱已经是空的")}><Archive size={15}/> 整理提示</button></div><div className="inbox-list">{list.length?list.map(t=><div className="inbox-item" key={t.id}><div className="source-icon"><Inbox size={17}/></div><div className="inbox-content"><strong>{t.title}</strong><p>来自 {t.source} · {t.requester} · {t.createdAt}</p></div><div className="inbox-actions"><button className="secondary" onClick={()=>updateTask(t.id,{status:"Todo",dueDate:addDays(new Date(),3).toISOString().slice(0,10)})}>转为任务 <ArrowRight size={14}/></button><button className="icon-button" aria-label="删除" onClick={()=>{if(confirm(`删除“${t.title}”？`))deleteTask(t.id)}}><X size={16}/></button></div></div>):<EmptyState icon={Inbox} title="收集箱已清空" text="所有输入都已经有了去处。"/>}</div></section>;
}

function TaskCenter({ data, query, updateTask, onOpen, onAdd, onComplete, onStartTimer, onPauseTimer, onStopTimer }: { data:WorkData; query:string; updateTask:(id:string,p:Partial<Task>)=>void; onOpen:(t:Task)=>void; onAdd:(t?:Task)=>void; onComplete:(t:Task)=>void; onStartTimer:(t:Task)=>void; onPauseTimer:(t:Task)=>void; onStopTimer:(t:Task)=>void }) {
  const [status,setStatus]=useState("全部"),[project,setProject]=useState("全部"),[priority,setPriority]=useState("全部");
  const tasks=data.tasks.filter(t=>t.status!=="Inbox"&&fuzzyMatch(query, taskSearchFields(t, data))&&(status==="全部"||t.status===status)&&(project==="全部"||t.projectId===project)&&(priority==="全部"||t.priority===priority));
  const columns:(TaskStatus)[] = status!=="全部"?[status as TaskStatus]:["Todo","Doing","Waiting","Done"];
  return <><FilterBar><select value={status} onChange={e=>setStatus(e.target.value)}><option>全部</option><option value="Todo">待开始</option><option value="Doing">进行中</option><option value="Waiting">等待中</option><option value="Done">已完成</option></select><select value={project} onChange={e=>setProject(e.target.value)}><option value="全部">全部项目</option>{data.projects.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select><select value={priority} onChange={e=>setPriority(e.target.value)}><option>全部</option><option>P0</option><option>P1</option><option>P2</option><option>P3</option></select><button onClick={()=>{setStatus("全部");setProject("全部");setPriority("全部")}}>清除筛选</button></FilterBar>
    <div className={cn("kanban",columns.length<4&&"filtered-kanban")}>{columns.map(s=><section className="kanban-col" key={s}><div className="kanban-head"><span className={`status-dot ${s.toLowerCase()}`}/>{{Todo:"待开始",Doing:"进行中",Waiting:"等待中",Done:"已完成",Inbox:"收集箱"}[s]}<b>{tasks.filter(t=>t.status===s).length}</b></div><div className="kanban-stack">{tasks.filter(t=>t.status===s).map(t=><TaskCard key={t.id} task={t} project={projectName(data.projects,t.projectId)} onOpen={()=>onOpen(t)} onComplete={()=>onComplete(t)} onStatus={v=>v==="Done"?onComplete(t):updateTask(t.id,{status:v,completedAt:undefined})} onStartTimer={()=>onStartTimer(t)} onPauseTimer={()=>onPauseTimer(t)} onStopTimer={()=>onStopTimer(t)}/>) }<button className="add-card" onClick={()=>onAdd()}><Plus size={15}/> 添加任务</button></div></section>)}</div></>;
}

function ProjectCenter({data,query,onOpen,onEdit,onAdd}:{data:WorkData;query:string;onOpen:(p:Project)=>void;onEdit:(p?:Project)=>void;onAdd:(p?:Project)=>void}) {
  const [status,setStatus]=useState("全部"); const list=data.projects.filter(p=>fuzzyMatch(query, projectSearchFields(p, data))&&(status==="全部"||p.status===status));
  return <><FilterBar><select value={status} onChange={e=>setStatus(e.target.value)}><option>全部</option><option value="Planning">规划中</option><option value="Active">进行中</option><option value="Paused">已暂停</option><option value="Done">已完成</option></select><button onClick={()=>onAdd()}><Plus size={14}/> 新增项目</button></FilterBar><div className="project-grid">{list.map(p=>{const tasks=data.tasks.filter(t=>t.projectId===p.id),hours=tasks.reduce((s,t)=>s+t.actualHours,0);return <article className="project-card" key={p.id}><div className="project-card-top"><span className={`priority ${p.priority.toLowerCase()}`}>{p.priority}</span><span className="project-status">{{Planning:"规划中",Active:"进行中",Paused:"暂停",Done:"完成"}[p.status]}</span></div><h3>{p.name}</h3><p>{p.goal}</p><div className="project-progress"><i style={{width:`${p.progress}%`}}/></div><div className="project-numbers"><span><b>{p.progress}%</b> 进度</span><span><b>{tasks.length}</b> 任务</span><span><b>{hours.toFixed(1)}h</b> 已用</span></div><div className="project-card-actions"><button onClick={()=>onOpen(p)}>查看档案 <ArrowRight size={14}/></button><button onClick={()=>onEdit(p)}>编辑</button></div></article>})}</div></>;
}

function MeetingCenter({data,setData,query,onEdit,onTask,onDelete}:{data:WorkData;setData:React.Dispatch<React.SetStateAction<WorkData>>;query:string;onEdit:(m?:Meeting)=>void;onTask:(t:Task)=>void;onDelete:(m:Meeting)=>void}) {
  const list=data.meetings.filter(m=>fuzzyMatch(query, meetingSearchFields(m, data))); const [selected,setSelected]=useState(list[0]?.id||""); const meeting=list.find(m=>m.id===selected)||list[0];
  useEffect(()=>{if(list.length&&!list.some(m=>m.id===selected))setSelected(list[0].id)},[list,selected]);
  const createTask=(m:Meeting,actionId:string)=>setData(d=>{const a=m.actionItems.find(x=>x.id===actionId)!;const task:Task={id:uid("task"),title:a.text,description:`来自会议：${m.title}`,source:"会议",requester:a.owner,projectId:m.relatedProjectId,status:"Todo",priority:"P1",dueDate:a.dueDate,estimatedHours:1,actualHours:0,createdAt:todayISO(),tags:["会议行动项"],notes:"",waitingFor:"",timeTracking:blankTracking()};return{...d,tasks:[task,...d.tasks],projects:d.projects.map(p=>p.id===task.projectId?{...p,relatedTaskIds:[task.id,...p.relatedTaskIds.filter(id=>id!==task.id)]}:p),meetings:d.meetings.map(x=>x.id===m.id?{...x,actionItems:x.actionItems.map(i=>i.id===actionId?{...i,taskId:task.id}:i)}:x)}});
  return <div className="meeting-grid"><section className="panel meeting-list"><div className="section-kicker">近期会议</div>{list.map(m=><button className={cn("meeting-nav-item",meeting?.id===m.id&&"selected")} key={m.id} onClick={()=>setSelected(m.id)}><div className="date-block"><b>{format(parseISO(m.date),"dd")}</b><span>{format(parseISO(m.date),"MMM",{locale:zhCN})}</span></div><div><strong>{m.title}</strong><p>{format(parseISO(m.date),"HH:mm")} · {m.attendees.length} 人参会</p></div><ChevronDown size={16}/></button>)}</section>{meeting?<section className="panel meeting-detail"><div className="meeting-title"><div><div className="eyebrow">{format(parseISO(meeting.date),"M月d日 EEEE · HH:mm",{locale:zhCN})}</div><h2>{meeting.title}</h2><div className="attendees"><Users size={15}/>{meeting.attendees.map(a=><span key={a}>{a}</span>)}<span>{projectName(data.projects,meeting.relatedProjectId)}</span></div></div><div className="meeting-actions"><button className="secondary" onClick={()=>onEdit(meeting)}>编辑会议</button><button className="secondary danger" onClick={()=>onDelete(meeting)}><Trash2 size={14}/></button></div></div><MeetingSection icon={BookOpen} title="会议纪要"><p className="meeting-notes">{meeting.notes||"暂无纪要"}</p></MeetingSection><MeetingSection icon={Target} title="决策事项">{meeting.decisions.length?meeting.decisions.map((d,i)=><div className="decision" key={d}><b>{String(i+1).padStart(2,"0")}</b><span>{d}</span></div>):<p className="meeting-notes">暂无决策</p>}</MeetingSection><MeetingSection icon={CheckCircle2} title="行动项" badge={`${meeting.actionItems.length} 项`}>{meeting.actionItems.map(a=><div className="action-item" key={a.id}><Circle size={16}/><div><strong>{a.text}</strong><p>{a.owner} · 截止 {a.dueDate}</p></div>{a.taskId?<button className="task-created" onClick={()=>{const t=data.tasks.find(x=>x.id===a.taskId);if(t)onTask(t)}}><Check size={13}/> 查看任务</button>:<button className="secondary small" onClick={()=>createTask(meeting,a.id)}><Plus size={13}/> 生成任务</button>}</div>)}</MeetingSection></section>:<EmptyState icon={CalendarDays} title="还没有会议" text="创建第一场会议，把讨论变成行动。"/>}</div>;
}

function WorkLog({data,onTask}:{data:WorkData;onTask:(t:Task)=>void}) { const [start,setStart]=useState(subDays(new Date(),7).toISOString().slice(0,10)),[end,setEnd]=useState(todayISO()); const done=data.tasks.filter(t=>t.completedAt&&t.completedAt>=start&&t.completedAt<=end).sort((a,b)=>(b.completedAt||"").localeCompare(a.completedAt||"")); const groups=Object.entries(done.reduce<Record<string,Task[]>>((a,t)=>{(a[t.completedAt!]||=[]).push(t);return a},{})); return <><FilterBar><label>从 <input type="date" value={start} onChange={e=>setStart(e.target.value)}/></label><label>至 <input type="date" value={end} onChange={e=>setEnd(e.target.value)}/></label><span>共 {done.length} 项 · {hoursLabel(done.reduce((s,t)=>s+t.actualHours,0))}</span></FilterBar><div className="log-layout"><section className="panel log-summary"><span className="eyebrow">所选周期已记录</span><b>{hoursLabel(done.reduce((s,t)=>s+t.actualHours,0))}</b><p>{done.length} 项完成事项</p><div className="mini-bars">{[45,80,60,92,38,10,6].map((h,i)=><i key={i} style={{height:`${h}%`}}/>)}</div></section><section className="panel log-main">{groups.map(([date,list])=><div className="log-day" key={date}><div className="log-date"><b>{format(parseISO(date),"dd")}</b><span>{format(parseISO(date),"M月 · EEE",{locale:zhCN})}</span></div><div className="log-items">{list.map(t=><button className="log-item" key={t.id} onClick={()=>onTask(t)}><CheckCircle2 size={17}/><div><strong>{t.title}</strong><p><span>{projectName(data.projects,t.projectId)}</span> · 实际用时 {hoursLabel(t.actualHours)}</p></div><span className={cn("variance",t.actualHours<=t.estimatedHours?"good":"warn")}>{t.actualHours<=t.estimatedHours?"比预估快":`超出 ${Math.round((t.actualHours/t.estimatedHours-1)*100)}%`}</span></button>)}</div></div>)}</section></div></> }

function WeeklyReview({data,setData,setView,notify}:{data:WorkData;setData:React.Dispatch<React.SetStateAction<WorkData>>;setView:(v:View)=>void;notify:(s:string)=>void}) { const start=format(startOfWeek(new Date(),{weekStartsOn:1}),"yyyy-MM-dd"),end=format(endOfWeek(new Date(),{weekStartsOn:1}),"yyyy-MM-dd"); const completed=data.tasks.filter(t=>t.completedAt&&t.completedAt>=start&&t.completedAt<=end),risks=data.tasks.filter(t=>t.status==="Waiting"||(t.dueDate&&t.dueDate<todayISO()&&t.status!=="Done")),next=data.tasks.filter(t=>!["Done","Inbox"].includes(t.status)).slice(0,5); const generate=()=>{const content=generateReportContent(data,start,end,defaultReportOptions);const report:Report={id:uid("report"),title:`${format(parseISO(start),"M月d日")}周报`,type:"周报",startDate:start,endDate:end,generatedContent:content,includedTaskIds:data.tasks.map(t=>t.id),includedReflectionIds:data.reflections.map(r=>r.id),createdAt:new Date().toISOString(),options:defaultReportOptions};setData(d=>({...d,reports:[report,...d.reports]}));notify("周报已生成并保存到报告中心");setView("reports")}; return <div className="review-layout"><div className="review-header-card"><div><span className="eyebrow">WEEKLY REVIEW · {start.slice(5)} — {end.slice(5)}</span><h2>本周工作复盘</h2><p>基于任务、项目、会议与复盘记录自动生成</p></div><button className="primary" onClick={generate}><Sparkles size={16}/> 生成完整周报</button></div><ReviewSection n="01" title="本周完成" desc="真实完成记录，不靠周五下午的记忆。" tasks={completed} data={data}/><ReviewSection n="02" title="风险与问题" desc="需要持续跟进或可能影响交付的事项。" tasks={risks} data={data} tone="risk"/><ReviewSection n="03" title="下周计划" desc="根据未完成事项、优先级与截止时间生成。" tasks={next} data={data} tone="next"/></div> }

function ReportCenter({data,setData,query,notify}:{data:WorkData;setData:React.Dispatch<React.SetStateAction<WorkData>>;query:string;notify:(s:string)=>void}) { const [type,setType]=useState<ReportType>("周报"),[title,setTitle]=useState("本周期工作总结"),[start,setStart]=useState(format(startOfWeek(new Date(),{weekStartsOn:1}),"yyyy-MM-dd")),[end,setEnd]=useState(todayISO()),[options,setOptions]=useState(defaultReportOptions),[active,setActive]=useState<Report|null>(data.reports[0]||null); const reports=data.reports.filter(r=>fuzzyMatch(query,reportSearchFields(r))); useEffect(()=>{if(!active&&reports.length)setActive(reports[0]);if(active&&query&&!reports.some(r=>r.id===active.id))setActive(reports[0]||null)},[reports,active,query]); const reportData={...data,tasks:data.tasks.map(withActualFromTracking)}; const setRange=(t:ReportType)=>{setType(t);const now=new Date();if(t==="日报"){setStart(todayISO());setEnd(todayISO())}if(t==="周报"){setStart(format(startOfWeek(now,{weekStartsOn:1}),"yyyy-MM-dd"));setEnd(format(endOfWeek(now,{weekStartsOn:1}),"yyyy-MM-dd"))}if(t==="月报"){setStart(format(startOfMonth(now),"yyyy-MM-dd"));setEnd(format(endOfMonth(now),"yyyy-MM-dd"))}if(t==="季度报"){setStart(format(startOfQuarter(now),"yyyy-MM-dd"));setEnd(format(endOfQuarter(now),"yyyy-MM-dd"))}}; const generate=()=>{if(!title.trim()){notify("请填写报告标题");return}if(start>end){notify("开始日期不能晚于结束日期");return}const r:Report={id:uid("report"),title,type,startDate:start,endDate:end,generatedContent:generateReportContent(reportData,start,end,options),includedTaskIds:data.tasks.filter(t=>t.createdAt>=start&&t.createdAt<=end||t.completedAt&&t.completedAt>=start&&t.completedAt<=end).map(t=>t.id),includedReflectionIds:data.reflections.filter(r=>r.date>=start&&r.date<=end).map(r=>r.id),createdAt:new Date().toISOString(),options};setData(d=>({...d,reports:[r,...d.reports]}));setActive(r);notify("报告已生成并保存")}; const copy=async()=>{if(active){await navigator.clipboard.writeText(active.generatedContent);notify("报告已复制到剪贴板")}}; const download=()=>{if(!active)return;const blob=new Blob([active.generatedContent],{type:"text/markdown;charset=utf-8"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`${active.title}.md`;a.click();URL.revokeObjectURL(a.href);notify("Markdown 已导出")}; return <div className="report-layout"><section className="panel report-builder"><h3>生成新报告</h3><div className="form-grid compact"><Field label="报告类型"><select value={type} onChange={e=>setRange(e.target.value as ReportType)}><option>日报</option><option>周报</option><option>月报</option><option>季度报</option><option>自定义</option></select></Field><Field label="自定义标题"><input value={title} onChange={e=>setTitle(e.target.value)}/></Field><Field label="开始日期"><input type="date" value={start} onChange={e=>{setType("自定义");setStart(e.target.value)}}/></Field><Field label="结束日期"><input type="date" value={end} onChange={e=>{setType("自定义");setEnd(e.target.value)}}/></Field></div><div className="report-options">{([['reflections','复盘思考'],['projectProgress','项目进展'],['timeStats','耗时统计'],['waiting','Waiting 事项'],['nextPlan','下阶段计划']] as [keyof ReportOptions,string][]).map(([k,l])=><label key={k}><input type="checkbox" checked={options[k]} onChange={e=>setOptions(o=>({...o,[k]:e.target.checked}))}/><span>{l}</span></label>)}</div><button className="primary report-generate" onClick={generate}><Sparkles size={16}/> 生成报告</button><div className="saved-reports"><span className="eyebrow">历史报告</span>{reports.length?reports.map(r=><button className={cn(active?.id===r.id&&"active")} key={r.id} onClick={()=>setActive(r)}><div><strong>{r.title}</strong><span>{r.type} · {r.startDate} — {r.endDate}</span></div><ArrowRight size={14}/></button>):<p className="meeting-notes">没有匹配的报告</p>}</div></section><section className="panel report-preview"><div className="report-preview-head"><div><span className="eyebrow">REPORT PREVIEW</span><h2>{active?.title||"尚未生成报告"}</h2></div><div><button className="secondary" disabled={!active} onClick={copy}><Clipboard size={14}/> 一键复制</button><button className="secondary" disabled={!active} onClick={download}><Download size={14}/> 导出 Markdown</button></div></div>{active?<pre className="markdown-preview">{active.generatedContent}</pre>:<EmptyState icon={FileText} title="配置并生成第一份报告" text="报告会关联任务、项目和复盘，而不是简单流水账。"/>}</section></div> }

function Analytics({data}:{data:WorkData}) { const measured=data.tasks.filter(t=>t.actualHours>0&&t.estimatedHours>0),est=measured.reduce((s,t)=>s+t.estimatedHours,0),act=measured.reduce((s,t)=>s+t.actualHours,0),accuracy=measured.length?Math.max(0,Math.round(100-measured.reduce((s,t)=>s+Math.abs(t.actualHours-t.estimatedHours)/t.estimatedHours*100,0)/measured.length)):0; return <><div className="analytics-top"><StatCard label="总预估工时" value={+est.toFixed(1)} unit="h" detail={`${measured.length} 个有记录的任务`} icon={Clock3} tone="purple"/><StatCard label="总实际工时" value={+act.toFixed(1)} unit="h" detail={act>est?`超出 ${hoursLabel(act-est)}`:`节省 ${hoursLabel(est-act)}`} icon={Timer} tone="blue"/><StatCard label="预估准确率" value={accuracy} unit="%" detail="持续记录会更准确" icon={Target} tone="green"/></div><div className="analytics-grid"><section className="panel chart-panel"><PanelHead title="预估 vs 实际" sub="最近有工时记录的任务"/><div className="bar-chart">{measured.map(t=>{const max=Math.max(t.estimatedHours,t.actualHours);return <div className="bar-row" key={t.id}><span>{t.title}</span><div className="bar-track"><i className="est" style={{width:`${t.estimatedHours/max*85}%`}}/><i className="act" style={{width:`${t.actualHours/max*85}%`}}/></div><b>{hoursLabel(t.actualHours)}</b></div>})}</div></section><section className="panel insight-card"><div className="insight-icon"><Sparkles size={20}/></div><span className="eyebrow">智能校准</span><h3>给自己多留 18% 的缓冲</h3><p>根据最近完成记录，分析与跨团队协作任务更容易低估。</p><div className="ddl-box"><span>原始预估</span><b>2.0h</b><ArrowRight size={16}/><span>建议预估</span><b className="accent">2.4h</b></div></section></div></> }

function WaitingDashboard({data,updateTask,onTask}:{data:WorkData;updateTask:(id:string,p:Partial<Task>)=>void;onTask:(t:Task)=>void}) { const list=data.tasks.filter(t=>t.status==="Waiting");return <div className="waiting-layout"><div className="waiting-summary"><div><span className="eyebrow">正在等待</span><b>{list.length}</b><p>个事项依赖他人反馈</p></div><div className="wait-ring"><b>{list.length?Math.max(...list.map(t=>Math.max(0,Math.floor((Date.now()-parseISO(t.createdAt).getTime())/86400000)))):0}</b><span>最长等待天数</span></div></div><section className="panel waiting-table"><div className="table-head"><span>事项</span><span>等待对象</span><span>已等待</span><span>截止时间</span><span/></div>{list.map(t=>{const days=Math.max(0,Math.floor((Date.now()-parseISO(t.createdAt).getTime())/86400000));return <div className="table-row" key={t.id}><button className="table-task" onClick={()=>onTask(t)}><strong>{t.title}</strong><p>{projectName(data.projects,t.projectId)}</p></button><span className="person"><span className="person-avatar">{(t.waitingFor||"?").slice(0,1)}</span>{t.waitingFor||"未填写"}</span><span className={cn("days",days>=3&&"late")}>{days} 天</span><span>{t.dueDate||"未设置"}</span><button className="secondary small" onClick={()=>updateTask(t.id,{status:"Todo",waitingFor:""})}>收到反馈</button></div>})}</section></div> }

function ThinkingSpace({data,query,onOpen,onAdd}:{data:WorkData;query:string;onOpen:(r:Reflection)=>void;onAdd:(r?:Reflection)=>void}) { const [type,setType]=useState("全部"),[project,setProject]=useState("全部"); const list=data.reflections.filter(r=>(type==="全部"||r.type===type)&&(project==="全部"||r.relatedProjectId===project)&&fuzzyMatch(query,reflectionSearchFields(r,data)));return <><FilterBar><select value={type} onChange={e=>setType(e.target.value)}><option>全部</option>{["问题复盘","流程优化","风险提醒","经验沉淀","自动化想法","管理思考"].map(x=><option key={x}>{x}</option>)}</select><select value={project} onChange={e=>setProject(e.target.value)}><option value="全部">全部项目</option>{data.projects.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select><button onClick={()=>{setType("全部");setProject("全部")}}>清除筛选</button></FilterBar><div className="thought-grid"><button className="new-thought-card" onClick={()=>onAdd()}><div><Plus size={23}/></div><strong>记录一个新复盘</strong><span>关联具体项目或任务</span></button>{list.length?list.map(r=><article className="thought-card" key={r.id}><div className="thought-top"><span className="thought-tag">{r.type}</span><button aria-label="查看详情" onClick={()=>onOpen(r)}><MoreHorizontal size={17}/></button></div><h3>{r.title}</h3><p>{r.content}</p><div className="linked-context"><span>{projectName(data.projects,r.relatedProjectId)}</span>{r.relatedTaskId&&<span>{data.tasks.find(t=>t.id===r.relatedTaskId)?.title}</span>}</div><div className="thought-foot"><span>{r.date}</span><button onClick={()=>onOpen(r)}><ArrowRight size={15}/></button></div></article>):<EmptyState icon={Brain} title="没有匹配的复盘" text="换个关键词，或清空搜索恢复全部思考。"/>}</div></> }

function TaskCard({task,project,onOpen,onComplete,onStatus,onStartTimer,onPauseTimer,onStopTimer}:{task:Task;project:string;onOpen:()=>void;onComplete:()=>void;onStatus:(s:TaskStatus)=>void;onStartTimer:()=>void;onPauseTimer:()=>void;onStopTimer:()=>void}) { const running=!!task.timeTracking?.isRunning; return <article className={cn("task-card",running&&"is-running")}><div className="task-card-top"><span className={`priority ${task.priority.toLowerCase()}`}>{task.priority}</span>{running&&<span className="running-badge">计时中</span>}<button aria-label="查看任务详情" onClick={onOpen}><MoreHorizontal size={16}/></button></div><button className="task-card-title" onClick={onOpen}><h3>{task.title}</h3><p>{task.description}</p></button><div className="project-tag">{project}</div>{task.status==="Waiting"&&<div className="waiting-note"><Clock3 size={13}/> 等待 {task.waitingFor}</div>}<div className="task-card-bottom"><span><CalendarDays size={14}/>{task.dueDate||"无截止"}</span><span><Timer size={14}/>{durationLabel(taskSeconds(task))} / {hoursLabel(task.estimatedHours)}</span></div><div className="card-actions timer-actions">{running?<><button onClick={onPauseTimer} className="active"><Pause size={14}/> 暂停</button><button onClick={onStopTimer}><Check size={14}/>结束计时</button></>:<button onClick={onStartTimer}><Play size={14}/> 开始计时</button>}{task.status!=="Done"&&<button onClick={onComplete}><Check size={14}/>完成</button>}<select aria-label="更新状态" value={task.status} onChange={e=>onStatus(e.target.value as TaskStatus)}><option value="Todo">待开始</option><option value="Doing">进行中</option><option value="Waiting">等待中</option><option value="Done">已完成</option></select></div></article> }
function StatCard({label,value,unit,detail,icon:Icon,tone}:{label:string;value:number;unit:string;detail:string;icon:typeof Target;tone:string}) { return <div className="stat-card"><div className={`stat-icon ${tone}`}><Icon size={19}/></div><div><span>{label}</span><div className="stat-value">{value}<small>{unit}</small></div><p>{detail}</p></div></div> }
function PanelHead({title,sub,action,onAction}:{title:string;sub:string;action?:string;onAction?:()=>void}){return <div className="panel-head"><div><h2>{title}</h2><p>{sub}</p></div>{action&&<button onClick={onAction}>{action}<ArrowRight size={14}/></button>}</div>}
function MeetingSection({icon:Icon,title,badge,children}:{icon:typeof BookOpen;title:string;badge?:string;children:React.ReactNode}){return <section className="meeting-section"><h3><Icon size={17}/>{title}{badge&&<span>{badge}</span>}</h3>{children}</section>}
function ReviewSection({n,title,desc,tasks,data,tone}:{n:string;title:string;desc:string;tasks:Task[];data:WorkData;tone?:string}){return <section className={cn("review-section",tone)}><div className="review-number">{n}</div><div><h3>{title}</h3><p className="section-desc">{desc}</p>{tasks.length?tasks.map(t=><div className="review-line" key={t.id}><CheckCircle2 size={17}/><div><strong>{t.title}</strong><span>{projectName(data.projects,t.projectId)} · {hoursLabel(t.actualHours)}</span></div></div>):<p className="meeting-notes">暂无相关事项</p>}</div></section>}
function FilterBar({children}:{children:React.ReactNode}){return <div className="filter-bar">{children}</div>}
function EmptyState({icon:Icon,title,text}:{icon:typeof Inbox;title:string;text:string}){return <div className="empty"><Icon size={26}/><strong>{title}</strong><p>{text}</p></div>}

function BaseDialog({open,onOpenChange,title,subtitle,children,wide}:{open:boolean;onOpenChange:(o:boolean)=>void;title:string;subtitle:string;children:React.ReactNode;wide?:boolean}){return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="dialog-overlay"/><Dialog.Content className={cn("dialog-content",wide&&"dialog-wide")}><div className="dialog-head"><div><Dialog.Title>{title}</Dialog.Title><Dialog.Description>{subtitle}</Dialog.Description></div><Dialog.Close className="icon-button"><X size={18}/></Dialog.Close></div>{children}</Dialog.Content></Dialog.Portal></Dialog.Root>}
function Field({label,children,wide}:{label:string;children:React.ReactNode;wide?:boolean}){return <label className={cn("field",wide&&"wide")}><span>{label}</span>{children}</label>}
function ProjectSelect({label,value,projects,onChange,onCreateProject}:{label:string;value:string;projects:Project[];onChange:(id:string)=>void;onCreateProject:(p:Project)=>Project}) { const [open,setOpen]=useState(false); return <><Field label={label}><select value={value} onChange={e=>{if(e.target.value===NEW_PROJECT_VALUE)setOpen(true);else onChange(e.target.value)}}><option value="">不关联</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}<option value={NEW_PROJECT_VALUE}>+ 新建项目</option></select></Field><MiniProjectDialog open={open} onOpenChange={setOpen} onSave={project=>{const saved=onCreateProject(project);onChange(saved.id);setOpen(false)}}/></> }
function MiniProjectDialog({open,onOpenChange,onSave}:{open:boolean;onOpenChange:(o:boolean)=>void;onSave:(p:Project)=>void}) { const [form,setForm]=useState<Project>(blankProject()); useEffect(()=>{if(open)setForm(blankProject())},[open]); const f=<K extends keyof Project>(k:K,v:Project[K])=>setForm(x=>({...x,[k]:v})); return <BaseDialog open={open} onOpenChange={onOpenChange} title="新建关联项目" subtitle="创建后会自动选中到当前表单。" wide><div className="form-grid"><Field label="项目名称" wide><input autoFocus value={form.name} onChange={e=>f("name",e.target.value)} /></Field><Field label="项目类型"><input value={form.type} onChange={e=>f("type",e.target.value)} /></Field><Field label="项目状态"><select value={form.status} onChange={e=>f("status",e.target.value as ProjectStatus)}><option value="Planning">规划中</option><option value="Active">进行中</option><option value="Paused">已暂停</option><option value="Done">已完成</option></select></Field><Field label="优先级"><select value={form.priority} onChange={e=>f("priority",e.target.value as Priority)}><option>P0</option><option>P1</option><option>P2</option><option>P3</option></select></Field><Field label="截止时间"><input type="date" value={form.dueDate} onChange={e=>f("dueDate",e.target.value)} /></Field><Field label="项目背景" wide><textarea value={form.background} onChange={e=>f("background",e.target.value)} /></Field><Field label="项目目标" wide><textarea value={form.goal} onChange={e=>f("goal",e.target.value)} /></Field></div><div className="dialog-foot"><span>保存后自动关联</span><button className="primary" disabled={!form.name.trim()} onClick={()=>onSave(form)}><Save size={15}/> 创建并选中</button></div></BaseDialog> }

function CaptureDialog({open,onOpenChange,onAdd}:{open:boolean;onOpenChange:(o:boolean)=>void;onAdd:(t:Task)=>void}) { const [title,setTitle]=useState(""),[source,setSource]=useState("快速记录"),[requester,setRequester]=useState(""); const submit=()=>{if(!title.trim())return;onAdd({id:uid("task"),title,description:"",source,requester:requester||"自己",projectId:"",status:"Inbox",priority:"P2",dueDate:"",estimatedHours:.5,actualHours:0,createdAt:todayISO(),tags:[],notes:"",waitingFor:"",timeTracking:blankTracking()});setTitle("");onOpenChange(false)};return <BaseDialog open={open} onOpenChange={onOpenChange} title="快速记录" subtitle="先捕捉，不必现在就整理。"><div className="capture-box"><textarea autoFocus value={title} onChange={e=>setTitle(e.target.value)} placeholder="刚刚收到了什么工作？"/><div className="form-grid"><Field label="来源"><select value={source} onChange={e=>setSource(e.target.value)}><option>快速记录</option><option>会议</option><option>邮件</option><option>私聊</option><option>项目群</option></select></Field><Field label="提出人"><input value={requester} onChange={e=>setRequester(e.target.value)} placeholder="例如：林薇"/></Field></div></div><div className="dialog-foot"><span>将进入 Inbox，稍后再处理</span><button className="primary" onClick={submit}>保存记录</button></div></BaseDialog> }

function TaskDialog({open,task,projects,onCreateProject,onOpenChange,onSave}:{open:boolean;task:Task|null;projects:Project[];onCreateProject:(p:Project)=>Project;onOpenChange:(o:boolean)=>void;onSave:(t:Task)=>void}) { const blank=():Task=>({id:uid("task"),title:"",description:"",source:"手动创建",requester:"自己",projectId:"",status:"Todo",priority:"P1",dueDate:addDays(new Date(),2).toISOString().slice(0,10),estimatedHours:1,actualHours:0,createdAt:todayISO(),tags:[],notes:"",waitingFor:"",timeTracking:blankTracking()});const [form,setForm]=useState<Task>(blank());useEffect(()=>{if(open)setForm(task?{...task,tags:[...task.tags],timeTracking:task.timeTracking||blankTracking(),actualHours:taskHours(task)}:blank())},[open,task]);const f=<K extends keyof Task>(k:K,v:Task[K])=>setForm(x=>({...x,[k]:v}));return <BaseDialog open={open} onOpenChange={onOpenChange} title={task?"编辑任务":"新建任务"} subtitle="补全上下文，未来的你会感谢现在的你。" wide><div className="form-grid"><Field label="任务标题" wide><input autoFocus value={form.title} onChange={e=>f("title",e.target.value)} placeholder="清晰描述要完成的结果"/></Field><Field label="描述" wide><textarea value={form.description} onChange={e=>f("description",e.target.value)} /></Field><ProjectSelect label="关联项目" value={form.projectId} projects={projects} onChange={v=>f("projectId",v)} onCreateProject={onCreateProject}/><Field label="状态"><select value={form.status} onChange={e=>f("status",e.target.value as TaskStatus)}><option value="Inbox">Inbox</option><option value="Todo">待开始</option><option value="Doing">进行中</option><option value="Waiting">等待中</option><option value="Done">已完成</option></select></Field><Field label="优先级"><select value={form.priority} onChange={e=>f("priority",e.target.value as Priority)}><option>P0</option><option>P1</option><option>P2</option><option>P3</option></select></Field><Field label="截止日期"><input type="date" value={form.dueDate} onChange={e=>f("dueDate",e.target.value)}/></Field><Field label="预估工时"><input type="number" step="0.25" min="0" value={form.estimatedHours} onChange={e=>f("estimatedHours",+e.target.value)}/></Field><Field label="实际工时"><input value={`${durationLabel(taskSeconds(form))}（由计时自动生成）`} readOnly /></Field><Field label="来源"><input value={form.source} onChange={e=>f("source",e.target.value)}/></Field><Field label="提出人"><input value={form.requester} onChange={e=>f("requester",e.target.value)}/></Field>{form.status==="Waiting"&&<Field label="Waiting For" wide><input value={form.waitingFor||""} onChange={e=>f("waitingFor",e.target.value)}/></Field>}<Field label="标签（逗号分隔）" wide><input value={form.tags.join(", ")} onChange={e=>f("tags",e.target.value.split(/[,，]/).map(x=>x.trim()).filter(Boolean))}/></Field><Field label="工作备注" wide><textarea value={form.notes} onChange={e=>f("notes",e.target.value)}/></Field></div><div className="dialog-foot"><span>保存后会自动写入本地数据</span><button className="primary" disabled={!form.title.trim()} onClick={()=>onSave({...form,actualHours:taskHours(form),completedAt:form.status==="Done"?(form.completedAt||todayISO()):undefined})}><Save size={15}/> 保存任务</button></div></BaseDialog> }

function ProjectDialog({open,project,onOpenChange,onSave}:{open:boolean;project:Project|null;onOpenChange:(o:boolean)=>void;onSave:(p:Project)=>void}) { const [form,setForm]=useState<Project>(blankProject());useEffect(()=>{if(open)setForm(project?{...project,risks:[...project.risks]}:blankProject())},[open,project]);const f=<K extends keyof Project>(k:K,v:Project[K])=>setForm(x=>({...x,[k]:v}));return <BaseDialog open={open} onOpenChange={onOpenChange} title={project?"编辑项目":"新建项目"} subtitle="建立一份包含背景、目标和行动的项目档案。" wide><div className="form-grid"><Field label="项目名称" wide><input autoFocus value={form.name} onChange={e=>f("name",e.target.value)}/></Field><Field label="项目类型"><input value={form.type} onChange={e=>f("type",e.target.value)}/></Field><Field label="状态"><select value={form.status} onChange={e=>f("status",e.target.value as Project["status"])}><option value="Planning">规划中</option><option value="Active">进行中</option><option value="Paused">已暂停</option><option value="Done">已完成</option></select></Field><Field label="优先级"><select value={form.priority} onChange={e=>f("priority",e.target.value as Priority)}><option>P0</option><option>P1</option><option>P2</option><option>P3</option></select></Field><Field label="进度"><input type="number" min="0" max="100" value={form.progress} onChange={e=>f("progress",+e.target.value)}/></Field><Field label="开始日期"><input type="date" value={form.startDate} onChange={e=>f("startDate",e.target.value)}/></Field><Field label="截止日期"><input type="date" value={form.dueDate} onChange={e=>f("dueDate",e.target.value)}/></Field><Field label="项目背景" wide><textarea value={form.background} onChange={e=>f("background",e.target.value)}/></Field><Field label="项目目标" wide><textarea value={form.goal} onChange={e=>f("goal",e.target.value)}/></Field><Field label="风险点（每行一条）" wide><textarea value={form.risks.join("\n")} onChange={e=>f("risks",e.target.value.split("\n").filter(Boolean))}/></Field><Field label="下一步行动" wide><input value={form.nextAction} onChange={e=>f("nextAction",e.target.value)}/></Field></div><div className="dialog-foot"><span>任务关联会自动同步</span><button className="primary" disabled={!form.name.trim()} onClick={()=>onSave(form)}><Save size={15}/> 保存项目</button></div></BaseDialog> }

function MeetingDialog({open,meeting,projects,onCreateProject,onOpenChange,onSave}:{open:boolean;meeting:Meeting|null;projects:Project[];onCreateProject:(p:Project)=>Project;onOpenChange:(o:boolean)=>void;onSave:(m:Meeting)=>void}) { const blank=():Meeting=>({id:uid("meeting"),title:"",date:`${todayISO()}T10:00`,durationMinutes:60,attendees:[],notes:"",decisions:[],actionItems:[],relatedProjectId:""});const [form,setForm]=useState<Meeting>(blank()),[actions,setActions]=useState("");useEffect(()=>{if(open){const m=meeting?{...meeting,durationMinutes:meeting.durationMinutes||0,attendees:[...meeting.attendees],decisions:[...meeting.decisions],actionItems:[...meeting.actionItems]}:blank();setForm(m);setActions(m.actionItems.map(a=>`${a.text} | ${a.owner} | ${a.dueDate}`).join("\n"))}},[open,meeting]);const f=<K extends keyof Meeting>(k:K,v:Meeting[K])=>setForm(x=>({...x,[k]:v}));const submit=()=>onSave({...form,actionItems:actions.split("\n").filter(Boolean).map((line,i)=>{const [text,owner,dueDate]=line.split("|").map(x=>x.trim());return form.actionItems[i]?.taskId?{id:form.actionItems[i].id,text,owner:owner||"我",dueDate:dueDate||todayISO(),taskId:form.actionItems[i].taskId}:{id:uid("action"),text,owner:owner||"我",dueDate:dueDate||todayISO()}})});return <BaseDialog open={open} onOpenChange={onOpenChange} title={meeting?"编辑会议":"新建会议"} subtitle="记录讨论、决策与可执行的行动项。" wide><div className="form-grid"><Field label="会议名称" wide><input autoFocus value={form.title} onChange={e=>f("title",e.target.value)}/></Field><Field label="日期与时间"><input type="datetime-local" value={form.date} onChange={e=>f("date",e.target.value)}/></Field><Field label="会议耗时（分钟）"><input type="number" min="0" step="5" value={form.durationMinutes||0} onChange={e=>f("durationMinutes",+e.target.value)}/></Field><ProjectSelect label="关联项目" value={form.relatedProjectId} projects={projects} onChange={v=>f("relatedProjectId",v)} onCreateProject={onCreateProject}/><Field label="参会人（逗号分隔）" wide><input value={form.attendees.join(", ")} onChange={e=>f("attendees",e.target.value.split(/[,，]/).map(x=>x.trim()).filter(Boolean))}/></Field><Field label="会议纪要" wide><textarea value={form.notes} onChange={e=>f("notes",e.target.value)}/></Field><Field label="决策事项（每行一条）" wide><textarea value={form.decisions.join("\n")} onChange={e=>f("decisions",e.target.value.split("\n").filter(Boolean))}/></Field><Field label="行动项（内容 | 负责人 | YYYY-MM-DD）" wide><textarea value={actions} onChange={e=>setActions(e.target.value)} placeholder="整理复盘材料 | 我 | 2026-06-25"/></Field></div><div className="dialog-foot"><span>保存后可一键生成任务</span><button className="primary" disabled={!form.title.trim()} onClick={submit}><Save size={15}/> 保存会议</button></div></BaseDialog> }

function ReflectionDialog({open,reflection,data,onCreateProject,onOpenChange,onSave}:{open:boolean;reflection:Reflection|null;data:WorkData;onCreateProject:(p:Project)=>Project;onOpenChange:(o:boolean)=>void;onSave:(r:Reflection)=>void}) { const blank=():Reflection=>({id:uid("reflection"),title:"",content:"",type:"问题复盘",relatedProjectId:"",relatedTaskId:"",date:todayISO(),durationMinutes:0,tags:[]});const [form,setForm]=useState<Reflection>(blank());useEffect(()=>{if(open)setForm(reflection?{...reflection,durationMinutes:reflection.durationMinutes||0,tags:[...reflection.tags]}:blank())},[open,reflection]);const f=<K extends keyof Reflection>(k:K,v:Reflection[K])=>setForm(x=>({...x,[k]:v}));const tasks=data.tasks.filter(t=>!form.relatedProjectId||t.projectId===form.relatedProjectId);const exists=!!reflection&&data.reflections.some(r=>r.id===reflection.id);return <BaseDialog open={open} onOpenChange={onOpenChange} title={exists?"编辑复盘":"记录复盘"} subtitle="把思考放回具体项目和任务的上下文中。" wide><div className="form-grid"><Field label="复盘标题" wide><input autoFocus value={form.title} onChange={e=>f("title",e.target.value)}/></Field><Field label="复盘类型"><select value={form.type} onChange={e=>f("type",e.target.value as ReflectionType)}>{["问题复盘","流程优化","风险提醒","经验沉淀","自动化想法","管理思考"].map(x=><option key={x}>{x}</option>)}</select></Field><Field label="日期"><input type="date" value={form.date} onChange={e=>f("date",e.target.value)}/></Field><Field label="思考耗时（分钟）"><input type="number" min="0" step="5" value={form.durationMinutes||0} onChange={e=>f("durationMinutes",+e.target.value)}/></Field><ProjectSelect label="关联项目" value={form.relatedProjectId} projects={data.projects} onChange={v=>{f("relatedProjectId",v);if(!data.tasks.some(t=>t.id===form.relatedTaskId&&t.projectId===v))f("relatedTaskId","")}} onCreateProject={onCreateProject}/><Field label="关联任务"><select value={form.relatedTaskId} onChange={e=>{const t=data.tasks.find(x=>x.id===e.target.value);f("relatedTaskId",e.target.value);if(t&&!form.relatedProjectId)f("relatedProjectId",t.projectId)}}><option value="">不关联任务</option>{tasks.map(t=><option key={t.id} value={t.id}>{t.title}</option>)}</select></Field><Field label="复盘内容" wide><textarea value={form.content} onChange={e=>f("content",e.target.value)} placeholder="发生了什么？为什么？下次如何做？"/></Field><Field label="标签（逗号分隔）" wide><input value={form.tags.join(", ")} onChange={e=>f("tags",e.target.value.split(/[,，]/).map(x=>x.trim()).filter(Boolean))}/></Field></div><div className="dialog-foot"><span>{form.relatedProjectId||form.relatedTaskId?"将显示在关联档案中":"当前选择：不关联"}</span><button className="primary" disabled={!form.title.trim()} onClick={()=>onSave(form)}><Save size={15}/> 保存复盘</button></div></BaseDialog> }

function TaskDetail({open,task,data,onClose,onEdit,onDelete,onReflection,onProject,onStartTimer,onPauseTimer,onStopTimer}:{open:boolean;task:Task|null;data:WorkData;onClose:()=>void;onEdit:(t:Task)=>void;onDelete:(t:Task)=>void;onReflection:()=>void;onProject:(p:Project)=>void;onStartTimer:(t:Task)=>void;onPauseTimer:(t:Task)=>void;onStopTimer:(t:Task)=>void}) { const refs=task?data.reflections.filter(r=>r.relatedTaskId===task.id):[],project=task?data.projects.find(p=>p.id===task.projectId):undefined,running=!!task?.timeTracking?.isRunning;return <BaseDialog open={open} onOpenChange={o=>!o&&onClose()} title={task?.title||"任务详情"} subtitle="任务上下文、耗时与相关复盘" wide>{task&&<><div className="detail-body"><div className="detail-kpis"><span>状态<b>{task.status}</b></span><span>优先级<b>{task.priority}</b></span><span>预估<b>{hoursLabel(task.estimatedHours)}</b></span><span>实际<b>{durationLabel(taskSeconds(task))}</b></span></div><DetailSection title="真实计时"><div className={cn("timer-detail",running&&"running")}><Timer size={18}/><div><strong>{durationLabel(taskSeconds(task))}</strong><span>{running?"正在计时":"当前累计"}</span></div><div>{running?<><button className="secondary" onClick={()=>onPauseTimer(task)}><Pause size={14}/> 暂停</button><button className="primary" onClick={()=>onStopTimer(task)}><Check size={14}/> 结束计时</button></>:<button className="primary" onClick={()=>onStartTimer(task)}><Play size={14}/> 开始计时</button>}</div></div></DetailSection><DetailSection title="基础信息"><p>{task.description||"暂无描述"}</p><div className="detail-meta"><span>来源：{task.source}</span><span>提出人：{task.requester}</span><span>截止：{task.dueDate||"未设置"}</span></div>{task.notes&&<p className="detail-note">{task.notes}</p>}</DetailSection><DetailSection title="相关项目">{project?<button className="linked-row" onClick={()=>onProject(project)}><FolderKanban size={16}/><div><strong>{project.name}</strong><span>{project.progress}% · {project.nextAction}</span></div><ArrowRight size={15}/></button>:<p>未关联项目</p>}</DetailSection><DetailSection title={`相关复盘 · ${refs.length}`}>{refs.map(r=><div className="linked-row" key={r.id}><Brain size={16}/><div><strong>{r.title}</strong><span>{r.type} · {r.date}</span></div></div>)}<button className="secondary small" onClick={onReflection}><Plus size={13}/> 基于此任务写复盘</button></DetailSection></div><div className="dialog-foot"><button className="danger-link" onClick={()=>onDelete(task)}><Trash2 size={14}/> 删除</button><div><button className="secondary" onClick={()=>onEdit(task)}>编辑任务</button></div></div></>}</BaseDialog> }

function ProjectDetail({open,project,data,onClose,onEdit,onDelete,onTask,onReflection}:{open:boolean;project:Project|null;data:WorkData;onClose:()=>void;onEdit:(p:Project)=>void;onDelete:(p:Project)=>void;onTask:(t:Task)=>void;onReflection:(r:Reflection)=>void}) { const tasks=project?data.tasks.filter(t=>t.projectId===project.id):[],meetings=project?data.meetings.filter(m=>m.relatedProjectId===project.id):[],refs=project?data.reflections.filter(r=>r.relatedProjectId===project.id):[],hours=tasks.reduce((s,t)=>s+t.actualHours,0);return <BaseDialog open={open} onOpenChange={o=>!o&&onClose()} title={project?.name||"项目档案"} subtitle="项目任务、会议、复盘和风险的统一上下文" wide>{project&&<><div className="detail-body"><div className="detail-kpis"><span>项目状态<b>{project.status}</b></span><span>整体进度<b>{project.progress}%</b></span><span>任务数<b>{tasks.length}</b></span><span>已用工时<b>{hours.toFixed(1)}h</b></span></div><DetailSection title="背景与目标"><p><b>背景：</b>{project.background}</p><p><b>目标：</b>{project.goal}</p></DetailSection><DetailSection title="下一步与风险"><p><b>下一步：</b>{project.nextAction||"待补充"}</p>{project.risks.length?project.risks.map(x=><div className="risk-chip" key={x}>{x}</div>):<p>暂无风险</p>}</DetailSection><DetailSection title={`相关任务 · ${tasks.length}`}>{tasks.map(t=><button className="linked-row" key={t.id} onClick={()=>onTask(t)}><CheckCircle2 size={16}/><div><strong>{t.title}</strong><span>{t.status} · {hoursLabel(t.actualHours)}/{hoursLabel(t.estimatedHours)}</span></div><ArrowRight size={15}/></button>)}</DetailSection><DetailSection title={`相关会议 · ${meetings.length}`}>{meetings.map(m=><div className="linked-row" key={m.id}><CalendarDays size={16}/><div><strong>{m.title}</strong><span>{m.date.slice(0,10)} · {m.actionItems.length} 个行动项</span></div></div>)}</DetailSection><DetailSection title={`相关复盘 · ${refs.length}`}>{refs.map(r=><button className="linked-row" key={r.id} onClick={()=>onReflection(r)}><Brain size={16}/><div><strong>{r.title}</strong><span>{r.type} · {r.date}</span></div><ArrowRight size={15}/></button>)}</DetailSection></div><div className="dialog-foot"><button className="danger-link" onClick={()=>onDelete(project)}><Trash2 size={14}/> 删除项目</button><button className="primary" onClick={()=>onEdit(project)}>编辑项目</button></div></>}</BaseDialog> }
function ReflectionDetail({open,reflection,data,onClose,onEdit,onDelete}:{open:boolean;reflection:Reflection|null;data:WorkData;onClose:()=>void;onEdit:(r:Reflection)=>void;onDelete:(r:Reflection)=>void}) { const p=reflection?data.projects.find(x=>x.id===reflection.relatedProjectId):undefined,t=reflection?data.tasks.find(x=>x.id===reflection.relatedTaskId):undefined;return <BaseDialog open={open} onOpenChange={o=>!o&&onClose()} title={reflection?.title||"复盘详情"} subtitle="有依据的工作思考" wide>{reflection&&<><div className="detail-body"><div className="detail-kpis"><span>类型<b>{reflection.type}</b></span><span>日期<b>{reflection.date}</b></span><span>关联项目<b>{p?.name||"无"}</b></span><span>关联任务<b>{t?.title||"无"}</b></span></div><DetailSection title="复盘内容"><p className="reflection-content">{reflection.content}</p></DetailSection><DetailSection title="标签"><div className="tag-list">{reflection.tags.map(x=><span key={x}>{x}</span>)}</div></DetailSection></div><div className="dialog-foot"><button className="danger-link" onClick={()=>onDelete(reflection)}><Trash2 size={14}/> 删除</button><button className="primary" onClick={()=>onEdit(reflection)}>编辑复盘</button></div></>}</BaseDialog> }
function DetailSection({title,children}:{title:string;children:React.ReactNode}){return <section className="detail-section"><h3>{title}</h3>{children}</section>}
function SettingsDialog({open,onClose,data,mode,onReset,notify}:{open:boolean;onClose:()=>void;data:WorkData;mode:RepositoryMode;onReset:()=>void;notify:(s:string)=>void}) {
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
      <div><strong>{mode==="supabase"?"当前数据":"本地数据"}</strong><p>{data.tasks.length} 个任务 · {data.projects.length} 个项目 · {data.reflections.length} 条复盘 · {data.reports.length} 份报告</p></div>
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
      <div className="migration-card"><Sparkles size={18}/><div><strong>是否导入云端？</strong><p>将导入 {data.tasks.length} 个任务、{data.projects.length} 个项目、{data.meetings.length} 场会议、{data.reflections.length} 条复盘和 {data.reports.length} 份报告。</p></div></div>
      <div className="migration-checks"><span>✓ 多设备同步</span><span>✓ 本地数据保留</span><span>✓ 可继续导出备份</span></div>
    </div>
    <div className="dialog-foot"><button className="ghost" disabled={!!busy} onClick={onLater}>稍后再说</button><div><button className="secondary" disabled={!!busy} onClick={()=>run("cloud",onCloudOnly)}>{busy==="cloud"?"读取中...":"仅使用云端数据"}</button><button className="primary" disabled={!!busy} onClick={()=>run("import",onImport)}>{busy==="import"?"导入中...":"导入云端"}</button></div></div>
  </BaseDialog>
}
