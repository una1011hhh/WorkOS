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
  note?: string;
  suspectedForgotToStop?: boolean;
  originalStartTime?: string;
  originalEndTime?: string;
  originalDuration?: number;
  correctedStartTime?: string;
  correctedEndTime?: string;
  correctedDuration?: number;
  correctedNote?: string;
  editedBy?: string;
  editedAt?: string;
  editReason?: string;
}

export interface TimeTracking {
  isRunning: boolean;
  startedAt: string | null;
  accumulatedSeconds: number;
  lastPausedAt: string | null;
  sessions: TimeSession[];
}

export interface Subtask {
  id: string;
  title: string;
  done: boolean;
  order: number;
  createdAt: string;
  updatedAt?: string;
  completedAt?: string;
}

export type WaitingForType = "contact" | "group" | "legacy";

export interface Task {
  id: string;
  title: string;
  description: string;
  source: string;
  requester: string;
  requesterContactId?: string;
  createdBy: string;
  createdByContactId?: string;
  projectId: string;
  status: TaskStatus;
  priority: Priority;
  dueDate: string;
  estimatedHours: number;
  actualHours: number;
  createdAt: string;
  completedAt?: string;
  subtasks: Subtask[];
  tags?: string[];
  notes?: string;
  waitingForType?: WaitingForType;
  waitingForId?: string;
  autoCompleteOnSubtasksDone?: boolean;
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
  endTime?: string;
  durationMinutes?: number;
  attendees: string[];
  notes: string;
  decisions: string[];
  actionItems: MeetingAction[];
  relatedProjectId: string;
  relatedTaskId?: string;
  externalSource?: ExternalSource;
  externalId?: string;
  location?: string;
  meetingUrl?: string;
  calendarId?: string;
  organizerId?: string;
  rawPayload?: unknown;
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
  feishuUserId?: string;
  openId?: string;
  unionId?: string;
  avatar?: string;
  departmentId?: string;
  departmentName?: string;
  status?: string;
  rawPayload?: unknown;
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
  ownerId?: string;
  memberCount?: number;
  rawPayload?: unknown;
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
