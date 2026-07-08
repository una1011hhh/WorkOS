"use client";

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_FETCH_TIMEOUT_MS } from "./safety";

let browserClient: SupabaseClient | null = null;

export function getSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

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
