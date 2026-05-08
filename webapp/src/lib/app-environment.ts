/**
 * Public deployment channel (inlined at build time via NEXT_PUBLIC_*).
 * Use `staging` on any deployment that must not share production Supabase / user data.
 */
export type PublicAppChannel = "production" | "staging";

export function getPublicAppChannel(): PublicAppChannel {
  const raw = (process.env.NEXT_PUBLIC_APP_CHANNEL || "").trim().toLowerCase();
  if (raw === "staging") {
    return "staging";
  }
  return "production";
}

export function isStagingChannel(): boolean {
  return getPublicAppChannel() === "staging";
}
