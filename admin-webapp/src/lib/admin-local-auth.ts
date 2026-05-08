import type { NextRequest, NextResponse } from "next/server";

const LOCAL_ADMIN_COOKIE = "orsight-local-admin";
const SHOULD_USE_SECURE_COOKIE = process.env.NODE_ENV === "production";

export type LocalAdminSession = {
  accountId: string;
  sessionVersion: number;
};

type CookieStoreLike = {
  get(name: string): { value: string } | undefined;
};

type WritableCookieStoreLike = CookieStoreLike & {
  set(name: string, value: string, options: Record<string, unknown>): void;
};

function getBaseSecret(): string {
  const configuredSecret =
    (process.env.ADMIN_LOCAL_SESSION_SECRET ?? "").trim() ||
    (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();

  if (configuredSecret) {
    return configuredSecret;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("ADMIN_LOCAL_SESSION_SECRET must be set for production admin sessions.");
  }

  return "orsight-local-admin-dev-secret";
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((value) => {
    binary += String.fromCharCode(value);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array | null {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");

  try {
    const binary = atob(padded);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function isLocalAdminSession(value: unknown): value is LocalAdminSession {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<LocalAdminSession>;
  return (
    typeof candidate.accountId === "string" &&
    candidate.accountId.length > 0 &&
    typeof candidate.sessionVersion === "number" &&
    Number.isFinite(candidate.sessionVersion)
  );
}

async function signPayload(payloadBase64: string): Promise<string> {
  return sha256Hex(`${getBaseSecret()}::${payloadBase64}`);
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: SHOULD_USE_SECURE_COOKIE,
    path: "/",
  } as const;
}

export async function encodeLocalAdminSession(session: LocalAdminSession): Promise<string> {
  const payload = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(session)));
  const signature = await signPayload(payload);
  return `${payload}.${signature}`;
}

export async function decodeLocalAdminSession(token: string | null | undefined): Promise<LocalAdminSession | null> {
  const raw = String(token ?? "").trim();
  if (!raw) {
    return null;
  }

  const parts = raw.split(".");
  if (parts.length !== 2) {
    return null;
  }

  const [payloadBase64, signature] = parts;
  if (!payloadBase64 || !signature) {
    return null;
  }

  if (signature !== (await signPayload(payloadBase64))) {
    return null;
  }

  const payloadBytes = base64UrlToBytes(payloadBase64);
  if (!payloadBytes) {
    return null;
  }

  try {
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes));
    return isLocalAdminSession(payload) ? payload : null;
  } catch {
    return null;
  }
}

export async function getLocalAdminSessionFromStore(
  cookieStore: CookieStoreLike,
): Promise<LocalAdminSession | null> {
  return decodeLocalAdminSession(cookieStore.get(LOCAL_ADMIN_COOKIE)?.value);
}

export async function hasValidLocalAdminCookieFromRequest(request: NextRequest): Promise<boolean> {
  return Boolean(await decodeLocalAdminSession(request.cookies.get(LOCAL_ADMIN_COOKIE)?.value));
}

export async function hasValidLocalAdminCookieFromStore(cookieStore: CookieStoreLike): Promise<boolean> {
  return Boolean(await getLocalAdminSessionFromStore(cookieStore));
}

export async function setLocalAdminSessionCookie(
  response: NextResponse,
  session: LocalAdminSession,
): Promise<void> {
  response.cookies.set(LOCAL_ADMIN_COOKIE, await encodeLocalAdminSession(session), cookieOptions());
}

export async function setLocalAdminSessionCookieOnStore(
  cookieStore: WritableCookieStoreLike,
  session: LocalAdminSession,
): Promise<void> {
  cookieStore.set(LOCAL_ADMIN_COOKIE, await encodeLocalAdminSession(session), cookieOptions());
}

export function clearLocalAdminSessionCookie(response: NextResponse): void {
  response.cookies.set(LOCAL_ADMIN_COOKIE, "", {
    ...cookieOptions(),
    maxAge: 0,
  });
}

export function clearLegacyAdminSupabaseCookies(request: NextRequest, response: NextResponse): void {
  for (const cookie of request.cookies.getAll()) {
    if (cookie.name === "orsight-admin-auth-token" || cookie.name.startsWith("orsight-admin-auth-token.")) {
      response.cookies.set(cookie.name, "", {
        ...cookieOptions(),
        maxAge: 0,
      });
    }
  }
}
