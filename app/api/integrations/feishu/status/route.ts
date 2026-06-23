import { NextResponse } from "next/server";
import { isFeishuConfigured } from "@/lib/feishu/client";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedSupabase } from "@/lib/supabase/server-auth";

export const dynamic = "force-dynamic";

async function countExternal(
  supabase: Awaited<ReturnType<typeof getAuthenticatedSupabase>>["supabase"],
  table: "contacts" | "contact_groups" | "meetings",
  userId: string,
) {
  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("external_source", "feishu");
  if (error) return 0;
  return count ?? 0;
}

async function latestExternal(
  supabase: Awaited<ReturnType<typeof getAuthenticatedSupabase>>["supabase"],
  table: "contacts" | "contact_groups" | "meetings",
  userId: string,
) {
  const { data, error } = await supabase
    .from(table)
    .select("updated_at")
    .eq("user_id", userId)
    .eq("external_source", "feishu")
    .order("updated_at", { ascending: false })
    .limit(1);
  if (error) return null;
  return data?.[0]?.updated_at ?? null;
}

async function countGroupMembers(
  supabase: Awaited<ReturnType<typeof getAuthenticatedSupabase>>["supabase"],
  userId: string,
) {
  const { count, error } = await supabase
    .from("contact_group_members")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (error) return 0;
  return count ?? 0;
}

export async function GET(request: Request) {
  try {
    const { supabase, user } = await getAuthenticatedSupabase(request);
    let calendarConnection: { name?: string | null; email?: string | null; expires_at?: string | null } | null = null;
    try {
      const { data } = await getSupabaseAdminClient()
        .from("feishu_user_connections")
        .select("name,email,expires_at")
        .eq("user_id", user.id)
        .maybeSingle();
      calendarConnection = data;
    } catch {
      calendarConnection = null;
    }
    const [contactLatest, groupLatest, meetingLatest, contactsCount, groupsCount, meetingsCount, membersCount] = await Promise.all([
      latestExternal(supabase, "contacts", user.id),
      latestExternal(supabase, "contact_groups", user.id),
      latestExternal(supabase, "meetings", user.id),
      countExternal(supabase, "contacts", user.id),
      countExternal(supabase, "contact_groups", user.id),
      countExternal(supabase, "meetings", user.id),
      countGroupMembers(supabase, user.id),
    ]);

    const latest = [contactLatest, groupLatest, meetingLatest]
      .filter(Boolean)
      .sort()
      .at(-1) ?? null;

    return NextResponse.json({
      configured: isFeishuConfigured(),
      cliConnected: isFeishuConfigured(),
      personalCalendarConnected: Boolean(calendarConnection),
      personalCalendarName: calendarConnection?.name ?? calendarConnection?.email ?? null,
      personalCalendarExpiresAt: calendarConnection?.expires_at ?? null,
      lastSyncedAt: latest,
      stats: {
        contacts: contactsCount,
        groups: groupsCount,
        groupMembers: membersCount,
        meetings: meetingsCount,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "无法读取飞书集成状态。" },
      { status: 401 },
    );
  }
}
