import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** 去掉首尾空格，避免 .env 里误加空格导致识别失败 */
export function getPublicSupabaseUrl(): string {
  return (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
}

export function getPublicSupabaseAnonKey(): string {
  return (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
}

function getServiceRoleKey(): string {
  return (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
}

const supabaseUrl = () => getPublicSupabaseUrl();
const anonKey = () => getPublicSupabaseAnonKey();
const serviceKey = () => getServiceRoleKey();

/** 文档里的示例值，不应视为已配置（避免误判为「已启用 Supabase」） */
function isPlaceholderSupabaseEnv(url: string, key: string): boolean {
  const u = url.toLowerCase();
  const k = key.toLowerCase();
  return (
    u.includes("your_supabase") ||
    k.includes("your_supabase") ||
    u.includes("placeholder") ||
    k.includes("placeholder")
  );
}

/** 训练池等服务端写存储：需要 URL +（优先 service role，否则 anon） */
export const isSupabaseConfigured = () => {
  const url = supabaseUrl();
  const key = anonKey() || serviceKey();
  if (!/^https?:\/\//.test(url) || !key) {
    return false;
  }
  return !isPlaceholderSupabaseEnv(url, key);
};

/** 服务端全权限能力：仅限后台/迁移/计费等受控用途。 */
export const isSupabaseServiceRoleConfigured = () => {
  const url = supabaseUrl();
  const key = serviceKey();
  if (!/^https?:\/\//.test(url) || !key) {
    return false;
  }
  return !isPlaceholderSupabaseEnv(url, key);
};

/** 登录功能：只需要 URL + anon key（不要用 service role 做浏览器登录） */
export const isSupabaseAuthEnabled = () => {
  const url = supabaseUrl();
  const key = anonKey();
  if (!/^https?:\/\//.test(url) || !key) {
    return false;
  }
  return !isPlaceholderSupabaseEnv(url, key);
};

/**
 * 默认 **必须登录**。本地不想登录、不配 Supabase 时，在 .env.local 写：
 * `NEXT_PUBLIC_REQUIRE_LOGIN=false`
 */
export function isLoginStrictlyRequired(): boolean {
  const v = (process.env.NEXT_PUBLIC_REQUIRE_LOGIN || "").trim().toLowerCase();
  if (v === "false" || v === "0" || v === "no" || v === "off") {
    return false;
  }
  return true;
}

let adminClient: SupabaseClient | null = null;

/** 服务端 API 用：访问 Storage / 表（本地未配 Supabase 时返回 null） */
export function getSupabaseAdmin(): SupabaseClient | null {
  if (!isSupabaseServiceRoleConfigured()) {
    return null;
  }
  if (!adminClient) {
    const url = supabaseUrl();
    const key = serviceKey();
    adminClient = createClient(url, key);
  }
  return adminClient;
}
