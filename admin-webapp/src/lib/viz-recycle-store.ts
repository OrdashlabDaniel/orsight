import type { SupabaseClient } from "@supabase/supabase-js";

export type RecycledUserRow = {
  id: string;
  email: string | null;
  deleted_at: string;
  purge_at: string;
  deleted_by: string | null;
  deleted_by_email: string | null;
};

const RECYCLE_BUCKET = "viz-admin-meta";
const RECYCLE_OBJECT_PATH = "recycle/recycled-users.json";

function sortRows(rows: RecycledUserRow[]) {
  return [...rows].sort((a, b) => b.deleted_at.localeCompare(a.deleted_at));
}

function isMissingRecycleBinTable(err: { code?: string | null; message?: string | null } | null | undefined): boolean {
  const msg = (err?.message || "").toLowerCase();
  return (
    err?.code === "PGRST106" ||
    msg.includes("could not find the table") ||
    msg.includes("schema cache") ||
    (msg.includes("relation") && msg.includes("viz_deleted_users") && msg.includes("does not exist"))
  );
}

function isStorageObjectMissing(err: { message?: string | null } | null | undefined): boolean {
  const msg = (err?.message || "").toLowerCase();
  return msg.includes("not found") || msg.includes("does not exist") || msg.includes("no such");
}

function isBucketAlreadyExists(err: { message?: string | null } | null | undefined): boolean {
  const msg = (err?.message || "").toLowerCase();
  return msg.includes("already exists") || msg.includes("duplicate");
}

async function ensureRecycleBucket(sb: SupabaseClient) {
  const { error } = await sb.storage.createBucket(RECYCLE_BUCKET, {
    public: false,
    fileSizeLimit: "1MB",
  });
  if (error && !isBucketAlreadyExists(error)) {
    throw new Error(`初始化回收站存储失败：${error.message}`);
  }
}

async function loadRowsFromStorage(sb: SupabaseClient): Promise<RecycledUserRow[]> {
  await ensureRecycleBucket(sb);
  const { data, error } = await sb.storage.from(RECYCLE_BUCKET).download(RECYCLE_OBJECT_PATH);
  if (error) {
    if (isStorageObjectMissing(error)) {
      return [];
    }
    throw new Error(`读取回收站存储失败：${error.message}`);
  }

  try {
    const text = await data.text();
    if (!text.trim()) {
      return [];
    }
    const payload = JSON.parse(text) as { rows?: unknown };
    if (!Array.isArray(payload.rows)) {
      return [];
    }
    const rows = payload.rows
      .filter((row): row is RecycledUserRow => Boolean(row && typeof row === "object"))
      .map((row) => ({
        id: typeof row.id === "string" ? row.id : "",
        email: typeof row.email === "string" ? row.email : null,
        deleted_at: typeof row.deleted_at === "string" ? row.deleted_at : new Date(0).toISOString(),
        purge_at: typeof row.purge_at === "string" ? row.purge_at : new Date(0).toISOString(),
        deleted_by: typeof row.deleted_by === "string" ? row.deleted_by : null,
        deleted_by_email: typeof row.deleted_by_email === "string" ? row.deleted_by_email : null,
      }))
      .filter((row) => row.id);
    return sortRows(rows);
  } catch (error) {
    throw new Error(`解析回收站存储失败：${error instanceof Error ? error.message : "unknown"}`);
  }
}

async function saveRowsToStorage(sb: SupabaseClient, rows: RecycledUserRow[]) {
  await ensureRecycleBucket(sb);
  const body = Buffer.from(JSON.stringify({ rows: sortRows(rows) }, null, 2), "utf8");
  const { error } = await sb.storage.from(RECYCLE_BUCKET).upload(RECYCLE_OBJECT_PATH, body, {
    contentType: "application/json",
    upsert: true,
  });
  if (error) {
    throw new Error(`写入回收站存储失败：${error.message}`);
  }
}

export async function listRecycledUsers(sb: SupabaseClient): Promise<RecycledUserRow[]> {
  const { data, error } = await sb
    .from("viz_deleted_users")
    .select("id,email,deleted_at,purge_at,deleted_by,deleted_by_email")
    .order("deleted_at", { ascending: false });

  if (!error) {
    return (data ?? []) as RecycledUserRow[];
  }
  if (!isMissingRecycleBinTable(error)) {
    throw new Error(error.message);
  }
  return await loadRowsFromStorage(sb);
}

export async function getRecycledUserById(sb: SupabaseClient, userId: string): Promise<RecycledUserRow | null> {
  const { data, error } = await sb
    .from("viz_deleted_users")
    .select("id,email,deleted_at,purge_at,deleted_by,deleted_by_email")
    .eq("id", userId)
    .maybeSingle();

  if (!error) {
    return (data as RecycledUserRow | null) ?? null;
  }
  if (!isMissingRecycleBinTable(error)) {
    throw new Error(error.message);
  }
  const rows = await loadRowsFromStorage(sb);
  return rows.find((row) => row.id === userId) ?? null;
}

export async function upsertRecycledUser(sb: SupabaseClient, row: RecycledUserRow): Promise<void> {
  const { error } = await sb.from("viz_deleted_users").upsert(row, { onConflict: "id" });
  if (!error) {
    return;
  }
  if (!isMissingRecycleBinTable(error)) {
    throw new Error(error.message);
  }

  const rows = await loadRowsFromStorage(sb);
  const next = rows.filter((item) => item.id !== row.id);
  next.push(row);
  await saveRowsToStorage(sb, next);
}

export async function deleteRecycledUser(sb: SupabaseClient, userId: string): Promise<void> {
  const { error } = await sb.from("viz_deleted_users").delete().eq("id", userId);
  if (!error) {
    return;
  }
  if (!isMissingRecycleBinTable(error)) {
    throw new Error(error.message);
  }

  const rows = await loadRowsFromStorage(sb);
  await saveRowsToStorage(
    sb,
    rows.filter((row) => row.id !== userId),
  );
}

