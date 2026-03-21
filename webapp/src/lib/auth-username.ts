/** 存在 Supabase user_metadata 里，用于展示真实用户名 */
export const POD_USERNAME_METADATA_KEY = "pod_username";

/**
 * Supabase 的密码登录 API 需要 `email` 字段。
 * 将任意用户名（任意字符、不要求邮箱格式）确定性映射为伪邮箱；
 * 展示时用 metadata 里的 {@link POD_USERNAME_METADATA_KEY}。
 */
export async function usernameToPodLoginEmail(username: string): Promise<string> {
  const normalized = username.trim();
  if (!normalized) {
    throw new Error("用户名不能为空");
  }

  const bytes = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hashArray = new Uint8Array(digest);
  let binary = "";
  for (let i = 0; i < hashArray.length; i++) {
    binary += String.fromCharCode(hashArray[i]!);
  }
  const b64 = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64}@pod-login.local`;
}

export function getDisplayUsernameFromUser(user: {
  email?: string | null;
  user_metadata?: Record<string, unknown>;
}): string {
  const raw = user.user_metadata?.[POD_USERNAME_METADATA_KEY];
  if (typeof raw === "string" && raw.trim()) {
    return raw.trim();
  }
  if (user.email?.toLowerCase().endsWith("@pod-login.local")) {
    return "（旧账号，无用户名记录）";
  }
  return user.email || "—";
}
