// Isolate the user-facing app session from admin-webapp when both run in the same browser.
export const webappSupabaseCookieOptions = {
  name: "orsight-webapp-auth-token",
} as const;
