type SupabaseErrorLike = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

const unavailableTables = new Set<string>();
const unavailableBuckets = new Set<string>();

function errorText(error: SupabaseErrorLike | null | undefined) {
  return `${error?.code || ""} ${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();
}

export function isSupabaseTableMarkedUnavailable(tableName: string) {
  return unavailableTables.has(tableName);
}

export function markSupabaseTableUnavailable(tableName: string) {
  unavailableTables.add(tableName);
}

export function isSupabaseBucketMarkedUnavailable(bucketName: string) {
  return unavailableBuckets.has(bucketName);
}

export function markSupabaseBucketUnavailable(bucketName: string) {
  unavailableBuckets.add(bucketName);
}

export function isMissingSupabaseTableError(error: SupabaseErrorLike | null | undefined, tableName?: string) {
  const text = errorText(error);
  const table = (tableName || "").toLowerCase();
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    text.includes("schema cache") ||
    (table ? text.includes(`public.${table}`) : false) ||
    (table ? text.includes(`relation "${table}" does not exist`) : false) ||
    (table ? text.includes(`could not find the table 'public.${table}'`) : false)
  );
}

export function isMissingSupabaseBucketError(error: SupabaseErrorLike | null | undefined, bucketName?: string) {
  const text = errorText(error);
  const bucket = (bucketName || "").toLowerCase();
  return (
    text.includes("bucket not found") ||
    text.includes("the resource was not found") ||
    (bucket ? text.includes(`bucket ${bucket}`) : false) ||
    (bucket ? text.includes(`bucket "${bucket}"`) : false)
  );
}

export function isSupabasePermissionError(error: SupabaseErrorLike | null | undefined) {
  const text = errorText(error);
  return (
    error?.code === "42501" ||
    text.includes("permission denied") ||
    text.includes("row-level security") ||
    text.includes("not authorized") ||
    text.includes("unauthorized")
  );
}
