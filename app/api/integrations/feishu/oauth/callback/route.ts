import { NextResponse } from "next/server";
import {
  exchangeFeishuOAuthCode,
  FeishuUserInfo,
  getFeishuUserInfo,
  verifyFeishuOAuthState,
} from "@/lib/feishu/client";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const appBaseUrl = () => (process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}` || "http://localhost:3000").replace(/\/$/, "");
const redirectToApp = (status: "connected" | "error", message?: string) => {
  const url = new URL(appBaseUrl());
  url.searchParams.set("feishu_calendar", status);
  if (message) url.searchParams.set("message", message);
  return NextResponse.redirect(url);
};
const expiresAt = (seconds?: number) => seconds ? new Date(Date.now() + seconds * 1000).toISOString() : null;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) return redirectToApp("error", "飞书授权回调缺少 code 或 state。");

    const userId = verifyFeishuOAuthState(state);
    const token = await exchangeFeishuOAuthCode(code);
    if (!token.access_token) return redirectToApp("error", "飞书未返回用户访问凭证。");

    const info = await getFeishuUserInfo(token.access_token).catch(() => ({} as FeishuUserInfo));
    const supabase = getSupabaseAdminClient();
    const { error } = await supabase.from("feishu_user_connections").upsert({
      user_id: userId,
      feishu_open_id: info.open_id ?? null,
      feishu_union_id: info.union_id ?? null,
      feishu_user_id: info.user_id ?? null,
      name: info.name || info.en_name || null,
      email: info.email || info.enterprise_email || null,
      access_token: token.access_token,
      refresh_token: token.refresh_token ?? null,
      token_type: token.token_type ?? null,
      scope: token.scope ?? null,
      expires_at: expiresAt(token.expires_in),
      refresh_expires_at: expiresAt(token.refresh_expires_in),
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (error) throw error;

    return redirectToApp("connected");
  } catch (error) {
    return redirectToApp("error", error instanceof Error ? error.message : "飞书个人日历授权失败。");
  }
}
