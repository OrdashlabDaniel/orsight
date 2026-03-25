import { createHash } from "node:crypto";

/** Same as webapp: stored in Supabase `user_metadata` for display. */
export const POD_USERNAME_METADATA_KEY = "pod_username";

/**
 * Same mapping as webapp `usernameToPodLoginEmail`: any login name → synthetic email.
 * Supabase stores auth emails lowercased; we lowercase the local part for consistent sign-in.
 */
export function usernameToPodLoginEmailSync(username: string): string {
  const normalized = username.trim();
  if (!normalized) {
    throw new Error("用户名不能为空");
  }

  const digest = createHash("sha256").update(normalized, "utf8").digest();
  const b64 = digest
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return `${b64.toLowerCase()}@pod-login.local`;
}
