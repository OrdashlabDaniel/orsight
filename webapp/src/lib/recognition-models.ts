export type RecognitionModelKey = "fast" | "accurate" | "max";
export type OrdinaryRecognitionModelKey = Exclude<RecognitionModelKey, "max">;

export type RecognitionModelOption = {
  key: RecognitionModelKey;
  fallbackModel: string;
  minimumPlan: "free" | "normal" | "pro";
};

export const RECOGNITION_MODEL_OPTIONS: RecognitionModelOption[] = [
  { key: "fast", fallbackModel: "gpt-5-mini", minimumPlan: "free" },
  { key: "accurate", fallbackModel: "gpt-5", minimumPlan: "normal" },
  { key: "max", fallbackModel: "gpt-5.5", minimumPlan: "pro" },
];

export const ORDINARY_RECOGNITION_MODEL_OPTIONS: RecognitionModelOption[] =
  RECOGNITION_MODEL_OPTIONS.filter((option) => option.key !== "max");

export function normalizeRecognitionModelKey(value: unknown): RecognitionModelKey | null {
  if (value === "fast" || value === "accurate" || value === "max") {
    return value;
  }
  return null;
}

export function fallbackRecognitionModelName(key: RecognitionModelKey): string {
  return RECOGNITION_MODEL_OPTIONS.find((option) => option.key === key)?.fallbackModel || "gpt-5-mini";
}
