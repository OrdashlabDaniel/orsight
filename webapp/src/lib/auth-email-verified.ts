export const EMAIL_VERIFIED_STORAGE_KEY = "orsight.emailVerified";
export const EMAIL_VERIFICATION_PENDING_STORAGE_KEY = "orsight.pendingEmailVerification";
export const EMAIL_VERIFICATION_FLOW_METADATA_KEY = "orsight_email_verification_flow_id";
export const EMAIL_VERIFICATION_CONFIRMED_AT_METADATA_KEY = "orsight_email_verification_confirmed_at";
export const EMAIL_VERIFICATION_CONFIRMED_SOURCE_METADATA_KEY = "orsight_email_verification_confirmed_source";
export const EMAIL_VERIFICATION_REQUESTED_AT_METADATA_KEY = "orsight_email_verification_requested_at";

const EMAIL_VERIFIED_EVENT_MAX_AGE_MS = 30 * 60 * 1000;
const EMAIL_VERIFICATION_PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type EmailVerifiedEvent = {
  email: string;
  at: number;
  flowId: string;
};

export type PendingEmailVerification = {
  email: string;
  flowId: string;
  next: string;
  startedAt: number;
};

function normalizeEmail(value: string | null | undefined) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  return email.includes("@") ? email : "";
}

export function createEmailVerifiedEvent(email: string | null | undefined) {
  return createEmailVerifiedEventForFlow(email, null);
}

export function createEmailVerifiedEventForFlow(email: string | null | undefined, flowId: string | null | undefined) {
  return JSON.stringify({
    email: normalizeEmail(email),
    flowId: typeof flowId === "string" ? flowId.trim() : "",
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
      flowId: typeof parsed?.flowId === "string" ? parsed.flowId.trim() : "",
      at,
    };
  } catch {
    return null;
  }
}

function normalizeNext(value: string | null | undefined) {
  return typeof value === "string" && value.startsWith("/") ? value : "";
}

function normalizeTimestamp(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function createPendingEmailVerification(
  email: string | null | undefined,
  flowId: string | null | undefined,
  next: string | null | undefined,
  startedAt: number,
) {
  return JSON.stringify({
    email: normalizeEmail(email),
    flowId: typeof flowId === "string" ? flowId.trim() : "",
    next: normalizeNext(next),
    startedAt,
  } satisfies PendingEmailVerification);
}

export function readPendingEmailVerification(raw: string | null | undefined): PendingEmailVerification | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PendingEmailVerification> | null;
    const startedAt = normalizeTimestamp(parsed?.startedAt);
    const email = normalizeEmail(parsed?.email ?? "");
    const flowId = typeof parsed?.flowId === "string" ? parsed.flowId.trim() : "";
    if (!email || !flowId || !startedAt || Date.now() - startedAt > EMAIL_VERIFICATION_PENDING_MAX_AGE_MS) {
      return null;
    }

    return {
      email,
      flowId,
      next: normalizeNext(parsed?.next ?? ""),
      startedAt,
    };
  } catch {
    return null;
  }
}

export function buildEmailVerifiedHref(next: string | null | undefined, email?: string | null, flowId?: string | null) {
  const searchParams = new URLSearchParams();
  const normalizedNext = normalizeNext(next);
  const normalizedEmail = normalizeEmail(email);
  const normalizedFlowId = typeof flowId === "string" ? flowId.trim() : "";
  if (normalizedNext) {
    searchParams.set("next", normalizedNext);
  }
  if (normalizedEmail) {
    searchParams.set("email", normalizedEmail);
  }
  if (normalizedFlowId) {
    searchParams.set("flowId", normalizedFlowId);
  }
  const query = searchParams.toString();
  return query ? `/auth/verified?${query}` : "/auth/verified";
}

export function buildSignupVerificationCallbackPath(
  next: string | null | undefined,
  email?: string | null,
  flowId?: string | null,
) {
  const searchParams = new URLSearchParams();
  searchParams.set("verified", "1");
  const normalizedNext = typeof next === "string" && next.startsWith("/") ? next : "";
  const normalizedEmail = normalizeEmail(email);
  const normalizedFlowId = typeof flowId === "string" ? flowId.trim() : "";
  if (normalizedNext) {
    searchParams.set("next", normalizedNext);
  }
  if (normalizedEmail) {
    searchParams.set("email", normalizedEmail);
  }
  if (normalizedFlowId) {
    searchParams.set("flowId", normalizedFlowId);
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
