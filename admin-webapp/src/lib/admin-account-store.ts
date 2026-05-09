import "server-only";

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

import { createAdminClient } from "@/lib/supabase/server";

const IDENTIFIER_PATTERN = /^[A-Za-z0-9._@-]{3,120}$/;
const ADMIN_ACCOUNT_COLUMNS =
  "id, identifier, display_name, email, password_hash, session_version, is_active, created_at, updated_at, password_changed_at";

export const ADMIN_LOGIN_PASSWORD_MIN_LENGTH = 6;

type AdminAccountRow = {
  id: string;
  identifier: string;
  display_name: string;
  email: string | null;
  password_hash: string;
  session_version: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  password_changed_at: string | null;
};

export type AdminAccount = {
  id: string;
  identifier: string;
  displayName: string;
  email: string | null;
  passwordHash: string;
  sessionVersion: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  passwordChangedAt: string | null;
};

export type AdminAccountProfileInput = {
  displayName: string;
  identifier: string;
  email: string | null;
};

function normalizeIdentifier(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeEmail(value: string | null | undefined): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed : null;
}

function assertValidIdentifier(identifier: string): void {
  if (!IDENTIFIER_PATTERN.test(identifier)) {
    throw new Error("Login name must be 3-120 characters and use only letters, numbers, dot, dash, underscore, or @.");
  }
}

function assertValidPassword(password: string): void {
  if (password.length < ADMIN_LOGIN_PASSWORD_MIN_LENGTH) {
    throw new Error(`Password must be at least ${ADMIN_LOGIN_PASSWORD_MIN_LENGTH} characters.`);
  }
}

function hashPassword(password: string, salt = randomBytes(16).toString("hex")): string {
  const derivedKey = scryptSync(password, salt, 64);
  return `scrypt:${salt}:${derivedKey.toString("hex")}`;
}

function verifyPasswordHash(passwordHash: string, password: string): boolean {
  const [algorithm, salt, expectedHex] = passwordHash.split(":");
  if (algorithm !== "scrypt" || !salt || !expectedHex) {
    return false;
  }

  const expected = Buffer.from(expectedHex, "hex");
  const derived = scryptSync(password, salt, expected.length);
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

function rowToAdminAccount(row: AdminAccountRow): AdminAccount {
  return {
    id: row.id,
    identifier: row.identifier,
    displayName: row.display_name,
    email: row.email,
    passwordHash: row.password_hash,
    sessionVersion: row.session_version,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    passwordChangedAt: row.password_changed_at,
  };
}

function getBootstrapAdminInput() {
  const identifier =
    (process.env.ADMIN_BOOTSTRAP_IDENTIFIER ?? process.env.ADMIN_LOCAL_IDENTIFIER ?? "IAHAMD").trim() || "IAHAMD";
  const displayName =
    (process.env.ADMIN_BOOTSTRAP_DISPLAY_NAME ?? process.env.ADMIN_LOCAL_DISPLAY_NAME ?? identifier).trim() ||
    identifier;
  const email = normalizeEmail(process.env.ADMIN_BOOTSTRAP_EMAIL ?? process.env.ADMIN_LOCAL_EMAIL);
  const password = (process.env.ADMIN_BOOTSTRAP_PASSWORD ?? process.env.ADMIN_LOCAL_PASSWORD ?? "").trim();

  assertValidIdentifier(identifier);
  if (!password) {
    throw new Error(
      "ADMIN_BOOTSTRAP_PASSWORD must be set before bootstrapping the first production admin account.",
    );
  }
  assertValidPassword(password);

  return {
    identifier,
    displayName,
    email,
    passwordHash: hashPassword(password),
  };
}

function isMissingAdminTable(error: { code?: string; message?: string } | null): boolean {
  const message = error?.message?.toLowerCase() ?? "";
  return error?.code === "42P01" || message.includes("admin_console_accounts");
}

function throwReadableDatabaseError(error: { code?: string; message?: string } | null): never {
  if (isMissingAdminTable(error)) {
    throw new Error(
      "Admin console accounts table is missing. Run webapp/supabase/migrations/20260509_admin_console_accounts.sql in the current Supabase project.",
    );
  }

  throw new Error(error?.message || "Admin account database operation failed.");
}

async function ensureBootstrapAdminAccount(): Promise<void> {
  const supabase = await createAdminClient();
  const existing = await supabase
    .from("admin_console_accounts")
    .select("id")
    .eq("is_active", true)
    .limit(1);

  if (existing.error) {
    throwReadableDatabaseError(existing.error);
  }

  if ((existing.data ?? []).length > 0) {
    return;
  }

  const bootstrap = getBootstrapAdminInput();
  const inserted = await supabase.from("admin_console_accounts").insert({
    identifier: bootstrap.identifier,
    display_name: bootstrap.displayName,
    email: bootstrap.email,
    password_hash: bootstrap.passwordHash,
    password_changed_at: new Date().toISOString(),
  });

  if (inserted.error) {
    throwReadableDatabaseError(inserted.error);
  }
}

export async function listAdminAccounts(): Promise<AdminAccount[]> {
  await ensureBootstrapAdminAccount();
  const supabase = await createAdminClient();
  const result = await supabase
    .from("admin_console_accounts")
    .select(ADMIN_ACCOUNT_COLUMNS)
    .eq("is_active", true)
    .order("display_name", { ascending: true })
    .order("identifier", { ascending: true });

  if (result.error) {
    throwReadableDatabaseError(result.error);
  }

  return ((result.data ?? []) as AdminAccountRow[]).map(rowToAdminAccount);
}

export async function getAdminAccountById(accountId: string): Promise<AdminAccount | null> {
  await ensureBootstrapAdminAccount();
  const supabase = await createAdminClient();
  const result = await supabase
    .from("admin_console_accounts")
    .select(ADMIN_ACCOUNT_COLUMNS)
    .eq("id", accountId)
    .eq("is_active", true)
    .maybeSingle();

  if (result.error) {
    throwReadableDatabaseError(result.error);
  }

  return result.data ? rowToAdminAccount(result.data as AdminAccountRow) : null;
}

export async function findAdminAccountByIdentifier(identifier: string): Promise<AdminAccount | null> {
  const normalized = normalizeIdentifier(identifier);
  if (!normalized) {
    return null;
  }

  await ensureBootstrapAdminAccount();
  const supabase = await createAdminClient();
  const result = await supabase
    .from("admin_console_accounts")
    .select(ADMIN_ACCOUNT_COLUMNS)
    .eq("identifier_key", normalized)
    .eq("is_active", true)
    .maybeSingle();

  if (result.error) {
    throwReadableDatabaseError(result.error);
  }

  return result.data ? rowToAdminAccount(result.data as AdminAccountRow) : null;
}

export async function verifyAdminAccountPassword(
  identifier: string,
  password: string,
): Promise<AdminAccount | null> {
  const account = await findAdminAccountByIdentifier(identifier);
  if (!account) {
    return null;
  }

  return verifyPasswordHash(account.passwordHash, password) ? account : null;
}

export async function updateAdminAccountProfile(
  accountId: string,
  input: AdminAccountProfileInput,
): Promise<AdminAccount> {
  const identifier = input.identifier.trim();
  const displayName = input.displayName.trim() || identifier;
  const email = normalizeEmail(input.email);

  assertValidIdentifier(identifier);

  const supabase = await createAdminClient();
  const result = await supabase
    .from("admin_console_accounts")
    .update({
      identifier,
      display_name: displayName,
      email,
    })
    .eq("id", accountId)
    .eq("is_active", true)
    .select(ADMIN_ACCOUNT_COLUMNS)
    .maybeSingle();

  if (result.error) {
    if (result.error.code === "23505") {
      throw new Error("Another admin already uses that login name or email.");
    }
    throwReadableDatabaseError(result.error);
  }
  if (!result.data) {
    throw new Error("Admin account not found.");
  }

  return rowToAdminAccount(result.data as AdminAccountRow);
}

export async function changeAdminAccountPassword(
  accountId: string,
  currentPassword: string,
  nextPassword: string,
): Promise<AdminAccount> {
  const currentAccount = await getAdminAccountById(accountId);
  if (!currentAccount) {
    throw new Error("Admin account not found.");
  }

  if (!verifyPasswordHash(currentAccount.passwordHash, currentPassword)) {
    throw new Error("Current password is incorrect.");
  }

  if (currentPassword === nextPassword) {
    throw new Error("New password must be different from the current password.");
  }

  assertValidPassword(nextPassword);

  const supabase = await createAdminClient();
  const now = new Date().toISOString();
  const result = await supabase
    .from("admin_console_accounts")
    .update({
      password_hash: hashPassword(nextPassword),
      session_version: currentAccount.sessionVersion + 1,
      password_changed_at: now,
    })
    .eq("id", accountId)
    .eq("session_version", currentAccount.sessionVersion)
    .eq("is_active", true)
    .select(ADMIN_ACCOUNT_COLUMNS)
    .maybeSingle();

  if (result.error) {
    throwReadableDatabaseError(result.error);
  }
  if (!result.data) {
    throw new Error("Admin account changed while this request was running. Please sign in again.");
  }

  return rowToAdminAccount(result.data as AdminAccountRow);
}
