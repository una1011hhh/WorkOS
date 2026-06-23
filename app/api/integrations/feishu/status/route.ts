import { NextResponse } from "next/server";
import { isFeishuConfigured } from "@/lib/feishu/client";
import { getAuthenticatedSupabase } from "@/lib/supabase/server-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { supabase, user } = await getAuthenticatedSupabase(request);
    const [contactResult, groupResult] = await Promise.all([
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
    ]);

    if (contactResult.error) throw contactResult.error;
    if (groupResult.error) throw groupResult.error;

    const latest = [contactResult.data?.[0]?.updated_at, groupResult.data?.[0]?.updated_at]
      .filter(Boolean)
      .sort()
      .at(-1) ?? null;

    return NextResponse.json({
      configured: isFeishuConfigured(),
      lastSyncedAt: latest,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "无法读取飞书集成状态。" },
      { status: 401 },
    );
  }
}
