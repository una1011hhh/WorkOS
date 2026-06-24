import { format, isAfter, isBefore, parseISO } from "date-fns";
import { Project, Reflection, ReportOptions, Task, WorkData } from "./types";

const inRange = (date: string | undefined, start: string, end: string) => {
  if (!date) return false;
  const d = parseISO(date), s = parseISO(start), e = parseISO(end);
  return !isBefore(d, s) && !isAfter(d, e);
};
const projectName = (projects: Project[], id: string) => projects.find(p => p.id === id)?.name || "未关联项目";
const taskName = (tasks: Task[], id: string) => tasks.find(t => t.id === id)?.title || "未关联任务";
const isCompletedTaskStatus = (status: string | undefined) => ["done", "completed", "已完成", "完成"].includes(String(status || "").trim().toLocaleLowerCase("zh-CN"));
const relatedProjectTasks = (data: WorkData, project: Project) => {
  const relatedIds = new Set(project.relatedTaskIds || []);
  return data.tasks.filter(task => task.projectId === project.id || relatedIds.has(task.id));
};
const projectProgress = (project: Project, tasks: Task[]) => {
  const total = tasks.length;
  const completed = tasks.filter(task => isCompletedTaskStatus(task.status)).length;
  const progress = total > 0 ? Math.round((completed / total) * 100) : project.progress;
  return { total, completed, progress: Math.max(0, Math.min(100, progress)) };
};
const actualSeconds = (task: Task) => {
  const tracked = task.timeTracking;
  if (!tracked) return Math.round((task.actualHours || 0) * 3600);
  if (tracked.sessions?.length) {
    const sessionSeconds = tracked.sessions.reduce((sum, session) => sum + Math.max(0, Math.round(Number(session.correctedDuration ?? session.durationSeconds ?? 0))), 0);
    const running = tracked.isRunning && tracked.startedAt ? Math.max(0, Math.floor((Date.now() - new Date(tracked.startedAt).getTime()) / 1000)) : 0;
    return sessionSeconds + running;
  }
  const running = tracked.isRunning && tracked.startedAt ? Math.max(0, Math.floor((Date.now() - new Date(tracked.startedAt).getTime()) / 1000)) : 0;
  return tracked.accumulatedSeconds + running;
};
const actualHours = (task: Task) => actualSeconds(task) / 3600;

export function generateReportContent(data: WorkData, startDate: string, endDate: string, options: ReportOptions) {
  const completed = data.tasks.filter(t => isCompletedTaskStatus(t.status) && inRange(t.completedAt, startDate, endDate));
  const createdInRange = data.tasks.filter(t => inRange(t.createdAt, startDate, endDate));
  const active = data.tasks.filter(t => ["Todo", "Doing"].includes(t.status));
  const waiting = data.tasks.filter(t => t.status === "Waiting");
  const overdue = data.tasks.filter(t => !isCompletedTaskStatus(t.status) && t.dueDate && isBefore(parseISO(t.dueDate), new Date()));
  const reflections = data.reflections.filter(r => inRange(r.date, startDate, endDate));
  const usedProjectIds = new Set([...completed, ...active, ...waiting].map(t => t.projectId).filter(Boolean));
  const projects = data.projects.filter(p => usedProjectIds.has(p.id));
  const totalEstimated = [...completed, ...createdInRange.filter(t => !isCompletedTaskStatus(t.status))].reduce((s, t) => s + t.estimatedHours, 0);
  const totalActual = [...completed, ...createdInRange.filter(t => !isCompletedTaskStatus(t.status))].reduce((s, t) => s + actualHours(t), 0);
  const byProject = completed.reduce<Map<string, Task[]>>((groups, task) => {
    const key = task.projectId || "none";
    groups.set(key, [...(groups.get(key) || []), task]);
    return groups;
  }, new Map());
  const lines: string[] = [];

  lines.push(`# 本周期工作总结`, "", `> 时间范围：${startDate} — ${endDate}`, "");
  lines.push("## 一、核心完成事项", "");
  if (!completed.length) lines.push("- 本周期暂无已完成任务。", "");
  for (const [projectId, tasks] of byProject) {
    lines.push(`### ${projectName(data.projects, projectId)}`);
    tasks.forEach(t => lines.push(`- ${t.title}（${t.completedAt}，实际 ${actualHours(t).toFixed(1)}h）`));
    lines.push("");
  }

  if (options.projectProgress) {
    lines.push("## 二、重点项目推进", "");
    if (!projects.length) lines.push("- 本周期暂无关联项目推进记录。", "");
    projects.forEach(p => {
      const projectTasks = relatedProjectTasks(data, p);
      const summary = projectProgress(p, projectTasks);
      lines.push(`### ${p.name}`, `- 本周期进展：${summary.completed}/${summary.total} 项任务完成，整体进度 ${summary.progress}%`, `- 当前状态：${p.status}`, `- 风险 / 阻塞点：${p.risks.join("；") || "暂无"}`, `- 下一步计划：${p.nextAction || "待补充"}`, "");
    });
  }

  if (options.reflections) {
    lines.push("## 三、问题与复盘", "");
    if (!reflections.length) lines.push("- 本周期暂无复盘记录。", "");
    reflections.forEach(r => lines.push(`- **${r.title}**（${r.type}｜项目：${projectName(data.projects, r.relatedProjectId)}｜任务：${taskName(data.tasks, r.relatedTaskId)}）\n  ${r.content}`));
    lines.push("");
  }

  if (options.timeStats) {
    const variance = totalEstimated ? ((totalActual - totalEstimated) / totalEstimated * 100) : 0;
    lines.push("## 四、耗时与效率分析", "", `- 总实际工作量：${totalActual.toFixed(1)}h`, `- 总预估工作量：${totalEstimated.toFixed(1)}h`, `- 预估偏差：${variance >= 0 ? "+" : ""}${variance.toFixed(0)}%`);
    projects.forEach(p => {
      const hours = data.tasks.filter(t => t.projectId === p.id).reduce((s, t) => s + actualHours(t), 0);
      lines.push(`- ${p.name}：${hours.toFixed(1)}h`);
    });
    const byTag = new Map<string, number>();
    [...completed, ...createdInRange].forEach(t => ((t.subtasks || []).length ? ["含子任务"] : ["无子任务"]).forEach(tag => byTag.set(tag, (byTag.get(tag) || 0) + actualHours(t))));
    if (byTag.size) lines.push(`- 按任务类型耗时：${[...byTag.entries()].map(([tag, hours]) => `${tag} ${hours.toFixed(1)}h`).join("；")}`);
    const underestimated = completed.filter(t => actualHours(t) > t.estimatedHours * 1.15);
    if (underestimated.length) lines.push(`- 容易低估的任务：${underestimated.map(t => t.title).join("、")}`);
    const overEstimate = completed.filter(t => actualHours(t) > t.estimatedHours);
    if (overEstimate.length) lines.push(`- 超出预估：${overEstimate.map(t => `${t.title}（预估 ${t.estimatedHours.toFixed(1)}h / 实际 ${actualHours(t).toFixed(1)}h）`).join("；")}`);
    lines.push("");
  }

  if (options.waiting && (waiting.length || overdue.length)) {
    lines.push("## 五、风险与 Waiting 事项", "");
    waiting.forEach(t => lines.push(`- [等待] ${t.title} — 等待 ${t.waitingFor || "外部反馈"}${t.waitingReason ? `：${t.waitingReason}` : ""}${t.followUpDate ? `（跟进 ${t.followUpDate}）` : ""}`));
    overdue.forEach(t => lines.push(`- [延期] ${t.title} — 原截止日期 ${t.dueDate}`));
    lines.push("");
  }

  if (options.nextPlan) {
    lines.push("## 六、下阶段计划", "");
    if (!active.length && !waiting.length) lines.push("- 暂无未完成事项。", "");
    [...active, ...waiting].sort((a, b) => a.priority.localeCompare(b.priority)).slice(0, 12).forEach(t => lines.push(`- [${t.priority}] ${t.title}（${projectName(data.projects, t.projectId)}，截止 ${t.dueDate || "未设置"}）`));
    lines.push("");
  }
  return lines.join("\n");
}
