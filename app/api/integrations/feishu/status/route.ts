import { NextResponse } from "next/server";
import { isFeishuConfigured } from "@/lib/feishu/client";
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
  if (error) throw error;
  return count ?? 0;
}

export async function GET(request: Request) {
  try {
    const { supabase, user } = await getAuthenticatedSupabase(request);
    const [contactLatest, groupLatest, meetingLatest, contactsCount, groupsCount, meetingsCount, membersCount] = await Promise.all([
      supabase
        .from("contacts")
        .select("updated_at")
        .eq("user_id", user.id)
        .eq("external_source", "feishu")
        .order("updated_at", { ascending: false })
        .limit(1),
      supabase
        .from("contact_groups")
        .select("updated_at")
        .eq("user_id", user.id)
        .eq("external_source", "feishu")
        .order("updated_at", { ascending: false })
        .limit(1),
      supabase
        .from("meetings")
        .select("updated_at")
        .eq("user_id", user.id)
        .eq("external_source", "feishu")
        .order("updated_at", { ascending: false })
        .limit(1),
      countExternal(supabase, "contacts", user.id),
      countExternal(supabase, "contact_groups", user.id),
      countExternal(supabase, "meetings", user.id),
      supabase
        .from("contact_group_members")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id),
    ]);

    const firstError = [contactLatest.error, groupLatest.error, meetingLatest.error, membersCount.error].find(Boolean);
    if (firstError) throw firstError;

    const latest = [contactLatest.data?.[0]?.updated_at, groupLatest.data?.[0]?.updated_at, meetingLatest.data?.[0]?.updated_at]
      .filter(Boolean)
      .sort()
      .at(-1) ?? null;

    return NextResponse.json({
      configured: isFeishuConfigured(),
      cliConnected: isFeishuConfigured(),
      lastSyncedAt: latest,
      stats: {
        contacts: contactsCount,
        groups: groupsCount,
        groupMembers: membersCount.count ?? 0,
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
