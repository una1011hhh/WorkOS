import { NextResponse } from "next/server";
import { buildFeishuOAuthUrl, feishuOAuthRedirectUri } from "@/lib/feishu/client";
import { getAuthenticatedSupabase } from "@/lib/supabase/server-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { user } = await getAuthenticatedSupabase(request);
    return NextResponse.json({
      ok: true,
      url: buildFeishuOAuthUrl(user.id),
      redirectUri: feishuOAuthRedirectUri(),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "无法发起飞书个人日历授权。" },
      { status: 400 },
    );
  }
}
