"use client";

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_FETCH_TIMEOUT_MS } from "./safety";

let browserClient: SupabaseClient | null = null;

type WorkOSRuntimeConfig = {
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
};

declare global {
  interface Window {
    __WORKOS_RUNTIME_CONFIG__?: WorkOSRuntimeConfig;
  }
}

const getRuntimeConfig = (): WorkOSRuntimeConfig => {
  if (typeof window === "undefined") return {};
  return window.__WORKOS_RUNTIME_CONFIG__ ?? {};
};

export function getSupabaseBrowserClient() {
  const runtimeConfig = getRuntimeConfig();
  const url = runtimeConfig.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = runtimeConfig.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    return null;
  }

  if (!browserClient) {
    browserClient = createClient(url, publishableKey, {
      global: {
        fetch: (input, init) => {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), SUPABASE_FETCH_TIMEOUT_MS);
          return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timeoutId));
        },
      },
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }

  return browserClient;
}
