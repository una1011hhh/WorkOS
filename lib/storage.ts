import { seedData } from "./seed";
import { TimeTracking, WorkData } from "./types";

export interface WorkDataRepository {
  load(): WorkData;
  save(data: WorkData): void;
  clear(): void;
}

const STORAGE_KEY = "workos-data-v2";
const LEGACY_KEY = "workos-data-v1";
const todaySafe = () => new Date().toISOString().slice(0, 10);

export const workOSStorageKeys = {
  current: STORAGE_KEY,
  legacy: LEGACY_KEY,
};

function cloneSeed(): WorkData { return JSON.parse(JSON.stringify(seedData)); }

function normalizeTimeTracking(task: any): TimeTracking {
  if (task?.timeTracking) {
    return {
      isRunning: Boolean(task.timeTracking.isRunning),
      startedAt: task.timeTracking.startedAt || null,
      accumulatedSeconds: Number(task.timeTracking.accumulatedSeconds || 0),
      lastPausedAt: task.timeTracking.lastPausedAt || null,
      sessions: Array.isArray(task.timeTracking.sessions) ? task.timeTracking.sessions : [],
    };
  }
  return {
    isRunning: false,
    startedAt: null,
    accumulatedSeconds: Math.max(0, Math.round(Number(task?.actualHours ?? task?.actual ?? 0) * 3600)),
    lastPausedAt: null,
    sessions: [],
  };
}

function migrateLegacy(raw: any): WorkData {
  if (!raw || !Array.isArray(raw.tasks)) return cloneSeed();
  const seeded = cloneSeed();
  const projectByName = new Map(seeded.projects.map(p => [p.name, p.id]));
  return {
    ...seeded,
    tasks: raw.tasks.map((t: any) => ({
      id: t.id, title: t.title || "未命名任务", description: t.description || "",
      source: t.source || "历史数据", requester: t.requester || "自己",
      projectId: projectByName.get(t.project) || "", status: t.status || "Inbox",
      priority: t.priority || "P2", dueDate: t.dueDate || "",
      estimatedHours: Number(t.estimate || 0), actualHours: Number(t.actual || 0),
      createdAt: t.createdAt || new Date().toISOString().slice(0, 10), completedAt: t.completedAt,
      tags: [], notes: "", waitingFor: t.waitingFor || "",
      timeTracking: normalizeTimeTracking(t),
    })),
    meetings: Array.isArray(raw.meetings) ? raw.meetings.map((m: any) => ({ ...m, durationMinutes: Number(m.durationMinutes || 0), actionItems: m.actionItems || m.actions || [], relatedProjectId: "" })) : seeded.meetings,
    reflections: Array.isArray(raw.thoughts) ? raw.thoughts.map((n: any) => ({ id: n.id, title: n.title, content: n.content, type: n.category === "自动化想法" ? "自动化想法" : "经验沉淀", relatedProjectId: "", relatedTaskId: "", date: n.createdAt, durationMinutes: Number(n.durationMinutes || 0), tags: [] })) : seeded.reflections,
  };
}

function normalizeCurrent(raw: any): WorkData {
  if (!raw || raw.version !== 2 || !Array.isArray(raw.projects)) return migrateLegacy(raw);
  const seeded = cloneSeed();
  return {
    version: 2,
    tasks: Array.isArray(raw.tasks) ? raw.tasks.map((t: any) => {
      const timeTracking = normalizeTimeTracking(t);
      return {
        ...t,
        projectId: t.projectId ?? "",
        estimatedHours: Number(t.estimatedHours ?? t.estimate ?? 0),
        actualHours: timeTracking.accumulatedSeconds / 3600,
        tags: Array.isArray(t.tags) ? t.tags : [],
        notes: t.notes ?? "",
        timeTracking,
      };
    }) : [],
    projects: raw.projects,
    meetings: Array.isArray(raw.meetings) ? raw.meetings.map((m: any) => ({ ...m, durationMinutes: Number(m.durationMinutes || 0), actionItems: m.actionItems || m.actions || [], relatedProjectId: m.relatedProjectId || "" })) : [],
    reflections: Array.isArray(raw.reflections) ? raw.reflections.map((r: any) => ({ ...r, durationMinutes: Number(r.durationMinutes || 0) })) : [],
    reports: Array.isArray(raw.reports) ? raw.reports : [],
    contacts: Array.isArray(raw.contacts) ? raw.contacts.map((c: any) => ({ ...c, name: c.name || "未命名联系人", createdAt: c.createdAt || todaySafe(), updatedAt: c.updatedAt || c.createdAt || todaySafe() })) : (seeded.contacts || []),
    contactGroups: Array.isArray(raw.contactGroups) ? raw.contactGroups.map((g: any) => ({ ...g, name: g.name || "未命名群组", contactIds: Array.isArray(g.contactIds) ? g.contactIds : [], createdAt: g.createdAt || todaySafe(), updatedAt: g.updatedAt || g.createdAt || todaySafe() })) : (seeded.contactGroups || []),
  };
}

export const localWorkDataRepository: WorkDataRepository = {
  load() {
    try {
      const current = localStorage.getItem(STORAGE_KEY);
      if (current) return normalizeCurrent(JSON.parse(current));
      const legacy = localStorage.getItem(LEGACY_KEY);
      const data = legacy ? migrateLegacy(JSON.parse(legacy)) : cloneSeed();
      this.save(data);
      return data;
    } catch { return cloneSeed(); }
  },
  save(data) { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); },
  clear() { localStorage.removeItem(STORAGE_KEY); },
};

export function hasLocalWorkData() {
  if (typeof window === "undefined") return false;
  return Boolean(localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_KEY));
}
