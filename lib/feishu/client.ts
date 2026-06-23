const FEISHU_BASE_URL = "https://open.feishu.cn/open-apis";
const ROOT_DEPARTMENT_ID = "0";

export type FeishuSyncLog = {
  type: "test" | "contacts" | "groups" | "members" | "meetings";
  command: string;
  endpoint: string;
  returnedCount: number;
  hasMore: boolean;
  pageTokenPresent: boolean;
  upsertCount?: number;
  message?: string;
  error?: string;
};

export type FeishuDepartment = {
  department_id?: string;
  open_department_id?: string;
  name?: string;
  parent_department_id?: string;
};

export type FeishuUser = {
  open_id?: string;
  user_id?: string;
  union_id?: string;
  name?: string;
  en_name?: string;
  email?: string;
  enterprise_email?: string;
  mobile?: string;
  job_title?: string;
  avatar?: {
    avatar_72?: string;
    avatar_240?: string;
    avatar_640?: string;
    avatar_origin?: string;
  };
  department_ids?: string[];
  department_id?: string;
  department_name?: string;
  status?: unknown;
  raw_department_id?: string;
  raw_department_name?: string;
};

export type FeishuChat = {
  chat_id: string;
  name?: string;
  description?: string;
  owner_id?: string;
  member_count?: number;
};

export type FeishuChatMember = {
  member_id?: string;
  open_id?: string;
  user_id?: string;
  name?: string;
  email?: string;
  member_type?: string;
  role?: string;
  join_time?: string;
};

export type FeishuCalendar = {
  calendar_id?: string;
  summary?: string;
  type?: string;
};

export type FeishuCalendarEvent = {
  event_id?: string;
  organizer_calendar_id?: string;
  summary?: string;
  title?: string;
  description?: string;
  location?: { name?: string; address?: string };
  app_link?: string;
  vchat?: { vc_url?: string; meeting_url?: string };
  start_time?: { timestamp?: string; date?: string; timezone?: string };
  end_time?: { timestamp?: string; date?: string; timezone?: string };
  attendees?: Array<{
    user_id?: string;
    open_id?: string;
    display_name?: string;
    email?: string;
  }>;
};

type FeishuResponse<T> = {
  code: number;
  msg?: string;
  data?: T;
  tenant_access_token?: string;
};

type PageData<T> = {
  items?: T[];
  children?: T[];
  has_more?: boolean;
  page_token?: string;
};

export class FeishuApiError extends Error {
  code?: number;
  endpoint?: string;

  constructor(message: string, code?: number, endpoint?: string) {
    super(message);
    this.name = "FeishuApiError";
    this.code = code;
    this.endpoint = endpoint;
  }
}

const requireFeishuConfig = () => {
  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;
  if (!appId || !appSecret) {
    throw new FeishuApiError("飞书 App ID / App Secret 未配置，请先在 .env.local 或 Vercel 环境变量中填写。");
  }
  return { appId, appSecret };
};

async function parseFeishuResponse<T>(response: Response, endpoint: string): Promise<FeishuResponse<T>> {
  let json: FeishuResponse<T>;
  try {
    json = await response.json();
  } catch {
    throw new FeishuApiError(`飞书接口返回了无法解析的响应（HTTP ${response.status}）。`, undefined, endpoint);
  }

  if (!response.ok) {
    throw new FeishuApiError(json.msg || `飞书接口请求失败（HTTP ${response.status}）。`, json.code, endpoint);
  }

  if (json.code !== 0) {
    throw new FeishuApiError(json.msg || `飞书接口返回错误码 ${json.code}。请检查应用权限和可见范围。`, json.code, endpoint);
  }

  return json;
}

export async function getTenantAccessToken() {
  const { appId, appSecret } = requireFeishuConfig();
  const endpoint = "/auth/v3/tenant_access_token/internal";
  const response = await fetch(`${FEISHU_BASE_URL}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const json = await parseFeishuResponse<Record<string, never>>(response, endpoint);
  if (!json.tenant_access_token) {
    throw new FeishuApiError("飞书未返回 tenant_access_token，请检查应用配置。", undefined, endpoint);
  }
  return json.tenant_access_token;
}

async function feishuGet<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`${FEISHU_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await parseFeishuResponse<T>(response, path);
  return (json.data ?? {}) as T;
}

async function listPaginated<T>(
  buildPath: (pageToken?: string) => string,
  token: string,
  logType: FeishuSyncLog["type"],
  command: string,
  logs: FeishuSyncLog[],
  pickItems: (data: PageData<T>) => T[] = data => data.items ?? [],
): Promise<T[]> {
  const items: T[] = [];
  let pageToken = "";

  do {
    const endpoint = buildPath(pageToken || undefined);
    try {
      const data = await feishuGet<PageData<T>>(endpoint, token);
      const pageItems = pickItems(data);
      items.push(...pageItems);
      logs.push({
        type: logType,
        command,
        endpoint,
        returnedCount: pageItems.length,
        hasMore: Boolean(data.has_more),
        pageTokenPresent: Boolean(data.page_token),
      });
      pageToken = data.has_more ? data.page_token ?? "" : "";
    } catch (error) {
      logs.push({
        type: logType,
        command,
        endpoint,
        returnedCount: 0,
        hasMore: false,
        pageTokenPresent: Boolean(pageToken),
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  } while (pageToken);

  return items;
}

export function isFeishuConfigured() {
  return Boolean(process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET);
}

export async function testFeishuConnection(logs: FeishuSyncLog[] = []) {
  const token = await getTenantAccessToken();
  logs.push({
    type: "test",
    command: "getTenantAccessToken",
    endpoint: "/auth/v3/tenant_access_token/internal",
    returnedCount: token ? 1 : 0,
    hasMore: false,
    pageTokenPresent: false,
    message: "飞书 tenant_access_token 获取成功",
  });
  return true;
}

const departmentIdOf = (department: FeishuDepartment) =>
  department.department_id || department.open_department_id || "";

export async function listFeishuChildDepartments(token: string, departmentId: string, logs: FeishuSyncLog[]) {
  return listPaginated<FeishuDepartment>(
    pageToken => `/contact/v3/departments/${encodeURIComponent(departmentId)}/children?page_size=50&department_id_type=department_id${pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ""}`,
    token,
    "contacts",
    "contact.v3.departments.children",
    logs,
    data => data.children ?? data.items ?? [],
  );
}

export async function listFeishuUsersByDepartment(token: string, departmentId: string, logs: FeishuSyncLog[]) {
  return listPaginated<FeishuUser>(
    pageToken => `/contact/v3/users/find_by_department?department_id=${encodeURIComponent(departmentId)}&department_id_type=department_id&user_id_type=open_id&page_size=50${pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ""}`,
    token,
    "contacts",
    "contact.v3.users.find_by_department",
    logs,
  );
}

export async function listFeishuOrgUsers(token: string, logs: FeishuSyncLog[]): Promise<FeishuUser[]> {
  const usersByKey = new Map<string, FeishuUser>();
  const queue: FeishuDepartment[] = [{ department_id: ROOT_DEPARTMENT_ID, name: "根部门" }];
  const visited = new Set<string>();

  while (queue.length) {
    const department = queue.shift()!;
    const departmentId = departmentIdOf(department);
    if (!departmentId || visited.has(departmentId)) continue;
    visited.add(departmentId);

    const users = await listFeishuUsersByDepartment(token, departmentId, logs);
    for (const user of users) {
      const key = user.open_id || user.user_id || user.union_id || user.email || user.enterprise_email || user.name;
      if (!key) continue;
      const existing = usersByKey.get(key);
      usersByKey.set(key, {
        ...existing,
        ...user,
        raw_department_id: departmentId,
        raw_department_name: department.name || departmentId,
      });
    }

    const children = await listFeishuChildDepartments(token, departmentId, logs);
    queue.push(...children);
  }

  return [...usersByKey.values()];
}

export async function listFeishuChats(token: string, logs: FeishuSyncLog[]): Promise<FeishuChat[]> {
  return listPaginated<FeishuChat>(
    pageToken => `/im/v1/chats?page_size=50&user_id_type=open_id${pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ""}`,
    token,
    "groups",
    "im.v1.chats.list",
    logs,
  );
}

export async function listFeishuChatMembers(token: string, chatId: string, logs: FeishuSyncLog[]): Promise<FeishuChatMember[]> {
  return listPaginated<FeishuChatMember>(
    pageToken => `/im/v1/chats/${encodeURIComponent(chatId)}/members?page_size=50&member_id_type=open_id${pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ""}`,
    token,
    "members",
    "im.v1.chat.members.list",
    logs,
  );
}

export async function listFeishuCalendars(token: string, logs: FeishuSyncLog[]): Promise<FeishuCalendar[]> {
  return listPaginated<FeishuCalendar>(
    pageToken => `/calendar/v4/calendars?page_size=50${pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ""}`,
    token,
    "meetings",
    "calendar.v4.calendars.list",
    logs,
  );
}

const toFeishuSecond = (value: string) => Math.floor(new Date(value).getTime() / 1000);

export async function listFeishuCalendarEvents(
  token: string,
  calendarId: string,
  startDate: string,
  endDate: string,
  logs: FeishuSyncLog[],
): Promise<FeishuCalendarEvent[]> {
  const startTime = toFeishuSecond(`${startDate}T00:00:00`);
  const endTime = toFeishuSecond(`${endDate}T23:59:59`);
  return listPaginated<FeishuCalendarEvent>(
    pageToken => `/calendar/v4/calendars/${encodeURIComponent(calendarId)}/events?page_size=50&start_time=${startTime}&end_time=${endTime}${pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ""}`,
    token,
    "meetings",
    "calendar.v4.events.list",
    logs,
  );
}

export async function listFeishuMeetings(
  token: string,
  startDate: string,
  endDate: string,
  logs: FeishuSyncLog[],
): Promise<Array<FeishuCalendarEvent & { calendar_id: string }>> {
  let calendars = await listFeishuCalendars(token, logs);
  if (!calendars.length) calendars = [{ calendar_id: "primary", summary: "Primary" }];

  const events: Array<FeishuCalendarEvent & { calendar_id: string }> = [];
  for (const calendar of calendars) {
    const calendarId = calendar.calendar_id || "primary";
    const calendarEvents = await listFeishuCalendarEvents(token, calendarId, startDate, endDate, logs);
    events.push(...calendarEvents.map(event => ({ ...event, calendar_id: calendarId })));
  }
  return events;
}

export function normalizeFeishuEventTime(value?: { timestamp?: string; date?: string; timezone?: string }) {
  if (!value) return "";
  if (value.timestamp) return new Date(Number(value.timestamp) * 1000).toISOString();
  if (value.date) return new Date(`${value.date}T00:00:00`).toISOString();
  return "";
}

export function isFeishuPermissionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return error instanceof FeishuApiError
    ? error.code === 99991663 || /authority|permission|权限|无权限|no .*authority/i.test(message)
    : /authority|permission|权限|无权限|no .*authority/i.test(message);
}
