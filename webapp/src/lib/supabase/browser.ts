import { createBrowserClient } from "@supabase/ssr";

import { getPublicSupabaseAnonKey, getPublicSupabaseUrl } from "@/lib/supabase";

export function createClient() {
  const url = getPublicSupabaseUrl();
  const key = getPublicSupabaseAnonKey();
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  return createBrowserClient(url, key);
}
