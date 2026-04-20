import type { User } from "@supabase/supabase-js";

/**
 * True when the user signed up with the email provider but has not confirmed the address yet.
 * OAuth users (e.g. Google) normally have `email_confirmed_at` set and are not blocked.
 */
export function needsEmailConfirmation(user: User): boolean {
  if (user.email_confirmed_at) {
    return false;
  }
  return (user.identities ?? []).some((i) => i.provider === "email");
}
