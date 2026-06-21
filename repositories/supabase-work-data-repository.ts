import { SupabaseClient } from "@supabase/supabase-js";
import { Meeting, Project, Reflection, Report, Task, TimeTracking, WorkData } from "@/lib/types";
import { WorkDataRepository } from "./work-data-repository";

type Client = SupabaseClient;

const emptyTracking = (): TimeTracking => ({
  isRunning: false,
  startedAt: null,
  accumulatedSeconds: 0,
  lastPausedAt: null,
  sessions: [],
});

export class SupabaseWorkDataRepository implements WorkDataRepository {
  constructor(private readonly supabase: Client, private readonly userId: string) {}

  async load(): Promise<WorkData> {
    const [projects, tasks, timeSessions, meetings, actionItems, reflections, reports] = await Promise.all([
      this.supabase.from("projects").select("*").eq("user_id", this.userId).order("created_at", { ascending: false }),
      this.supabase.from("tasks").select("*").eq("user_id", this.userId).order("created_at", { ascending: false }),
      this.supabase.from("time_sessions").select("*").eq("user_id", this.userId).order("start_time", { ascending: true }),
      this.supabase.from("meetings").select("*").eq("user_id", this.userId).order("date", { ascending: false }),
      this.supabase.from("meeting_action_items").select("*").eq("user_id", this.userId).order("created_at", { ascending: true }),
      this.supabase.from("reflections").select("*").eq("user_id", this.userId).order("date", { ascending: false }),
      this.supabase.from("reports").select("*").eq("user_id", this.userId).order("created_at", { ascending: false }),
    ]);

    const firstError = [projects.error, tasks.error, timeSessions.error, meetings.error, actionItems.error, reflections.error, reports.error].find(Boolean);
    if (firstError) throw firstError;

    const taskMap = new Map<string, TimeTracking>();
    for (const row of timeSessions.data ?? []) {
      const current = taskMap.get(row.task_id) ?? emptyTracking();
      const duration = Number(row.duration_seconds || 0);
      taskMap.set(row.task_id, {
        isRunning: row.is_running,
        startedAt: row.is_running ? row.start_time : null,
        accumulatedSeconds: current.accumulatedSeconds + duration,
        lastPausedAt: row.end_time,
        sessions: row.end_time ? [...current.sessions, { startTime: row.start_time, endTime: row.end_time, durationSeconds: duration }] : current.sessions,
      });
    }

    const mappedProjects: Project[] = (projects.data ?? []).map(row => ({
      id: row.id,
      name: row.name,
      type: row.type ?? "",
      background: row.background ?? "",
      goal: row.goal ?? "",
      status: row.status as Project["status"],
      priority: row.priority as Project["priority"],
      progress: row.progress ?? 0,
      startDate: row.start_date ?? "",
      dueDate: row.due_date ?? "",
      relatedTaskIds: (tasks.data ?? []).filter(task => task.project_id === row.id).map(task => task.id),
      risks: row.risks ?? [],
      nextAction: row.next_action ?? "",
    }));

    const mappedTasks: Task[] = (tasks.data ?? []).map(row => {
      const tracking = taskMap.get(row.id) ?? emptyTracking();
      return {
        id: row.id,
        title: row.title,
        description: row.description ?? "",
        source: row.source ?? "",
        requester: row.requester ?? "",
        projectId: row.project_id ?? "",
        status: row.status as Task["status"],
        priority: row.priority as Task["priority"],
        dueDate: row.due_date ?? "",
        estimatedHours: Number(row.estimated_hours || 0),
        actualHours: tracking.accumulatedSeconds / 3600,
        createdAt: row.created_at.slice(0, 10),
        completedAt: row.completed_at ?? undefined,
        tags: row.tags ?? [],
        notes: row.notes ?? "",
        waitingFor: row.waiting_for ?? "",
        timeTracking: tracking,
      };
    });

    const mappedMeetings: Meeting[] = (meetings.data ?? []).map(row => ({
      id: row.id,
      title: row.title,
      date: row.date,
      durationMinutes: row.duration_minutes,
      attendees: row.attendees ?? [],
      notes: row.notes ?? "",
      decisions: row.decisions ?? [],
      relatedProjectId: row.related_project_id ?? "",
      actionItems: (actionItems.data ?? []).filter(item => item.meeting_id === row.id).map(item => ({
        id: item.id,
        text: item.text,
        owner: item.owner ?? "",
        dueDate: item.due_date ?? "",
        taskId: item.task_id ?? undefined,
      })),
    }));

    const mappedReflections: Reflection[] = (reflections.data ?? []).map(row => ({
      id: row.id,
      title: row.title,
      content: row.content ?? "",
      type: row.type as Reflection["type"],
      relatedProjectId: row.related_project_id ?? "",
      relatedTaskId: row.related_task_id ?? "",
      date: row.date,
      durationMinutes: row.duration_minutes,
      tags: row.tags ?? [],
    }));

    const mappedReports: Report[] = (reports.data ?? []).map(row => ({
      id: row.id,
      title: row.title,
      type: row.type as Report["type"],
      startDate: row.start_date,
      endDate: row.end_date,
      generatedContent: row.generated_content,
      includedTaskIds: row.included_task_ids ?? [],
      includedReflectionIds: row.included_reflection_ids ?? [],
      createdAt: row.created_at,
      options: row.options as Report["options"],
    }));

    return {
      version: 2,
      tasks: mappedTasks,
      projects: mappedProjects,
      meetings: mappedMeetings,
      reflections: mappedReflections,
      reports: mappedReports,
    };
  }

  async save(data: WorkData): Promise<void> {
    await this.upsertProjects(data.projects);
    await this.upsertTasks(data.tasks);
    await this.replaceTimeSessions(data.tasks);
    await this.upsertMeetings(data.meetings);
    await this.replaceMeetingActionItems(data.meetings);
    await this.upsertReflections(data.reflections);
    await this.upsertReports(data.reports);
    await this.deleteMissingRows("reports", data.reports.map(report => report.id));
    await this.deleteMissingRows("reflections", data.reflections.map(reflection => reflection.id));
    await this.deleteMissingRows("meetings", data.meetings.map(meeting => meeting.id));
    await this.deleteMissingRows("tasks", data.tasks.map(task => task.id));
    await this.deleteMissingRows("projects", data.projects.map(project => project.id));
  }

  async clear(): Promise<void> {
    for (const table of ["reports", "reflections", "meeting_action_items", "meetings", "time_sessions", "tasks", "projects"] as const) {
      const { error } = await this.supabase.from(table).delete().eq("user_id", this.userId);
      if (error) throw error;
    }
  }

  private async upsertProjects(projects: Project[]) {
    const rows = projects.map(project => ({
      id: project.id,
      user_id: this.userId,
      name: project.name,
      type: project.type,
      background: project.background,
      goal: project.goal,
      status: project.status,
      priority: project.priority,
      progress: project.progress,
      start_date: project.startDate || null,
      due_date: project.dueDate || null,
      risks: project.risks,
      next_action: project.nextAction,
    }));
    if (rows.length) {
      const { error } = await this.supabase.from("projects").upsert(rows);
      if (error) throw error;
    }
  }

  private async upsertTasks(tasks: Task[]) {
    const rows = tasks.map(task => ({
      id: task.id,
      user_id: this.userId,
      title: task.title,
      description: task.description,
      source: task.source,
      requester: task.requester,
      project_id: task.projectId || null,
      status: task.status,
      priority: task.priority,
      due_date: task.dueDate || null,
      estimated_hours: task.estimatedHours,
      notes: task.notes,
      waiting_for: task.waitingFor || null,
      tags: task.tags,
      created_at: task.createdAt,
      completed_at: task.completedAt ?? null,
    }));
    if (rows.length) {
      const { error } = await this.supabase.from("tasks").upsert(rows);
      if (error) throw error;
    }
  }

  private async replaceTimeSessions(tasks: Task[]) {
    const { error: deleteError } = await this.supabase.from("time_sessions").delete().eq("user_id", this.userId);
    if (deleteError) throw deleteError;

    const rows = tasks.flatMap(task => {
      const sessions: {
        user_id: string;
        task_id: string;
        start_time: string;
        end_time: string | null;
        duration_seconds: number;
        is_running: boolean;
      }[] = task.timeTracking.sessions.map(session => ({
        user_id: this.userId,
        task_id: task.id,
        start_time: session.startTime,
        end_time: session.endTime,
        duration_seconds: session.durationSeconds,
        is_running: false,
      }));
      if (task.timeTracking.isRunning && task.timeTracking.startedAt) {
        sessions.push({
          user_id: this.userId,
          task_id: task.id,
          start_time: task.timeTracking.startedAt,
          end_time: null,
          duration_seconds: task.timeTracking.accumulatedSeconds,
          is_running: true,
        });
      }
      return sessions;
    });

    if (rows.length) {
      const { error } = await this.supabase.from("time_sessions").insert(rows);
      if (error) throw error;
    }
  }

  private async upsertMeetings(meetings: Meeting[]) {
    const rows = meetings.map(meeting => ({
      id: meeting.id,
      user_id: this.userId,
      title: meeting.title,
      date: meeting.date,
      duration_minutes: meeting.durationMinutes ?? 0,
      attendees: meeting.attendees,
      notes: meeting.notes,
      decisions: meeting.decisions,
      related_project_id: meeting.relatedProjectId || null,
    }));
    if (rows.length) {
      const { error } = await this.supabase.from("meetings").upsert(rows);
      if (error) throw error;
    }
  }

  private async replaceMeetingActionItems(meetings: Meeting[]) {
    const { error: deleteError } = await this.supabase.from("meeting_action_items").delete().eq("user_id", this.userId);
    if (deleteError) throw deleteError;
    const rows = meetings.flatMap(meeting => meeting.actionItems.map(item => ({
      id: item.id,
      user_id: this.userId,
      meeting_id: meeting.id,
      text: item.text,
      owner: item.owner,
      due_date: item.dueDate || null,
      task_id: item.taskId ?? null,
    })));
    if (rows.length) {
      const { error } = await this.supabase.from("meeting_action_items").insert(rows);
      if (error) throw error;
    }
  }

  private async upsertReflections(reflections: Reflection[]) {
    const rows = reflections.map(reflection => ({
      id: reflection.id,
      user_id: this.userId,
      title: reflection.title,
      content: reflection.content,
      type: reflection.type,
      related_project_id: reflection.relatedProjectId || null,
      related_task_id: reflection.relatedTaskId || null,
      date: reflection.date,
      duration_minutes: reflection.durationMinutes ?? 0,
      tags: reflection.tags,
    }));
    if (rows.length) {
      const { error } = await this.supabase.from("reflections").upsert(rows);
      if (error) throw error;
    }
  }

  private async upsertReports(reports: Report[]) {
    const rows = reports.map(report => ({
      id: report.id,
      user_id: this.userId,
      title: report.title,
      type: report.type,
      start_date: report.startDate,
      end_date: report.endDate,
      generated_content: report.generatedContent,
      included_task_ids: report.includedTaskIds,
      included_reflection_ids: report.includedReflectionIds,
      options: report.options,
      created_at: report.createdAt,
    }));
    if (rows.length) {
      const { error } = await this.supabase.from("reports").upsert(rows);
      if (error) throw error;
    }
  }

  private async deleteMissingRows(table: "projects" | "tasks" | "meetings" | "reflections" | "reports", ids: string[]) {
    const query = this.supabase.from(table).delete().eq("user_id", this.userId);
    const { error } = ids.length
      ? await query.not("id", "in", `(${ids.map(id => `"${id.replace(/"/g, '\\"')}"`).join(",")})`)
      : await query;
    if (error) throw error;
  }
}
