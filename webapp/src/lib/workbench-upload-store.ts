import { prepareWorkspaceUpload } from "./client-visual-upload";

const DB_NAME = "orsight-workbench";
const DB_VERSION = 1;
const STORE_NAME = "uploads";
const FORM_INDEX_NAME = "by-form";
const FORM_ORDER_INDEX_NAME = "by-form-order";

type StoredWorkbenchUploadRecord = {
  key: string;
  formId: string;
  uploadId: string;
  order: number;
  file: File;
};

export type PersistableWorkbenchUpload = {
  id: string;
  file: File;
};

export type RestoredWorkbenchUpload = {
  id: string;
  file: File;
  previewUrl: string;
};

function openWorkbenchUploadDb(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || typeof window.indexedDB === "undefined") {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      const store = db.objectStoreNames.contains(STORE_NAME)
        ? request.transaction?.objectStore(STORE_NAME)
        : db.createObjectStore(STORE_NAME, { keyPath: "key" });

      if (!store) {
        return;
      }
      if (!store.indexNames.contains(FORM_INDEX_NAME)) {
        store.createIndex(FORM_INDEX_NAME, "formId", { unique: false });
      }
      if (!store.indexNames.contains(FORM_ORDER_INDEX_NAME)) {
        store.createIndex(FORM_ORDER_INDEX_NAME, ["formId", "order"], { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

function listStoredUploads(db: IDBDatabase, formId: string): Promise<StoredWorkbenchUploadRecord[]> {
  return new Promise((resolve) => {
    try {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.index(FORM_ORDER_INDEX_NAME).getAll(IDBKeyRange.bound([formId, 0], [formId, Number.MAX_SAFE_INTEGER]));

      request.onsuccess = () => {
        resolve((request.result as StoredWorkbenchUploadRecord[]) || []);
      };
      request.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

function replaceStoredUploads(
  db: IDBDatabase,
  formId: string,
  uploads: PersistableWorkbenchUpload[],
): Promise<void> {
  return new Promise((resolve) => {
    try {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const formIndex = store.index(FORM_INDEX_NAME);
      const getKeysRequest = formIndex.getAllKeys(IDBKeyRange.only(formId));

      getKeysRequest.onsuccess = () => {
        const keys = (getKeysRequest.result as IDBValidKey[]) || [];
        keys.forEach((key) => {
          store.delete(key);
        });

        uploads.forEach((upload, index) => {
          store.put({
            key: `${formId}::${upload.id}`,
            formId,
            uploadId: upload.id,
            order: index,
            file: upload.file,
          } satisfies StoredWorkbenchUploadRecord);
        });
      };
      getKeysRequest.onerror = () => resolve();

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
      transaction.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function loadPersistedWorkbenchUploads(formId: string): Promise<RestoredWorkbenchUpload[]> {
  const db = await openWorkbenchUploadDb();
  if (!db) {
    return [];
  }

  try {
    const stored = await listStoredUploads(db, formId);
    const restored = await Promise.allSettled(
      stored.map(async (item) => {
        const prepared = await prepareWorkspaceUpload(item.file);
        return {
          id: item.uploadId,
          file: prepared.file,
          previewUrl: prepared.previewUrl,
        } satisfies RestoredWorkbenchUpload;
      }),
    );
    return restored
      .filter((item): item is PromiseFulfilledResult<RestoredWorkbenchUpload> => item.status === "fulfilled")
      .map((item) => item.value);
  } finally {
    db.close();
  }
}

export async function savePersistedWorkbenchUploads(
  formId: string,
  uploads: PersistableWorkbenchUpload[],
): Promise<void> {
  const db = await openWorkbenchUploadDb();
  if (!db) {
    return;
  }

  try {
    await replaceStoredUploads(db, formId, uploads);
  } finally {
    db.close();
  }
}

export async function clearPersistedWorkbenchUploads(formId: string): Promise<void> {
  await savePersistedWorkbenchUploads(formId, []);
}
