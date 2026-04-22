import { ensureUniquePodRecordIds, type ExtractionIssue, type PodRecord } from "./pod";

const VERSION = 1 as const;
const PREFIX = "orsight-workbench-session:v1:";

export type WorkbenchSessionConfirmed = {
  recordId: string;
  sourceImageNames: string[];
  route: string;
};

export type WorkbenchSessionDraft = {
  v: typeof VERSION;
  records: PodRecord[];
  issues: ExtractionIssue[];
  confirmedCorrectRecords: WorkbenchSessionConfirmed[];
  columnFilters: Record<string, string>;
  trainingExamplesLoaded: number;
  selectedUploadId?: string | null;
};

export function workbenchSessionStorageKey(formId: string): string {
  return `${PREFIX}${formId}`;
}

function readStorageItem(storage: Storage | undefined, key: string): string | null {
  if (!storage) {
    return null;
  }
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorageItem(storage: Storage | undefined, key: string, value: string): boolean {
  if (!storage) {
    return false;
  }
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function removeStorageItem(storage: Storage | undefined, key: string): void {
  if (!storage) {
    return;
  }
  try {
    storage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function parseWorkbenchSessionDraft(raw: string | null): WorkbenchSessionDraft | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<WorkbenchSessionDraft>;
    if (parsed.v !== VERSION || !Array.isArray(parsed.records)) {
      return null;
    }
    return {
      v: VERSION,
      records: ensureUniquePodRecordIds(parsed.records),
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      confirmedCorrectRecords: Array.isArray(parsed.confirmedCorrectRecords)
        ? parsed.confirmedCorrectRecords
        : [],
      columnFilters:
        parsed.columnFilters && typeof parsed.columnFilters === "object" && !Array.isArray(parsed.columnFilters)
          ? (parsed.columnFilters as Record<string, string>)
          : {},
      trainingExamplesLoaded:
        typeof parsed.trainingExamplesLoaded === "number" ? parsed.trainingExamplesLoaded : 0,
      selectedUploadId: typeof parsed.selectedUploadId === "string" ? parsed.selectedUploadId : null,
    };
  } catch {
    return null;
  }
}

export function loadWorkbenchSessionDraft(formId: string): WorkbenchSessionDraft | null {
  if (typeof window === "undefined") {
    return null;
  }
  const key = workbenchSessionStorageKey(formId);
  const rawLocal = readStorageItem(window.localStorage, key);
  const rawSession = readStorageItem(window.sessionStorage, key);
  const draft = parseWorkbenchSessionDraft(rawLocal ?? rawSession);
  if (draft && !rawLocal && rawSession) {
    writeStorageItem(window.localStorage, key, rawSession);
    removeStorageItem(window.sessionStorage, key);
  }
  return draft;
}

export function saveWorkbenchSessionDraft(formId: string, draft: WorkbenchSessionDraft): void {
  if (typeof window === "undefined") {
    return;
  }
  const key = workbenchSessionStorageKey(formId);
  const raw = JSON.stringify(draft);
  writeStorageItem(window.localStorage, key, raw);
  removeStorageItem(window.sessionStorage, key);
}

export function clearWorkbenchSessionDraft(formId: string): void {
  if (typeof window === "undefined") {
    return;
  }
  const key = workbenchSessionStorageKey(formId);
  removeStorageItem(window.localStorage, key);
  removeStorageItem(window.sessionStorage, key);
}
