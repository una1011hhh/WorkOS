import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedSupabase } from "@/lib/supabase/server-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { user } = await getAuthenticatedSupabase(request);
    const supabase = getSupabaseAdminClient();
    const { error } = await supabase.from("feishu_user_connections").delete().eq("user_id", user.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "无法断开飞书个人日历。" },
      { status: 400 },
    );
  }
}
