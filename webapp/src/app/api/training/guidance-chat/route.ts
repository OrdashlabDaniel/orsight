import { NextResponse } from "next/server";

import { getAuthUserOrSkip } from "@/lib/auth-server";
import { getFormIdFromRequest } from "@/lib/form-request";
import {
  buildEditableRecognitionRulesSection,
  buildAgentThreadPromptSection,
  loadGlobalRules,
  mergeLegacyIntoAgentThreadIfEmpty,
  seedWorkingRulesFromLegacy,
} from "@/lib/training";

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

    const formId = getFormIdFromRequest(request);
    if (!OPENAI_API_KEY) {
      return NextResponse.json({ error: "未配置 OPENAI_API_KEY。" }, { status: 503 });
    }

    const body = (await request.json()) as {
      messages?: unknown;
      currentWorkingRules?: unknown;
    };
    const raw = body.messages;
    if (!Array.isArray(raw) || raw.length === 0) {
      return NextResponse.json({ error: "缺少 messages。" }, { status: 400 });
    }

    const currentWorkingRules =
      typeof body.currentWorkingRules === "string" ? body.currentWorkingRules.trim().slice(0, 20000) : "";

    const messages: ChatMessage[] = [];
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const message = item as Record<string, unknown>;
      if (message.role !== "user" && message.role !== "assistant") continue;
      if (typeof message.content !== "string" || !message.content.trim()) continue;
      messages.push({ role: message.role, content: message.content.trim().slice(0, 12000) });
    }

    if (messages.length === 0) {
      return NextResponse.json({ error: "没有有效的对话内容。" }, { status: 400 });
    }

    const rules = seedWorkingRulesFromLegacy(mergeLegacyIntoAgentThreadIfEmpty(await loadGlobalRules(formId)));
    const serverWorking = (rules.workingRules || "").trim().slice(0, 12000);
    const fallbackContext =
      rules.agentThread && rules.agentThread.length > 0
        ? buildAgentThreadPromptSection(rules.agentThread).slice(0, 8000)
        : "（无历史识别规则对话）";

    const system = `你是 OrSight「识别规则 Agent」的规则工程师。你只允许帮助用户调整截图识别本身的规则，例如：
- 字段含义与字段标签
- OCR 阅读优先级
- 单条记录 / 完整表格模式判断
- 歧义处理、错判规避、复核条件
- 多行拆分或合并的识别原则

你绝不能把以下内容写进规则：
- 软件架构、页面流程、接口行为、数据库/存储结构
- 表格模板结构、字段清单、导出格式、权限控制、登录/路由/部署
- 任何需要开发改代码才能生效的产品改动

如果用户提出这类超出范围的诉求，你可以在 assistantReply 里说明“这不属于可编辑的识别规则范围，需要开发处理”，但 revisedWorkingRules 必须忽略这些诉求，不得把它们写入最终规则。

你必须返回 JSON（不要 Markdown），仅包含两个字符串字段：
- assistantReply：1 到 4 句中文，简要说明你理解到的识别要求，以及是否有超出识别规则范围的部分。
- revisedWorkingRules：完整的识别规则正文（中文）。只写截图识别相关内容，不要写软件架构或产品改动。

【客户端传入的当前识别规则】
"""
${currentWorkingRules || "（空）"}
"""

【识别规则的固定边界】
${buildEditableRecognitionRulesSection(null).trim()}

【服务端存档参考】
${serverWorking ? `识别规则存档摘录：\n${serverWorking}` : "（无识别规则存档）"}

【其它识别上下文】
${fallbackContext}`;

    const openaiMessages: ChatMessage[] = [
      { role: "system", content: system },
      ...messages.map((message) => ({ role: message.role, content: message.content })),
    ];

    const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: GUIDANCE_MODEL,
        response_format: { type: "json_object" },
        messages: openaiMessages,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return NextResponse.json(
        { error: `Guidance 模型错误：${response.status} ${errText.slice(0, 500)}` },
        { status: 502 },
      );
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      return NextResponse.json({ error: "模型未返回内容。" }, { status: 502 });
    }

    let parsed: { assistantReply?: string; revisedWorkingRules?: string; suggestedRules?: string };
    try {
      parsed = JSON.parse(content) as {
        assistantReply?: string;
        revisedWorkingRules?: string;
        suggestedRules?: string;
      };
    } catch {
      return NextResponse.json({ error: "模型返回不是合法 JSON。" }, { status: 502 });
    }

    const assistantReply =
      typeof parsed.assistantReply === "string" && parsed.assistantReply.trim()
        ? parsed.assistantReply.trim()
        : "已根据你的说明更新识别规则。";

    let revisedWorkingRules =
      typeof parsed.revisedWorkingRules === "string" ? parsed.revisedWorkingRules.trim() : "";
    if (!revisedWorkingRules && typeof parsed.suggestedRules === "string" && parsed.suggestedRules.trim()) {
      revisedWorkingRules = `${currentWorkingRules}\n\n【本轮补充】\n${parsed.suggestedRules.trim()}`.trim();
    }
    if (!revisedWorkingRules) {
      revisedWorkingRules = currentWorkingRules;
    }

    revisedWorkingRules = revisedWorkingRules.slice(0, 50000);
    return NextResponse.json({ assistantReply, revisedWorkingRules });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Guidance chat failed." },
      { status: 500 },
    );
  }
}
