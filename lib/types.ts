export type TaskStatus = "Inbox" | "Todo" | "Doing" | "Waiting" | "Done";
export type Priority = "P0" | "P1" | "P2" | "P3";
export type ProjectStatus = "Planning" | "Active" | "Paused" | "Done";
export type ReflectionType = "问题复盘" | "流程优化" | "风险提醒" | "经验沉淀" | "自动化想法" | "管理思考";
export type ReportType = "日报" | "周报" | "月报" | "季度报" | "自定义";
export type ExternalSource = "manual" | "feishu";

export interface TimeSession {
  startTime: string;
  endTime: string;
  durationSeconds: number;
}

export interface TimeTracking {
  isRunning: boolean;
  startedAt: string | null;
  accumulatedSeconds: number;
  lastPausedAt: string | null;
  sessions: TimeSession[];
}

export interface Task {
  id: string;
  title: string;
  description: string;
  source: string;
  requester: string;
  projectId: string;
  status: TaskStatus;
  priority: Priority;
  dueDate: string;
  estimatedHours: number;
  actualHours: number;
  createdAt: string;
  completedAt?: string;
  tags: string[];
  notes: string;
  waitingFor?: string;
  waitingReason?: string;
  followUpDate?: string;
  timeTracking: TimeTracking;
}

export interface Project {
  id: string;
  name: string;
  type: string;
  background: string;
  goal: string;
  status: ProjectStatus;
  priority: Priority;
  progress: number;
  startDate: string;
  dueDate: string;
  relatedTaskIds: string[];
  risks: string[];
  nextAction: string;
}

export interface MeetingAction {
  id: string;
  text: string;
  owner: string;
  dueDate: string;
  taskId?: string;
}

export interface Meeting {
  id: string;
  title: string;
  date: string;
  durationMinutes?: number;
  attendees: string[];
  notes: string;
  decisions: string[];
  actionItems: MeetingAction[];
  relatedProjectId: string;
}

export interface Reflection {
  id: string;
  title: string;
  content: string;
  type: ReflectionType;
  relatedProjectId: string;
  relatedTaskId: string;
  date: string;
  durationMinutes?: number;
  tags: string[];
}

export interface ReportOptions {
  reflections: boolean;
  projectProgress: boolean;
  timeStats: boolean;
  waiting: boolean;
  nextPlan: boolean;
}

export interface Report {
  id: string;
  title: string;
  type: ReportType;
  startDate: string;
  endDate: string;
  generatedContent: string;
  includedTaskIds: string[];
  includedReflectionIds: string[];
  createdAt: string;
  options: ReportOptions;
}

export interface Contact {
  id: string;
  name: string;
  role?: string;
  team?: string;
  company?: string;
  email?: string;
  phone?: string;
  notes?: string;
  externalSource?: ExternalSource;
  externalId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContactGroup {
  id: string;
  name: string;
  description?: string;
  contactIds: string[];
  externalSource?: ExternalSource;
  externalId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkData {
  version: 2;
  tasks: Task[];
  projects: Project[];
  meetings: Meeting[];
  reflections: Reflection[];
  reports: Report[];
  contacts: Contact[];
  contactGroups: ContactGroup[];
}
