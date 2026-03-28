import { NextResponse } from "next/server";

import { getAuthUserOrSkip } from "@/lib/auth-server";
import {
  buildAgentThreadPromptSection,
  loadGlobalRules,
  mergeLegacyIntoAgentThreadIfEmpty,
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

    const rules = mergeLegacyIntoAgentThreadIfEmpty(await loadGlobalRules());
    const docSnippets =
      rules.documents?.length > 0
        ? rules.documents
            .map((d) => `《${d.name}》前 500 字：\n${(d.content || "").slice(0, 500)}`)
            .join("\n\n")
        : "（无）";

    const serverWorking = (rules.workingRules || "").trim().slice(0, 12000);
    const fallbackContext =
      rules.agentThread && rules.agentThread.length > 0
        ? buildAgentThreadPromptSection(rules.agentThread).slice(0, 8000)
        : `【旧版自定义规则】\n${(rules.instructions || "").slice(0, 4000)}\n\n【旧版文档摘录】\n${docSnippets.slice(0, 4000)}`;

    const system = `你是 OrSight「填表 Agent」的规则工程师。用户通过多轮对话和附件说明业务，你要维护一份**完整的填表工作规则**正文：这份正文会直接注入视觉识别模型，决定如何从截图里填表——不是保存聊天记录，而是**内化、升级**可执行规则。

你必须返回 JSON（不要 Markdown），仅包含两个字符串字段：
- assistantReply：1～4 句中文，简要说明你如何理解用户本轮诉求、规则上会做哪些调整。
- revisedWorkingRules：**完整**的填表工作规则正文（中文）。要求：
  - 用分条或分段写清：各字段含义、在 POD 屏摄 / 网页表上的典型位置或标签、易错点（如应领/实领/反光）、与用户附图或文档相关的约定等。
  - 以【客户端传入的当前工作规则】为基底合并：纳入用户本轮新要求，删除与之矛盾或过时的旧条；不要臆造用户未提及的业务事实。
  - 若用户只是问候或没有实质新需求，revisedWorkingRules 可与当前稿基本一致，仅可微调措辞。
  - 若当前稿为空，则根据对话与附件从零写一版可用的初稿。

【客户端传入的当前工作规则】（用户界面上正在编辑的版本，优先作为修订基底）
"""
${currentWorkingRules || "（空）"}
"""

【服务端存档参考】（可能与客户端略有出入，供补充上下文）
${serverWorking ? `工作规则存档摘录：\n${serverWorking.slice(0, 6000)}` : "（无工作规则存档）"}

${fallbackContext ? `其它存档上下文：\n${fallbackContext}` : ""}`;

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
        : "已根据你的说明更新填表工作规则。";

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
