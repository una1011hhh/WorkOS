import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { SUPABASE_AUTH_TIMEOUT_MS, withTimeout } from "@/lib/supabase/safety";
import { localWorkDataRepository } from "./local-work-data-repository";
import { SupabaseWorkDataRepository } from "./supabase-work-data-repository";
import { RepositoryMode, WorkDataRepository } from "./work-data-repository";

export async function createWorkDataRepository(mode: RepositoryMode = "local"): Promise<WorkDataRepository> {
  if (mode === "local") return localWorkDataRepository;

  const supabase = getSupabaseBrowserClient();
  if (!supabase) return localWorkDataRepository;

  const { data, error } = await withTimeout(supabase.auth.getSession(), SUPABASE_AUTH_TIMEOUT_MS, "supabase auth session");
  if (error || !data.session?.user) return localWorkDataRepository;

  return new SupabaseWorkDataRepository(supabase, data.session.user.id);
}

export { localWorkDataRepository } from "./local-work-data-repository";
export { SupabaseWorkDataRepository } from "./supabase-work-data-repository";
export type { RepositoryMode, WorkDataRepository } from "./work-data-repository";
