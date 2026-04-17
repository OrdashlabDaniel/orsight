import { AsyncLocalStorage } from "node:async_hooks";

import type { SupabaseClient, User } from "@supabase/supabase-js";

import { getAuthContextOrSkip } from "@/lib/auth-server";
import { isSupabaseConfigured } from "@/lib/supabase";

const storageTenantAls = new AsyncLocalStorage<string | null>();
const storageSupabaseAls = new AsyncLocalStorage<SupabaseClient | null>();

export function getStorageTenantId(): string | null {
  return storageTenantAls.getStore() ?? null;
}

export function getStorageSupabaseClient(): SupabaseClient | null {
  return storageSupabaseAls.getStore() ?? null;
}

/** 已登录且使用 Supabase 时，对 training_examples 与 training-images 做租户隔离。 */
export function tenantActive(): boolean {
  return Boolean(getStorageTenantId() && isSupabaseConfigured());
}

export function runWithStorageTenant<T>(tenantId: string | null, fn: () => T | Promise<T>): T | Promise<T> {
  return storageTenantAls.run(tenantId, fn);
}

function sanitizeTenantSlug(id: string) {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function tenantDbKeyPrefix(): string {
  const id = getStorageTenantId();
  if (!id || !isSupabaseConfigured()) {
    return "";
  }
  return `tnt_${sanitizeTenantSlug(id)}::`;
}

export function tenantStorageFolderPrefix(): string {
  const id = getStorageTenantId();
  if (!id || !isSupabaseConfigured()) {
    return "";
  }
  return `tnt_${sanitizeTenantSlug(id)}/`;
}

export function scopeTrainingExamplesImageName(imageName: string): string {
  const p = tenantDbKeyPrefix();
  if (!p) {
    return imageName;
  }
  return `${p}${imageName}`;
}

export function unscopeTrainingExamplesImageName(imageName: string): string {
  const p = tenantDbKeyPrefix();
  if (!p || !imageName.startsWith(p)) {
    return imageName;
  }
  return imageName.slice(p.length);
}

export function scopeTrainingBucketPath(relPath: string): string {
  const base = tenantStorageFolderPrefix();
  if (!base) {
    return relPath;
  }
  const trimmed = relPath.replace(/^\/+/, "");
  return trimmed ? `${base}${trimmed}` : base;
}

export async function resolveStorageTenantId(): Promise<string | null> {
  const { user, skipAuth } = await getAuthContextOrSkip();
  if (skipAuth || !user) {
    return null;
  }
  return user.id;
}

export type AuthedStorageTenantContext = {
  user: User | null;
  skipAuth: boolean;
};

/**
 * 解析登录态并设置本请求的存储租户（Supabase 下按 user.id 隔离；skipAuth 时与历史行为一致为全局）。
 * 在 handler 内调用 forms-store / training / table-fields 等即可读写当前用户空间。
 */
export async function withAuthedStorageTenant(
  handler: (ctx: AuthedStorageTenantContext) => Promise<Response>,
): Promise<Response> {
  return await runWithResolvedStorageContext(handler);
}

export async function runWithResolvedStorageContext<T>(
  callback: (ctx: AuthedStorageTenantContext) => Promise<T>,
): Promise<T> {
  const { user, skipAuth, supabase } = await getAuthContextOrSkip();
  const tenantId = skipAuth || !user ? null : user.id;
  return await runWithStorageTenant(tenantId, async () =>
    storageSupabaseAls.run(supabase, async () => callback({ user, skipAuth })),
  );
}
