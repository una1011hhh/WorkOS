const FEISHU_BASE_URL = "https://open.feishu.cn/open-apis";

export type FeishuUser = {
  open_id?: string;
  user_id?: string;
  name?: string;
  en_name?: string;
  email?: string;
  enterprise_email?: string;
  mobile?: string;
  job_title?: string;
  department_ids?: string[];
};

export type FeishuChat = {
  chat_id: string;
  name?: string;
  description?: string;
};

export type FeishuChatMember = {
  member_id?: string;
  name?: string;
  email?: string;
};

type FeishuResponse<T> = {
  code: number;
  msg?: string;
  data?: T;
  tenant_access_token?: string;
};

export class FeishuApiError extends Error {
  code?: number;

  constructor(message: string, code?: number) {
    super(message);
    this.name = "FeishuApiError";
    this.code = code;
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

async function parseFeishuResponse<T>(response: Response): Promise<FeishuResponse<T>> {
  let json: FeishuResponse<T>;
  try {
    json = await response.json();
  } catch {
    throw new FeishuApiError(`飞书接口返回了无法解析的响应（HTTP ${response.status}）。`);
  }

  if (!response.ok) {
    throw new FeishuApiError(json.msg || `飞书接口请求失败（HTTP ${response.status}）。`);
  }

  if (json.code !== 0) {
    throw new FeishuApiError(json.msg || `飞书接口返回错误码 ${json.code}。请检查应用权限和可见范围。`, json.code);
  }

  return json;
}

export async function getTenantAccessToken() {
  const { appId, appSecret } = requireFeishuConfig();
  const response = await fetch(`${FEISHU_BASE_URL}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const json = await parseFeishuResponse<Record<string, never>>(response);
  if (!json.tenant_access_token) {
    throw new FeishuApiError("飞书未返回 tenant_access_token，请检查应用配置。");
  }
  return json.tenant_access_token;
}

async function feishuGet<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`${FEISHU_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await parseFeishuResponse<T>(response);
  return (json.data ?? {}) as T;
}

async function listPaginated<T>(buildPath: (pageToken?: string) => string, token: string): Promise<T[]> {
  const items: T[] = [];
  let pageToken = "";

  do {
    const data = await feishuGet<{ items?: T[]; has_more?: boolean; page_token?: string }>(buildPath(pageToken || undefined), token);
    items.push(...(data.items ?? []));
    pageToken = data.has_more ? data.page_token ?? "" : "";
  } while (pageToken);

  return items;
}

export function isFeishuConfigured() {
  return Boolean(process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET);
}

export async function listFeishuUsers(token: string): Promise<FeishuUser[]> {
  return listPaginated<FeishuUser>(
    pageToken => `/contact/v3/users?page_size=50&user_id_type=open_id${pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ""}`,
    token,
  );
}

export async function listFeishuChats(token: string): Promise<FeishuChat[]> {
  return listPaginated<FeishuChat>(
    pageToken => `/im/v1/chats?page_size=50&user_id_type=open_id${pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ""}`,
    token,
  );
}

export async function listFeishuChatMembers(token: string, chatId: string): Promise<FeishuChatMember[]> {
  return listPaginated<FeishuChatMember>(
    pageToken => `/im/v1/chats/${encodeURIComponent(chatId)}/members?page_size=50&member_id_type=open_id${pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ""}`,
    token,
  );
}
