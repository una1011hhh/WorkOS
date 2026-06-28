import { NextResponse } from "next/server";
import {
  FeishuApiError,
  FeishuCalendarEvent,
  FeishuChat,
  FeishuChatMember,
  FeishuSyncLog,
  FeishuUser,
  getTenantAccessToken,
  isFeishuPermissionError,
  listFeishuMeetingsFromCliUser,
  listFeishuMeetingsWithUserAccessToken,
  listFeishuChatMembers,
  listFeishuChats,
  listFeishuMeetings,
  listFeishuOrgUsers,
  normalizeFeishuEventTime,
  refreshFeishuUserAccessToken,
  testFeishuConnection,
} from "@/lib/feishu/client";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedSupabase } from "@/lib/supabase/server-auth";
import { Database, Json } from "@/lib/supabase/database.types";
import { formatLocalDate } from "@/lib/time";

export const dynamic = "force-dynamic";

type ContactRow = Database["public"]["Tables"]["contacts"]["Row"];
type ContactInsert = Database["public"]["Tables"]["contacts"]["Insert"];
type GroupRow = Database["public"]["Tables"]["contact_groups"]["Row"];
type GroupInsert = Database["public"]["Tables"]["contact_groups"]["Insert"];
type MeetingRow = Database["public"]["Tables"]["meetings"]["Row"];
type MeetingInsert = Database["public"]["Tables"]["meetings"]["Insert"];
type MemberInsert = Database["public"]["Tables"]["contact_group_members"]["Insert"];
type FeishuUserConnection = Database["public"]["Tables"]["feishu_user_connections"]["Row"];

type SyncAction = "test" | "contacts" | "groups" | "members" | "meetings" | "all";

const clean = (value?: string | null) => (value ?? "").trim();
const normalize = (value?: string | null) => clean(value).toLocaleLowerCase("zh-CN");
const unique = (values: string[]) => [...new Set(values.filter(Boolean))];
const nowIso = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();
const asJson = (value: unknown): Json => JSON.parse(JSON.stringify(value ?? {})) as Json;
const chunk = <T,>(values: T[], size: number) => {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
};
const stripFeishuV2ContactFields = (row: ContactInsert): ContactInsert => {
  const {
    feishu_user_id: _feishuUserId,
    feishu_open_id: _feishuOpenId,
    feishu_union_id: _feishuUnionId,
    avatar: _avatar,
    department_id: _departmentId,
    department_name: _departmentName,
    status: _status,
    raw_payload: _rawPayload,
    ...compatibleRow
  } = row;
  return compatibleRow;
};
const stripFeishuV2MeetingFields = (row: MeetingInsert): MeetingInsert => {
  const {
    external_source: _externalSource,
    external_id: _externalId,
    location: _location,
    meeting_url: _meetingUrl,
    calendar_id: _calendarId,
    organizer_id: _organizerId,
    raw_payload: _rawPayload,
    ...compatibleRow
  } = row;
  return compatibleRow;
};
const isMissingSchemaColumnError = (error: { message?: string }) =>
  /Could not find the '.+' column of '.+' in the schema cache/i.test(error.message ?? "");
const compactLogs = (logs: FeishuSyncLog[]) => {
  const important = logs.filter(log =>
    log.error
    || log.command.includes("prepare")
    || log.command.includes("upsert")
    || log.command.includes("skip")
    || (log.itemsLength ?? log.returnedCount) > 0
  );
  const combined = [...important, ...logs.slice(-80)];
  const seen = new Set<string>();
  return combined.filter(log => {
    const key = `${log.command}:${log.endpoint}:${log.msg ?? ""}:${log.itemsLength ?? log.returnedCount}:${log.error ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(-160);
};

const memberExternalId = (member: FeishuChatMember) => clean(member.open_id || member.member_id || member.user_id);
const userExternalId = (user: FeishuUser) => clean(user.user_id || user.open_id || user.union_id);
const userOpenId = (user: FeishuUser) => clean(user.open_id);

const defaultDateRange = () => {
  const today = new Date();
  const start = new Date(today);
  start.setHours(0, 0, 0, 0);
  const end = new Date(today);
  end.setHours(23, 59, 59, 999);
  return {
    startDate: formatLocalDate(start),
    endDate: formatLocalDate(end),
  };
};

async function loadExisting(supabase: Awaited<ReturnType<typeof getAuthenticatedSupabase>>["supabase"], userId: string) {
  const [contacts, groups, meetings] = await Promise.all([
    supabase.from("contacts").select("*").eq("user_id", userId),
    supabase.from("contact_groups").select("*").eq("user_id", userId),
    supabase.from("meetings").select("*").eq("user_id", userId),
  ]);
  if (contacts.error) throw contacts.error;
  if (groups.error) throw groups.error;
  if (meetings.error) throw meetings.error;
  return {
    contacts: (contacts.data ?? []) as ContactRow[],
    groups: (groups.data ?? []) as GroupRow[],
    meetings: (meetings.data ?? []) as MeetingRow[],
  };
}

async function getFreshFeishuUserAccessToken(userId: string, logs: FeishuSyncLog[]) {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("feishu_user_connections")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  const connection = data as FeishuUserConnection | null;
  if (!connection?.access_token) {
    throw new FeishuApiError("请先连接飞书个人日历，再同步会议。");
  }

  const expiresAt = connection.expires_at ? new Date(connection.expires_at).getTime() : 0;
  if (!connection.refresh_token || !expiresAt || expiresAt - Date.now() > 5 * 60 * 1000) {
    return connection.access_token;
  }

  const refreshed = await refreshFeishuUserAccessToken(connection.refresh_token);
  if (!refreshed.access_token) throw new FeishuApiError("飞书用户授权刷新失败，请重新连接个人日历。");

  const nextAccessToken = refreshed.access_token;
  const nextRefreshToken = refreshed.refresh_token || connection.refresh_token;
  const { error: updateError } = await supabase.from("feishu_user_connections").update({
    access_token: nextAccessToken,
    refresh_token: nextRefreshToken,
    token_type: refreshed.token_type ?? connection.token_type,
    scope: refreshed.scope ?? connection.scope,
    expires_at: refreshed.expires_in ? new Date(Date.now() + refreshed.expires_in * 1000).toISOString() : connection.expires_at,
    refresh_expires_at: refreshed.refresh_expires_in ? new Date(Date.now() + refreshed.refresh_expires_in * 1000).toISOString() : connection.refresh_expires_at,
    updated_at: nowIso(),
  }).eq("user_id", userId);
  if (updateError) throw updateError;

  logs.push({
    type: "meetings",
    command: "oauth.token.refresh",
    endpoint: "authen/v2/oauth/token",
    url: "https://open.feishu.cn/open-apis/authen/v2/oauth/token",
    code: 0,
    msg: "飞书个人日历授权已自动刷新。",
    itemsLength: 0,
    returnedCount: 0,
    hasMore: false,
    pageTokenPresent: false,
  });
  return nextAccessToken;
}

function createContactUpserter(existingContacts: ContactRow[], userId: string) {
  const contactsByExternalId = new Map(existingContacts.filter(c => c.external_source === "feishu" && c.external_id).map(c => [c.external_id as string, c]));
  const contactsByFeishuUserId = new Map(existingContacts.filter(c => c.feishu_user_id).map(c => [c.feishu_user_id as string, c]));
  const contactsByOpenId = new Map(existingContacts.filter(c => c.feishu_open_id).map(c => [c.feishu_open_id as string, c]));
  const contactsByEmail = new Map(existingContacts.filter(c => c.email).map(c => [normalize(c.email), c]));
  const contactsByName = new Map(existingContacts.filter(c => !c.email).map(c => [normalize(c.name), c]));
  const rowsById = new Map<string, ContactInsert>();
  const idByExternalId = new Map<string, string>();

  for (const contact of existingContacts) {
    if (contact.external_source === "feishu" && contact.external_id) idByExternalId.set(contact.external_id, contact.id);
    if (contact.feishu_user_id) idByExternalId.set(contact.feishu_user_id, contact.id);
    if (contact.feishu_open_id) idByExternalId.set(contact.feishu_open_id, contact.id);
  }

  const upsert = (input: {
    externalId: string;
    openId?: string;
    unionId?: string;
    name: string;
    email?: string;
    phone?: string;
    role?: string;
    team?: string;
    avatar?: string;
    departmentId?: string;
    departmentName?: string;
    status?: string;
    rawPayload?: unknown;
    notes?: string;
  }) => {
    const emailKey = normalize(input.email);
    const existing = contactsByExternalId.get(input.externalId)
      ?? contactsByFeishuUserId.get(input.externalId)
      ?? (input.openId ? contactsByOpenId.get(input.openId) : undefined)
      ?? (emailKey ? contactsByEmail.get(emailKey) : undefined)
      ?? (!emailKey ? contactsByName.get(normalize(input.name)) : undefined);

    const row: ContactInsert = {
      id: existing?.id ?? uuid(),
      user_id: userId,
      name: input.name || existing?.name || "未命名飞书联系人",
      role: input.role || existing?.role || null,
      team: input.team || existing?.team || null,
      company: existing?.company || "飞书",
      email: input.email || existing?.email || null,
      phone: input.phone || existing?.phone || null,
      notes: existing?.notes || input.notes || "从飞书导入",
      external_source: "feishu",
      external_id: input.externalId,
      feishu_user_id: input.externalId || null,
      feishu_open_id: input.openId || null,
      feishu_union_id: input.unionId || null,
      avatar: input.avatar || null,
      department_id: input.departmentId || null,
      department_name: input.departmentName || null,
      status: input.status || null,
      raw_payload: asJson(input.rawPayload),
      created_at: existing?.created_at ?? nowIso(),
      updated_at: nowIso(),
    };
    rowsById.set(row.id as string, row);
    idByExternalId.set(input.externalId, row.id as string);
    if (input.openId) idByExternalId.set(input.openId, row.id as string);
    return row.id as string;
  };

  return { upsert, rowsById, idByExternalId };
}

function createGroupRows(feishuChats: FeishuChat[], existingGroups: GroupRow[], userId: string, memberContactIds: Map<string, string[]>) {
  const groupsByExternalId = new Map(existingGroups.filter(g => g.external_source === "feishu" && g.external_id).map(g => [g.external_id as string, g]));
  const groupsByChatId = new Map(existingGroups.filter(g => g.feishu_chat_id).map(g => [g.feishu_chat_id as string, g]));
  const idByChatId = new Map<string, string>();
  const rows: GroupInsert[] = feishuChats
    .filter(chat => chat.chat_id && clean(chat.name))
    .map(chat => {
      const existing = groupsByExternalId.get(chat.chat_id) ?? groupsByChatId.get(chat.chat_id);
      const id = existing?.id ?? uuid();
      idByChatId.set(chat.chat_id, id);
      return {
        id,
        user_id: userId,
        name: clean(chat.name),
        description: clean(chat.description) || existing?.description || "从飞书群聊导入",
        contact_ids: unique(memberContactIds.get(chat.chat_id) ?? existing?.contact_ids ?? []),
        external_source: "feishu",
        external_id: chat.chat_id,
        feishu_chat_id: chat.chat_id,
        owner_id: clean(chat.owner_id) || null,
        member_count: chat.member_count ?? (memberContactIds.get(chat.chat_id)?.length ?? existing?.member_count ?? 0),
        raw_payload: asJson(chat),
        created_at: existing?.created_at ?? nowIso(),
        updated_at: nowIso(),
      };
    });
  return { rows, idByChatId };
}

function eventDurationMinutes(event: FeishuCalendarEvent) {
  const start = normalizeFeishuEventTime(event.start_time);
  const end = normalizeFeishuEventTime(event.end_time);
  if (!start || !end) return 0;
  return Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000));
}

function createMeetingRows(
  events: Array<FeishuCalendarEvent & { calendar_id: string }>,
  existingMeetings: MeetingRow[],
  userId: string,
): MeetingInsert[] {
  const meetingsByExternalId = new Map(existingMeetings.filter(m => m.external_source === "feishu" && m.external_id).map(m => [m.external_id as string, m]));
  return events
    .filter(event => event.event_id && (event.summary || event.title))
    .map(event => {
      const existing = meetingsByExternalId.get(event.event_id as string);
      const start = normalizeFeishuEventTime(event.start_time);
      const end = normalizeFeishuEventTime(event.end_time) || null;
      const dateOnlyFallback = event.start_time?.date ? `${event.start_time.date}T00:00:00+08:00` : null;
      const meetingUrl = clean(event.vchat?.meeting_url || event.vchat?.vc_url || event.app_link);
      return {
        id: existing?.id ?? `feishu_meeting_${event.event_id}`,
        user_id: userId,
        title: clean(event.summary || event.title) || "未命名飞书会议",
        start_time: start || null,
        date: start || dateOnlyFallback || existing?.date || nowIso(),
        end_time: end,
        duration_minutes: eventDurationMinutes(event),
        attendees: unique((event.attendees ?? []).map(attendee => clean(attendee.display_name || attendee.email || attendee.open_id || attendee.user_id))),
        notes: clean(event.description) || existing?.notes || "从飞书日历导入",
        decisions: existing?.decisions ?? [],
        related_project_id: existing?.related_project_id ?? null,
        external_source: "feishu",
        external_id: event.event_id,
        location: clean(event.location?.name || event.location?.address) || null,
        meeting_url: meetingUrl || null,
        calendar_id: event.calendar_id,
        organizer_id: clean(event.organizer_calendar_id) || null,
        raw_payload: asJson(event),
        created_at: existing?.created_at ?? nowIso(),
        updated_at: nowIso(),
      };
    });
}

export async function POST(request: Request) {
  const logs: FeishuSyncLog[] = [];
  const warnings: string[] = [];

  try {
    const { supabase, user } = await getAuthenticatedSupabase(request);
    const body = await request.json().catch(() => ({}));
    const action = (body.action ?? "all") as SyncAction;
    const range = {
      ...defaultDateRange(),
      startDate: body.startDate || defaultDateRange().startDate,
      endDate: body.endDate || defaultDateRange().endDate,
    };

    if (action === "test") {
      await testFeishuConnection(logs);
      return NextResponse.json({ ok: true, action, logs: compactLogs(logs), warnings, stats: {}, lastSyncedAt: nowIso() });
    }

    const token = action === "meetings" ? "" : await getTenantAccessToken();
    const existing = await loadExisting(supabase, user.id);
    const contactUpserter = createContactUpserter(existing.contacts, user.id);
    const stats = {
      contactsImported: 0,
      groupsImported: 0,
      groupMembersImported: 0,
      meetingsImported: 0,
    };

    let feishuUsers: FeishuUser[] = [];
    let feishuChats: FeishuChat[] = [];
    const chatMembers = new Map<string, FeishuChatMember[]>();

    if (action === "contacts" || action === "all") {
      feishuUsers = await listFeishuOrgUsers(token, logs);
      let skippedMissingId = 0;
      let skippedMissingName = 0;
      for (const feishuUser of feishuUsers) {
        const externalId = userExternalId(feishuUser);
        const name = clean(feishuUser.name || feishuUser.en_name);
        if (!externalId) {
          skippedMissingId += 1;
          continue;
        }
        if (!name) {
          skippedMissingName += 1;
          continue;
        }
        contactUpserter.upsert({
          externalId,
          openId: userOpenId(feishuUser),
          unionId: clean(feishuUser.union_id),
          name,
          email: clean(feishuUser.email || feishuUser.enterprise_email),
          phone: clean(feishuUser.mobile),
          role: clean(feishuUser.job_title),
          team: clean(feishuUser.raw_department_name || (feishuUser.department_ids ?? []).join(" / ")),
          avatar: clean(feishuUser.avatar?.avatar_240 || feishuUser.avatar?.avatar_72 || feishuUser.avatar?.avatar_origin),
          departmentId: clean(feishuUser.raw_department_id || feishuUser.department_id || feishuUser.department_ids?.[0]),
          departmentName: clean(feishuUser.raw_department_name || feishuUser.department_name),
          status: typeof feishuUser.status === "string" ? feishuUser.status : JSON.stringify(feishuUser.status ?? ""),
          rawPayload: feishuUser,
          notes: "从飞书组织通讯录导入",
        });
      }
      stats.contactsImported = contactUpserter.rowsById.size;
      logs.push({
        type: "contacts",
        command: "workos.contacts.prepare",
        endpoint: "contacts",
        msg: `飞书返回 ${feishuUsers.length} 人，准备写入 ${contactUpserter.rowsById.size} 人，跳过缺 ID ${skippedMissingId} 人，跳过缺姓名 ${skippedMissingName} 人。`,
        itemsLength: feishuUsers.length,
        returnedCount: contactUpserter.rowsById.size,
        hasMore: false,
        pageTokenPresent: false,
      });
      if (feishuUsers.length <= 1) {
        warnings.push("本次组织联系人数量 ≤ 1。可能原因：通讯录权限不足、应用可用范围仍受限、根部门不可读、没有部门成员权限，或飞书只返回了当前用户。");
      }
    }

    if (action === "groups" || action === "members" || action === "all") {
      feishuChats = await listFeishuChats(token, logs);
    }

    if (action === "members" || action === "all") {
      for (const chat of feishuChats) {
        if (!chat.chat_id) continue;
        try {
          chatMembers.set(chat.chat_id, await listFeishuChatMembers(token, chat.chat_id, logs));
        } catch (error) {
          if (!isFeishuPermissionError(error)) throw error;
          warnings.push(`跳过群成员同步：${clean(chat.name) || chat.chat_id} 缺少群成员读取权限。`);
          chatMembers.set(chat.chat_id, []);
        }
      }

      for (const members of chatMembers.values()) {
        for (const member of members) {
          const externalId = memberExternalId(member);
          if (!externalId) continue;
          contactUpserter.upsert({
            externalId,
            openId: clean(member.open_id || member.member_id),
            name: clean(member.name) || externalId,
            email: clean(member.email),
            rawPayload: member,
            notes: "从飞书群成员导入",
          });
        }
      }
    }

    const contactRows = [...contactUpserter.rowsById.values()];
    if (contactRows.length) {
      const batches = chunk(contactRows, 100);
      for (const [index, batch] of batches.entries()) {
        let { error } = await supabase.from("contacts").upsert(batch, { onConflict: "id" });
        if (error && isMissingSchemaColumnError(error)) {
          const compatibleBatch = batch.map(stripFeishuV2ContactFields);
          const retry = await supabase.from("contacts").upsert(compatibleBatch, { onConflict: "id" });
          logs.push({
            type: "contacts",
            command: "supabase.contacts.upsert.compatible_schema",
            endpoint: "contacts",
            msg: retry.error
              ? `云端 contacts 表缺少飞书扩展字段，兼容写入第 ${index + 1}/${batches.length} 批仍失败：${retry.error.message}`
              : `云端 contacts 表缺少飞书扩展字段，已用基础联系人字段兼容写入第 ${index + 1}/${batches.length} 批。`,
            itemsLength: compatibleBatch.length,
            returnedCount: retry.error ? 0 : compatibleBatch.length,
            hasMore: index < batches.length - 1,
            pageTokenPresent: false,
            upsertCount: retry.error ? 0 : compatibleBatch.length,
            error: retry.error?.message,
          });
          error = retry.error;
        }
        if (error) {
          logs.push({
            type: "contacts",
            command: "supabase.contacts.upsert.batch",
            endpoint: "contacts",
            msg: `contacts 第 ${index + 1}/${batches.length} 批写入失败：${error.message}`,
            itemsLength: batch.length,
            returnedCount: 0,
            hasMore: index < batches.length - 1,
            pageTokenPresent: false,
            error: error.message,
          });
          throw error;
        }
        logs.push({
          type: "contacts",
          command: "supabase.contacts.upsert.batch",
          endpoint: "contacts",
          msg: `contacts 第 ${index + 1}/${batches.length} 批写入成功：${batch.length} 人。`,
          itemsLength: batch.length,
          returnedCount: batch.length,
          hasMore: index < batches.length - 1,
          pageTokenPresent: false,
          upsertCount: batch.length,
        });
      }
      stats.contactsImported = contactRows.length;
      logs.push({ type: "contacts", command: "supabase.contacts.upsert", endpoint: "contacts", msg: `已向 contacts 写入/更新 ${contactRows.length} 人。`, itemsLength: contactRows.length, returnedCount: contactRows.length, hasMore: false, pageTokenPresent: false, upsertCount: contactRows.length });
    }

    const memberContactIdsByChatId = new Map<string, string[]>();
    for (const [chatId, members] of chatMembers.entries()) {
      memberContactIdsByChatId.set(chatId, unique(members.map(member => contactUpserter.idByExternalId.get(memberExternalId(member)) ?? "")));
    }

    if (action === "groups" || action === "members" || action === "all") {
      const { rows: groupRows, idByChatId } = createGroupRows(feishuChats, existing.groups, user.id, memberContactIdsByChatId);
      if (groupRows.length) {
        const { error } = await supabase.from("contact_groups").upsert(groupRows, { onConflict: "id" });
        if (error) throw error;
        stats.groupsImported = groupRows.length;
        logs.push({ type: "groups", command: "supabase.contact_groups.upsert", endpoint: "contact_groups", returnedCount: groupRows.length, hasMore: false, pageTokenPresent: false, upsertCount: groupRows.length });
      }

      if (action === "members" || action === "all") {
        const memberRows: MemberInsert[] = [];
        for (const [chatId, members] of chatMembers.entries()) {
          const groupId = idByChatId.get(chatId);
          if (!groupId) continue;
          for (const member of members) {
            const externalId = memberExternalId(member);
            const contactId = contactUpserter.idByExternalId.get(externalId);
            if (!contactId) continue;
            memberRows.push({
              id: `${groupId}_${contactId}`,
              user_id: user.id,
              group_id: groupId,
              contact_id: contactId,
              feishu_user_id: externalId,
              open_id: clean(member.open_id || member.member_id) || null,
              role: clean(member.role || member.member_type) || null,
              joined_at: member.join_time ? new Date(Number(member.join_time) * 1000).toISOString() : null,
              raw_payload: asJson(member),
              created_at: nowIso(),
              updated_at: nowIso(),
            });
          }
        }
        if (memberRows.length) {
          const { error } = await supabase.from("contact_group_members").upsert(memberRows, { onConflict: "user_id,group_id,contact_id" });
          if (error) throw error;
          stats.groupMembersImported = memberRows.length;
          logs.push({ type: "members", command: "supabase.contact_group_members.upsert", endpoint: "contact_group_members", returnedCount: memberRows.length, hasMore: false, pageTokenPresent: false, upsertCount: memberRows.length });
        }
      }
    }

    if (action === "meetings" || action === "all") {
      try {
        let events: Awaited<ReturnType<typeof listFeishuMeetings>>;
        try {
          const userAccessToken = await getFreshFeishuUserAccessToken(user.id, logs);
          events = await listFeishuMeetingsWithUserAccessToken(userAccessToken, range.startDate, range.endDate, logs);
        } catch (oauthError) {
          logs.push({
            type: "meetings",
            command: "oauth.calendar.fallback",
            endpoint: "feishu oauth calendar",
            msg: oauthError instanceof Error ? `飞书 OAuth 用户身份读取失败：${oauthError.message}` : "飞书 OAuth 用户身份读取失败。",
            itemsLength: 0,
            returnedCount: 0,
            hasMore: false,
            pageTokenPresent: false,
            error: oauthError instanceof Error ? oauthError.message : String(oauthError),
          });
          if (process.env.NODE_ENV === "production") throw oauthError;
          try {
            events = await listFeishuMeetingsFromCliUser(range.startDate, range.endDate, logs);
          } catch {
            throw oauthError;
          }
        }
        const meetingRows = createMeetingRows(events, existing.meetings, user.id);
        if (meetingRows.length) {
          let { error } = await supabase.from("meetings").upsert(meetingRows, { onConflict: "id" });
          if (error && isMissingSchemaColumnError(error)) {
            const compatibleRows = meetingRows.map(stripFeishuV2MeetingFields);
            const retry = await supabase.from("meetings").upsert(compatibleRows, { onConflict: "id" });
            logs.push({
              type: "meetings",
              command: "supabase.meetings.upsert.compatible_schema",
              endpoint: "meetings",
              msg: retry.error
                ? `云端 meetings 表缺少飞书扩展字段，兼容写入仍失败：${retry.error.message}`
                : "云端 meetings 表缺少飞书扩展字段，已用基础会议字段兼容写入。",
              itemsLength: compatibleRows.length,
              returnedCount: retry.error ? 0 : compatibleRows.length,
              hasMore: false,
              pageTokenPresent: false,
              upsertCount: retry.error ? 0 : compatibleRows.length,
              error: retry.error?.message,
            });
            error = retry.error;
          }
          if (error) {
            logs.push({
              type: "meetings",
              command: "supabase.meetings.upsert",
              endpoint: "meetings",
              msg: `meetings 写入失败：${error.message}`,
              itemsLength: meetingRows.length,
              returnedCount: 0,
              hasMore: false,
              pageTokenPresent: false,
              error: error.message,
            });
            throw error;
          }
        }
        stats.meetingsImported = meetingRows.length;
        logs.push({ type: "meetings", command: "supabase.meetings.upsert", endpoint: "meetings", returnedCount: meetingRows.length, hasMore: false, pageTokenPresent: false, upsertCount: meetingRows.length });
      } catch (error) {
        if (!isFeishuPermissionError(error)) throw error;
        warnings.push("跳过会议同步：飞书应用尚未开通日历读取权限。请在开放平台为 WorkOS 使用的应用开通 calendar:calendar:readonly 或等效权限。");
        logs.push({
          type: "meetings",
          command: "calendar.v4.meetings.skip",
          endpoint: "calendar/v4",
          msg: error instanceof Error ? `跳过会议同步：${error.message}` : "跳过会议同步：缺少日历权限。",
          itemsLength: 0,
          returnedCount: 0,
          hasMore: false,
          pageTokenPresent: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return NextResponse.json({
      ok: true,
      action,
      stats,
      contactsImported: stats.contactsImported,
      groupsImported: stats.groupsImported,
      groupMembersImported: stats.groupMembersImported,
      meetingsImported: stats.meetingsImported,
      lastSyncedAt: nowIso(),
      logs: compactLogs(logs),
      warnings,
    });
  } catch (error) {
    const detail = error instanceof FeishuApiError && error.endpoint
      ? `${error.message}（endpoint: ${error.endpoint}）`
      : error instanceof Error ? error.message : "飞书同步失败，请稍后重试。";
    return NextResponse.json(
      {
        ok: false,
        error: detail,
        logs: compactLogs(logs),
        warnings,
        suggestions: [
          "确认飞书应用通讯录、部门、群聊、群成员、日历权限已经开启。",
          "确认应用可用范围包含需要同步的成员。",
          "如果只同步到 1 个联系人，重点检查是否仍然只允许访问当前用户，或部门遍历权限不足。",
        ],
      },
      { status: 400 },
    );
  }
}
