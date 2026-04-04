import { NextResponse } from "next/server";

import { getAuthUserOrSkip } from "@/lib/auth-server";
import { buildTableFieldsFromTemplateColumns, type TemplateColumnInput } from "@/lib/forms";

const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const TEMPLATE_MODEL = process.env.OPENAI_PREVIEW_MODEL || process.env.OPENAI_PRIMARY_MODEL || "gpt-5-mini";
const OPENAI_REASONING_EFFORT = process.env.OPENAI_REASONING_EFFORT || "minimal";

type TemplateFromImagePayload = {
  imageDataUrl?: unknown;
};

function normalizeColumns(raw: unknown): TemplateColumnInput[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const out: TemplateColumnInput[] = [];
  const seenLabels = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const record = item as Record<string, unknown>;
    const label = typeof record.label === "string" ? record.label.trim().slice(0, 40) : "";
    if (!label) {
      continue;
    }
    const dedupeToken = label.toLocaleLowerCase("zh-CN");
    if (seenLabels.has(dedupeToken)) {
      continue;
    }
    const type = record.type === "number" || record.type === "text" ? record.type : undefined;
    out.push({ label, type });
    seenLabels.add(dedupeToken);
  }
  return out;
}

export async function POST(request: Request) {
  try {
    const { user, skipAuth } = await getAuthUserOrSkip();
    if (!skipAuth && !user) {
      return NextResponse.json({ error: "请先登录。" }, { status: 401 });
    }

    if (!OPENAI_API_KEY) {
      return NextResponse.json({ error: "服务端缺少 OPENAI_API_KEY。" }, { status: 503 });
    }

    const payload = (await request.json().catch(() => ({}))) as TemplateFromImagePayload;
    const imageDataUrl = typeof payload.imageDataUrl === "string" ? payload.imageDataUrl.trim() : "";
    if (!imageDataUrl.startsWith("data:image/")) {
      return NextResponse.json({ error: "请先上传表格模板截图。" }, { status: 400 });
    }

    const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: TEMPLATE_MODEL,
        reasoning_effort: OPENAI_REASONING_EFFORT,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              'You are OrSight table-template extraction mode. The user uploads a screenshot of a standard table template. Read only the visible table headers that should become fillable columns. Return strict JSON: {"columns":[{"label":"...","type":"text|number"}],"description":"short chinese summary"}. Keep columns left-to-right. Ignore buttons, row numbers, checkboxes, print icons, pagination, and decorative labels. Use type "number" only for obvious count/amount/weight/quantity columns.',
          },
          {
            role: "user",
            content: [
              { type: "text", text: "请识别这张表格模板截图里真正需要成为填表项目的列头，并判断每列是文本还是数字。" },
              { type: "image_url", image_url: { url: imageDataUrl } },
            ],
          },
        ],
      }),
    });

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };
    const content = data.choices?.[0]?.message?.content;
    if (!response.ok || !content) {
      throw new Error(data.error?.message || "模板截图识别失败。");
    }

    const parsed = JSON.parse(content) as { columns?: unknown; description?: unknown };
    const columns = normalizeColumns(parsed.columns);
    if (!columns.length) {
      return NextResponse.json({ error: "没有识别到可用的表格列头，请换一张更清晰的模板截图。" }, { status: 422 });
    }

    const tableFields = buildTableFieldsFromTemplateColumns(columns);
    return NextResponse.json({
      ok: true,
      columns,
      tableFields,
      description: typeof parsed.description === "string" ? parsed.description.trim() : "",
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "模板截图识别失败。",
      },
      { status: 500 },
    );
  }
}
