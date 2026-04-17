import type { SupabaseClient } from "@supabase/supabase-js";

import { getStorageSupabaseClient, getStorageTenantId } from "@/lib/storage-tenant";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase";

export function getTenantOwnerId(): string | null {
  return getStorageTenantId();
}

export function getTenantDbClient(): SupabaseClient | null {
  return getStorageSupabaseClient() || getSupabaseAdmin();
}

export function hasTenantDbAccess(): boolean {
  return Boolean(isSupabaseConfigured() && getTenantOwnerId() && getTenantDbClient());
}

export function requireTenantDbAccess(): { ownerId: string; client: SupabaseClient } {
  const ownerId = getTenantOwnerId();
  const client = getTenantDbClient();
  if (!isSupabaseConfigured() || !ownerId || !client) {
    throw new Error("Tenant-scoped Supabase access is unavailable.");
  }
  return { ownerId, client };
}
