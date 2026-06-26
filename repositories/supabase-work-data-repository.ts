import { SupabaseClient } from "@supabase/supabase-js";
import { Contact, ContactGroup, Meeting, Project, Reflection, Report, Subtask, Task, TimeSession, TimeTracking, WorkData } from "@/lib/types";
import { calculateDurationSeconds, formatLocalDateTime, localDate } from "@/lib/time";
import { WorkDataRepository } from "./work-data-repository";

type Client = SupabaseClient;

const emptyTracking = (): TimeTracking => ({
  isRunning: false,
  startedAt: null,
  accumulatedSeconds: 0,
  lastPausedAt: null,
  sessions: [],
});
const toDateTimeLocal = (value?: string | null) => formatLocalDateTime(value);
const effectiveSessionDuration = (session: TimeSession) => Math.max(0, Number(session.correctedDuration ?? session.durationSeconds ?? 0));
const normalizeSubtasks = (value: unknown): Subtask[] => {
  if (!Array.isArray(value)) return [];
  return value.map((item: any, index) => ({
    id: item?.id || `subtask-${index}`,
    title: String(item?.title || "").trim(),
    done: Boolean(item?.done),
    order: Number.isFinite(Number(item?.order)) ? Number(item.order) : index,
    createdAt: item?.createdAt || localDate(),
    updatedAt: item?.updatedAt,
  })).filter(item => item.title).sort((a, b) => a.order - b.order);
};
const computedDurationSeconds = (startTime: string, endTime: string) => {
  return calculateDurationSeconds(startTime, endTime);
};
const normalizePersonKey = (value?: string | null) => String(value ?? "").trim().toLocaleLowerCase("zh-CN");
const findContactId = (contacts: any[], value?: string | null) => {
  const key = normalizePersonKey(value);
  if (!key) return "";
  return contacts.find(contact =>
    normalizePersonKey(contact.id) === key
    || normalizePersonKey(contact.name) === key
    || normalizePersonKey(contact.email) === key
  )?.id ?? "";
};

export class SupabaseWorkDataRepository implements WorkDataRepository {
  constructor(private readonly supabase: Client, private readonly userId: string) {}

  private async fetchAllRows(table: "contacts" | "contact_groups", orderColumn: string) {
    const pageSize = 1000;
    const rows: any[] = [];
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await this.supabase
        .from(table)
        .select("*")
        .eq("user_id", this.userId)
        .order(orderColumn, { ascending: false })
        .range(from, from + pageSize - 1);
      if (error) throw error;
      rows.push(...(data ?? []));
      if ((data ?? []).length < pageSize) break;
    }
    return rows;
  }

  async load(): Promise<WorkData> {
    const [projects, tasks, timeSessions, meetings, actionItems, reflections, reports, contacts, contactGroups] = await Promise.all([
      this.supabase.from("projects").select("*").eq("user_id", this.userId).order("created_at", { ascending: false }),
      this.supabase.from("tasks").select("*").eq("user_id", this.userId).order("created_at", { ascending: false }),
      this.supabase.from("time_sessions").select("*").eq("user_id", this.userId).order("start_time", { ascending: true }),
      this.supabase.from("meetings").select("*").eq("user_id", this.userId).order("date", { ascending: false }),
      this.supabase.from("meeting_action_items").select("*").eq("user_id", this.userId).order("created_at", { ascending: true }),
      this.supabase.from("reflections").select("*").eq("user_id", this.userId).order("date", { ascending: false }),
      this.supabase.from("reports").select("*").eq("user_id", this.userId).order("created_at", { ascending: false }),
      this.fetchAllRows("contacts", "updated_at").then(data => ({ data, error: null })),
      this.fetchAllRows("contact_groups", "updated_at").then(data => ({ data, error: null })),
    ]);

    const firstError = [projects.error, tasks.error, timeSessions.error, meetings.error, actionItems.error, reflections.error, reports.error, contacts.error, contactGroups.error].find(Boolean);
    if (firstError) throw firstError;

    const taskMap = new Map<string, TimeTracking>();
    const seenTimeSessions = new Set<string>();
    for (const row of timeSessions.data ?? []) {
      const session: TimeSession = {
        startTime: row.start_time,
        endTime: row.end_time ?? "",
        durationSeconds: Number(row.duration_seconds || 0),
        note: row.note ?? undefined,
        suspectedForgotToStop: Boolean(row.suspected_forgot_to_stop),
        originalStartTime: row.original_start_time ?? undefined,
        originalEndTime: row.original_end_time ?? undefined,
        originalDuration: row.original_duration ?? undefined,
        correctedStartTime: row.corrected_start_time ?? undefined,
        correctedEndTime: row.corrected_end_time ?? undefined,
        correctedDuration: row.corrected_duration ?? undefined,
        correctedNote: row.corrected_note ?? undefined,
        editedBy: row.edited_by ?? undefined,
        editedAt: row.edited_at ?? undefined,
        editReason: row.edit_reason ?? undefined,
      };
      const duration = effectiveSessionDuration(session);
      const sessionKey = [row.task_id, row.start_time, row.end_time || "", duration, row.is_running ? "running" : "done"].join("|");
      if (seenTimeSessions.has(sessionKey)) continue;
      seenTimeSessions.add(sessionKey);
      const current = taskMap.get(row.task_id) ?? emptyTracking();
      taskMap.set(row.task_id, {
        isRunning: false,
        startedAt: null,
        accumulatedSeconds: current.accumulatedSeconds + duration,
        lastPausedAt: row.end_time,
        sessions: row.end_time ? [...current.sessions, session] : current.sessions,
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
      const requesterContactId = (row as any).requester_contact_id ?? findContactId(contacts.data ?? [], row.requester);
      const createdByContactId = (row as any).created_by_contact_id ?? findContactId(contacts.data ?? [], (row as any).created_by ?? row.requester);
      const waitingForId = (row as any).waiting_for_id || (row.waiting_for ? findContactId(contacts.data ?? [], row.waiting_for) : "");
      return {
        id: row.id,
        title: row.title,
        description: row.description ?? "",
        source: row.source ?? "",
        requester: row.requester ?? "",
        requesterContactId,
        createdBy: (row as any).created_by ?? row.requester ?? "自己",
        createdByContactId,
        projectId: row.project_id ?? "",
        status: row.status as Task["status"],
        priority: row.priority as Task["priority"],
        dueDate: row.due_date ?? "",
        estimatedHours: Number(row.estimated_hours || 0),
        actualHours: tracking.accumulatedSeconds / 3600,
        createdAt: row.created_at.slice(0, 10),
        completedAt: row.completed_at ?? undefined,
        subtasks: normalizeSubtasks((row as any).subtasks),
        tags: row.tags ?? [],
        notes: row.notes ?? "",
        waitingForType: waitingForId ? "contact" : ((row as any).waiting_for_type ?? (row.waiting_for ? "legacy" : undefined)),
        waitingForId,
        autoCompleteOnSubtasksDone: row.auto_complete_on_subtasks_done ?? true,
        waitingFor: row.waiting_for ?? "",
        waitingReason: row.waiting_reason ?? "",
        followUpDate: row.follow_up_date ?? "",
        timeTracking: tracking,
      };
    });

    const mappedMeetings: Meeting[] = (meetings.data ?? []).map(row => ({
      id: row.id,
      title: row.title,
      startTime: (row as any).start_time ? toDateTimeLocal((row as any).start_time) : undefined,
      date: toDateTimeLocal(row.date),
      durationMinutes: row.duration_minutes,
      endTime: (row as any).end_time ? toDateTimeLocal((row as any).end_time) : undefined,
      attendees: row.attendees ?? [],
      notes: row.notes ?? "",
      decisions: row.decisions ?? [],
      relatedProjectId: row.related_project_id ?? "",
      relatedTaskId: (row as any).task_id ?? "",
      externalSource: row.external_source ?? "manual",
      externalId: row.external_id ?? "",
      location: row.location ?? "",
      meetingUrl: row.meeting_url ?? "",
      calendarId: row.calendar_id ?? "",
      organizerId: row.organizer_id ?? "",
      rawPayload: row.raw_payload ?? {},
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

    const mappedContacts: Contact[] = (contacts.data ?? []).map(row => ({
      id: row.id,
      name: row.name,
      role: row.role ?? "",
      team: row.team ?? "",
      company: row.company ?? "",
      email: row.email ?? "",
      phone: row.phone ?? "",
      notes: row.notes ?? "",
      externalSource: row.external_source ?? "manual",
      externalId: row.external_id ?? "",
      feishuUserId: row.feishu_user_id ?? "",
      openId: row.feishu_open_id ?? "",
      unionId: row.feishu_union_id ?? "",
      avatar: row.avatar ?? "",
      departmentId: row.department_id ?? "",
      departmentName: row.department_name ?? "",
      status: row.status ?? "",
      rawPayload: row.raw_payload ?? {},
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    const mappedContactGroups: ContactGroup[] = (contactGroups.data ?? []).map(row => ({
      id: row.id,
      name: row.name,
      description: row.description ?? "",
      contactIds: row.contact_ids ?? [],
      externalSource: row.external_source ?? "manual",
      externalId: row.external_id ?? "",
      ownerId: row.owner_id ?? "",
      memberCount: row.member_count ?? row.contact_ids?.length ?? 0,
      rawPayload: row.raw_payload ?? {},
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    return {
      version: 2,
      tasks: mappedTasks,
      projects: mappedProjects,
      meetings: mappedMeetings,
      reflections: mappedReflections,
      reports: mappedReports,
      contacts: mappedContacts,
      contactGroups: mappedContactGroups,
    };
  }

  async save(data: WorkData): Promise<void> {
    await this.upsertContacts((data.contacts ?? []).filter(contact => contact.externalSource !== "feishu"));
    await this.upsertContactGroups((data.contactGroups ?? []).filter(group => group.externalSource !== "feishu"));
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
    for (const table of ["reports", "reflections", "meeting_action_items", "meetings", "time_sessions", "tasks", "projects", "contact_groups", "contacts"] as const) {
      const { error } = await this.supabase.from(table).delete().eq("user_id", this.userId);
      if (error) throw error;
    }
  }

  private async upsertContacts(contacts: Contact[]) {
    const rows = contacts.map(contact => ({
      id: contact.id,
      user_id: this.userId,
      name: contact.name,
      role: contact.role || null,
      team: contact.team || null,
      company: contact.company || null,
      email: contact.email || null,
      phone: contact.phone || null,
      notes: contact.notes || null,
      external_source: contact.externalSource || "manual",
      external_id: contact.externalId || null,
      feishu_user_id: contact.feishuUserId || contact.externalId || null,
      feishu_open_id: contact.openId || null,
      feishu_union_id: contact.unionId || null,
      avatar: contact.avatar || null,
      department_id: contact.departmentId || null,
      department_name: contact.departmentName || null,
      status: contact.status || null,
      raw_payload: contact.rawPayload ?? {},
      created_at: contact.createdAt,
      updated_at: contact.updatedAt,
    }));
    if (rows.length) {
      const { error } = await this.supabase.from("contacts").upsert(rows);
      if (error) throw error;
    }
  }

  private async upsertContactGroups(groups: ContactGroup[]) {
    const rows = groups.map(group => ({
      id: group.id,
      user_id: this.userId,
      name: group.name,
      description: group.description || null,
      contact_ids: group.contactIds,
      external_source: group.externalSource || "manual",
      external_id: group.externalId || null,
      feishu_chat_id: group.externalId || null,
      owner_id: group.ownerId || null,
      member_count: group.memberCount ?? group.contactIds.length,
      raw_payload: group.rawPayload ?? {},
      created_at: group.createdAt,
      updated_at: group.updatedAt,
    }));
    if (rows.length) {
      const { error } = await this.supabase.from("contact_groups").upsert(rows);
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
      requester_contact_id: task.requesterContactId || null,
      created_by: task.createdBy || task.requester || "自己",
      created_by_contact_id: task.createdByContactId || null,
      project_id: task.projectId || null,
      status: task.status,
      priority: task.priority,
      due_date: task.dueDate || null,
      estimated_hours: task.estimatedHours,
      notes: task.notes || null,
      waiting_for: task.waitingFor || null,
      waiting_for_type: task.waitingForType === "contact" && task.waitingForId ? "contact" : null,
      waiting_for_id: task.waitingForType === "contact" ? task.waitingForId || null : null,
      waiting_reason: task.waitingReason || null,
      follow_up_date: task.followUpDate || null,
      tags: task.tags || [],
      subtasks: task.subtasks || [],
      auto_complete_on_subtasks_done: task.autoCompleteOnSubtasksDone ?? true,
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
        note?: string | null;
        suspected_forgot_to_stop?: boolean;
        original_start_time?: string | null;
        original_end_time?: string | null;
        original_duration?: number | null;
        corrected_start_time?: string | null;
        corrected_end_time?: string | null;
        corrected_duration?: number | null;
        corrected_note?: string | null;
        edited_by?: string | null;
        edited_at?: string | null;
        edit_reason?: string | null;
      }[] = task.timeTracking.sessions.flatMap(session => {
        const rawDuration = computedDurationSeconds(session.startTime, session.endTime);
        if (!rawDuration) return [];
        return [{
          user_id: this.userId,
          task_id: task.id,
          start_time: session.startTime,
          end_time: session.endTime,
          duration_seconds: rawDuration,
          is_running: false,
          note: session.note ?? null,
          suspected_forgot_to_stop: Boolean(session.suspectedForgotToStop),
          original_start_time: session.originalStartTime ?? null,
          original_end_time: session.originalEndTime ?? null,
          original_duration: session.originalDuration ?? null,
          corrected_start_time: session.correctedStartTime ?? null,
          corrected_end_time: session.correctedEndTime ?? null,
          corrected_duration: session.correctedStartTime && session.correctedEndTime ? computedDurationSeconds(session.correctedStartTime, session.correctedEndTime) : session.correctedDuration ?? null,
          corrected_note: session.correctedNote ?? null,
          edited_by: session.editedBy ?? null,
          edited_at: session.editedAt ?? null,
          edit_reason: session.editReason ?? null,
        }];
      });
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
      start_time: toDateTimeLocal(meeting.startTime || meeting.date) || null,
      date: toDateTimeLocal(meeting.startTime || meeting.date),
      end_time: meeting.endTime ? toDateTimeLocal(meeting.endTime) : null,
      duration_minutes: meeting.durationMinutes ?? 0,
      attendees: meeting.attendees,
      notes: meeting.notes,
      decisions: meeting.decisions,
      related_project_id: meeting.relatedProjectId || null,
      task_id: meeting.relatedTaskId || null,
      external_source: meeting.externalSource || "manual",
      external_id: meeting.externalId || null,
      location: meeting.location || null,
      meeting_url: meeting.meetingUrl || null,
      calendar_id: meeting.calendarId || null,
      organizer_id: meeting.organizerId || null,
      raw_payload: meeting.rawPayload ?? {},
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

  private async deleteMissingRows(table: "projects" | "tasks" | "meetings" | "reflections" | "reports" | "contacts" | "contact_groups", ids: string[]) {
    const query = this.supabase.from(table).delete().eq("user_id", this.userId);
    const { error } = ids.length
      ? await query.not("id", "in", `(${ids.map(id => `"${id.replace(/"/g, '\\"')}"`).join(",")})`)
      : await query;
    if (error) throw error;
  }
}
