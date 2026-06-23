import { User } from "@supabase/supabase-js";

export type SyncStatus = "local" | "syncing" | "synced" | "failed";

export interface AuthState {
  user: User | null;
  accessToken: string | null;
  loading: boolean;
  syncStatus: SyncStatus;
  error: string | null;
  isCloudEnabled: boolean;
}
