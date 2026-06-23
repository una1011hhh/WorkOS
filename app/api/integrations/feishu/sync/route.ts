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
  listFeishuChatMembers,
  listFeishuChats,
  listFeishuMeetings,
  listFeishuOrgUsers,
  normalizeFeishuEventTime,
  testFeishuConnection,
} from "@/lib/feishu/client";
import { getAuthenticatedSupabase } from "@/lib/supabase/server-auth";
import { Database, Json } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

type ContactRow = Database["public"]["Tables"]["contacts"]["Row"];
type ContactInsert = Database["public"]["Tables"]["contacts"]["Insert"];
type GroupRow = Database["public"]["Tables"]["contact_groups"]["Row"];
type GroupInsert = Database["public"]["Tables"]["contact_groups"]["Insert"];
type MeetingRow = Database["public"]["Tables"]["meetings"]["Row"];
type MeetingInsert = Database["public"]["Tables"]["meetings"]["Insert"];
type MemberInsert = Database["public"]["Tables"]["contact_group_members"]["Insert"];

type SyncAction = "test" | "contacts" | "groups" | "members" | "meetings" | "all";

const clean = (value?: string | null) => (value ?? "").trim();
const normalize = (value?: string | null) => clean(value).toLocaleLowerCase("zh-CN");
const unique = (values: string[]) => [...new Set(values.filter(Boolean))];
const nowIso = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();
const asJson = (value: unknown): Json => JSON.parse(JSON.stringify(value ?? {})) as Json;

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
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
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
      const start = normalizeFeishuEventTime(event.start_time) || nowIso();
      const meetingUrl = clean(event.vchat?.meeting_url || event.vchat?.vc_url || event.app_link);
      return {
        id: existing?.id ?? `feishu_meeting_${event.event_id}`,
        user_id: userId,
        title: clean(event.summary || event.title) || "未命名飞书会议",
        date: start,
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
      return NextResponse.json({ ok: true, action, logs, warnings, stats: {}, lastSyncedAt: nowIso() });
    }

    const token = await getTenantAccessToken();
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
      for (const feishuUser of feishuUsers) {
        const externalId = userExternalId(feishuUser);
        const name = clean(feishuUser.name || feishuUser.en_name);
        if (!externalId || !name) continue;
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
      const { error } = await supabase.from("contacts").upsert(contactRows, { onConflict: "id" });
      if (error) throw error;
      stats.contactsImported = contactRows.length;
      logs.push({ type: "contacts", command: "supabase.contacts.upsert", endpoint: "contacts", returnedCount: contactRows.length, hasMore: false, pageTokenPresent: false, upsertCount: contactRows.length });
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
      const events = await listFeishuMeetings(token, range.startDate, range.endDate, logs);
      const meetingRows = createMeetingRows(events, existing.meetings, user.id);
      if (meetingRows.length) {
        const { error } = await supabase.from("meetings").upsert(meetingRows, { onConflict: "id" });
        if (error) throw error;
      }
      stats.meetingsImported = meetingRows.length;
      logs.push({ type: "meetings", command: "supabase.meetings.upsert", endpoint: "meetings", returnedCount: meetingRows.length, hasMore: false, pageTokenPresent: false, upsertCount: meetingRows.length });
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
      logs,
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
        logs,
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
