export type RecognitionModelKey = "fast" | "accurate" | "max";

export type RecognitionBillingStatus = {
  plan?: string | null;
  subscriptionStatus?: string | null;
  lifetimeFree?: boolean | null;
} | null;

export type RecognitionModelOption = {
  key: RecognitionModelKey;
  fallbackModel: string;
  minimumPlan: "free" | "normal";
};

export const RECOGNITION_MODEL_OPTIONS: RecognitionModelOption[] = [
  { key: "fast", fallbackModel: "gpt-5-mini", minimumPlan: "free" },
  { key: "accurate", fallbackModel: "gpt-5", minimumPlan: "free" },
  { key: "max", fallbackModel: "gpt-5.5", minimumPlan: "normal" },
];

export function normalizeRecognitionModelKey(value: unknown): RecognitionModelKey | null {
  if (value === "fast" || value === "accurate" || value === "max") {
    return value;
  }
  return null;
}

export function fallbackRecognitionModelName(key: RecognitionModelKey): string {
  return RECOGNITION_MODEL_OPTIONS.find((option) => option.key === key)?.fallbackModel || "gpt-5-mini";
}

export function isNormalPaidForPremiumModels(status: RecognitionBillingStatus): boolean {
  const subscriptionStatus = String(status?.subscriptionStatus || "").toLowerCase();
  return (
    status?.plan === "normal" &&
    status.lifetimeFree !== true &&
    (subscriptionStatus === "active" || subscriptionStatus === "trialing")
  );
}

export function canUseRecognitionModel(key: RecognitionModelKey, status: RecognitionBillingStatus): boolean {
  return key !== "max" || isNormalPaidForPremiumModels(status);
}
