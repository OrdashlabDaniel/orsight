import "@/lib/supabase/force-ipv4";
import { createClient } from "@supabase/supabase-js";

import { getPublicSupabaseConfig, getServiceRoleKey } from "@/lib/supabase/env";

/**
 * Server-only client with the service role key. Bypasses RLS; use only in Route Handlers / Server Actions.
 * Required for bootstrap checks on `admin_users` during registration.
 */
export function createServiceRoleClient() {
  const { url } = getPublicSupabaseConfig();
  const serviceKey = getServiceRoleKey();

  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
