"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { PodRecord } from "@/lib/pod";

/** 训练标注字段 key，与训练池 boxes 一致 */
export type AnnotationField =
  | "date"
  | "route"
  | "driver"
  | "total"
  | "unscanned"
  | "exceptions"
  | "waybillStatus"
  | "stationTeam";

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
};

export type AnnotationWorkbenchSeed = Pick<
  PodRecord,
  "date" | "route" | "driver" | "total" | "unscanned" | "exceptions" | "waybillStatus" | "stationTeam" | "totalSourceLabel"
>;

type ManualRecordState = Partial<PodRecord> & { stationTeam?: string; totalSourceLabel?: string };

type DrawingState = {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
};

const annotationFields: Array<{ key: AnnotationField; label: string }> = [
  { key: "date", label: "日期" },
  { key: "route", label: "抽查路线" },
  { key: "driver", label: "抽查司机" },
  { key: "total", label: "运单数量" },
  { key: "unscanned", label: "未收数量" },
  { key: "exceptions", label: "错扫数量" },
  { key: "waybillStatus", label: "响应更新状态" },
  { key: "stationTeam", label: "站点车队" },
];

function defaultAggregationForField(field: AnnotationField): FieldAggregation {
  return field === "total" || field === "unscanned" || field === "exceptions" ? "sum" : "join_comma";
}

function effectiveFieldAggregation(
  field: AnnotationField,
  aggs: Partial<Record<AnnotationField, FieldAggregation>>,
): FieldAggregation {
  return aggs[field] ?? defaultAggregationForField(field);
}

function seedToManual(seed: AnnotationWorkbenchSeed): ManualRecordState {
  return {
    date: seed.date ?? "",
    route: seed.route ?? "",
    driver: seed.driver ?? "",
    total: seed.total ?? "",
    unscanned: seed.unscanned ?? "",
    exceptions: seed.exceptions ?? "",
    waybillStatus: seed.waybillStatus ?? "",
    stationTeam: seed.stationTeam ?? "",
    totalSourceLabel: seed.totalSourceLabel ?? "",
  };
}

function ensureBoxIds(boxes: WorkbenchAnnotationBox[]): WorkbenchAnnotationBox[] {
  return boxes.map((b) => ({
    ...b,
    id: typeof b.id === "string" && b.id ? b.id : crypto.randomUUID(),
  }));
}

export type TrainingAnnotationWorkbenchProps = {
  open: boolean;
  imageName: string;
  imageSrc: string;
  initialSeed: AnnotationWorkbenchSeed;
  initialBoxes?: WorkbenchAnnotationBox[];
  initialFieldAggregations?: Partial<Record<AnnotationField, FieldAggregation>>;
  initialNotes?: string;
  onClose: () => void;
  onSaved?: (result: { totalExamples?: number; finalSeed: AnnotationWorkbenchSeed }) => void | Promise<void>;
  onNotice?: (message: string) => void;
  onError?: (message: string) => void;
};

export function TrainingAnnotationWorkbench({
  open,
  imageName,
  imageSrc,
  initialSeed,
  initialBoxes = [],
  initialFieldAggregations = {},
  initialNotes,
  onClose,
  onSaved,
  onNotice,
  onError,
}: TrainingAnnotationWorkbenchProps) {
  const [manualRecord, setManualRecord] = useState<ManualRecordState>(() => seedToManual(initialSeed));
  const [annotationBoxes, setAnnotationBoxes] = useState<WorkbenchAnnotationBox[]>(() => ensureBoxIds(initialBoxes));
  const [fieldAggregations, setFieldAggregations] =
    useState<Partial<Record<AnnotationField, FieldAggregation>>>(initialFieldAggregations);
  const [annotationField, setAnnotationField] = useState<AnnotationField>("driver");
  const [annotationNotes, setAnnotationNotes] = useState(initialNotes ?? "人工标注用于训练池。");
  const [drawingState, setDrawingState] = useState<DrawingState | null>(null);
  const [isSavingTraining, setIsSavingTraining] = useState(false);
  const [isPreviewFillLoading, setIsPreviewFillLoading] = useState(false);

  const annotationCanvasRef = useRef<HTMLDivElement | null>(null);
  const seedJsonRef = useRef<string>("");

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
    setManualRecord(seedToManual(initialSeed));
    setAnnotationBoxes(ensureBoxIds(initialBoxes));
    setFieldAggregations(initialFieldAggregations);
    setAnnotationNotes(initialNotes ?? "人工标注用于训练池。");
    setAnnotationField("driver");
    setDrawingState(null);
  }, [open, initialSeed, initialBoxes, initialFieldAggregations, initialNotes]);

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
    const value = manualRecord[field as keyof ManualRecordState];
    return value === null || value === undefined || value === "" ? "" : String(value);
  }

  function getRelativePointFromClient(clientX: number, clientY: number) {
    const rect = annotationCanvasRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;

    return {
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y)),
    };
  }

  function beginDrawing(event: React.MouseEvent<HTMLDivElement>) {
    const point = getRelativePointFromClient(event.clientX, event.clientY);
    if (!point) {
      return;
    }

    setDrawingState({
      startX: point.x,
      startY: point.y,
      currentX: point.x,
      currentY: point.y,
    });
  }

  function updateDrawing(event: React.MouseEvent<HTMLDivElement>) {
    if (!drawingState) {
      return;
    }

    const point = getRelativePointFromClient(event.clientX, event.clientY);
    if (!point) {
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
    const point = getRelativePointFromClient(t.clientX, t.clientY);
    if (!point) return;
    event.preventDefault();
    setDrawingState({
      startX: point.x,
      startY: point.y,
      currentX: point.x,
      currentY: point.y,
    });
  }

  function updateDrawingTouch(event: React.TouchEvent<HTMLDivElement>) {
    if (!drawingState || event.touches.length !== 1) return;
    const t = event.touches[0];
    const point = getRelativePointFromClient(t.clientX, t.clientY);
    if (!point) return;
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
    if (t) {
      const point = getRelativePointFromClient(t.clientX, t.clientY);
      if (point) {
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
    return {
      date: m.date ?? "",
      route: m.route ?? "",
      driver: m.driver ?? "",
      total: numOrEmpty(m.total),
      unscanned: numOrEmpty(m.unscanned),
      exceptions: numOrEmpty(m.exceptions),
      waybillStatus: m.waybillStatus ?? "",
      stationTeam: m.stationTeam ?? "",
      totalSourceLabel: m.totalSourceLabel ?? "",
    };
  }

  async function previewFillFromAnnotations() {
    if (!open || !imageSrc || !annotationBoxes.length) {
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
          boxes: annotationBoxes,
          fieldAggregations,
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
      setManualRecord((prev) => ({
        ...prev,
        ...(typeof r.date === "string" ? { date: r.date } : {}),
        ...(typeof r.route === "string" ? { route: r.route } : {}),
        ...(typeof r.driver === "string" ? { driver: r.driver } : {}),
        ...(typeof r.totalSourceLabel === "string" ? { totalSourceLabel: r.totalSourceLabel } : {}),
        ...(typeof r.waybillStatus === "string" ? { waybillStatus: r.waybillStatus } : {}),
        ...(typeof r.stationTeam === "string" ? { stationTeam: r.stationTeam } : {}),
        ...(r.total !== undefined ? { total: numOrEmpty(r.total) } : {}),
        ...(r.unscanned !== undefined ? { unscanned: numOrEmpty(r.unscanned) } : {}),
        ...(r.exceptions !== undefined ? { exceptions: numOrEmpty(r.exceptions) } : {}),
      }));
      onNotice?.(
        data.previewNote
          ? `AI 试填完成。说明：${data.previewNote} 请核对后再存入训练池。`
          : "AI 试填完成，请核对右侧数值；可多框相加等规则已按你的合并方式参与识别。",
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

    if (!annotationBoxes.length) {
      onError?.("请至少标注一个字段框后再保存。");
      return;
    }

    setIsSavingTraining(true);

    try {
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
            date: manualRecord.date || "",
            route: manualRecord.route || "",
            driver: manualRecord.driver || "",
            total: Number(manualRecord.total) || 0,
            totalSourceLabel: manualRecord.totalSourceLabel || "",
            unscanned: Number(manualRecord.unscanned) || 0,
            exceptions: Number(manualRecord.exceptions) || 0,
            waybillStatus: manualRecord.waybillStatus || "",
            stationTeam: manualRecord.stationTeam || "",
          },
          boxes: annotationBoxes,
          fieldAggregations,
        }),
      });

      const payload = (await response.json()) as { error?: string; totalExamples?: number };
      if (!response.ok) {
        throw new Error(payload.error || "保存训练样本失败。");
      }

      const finalSeed = manualToFinalSeed(manualRecord);
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
      <div className="my-auto w-full max-w-6xl rounded-3xl border border-slate-200 bg-white p-5 shadow-2xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
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
            </ol>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50"
            onClick={handleClose}
          >
            关闭（Esc）
          </button>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_min(100%,380px)]">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <div className="mb-3 text-sm font-medium text-slate-700">标注图片：{imageName}</div>
            <div
              ref={annotationCanvasRef}
              className="relative min-h-[min(55vh,520px)] cursor-crosshair select-none overflow-hidden rounded-xl bg-black/5 [touch-action:none]"
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
                  src={imageSrc}
                  alt={imageName}
                  draggable={false}
                  className="pointer-events-none h-full w-full object-contain"
                />
              ) : (
                <div className="flex h-full min-h-[200px] items-center justify-center text-sm text-slate-400">加载图片中…</div>
              )}
              {annotationBoxes.map((box) => {
                const sameField = annotationBoxes.filter((b) => b.field === box.field);
                const idx = sameField.findIndex((b) => b.id === box.id) + 1;
                const baseLabel = annotationFields.find((f) => f.key === box.field)?.label || box.field;
                const tag = sameField.length > 1 ? `${baseLabel}#${idx}` : baseLabel;
                return (
                  <div
                    key={box.id}
                    className="pointer-events-none absolute border-2 border-rose-500 bg-rose-500/10"
                    style={{
                      left: `${box.x * 100}%`,
                      top: `${box.y * 100}%`,
                      width: `${box.width * 100}%`,
                      height: `${box.height * 100}%`,
                    }}
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
                  style={{
                    left: `${Math.min(drawingState.startX, drawingState.currentX) * 100}%`,
                    top: `${Math.min(drawingState.startY, drawingState.currentY) * 100}%`,
                    width: `${Math.abs(drawingState.currentX - drawingState.startX) * 100}%`,
                    height: `${Math.abs(drawingState.currentY - drawingState.startY) * 100}%`,
                  }}
                />
              ) : null}
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 text-sm font-medium text-slate-700">填写正确数值</div>
              <div className="space-y-3">
                {annotationFields.map((field) => (
                  <div key={field.key}>
                    <label className="mb-1 block text-xs text-slate-500">{field.label}</label>
                    <input
                      type={field.key === "total" || field.key === "unscanned" || field.key === "exceptions" ? "number" : "text"}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                      value={String(manualRecord[field.key as keyof ManualRecordState] ?? "")}
                      onChange={(e) => setManualRecord({ ...manualRecord, [field.key]: e.target.value })}
                      placeholder={`输入${field.label}`}
                    />
                    {field.key === "total" && (
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
                {annotationFields.map((field) => {
                  const boxesFor = annotationBoxes.filter((box) => box.field === field.key);
                  const count = boxesFor.length;
                  const hasBox = count > 0;
                  return (
                    <div key={field.key} className="rounded-lg border border-slate-100 bg-white/60 px-2 py-2">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                          <input
                            type="radio"
                            name="annotationField"
                            checked={annotationField === field.key}
                            onChange={() => setAnnotationField(field.key)}
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
                            value={effectiveFieldAggregation(field.key, fieldAggregations)}
                            onChange={(e) =>
                              setFieldAggregations((prev) => ({
                                ...prev,
                                [field.key]: e.target.value as FieldAggregation,
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
                            onClick={() => clearAnnotationFieldBoxes(field.key)}
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
                className="w-full rounded-xl border border-violet-300 bg-violet-50 px-4 py-3 text-sm font-medium text-violet-900 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => void previewFillFromAnnotations()}
                disabled={isPreviewFillLoading || isSavingTraining || !imageSrc || annotationBoxes.length === 0}
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
