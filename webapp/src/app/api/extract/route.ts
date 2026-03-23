import { NextResponse } from "next/server";
import sharp from "sharp";

import { getAuthUserOrSkip } from "@/lib/auth-server";
import {
  type ExtractionIssue,
  type PodRecord,
  normalizeNumber,
  normalizeText,
  validateRecord,
  visionPrompt,
} from "@/lib/pod";
import { buildTrainingPromptSection, loadTrainingExamples, loadGlobalRules } from "@/lib/training";

const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const OPENAI_PRIMARY_MODEL = process.env.OPENAI_PRIMARY_MODEL || process.env.OPENAI_MODEL || "gpt-5-mini";
const OPENAI_REVIEW_MODEL = process.env.OPENAI_REVIEW_MODEL || "gpt-5";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_REASONING_EFFORT = process.env.OPENAI_REASONING_EFFORT || "minimal";

// We'll load this asynchronously now per request
// const TRAINING_EXAMPLES = loadTrainingExamples();

type OpenAIMessageContent =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

type RawModelRecord = {
  date?: unknown;
  route?: unknown;
  driver?: unknown;
  total?: unknown;
  totalSourceLabel?: unknown;
  unscanned?: unknown;
  exceptions?: unknown;
  waybillStatus?: unknown;
  stationTeam?: unknown;
  reviewRequired?: unknown;
  reviewReason?: unknown;
};

type CounterVerificationResult = {
  expectedCount?: unknown;
  actualCount?: unknown;
  pickedUpCount?: unknown;
  expectedCountVisible?: unknown;
  actualCountVisible?: unknown;
  pickedUpVisible?: unknown;
};

type CropRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const COUNTER_CROP_REGIONS: Record<"expected" | "actual" | "pickedUp", CropRegion> = {
  expected: { x: 0.14, y: 0.50, width: 0.28, height: 0.14 },
  actual: { x: 0.49, y: 0.50, width: 0.30, height: 0.14 },
  pickedUp: { x: 0.13, y: 0.68, width: 0.24, height: 0.16 },
};

function appendReviewReason(currentReason: string | null | undefined, nextReason: string): string {
  const parts = [currentReason, nextReason].filter(Boolean);
  return Array.from(new Set(parts)).join(" | ");
}

async function callVisionModel(file: File, model: string): Promise<{ records: RawModelRecord[], imageType: string }> {
  if (!OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY. Please configure the AI model first.");
  }

  const examples = await loadTrainingExamples();
  const globalRules = await loadGlobalRules();
  const bytes = Buffer.from(await file.arrayBuffer());
  const dataUrl = `data:${file.type || "image/jpeg"};base64,${bytes.toString("base64")}`;

  const body = {
    model,
    reasoning_effort: OPENAI_REASONING_EFFORT,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: `${visionPrompt}${buildTrainingPromptSection(examples, globalRules)}` },
          { type: "image_url", image_url: { url: dataUrl } },
        ] as OpenAIMessageContent[],
      },
    ],
  };

  const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Vision API error: ${response.status} ${text}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
  };

  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Vision API returned empty content.");
  }

  let parsed: { records?: RawModelRecord[], imageType?: string };
  try {
    parsed = JSON.parse(content) as { records?: RawModelRecord[], imageType?: string };
  } catch (error) {
    throw new Error(`Model did not return valid JSON: ${String(error)}`);
  }

  return {
    records: parsed.records || [],
    imageType: parsed.imageType || "OTHER",
  };
}

async function callCounterVerifier(file: File, model: string): Promise<CounterVerificationResult> {
  if (!OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY. Please configure the AI model first.");
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const image = sharp(bytes);
  const metadata = await image.metadata();

  if (!metadata.width || !metadata.height) {
    return {};
  }

  async function cropToDataUrl(region: CropRegion) {
    const left = Math.max(0, Math.floor(metadata.width! * region.x));
    const top = Math.max(0, Math.floor(metadata.height! * region.y));
    const width = Math.max(1, Math.floor(metadata.width! * region.width));
    const height = Math.max(1, Math.floor(metadata.height! * region.height));
    const cropped = await sharp(bytes).extract({ left, top, width, height }).png().toBuffer();
    return `data:image/png;base64,${cropped.toString("base64")}`;
  }

  const expectedCrop = await cropToDataUrl(COUNTER_CROP_REGIONS.expected);
  const actualCrop = await cropToDataUrl(COUNTER_CROP_REGIONS.actual);
  const pickedUpCrop = await cropToDataUrl(COUNTER_CROP_REGIONS.pickedUp);
  const verificationPrompt = `你只做计数字段核验。读取这张 POD 签退截图，并返回 JSON。

要求：
1. 第一张裁剪图只对应 应领件数 区域，读取 expectedCount。如果看不清就返回 null。
2. 第二张裁剪图只对应 实领件数 区域，读取 actualCount。如果看不清就返回 null。
3. 第三张裁剪图只对应 左下角已领 区域，读取 pickedUpCount。如果看不清就返回 null。
4. expectedCountVisible / actualCountVisible / pickedUpVisible 表示对应区域数字是否清晰可辨。
5. 绝对不要猜数字。
6. 不要把一张裁剪图中的数字借给另一张。

返回格式：
{
  "expectedCount": 84,
  "actualCount": 83,
  "pickedUpCount": 83,
  "expectedCountVisible": true,
  "actualCountVisible": true,
  "pickedUpVisible": true
}`;

  const body = {
    model,
    reasoning_effort: "minimal",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: verificationPrompt },
          { type: "image_url", image_url: { url: expectedCrop } },
          { type: "image_url", image_url: { url: actualCrop } },
          { type: "image_url", image_url: { url: pickedUpCrop } },
        ] as OpenAIMessageContent[],
      },
    ],
  };

  const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Counter verifier API error: ${response.status} ${text}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
  };

  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    return {};
  }

  try {
    return JSON.parse(content) as CounterVerificationResult;
  } catch {
    return {};
  }
}

function mapRecord(imageName: string, raw: RawModelRecord, index: number): PodRecord {
  return {
    id: `${imageName}-${index}`,
    imageName,
    date: normalizeText(raw.date),
    route: normalizeText(raw.route),
    driver: normalizeText(raw.driver),
    total: normalizeNumber(raw.total),
    totalSourceLabel: normalizeText(raw.totalSourceLabel),
    unscanned: normalizeNumber(raw.unscanned),
    exceptions: normalizeNumber(raw.exceptions),
    waybillStatus: normalizeText(raw.waybillStatus),
    stationTeam: normalizeText(raw.stationTeam),
    reviewRequired: Boolean(raw.reviewRequired),
    reviewReason: normalizeText(raw.reviewReason) || null,
  };
}

function recordSignature(record: PodRecord): string {
  return JSON.stringify({
    date: record.date,
    route: record.route,
    driver: record.driver,
    total: record.total,
    totalSourceLabel: record.totalSourceLabel,
    unscanned: record.unscanned,
    exceptions: record.exceptions,
    waybillStatus: record.waybillStatus,
  });
}

function markSourceMismatchForReview(records: PodRecord[], validLabels: Set<string>) {
  return records.map((record) => {
    if (record.total !== "" && !record.totalSourceLabel) {
      return {
        ...record,
        total: "" as const,
        reviewRequired: true,
        reviewReason: appendReviewReason(
          record.reviewReason,
          "运单数量来源缺失：未能确认数字来源标签，必须人工检查。",
        ),
      };
    }

    if (record.total !== "" && record.totalSourceLabel && validLabels.size > 0 && !validLabels.has(record.totalSourceLabel)) {
      return {
        ...record,
        total: "" as const,
        reviewRequired: true,
        reviewReason: appendReviewReason(
          record.reviewReason,
          `运单数量来源异常：当前来源为“${record.totalSourceLabel}”，不在训练池已知的合法来源中，必须人工检查。`,
        ),
      };
    }

    return record;
  });
}

function toNullableNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function toBoolean(value: unknown) {
  return value === true;
}

function applyCounterVerification(
  fileName: string,
  records: PodRecord[],
  verification: CounterVerificationResult,
) {
  const issues: ExtractionIssue[] = [];
  const expectedCount = toNullableNumber(verification.expectedCount);
  const actualCount = toNullableNumber(verification.actualCount);
  const pickedUpCount = toNullableNumber(verification.pickedUpCount);
  const expectedCountVisible = toBoolean(verification.expectedCountVisible);

  const nextRecords = records.map((record) => {
    let nextRecord = record;

    if (record.total !== "" && (!expectedCountVisible || expectedCount === null)) {
      nextRecord = {
        ...nextRecord,
        total: "" as const,
        reviewRequired: true,
        reviewReason: appendReviewReason(
          nextRecord.reviewReason,
          "应领件数区域未被清晰识别，运单数量无法自动确认，必须人工检查。",
        ),
      };
      issues.push({
        imageName: fileName,
        route: record.route,
        level: "error",
        code: "expected_count_unreadable",
        message: "应领件数区域看不清或未识别到，运单数量不能自动确认。",
      });
    }

    if (record.total !== "" && expectedCount !== null && record.total !== expectedCount) {
      nextRecord = {
        ...nextRecord,
        total: "" as const,
        reviewRequired: true,
        reviewReason: appendReviewReason(
          nextRecord.reviewReason,
          `运单数量与应领件数不一致：当前为 ${record.total}，应领件数为 ${expectedCount}。`,
        ),
      };
      issues.push({
        imageName: fileName,
        route: record.route,
        level: "error",
        code: "total_conflicts_expected",
        message: `运单数量与应领件数不一致：当前为 ${record.total}，应领件数为 ${expectedCount}。`,
      });
    }

    if (
      record.total !== "" &&
      expectedCount === null &&
      ((actualCount !== null && record.total === actualCount) || (pickedUpCount !== null && record.total === pickedUpCount))
    ) {
      nextRecord = {
        ...nextRecord,
        total: "" as const,
        reviewRequired: true,
        reviewReason: appendReviewReason(
          nextRecord.reviewReason,
          "运单数量疑似取自实领件数或已领，而不是应领件数，必须人工检查。",
        ),
      };
      issues.push({
        imageName: fileName,
        route: record.route,
        level: "error",
        code: "total_matches_wrong_counter",
        message: "运单数量疑似取自实领件数或已领，而不是应领件数。",
      });
    }

    return nextRecord;
  });

  return {
    records: nextRecords,
    issues,
  };
}

async function runConsistencyCheck(file: File, model: string) {
  const attemptCount = 4;
  const attempts = await Promise.all(
    Array.from({ length: attemptCount }, () => callVisionModel(file, model)),
  );

  // We assume the imageType is consistent across attempts, take the first one
  const imageType = attempts[0]?.imageType || "OTHER";

  const mappedAttempts = attempts.map((attempt, attemptIndex) =>
    attempt.records.map((rawRecord, recordIndex) => mapRecord(file.name, rawRecord, recordIndex + attemptIndex * 100)),
  );

  const firstAttemptRecords = mappedAttempts[0] || [];
  const issues: ExtractionIssue[] = [];

  const finalRecords = firstAttemptRecords.map((record) => {
    const sig = recordSignature(record);
    
    // Check if this exact record signature exists in all other attempts
    let isConsistent = true;
    for (let i = 1; i < attemptCount; i++) {
      const attemptRecords = mappedAttempts[i] || [];
      const hasMatch = attemptRecords.some(r => recordSignature(r) === sig);
      if (!hasMatch) {
        isConsistent = false;
        break;
      }
    }

    if (!isConsistent) {
      issues.push({
        imageName: file.name,
        route: record.route,
        level: "warning",
        code: "consistency_mismatch",
        message: "该条目在四次识别中存在不一致结果，请人工确认或再次识别。",
      });
      return {
        ...record,
        reviewRequired: true,
        reviewReason: appendReviewReason(record.reviewReason, "四次识别结果不一致，需要人工复核。"),
      };
    }

    return record;
  });

  return {
    records: finalRecords,
    issues,
    imageType,
  };
}

export async function POST(request: Request) {
  try {
    const { user, skipAuth } = await getAuthUserOrSkip();
    if (!skipAuth && !user) {
      return NextResponse.json({ error: "请先登录后再使用识别功能。" }, { status: 401 });
    }

    const formData = await request.formData();
    const mode = String(formData.get("mode") || "primary");
    const files = formData
      .getAll("files")
      .filter((value): value is File => value instanceof File);
    const model = mode === "review" ? OPENAI_REVIEW_MODEL : OPENAI_PRIMARY_MODEL;

    if (!files.length) {
      return NextResponse.json({ error: "No files uploaded." }, { status: 400 });
    }

    const records: PodRecord[] = [];
    const issues: ExtractionIssue[] = [];

    const examples = await loadTrainingExamples();
    const validLabels = new Set<string>();
    for (const ex of examples) {
      if (ex.output.totalSourceLabel) {
        validLabels.add(ex.output.totalSourceLabel);
      }
    }
    // Also add some default valid labels just in case
    validLabels.add("应领件数");
    validLabels.add("运单数量");

    for (const file of files) {
      const consistencyResult = await runConsistencyCheck(file, model);
      const sourceCheckedRecords = markSourceMismatchForReview(consistencyResult.records, validLabels);
      
      let checkedRecords = sourceCheckedRecords;
      let counterIssues: ExtractionIssue[] = [];

      // Only run counter verification for POD images
      if (consistencyResult.imageType === "POD") {
        const counterVerification = await callCounterVerifier(file, model);
        const counterChecked = applyCounterVerification(file.name, sourceCheckedRecords, counterVerification);
        checkedRecords = counterChecked.records;
        counterIssues = counterChecked.issues;
      }

      if (!checkedRecords.length) {
        issues.push({
          imageName: file.name,
          message: "AI 没有返回任何记录，请人工复核。",
          level: "error",
          code: "empty_result",
        });
        issues.push(...consistencyResult.issues);
        issues.push(...counterIssues);
        continue;
      }

      checkedRecords.forEach((record) => {
        records.push(record);
        issues.push(...validateRecord(record));
      });
      issues.push(...consistencyResult.issues);
      issues.push(...counterIssues);
    }

    return NextResponse.json({
      records,
      issues,
      modelUsed: model,
      mode,
      trainingExamplesLoaded: (await loadTrainingExamples()).length,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown extraction error.",
      },
      { status: 500 },
    );
  }
}
