import "server-only";

import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const ADMIN_ACCOUNTS_VERSION = 1;
const ADMIN_ACCOUNTS_DIR = path.join(process.cwd(), ".local");
const ADMIN_ACCOUNTS_PATH = path.join(ADMIN_ACCOUNTS_DIR, "admin-accounts.json");
const IDENTIFIER_PATTERN = /^[A-Za-z0-9._@-]{3,120}$/;

export const ADMIN_LOGIN_PASSWORD_MIN_LENGTH = 6;

type StoredAdminAccount = {
  id: string;
  identifier: string;
  displayName: string;
  email: string | null;
  passwordHash: string;
  sessionVersion: number;
  createdAt: string;
  updatedAt: string;
  passwordChangedAt: string | null;
};

type AdminAccountsDocument = {
  version: number;
  accounts: StoredAdminAccount[];
};

export type AdminAccount = StoredAdminAccount;

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

function createBootstrapAdminAccount(): StoredAdminAccount {
  const identifier = (process.env.ADMIN_LOCAL_IDENTIFIER ?? "IAHAMD").trim() || "IAHAMD";
  const displayName = (process.env.ADMIN_LOCAL_DISPLAY_NAME ?? identifier).trim() || identifier;
  const email = normalizeEmail(process.env.ADMIN_LOCAL_EMAIL);
  const password = (process.env.ADMIN_LOCAL_PASSWORD ?? "").trim();
  const now = new Date().toISOString();

  assertValidIdentifier(identifier);
  if (!password) {
    throw new Error("ADMIN_LOCAL_PASSWORD must be set before bootstrapping the first admin account.");
  }
  assertValidPassword(password);

  return {
    id: randomUUID(),
    identifier,
    displayName,
    email,
    passwordHash: hashPassword(password),
    sessionVersion: 1,
    createdAt: now,
    updatedAt: now,
    passwordChangedAt: now,
  };
}

function isStoredAdminAccount(value: unknown): value is StoredAdminAccount {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<StoredAdminAccount>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.identifier === "string" &&
    typeof candidate.displayName === "string" &&
    (typeof candidate.email === "string" || candidate.email === null) &&
    typeof candidate.passwordHash === "string" &&
    typeof candidate.sessionVersion === "number" &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.updatedAt === "string" &&
    (typeof candidate.passwordChangedAt === "string" || candidate.passwordChangedAt === null)
  );
}

function assertValidDocument(document: unknown): asserts document is AdminAccountsDocument {
  if (!document || typeof document !== "object") {
    throw new Error("Admin accounts file must contain an object.");
  }

  const candidate = document as Partial<AdminAccountsDocument>;
  if (candidate.version !== ADMIN_ACCOUNTS_VERSION) {
    throw new Error(`Unsupported admin accounts file version: ${String(candidate.version)}.`);
  }
  if (!Array.isArray(candidate.accounts) || !candidate.accounts.every(isStoredAdminAccount)) {
    throw new Error("Admin accounts file contains invalid account rows.");
  }
}

async function writeDocument(document: AdminAccountsDocument): Promise<void> {
  await mkdir(ADMIN_ACCOUNTS_DIR, { recursive: true });
  const tempPath = `${ADMIN_ACCOUNTS_PATH}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  await rename(tempPath, ADMIN_ACCOUNTS_PATH);
}

async function loadDocument(): Promise<AdminAccountsDocument> {
  try {
    const raw = await readFile(ADMIN_ACCOUNTS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    assertValidDocument(parsed);

    if (parsed.accounts.length === 0) {
      const bootstrap = {
        version: ADMIN_ACCOUNTS_VERSION,
        accounts: [createBootstrapAdminAccount()],
      } satisfies AdminAccountsDocument;
      await writeDocument(bootstrap);
      return bootstrap;
    }

    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      const bootstrap = {
        version: ADMIN_ACCOUNTS_VERSION,
        accounts: [createBootstrapAdminAccount()],
      } satisfies AdminAccountsDocument;
      await writeDocument(bootstrap);
      return bootstrap;
    }

    if (error instanceof SyntaxError) {
      throw new Error(`Failed to parse ${ADMIN_ACCOUNTS_PATH}.`);
    }

    throw error;
  }
}

async function saveAccounts(accounts: StoredAdminAccount[]): Promise<void> {
  await writeDocument({
    version: ADMIN_ACCOUNTS_VERSION,
    accounts,
  });
}

export async function listAdminAccounts(): Promise<AdminAccount[]> {
  const document = await loadDocument();
  return [...document.accounts].sort((a, b) => {
    return (
      a.displayName.localeCompare(b.displayName) ||
      a.identifier.localeCompare(b.identifier) ||
      a.createdAt.localeCompare(b.createdAt)
    );
  });
}

export async function getAdminAccountById(accountId: string): Promise<AdminAccount | null> {
  const accounts = await listAdminAccounts();
  return accounts.find((account) => account.id === accountId) || null;
}

export async function findAdminAccountByIdentifier(identifier: string): Promise<AdminAccount | null> {
  const normalized = normalizeIdentifier(identifier);
  if (!normalized) {
    return null;
  }

  const accounts = await listAdminAccounts();
  return accounts.find((account) => normalizeIdentifier(account.identifier) === normalized) || null;
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
  const accounts = await listAdminAccounts();
  const index = accounts.findIndex((account) => account.id === accountId);
  if (index < 0) {
    throw new Error("Admin account not found.");
  }

  const identifier = input.identifier.trim();
  const displayName = input.displayName.trim() || identifier;
  const email = normalizeEmail(input.email);
  const normalized = normalizeIdentifier(identifier);

  assertValidIdentifier(identifier);

  const duplicate = accounts.find(
    (account) => account.id !== accountId && normalizeIdentifier(account.identifier) === normalized,
  );
  if (duplicate) {
    throw new Error("Another admin already uses that login name.");
  }

  const updatedAccount: StoredAdminAccount = {
    ...accounts[index]!,
    identifier,
    displayName,
    email,
    updatedAt: new Date().toISOString(),
  };

  const nextAccounts = [...accounts];
  nextAccounts[index] = updatedAccount;
  await saveAccounts(nextAccounts);
  return updatedAccount;
}

export async function changeAdminAccountPassword(
  accountId: string,
  currentPassword: string,
  nextPassword: string,
): Promise<AdminAccount> {
  const accounts = await listAdminAccounts();
  const index = accounts.findIndex((account) => account.id === accountId);
  if (index < 0) {
    throw new Error("Admin account not found.");
  }

  const currentAccount = accounts[index]!;
  if (!verifyPasswordHash(currentAccount.passwordHash, currentPassword)) {
    throw new Error("Current password is incorrect.");
  }

  if (currentPassword === nextPassword) {
    throw new Error("New password must be different from the current password.");
  }

  assertValidPassword(nextPassword);

  const now = new Date().toISOString();
  const updatedAccount: StoredAdminAccount = {
    ...currentAccount,
    passwordHash: hashPassword(nextPassword),
    sessionVersion: currentAccount.sessionVersion + 1,
    updatedAt: now,
    passwordChangedAt: now,
  };

  const nextAccounts = [...accounts];
  nextAccounts[index] = updatedAccount;
  await saveAccounts(nextAccounts);
  return updatedAccount;
}
