import { createClient, SupabaseClient, User } from "@supabase/supabase-js";

export type AuthenticatedSupabase = {
  supabase: SupabaseClient;
  user: User;
};

export async function getAuthenticatedSupabase(request: Request): Promise<AuthenticatedSupabase> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase 环境变量未配置。");
  }

  if (!token) {
    throw new Error("请先登录 WorkOS 后再执行同步。");
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    throw new Error("登录状态已失效，请重新登录后再试。");
  }

  return { supabase, user: data.user };
}
