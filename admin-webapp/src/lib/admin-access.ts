function parseCsvEnv(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(/[,\r\n]+/)
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

const fallbackAdminEmails = parseCsvEnv(process.env.ADMIN_BOOTSTRAP_EMAILS);

export function isFallbackAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return fallbackAdminEmails.includes(email.trim().toLowerCase());
}

export function listFallbackAdminEmails(): string[] {
  return [...fallbackAdminEmails];
}
