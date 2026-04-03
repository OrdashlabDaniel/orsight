"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DEFAULT_TABLE_FIELDS, isBuiltInFieldId, type TableFieldDefinition } from "@/lib/table-fields";

/** 训练标注字段 key，与训练池 boxes 一致 */
export type AnnotationField = string;

/** 与 @/lib/training FieldAggregation 一致 */
export type FieldAggregation = "sum" | "join_comma" | "join_newline" | "first";

export type WorkbenchAnnotationBox = {
  id: string;
  field: AnnotationField;
  value: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 未设置：历史样本，坐标相对标注容器（含 object-contain 留白）。新框均为 image。 */
  coordSpace?: "image" | "container";
};

export type AnnotationWorkbenchSeed = {
  date?: string;
  route?: string;
  driver?: string;
  taskCode?: string;
  total?: number | "";
  unscanned?: number | "";
  exceptions?: number | "";
  waybillStatus?: string;
  stationTeam?: string;
  totalSourceLabel?: string;
  customFieldValues?: Record<string, string | number | "">;
};

type ManualRecordState = AnnotationWorkbenchSeed;

type DrawingState = {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  space: "image" | "container";
};

type ImageLayout = {
  cw: number;
  ch: number;
  nw: number;
  nh: number;
  dispW: number;
  dispH: number;
  offX: number;
  offY: number;
};

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

export const annotationFields: Array<{ key: AnnotationField; label: string }> = [
  { key: "date", label: "日期" },
  { key: "route", label: "抽查路线" },
  { key: "driver", label: "抽查司机" },
  { key: "taskCode", label: "任务编码" },
  { key: "total", label: "运单数量" },
  { key: "unscanned", label: "未收数量" },
  { key: "exceptions", label: "错扫数量" },
  { key: "waybillStatus", label: "响应更新状态" },
  { key: "stationTeam", label: "站点车队" },
];

function defaultAggregationForField(field: TableFieldDefinition): FieldAggregation {
  return field.type === "number" ? "sum" : "join_comma";
}

function effectiveFieldAggregation(
  field: TableFieldDefinition,
  aggs: Partial<Record<AnnotationField, FieldAggregation>>,
): FieldAggregation {
  return aggs[field.id] ?? defaultAggregationForField(field);
}

function seedToManual(seed: AnnotationWorkbenchSeed): ManualRecordState {
  return {
    date: seed.date ?? "",
    route: seed.route ?? "",
    driver: seed.driver ?? "",
    taskCode: seed.taskCode ?? "",
    total: seed.total ?? "",
    unscanned: seed.unscanned ?? "",
    exceptions: seed.exceptions ?? "",
    waybillStatus: seed.waybillStatus ?? "",
    stationTeam: seed.stationTeam ?? "",
    totalSourceLabel: seed.totalSourceLabel ?? "",
    customFieldValues: { ...(seed.customFieldValues || {}) },
  };
}

function ensureBoxIds(boxes: WorkbenchAnnotationBox[]): WorkbenchAnnotationBox[] {
  return boxes.map((b) => ({
    ...b,
    id: typeof b.id === "string" && b.id ? b.id : crypto.randomUUID(),
  }));
}

function getActiveCustomFieldIdSet(fields: TableFieldDefinition[]) {
  return new Set(fields.filter((field) => !isBuiltInFieldId(field.id)).map((field) => field.id));
}

function sanitizeManualRecord(seed: AnnotationWorkbenchSeed, activeFields: TableFieldDefinition[]): ManualRecordState {
  const activeCustomFieldIds = getActiveCustomFieldIdSet(activeFields);
  return {
    ...seedToManual(seed),
    customFieldValues: Object.fromEntries(
      Object.entries(seed.customFieldValues || {}).filter(([fieldId]) => activeCustomFieldIds.has(fieldId)),
    ),
  };
}

function sanitizeAnnotationBoxes(
  boxes: WorkbenchAnnotationBox[],
  activeFieldIds: ReadonlySet<string>,
): WorkbenchAnnotationBox[] {
  return ensureBoxIds(boxes.filter((box) => activeFieldIds.has(box.field)));
}

function sanitizeFieldAggregations(
  aggs: Partial<Record<AnnotationField, FieldAggregation>>,
  activeFieldIds: ReadonlySet<string>,
): Partial<Record<AnnotationField, FieldAggregation>> {
  return Object.fromEntries(
    Object.entries(aggs).filter(([fieldId]) => activeFieldIds.has(fieldId)),
  ) as Partial<Record<AnnotationField, FieldAggregation>>;
}

function pickAnnotationField(
  preferredField: AnnotationField | undefined,
  activeFields: TableFieldDefinition[],
): AnnotationField {
  if (preferredField && activeFields.some((field) => field.id === preferredField)) {
    return preferredField;
  }
  return activeFields[0]?.id ?? "driver";
}

export type TrainingAnnotationWorkbenchProps = {
  open: boolean;
  imageName: string;
  imageSrc: string;
  fieldDefinitions?: TableFieldDefinition[];
  initialSeed: AnnotationWorkbenchSeed;
  initialBoxes?: WorkbenchAnnotationBox[];
  initialFieldAggregations?: Partial<Record<AnnotationField, FieldAggregation>>;
  initialNotes?: string;
  initialField?: AnnotationField;
  onClose: () => void;
  onSaved?: (result: { totalExamples?: number; finalSeed: AnnotationWorkbenchSeed }) => void | Promise<void>;
  onNotice?: (message: string) => void;
  onError?: (message: string) => void;
};

export function TrainingAnnotationWorkbench({
  open,
  imageName,
  imageSrc,
  fieldDefinitions,
  initialSeed,
  initialBoxes = [],
  initialFieldAggregations = {},
  initialNotes,
  initialField,
  onClose,
  onSaved,
  onNotice,
  onError,
}: TrainingAnnotationWorkbenchProps) {
  const activeFieldDefinitions = useMemo(
    () => (fieldDefinitions?.length ? fieldDefinitions : DEFAULT_TABLE_FIELDS).filter((field) => field.active),
    [fieldDefinitions],
  );
  const activeFieldIdSet = useMemo(() => new Set(activeFieldDefinitions.map((field) => field.id)), [activeFieldDefinitions]);
  const fieldDefinitionMap = useMemo(
    () => Object.fromEntries(activeFieldDefinitions.map((field) => [field.id, field])),
    [activeFieldDefinitions],
  );
  const defaultFieldId = pickAnnotationField(initialField, activeFieldDefinitions);
  const [manualRecord, setManualRecord] = useState<ManualRecordState>(() => sanitizeManualRecord(initialSeed, activeFieldDefinitions));
  const [annotationBoxes, setAnnotationBoxes] = useState<WorkbenchAnnotationBox[]>(() => sanitizeAnnotationBoxes(initialBoxes, activeFieldIdSet));
  const [fieldAggregations, setFieldAggregations] = useState<Partial<Record<AnnotationField, FieldAggregation>>>(() =>
    sanitizeFieldAggregations(initialFieldAggregations, activeFieldIdSet),
  );
  const [annotationField, setAnnotationField] = useState<AnnotationField>(defaultFieldId);
  const [annotationNotes, setAnnotationNotes] = useState(initialNotes ?? "人工标注用于训练池。");
  const [drawingState, setDrawingState] = useState<DrawingState | null>(null);
  const [isSavingTraining, setIsSavingTraining] = useState(false);
  const [isPreviewFillLoading, setIsPreviewFillLoading] = useState(false);
  const [layoutTick, setLayoutTick] = useState(0);
  const bumpLayout = useCallback(() => setLayoutTick((t) => t + 1), []);
  const visibleAnnotationBoxes = useMemo(
    () => annotationBoxes.filter((box) => activeFieldIdSet.has(box.field)),
    [activeFieldIdSet, annotationBoxes],
  );

  const annotationCanvasRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const seedJsonRef = useRef<string>("");

  function getImageLayout(): ImageLayout | null {
    const container = annotationCanvasRef.current;
    const img = imageRef.current;
    if (!container || !img?.naturalWidth || !img.naturalHeight) {
      return null;
    }
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    if (cw <= 0 || ch <= 0) {
      return null;
    }
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    const scale = Math.min(cw / nw, ch / nh);
    const dispW = nw * scale;
    const dispH = nh * scale;
    const offX = (cw - dispW) / 2;
    const offY = (ch - dispH) / 2;
    return { cw, ch, nw, nh, dispW, dispH, offX, offY };
  }

  function clientToImageNorm(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = annotationCanvasRef.current?.getBoundingClientRect();
    const layout = getImageLayout();
    if (!rect || !layout) {
      return null;
    }
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const ix = (px - layout.offX) / layout.dispW;
    const iy = (py - layout.offY) / layout.dispH;
    return { x: clamp01(ix), y: clamp01(iy) };
  }

  function containerNormPoint(clientX: number, clientY: number) {
    const rect = annotationCanvasRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return null;
    }
    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;
    return { x: clamp01(x), y: clamp01(y) };
  }

  function getPointerNorm(clientX: number, clientY: number): { x: number; y: number; space: "image" | "container" } {
    const imgPt = clientToImageNorm(clientX, clientY);
    if (imgPt) {
      return { ...imgPt, space: "image" };
    }
    const c = containerNormPoint(clientX, clientY);
    if (!c) {
      return { x: 0, y: 0, space: "container" };
    }
    return { ...c, space: "container" };
  }

  function containerNormBoxToImageBox(
    box: { x: number; y: number; width: number; height: number },
    layout: ImageLayout,
  ) {
    const { cw, ch, dispW, dispH, offX, offY } = layout;
    const x1 = box.x * cw;
    const y1 = box.y * ch;
    const x2 = (box.x + box.width) * cw;
    const y2 = (box.y + box.height) * ch;
    let ix = (x1 - offX) / dispW;
    let iy = (y1 - offY) / dispH;
    let iw = (x2 - x1) / dispW;
    let ih = (y2 - y1) / dispH;
    ix = clamp01(ix);
    iy = clamp01(iy);
    iw = Math.max(0, Math.min(1 - ix, iw));
    ih = Math.max(0, Math.min(1 - iy, ih));
    return { x: ix, y: iy, width: iw, height: ih };
  }

  function boxesForVisionApi(boxes: WorkbenchAnnotationBox[]) {
    const layout = getImageLayout();
    return boxes.map((b) => {
      if (b.coordSpace === "image") {
        return { field: b.field, x: b.x, y: b.y, width: b.width, height: b.height };
      }
      if (layout) {
        const r = containerNormBoxToImageBox(b, layout);
        return { field: b.field, x: r.x, y: r.y, width: r.width, height: r.height };
      }
      return { field: b.field, x: b.x, y: b.y, width: b.width, height: b.height };
    });
  }

  function boxToContainerStyle(box: WorkbenchAnnotationBox) {
    if (box.coordSpace === "image") {
      const layout = getImageLayout();
      if (!layout) {
        return {
          left: `${box.x * 100}%`,
          top: `${box.y * 100}%`,
          width: `${box.width * 100}%`,
          height: `${box.height * 100}%`,
        };
      }
      const { cw, ch, dispW, dispH, offX, offY } = layout;
      const left = (offX + box.x * dispW) / cw;
      const top = (offY + box.y * dispH) / ch;
      const width = (box.width * dispW) / cw;
      const height = (box.height * dispH) / ch;
      return {
        left: `${left * 100}%`,
        top: `${top * 100}%`,
        width: `${width * 100}%`,
        height: `${height * 100}%`,
      };
    }
    return {
      left: `${box.x * 100}%`,
      top: `${box.y * 100}%`,
      width: `${box.width * 100}%`,
      height: `${box.height * 100}%`,
    };
  }

  useEffect(() => {
    if (!open) {
      return;
    }
    const el = annotationCanvasRef.current;
    if (!el) {
      return;
    }
    const ro = new ResizeObserver(() => bumpLayout());
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, bumpLayout]);

  useEffect(() => {
    if (!open) {
      seedJsonRef.current = "";
      return;
    }
    const next = JSON.stringify({
      initialSeed,
      initialBoxes,
      initialFieldAggregations,
      initialNotes: initialNotes ?? "人工标注用于训练池。",
    });
    if (next === seedJsonRef.current) {
      return;
    }
    seedJsonRef.current = next;
    setManualRecord(sanitizeManualRecord(initialSeed, activeFieldDefinitions));
    setAnnotationBoxes(sanitizeAnnotationBoxes(initialBoxes, activeFieldIdSet));
    setFieldAggregations(sanitizeFieldAggregations(initialFieldAggregations, activeFieldIdSet));
    setAnnotationNotes(initialNotes ?? "人工标注用于训练池。");
    setAnnotationField(pickAnnotationField(initialField, activeFieldDefinitions));
    setDrawingState(null);
  }, [open, initialSeed, initialBoxes, initialFieldAggregations, initialNotes, initialField, activeFieldDefinitions, activeFieldIdSet]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setManualRecord((current) => sanitizeManualRecord(current, activeFieldDefinitions));
    setAnnotationBoxes((current) => sanitizeAnnotationBoxes(current, activeFieldIdSet));
    setFieldAggregations((current) => sanitizeFieldAggregations(current, activeFieldIdSet));
    setAnnotationField((current) => pickAnnotationField(current, activeFieldDefinitions));
  }, [open, activeFieldDefinitions, activeFieldIdSet]);

  const handleClose = useCallback(() => {
    setDrawingState(null);
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        handleClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, handleClose]);

  function getAnnotationFieldValue(field: AnnotationField) {
    const value = isBuiltInFieldId(field)
      ? manualRecord[field]
      : manualRecord.customFieldValues?.[field];
    return value === null || value === undefined || value === "" ? "" : String(value);
  }

  function setAnnotationFieldValue(field: TableFieldDefinition, rawValue: string) {
    setManualRecord((current) => {
      if (isBuiltInFieldId(field.id)) {
        return {
          ...current,
          [field.id]: rawValue,
        };
      }
      return {
        ...current,
        customFieldValues: {
          ...(current.customFieldValues || {}),
          [field.id]: field.type === "number" ? (rawValue === "" ? "" : Number(rawValue)) : rawValue,
        },
      };
    });
  }

  function beginDrawing(event: React.MouseEvent<HTMLDivElement>) {
    const point = getPointerNorm(event.clientX, event.clientY);
    setDrawingState({
      startX: point.x,
      startY: point.y,
      currentX: point.x,
      currentY: point.y,
      space: point.space,
    });
  }

  function updateDrawing(event: React.MouseEvent<HTMLDivElement>) {
    if (!drawingState) {
      return;
    }

    const point = getPointerNorm(event.clientX, event.clientY);
    if (point.space !== drawingState.space) {
      return;
    }

    setDrawingState({
      ...drawingState,
      currentX: point.x,
      currentY: point.y,
    });
  }

  function beginDrawingTouch(event: React.TouchEvent<HTMLDivElement>) {
    if (event.touches.length !== 1) return;
    const t = event.touches[0];
    const point = getPointerNorm(t.clientX, t.clientY);
    event.preventDefault();
    setDrawingState({
      startX: point.x,
      startY: point.y,
      currentX: point.x,
      currentY: point.y,
      space: point.space,
    });
  }

  function updateDrawingTouch(event: React.TouchEvent<HTMLDivElement>) {
    if (!drawingState || event.touches.length !== 1) return;
    const t = event.touches[0];
    const point = getPointerNorm(t.clientX, t.clientY);
    if (point.space !== drawingState.space) {
      return;
    }
    event.preventDefault();
    setDrawingState({
      ...drawingState,
      currentX: point.x,
      currentY: point.y,
    });
  }

  function finishDrawingTouch(event: React.TouchEvent<HTMLDivElement>) {
    event.preventDefault();
    const t = event.changedTouches[0];
    let endX: number | undefined;
    let endY: number | undefined;
    if (t && drawingState) {
      const point = getPointerNorm(t.clientX, t.clientY);
      if (point.space === drawingState.space) {
        endX = point.x;
        endY = point.y;
      }
    }
    finishDrawing(endX, endY);
  }

  function finishDrawing(endX?: number, endY?: number) {
    if (!drawingState || !open) {
      setDrawingState(null);
      return;
    }

    const cx = endX ?? drawingState.currentX;
    const cy = endY ?? drawingState.currentY;
    const x = Math.min(drawingState.startX, cx);
    const y = Math.min(drawingState.startY, cy);
    const width = Math.abs(cx - drawingState.startX);
    const height = Math.abs(cy - drawingState.startY);
    setDrawingState(null);

    if (width < 0.005 || height < 0.005) {
      return;
    }

    const nextBox: WorkbenchAnnotationBox = {
      id: crypto.randomUUID(),
      field: annotationField,
      value: getAnnotationFieldValue(annotationField),
      x,
      y,
      width,
      height,
      coordSpace: drawingState.space === "image" ? "image" : "container",
    };

    setAnnotationBoxes((current) => [...current, nextBox]);
  }

  function removeAnnotationBoxById(boxId: string) {
    setAnnotationBoxes((current) => current.filter((box) => box.id !== boxId));
  }

  function clearAnnotationFieldBoxes(field: AnnotationField) {
    setAnnotationBoxes((current) => current.filter((box) => box.field !== field));
  }

  async function imageSourceToDataUrl(source: string) {
    if (source.startsWith("data:")) {
      return source;
    }

    const response = await fetch(source);
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("图片读取失败。"));
      reader.readAsDataURL(blob);
    });
  }

  function manualToFinalSeed(m: ManualRecordState): AnnotationWorkbenchSeed {
    const numOrEmpty = (v: unknown): number | "" => {
      if (v === "" || v === null || v === undefined) return "";
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? n : "";
    };
    const hasField = (fieldId: string) => activeFieldIdSet.has(fieldId);
    const customFieldValues = Object.fromEntries(
      activeFieldDefinitions
        .filter((field) => !isBuiltInFieldId(field.id))
        .map((field) => [
          field.id,
          field.type === "number"
            ? numOrEmpty(m.customFieldValues?.[field.id])
            : String(m.customFieldValues?.[field.id] ?? ""),
        ])
        .filter(([, value]) => value !== ""),
    ) as Record<string, string | number | "">;
    return {
      date: hasField("date") ? (m.date ?? "") : "",
      route: hasField("route") ? (m.route ?? "") : "",
      driver: hasField("driver") ? (m.driver ?? "") : "",
      taskCode: hasField("taskCode") ? (m.taskCode ?? "") : "",
      total: hasField("total") ? numOrEmpty(m.total) : "",
      unscanned: hasField("unscanned") ? numOrEmpty(m.unscanned) : "",
      exceptions: hasField("exceptions") ? numOrEmpty(m.exceptions) : "",
      waybillStatus: hasField("waybillStatus") ? (m.waybillStatus ?? "") : "",
      stationTeam: hasField("stationTeam") ? (m.stationTeam ?? "") : "",
      totalSourceLabel: hasField("total") ? (m.totalSourceLabel ?? "") : "",
      customFieldValues,
    };
  }

  async function previewFillFromAnnotations() {
    if (!open || !imageSrc || !visibleAnnotationBoxes.length) {
      onError?.("请先完成框选并确保图片已加载。");
      return;
    }
    setIsPreviewFillLoading(true);
    try {
      const imageDataUrl = await imageSourceToDataUrl(imageSrc);
      const res = await fetch("/api/training/preview-fill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageDataUrl,
          boxes: boxesForVisionApi(visibleAnnotationBoxes),
          fieldAggregations: sanitizeFieldAggregations(fieldAggregations, activeFieldIdSet),
          tableFields: activeFieldDefinitions,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        record?: Record<string, string | number | "">;
        previewNote?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || "试填失败");
      }
      if (!data.record) {
        throw new Error("未返回试填结果");
      }
      const r = data.record;
      const numOrEmpty = (v: unknown): number | "" => {
        if (v === "" || v === null || v === undefined) return "";
        const n = typeof v === "number" ? v : Number(v);
        return Number.isFinite(n) ? n : "";
      };
      const boxed = new Set(visibleAnnotationBoxes.map((b) => b.field));
      setManualRecord((prev) => {
        const next = { ...prev };
        const strFromModel = (v: unknown) => (typeof v === "string" ? v : "");
        if (boxed.has("date")) {
          next.date = strFromModel(r.date);
        }
        if (boxed.has("route")) {
          next.route = strFromModel(r.route);
        }
        if (boxed.has("driver")) {
          next.driver = strFromModel(r.driver);
        }
        if (boxed.has("taskCode")) {
          next.taskCode = strFromModel(r.taskCode);
        }
        if (boxed.has("waybillStatus")) {
          next.waybillStatus = strFromModel(r.waybillStatus);
        }
        if (boxed.has("stationTeam")) {
          next.stationTeam = strFromModel(r.stationTeam);
        }
        if (boxed.has("total")) {
          next.total = numOrEmpty(r.total);
          if (typeof r.totalSourceLabel === "string") {
            next.totalSourceLabel = r.totalSourceLabel;
          }
        }
        if (boxed.has("unscanned")) {
          next.unscanned = numOrEmpty(r.unscanned);
        }
        if (boxed.has("exceptions")) {
          next.exceptions = numOrEmpty(r.exceptions);
        }
        const customRecord =
          r.customFieldValues && typeof r.customFieldValues === "object"
            ? (r.customFieldValues as Record<string, string | number | "">)
            : {};
        for (const field of activeFieldDefinitions) {
          if (isBuiltInFieldId(field.id) || !boxed.has(field.id)) {
            continue;
          }
          next.customFieldValues = {
            ...(next.customFieldValues || {}),
            [field.id]: customRecord[field.id] ?? "",
          };
        }
        return next;
      });
      onNotice?.(
        data.previewNote
          ? `AI 试填完成（已按标注框裁剪成小图再识别）。说明：${data.previewNote} 请核对后再存入训练池。`
          : "AI 试填完成：服务端已按每个框裁剪成小图后送模型识别，请核对右侧数值。",
      );
    } catch (err) {
      onError?.(err instanceof Error ? err.message : "试填失败");
    } finally {
      setIsPreviewFillLoading(false);
    }
  }

  async function saveAnnotationToTrainingPool() {
    if (!open || !imageName || !imageSrc) {
      onError?.("当前没有可保存的标注。");
      return;
    }

    if (!visibleAnnotationBoxes.length) {
      onError?.("请至少标注一个字段框后再保存。");
      return;
    }

    setIsSavingTraining(true);

    try {
      const finalSeed = manualToFinalSeed(manualRecord);
      const imageDataUrl = await imageSourceToDataUrl(imageSrc);
      const response = await fetch("/api/training/save", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          imageName,
          imageDataUrl,
          notes: annotationNotes,
          output: {
            date: finalSeed.date || "",
            route: finalSeed.route || "",
            driver: finalSeed.driver || "",
            taskCode: finalSeed.taskCode || "",
            total: Number(finalSeed.total) || 0,
            totalSourceLabel: finalSeed.totalSourceLabel || "",
            unscanned: Number(finalSeed.unscanned) || 0,
            exceptions: Number(finalSeed.exceptions) || 0,
            waybillStatus: finalSeed.waybillStatus || "",
            stationTeam: finalSeed.stationTeam || "",
            customFieldValues: finalSeed.customFieldValues || {},
          },
          boxes: visibleAnnotationBoxes,
          fieldAggregations: sanitizeFieldAggregations(fieldAggregations, activeFieldIdSet),
        }),
      });

      const payload = (await response.json()) as { error?: string; totalExamples?: number };
      if (!response.ok) {
        throw new Error(payload.error || "保存训练样本失败。");
      }

      await Promise.resolve(onSaved?.({ totalExamples: payload.totalExamples, finalSeed }));
      handleClose();
    } catch (error) {
      onError?.(error instanceof Error ? error.message : "保存训练样本失败。");
    } finally {
      setIsSavingTraining(false);
    }
  }

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="annotation-dialog-title"
    >
      <div className="my-auto flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white p-5 shadow-2xl">
        <div className="sticky top-0 z-10 mb-4 flex flex-wrap items-center justify-between gap-3 bg-white pb-2">
          <div>
            <h2 id="annotation-dialog-title" className="text-lg font-semibold">
              图片框选标注
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              适合 POD 屏摄：先选字段，再在图上拖出矩形框；可触摸屏操作。填好右侧数值后保存。
            </p>
            <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-xs text-slate-600">
              <li>选中字段后在图上画框；同一字段可画多个框（如两条「未领取」各画一框）</li>
              <li>多框时在列表里选择合并方式：数字相加、逗号/换行并列，或仅取第一处</li>
              <li>右侧填写该字段最终应写入表格的值（如 1+0=1），最后点「存入训练池」</li>
              <li>
                画框坐标会按<strong>原图像素</strong>对齐后再参与「AI 试填」（避免适应容器时的留白导致模型读到框外文字，例如抽查路线框到
                IAH01-050-R 却填成 IAH-MEL）。
              </li>
            </ol>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="关闭标注弹窗"
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-300 text-lg font-medium text-slate-600 hover:bg-slate-50"
              onClick={handleClose}
            >
              ×
            </button>
            <button
            type="button"
            className="shrink-0 rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50"
            onClick={handleClose}
          >
            关闭（Esc）
          </button>
        </div>
        </div>

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto pr-1 lg:grid-cols-[minmax(0,1fr)_min(100%,380px)]">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <div className="mb-3 text-sm font-medium text-slate-700">标注图片：{imageName}</div>
            <div
              ref={annotationCanvasRef}
              className="relative min-h-[min(55vh,520px)] cursor-crosshair select-none overflow-hidden rounded-xl bg-black/5 [touch-action:none]"
              data-layout-tick={layoutTick}
              onMouseDown={beginDrawing}
              onMouseMove={updateDrawing}
              onMouseUp={() => finishDrawing()}
              onMouseLeave={() => finishDrawing()}
              onTouchStart={beginDrawingTouch}
              onTouchMove={updateDrawingTouch}
              onTouchEnd={finishDrawingTouch}
              onTouchCancel={() => setDrawingState(null)}
            >
              {imageSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  ref={imageRef}
                  src={imageSrc}
                  alt={imageName}
                  draggable={false}
                  onLoad={bumpLayout}
                  className="pointer-events-none h-full w-full object-contain"
                />
              ) : (
                <div className="flex h-full min-h-[200px] items-center justify-center text-sm text-slate-400">加载图片中…</div>
              )}
              {visibleAnnotationBoxes.map((box) => {
                const sameField = visibleAnnotationBoxes.filter((b) => b.field === box.field);
                const idx = sameField.findIndex((b) => b.id === box.id) + 1;
                const baseLabel = fieldDefinitionMap[box.field]?.label || box.field;
                const tag = sameField.length > 1 ? `${baseLabel}#${idx}` : baseLabel;
                return (
                  <div
                    key={box.id}
                    className="pointer-events-none absolute border-2 border-rose-500 bg-rose-500/10"
                    style={boxToContainerStyle(box)}
                  >
                    <span className="absolute left-0 top-0 max-w-[min(100%,120px)] -translate-y-full truncate rounded bg-rose-500 px-1.5 py-0.5 text-[10px] text-white">
                      {tag}
                    </span>
                  </div>
                );
              })}
              {drawingState ? (
                <div
                  className="pointer-events-none absolute border-2 border-blue-500 bg-blue-500/20"
                  style={boxToContainerStyle({
                    id: "draft",
                    field: "driver",
                    value: "",
                    x: Math.min(drawingState.startX, drawingState.currentX),
                    y: Math.min(drawingState.startY, drawingState.currentY),
                    width: Math.abs(drawingState.currentX - drawingState.startX),
                    height: Math.abs(drawingState.currentY - drawingState.startY),
                    coordSpace: drawingState.space === "image" ? "image" : undefined,
                  })}
                />
              ) : null}
            </div>
          </div>

          <div className="flex min-h-0 flex-col gap-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 text-sm font-medium text-slate-700">填写正确数值</div>
              <div className="space-y-3">
                {activeFieldDefinitions.map((field) => (
                  <div key={field.id}>
                    <label className="mb-1 block text-xs text-slate-500">{field.label}</label>
                    <input
                      type={field.type === "number" ? "number" : "text"}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                      value={getAnnotationFieldValue(field.id)}
                      onChange={(e) => setAnnotationFieldValue(field, e.target.value)}
                      placeholder={`输入${field.label}`}
                    />
                    {field.id === "total" && (
                      <input
                        type="text"
                        className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                        value={manualRecord.totalSourceLabel || ""}
                        onChange={(e) => setManualRecord({ ...manualRecord, totalSourceLabel: e.target.value })}
                        placeholder="输入运单数量的来源标签 (如: 应领件数)"
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 text-sm font-medium text-slate-700">选择字段并画框</div>
              <div className="space-y-3">
                {activeFieldDefinitions.map((field) => {
                  const boxesFor = visibleAnnotationBoxes.filter((box) => box.field === field.id);
                  const count = boxesFor.length;
                  const hasBox = count > 0;
                  return (
                    <div key={field.id} className="rounded-lg border border-slate-100 bg-white/60 px-2 py-2">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                          <input
                            type="radio"
                            name="annotationField"
                            checked={annotationField === field.id}
                            onChange={() => setAnnotationField(field.id)}
                            className="text-blue-600"
                          />
                          <span className={hasBox ? "font-medium text-slate-900" : "text-slate-500"}>{field.label}</span>
                          {count > 0 ? (
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">{count} 框</span>
                          ) : null}
                        </label>
                        {count >= 2 ? (
                          <select
                            className="max-w-[140px] rounded border border-slate-300 bg-white px-1 py-1 text-[11px] outline-none focus:border-blue-500"
                            value={effectiveFieldAggregation(field, fieldAggregations)}
                            onChange={(e) =>
                              setFieldAggregations((prev) => ({
                                ...prev,
                                [field.id]: e.target.value as FieldAggregation,
                              }))
                            }
                          >
                            <option value="sum">多框：数字相加</option>
                            <option value="join_comma">多框：逗号并列</option>
                            <option value="join_newline">多框：换行并列</option>
                            <option value="first">多框：仅第一处</option>
                          </select>
                        ) : null}
                        {hasBox ? (
                          <button
                            type="button"
                            className="text-xs text-rose-500 hover:text-rose-700"
                            onClick={() => clearAnnotationFieldBoxes(field.id)}
                          >
                            清除全部
                          </button>
                        ) : (
                          <span className="text-xs text-slate-400">未框选</span>
                        )}
                      </div>
                      {count > 1 ? (
                        <ul className="mt-2 space-y-1 border-t border-slate-100 pt-2 text-[11px] text-slate-600">
                          {boxesFor.map((b, i) => (
                            <li key={b.id} className="flex items-center justify-between gap-2">
                              <span>
                                框 {i + 1}
                                {b.value ? `（参考值 ${b.value}）` : ""}
                              </span>
                              <button
                                type="button"
                                className="shrink-0 text-rose-500 hover:text-rose-700"
                                onClick={() => removeAnnotationBoxById(b.id)}
                              >
                                删除
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              <p className="mt-3 text-xs text-slate-500">
                同一字段可连续画多个框；未收数量等数字字段默认「相加」。单框时无需选择合并方式。
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 text-sm font-medium text-slate-700">附加说明</div>
              <textarea
                className="w-full resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                rows={2}
                value={annotationNotes}
                onChange={(e) => setAnnotationNotes(e.target.value)}
                placeholder="选填：记录特殊情况或标注说明..."
              />
            </div>

            <div className="mt-auto flex flex-col gap-2">
              <button
                type="button"
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                onClick={handleClose}
              >
                关闭标注弹窗
              </button>
              <button
                type="button"
                className="w-full rounded-xl border border-violet-300 bg-violet-50 px-4 py-3 text-sm font-medium text-violet-900 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => void previewFillFromAnnotations()}
                disabled={isPreviewFillLoading || isSavingTraining || !imageSrc || visibleAnnotationBoxes.length === 0}
              >
                {isPreviewFillLoading ? "试填识别中…" : "AI 试填预览（按框选识别并填入上方）"}
              </button>
              <button
                type="button"
                className="w-full rounded-xl bg-emerald-600 px-4 py-3 font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-emerald-300"
                onClick={() => void saveAnnotationToTrainingPool()}
                disabled={isSavingTraining || isPreviewFillLoading}
              >
                {isSavingTraining ? "保存中..." : "存入训练池"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
