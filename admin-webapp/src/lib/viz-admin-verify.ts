import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getAdminAccountById, verifyAdminAccountPassword } from "@/lib/admin-account-store";
import { getLocalAdminSessionFromStore } from "@/lib/admin-local-auth";

export type VizAdminActor = {
  id: string;
  email: string | null;
  identifier: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
  passwordChangedAt: string | null;
  sessionVersion: number;
};

async function getAdminActorFromCookieStore(
  cookieStore: Awaited<ReturnType<typeof cookies>>,
): Promise<VizAdminActor | null> {
  const session = await getLocalAdminSessionFromStore(cookieStore);
  if (!session) {
    return null;
  }

  const account = await getAdminAccountById(session.accountId);
  if (!account || account.sessionVersion !== session.sessionVersion) {
    return null;
  }

  return {
    id: account.id,
    email: account.email,
    identifier: account.identifier,
    displayName: account.displayName,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    passwordChangedAt: account.passwordChangedAt,
    sessionVersion: account.sessionVersion,
  };
}

export async function getAdminActorOrNull(): Promise<VizAdminActor | null> {
  const cookieStore = await cookies();
  return getAdminActorFromCookieStore(cookieStore);
}

export async function requireAdminActor(loginNext = "/"): Promise<VizAdminActor> {
  const actor = await getAdminActorOrNull();

  if (!actor) {
    redirect(`/login?next=${encodeURIComponent(loginNext)}`);
  }

  return actor;
}

export async function requireVizAdminActor(loginNext = "/viz"): Promise<VizAdminActor> {
  return requireAdminActor(loginNext);
}

export async function assertAdminLoginPassword(_actorEmail: string | null, password: string): Promise<void> {
  const trimmed = password.trim();
  if (!trimmed) {
    throw new Error("Please enter the current admin password.");
  }

  const cookieStore = await cookies();
  const actor = await getAdminActorFromCookieStore(cookieStore);
  if (!actor) {
    throw new Error("Admin session expired. Please sign in again.");
  }

  const verified = await verifyAdminAccountPassword(actor.identifier, trimmed);
  if (!verified || verified.id !== actor.id) {
    throw new Error("Current admin password is incorrect.");
  }
}
