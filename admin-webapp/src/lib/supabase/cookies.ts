// Isolate the admin app session from the user-facing webapp when both share one browser.
export const adminSupabaseCookieOptions = {
  name: "orsight-admin-auth-token",
} as const;
