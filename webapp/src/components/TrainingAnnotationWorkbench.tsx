"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DEFAULT_TABLE_FIELDS, isBuiltInFieldId, type TableFieldDefinition } from "@/lib/table-fields";
import { ensureImageDataUrlFromSource } from "@/lib/client-visual-upload";

/** 训练标注字段 key，与训练池 boxes 一致 */
export type AnnotationField = string;
export type AnnotationMode = "record" | "table";
export type TableAnnotationFieldValue = string | number | "";
export type TableAnnotationFieldValues = Record<string, TableAnnotationFieldValue[]>;

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
type TableAnnotationTextState = Record<string, string>;

type DrawingState = {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  space: "image" | "container";
};

type ViewportPanState = {
  startX: number;
  startY: number;
  scrollLeft: number;
  scrollTop: number;
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

function cloneAnnotationBoxes(boxes: WorkbenchAnnotationBox[]): WorkbenchAnnotationBox[] {
  return boxes.map((box) => ({ ...box }));
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select" || target.isContentEditable;
}

function trimTrailingEmptyEntries(values: TableAnnotationFieldValue[]): TableAnnotationFieldValue[] {
  const next = [...values];
  while (next.length > 0 && next[next.length - 1] === "") {
    next.pop();
  }
  return next;
}

function tableFieldValuesToTextState(
  values: TableAnnotationFieldValues | undefined,
  activeFields: TableFieldDefinition[],
): TableAnnotationTextState {
  const out: TableAnnotationTextState = {};
  for (const field of activeFields) {
    const series = values?.[field.id] || [];
    out[field.id] = series.map((value) => (value === "" ? "" : String(value))).join("\n");
  }
  return out;
}

function sanitizeTableFieldTexts(
  current: TableAnnotationTextState,
  activeFields: TableFieldDefinition[],
): TableAnnotationTextState {
  const out: TableAnnotationTextState = {};
  for (const field of activeFields) {
    out[field.id] = current[field.id] ?? "";
  }
  return out;
}

function parseTableFieldTexts(
  texts: TableAnnotationTextState,
  activeFields: TableFieldDefinition[],
): TableAnnotationFieldValues | undefined {
  const out: TableAnnotationFieldValues = {};
  for (const field of activeFields) {
    const lines = trimTrailingEmptyEntries(
      (texts[field.id] || "")
        .replace(/\r/g, "")
        .split("\n")
        .map((line) => {
          const trimmed = line.trim();
          if (!trimmed) {
            return "";
          }
          if (field.type === "number") {
            const parsed = Number(trimmed);
            return Number.isFinite(parsed) ? parsed : trimmed;
          }
          return trimmed;
        }),
    );
    if (lines.length > 0) {
      out[field.id] = lines;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function seedToTableFieldTexts(seed: AnnotationWorkbenchSeed, activeFields: TableFieldDefinition[]): TableAnnotationTextState {
  const out: TableAnnotationTextState = {};
  for (const field of activeFields) {
    const value = isBuiltInFieldId(field.id) ? seed[field.id] : seed.customFieldValues?.[field.id];
    out[field.id] = value === "" || value === undefined || value === null ? "" : String(value);
  }
  return out;
}

function buildSeedFromTableFieldValues(
  values: TableAnnotationFieldValues | undefined,
  activeFields: TableFieldDefinition[],
): AnnotationWorkbenchSeed {
  const firstValue = (fieldId: string) => values?.[fieldId]?.[0] ?? "";
  const customFieldValues: Record<string, string | number | ""> = {};

  for (const field of activeFields) {
    if (isBuiltInFieldId(field.id)) {
      continue;
    }
    const value = firstValue(field.id);
    if (value !== "") {
      customFieldValues[field.id] = value;
    }
  }

  return {
    date: String(firstValue("date") || ""),
    route: String(firstValue("route") || ""),
    driver: String(firstValue("driver") || ""),
    taskCode: String(firstValue("taskCode") || ""),
    total: typeof firstValue("total") === "number" ? (firstValue("total") as number) : "",
    unscanned: typeof firstValue("unscanned") === "number" ? (firstValue("unscanned") as number) : "",
    exceptions: typeof firstValue("exceptions") === "number" ? (firstValue("exceptions") as number) : "",
    waybillStatus: String(firstValue("waybillStatus") || ""),
    stationTeam: String(firstValue("stationTeam") || ""),
    customFieldValues,
  };
}

function buildTableFieldTextStateFromSeed(
  seed: AnnotationWorkbenchSeed,
  values: TableAnnotationFieldValues | undefined,
  activeFields: TableFieldDefinition[],
): TableAnnotationTextState {
  if (values) {
    return sanitizeTableFieldTexts(tableFieldValuesToTextState(values, activeFields), activeFields);
  }
  return sanitizeTableFieldTexts(seedToTableFieldTexts(seed, activeFields), activeFields);
}

export type TrainingAnnotationWorkbenchProps = {
  open: boolean;
  imageName: string;
  imageSrc: string;
  apiPathBuilder?: (path: string) => string;
  fieldDefinitions?: TableFieldDefinition[];
  initialSeed: AnnotationWorkbenchSeed;
  initialAnnotationMode?: AnnotationMode;
  initialTableFieldValues?: TableAnnotationFieldValues;
  initialBoxes?: WorkbenchAnnotationBox[];
  initialFieldAggregations?: Partial<Record<AnnotationField, FieldAggregation>>;
  initialNotes?: string;
  initialField?: AnnotationField;
  onClose: () => void;
  onSaved?: (result: {
    totalExamples?: number;
    finalSeed: AnnotationWorkbenchSeed;
    annotationMode: AnnotationMode;
    tableFieldValues?: TableAnnotationFieldValues;
  }) => void | Promise<void>;
  onNotice?: (message: string) => void;
  onError?: (message: string) => void;
};

export function TrainingAnnotationWorkbench({
  open,
  imageName,
  imageSrc,
  apiPathBuilder,
  fieldDefinitions,
  initialSeed,
  initialAnnotationMode = "record",
  initialTableFieldValues,
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
  const [annotationMode, setAnnotationMode] = useState<AnnotationMode>(initialAnnotationMode);
  const [tableFieldTexts, setTableFieldTexts] = useState<TableAnnotationTextState>(() =>
    buildTableFieldTextStateFromSeed(initialSeed, initialTableFieldValues, activeFieldDefinitions),
  );
  const [annotationBoxes, setAnnotationBoxes] = useState<WorkbenchAnnotationBox[]>(() => sanitizeAnnotationBoxes(initialBoxes, activeFieldIdSet));
  const [fieldAggregations, setFieldAggregations] = useState<Partial<Record<AnnotationField, FieldAggregation>>>(() =>
    sanitizeFieldAggregations(initialFieldAggregations, activeFieldIdSet),
  );
  const [annotationField, setAnnotationField] = useState<AnnotationField>(defaultFieldId);
  const [resolvedImageSrc, setResolvedImageSrc] = useState("");
  const [annotationNotes, setAnnotationNotes] = useState(initialNotes ?? "人工标注用于训练池。");
  const [drawingState, setDrawingState] = useState<DrawingState | null>(null);
  const [isSavingTraining, setIsSavingTraining] = useState(false);
  const [isPreviewFillLoading, setIsPreviewFillLoading] = useState(false);
  const [annotationZoom, setAnnotationZoom] = useState(100);
  const [annotationInteractionMode, setAnnotationInteractionMode] = useState<"draw" | "pan">("draw");
  const [isPanningViewport, setIsPanningViewport] = useState(false);
  const [imageNaturalSize, setImageNaturalSize] = useState({ width: 0, height: 0 });
  const [imageViewportSize, setImageViewportSize] = useState({ width: 0, height: 0 });
  const [undoStack, setUndoStack] = useState<WorkbenchAnnotationBox[][]>([]);
  const [layoutTick, setLayoutTick] = useState(0);
  const bumpLayout = useCallback(() => setLayoutTick((t) => t + 1), []);
  const visibleAnnotationBoxes = useMemo(
    () => annotationBoxes.filter((box) => activeFieldIdSet.has(box.field)),
    [activeFieldIdSet, annotationBoxes],
  );
  const parsedTableFieldValues = useMemo(
    () => parseTableFieldTexts(tableFieldTexts, activeFieldDefinitions),
    [tableFieldTexts, activeFieldDefinitions],
  );
  const renderedImageSize = useMemo(() => {
    if (!imageNaturalSize.width || !imageNaturalSize.height || !imageViewportSize.width || !imageViewportSize.height) {
      return null;
    }
    const fitScale = Math.min(
      imageViewportSize.width / imageNaturalSize.width,
      imageViewportSize.height / imageNaturalSize.height,
    );
    const scale = fitScale * (annotationZoom / 100);
    return {
      width: Math.max(1, Math.round(imageNaturalSize.width * scale)),
      height: Math.max(1, Math.round(imageNaturalSize.height * scale)),
    };
  }, [annotationZoom, imageNaturalSize, imageViewportSize]);
  const tableModeSeed = useMemo(
    () => buildSeedFromTableFieldValues(parsedTableFieldValues, activeFieldDefinitions),
    [parsedTableFieldValues, activeFieldDefinitions],
  );
  const canUndoAnnotationBoxes = undoStack.length > 0;
  const buildApiPath = useCallback((path: string) => (apiPathBuilder ? apiPathBuilder(path) : path), [apiPathBuilder]);

  const annotationCanvasRef = useRef<HTMLDivElement | null>(null);
  const annotationViewportRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const seedJsonRef = useRef<string>("");
  const viewportPanStateRef = useRef<ViewportPanState | null>(null);

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
    return { cw, ch, nw, nh, dispW: cw, dispH: ch, offX: 0, offY: 0 };
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
    const el = annotationViewportRef.current;
    if (!el) {
      return;
    }
    const updateViewportSize = () => {
      const next = {
        width: Math.max(0, el.clientWidth - 24),
        height: Math.max(0, el.clientHeight - 24),
      };
      setImageViewportSize((current) =>
        current.width === next.width && current.height === next.height ? current : next,
      );
      bumpLayout();
    };
    updateViewportSize();
    const ro = new ResizeObserver(updateViewportSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, bumpLayout]);

  useEffect(() => {
    if (!open || !imageSrc) {
      setResolvedImageSrc("");
      setImageNaturalSize({ width: 0, height: 0 });
      return;
    }

    let cancelled = false;
    setResolvedImageSrc("");
    setImageNaturalSize({ width: 0, height: 0 });

    void (async () => {
      try {
        const nextImageSrc = await ensureImageDataUrlFromSource(imageSrc);
        if (!cancelled) {
          setResolvedImageSrc(nextImageSrc);
        }
      } catch {
        if (!cancelled) {
          setResolvedImageSrc("");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, imageSrc]);

  useEffect(() => {
    if (!open) {
      seedJsonRef.current = "";
      return;
    }
    const next = JSON.stringify({
      initialSeed,
      initialAnnotationMode,
      initialTableFieldValues,
      initialBoxes,
      initialFieldAggregations,
      initialNotes: initialNotes ?? "人工标注用于训练池。",
    });
    if (next === seedJsonRef.current) {
      return;
    }
    seedJsonRef.current = next;
    setManualRecord(sanitizeManualRecord(initialSeed, activeFieldDefinitions));
    setAnnotationMode(initialAnnotationMode);
    setTableFieldTexts(buildTableFieldTextStateFromSeed(initialSeed, initialTableFieldValues, activeFieldDefinitions));
    setAnnotationBoxes(sanitizeAnnotationBoxes(initialBoxes, activeFieldIdSet));
    setFieldAggregations(sanitizeFieldAggregations(initialFieldAggregations, activeFieldIdSet));
    setAnnotationNotes(initialNotes ?? "人工标注用于训练池。");
    setAnnotationField(pickAnnotationField(initialField, activeFieldDefinitions));
    setUndoStack([]);
    setAnnotationZoom(100);
    setAnnotationInteractionMode("draw");
    setIsPanningViewport(false);
    viewportPanStateRef.current = null;
    setDrawingState(null);
  }, [open, initialSeed, initialAnnotationMode, initialTableFieldValues, initialBoxes, initialFieldAggregations, initialNotes, initialField, activeFieldDefinitions, activeFieldIdSet]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setManualRecord((current) => sanitizeManualRecord(current, activeFieldDefinitions));
    setTableFieldTexts((current) => sanitizeTableFieldTexts(current, activeFieldDefinitions));
    setAnnotationBoxes((current) => sanitizeAnnotationBoxes(current, activeFieldIdSet));
    setFieldAggregations((current) => sanitizeFieldAggregations(current, activeFieldIdSet));
    setAnnotationField((current) => pickAnnotationField(current, activeFieldDefinitions));
  }, [open, activeFieldDefinitions, activeFieldIdSet]);

  const handleClose = useCallback(() => {
    setDrawingState(null);
    setIsPanningViewport(false);
    viewportPanStateRef.current = null;
    onClose();
  }, [onClose]);

  const endViewportPan = useCallback(() => {
    viewportPanStateRef.current = null;
    setIsPanningViewport(false);
  }, []);

  const startViewportPan = useCallback((clientX: number, clientY: number) => {
    const viewport = annotationViewportRef.current;
    if (!viewport) {
      return;
    }
    viewportPanStateRef.current = {
      startX: clientX,
      startY: clientY,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
    };
    setIsPanningViewport(true);
  }, []);

  function applyAnnotationBoxesChange(updater: (current: WorkbenchAnnotationBox[]) => WorkbenchAnnotationBox[]) {
    setAnnotationBoxes((current) => {
      const next = updater(current);
      const sameLength = next.length === current.length;
      const sameValues =
        sameLength &&
        next.every((box, index) => {
          const prev = current[index];
          return (
            prev &&
            prev.id === box.id &&
            prev.field === box.field &&
            prev.value === box.value &&
            prev.x === box.x &&
            prev.y === box.y &&
            prev.width === box.width &&
            prev.height === box.height &&
            prev.coordSpace === box.coordSpace
          );
        });
      if (sameValues) {
        return current;
      }
      setUndoStack((stack) => [...stack.slice(-29), cloneAnnotationBoxes(current)]);
      return next;
    });
  }

  const undoLastAnnotationBoxChange = useCallback(() => {
    setUndoStack((stack) => {
      const previous = stack[stack.length - 1];
      if (!previous) {
        return stack;
      }
      setAnnotationBoxes(cloneAnnotationBoxes(previous));
      return stack.slice(0, -1);
    });
    setDrawingState(null);
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "z") {
        if (!isEditableTarget(event.target)) {
          event.preventDefault();
          undoLastAnnotationBoxChange();
        }
        return;
      }
      if (event.key === "Escape") {
        handleClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, handleClose, undoLastAnnotationBoxChange]);

  useEffect(() => {
    if (!open || !isPanningViewport) {
      return;
    }
    function updateViewportPan(clientX: number, clientY: number) {
      const viewport = annotationViewportRef.current;
      const panState = viewportPanStateRef.current;
      if (!viewport || !panState) {
        return;
      }
      viewport.scrollLeft = panState.scrollLeft - (clientX - panState.startX);
      viewport.scrollTop = panState.scrollTop - (clientY - panState.startY);
    }
    function handleMouseMove(event: MouseEvent) {
      updateViewportPan(event.clientX, event.clientY);
    }
    function handleTouchMove(event: TouchEvent) {
      const touch = event.touches[0];
      if (!touch) {
        return;
      }
      event.preventDefault();
      updateViewportPan(touch.clientX, touch.clientY);
    }
    function handlePanEnd() {
      endViewportPan();
    }
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handlePanEnd);
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", handlePanEnd);
    window.addEventListener("touchcancel", handlePanEnd);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handlePanEnd);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handlePanEnd);
      window.removeEventListener("touchcancel", handlePanEnd);
    };
  }, [endViewportPan, isPanningViewport, open]);

  function getAnnotationFieldValue(field: AnnotationField) {
    if (annotationMode === "table") {
      const value = parsedTableFieldValues?.[field]?.[0];
      return value === null || value === undefined || value === "" ? "" : String(value);
    }
    const value = isBuiltInFieldId(field)
      ? manualRecord[field]
      : manualRecord.customFieldValues?.[field];
    return value === null || value === undefined || value === "" ? "" : String(value);
  }

  function setAnnotationFieldValue(field: TableFieldDefinition, rawValue: string) {
    if (annotationMode === "table") {
      setTableFieldTexts((current) => ({
        ...current,
        [field.id]: rawValue,
      }));
      return;
    }
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
    if (event.button !== 0) {
      return;
    }
    if (annotationInteractionMode === "pan") {
      event.preventDefault();
      startViewportPan(event.clientX, event.clientY);
      return;
    }
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
    if (annotationInteractionMode === "pan" || !drawingState) {
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
    if (annotationInteractionMode === "pan") {
      const touch = event.touches[0];
      event.preventDefault();
      startViewportPan(touch.clientX, touch.clientY);
      return;
    }
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
    if (annotationInteractionMode === "pan" || !drawingState || event.touches.length !== 1) return;
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
    if (annotationInteractionMode === "pan") {
      event.preventDefault();
      endViewportPan();
      return;
    }
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

    applyAnnotationBoxesChange((current) => [...current, nextBox]);
  }

  function removeAnnotationBoxById(boxId: string) {
    applyAnnotationBoxesChange((current) => current.filter((box) => box.id !== boxId));
  }

  function clearAnnotationFieldBoxes(field: AnnotationField) {
    applyAnnotationBoxesChange((current) => current.filter((box) => box.field !== field));
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

  function switchAnnotationMode(nextMode: AnnotationMode) {
    if (nextMode === annotationMode) {
      return;
    }

    if (nextMode === "table") {
      if (!parsedTableFieldValues || Object.keys(parsedTableFieldValues).length === 0) {
        setTableFieldTexts(buildTableFieldTextStateFromSeed(manualToFinalSeed(manualRecord), undefined, activeFieldDefinitions));
      }
      setAnnotationMode("table");
      return;
    }

    setManualRecord(sanitizeManualRecord(buildSeedFromTableFieldValues(parsedTableFieldValues, activeFieldDefinitions), activeFieldDefinitions));
    setAnnotationMode("record");
  }

  async function previewFillFromAnnotations() {
    if (!open || !resolvedImageSrc || !visibleAnnotationBoxes.length) {
      onError?.("\u8bf7\u5148\u5b8c\u6210\u6846\u9009\u5e76\u786e\u4fdd\u56fe\u7247\u5df2\u52a0\u8f7d\u3002");
      return;
    }
    setIsPreviewFillLoading(true);
    try {
      const imageDataUrl = await imageSourceToDataUrl(resolvedImageSrc);
      const res = await fetch(buildApiPath("/api/training/preview-fill"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageDataUrl,
          annotationMode: "auto",
          boxes: boxesForVisionApi(visibleAnnotationBoxes),
          fieldAggregations: sanitizeFieldAggregations(fieldAggregations, activeFieldIdSet),
          tableFields: activeFieldDefinitions,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        record?: Record<string, string | number | "">;
        tableFieldValues?: TableAnnotationFieldValues;
        previewNote?: string;
        detectedMode?: AnnotationMode;
        detectedModeReason?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || "\u8bd5\u586b\u5931\u8d25");
      }

      const resolvedMode: AnnotationMode = data.detectedMode === "table" ? "table" : "record";
      const resolvedModeLabel = resolvedMode === "table" ? "完整表格" : "单条记录";
      const resolvedModeReason = data.detectedModeReason?.trim();

      if (resolvedMode === "table") {
        if (!data.tableFieldValues) {
          throw new Error("\u672a\u8fd4\u56de\u5b8c\u6574\u8868\u683c\u8bd5\u586b\u7ed3\u679c");
        }
        setAnnotationMode("table");
        setTableFieldTexts(
          sanitizeTableFieldTexts(tableFieldValuesToTextState(data.tableFieldValues, activeFieldDefinitions), activeFieldDefinitions),
        );
        setManualRecord(
          sanitizeManualRecord(buildSeedFromTableFieldValues(data.tableFieldValues, activeFieldDefinitions), activeFieldDefinitions),
        );
        onNotice?.(
          data.previewNote
            ? `AI \u8bd5\u586b\u5b8c\u6210\uff0c\u5df2\u81ea\u52a8\u5207\u6362\u5230${resolvedModeLabel}\u6a21\u5f0f\u3002${resolvedModeReason ? ` \u5224\u65ad\u4f9d\u636e\uff1a${resolvedModeReason}\u3002` : ""} \u8bf4\u660e\uff1a${data.previewNote} \u8bf7\u6838\u5bf9\u540e\u518d\u5b58\u5165\u8bad\u7ec3\u6c60\u3002`
            : `AI \u8bd5\u586b\u5b8c\u6210\uff0c\u5df2\u81ea\u52a8\u5207\u6362\u5230${resolvedModeLabel}\u6a21\u5f0f\u3002${resolvedModeReason ? ` \u5224\u65ad\u4f9d\u636e\uff1a${resolvedModeReason}\u3002` : ""} \u670d\u52a1\u7aef\u5df2\u6309\u6bcf\u4e2a\u6846\u88c1\u526a\u6210\u5c0f\u56fe\u5e76\u6309\u884c\u8bfb\u53d6\uff0c\u8bf7\u6838\u5bf9\u53f3\u4fa7\u5b8c\u6574\u8868\u683c\u6570\u503c\u3002`,
        );
        return;
      }

      if (!data.record) {
        throw new Error("\u672a\u8fd4\u56de\u8bd5\u586b\u7ed3\u679c");
      }
      setAnnotationMode("record");
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
        if (boxed.has("date")) next.date = strFromModel(r.date);
        if (boxed.has("route")) next.route = strFromModel(r.route);
        if (boxed.has("driver")) next.driver = strFromModel(r.driver);
        if (boxed.has("taskCode")) next.taskCode = strFromModel(r.taskCode);
        if (boxed.has("waybillStatus")) next.waybillStatus = strFromModel(r.waybillStatus);
        if (boxed.has("stationTeam")) next.stationTeam = strFromModel(r.stationTeam);
        if (boxed.has("total")) {
          next.total = numOrEmpty(r.total);
          if (typeof r.totalSourceLabel === "string") {
            next.totalSourceLabel = r.totalSourceLabel;
          }
        }
        if (boxed.has("unscanned")) next.unscanned = numOrEmpty(r.unscanned);
        if (boxed.has("exceptions")) next.exceptions = numOrEmpty(r.exceptions);
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
          ? `AI \u8bd5\u586b\u5b8c\u6210\uff0c\u5df2\u81ea\u52a8\u5207\u6362\u5230${resolvedModeLabel}\u6a21\u5f0f\u3002${resolvedModeReason ? ` \u5224\u65ad\u4f9d\u636e\uff1a${resolvedModeReason}\u3002` : ""} \u8bf4\u660e\uff1a${data.previewNote} \u8bf7\u6838\u5bf9\u540e\u518d\u5b58\u5165\u8bad\u7ec3\u6c60\u3002`
          : `AI \u8bd5\u586b\u5b8c\u6210\uff0c\u5df2\u81ea\u52a8\u5207\u6362\u5230${resolvedModeLabel}\u6a21\u5f0f\u3002${resolvedModeReason ? ` \u5224\u65ad\u4f9d\u636e\uff1a${resolvedModeReason}\u3002` : ""} \u670d\u52a1\u7aef\u5df2\u6309\u6bcf\u4e2a\u6846\u88c1\u526a\u6210\u5c0f\u56fe\u540e\u9001\u6a21\u578b\u8bc6\u522b\uff0c\u8bf7\u6838\u5bf9\u53f3\u4fa7\u6570\u503c\u3002`,
      );
    } catch (err) {
      onError?.(err instanceof Error ? err.message : "\u8bd5\u586b\u5931\u8d25");
    } finally {
      setIsPreviewFillLoading(false);
    }
  }

  async function saveAnnotationToTrainingPool() {
    if (!open || !imageName || !resolvedImageSrc) {
      onError?.("\u5f53\u524d\u6ca1\u6709\u53ef\u4fdd\u5b58\u7684\u6807\u6ce8\u3002");
      return;
    }

    if (!visibleAnnotationBoxes.length) {
      onError?.("\u8bf7\u81f3\u5c11\u6807\u6ce8\u4e00\u4e2a\u5b57\u6bb5\u6846\u540e\u518d\u4fdd\u5b58\u3002");
      return;
    }

    setIsSavingTraining(true);

    try {
      const tableFieldValues = annotationMode === "table" ? parsedTableFieldValues : undefined;
      const finalSeed = annotationMode === "table" ? tableModeSeed : manualToFinalSeed(manualRecord);
      const imageDataUrl = await imageSourceToDataUrl(resolvedImageSrc);
      const response = await fetch(buildApiPath("/api/training/save"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          imageName,
          imageDataUrl,
          notes: annotationNotes,
          annotationMode,
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
          tableOutput: annotationMode === "table" ? { fieldValues: tableFieldValues || {} } : undefined,
          boxes: visibleAnnotationBoxes,
          fieldAggregations: sanitizeFieldAggregations(fieldAggregations, activeFieldIdSet),
        }),
      });

      const payload = (await response.json()) as { error?: string; totalExamples?: number };
      if (!response.ok) {
        throw new Error(payload.error || "\u4fdd\u5b58\u8bad\u7ec3\u6837\u672c\u5931\u8d25\u3002");
      }

      await Promise.resolve(
        onSaved?.({
          totalExamples: payload.totalExamples,
          finalSeed,
          annotationMode,
          tableFieldValues,
        }),
      );
      handleClose();
    } catch (error) {
      onError?.(error instanceof Error ? error.message : "\u4fdd\u5b58\u8bad\u7ec3\u6837\u672c\u5931\u8d25\u3002");
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
      <div className="my-auto flex max-h-[95vh] w-full max-w-[min(96vw,1720px)] flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white p-5 shadow-2xl">
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

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto pr-1 lg:grid-cols-[minmax(0,1.4fr)_min(100%,440px)]">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-slate-700">标注图片：{imageName}</div>
                <div className="mt-1 text-xs text-slate-500">保存后，模型参考时会直接看到带框的人工标注图。</div>
                <div className="mt-1 text-xs text-slate-500">默认会尽量完整显示整张图；放大后可切换到拖动画面，再拖拽查看局部。</div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-lg border border-slate-300 bg-white p-1">
                  <button
                    type="button"
                    className={`rounded-md px-2.5 py-1.5 text-xs font-medium ${
                      annotationInteractionMode === "draw" ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"
                    }`}
                    onClick={() => {
                      endViewportPan();
                      setAnnotationInteractionMode("draw");
                    }}
                  >
                    画框
                  </button>
                  <button
                    type="button"
                    className={`rounded-md px-2.5 py-1.5 text-xs font-medium ${
                      annotationInteractionMode === "pan" ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"
                    }`}
                    onClick={() => setAnnotationInteractionMode("pan")}
                  >
                    拖动画面
                  </button>
                </div>
                <button
                  type="button"
                  className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={undoLastAnnotationBoxChange}
                  disabled={!canUndoAnnotationBoxes}
                >
                  撤回 Ctrl+Z
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => setAnnotationZoom((current) => Math.max(50, current - 25))}
                  disabled={annotationZoom <= 50}
                >
                  缩小
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-white"
                  onClick={() => {
                    endViewportPan();
                    setAnnotationZoom(100);
                  }}
                >
                  {annotationZoom}%
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => setAnnotationZoom((current) => Math.min(300, current + 25))}
                  disabled={annotationZoom >= 300}
                >
                  放大
                </button>
              </div>
            </div>
            <div ref={annotationViewportRef} className="min-h-[min(68vh,760px)] max-h-[76vh] overflow-auto rounded-xl bg-black/5 p-3">
              <div className={`min-h-full min-w-full ${annotationZoom <= 100 ? "flex items-center justify-center" : "block"}`}>
              <div
                ref={annotationCanvasRef}
                className={`relative select-none [touch-action:none] ${
                  annotationInteractionMode === "pan"
                    ? isPanningViewport
                      ? "cursor-grabbing"
                      : "cursor-grab"
                    : "cursor-crosshair"
                }`}
                style={
                  renderedImageSize
                    ? { width: `${renderedImageSize.width}px`, height: `${renderedImageSize.height}px` }
                    : { width: "100%" }
                }
                data-layout-tick={layoutTick}
                onMouseDown={beginDrawing}
                onMouseMove={updateDrawing}
                onMouseUp={() => finishDrawing()}
                onMouseLeave={() => finishDrawing()}
                onTouchStart={beginDrawingTouch}
                onTouchMove={updateDrawingTouch}
                onTouchEnd={finishDrawingTouch}
                onTouchCancel={() => {
                  setDrawingState(null);
                  endViewportPan();
                }}
              >
              {resolvedImageSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  ref={imageRef}
                  src={resolvedImageSrc}
                  alt={imageName}
                  draggable={false}
                  onLoad={(event) => {
                    setImageNaturalSize({
                      width: event.currentTarget.naturalWidth,
                      height: event.currentTarget.naturalHeight,
                    });
                    bumpLayout();
                  }}
                  className={`pointer-events-none block object-contain ${
                    renderedImageSize ? "h-full w-full" : "h-auto w-full"
                  }`}
                />
              ) : (
                <div className="flex min-h-[200px] items-center justify-center text-sm text-slate-400">加载图片中…</div>
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
            </div>
          </div>

          <div className="flex min-h-0 flex-col gap-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-slate-700">{"填写正确数值"}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {annotationMode === "table"
                      ? `完整表格模式：每个字段按行填写，每行对应表格里的一条记录。当前约 ${Math.max(
                          1,
                          ...Object.values(parsedTableFieldValues || {}).map((series) => series.length),
                        )} 行。`
                      : "单条记录模式：每个字段填写一个最终值。"}
                  </div>
                </div>
                <div className="inline-flex rounded-xl border border-slate-300 bg-white p-1 text-xs">
                  <button
                    type="button"
                    className={`rounded-lg px-3 py-1.5 font-medium ${
                      annotationMode === "record" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                    }`}
                    onClick={() => switchAnnotationMode("record")}
                  >
                    {"单条记录"}
                  </button>
                  <button
                    type="button"
                    className={`rounded-lg px-3 py-1.5 font-medium ${
                      annotationMode === "table" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                    }`}
                    onClick={() => switchAnnotationMode("table")}
                  >
                    {"完整表格"}
                  </button>
                </div>
              </div>

              {annotationMode === "table" ? (
                <div className="space-y-3">
                  {activeFieldDefinitions.map((field) => (
                    <div key={field.id}>
                      <div className="mb-1 flex items-center justify-between gap-2 text-xs text-slate-500">
                        <label>{field.label}</label>
                        <span>{(parsedTableFieldValues?.[field.id]?.length ?? 0) || 0} 行</span>
                      </div>
                      <textarea
                        className="min-h-[88px] w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                        value={tableFieldTexts[field.id] ?? ""}
                        onChange={(e) => setAnnotationFieldValue(field, e.target.value)}
                        placeholder={`每行一个${field.label}，按表格从上到下顺序填写`}
                      />
                    </div>
                  ))}
                </div>
              ) : (
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
              )}
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
                disabled={isPreviewFillLoading || isSavingTraining || !resolvedImageSrc || visibleAnnotationBoxes.length === 0}
              >
                {isPreviewFillLoading ? "试填识别中…" : "AI 试填预览（自动判断单条/完整表格）"}
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
