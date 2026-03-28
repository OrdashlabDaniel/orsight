import { NextResponse } from "next/server";

import { getAuthUserOrSkip } from "@/lib/auth-server";
import { loadGlobalRules } from "@/lib/training";

const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GUIDANCE_MODEL =
  process.env.OPENAI_GUIDANCE_MODEL || process.env.OPENAI_PRIMARY_MODEL || "gpt-4o-mini";

type ChatMessage = { role: "user" | "assistant" | "system"; content: string };

export async function POST(request: Request) {
  try {
    const { user, skipAuth } = await getAuthUserOrSkip();
    if (!skipAuth && !user) {
      return NextResponse.json({ error: "请先登录。" }, { status: 401 });
    }

    if (!OPENAI_API_KEY) {
      return NextResponse.json({ error: "未配置 OPENAI_API_KEY。" }, { status: 503 });
    }

    const body = (await request.json()) as { messages?: unknown };
    const raw = body.messages;
    if (!Array.isArray(raw) || raw.length === 0) {
      return NextResponse.json({ error: "缺少 messages。" }, { status: 400 });
    }

    const messages: ChatMessage[] = [];
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const m = item as Record<string, unknown>;
      const role = m.role;
      const content = m.content;
      if (role !== "user" && role !== "assistant") continue;
      if (typeof content !== "string" || !content.trim()) continue;
      messages.push({ role, content: content.trim().slice(0, 12000) });
    }

    if (messages.length === 0) {
      return NextResponse.json({ error: "没有有效的对话内容。" }, { status: 400 });
    }

    const rules = await loadGlobalRules();
    const existingInstructions = (rules.instructions || "").trim();
    const docSnippets =
      rules.documents?.length > 0
        ? rules.documents
            .map((d) => `《${d.name}》前 600 字：\n${(d.content || "").slice(0, 600)}`)
            .join("\n\n")
        : "（尚未上传参考文档）";

    const system = `你是 OrSight 的「POD / 物流截图结构化提取」配置顾问。用户会用自然语言说明业务场景、常见误判、屏幕样式等。

你必须返回一个 JSON 对象（不要 Markdown），且仅包含两个字符串字段：
- assistantReply：用简短、专业的中文直接回复用户（可含 1～3 句），表示你理解其意图；不要在此重复长规则列表。
- suggestedRules：整理成可追加到「视觉模型系统提示」的**增量**条目；每行一条，以 "- " 开头；只写可执行的提取/判读指令；不要臆造用户未提及的业务事实；若本轮无需新增规则则填 ""（空字符串）。

【当前全局提取规则】（勿逐字重复，只输出增量补充）
"""
${existingInstructions.slice(0, 6000)}
"""

【参考文档摘录】
"""
${docSnippets.slice(0, 8000)}
"""`;

    const openaiMessages: ChatMessage[] = [
      { role: "system", content: system },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    const res = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: GUIDANCE_MODEL,
        response_format: { type: "json_object" },
        messages: openaiMessages,
        temperature: 0.35,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json(
        { error: `Guidance 模型错误：${res.status} ${errText.slice(0, 500)}` },
        { status: 502 },
      );
    }

    const payload = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      return NextResponse.json({ error: "模型未返回内容。" }, { status: 502 });
    }

    let parsed: { assistantReply?: string; suggestedRules?: string };
    try {
      parsed = JSON.parse(content) as { assistantReply?: string; suggestedRules?: string };
    } catch {
      return NextResponse.json({ error: "模型返回不是合法 JSON。" }, { status: 502 });
    }

    const assistantReply =
      typeof parsed.assistantReply === "string" && parsed.assistantReply.trim()
        ? parsed.assistantReply.trim()
        : "已收到，我会在你保存规则后参与后续识别提示。";
    const suggestedRules =
      typeof parsed.suggestedRules === "string" ? parsed.suggestedRules.trim() : "";

    return NextResponse.json({ assistantReply, suggestedRules });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Guidance chat failed." },
      { status: 500 },
    );
  }
}
