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
      exceptions: number;
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

    try {
      const nextUploads = await Promise.all(
        Array.from(fileList).map(async (file, index) => {
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
    setNoticeMessage("已清空待标注图片。");
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
      throw new Error(payload.error || "无法读取训练图片。");
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

    const confirmed = window.confirm(`确定删除训练图片「${item.imageName}」吗？删除后不可恢复。`);
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
      notes: existingExample?.notes || "人工标注用于训练池。",
    });

    setAnnotationImageName(imageName);
    setAnnotationImageSrc("");

    setNoticeMessage(`正在打开标注工作台：${imageName}`);

    try {
      const imageSrc = await resolveAnnotationImage(imageName, previewUrl);
      setAnnotationImageSrc(imageSrc);
      setNoticeMessage(`已打开标注工作台：${imageName}`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "打开标注失败。");
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
    <main className="min-h-screen bg-slate-100 px-4 py-4 text-slate-900">
      <div className="mx-auto flex max-w-[1800px] flex-col gap-4">
        <header className="rounded-3xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
            <Link href="/forms" className="font-medium text-blue-600 hover:underline">
              ← 返回填表池
            </Link>
            <Link
              href={buildFormFillHref(currentFormId)}
              className="font-medium text-slate-700 hover:text-slate-900 hover:underline"
            >
              切换到填表模式
            </Link>
          </div>

          <h1 className="text-2xl font-semibold">OrSight - 训练模式</h1>
          <p className="mt-2 text-sm text-slate-600">
            上传与业务一致的截图，在标注工作台中画框并保存标准输出。训练池会在下次识别时作为提示与参考图使用；请尽量使用「位图坐标」框（coordSpace: image）以便裁剪增强生效。
          </p>
          {setupFieldDefinition ? (
            <div className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
              <div className="font-medium">正在为「{setupFieldDefinition.label}」准备第一条训练样本</div>
              <div className="mt-1">
                请上传能代表该项目的真实截图，打开标注工作台后框选「{setupFieldDefinition.label}」在图中的位置并保存。
              </div>
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            {trainingStatus ? (
              <>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
                  训练图片：{trainingStatus.totalImages}
                </span>
                <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-700">
                  已标注：{trainingStatus.labeledImages}
                </span>
                <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-700">
                  未标注：{trainingStatus.unlabeledImages}
                </span>
              </>
            ) : null}
          </div>
        </header>

        <section className="grid min-h-[calc(100vh-170px)] grid-cols-1 gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
          <div className="flex flex-col gap-4">
            <div className="flex min-h-0 flex-col rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-5 py-4">
                <h2 className="text-lg font-semibold">训练池说明</h2>
                <p className="mt-1 text-sm text-slate-500">训练样本与图片会写入当前表单对应的训练池（Supabase 或本地目录）。</p>
              </div>
              <div className="space-y-3 p-5 text-sm leading-6 text-slate-600">
                <p>左侧上传待标注图片，保存无框样本可先入库；点击缩略图打开工作台画框并保存标准答案。</p>
                <p>右侧网格为已入库图片；绿色「已标注」表示该图在训练池中有结构化样本。</p>
                <p>
                  右下角「识别管家」与填表页共用：可在此用自然语言调整本填表的识别规则（按当前表单隔离），特殊场景下不必离开训练页。
                </p>
                <p>删除图片会同时移除 Storage 中的文件及对应样本记录，请谨慎操作。</p>
              </div>
            </div>


            <div ref={uploadPanelRef} className="flex min-h-0 flex-1 flex-col rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-5 py-4">
                <h2 className="text-lg font-semibold">待标注上传区</h2>
                <p className="mt-1 text-sm text-slate-500">支持 PNG / JPG / JPEG / WEBP / PDF；可拖拽、点击选择或 Ctrl+V 粘贴截图。</p>
              </div>

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
                  <span className="text-sm font-medium">点击、拖拽或粘贴上传图片 / PDF</span>
                  <span className="mt-1 text-xs text-slate-500">
                    {isDraggingFiles ? "松开鼠标即可上传文件" : "可一次选择多张，或直接 Ctrl+V 粘贴图片。"}
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
                        setErrorMessage("请先上传至少一张图片。");
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
                    {isSavingTraining ? "保存中…" : "保存到训练池（无框）"}
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
                          setErrorMessage("剪贴板中没有图片。");
                        }
                      } catch {
                        setErrorMessage("无法读取剪贴板，请授予权限或使用 Ctrl+V 粘贴。");
                      }
                    }}
                  >
                    从剪贴板粘贴
                  </button>
                  <button className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50" onClick={clearAll}>
                    清空
                  </button>
                </div>

                {errorMessage ? (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{errorMessage}</div>
                ) : null}

                {noticeMessage ? (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{noticeMessage}</div>
                ) : null}

                <div className="grid gap-4 xl:grid-cols-1">
                  <div className="max-h-[600px] overflow-auto rounded-2xl border border-slate-200">
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
                      <div className="px-4 py-8 text-center text-sm text-slate-500">上传后这里会显示待标注列表</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex min-h-0 flex-col rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-lg font-semibold">训练池图片</h2>
                <p className="mt-1 text-sm text-slate-500">点击缩略图打开标注；右上角可删除入库图片。</p>
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
                        删除
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
                            缩略图加载失败，点击重试
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
                              已标注
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                              未标注
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex h-full min-h-[200px] items-center justify-center text-sm text-slate-500">
                  暂无训练图片。可在左侧上传后点击「保存到训练池」，或从其他环境同步训练数据。
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

        <RecognitionAgentDock formId={currentFormId} modeLabel="训练模式" />
      </div>
    </main>
  );
}

export default function TrainingMode() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-100" />}>
      <TrainingModeContent />
    </Suspense>
  );
}
