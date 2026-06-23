import { execFile } from "node:child_process";
import { promisify } from "node:util";

const FEISHU_BASE_URL = "https://open.feishu.cn/open-apis";
const ROOT_DEPARTMENT_ID = "0";
const execFileAsync = promisify(execFile);

export type FeishuSyncLog = {
  type: "test" | "contacts" | "groups" | "members" | "meetings";
  command: string;
  endpoint: string;
  url?: string;
  code?: number;
  msg?: string;
  itemsLength?: number;
  returnedCount: number;
  hasMore: boolean;
  pageTokenPresent: boolean;
  pageToken?: string;
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

type DirectoryPageData<T> = {
  employees?: T[];
  departments?: T[];
  page_response?: {
    has_more?: boolean;
    page_token?: string;
  };
};

type FeishuI18nText = {
  default_value?: string;
  i18n_value?: Record<string, string>;
};

type FeishuDirectoryEmployee = {
  base_info?: {
    employee_id?: string;
    name?: {
      name?: FeishuI18nText;
      another_name?: string;
    };
    mobile?: string;
    email?: string;
    enterprise_email?: string;
    departments?: Array<{
      department_id?: string;
      name?: FeishuI18nText;
    }>;
    avatar?: FeishuUser["avatar"];
    active_status?: number;
    is_resigned?: boolean;
  };
  work_info?: {
    staff_status?: number;
    job_title?: {
      job_title_name?: FeishuI18nText;
    };
  };
};

type FeishuDirectoryDepartment = {
  department_id?: string;
  parent_department_id?: string;
  name?: FeishuI18nText;
  has_child?: boolean;
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

async function feishuRequest<T>(path: string, token: string, init?: RequestInit): Promise<FeishuResponse<T>> {
  const response = await fetch(`${FEISHU_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { "Content-Type": "application/json; charset=utf-8" } : {}),
      ...init?.headers,
    },
  });
  return parseFeishuResponse<T>(response, path);
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
        url: `${FEISHU_BASE_URL}${endpoint}`,
        code: 0,
        msg: "success",
        itemsLength: pageItems.length,
        returnedCount: pageItems.length,
        hasMore: Boolean(data.has_more),
        pageTokenPresent: Boolean(data.page_token),
        pageToken: data.page_token ?? "",
      });
      pageToken = data.has_more ? data.page_token ?? "" : "";
    } catch (error) {
      logs.push({
        type: logType,
        command,
        endpoint,
        url: `${FEISHU_BASE_URL}${endpoint}`,
        code: error instanceof FeishuApiError ? error.code : undefined,
        msg: error instanceof Error ? error.message : String(error),
        itemsLength: 0,
        returnedCount: 0,
        hasMore: false,
        pageTokenPresent: Boolean(pageToken),
        pageToken,
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

const pickI18nText = (value?: FeishuI18nText) =>
  value?.default_value || value?.i18n_value?.zh_cn || value?.i18n_value?.en_us || value?.i18n_value?.ja_jp || "";

function directoryEmployeeToFeishuUser(employee: FeishuDirectoryEmployee): FeishuUser {
  const base = employee.base_info ?? {};
  const work = employee.work_info ?? {};
  const departments = base.departments ?? [];
  const primaryDepartment = departments[0];
  const name = pickI18nText(base.name?.name) || base.name?.another_name || "";
  const jobTitle = pickI18nText(work.job_title?.job_title_name);
  return {
    open_id: base.employee_id,
    user_id: base.employee_id,
    name,
    email: base.email,
    enterprise_email: base.enterprise_email,
    mobile: base.mobile,
    job_title: jobTitle,
    avatar: base.avatar,
    department_ids: departments.map(department => department.department_id ?? "").filter(Boolean),
    department_id: primaryDepartment?.department_id,
    department_name: pickI18nText(primaryDepartment?.name),
    raw_department_id: primaryDepartment?.department_id,
    raw_department_name: pickI18nText(primaryDepartment?.name),
    status: {
      active_status: base.active_status,
      is_resigned: base.is_resigned,
      staff_status: work.staff_status,
    },
  };
}

async function listFeishuDirectoryChildDepartments(token: string, parentDepartmentId: string, logs: FeishuSyncLog[]) {
  const departments: FeishuDirectoryDepartment[] = [];
  let pageToken = "";
  const endpoint = "/directory/v1/departments/filter?employee_id_type=open_id&department_id_type=department_id";

  do {
    const body = {
      filter: { conditions: [{ field: "parent_department_id", operator: "eq", value: JSON.stringify(parentDepartmentId) }] },
      required_fields: ["department_id", "parent_department_id", "name", "has_child"],
      page_request: { page_size: 100, page_token: pageToken },
    };
    try {
      const json = await feishuRequest<DirectoryPageData<FeishuDirectoryDepartment>>(endpoint, token, {
        method: "POST",
        body: JSON.stringify(body),
      });
      const data = json.data ?? {};
      const pageItems = data.departments ?? [];
      const nextPage = data.page_response?.page_token ?? "";
      const hasMore = Boolean(data.page_response?.has_more);
      departments.push(...pageItems);
      logs.push({
        type: "contacts",
        command: "directory.v1.departments.filter",
        endpoint,
        url: `${FEISHU_BASE_URL}${endpoint}`,
        code: json.code,
        msg: json.msg ?? "",
        itemsLength: pageItems.length,
        returnedCount: pageItems.length,
        hasMore,
        pageTokenPresent: Boolean(nextPage),
        pageToken: nextPage,
      });
      pageToken = hasMore ? nextPage : "";
    } catch (error) {
      logs.push({
        type: "contacts",
        command: "directory.v1.departments.filter",
        endpoint,
        url: `${FEISHU_BASE_URL}${endpoint}`,
        code: error instanceof FeishuApiError ? error.code : undefined,
        msg: error instanceof Error ? error.message : String(error),
        itemsLength: 0,
        returnedCount: 0,
        hasMore: false,
        pageTokenPresent: Boolean(pageToken),
        pageToken,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  } while (pageToken);

  return departments;
}

async function listFeishuDirectoryEmployeesByDepartment(token: string, departmentId: string, logs: FeishuSyncLog[]) {
  const employees: FeishuDirectoryEmployee[] = [];
  let pageToken = "";
  const endpoint = "/directory/v1/employees/filter?employee_id_type=open_id&department_id_type=department_id";
  const requiredFields = [
    "base_info.name",
    "base_info.email",
    "base_info.enterprise_email",
    "base_info.mobile",
    "base_info.departments",
    "base_info.avatar",
    "base_info.active_status",
    "base_info.is_resigned",
    "work_info.job_title",
    "work_info.staff_status",
  ];

  do {
    const body = {
      filter: {
        conditions: [
          { field: "base_info.departments.department_id", operator: "eq", value: JSON.stringify(departmentId) },
          { field: "work_info.staff_status", operator: "eq", value: "1" },
        ],
      },
      required_fields: requiredFields,
      page_request: { page_size: 100, page_token: pageToken },
    };
    try {
      const json = await feishuRequest<DirectoryPageData<FeishuDirectoryEmployee>>(endpoint, token, {
        method: "POST",
        body: JSON.stringify(body),
      });
      const data = json.data ?? {};
      const pageItems = data.employees ?? [];
      const nextPage = data.page_response?.page_token ?? "";
      const hasMore = Boolean(data.page_response?.has_more);
      employees.push(...pageItems);
      logs.push({
        type: "contacts",
        command: "directory.v1.employees.filter",
        endpoint,
        url: `${FEISHU_BASE_URL}${endpoint}`,
        code: json.code,
        msg: json.msg ?? "",
        itemsLength: pageItems.length,
        returnedCount: pageItems.length,
        hasMore,
        pageTokenPresent: Boolean(nextPage),
        pageToken: nextPage,
      });
      pageToken = hasMore ? nextPage : "";
    } catch (error) {
      logs.push({
        type: "contacts",
        command: "directory.v1.employees.filter",
        endpoint,
        url: `${FEISHU_BASE_URL}${endpoint}`,
        code: error instanceof FeishuApiError ? error.code : undefined,
        msg: error instanceof Error ? error.message : String(error),
        itemsLength: 0,
        returnedCount: 0,
        hasMore: false,
        pageTokenPresent: Boolean(pageToken),
        pageToken,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  } while (pageToken);

  return employees.map(directoryEmployeeToFeishuUser);
}

export async function listFeishuDirectoryEmployees(token: string, logs: FeishuSyncLog[]): Promise<FeishuUser[]> {
  const usersByKey = new Map<string, FeishuUser>();
  const queue = [ROOT_DEPARTMENT_ID];
  const visited = new Set<string>();
  let readableDepartmentIds = 0;

  while (queue.length) {
    const departmentId = queue.shift()!;
    if (!departmentId || visited.has(departmentId)) continue;
    visited.add(departmentId);

    if (departmentId !== ROOT_DEPARTMENT_ID) {
      const users = await listFeishuDirectoryEmployeesByDepartment(token, departmentId, logs);
      for (const user of users) {
        const key = user.open_id || user.user_id || user.union_id || user.email || user.enterprise_email || user.name;
        if (key) usersByKey.set(key, user);
      }
    }

    const children = await listFeishuDirectoryChildDepartments(token, departmentId, logs);
    const childIds = children.map(department => department.department_id ?? "").filter(Boolean);
    readableDepartmentIds += childIds.length;
    queue.push(...childIds);
  }

  if (!readableDepartmentIds) {
    logs.push({
      type: "contacts",
      command: "directory.v1.departments.filter",
      endpoint: "/directory/v1/departments/filter?employee_id_type=open_id&department_id_type=department_id",
      url: `${FEISHU_BASE_URL}/directory/v1/departments/filter?employee_id_type=open_id&department_id_type=department_id`,
      code: 0,
      msg: "Directory 部门列表未返回 department_id 字段，回退到 contact.v3 部门遍历。",
      itemsLength: 0,
      returnedCount: 0,
      hasMore: false,
      pageTokenPresent: false,
      message: "Directory 部门列表未返回 department_id 字段，回退到 contact.v3 部门遍历。",
    });
  }

  return [...usersByKey.values()];
}

export async function listFeishuChildDepartments(token: string, departmentId: string, logs: FeishuSyncLog[]) {
  return listPaginated<FeishuDepartment>(
    pageToken => `/contact/v3/departments/${encodeURIComponent(departmentId)}/children?page_size=50&department_id_type=open_department_id${pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ""}`,
    token,
    "contacts",
    "contact.v3.departments.children",
    logs,
    data => data.children ?? data.items ?? [],
  );
}

export async function listFeishuUsersByDepartment(token: string, departmentId: string, logs: FeishuSyncLog[]) {
  return listPaginated<FeishuUser>(
    pageToken => `/contact/v3/users/find_by_department?department_id=${encodeURIComponent(departmentId)}&department_id_type=open_department_id&user_id_type=open_id&page_size=50${pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ""}`,
    token,
    "contacts",
    "contact.v3.users.find_by_department",
    logs,
  );
}

export async function listFeishuOrgUsers(token: string, logs: FeishuSyncLog[]): Promise<FeishuUser[]> {
  try {
    const users = await listFeishuDirectoryEmployees(token, logs);
    if (users.length) return users;
    logs.push({
      type: "contacts",
      command: "directory.v1.employees.filter",
      endpoint: "/directory/v1/employees/filter?employee_id_type=open_id&department_id_type=department_id",
      url: `${FEISHU_BASE_URL}/directory/v1/employees/filter?employee_id_type=open_id&department_id_type=department_id`,
      code: 0,
      msg: "Directory 员工列表返回 0 条，回退到 contact.v3 部门遍历。",
      itemsLength: 0,
      returnedCount: 0,
      hasMore: false,
      pageTokenPresent: false,
      message: "Directory 员工列表返回 0 条，回退到 contact.v3 部门遍历。",
    });
  } catch (error) {
    logs.push({
      type: "contacts",
      command: "directory.v1.employees.filter.fallback",
      endpoint: "/directory/v1/employees/filter?employee_id_type=open_id&department_id_type=department_id",
      url: `${FEISHU_BASE_URL}/directory/v1/employees/filter?employee_id_type=open_id&department_id_type=department_id`,
      code: error instanceof FeishuApiError ? error.code : undefined,
      msg: error instanceof Error ? `Directory 员工列表失败，回退到 contact.v3 部门遍历：${error.message}` : "Directory 员工列表失败，回退到 contact.v3 部门遍历。",
      itemsLength: 0,
      returnedCount: 0,
      hasMore: false,
      pageTokenPresent: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const usersByKey = new Map<string, FeishuUser>();
  const queue: FeishuDepartment[] = [{ department_id: ROOT_DEPARTMENT_ID, name: "根部门" }];
  const visited = new Set<string>();
  const workerCount = 8;

  const readDepartment = async (department: FeishuDepartment) => {
    const departmentId = departmentIdOf(department);
    if (!departmentId || visited.has(departmentId)) return;
    visited.add(departmentId);

    const [usersResult, childrenResult] = await Promise.allSettled([
      listFeishuUsersByDepartment(token, departmentId, logs),
      listFeishuChildDepartments(token, departmentId, logs),
    ]);

    if (usersResult.status === "rejected") {
      const error = usersResult.reason;
      logs.push({
        type: "contacts",
        command: "contact.v3.users.find_by_department.skip",
        endpoint: `/contact/v3/users/find_by_department?department_id=${encodeURIComponent(departmentId)}&department_id_type=open_department_id&user_id_type=open_id&page_size=50`,
        url: `${FEISHU_BASE_URL}/contact/v3/users/find_by_department?department_id=${encodeURIComponent(departmentId)}&department_id_type=open_department_id&user_id_type=open_id&page_size=50`,
        code: error instanceof FeishuApiError ? error.code : undefined,
        msg: error instanceof Error ? `跳过该部门成员读取：${error.message}` : "跳过该部门成员读取。",
        itemsLength: 0,
        returnedCount: 0,
        hasMore: false,
        pageTokenPresent: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const users = usersResult.status === "fulfilled" ? usersResult.value : [];
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

    if (childrenResult.status === "rejected") {
      const error = childrenResult.reason;
      logs.push({
        type: "contacts",
        command: "contact.v3.departments.children.skip",
        endpoint: `/contact/v3/departments/${encodeURIComponent(departmentId)}/children?page_size=50&department_id_type=open_department_id`,
        url: `${FEISHU_BASE_URL}/contact/v3/departments/${encodeURIComponent(departmentId)}/children?page_size=50&department_id_type=open_department_id`,
        code: error instanceof FeishuApiError ? error.code : undefined,
        msg: error instanceof Error ? `跳过该部门子部门读取：${error.message}` : "跳过该部门子部门读取。",
        itemsLength: 0,
        returnedCount: 0,
        hasMore: false,
        pageTokenPresent: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const children = childrenResult.status === "fulfilled" ? childrenResult.value : [];
    queue.push(...children);
  };

  const worker = async () => {
    while (queue.length) {
      const department = queue.shift();
      if (department) await readDepartment(department);
    }
  };

  while (queue.length) {
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
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
const toShanghaiSecond = (value: string) => Math.floor(new Date(`${value}+08:00`).getTime() / 1000);

async function runLarkCliJson<T>(args: string[], endpoint: string): Promise<T> {
  try {
    const { stdout } = await execFileAsync("lark-cli", args, {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 60_000,
    });
    return JSON.parse(stdout) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new FeishuApiError(`飞书 CLI 调用失败：${message}`, undefined, endpoint);
  }
}

type LarkCliPrimaryCalendarResponse = {
  code?: number;
  msg?: string;
  data?: {
    calendars?: Array<{
      calendar?: FeishuCalendar;
    }>;
  };
};

type LarkCliInstanceViewResponse = {
  code?: number;
  msg?: string;
  data?: {
    items?: FeishuCalendarEvent[];
  };
};

export async function listFeishuMeetingsFromCliUser(
  startDate: string,
  endDate: string,
  logs: FeishuSyncLog[],
): Promise<Array<FeishuCalendarEvent & { calendar_id: string }>> {
  const primaryEndpoint = "lark-cli calendar calendars primary --as user";
  const primary = await runLarkCliJson<LarkCliPrimaryCalendarResponse>([
    "calendar",
    "calendars",
    "primary",
    "--as",
    "user",
    "--params",
    JSON.stringify({ user_id_type: "open_id" }),
    "--format",
    "json",
  ], primaryEndpoint);

  if (primary.code !== 0) {
    throw new FeishuApiError(primary.msg || "飞书 CLI 未能读取用户主日历。", primary.code, primaryEndpoint);
  }

  const calendarId = primary.data?.calendars?.[0]?.calendar?.calendar_id;
  logs.push({
    type: "meetings",
    command: "lark-cli.calendar.calendars.primary",
    endpoint: primaryEndpoint,
    url: primaryEndpoint,
    code: primary.code,
    msg: primary.msg ?? "success",
    itemsLength: primary.data?.calendars?.length ?? 0,
    returnedCount: primary.data?.calendars?.length ?? 0,
    hasMore: false,
    pageTokenPresent: false,
  });

  if (!calendarId) {
    throw new FeishuApiError("飞书 CLI 未返回用户主日历 ID。", undefined, primaryEndpoint);
  }

  const startTime = String(toShanghaiSecond(`${startDate}T00:00:00`));
  const endTime = String(toShanghaiSecond(`${endDate}T23:59:59`));
  const eventsEndpoint = "lark-cli calendar events instance_view --as user";
  const events = await runLarkCliJson<LarkCliInstanceViewResponse>([
    "calendar",
    "events",
    "instance_view",
    "--as",
    "user",
    "--params",
    JSON.stringify({ calendar_id: calendarId, start_time: startTime, end_time: endTime, user_id_type: "open_id" }),
    "--format",
    "json",
  ], eventsEndpoint);

  if (events.code !== 0) {
    throw new FeishuApiError(events.msg || "飞书 CLI 未能读取用户日程。", events.code, eventsEndpoint);
  }

  const items = events.data?.items ?? [];
  logs.push({
    type: "meetings",
    command: "lark-cli.calendar.events.instance_view",
    endpoint: eventsEndpoint,
    url: eventsEndpoint,
    code: events.code,
    msg: events.msg ?? "success",
    itemsLength: items.length,
    returnedCount: items.length,
    hasMore: false,
    pageTokenPresent: false,
    message: `使用飞书 CLI 用户身份读取个人会议：${items.length} 场。`,
  });

  return items.map(event => ({ ...event, calendar_id: calendarId }));
}

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
    ? [99991663, 99991672].includes(error.code ?? 0) || /access denied|scope|required|authority|permission|权限|无权限|no .*authority/i.test(message)
    : /access denied|scope|required|authority|permission|权限|无权限|no .*authority/i.test(message);
}
