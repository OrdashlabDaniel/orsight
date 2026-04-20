import fs from "node:fs";
import path from "node:path";

import { DEFAULT_FORM_ID, FORM_META_PREFIX, normalizeFormId } from "@/lib/forms";
import { scopeTrainingBucketPath, scopeTrainingExamplesImageName } from "@/lib/storage-tenant";
import {
  isMissingSupabaseBucketError,
  isMissingSupabaseTableError,
  isSupabaseBucketMarkedUnavailable,
  isSupabaseTableMarkedUnavailable,
  markSupabaseBucketUnavailable,
  markSupabaseTableUnavailable,
} from "@/lib/supabase-compat";
import { getSupabaseAdmin } from "@/lib/supabase";
import { hasTenantDbAccess, requireTenantDbAccess } from "@/lib/tenant-db";

export const FORM_FILE_POOLS = ["training", "templates"] as const;

export type FormFilePoolName = (typeof FORM_FILE_POOLS)[number];
export type FormFilePoolKind = "image" | "pdf" | "spreadsheet" | "document" | "text" | "other";

export type FormFilePoolItem = {
  id: string;
  pool: FormFilePoolName;
  fileName: string;
  storageName: string;
  mimeType: string;
  size: number;
  uploadedAt: number;
  kind: FormFilePoolKind;
  source?: string;
};

export type FormFilePoolBinary = {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
};

const FORM_FILE_POOL_ROOT = "form-file-pools";
const FORM_FILES_BUCKET = "form-files";
const FORM_FILES_TABLE = "app_form_files";
const LEGACY_FORM_FILES_BUCKET = "training-images";

function normalizePoolName(value: string | null | undefined): FormFilePoolName | null {
  return value === "training" || value === "templates" ? value : null;
}

export function parseFormFilePoolName(value: string | null | undefined): FormFilePoolName {
  const pool = normalizePoolName(value);
  if (!pool) {
    throw new Error("Unknown form file pool.");
  }
  return pool;
}

function formFilePoolStoragePath(formId: string, pool: FormFilePoolName, storageName: string) {
  return `${FORM_FILE_POOL_ROOT}/${normalizeFormId(formId)}/${pool}/${storageName}`;
}

function formFilePoolManifestStorageKey(formId: string, pool: FormFilePoolName) {
  return scopeTrainingExamplesImageName(`${FORM_META_PREFIX}${normalizeFormId(formId)}:file_pool:${pool}`);
}

type FormFileRow = {
  id: string;
  owner_id: string;
  form_id: string;
  pool: FormFilePoolName;
  file_name: string;
  storage_name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_at: string;
  kind: FormFilePoolKind;
  source: string | null;
};

function localManifestCandidatePaths(formId: string, pool: FormFilePoolName) {
  const normalizedFormId = normalizeFormId(formId);
  return [
    path.join(process.cwd(), "training", "forms", normalizedFormId, "file-pools", `${pool}.json`),
    path.resolve(process.cwd(), "..", "training", "forms", normalizedFormId, "file-pools", `${pool}.json`),
  ];
}

function localFileDirCandidatePaths(formId: string, pool: FormFilePoolName) {
  const normalizedFormId = normalizeFormId(formId);
  return [
    path.join(process.cwd(), "image", FORM_FILE_POOL_ROOT, normalizedFormId, pool),
    path.resolve(process.cwd(), "..", "image", FORM_FILE_POOL_ROOT, normalizedFormId, pool),
  ];
}

function resolveLocalManifestPath(formId: string, pool: FormFilePoolName) {
  return (
    localManifestCandidatePaths(formId, pool).find((filePath) => fs.existsSync(filePath)) ||
    localManifestCandidatePaths(formId, pool)[1]
  );
}

function resolveLocalFileDir(formId: string, pool: FormFilePoolName) {
  return (
    localFileDirCandidatePaths(formId, pool).find((dirPath) => fs.existsSync(dirPath)) ||
    localFileDirCandidatePaths(formId, pool)[1]
  );
}

function createPoolFileId() {
  return `ff_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function sanitizeFileStem(fileName: string) {
  const parsed = path.parse(fileName || "file");
  return parsed.name.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "file";
}

function buildStorageFileName(id: string, fileName: string) {
  const ext = path.extname(fileName || "").toLowerCase().slice(0, 16);
  return `${id}-${sanitizeFileStem(fileName)}${ext}`;
}

function inferMimeTypeFromName(fileName: string) {
  const ext = path.extname(fileName || "").toLowerCase();
  switch (ext) {
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".pdf":
      return "application/pdf";
    case ".csv":
      return "text/csv";
    case ".txt":
      return "text/plain";
    case ".md":
      return "text/markdown";
    case ".xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case ".xls":
      return "application/vnd.ms-excel";
    case ".doc":
      return "application/msword";
    case ".docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    default:
      return "application/octet-stream";
  }
}

function inferPoolFileKind(fileName: string, mimeType: string): FormFilePoolKind {
  const lowerMime = (mimeType || "").toLowerCase();
  const ext = path.extname(fileName || "").toLowerCase();
  if (lowerMime.startsWith("image/")) {
    return "image";
  }
  if (lowerMime.includes("pdf") || ext === ".pdf") {
    return "pdf";
  }
  if (ext === ".xlsx" || ext === ".xls" || ext === ".csv") {
    return "spreadsheet";
  }
  if (ext === ".doc" || ext === ".docx") {
    return "document";
  }
  if (ext === ".txt" || ext === ".md" || lowerMime.startsWith("text/")) {
    return "text";
  }
  return "other";
}

function normalizePoolItems(raw: unknown, pool: FormFilePoolName): FormFilePoolItem[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const record = item as Record<string, unknown>;
      const id = typeof record.id === "string" ? record.id.trim().slice(0, 80) : "";
      const fileName = typeof record.fileName === "string" ? record.fileName.trim().slice(0, 255) : "";
      const storageName = typeof record.storageName === "string" ? record.storageName.trim().slice(0, 255) : "";
      const mimeType =
        typeof record.mimeType === "string" && record.mimeType.trim()
          ? record.mimeType.trim().slice(0, 120)
          : inferMimeTypeFromName(fileName);
      const size = typeof record.size === "number" && Number.isFinite(record.size) ? Math.max(0, record.size) : 0;
      const uploadedAt =
        typeof record.uploadedAt === "number" && Number.isFinite(record.uploadedAt)
          ? record.uploadedAt
          : Date.now();
      const kind =
        record.kind === "image" ||
        record.kind === "pdf" ||
        record.kind === "spreadsheet" ||
        record.kind === "document" ||
        record.kind === "text" ||
        record.kind === "other"
          ? record.kind
          : inferPoolFileKind(fileName, mimeType);
      const source = typeof record.source === "string" && record.source.trim() ? record.source.trim().slice(0, 80) : undefined;
      if (!id || !fileName || !storageName) {
        return null;
      }
      return {
        id,
        pool,
        fileName,
        storageName,
        mimeType,
        size,
        uploadedAt,
        kind,
        ...(source ? { source } : {}),
      } satisfies FormFilePoolItem;
    })
    .filter((item): item is FormFilePoolItem => Boolean(item))
    .sort((a, b) => b.uploadedAt - a.uploadedAt);
}

function mapFormFileRow(row: FormFileRow): FormFilePoolItem {
  return {
    id: row.id,
    pool: row.pool,
    fileName: row.file_name,
    storageName: row.storage_name,
    mimeType: row.mime_type,
    size: row.size_bytes,
    uploadedAt: Date.parse(row.uploaded_at) || Date.now(),
    kind: row.kind,
    ...(row.source ? { source: row.source } : {}),
  };
}

function buildFormFileRow(ownerId: string, formId: string, item: FormFilePoolItem): FormFileRow {
  return {
    id: item.id,
    owner_id: ownerId,
    form_id: normalizeFormId(formId),
    pool: item.pool,
    file_name: item.fileName,
    storage_name: item.storageName,
    mime_type: item.mimeType,
    size_bytes: item.size,
    uploaded_at: new Date(item.uploadedAt).toISOString(),
    kind: item.kind,
    source: item.source || null,
  };
}

function loadLocalPoolItems(formId: string, pool: FormFilePoolName): FormFilePoolItem[] {
  const filePath = resolveLocalManifestPath(formId, pool);
  if (!fs.existsSync(filePath)) {
    return [];
  }

  try {
    const payload = JSON.parse(fs.readFileSync(filePath, "utf8")) as { files?: unknown };
    return normalizePoolItems(payload.files, pool);
  } catch {
    return [];
  }
}

function saveLocalPoolItems(formId: string, pool: FormFilePoolName, files: FormFilePoolItem[]) {
  const filePath = resolveLocalManifestPath(formId, pool);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({ files }, null, 2), "utf8");
}

async function loadLegacyRemotePoolItems(formId: string, pool: FormFilePoolName): Promise<FormFilePoolItem[]> {
  const admin = getSupabaseAdmin();
  if (!admin) {
    return [];
  }
  const { data, error } = await admin
    .from("training_examples")
    .select("data")
    .eq("image_name", formFilePoolManifestStorageKey(formId, pool))
    .single();
  if (error || !data?.data || typeof data.data !== "object") {
    return [];
  }
  return normalizePoolItems((data.data as { files?: unknown }).files, pool);
}

async function saveLegacyRemotePoolItems(formId: string, pool: FormFilePoolName, files: FormFilePoolItem[]) {
  const admin = getSupabaseAdmin();
  if (!admin) {
    saveLocalPoolItems(formId, pool, files);
    return;
  }
  const { error } = await admin.from("training_examples").upsert(
    {
      image_name: formFilePoolManifestStorageKey(formId, pool),
      data: { files },
    },
    { onConflict: "image_name" },
  );
  if (error) {
    throw new Error(`Failed to save legacy ${pool} pool manifest: ${error.message}`);
  }
}

async function saveLegacyRemotePoolFile(record: FormFilePoolItem, buffer: Buffer, formId: string) {
  const admin = getSupabaseAdmin();
  if (!admin) {
    const dirPath = resolveLocalFileDir(formId, record.pool);
    fs.mkdirSync(dirPath, { recursive: true });
    fs.writeFileSync(path.join(dirPath, record.storageName), buffer);
    const current = loadLocalPoolItems(formId, record.pool);
    saveLocalPoolItems(formId, record.pool, [record, ...current]);
    return record;
  }

  const storagePath = scopeTrainingBucketPath(formFilePoolStoragePath(formId, record.pool, record.storageName));
  const { error: uploadError } = await admin.storage.from(LEGACY_FORM_FILES_BUCKET).upload(storagePath, buffer, {
    contentType: record.mimeType,
    upsert: true,
  });
  if (uploadError) {
    throw new Error(`Failed to upload legacy ${record.pool} pool file: ${uploadError.message}`);
  }

  const current = await loadLegacyRemotePoolItems(formId, record.pool);
  await saveLegacyRemotePoolItems(formId, record.pool, [record, ...current]);
  return record;
}

async function loadRemotePoolItems(formId: string, pool: FormFilePoolName): Promise<FormFilePoolItem[]> {
  if (isSupabaseTableMarkedUnavailable(FORM_FILES_TABLE)) {
    return await loadLegacyRemotePoolItems(formId, pool);
  }
  const { ownerId, client } = requireTenantDbAccess();
  const { data, error } = await client
    .from(FORM_FILES_TABLE)
    .select("id,owner_id,form_id,pool,file_name,storage_name,mime_type,size_bytes,uploaded_at,kind,source")
    .eq("owner_id", ownerId)
    .eq("form_id", normalizeFormId(formId))
    .eq("pool", pool)
    .order("uploaded_at", { ascending: false });
  if (error) {
    if (isMissingSupabaseTableError(error, FORM_FILES_TABLE)) {
      markSupabaseTableUnavailable(FORM_FILES_TABLE);
      return await loadLegacyRemotePoolItems(formId, pool);
    }
    return [];
  }
  if (!data) {
    return [];
  }
  return data.map((row) => mapFormFileRow(row as FormFileRow));
}

export async function listFormFilePool(pool: FormFilePoolName, formId = DEFAULT_FORM_ID) {
  return hasTenantDbAccess() ? loadRemotePoolItems(formId, pool) : loadLocalPoolItems(formId, pool);
}

export async function saveFormFileToPool(
  input: {
    pool: FormFilePoolName;
    fileName: string;
    mimeType?: string;
    buffer: Buffer;
    source?: string;
  },
  formId = DEFAULT_FORM_ID,
): Promise<FormFilePoolItem> {
  const normalizedFormId = normalizeFormId(formId);
  const id = createPoolFileId();
  const mimeType = input.mimeType?.trim() || inferMimeTypeFromName(input.fileName);
  const storageName = buildStorageFileName(id, input.fileName);
  const record: FormFilePoolItem = {
    id,
    pool: input.pool,
    fileName: input.fileName.trim().slice(0, 255) || storageName,
    storageName,
    mimeType,
    size: input.buffer.byteLength,
    uploadedAt: Date.now(),
    kind: inferPoolFileKind(input.fileName, mimeType),
    ...(input.source?.trim() ? { source: input.source.trim().slice(0, 80) } : {}),
  };

  if (!hasTenantDbAccess()) {
    const dirPath = resolveLocalFileDir(normalizedFormId, input.pool);
    fs.mkdirSync(dirPath, { recursive: true });
    fs.writeFileSync(path.join(dirPath, storageName), input.buffer);
    const current = loadLocalPoolItems(normalizedFormId, input.pool);
    saveLocalPoolItems(normalizedFormId, input.pool, [record, ...current]);
    return record;
  }

  if (isSupabaseTableMarkedUnavailable(FORM_FILES_TABLE) || isSupabaseBucketMarkedUnavailable(FORM_FILES_BUCKET)) {
    return await saveLegacyRemotePoolFile(record, input.buffer, normalizedFormId);
  }

  const { ownerId, client } = requireTenantDbAccess();
  const storagePath = scopeTrainingBucketPath(formFilePoolStoragePath(normalizedFormId, input.pool, storageName));
  const admin = getSupabaseAdmin();
  let uploadResult = await client.storage.from(FORM_FILES_BUCKET).upload(storagePath, input.buffer, {
    contentType: mimeType,
    upsert: true,
  });
  if (uploadResult.error && admin && admin !== client && !isSupabaseBucketMarkedUnavailable(FORM_FILES_BUCKET)) {
    uploadResult = await admin.storage.from(FORM_FILES_BUCKET).upload(storagePath, input.buffer, {
      contentType: mimeType,
      upsert: true,
    });
  }
  if (uploadResult.error) {
    if (isMissingSupabaseBucketError(uploadResult.error, FORM_FILES_BUCKET)) {
      markSupabaseBucketUnavailable(FORM_FILES_BUCKET);
      return await saveLegacyRemotePoolFile(record, input.buffer, normalizedFormId);
    }
    throw new Error(`Failed to upload ${input.pool} pool file: ${uploadResult.error.message}`);
  }

  const { error: rowError } = await client
    .from(FORM_FILES_TABLE)
    .upsert(buildFormFileRow(ownerId, normalizedFormId, record), { onConflict: "owner_id,form_id,id" });
  if (rowError) {
    if (isMissingSupabaseTableError(rowError, FORM_FILES_TABLE)) {
      markSupabaseTableUnavailable(FORM_FILES_TABLE);
      return await saveLegacyRemotePoolFile(record, input.buffer, normalizedFormId);
    }
    throw new Error(`Failed to save ${input.pool} pool metadata: ${rowError.message}`);
  }
  return record;
}

export async function getFormFileFromPool(
  pool: FormFilePoolName,
  fileId: string,
  formId = DEFAULT_FORM_ID,
): Promise<FormFilePoolBinary | null> {
  const normalizedFormId = normalizeFormId(formId);
  const files = await listFormFilePool(pool, normalizedFormId);
  const record = files.find((item) => item.id === fileId);
  if (!record) {
    return null;
  }

  if (!hasTenantDbAccess()) {
    const filePath = path.join(resolveLocalFileDir(normalizedFormId, pool), record.storageName);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return {
      buffer: fs.readFileSync(filePath),
      fileName: record.fileName,
      mimeType: record.mimeType || inferMimeTypeFromName(record.fileName),
    };
  }

  if (isSupabaseTableMarkedUnavailable(FORM_FILES_TABLE)) {
    const admin = getSupabaseAdmin();
    if (!admin) {
      return null;
    }
    const storagePath = scopeTrainingBucketPath(formFilePoolStoragePath(normalizedFormId, pool, record.storageName));
    const { data, error } = await admin.storage.from(LEGACY_FORM_FILES_BUCKET).download(storagePath);
    if (error || !data) {
      return null;
    }
    return {
      buffer: Buffer.from(await data.arrayBuffer()),
      fileName: record.fileName,
      mimeType: record.mimeType || data.type || inferMimeTypeFromName(record.fileName),
    };
  }

  const { client } = requireTenantDbAccess();
  const storagePath = scopeTrainingBucketPath(formFilePoolStoragePath(normalizedFormId, pool, record.storageName));
  const admin = getSupabaseAdmin();
  let downloadResult = await client.storage.from(FORM_FILES_BUCKET).download(storagePath);
  if (downloadResult.error && admin && admin !== client && !isSupabaseBucketMarkedUnavailable(FORM_FILES_BUCKET)) {
    downloadResult = await admin.storage.from(FORM_FILES_BUCKET).download(storagePath);
  }
  if (downloadResult.error && isMissingSupabaseBucketError(downloadResult.error, FORM_FILES_BUCKET)) {
    markSupabaseBucketUnavailable(FORM_FILES_BUCKET);
    const legacyResult = await admin?.storage.from(LEGACY_FORM_FILES_BUCKET).download(storagePath);
    if (!legacyResult || legacyResult.error || !legacyResult.data) {
      return null;
    }
    return {
      buffer: Buffer.from(await legacyResult.data.arrayBuffer()),
      fileName: record.fileName,
      mimeType: record.mimeType || legacyResult.data.type || inferMimeTypeFromName(record.fileName),
    };
  }
  const { data, error } = downloadResult;
  if (error || !data) {
    return null;
  }
  return {
    buffer: Buffer.from(await data.arrayBuffer()),
    fileName: record.fileName,
    mimeType: record.mimeType || data.type || inferMimeTypeFromName(record.fileName),
  };
}

export async function deleteFormFileFromPool(pool: FormFilePoolName, fileId: string, formId = DEFAULT_FORM_ID) {
  const normalizedFormId = normalizeFormId(formId);
  const files = await listFormFilePool(pool, normalizedFormId);
  const record = files.find((item) => item.id === fileId);
  if (!record) {
    return false;
  }

  if (!hasTenantDbAccess()) {
    const filePath = path.join(resolveLocalFileDir(normalizedFormId, pool), record.storageName);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    saveLocalPoolItems(
      normalizedFormId,
      pool,
      files.filter((item) => item.id !== fileId),
    );
    return true;
  }

  if (isSupabaseTableMarkedUnavailable(FORM_FILES_TABLE)) {
    const admin = getSupabaseAdmin();
    if (!admin) {
      return false;
    }
    const storagePath = scopeTrainingBucketPath(formFilePoolStoragePath(normalizedFormId, pool, record.storageName));
    const { error } = await admin.storage.from(LEGACY_FORM_FILES_BUCKET).remove([storagePath]);
    if (error && !/not[\s-]?found/i.test(error.message || "")) {
      throw new Error(`Failed to delete legacy ${pool} pool file: ${error.message}`);
    }
    await saveLegacyRemotePoolItems(
      normalizedFormId,
      pool,
      files.filter((item) => item.id !== fileId),
    );
    return true;
  }

  const { ownerId, client } = requireTenantDbAccess();
  const storagePath = scopeTrainingBucketPath(formFilePoolStoragePath(normalizedFormId, pool, record.storageName));
  const admin = getSupabaseAdmin();
  let removeResult = await client.storage.from(FORM_FILES_BUCKET).remove([storagePath]);
  if (removeResult.error && admin && admin !== client && !isSupabaseBucketMarkedUnavailable(FORM_FILES_BUCKET)) {
    removeResult = await admin.storage.from(FORM_FILES_BUCKET).remove([storagePath]);
  }
  if (removeResult.error && isMissingSupabaseBucketError(removeResult.error, FORM_FILES_BUCKET)) {
    markSupabaseBucketUnavailable(FORM_FILES_BUCKET);
    const legacyAdmin = getSupabaseAdmin();
    if (!legacyAdmin) {
      throw new Error(`Failed to delete ${pool} pool file: ${removeResult.error.message}`);
    }
    const { error: legacyRemoveError } = await legacyAdmin.storage.from(LEGACY_FORM_FILES_BUCKET).remove([storagePath]);
    if (legacyRemoveError && !/not[\s-]?found/i.test(legacyRemoveError.message || "")) {
      throw new Error(`Failed to delete legacy ${pool} pool file: ${legacyRemoveError.message}`);
    }
    await saveLegacyRemotePoolItems(
      normalizedFormId,
      pool,
      files.filter((item) => item.id !== fileId),
    );
    return true;
  }
  const { error } = removeResult;
  if (error && !/not[\s-]?found/i.test(error.message || "")) {
    throw new Error(`Failed to delete ${pool} pool file: ${error.message}`);
  }
  const { error: deleteError } = await client
    .from(FORM_FILES_TABLE)
    .delete()
    .eq("owner_id", ownerId)
    .eq("form_id", normalizedFormId)
    .eq("id", fileId);
  if (deleteError) {
    if (isMissingSupabaseTableError(deleteError, FORM_FILES_TABLE)) {
      markSupabaseTableUnavailable(FORM_FILES_TABLE);
      await saveLegacyRemotePoolItems(
        normalizedFormId,
        pool,
        files.filter((item) => item.id !== fileId),
      );
      return true;
    }
    throw new Error(`Failed to delete ${pool} pool metadata: ${deleteError.message}`);
  }
  return true;
}

export async function cloneFormFilePools(sourceFormId: string, targetFormId: string) {
  for (const pool of FORM_FILE_POOLS) {
    const files = await listFormFilePool(pool, sourceFormId);
    for (const file of files) {
      const binary = await getFormFileFromPool(pool, file.id, sourceFormId);
      if (!binary) {
        continue;
      }
      await saveFormFileToPool(
        {
          pool,
          fileName: binary.fileName,
          mimeType: binary.mimeType,
          buffer: binary.buffer,
          source: file.source || `cloned-from:${normalizeFormId(sourceFormId)}`,
        },
        targetFormId,
      );
    }
  }
}
