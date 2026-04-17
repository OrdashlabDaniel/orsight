import type { SupabaseClient } from "@supabase/supabase-js";

export type VizAuthUserRow = {
  id: string;
  email: string | null;
  created_at: string | null;
  pod_username: string | null;
  banned_until: string | null;
  deleted_at: string | null;
};

type ListRegisteredUserRpcRow = {
  id: string;
  email: string | null;
  created_at: string | null;
  pod_username: string | null;
};

type VizAuthMutationRow = {
  id: string;
  email: string | null;
  banned_until: string | null;
};

function isMissingVizAuthRpc(err: { code?: string | null; message?: string | null } | null | undefined) {
  const msg = (err?.message || "").toLowerCase();
  return (
    err?.code === "PGRST202" ||
    (msg.includes("function") && msg.includes("viz_") && msg.includes("does not exist")) ||
    msg.includes("could not find the function public.viz_")
  );
}

function rpcDeployMessage(action: string) {
  return `${action}。请先在 Supabase SQL Editor 执行 admin-webapp/supabase/viz_auth_user_ops.sql`;
}

function takeFirstRow<T>(data: unknown): T | null {
  if (Array.isArray(data)) {
    return (data[0] as T | undefined) ?? null;
  }
  if (data && typeof data === "object") {
    return data as T;
  }
  return null;
}

function normalizeAuthUserRow(row: Partial<VizAuthUserRow> | null): VizAuthUserRow | null {
  if (!row?.id) {
    return null;
  }
  return {
    id: String(row.id),
    email: typeof row.email === "string" ? row.email : null,
    created_at: typeof row.created_at === "string" ? row.created_at : null,
    pod_username: typeof row.pod_username === "string" && row.pod_username.trim() ? row.pod_username : null,
    banned_until: typeof row.banned_until === "string" ? row.banned_until : null,
    deleted_at: typeof row.deleted_at === "string" ? row.deleted_at : null,
  };
}

function normalizeMutationRow(row: Partial<VizAuthMutationRow> | null): VizAuthMutationRow | null {
  if (!row?.id) {
    return null;
  }
  return {
    id: String(row.id),
    email: typeof row.email === "string" ? row.email : null,
    banned_until: typeof row.banned_until === "string" ? row.banned_until : null,
  };
}

export async function getRegisteredUserById(sb: SupabaseClient, userId: string): Promise<VizAuthUserRow | null> {
  const { data, error } = await sb.rpc("viz_get_registered_user_by_id", {
    target_user_id: userId,
  });

  if (error) {
    if (isMissingVizAuthRpc(error)) {
      throw new Error(rpcDeployMessage("读取 auth.users 失败"));
    }
    throw new Error(`读取 auth.users 失败：${error.message}`);
  }

  return normalizeAuthUserRow(takeFirstRow<Partial<VizAuthUserRow>>(data));
}

export async function disableAuthUserLogin(
  sb: SupabaseClient,
  userId: string,
): Promise<VizAuthMutationRow | null> {
  const { data, error } = await sb.rpc("viz_disable_auth_user_login", {
    target_user_id: userId,
  });

  if (error) {
    if (isMissingVizAuthRpc(error)) {
      throw new Error(rpcDeployMessage("停用登录失败"));
    }
    throw new Error(`停用登录失败：${error.message}`);
  }

  return normalizeMutationRow(takeFirstRow<Partial<VizAuthMutationRow>>(data));
}

export async function enableAuthUserLogin(
  sb: SupabaseClient,
  userId: string,
): Promise<VizAuthMutationRow | null> {
  const { data, error } = await sb.rpc("viz_enable_auth_user_login", {
    target_user_id: userId,
  });

  if (error) {
    if (isMissingVizAuthRpc(error)) {
      throw new Error(rpcDeployMessage("恢复登录失败"));
    }
    throw new Error(`恢复登录失败：${error.message}`);
  }

  return normalizeMutationRow(takeFirstRow<Partial<VizAuthMutationRow>>(data));
}

export async function hardDeleteAuthUser(sb: SupabaseClient, userId: string): Promise<VizAuthMutationRow | null> {
  const { data, error } = await sb.rpc("viz_hard_delete_auth_user", {
    target_user_id: userId,
  });

  if (error) {
    if (isMissingVizAuthRpc(error)) {
      throw new Error(rpcDeployMessage("永久删除 auth.users 失败"));
    }
    throw new Error(`永久删除 auth.users 失败：${error.message}`);
  }

  return normalizeMutationRow(takeFirstRow<Partial<VizAuthMutationRow>>(data));
}

export async function listRegisteredUsersWithStatus(sb: SupabaseClient): Promise<VizAuthUserRow[]> {
  const { data, error } = await sb.rpc("list_registered_users");

  if (error) {
    throw new Error(`list_registered_users RPC: ${error.message}`);
  }

  const baseRows = ((data ?? []) as ListRegisteredUserRpcRow[]).map((row) => ({
    id: String(row.id),
    email: typeof row.email === "string" ? row.email : null,
    created_at: typeof row.created_at === "string" ? row.created_at : null,
    pod_username: typeof row.pod_username === "string" && row.pod_username.trim() ? row.pod_username : null,
  }));

  const detailedRows = await Promise.all(
    baseRows.map(async (row) => {
      const detail = await getRegisteredUserById(sb, row.id);
      return {
        id: row.id,
        email: detail?.email ?? row.email,
        created_at: detail?.created_at ?? row.created_at,
        pod_username: detail?.pod_username ?? row.pod_username,
        banned_until: detail?.banned_until ?? null,
        deleted_at: detail?.deleted_at ?? null,
      };
    }),
  );

  return detailedRows;
}
