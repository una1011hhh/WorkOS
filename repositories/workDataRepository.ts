import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { localWorkDataRepository } from "./local-work-data-repository";
import { SupabaseWorkDataRepository } from "./supabase-work-data-repository";
import { RepositoryMode, WorkDataRepository } from "./work-data-repository";

export async function createWorkDataRepository(mode: RepositoryMode = "local"): Promise<WorkDataRepository> {
  if (mode === "local") return localWorkDataRepository;

  const supabase = getSupabaseBrowserClient();
  if (!supabase) return localWorkDataRepository;

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return localWorkDataRepository;

  return new SupabaseWorkDataRepository(supabase, data.user.id);
}

export { localWorkDataRepository } from "./local-work-data-repository";
export { SupabaseWorkDataRepository } from "./supabase-work-data-repository";
export type { RepositoryMode, WorkDataRepository } from "./work-data-repository";
