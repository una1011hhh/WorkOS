import { NextResponse } from "next/server";
import { FeishuChatMember, getTenantAccessToken, listFeishuChatMembers, listFeishuChats, listFeishuUsers } from "@/lib/feishu/client";
import { getAuthenticatedSupabase } from "@/lib/supabase/server-auth";
import { Database } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

type ContactRow = Database["public"]["Tables"]["contacts"]["Row"];
type ContactInsert = Database["public"]["Tables"]["contacts"]["Insert"];
type GroupRow = Database["public"]["Tables"]["contact_groups"]["Row"];
type GroupInsert = Database["public"]["Tables"]["contact_groups"]["Insert"];

const clean = (value?: string | null) => (value ?? "").trim();
const normalize = (value?: string | null) => clean(value).toLocaleLowerCase("zh-CN");
const unique = (values: string[]) => [...new Set(values.filter(Boolean))];
const nowIso = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();

const memberExternalId = (member: FeishuChatMember) => clean(member.member_id);

export async function POST(request: Request) {
  try {
    const { supabase, user } = await getAuthenticatedSupabase(request);
    const token = await getTenantAccessToken();

    const [feishuUsers, feishuChats] = await Promise.all([
      listFeishuUsers(token),
      listFeishuChats(token),
    ]);

    const chatMembers = new Map<string, FeishuChatMember[]>();
    for (const chat of feishuChats) {
      if (!chat.chat_id) continue;
      chatMembers.set(chat.chat_id, await listFeishuChatMembers(token, chat.chat_id));
    }

    const [existingContactsResult, existingGroupsResult] = await Promise.all([
      supabase.from("contacts").select("*").eq("user_id", user.id),
      supabase.from("contact_groups").select("*").eq("user_id", user.id),
    ]);
    if (existingContactsResult.error) throw existingContactsResult.error;
    if (existingGroupsResult.error) throw existingGroupsResult.error;

    const existingContacts = (existingContactsResult.data ?? []) as ContactRow[];
    const existingGroups = (existingGroupsResult.data ?? []) as GroupRow[];
    const contactsByExternalId = new Map(existingContacts.filter(c => c.external_source === "feishu" && c.external_id).map(c => [c.external_id as string, c]));
    const contactsByEmail = new Map(existingContacts.filter(c => c.email).map(c => [normalize(c.email), c]));
    const contactsByName = new Map(existingContacts.filter(c => !c.email).map(c => [normalize(c.name), c]));
    const groupsByExternalId = new Map(existingGroups.filter(g => g.external_source === "feishu" && g.external_id).map(g => [g.external_id as string, g]));

    const contactRowsById = new Map<string, ContactInsert>();
    const contactIdByExternalId = new Map<string, string>();
    for (const contact of existingContacts) {
      if (contact.external_source === "feishu" && contact.external_id) contactIdByExternalId.set(contact.external_id, contact.id);
    }

    const upsertContact = (input: {
      externalId: string;
      name: string;
      email?: string;
      phone?: string;
      role?: string;
      team?: string;
      notes?: string;
    }) => {
      const emailKey = normalize(input.email);
      const existing = contactsByExternalId.get(input.externalId)
        ?? (emailKey ? contactsByEmail.get(emailKey) : undefined)
        ?? (!emailKey ? contactsByName.get(normalize(input.name)) : undefined);
      const row: ContactInsert = {
        id: existing?.id ?? uuid(),
        user_id: user.id,
        name: input.name || existing?.name || "未命名飞书联系人",
        role: input.role || existing?.role || null,
        team: input.team || existing?.team || null,
        company: existing?.company || "飞书",
        email: input.email || existing?.email || null,
        phone: input.phone || existing?.phone || null,
        notes: existing?.notes || input.notes || "从飞书导入",
        external_source: "feishu",
        external_id: input.externalId,
        created_at: existing?.created_at ?? nowIso(),
        updated_at: nowIso(),
      };
      contactRowsById.set(row.id as string, row);
      contactIdByExternalId.set(input.externalId, row.id as string);
      return row.id as string;
    };

    for (const feishuUser of feishuUsers) {
      const externalId = clean(feishuUser.open_id || feishuUser.user_id);
      const name = clean(feishuUser.name || feishuUser.en_name);
      if (!externalId || !name) continue;
      upsertContact({
        externalId,
        name,
        email: clean(feishuUser.email || feishuUser.enterprise_email),
        phone: clean(feishuUser.mobile),
        role: clean(feishuUser.job_title),
        team: (feishuUser.department_ids ?? []).join(" / "),
        notes: "从飞书通讯录导入",
      });
    }

    for (const members of chatMembers.values()) {
      for (const member of members) {
        const externalId = memberExternalId(member);
        if (!externalId) continue;
        upsertContact({
          externalId,
          name: clean(member.name) || externalId,
          email: clean(member.email),
          notes: "从飞书群成员导入",
        });
      }
    }

    const contactRows = [...contactRowsById.values()];
    if (contactRows.length) {
      const { error } = await supabase.from("contacts").upsert(contactRows, { onConflict: "id" });
      if (error) throw error;
    }

    const groupRows: GroupInsert[] = feishuChats
      .filter(chat => chat.chat_id && clean(chat.name))
      .map(chat => {
        const existing = groupsByExternalId.get(chat.chat_id);
        const memberContactIds = unique((chatMembers.get(chat.chat_id) ?? [])
          .map(member => contactIdByExternalId.get(memberExternalId(member)) ?? ""));
        return {
          id: existing?.id ?? uuid(),
          user_id: user.id,
          name: clean(chat.name),
          description: clean(chat.description) || existing?.description || "从飞书群聊导入",
          contact_ids: memberContactIds,
          external_source: "feishu",
          external_id: chat.chat_id,
          created_at: existing?.created_at ?? nowIso(),
          updated_at: nowIso(),
        };
      });

    if (groupRows.length) {
      const { error } = await supabase.from("contact_groups").upsert(groupRows, { onConflict: "id" });
      if (error) throw error;
    }

    return NextResponse.json({
      ok: true,
      contactsImported: contactRows.length,
      groupsImported: groupRows.length,
      lastSyncedAt: nowIso(),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "飞书同步失败，请稍后重试。" },
      { status: 400 },
    );
  }
}
