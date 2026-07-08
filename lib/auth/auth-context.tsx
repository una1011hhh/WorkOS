"use client";

import { Session } from "@supabase/supabase-js";
import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { SUPABASE_AUTH_TIMEOUT_MS, withTimeout } from "@/lib/supabase/safety";
import { AuthState, SyncStatus } from "./types";

type AuthContextValue = AuthState & {
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  setSyncStatus(status: SyncStatus): void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const supabase = getSupabaseBrowserClient();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(supabase ? "syncing" : "local");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      setSyncStatus("local");
      return;
    }

    let mounted = true;

    withTimeout(supabase.auth.getSession(), SUPABASE_AUTH_TIMEOUT_MS, "supabase auth bootstrap").then(({ data, error: sessionError }) => {
      if (!mounted) return;
      if (sessionError) {
        setError(sessionError.message);
        setSyncStatus("failed");
      } else {
        setSession(data.session);
        setSyncStatus(data.session ? "synced" : "local");
      }
      setLoading(false);
    }).catch((bootstrapError) => {
      if (!mounted) return;
      setError(bootstrapError instanceof Error ? bootstrapError.message : String(bootstrapError));
      setSyncStatus("failed");
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setSyncStatus(nextSession ? "synced" : "local");
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [supabase]);

  const value = useMemo<AuthContextValue>(() => ({
    user: session?.user ?? null,
    accessToken: session?.access_token ?? null,
    loading,
    syncStatus,
    error,
    isCloudEnabled: Boolean(supabase),
    async refreshSession() {
      if (!supabase) return null;
      let data: { session: Session | null };
      let refreshError: Error | null = null;
      try {
        const result = await withTimeout(supabase.auth.refreshSession(), SUPABASE_AUTH_TIMEOUT_MS, "supabase refresh session");
        data = result.data;
        refreshError = result.error;
      } catch (error) {
        data = { session: null };
        refreshError = error instanceof Error ? error : new Error(String(error));
      }
      if (refreshError) {
        const { data: sessionData, error: sessionError } = await withTimeout(supabase.auth.getSession(), SUPABASE_AUTH_TIMEOUT_MS, "supabase fallback session");
        if (sessionError) {
          setError(sessionError.message);
          setSyncStatus("failed");
          return null;
        }
        setSession(sessionData.session);
        return sessionData.session?.access_token ?? null;
      }
      setSession(data.session);
      setSyncStatus(data.session ? "synced" : "local");
      return data.session?.access_token ?? null;
    },
    setSyncStatus,
    async signIn(email, password) {
      if (!supabase) throw new Error("Supabase 环境变量未配置，当前为本地模式。");
      setError(null);
      setSyncStatus("syncing");
      const { error: signInError } = await withTimeout(supabase.auth.signInWithPassword({ email, password }), SUPABASE_AUTH_TIMEOUT_MS, "supabase sign in");
      if (signInError) {
        setError(signInError.message);
        setSyncStatus("failed");
        throw signInError;
      }
      setSyncStatus("synced");
    },
    async signUp(email, password) {
      if (!supabase) throw new Error("Supabase 环境变量未配置，当前为本地模式。");
      setError(null);
      setSyncStatus("syncing");
      const { error: signUpError } = await withTimeout(supabase.auth.signUp({ email, password }), SUPABASE_AUTH_TIMEOUT_MS, "supabase sign up");
      if (signUpError) {
        setError(signUpError.message);
        setSyncStatus("failed");
        throw signUpError;
      }
      setSyncStatus("synced");
    },
    async signOut() {
      if (!supabase) return;
      setError(null);
      setSyncStatus("syncing");
      const { error: signOutError } = await withTimeout(supabase.auth.signOut(), SUPABASE_AUTH_TIMEOUT_MS, "supabase sign out");
      if (signOutError) {
        setError(signOutError.message);
        setSyncStatus("failed");
        throw signOutError;
      }
      setSession(null);
      setSyncStatus("local");
    },
  }), [error, loading, session, supabase, syncStatus]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
