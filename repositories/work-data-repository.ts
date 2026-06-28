import { WorkData } from "@/lib/types";

export type RepositoryMode = "local" | "supabase";
export type WorkDataEntity = "projects" | "tasks" | "meetings" | "reflections" | "reports" | "contacts" | "contact_groups";

export interface WorkDataRepository {
  load(): Promise<WorkData>;
  save(data: WorkData): Promise<void>;
  deleteEntity?(entity: WorkDataEntity, id: string): Promise<void>;
  clear(): Promise<void>;
}
