"use client";

import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  TrainingAnnotationWorkbench,
  type AnnotationField,
  type AnnotationMode,
  type AnnotationWorkbenchSeed,
  type FieldAggregation,
  type TableAnnotationFieldValues,
  type WorkbenchAnnotationBox,
} from "@/components/TrainingAnnotationWorkbench";
import { RecognitionAgentDock } from "@/components/RecognitionAgentDock";
import { LoginLoadingFallback } from "@/app/login/LoginLoadingFallback";
import { useLocale } from "@/i18n/LocaleProvider";
import {
  DEFAULT_TABLE_FIELDS,
  getActiveTableFields,
  TABLE_FIELDS_SYNC_EVENT,
  TABLE_FIELDS_SYNC_STORAGE_KEY,
  type TableFieldDefinition,
} from "@/lib/table-fields";
import { DEFAULT_FORM_ID, buildFormFillHref, normalizeFormId } from "@/lib/forms";
import {
  ensureImageDataUrlFromSource,
  isWorkspaceDocumentFile,
  prepareVisualUpload,
  SUPPORTED_VISUAL_UPLOAD_ACCEPT,
} from "@/lib/client-visual-upload";


type UploadItem = {
  id: string;
  file: File;
  previewUrl: string;
};

type TrainingStatusItem = {
  imageName: string;
  labeled: boolean;
  example: {
    imageName: string;
    notes?: string;
    annotationMode?: AnnotationMode;
    output: {
      date: string;
      route: string;
      driver: string;
      taskCode?: string;
      total: number;
      totalSourceLabel?: string;
      unscanned: number;
      exceptions: number | "";
      waybillStatus?: string;
      stationTeam?: string;
      customFieldValues?: Record<string, string | number | "">;
    };
    boxes?: WorkbenchAnnotationBox[];
    fieldAggregations?: Partial<Record<AnnotationField, FieldAggregation>>;
    tableOutput?: {
      fieldValues?: TableAnnotationFieldValues;
    };
  } | null;
};

type TrainingStatusResponse = {
  totalImages: number;
  labeledImages: number;
  unlabeledImages: number;
  items: TrainingStatusItem[];
};

function TrainingModeContent() {
  const { t } = useLocale();
  const searchParams = useSearchParams();
  const currentFormId = useMemo(
    () => normalizeFormId(searchParams.get("formId") || DEFAULT_FORM_ID),
    [searchParams],
  );
  const withFormId = useMemo(
    () => (path: string) =>
      currentFormId === DEFAULT_FORM_ID
        ? path
        : `${path}${path.includes("?") ? "&" : "?"}formId=${encodeURIComponent(currentFormId)}`,
    [currentFormId],
  );
  const [setupField, setSetupField] = useState("");
  const [tableFields, setTableFields] = useState<TableFieldDefinition[]>(DEFAULT_TABLE_FIELDS);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [selectedUploadId, setSelectedUploadId] = useState<string | null>(null);
  const [trainingThumbnailMap, setTrainingThumbnailMap] = useState<Record<string, string>>({});
  const [trainingThumbnailErrorMap, setTrainingThumbnailErrorMap] = useState<Record<string, boolean>>({});
  const [deletingImageName, setDeletingImageName] = useState<string | null>(null);

  const [trainingStatus, setTrainingStatus] = useState<TrainingStatusResponse | null>(null);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [noticeMessage, setNoticeMessage] = useState("");

  const [annotatingItem, setAnnotatingItem] = useState<UploadItem | TrainingStatusItem | null>(null);
  const [annotationImageName, setAnnotationImageName] = useState("");
  const [annotationImageSrc, setAnnotationImageSrc] = useState("");
  const [annotationDraft, setAnnotationDraft] = useState<{
    seed: AnnotationWorkbenchSeed;
    annotationMode: AnnotationMode;
    tableFieldValues?: TableAnnotationFieldValues;
    boxes: WorkbenchAnnotationBox[];
    fieldAggregations: Partial<Record<AnnotationField, FieldAggregation>>;
    notes: string;
  } | null>(null);

  const removeUploadAfterSaveRef = useRef<string | null>(null);

  const [isSavingTraining, setIsSavingTraining] = useState(false);

  const activeTableFields = getActiveTableFields(tableFields);
  const setupFieldDefinition = activeTableFields.find((field) => field.id === setupField) || null;
  const isFieldOnboarding = Boolean(setupFieldDefinition);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setSetupField(params.get("setupField") || "");
  }, [searchParams]);

  useEffect(() => {
    void loadTableFieldConfig();
  }, [currentFormId]);

  useEffect(() => {
    function handleTableFieldsChanged() {
      void loadTableFieldConfig();
    }

    function handleStorage(event: StorageEvent) {
      if (event.key === TABLE_FIELDS_SYNC_STORAGE_KEY) {
        void loadTableFieldConfig();
      }
    }

    window.addEventListener(TABLE_FIELDS_SYNC_EVENT, handleTableFieldsChanged as EventListener);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(TABLE_FIELDS_SYNC_EVENT, handleTableFieldsChanged as EventListener);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  useEffect(() => {
    if (setupField && !activeTableFields.some((field) => field.id === setupField)) {
      setSetupField("");
    }
  }, [activeTableFields, setupField]);

  useEffect(() => {
    if (!isFieldOnboarding) {
      return;
    }
    uploadPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [isFieldOnboarding]);

  useEffect(() => {
    const imageNames = trainingStatus?.items.map((item) => item.imageName) || [];
    if (!imageNames.length) {
      setTrainingThumbnailMap({});
      setTrainingThumbnailErrorMap({});
      return;
    }

    setTrainingThumbnailMap(() => {
      const next: Record<string, string> = {};
      for (const imageName of imageNames) {
        next[imageName] = buildTrainingImageThumbnailUrl(imageName);
      }
      return next;
    });
    setTrainingThumbnailErrorMap((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([imageName, failed]) => imageNames.includes(imageName) && failed),
      ),
    );
  }, [trainingStatus, withFormId]);

  async function loadTableFieldConfig() {
    try {
      const res = await fetch(withFormId("/api/table-fields"));
      const data = (await res.json()) as { error?: string; tableFields?: TableFieldDefinition[] };
      if (!res.ok) {
        setTableFields(DEFAULT_TABLE_FIELDS);
        return;
      }
      setTableFields(data.tableFields?.length ? data.tableFields : DEFAULT_TABLE_FIELDS);
    } catch {
      setTableFields(DEFAULT_TABLE_FIELDS);
    }
  }


  const uploadPanelRef = useRef<HTMLDivElement | null>(null);

  const uploadsRef = useRef(uploads);
  uploadsRef.current = uploads;

  useEffect(() => {
    return () => {
      uploadsRef.current.forEach((upload) => URL.revokeObjectURL(upload.previewUrl));
    };
  }, []);

  useEffect(() => {
    void loadTrainingStatus();
  }, [currentFormId]);

  const handleFilesRef = useRef<((fileList: FileList | File[] | null) => Promise<void>) | null>(null);

  useEffect(() => {
    function handlePaste(event: ClipboardEvent) {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }
      
      const items = event.clipboardData?.items;
      if (!items) return;

      const files: File[] = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf("image") !== -1) {
          const file = items[i].getAsFile();
          if (file) {
            const ext = file.type.split('/')[1] || 'png';
            const newFile = new File([file], `pasted-image-${Date.now()}-${i}.${ext}`, { type: file.type, lastModified: file.lastModified });
            files.push(newFile);
          }
        }
      }

      if (files.length > 0) {
        event.preventDefault();
        if (handleFilesRef.current) {
          void handleFilesRef.current(files);
        }
      }
    }

    document.addEventListener("paste", handlePaste);
    return () => {
      document.removeEventListener("paste", handlePaste);
    };
  }, []);

  async function loadTrainingStatus() {
    try {
      const response = await fetch(withFormId("/api/training/status"));
      const payload = (await response.json()) as TrainingStatusResponse & { error?: string };
      if (!response.ok) {

      }
      setTrainingStatus(payload);
    } catch (error) {

    }
  }

  async function handleFiles(fileList: FileList | File[] | null) {
    if (!fileList?.length) {
      return;
    }

    const list = Array.from(fileList);
    const skippedDocs = list.filter((f) => isWorkspaceDocumentFile(f));
    const visualOnly = list.filter((f) => !isWorkspaceDocumentFile(f));
    if (skippedDocs.length) {
      setNoticeMessage(t("training.skipDocs", { n: skippedDocs.length }));
    }
    if (!visualOnly.length) {
      setErrorMessage("");
      return;
    }

    try {
      const nextUploads = await Promise.all(
        visualOnly.map(async (file, index) => {
          const prepared = await prepareVisualUpload(file);
          return {
            id: `${prepared.file.name}-${prepared.file.lastModified}-${index}-${Date.now()}`,
            file: prepared.file,
            previewUrl: prepared.previewUrl,
          };
        })
      );

      setUploads((current) => {
        const merged = [...current, ...nextUploads];
        setSelectedUploadId((currentId) => {
          if (!currentId && merged[0]) {
            return merged[0].id;
          }
          return currentId;
        });
        return merged;
      });

      setErrorMessage("");
      if (isFieldOnboarding && nextUploads[0]) {
        setSelectedUploadId(nextUploads[0].id);
        void openAnnotationPanel(nextUploads[0]);
      }
    } catch {

    }
  }
  handleFilesRef.current = handleFiles;

  function handleDragOver(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (!isDraggingFiles) {
      setIsDraggingFiles(true);
    }
  }

  function handleDragLeave(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingFiles(false);
  }

  function handleDrop(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingFiles(false);
    void handleFiles(event.dataTransfer.files);
  }

  function clearAll() {
    uploads.forEach((upload) => URL.revokeObjectURL(upload.previewUrl));
    setUploads([]);
    setSelectedUploadId(null);
    setErrorMessage("");
    setNoticeMessage(t("training.cleared"));
  }

  async function resolveAnnotationImage(imageName: string, previewUrl?: string) {
    if (previewUrl) {
      try {
        return await ensureImageDataUrlFromSource(previewUrl);
      } catch {
        // Fall back to the JSON data-url endpoint if the raw preview request fails.
      }
    }

    const response = await fetch(withFormId(`/api/training/image?imageName=${encodeURIComponent(imageName)}`));
    const payload = (await response.json()) as { dataUrl?: string; error?: string };
    if (!response.ok || !payload.dataUrl) {
      throw new Error(payload.error || t("training.errTrainImage"));
    }
    return await ensureImageDataUrlFromSource(payload.dataUrl);
  }

  function buildTrainingImageRawUrl(imageName: string) {
    return withFormId(`/api/training/image?imageName=${encodeURIComponent(imageName)}&raw=1`);
  }

  function buildTrainingImageThumbnailUrl(imageName: string, cacheBust?: number) {
    return withFormId(
      `/api/training/image?imageName=${encodeURIComponent(imageName)}&raw=1&thumbnail=1${cacheBust ? `&v=${cacheBust}` : ""}`,
    );
  }

  function retryTrainingThumbnail(imageName: string) {
    setTrainingThumbnailErrorMap((current) => {
      if (!current[imageName]) {
        return current;
      }
      const next = { ...current };
      delete next[imageName];
      return next;
    });
    setTrainingThumbnailMap((current) => ({
      ...current,
      [imageName]: buildTrainingImageThumbnailUrl(imageName, Date.now()),
    }));
  }

  function handleImageClick(upload: UploadItem) {
    setSelectedUploadId(upload.id);
    void openAnnotationPanel(upload);
  }

  function handleTrainingItemClick(item: TrainingStatusItem) {
    void openAnnotationPanel(item);
  }

  async function handleDeleteTrainingItem(item: TrainingStatusItem, event: { stopPropagation(): void }) {
    event.stopPropagation();
    if (deletingImageName) {
      return;
    }

    const confirmed = window.confirm(t("training.confirmDelete", { name: item.imageName }));
    if (!confirmed) {
      return;
    }

    setDeletingImageName(item.imageName);
    setErrorMessage("");
    try {
      const response = await fetch(
        withFormId(`/api/training/image?imageName=${encodeURIComponent(item.imageName)}`),
        { method: "DELETE" },
      );
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {

      }

      if (annotatingItem && !("file" in annotatingItem) && annotatingItem.imageName === item.imageName) {
        closeRecordPopup();
      }

      setTrainingThumbnailMap((current) => {
        const next = { ...current };
        delete next[item.imageName];
        return next;
      });
      setTrainingThumbnailErrorMap((current) => {
        const next = { ...current };
        delete next[item.imageName];
        return next;
      });

      await loadTrainingStatus();

    } catch (error) {

    } finally {
      setDeletingImageName(null);
    }
  }

  async function openAnnotationPanel(item: UploadItem | TrainingStatusItem) {
    setAnnotatingItem(item);

    let imageName = "";
    let previewUrl = "";
    let existingExample: TrainingStatusItem["example"] = null;

    if ("file" in item) {
      imageName = item.file.name;
      previewUrl = item.previewUrl;
      removeUploadAfterSaveRef.current = item.id;
    } else {
      imageName = item.imageName;
      previewUrl = buildTrainingImageRawUrl(item.imageName);
      existingExample = item.example;
      removeUploadAfterSaveRef.current = null;
    }

    const rawBoxes = existingExample?.boxes || [];
    setAnnotationDraft({
      seed: {
        date: existingExample?.output.date || "",
        route: existingExample?.output.route || "",
        driver: existingExample?.output.driver || "",
        taskCode: existingExample?.output.taskCode || "",
        total: existingExample?.output.total ?? "",
        unscanned: existingExample?.output.unscanned ?? "",
        exceptions: existingExample?.output.exceptions ?? "",
        waybillStatus: existingExample?.output.waybillStatus || "",
        stationTeam: existingExample?.output.stationTeam || "",
        totalSourceLabel: existingExample?.output.totalSourceLabel || "",
        customFieldValues: { ...(existingExample?.output.customFieldValues || {}) },
      },
      annotationMode:
        existingExample?.annotationMode === "table" || existingExample?.tableOutput?.fieldValues ? "table" : "record",
      tableFieldValues: existingExample?.tableOutput?.fieldValues || undefined,
      boxes: rawBoxes.map((b) => ({
        ...b,
        id: typeof b.id === "string" && b.id ? b.id : crypto.randomUUID(),
      })),
      fieldAggregations: existingExample?.fieldAggregations || {},
      notes: existingExample?.notes || t("annotation.defaultNotes"),
    });

    setAnnotationImageName(imageName);
    setAnnotationImageSrc("");

    setNoticeMessage(t("training.opening", { name: imageName }));

    try {
      const imageSrc = await resolveAnnotationImage(imageName, previewUrl);
      setAnnotationImageSrc(imageSrc);
      setNoticeMessage(t("training.opened", { name: imageName }));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("training.errOpen"));
      setAnnotatingItem(null);
      setAnnotationDraft(null);
      removeUploadAfterSaveRef.current = null;
    }
  }

  const closeRecordPopup = useCallback(() => {
    setAnnotatingItem(null);
    setAnnotationDraft(null);
    removeUploadAfterSaveRef.current = null;
  }, []);

  async function imageSourceToDataUrl(source: string) {
    if (source.startsWith("data:")) {
      return source;
    }

    const response = await fetch(source);
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result));

      reader.readAsDataURL(blob);
    });
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col bg-[var(--background)] px-3 py-6 text-[var(--foreground)]">
      <div className="mx-auto flex min-h-0 w-[80%] max-w-full flex-1 flex-col gap-6">
        <header className="shrink-0 pb-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-4">
              <Link
                href="/forms"
                className="inline-flex items-center justify-center rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-sm font-medium hover:bg-[var(--accent-muted)]"
              >
                {t("nav.backToPool")}
              </Link>
              <div className="h-5 w-px bg-[var(--border)]" />
              <div className="flex items-center rounded-lg bg-slate-200/60 p-1">
                <Link
                  href={buildFormFillHref(currentFormId)}
                  className="rounded-md px-4 py-1.5 text-sm font-medium text-slate-500 hover:text-slate-900"
                >
                  {t("home.title")}
                </Link>
                <div className="rounded-md bg-white px-4 py-1.5 text-sm font-medium text-slate-900 shadow-sm">
                  {t("home.training")}
                </div>
              </div>
              <p className="hidden text-xs text-[var(--muted-foreground)] sm:block">
                {t("training.intro")}
              </p>
            </div>
          </div>
        </header>

        {setupFieldDefinition ? (
          <div className="shrink-0 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 shadow-sm">
            <div className="font-medium">{t("training.setupBanner", { label: setupFieldDefinition.label })}</div>
            <div className="mt-1">{t("training.setupHint", { label: setupFieldDefinition.label })}</div>
          </div>
        ) : null}

        <section className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden xl:flex-row xl:items-stretch">
          <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col gap-4 overflow-hidden xl:max-w-[420px] xl:flex-none xl:basis-[min(100%,420px)]">
            {trainingStatus ? (
              <div className="flex shrink-0 flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
                <div className="px-5 py-4">
                  <h2 className="text-sm font-medium text-slate-500">训练池状态</h2>
                  <div className="mt-3 flex flex-col gap-2.5 text-sm font-medium text-slate-700">
                    <div className="flex items-center justify-between">
                      <span>训练图片</span>
                      <span className="text-slate-900">{trainingStatus.totalImages}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-2 rounded-full bg-emerald-500" />
                        <span>已标注</span>
                      </div>
                      <span className="text-emerald-700">{trainingStatus.labeledImages}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-2 rounded-full bg-amber-500" />
                        <span>未标注</span>
                      </div>
                      <span className="text-amber-700">{trainingStatus.unlabeledImages}</span>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            <div
              ref={uploadPanelRef}
              className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"
            >
              <div className="shrink-0 border-b border-slate-200 px-5 py-4">
                <h2 className="text-lg font-semibold">{t("training.uploadTitle")}</h2>
                <p className="mt-1 text-sm text-slate-500">{t("training.uploadHint")}</p>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="space-y-4 p-5">
                <label
                  className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed px-4 py-8 text-center transition ${
                    isDraggingFiles
                      ? "border-emerald-500 bg-emerald-50"
                      : "border-slate-300 bg-slate-50 hover:border-slate-400 hover:bg-slate-100"
                  }`}
                  onDragOver={handleDragOver}
                  onDragEnter={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                >
                  <span className="text-sm font-medium">{t("training.uploadCTA")}</span>
                  <span className="mt-1 text-xs text-slate-500">
                    {isDraggingFiles ? t("training.dropRelease") : t("training.dropHint")}
                  </span>
                  <input
                    className="hidden"
                    type="file"
                    accept={SUPPORTED_VISUAL_UPLOAD_ACCEPT}
                    multiple
                    onChange={(event) => void handleFiles(event.target.files)}
                  />
                </label>

                <div className="flex flex-wrap gap-2">
                  <button
                    className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                    onClick={async () => {
                      if (!uploads.length) {
                        setErrorMessage(t("training.errNeedImage"));
                        return;
                      }
                      setIsSavingTraining(true);
                      setErrorMessage("");
                      try {
                        let successCount = 0;
                        for (const upload of uploads) {
                          try {
                            const imageDataUrl = await imageSourceToDataUrl(upload.previewUrl);
                            await fetch(withFormId("/api/training/save"), {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                imageName: upload.file.name,
                                imageDataUrl,

                              output: {
                                date: "",
                                route: "",
                                driver: "",
                                taskCode: "",
                                total: 0,
                                totalSourceLabel: "",
                                unscanned: 0,
                                exceptions: 0,
                                waybillStatus: "",
                                stationTeam: "",
                                customFieldValues: {},
                              },
                                boxes: [],
                              }),
                            });
                            successCount++;
                          } catch (err) {
                            console.error(`Failed to save ${upload.file.name}:`, err);
                          }
                        }
                        await loadTrainingStatus();

                        clearAll();
                      } catch (error) {

                      } finally {
                        setIsSavingTraining(false);
                      }
                    }}
                    disabled={isSavingTraining || !uploads.length}
                  >
                    {isSavingTraining ? t("training.saveNoBox") : t("training.saveNoBoxBtn")}
                  </button>
                  <button
                    className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50"
                    onClick={async () => {
                      try {
                        const items = await navigator.clipboard.read();
                        const files: File[] = [];
                        for (const item of items) {
                          const imageTypes = item.types.filter((type) => type.startsWith("image/"));
                          for (const type of imageTypes) {
                            const blob = await item.getType(type);
                            const ext = type.split("/")[1] || "png";
                            files.push(
                              new File([blob], `pasted-image-${Date.now()}-${files.length}.${ext}`, {
                                type,
                                lastModified: Date.now(),
                              }),
                            );
                          }
                        }
                        if (files.length > 0) {
                          void handleFiles(files);
                        } else {
                          setErrorMessage(t("training.noClipboard"));
                        }
                      } catch {
                        setErrorMessage(t("training.errClipboard"));
                      }
                    }}
                  >
                    {t("training.pasteClipboard")}
                  </button>
                  <button className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50" onClick={clearAll}>
                    {t("training.clear")}
                  </button>
                </div>

                {errorMessage ? (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{errorMessage}</div>
                ) : null}

                {noticeMessage ? (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{noticeMessage}</div>
                ) : null}

                <div className="rounded-2xl border border-slate-200">
                    {uploads.length ? (
                      <ul className="divide-y divide-slate-200">
                        {uploads.map((upload) => (
                          <li key={upload.id}>
                            <button
                              className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors ${
                                selectedUploadId === upload.id ? "bg-blue-50 ring-1 ring-inset ring-blue-400" : "bg-white hover:bg-slate-50"
                              }`}
                              onClick={() => handleImageClick(upload)}
                            >
                              <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
                                <Image src={upload.previewUrl} alt={upload.file.name} className="object-cover" fill unoptimized />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="truncate font-medium text-slate-700">{upload.file.name}</div>
                                <div className="mt-0.5 text-xs text-slate-500">
                                  {(upload.file.size / 1024).toFixed(1)} KB
                                </div>
                              </div>

                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="px-4 py-8 text-center text-sm text-slate-500">{t("training.queueEmpty")}</div>
                    )}
                </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold">{t("training.gridTitle")}</h2>
                <p className="mt-1 text-sm text-slate-500">{t("training.gridHint")}</p>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-5">
              {trainingStatus?.items && trainingStatus.items.length > 0 ? (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                  {trainingStatus.items.map((item) => (
                    <button
                      key={item.imageName}
                      onClick={() => handleTrainingItemClick(item)}
                      className="group relative flex aspect-square flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 text-left transition-all hover:border-blue-400 hover:shadow-md"
                    >
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(event) => void handleDeleteTrainingItem(item, event)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            void handleDeleteTrainingItem(item, event);
                          }
                        }}
                        aria-disabled={deletingImageName === item.imageName}

                        className={`absolute right-2 top-2 z-10 rounded-full border border-rose-200 bg-white/95 px-2 py-1 text-[11px] font-medium text-rose-600 shadow-sm transition hover:bg-rose-50 ${
                          deletingImageName === item.imageName ? "pointer-events-none opacity-60" : ""
                        }`}
                      >
                        {t("training.delete")}
                      </span>
                      <div className="relative flex-1 bg-slate-100">
                        {!trainingThumbnailErrorMap[item.imageName] ? (
                          <Image
                            src={trainingThumbnailMap[item.imageName] || buildTrainingImageThumbnailUrl(item.imageName)}
                            alt={item.imageName}
                            fill
                            unoptimized
                            className="object-cover"
                            onLoad={() => {
                              setTrainingThumbnailErrorMap((current) => {
                                if (!current[item.imageName]) {
                                  return current;
                                }
                                const next = { ...current };
                                delete next[item.imageName];
                                return next;
                              });
                            }}
                            onError={() => {
                              setTrainingThumbnailErrorMap((current) =>
                                current[item.imageName] ? current : { ...current, [item.imageName]: true },
                              );
                            }}
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              retryTrainingThumbnail(item.imageName);
                            }}
                            className="flex h-full w-full items-center justify-center p-4 text-center text-xs text-slate-400 break-all hover:bg-slate-200/70 hover:text-slate-500"
                          >
                            {t("training.thumbErr")}
                          </button>
                        )}
                      </div>
                      <div className="border-t border-slate-200 bg-white px-3 py-2">
                        <div className="truncate text-xs font-medium text-slate-700" title={item.imageName}>
                          {item.imageName}
                        </div>
                        <div className="mt-1 flex items-center gap-1">
                          {item.labeled ? (
                            <span className="inline-flex items-center rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                              {t("training.labeled")}
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                              {t("training.unlabeled")}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex h-full min-h-[200px] items-center justify-center text-sm text-slate-500">
                  {t("training.emptyPool")}
                </div>
              )}
            </div>
          </div>
        </section>

        {annotatingItem && annotationDraft ? (
          <TrainingAnnotationWorkbench
            open
            imageName={annotationImageName}
            imageSrc={annotationImageSrc}
            apiPathBuilder={withFormId}
            fieldDefinitions={activeTableFields}
            initialSeed={annotationDraft.seed}
            initialAnnotationMode={annotationDraft.annotationMode}
            initialTableFieldValues={annotationDraft.tableFieldValues}
            initialBoxes={annotationDraft.boxes}
            initialFieldAggregations={annotationDraft.fieldAggregations}
            initialNotes={annotationDraft.notes}
            initialField={setupFieldDefinition?.id || undefined}
            onClose={closeRecordPopup}
            onNotice={setNoticeMessage}
            onError={setErrorMessage}
            onSaved={async ({ totalExamples }) => {
              await loadTrainingStatus();

              const uploadId = removeUploadAfterSaveRef.current;
              removeUploadAfterSaveRef.current = null;
              if (uploadId) {
                setUploads((current) => current.filter((u) => u.id !== uploadId));
              }
            }}
          />
        ) : null}

        <RecognitionAgentDock formId={currentFormId} modeLabel={t("training.modeLabel")} />
      </div>
    </main>
  );
}

export default function TrainingMode() {
  return (
    <Suspense fallback={<LoginLoadingFallback />}>
      <TrainingModeContent />
    </Suspense>
  );
}
