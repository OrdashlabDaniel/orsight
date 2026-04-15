/**
 * Public base URL of the admin Next app (no trailing slash), e.g. https://admin.example.com.
 * Used on the user login page to link to the admin sign-in screen.
 */
export function getAdminAppLoginUrl(): string | null {
  const raw = process.env.NEXT_PUBLIC_ADMIN_APP_URL?.trim();
  if (!raw) {
    return null;
  }
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") {
      return null;
    }
    const origin = u.origin.replace(/\/$/, "");
    return `${origin}/login`;
  } catch {
    return null;
  }
}
