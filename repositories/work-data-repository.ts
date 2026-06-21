import { WorkData } from "@/lib/types";

export type RepositoryMode = "local" | "supabase";

export interface WorkDataRepository {
  load(): Promise<WorkData>;
  save(data: WorkData): Promise<void>;
  clear(): Promise<void>;
}
