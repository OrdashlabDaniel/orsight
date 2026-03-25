/** Trim and strip trailing slashes so fetch() never gets a malformed URL. */
export function normalizeSupabaseUrl(raw: string | undefined | null): string {
  return (raw ?? "").trim().replace(/\/+$/, "");
}

/**
 * Reject example / placeholder URLs (common mistake → ENOTFOUND placeholder.supabase.co).
 */
export function assertRealSupabaseProjectUrl(url: string): void {
  const lower = url.toLowerCase();
  if (
    lower.includes("placeholder") ||
    lower.includes("your_supabase_project_url") ||
    lower.includes("example.supabase.co")
  ) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL 仍是占位/示例地址。请打开 Supabase Dashboard → Settings → API，复制「Project URL」（形如 https://xxxx.supabase.co）写入 admin-webapp/.env.local，保存后重启 dev。",
    );
  }

  try {
    new URL(url);
  } catch {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL 不是合法 URL");
  }
}

export function getPublicSupabaseConfig(): { url: string; anonKey: string } {
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
  if (!url || !anonKey) {
    throw new Error("缺少 NEXT_PUBLIC_SUPABASE_URL 或 NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  if (!url.startsWith("https://")) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL 必须以 https:// 开头");
  }
  assertRealSupabaseProjectUrl(url);
  return { url, anonKey };
}

export function getServiceRoleKey(): string {
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!key) {
    throw new Error("缺少 SUPABASE_SERVICE_ROLE_KEY（注册/bootstrap 需要）");
  }
  return key;
}
