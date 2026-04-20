export const EMAIL_VERIFIED_STORAGE_KEY = "orsight.emailVerified";

const EMAIL_VERIFIED_EVENT_MAX_AGE_MS = 30 * 60 * 1000;

export type EmailVerifiedEvent = {
  email: string;
  at: number;
};

function normalizeEmail(value: string | null | undefined) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  return email.includes("@") ? email : "";
}

export function createEmailVerifiedEvent(email: string | null | undefined) {
  return JSON.stringify({
    email: normalizeEmail(email),
    at: Date.now(),
  } satisfies EmailVerifiedEvent);
}

export function readEmailVerifiedEvent(raw: string | null | undefined): EmailVerifiedEvent | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<EmailVerifiedEvent> | null;
    const at = typeof parsed?.at === "number" && Number.isFinite(parsed.at) ? parsed.at : 0;
    if (!at || Date.now() - at > EMAIL_VERIFIED_EVENT_MAX_AGE_MS) {
      return null;
    }

    return {
      email: normalizeEmail(parsed?.email ?? ""),
      at,
    };
  } catch {
    return null;
  }
}

export function buildEmailVerifiedHref(next: string | null | undefined, email?: string | null) {
  const searchParams = new URLSearchParams();
  const normalizedNext = typeof next === "string" && next.startsWith("/") ? next : "";
  const normalizedEmail = normalizeEmail(email);
  if (normalizedNext) {
    searchParams.set("next", normalizedNext);
  }
  if (normalizedEmail) {
    searchParams.set("email", normalizedEmail);
  }
  const query = searchParams.toString();
  return query ? `/auth/verified?${query}` : "/auth/verified";
}

export function buildSignupVerificationCallbackPath(next: string | null | undefined) {
  const searchParams = new URLSearchParams();
  searchParams.set("verified", "1");
  const normalizedNext = typeof next === "string" && next.startsWith("/") ? next : "";
  if (normalizedNext) {
    searchParams.set("next", normalizedNext);
  }
  return `/auth/callback?${searchParams.toString()}`;
}

export function buildLoginAfterVerificationHref(next: string | null | undefined) {
  const normalizedNext = typeof next === "string" && next.startsWith("/") ? next : "";
  if (!normalizedNext) {
    return "/login";
  }
  return `/login?next=${encodeURIComponent(normalizedNext)}`;
}
