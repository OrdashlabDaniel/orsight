import { NextResponse } from "next/server";

import { withAuthedStorageTenant } from "@/lib/storage-tenant";
import { getFormIdFromRequest } from "@/lib/form-request";
import {
  buildAgentThreadReferenceImages,
  buildEditableRecognitionRulesSection,
  buildAgentThreadPromptSection,
  extractRecognitionRuleCodeFromWorkingRules,
  extractRecognitionValidationConfigFromWorkingRules,
  loadGlobalRules,
  mergeLegacyIntoAgentThreadIfEmpty,
  normalizeAgentThread,
  normalizeRecognitionRuleCode,
  RECOGNITION_RULE_CODE_BEGIN,
  RECOGNITION_RULE_CODE_END,
  RECOGNITION_VALIDATION_CONFIG_BEGIN,
  RECOGNITION_VALIDATION_CONFIG_END,
  type RecognitionRuleCode,
  type RecognitionValidationConfig,
  type RecognitionOptionalFieldRule,
  serializeRecognitionRuleCode,
  serializeRecognitionValidationConfig,
  seedWorkingRulesFromLegacy,
  upsertRecognitionRuleCodeBlock,
  upsertRecognitionValidationConfigBlock,
} from "@/lib/training";

const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GUIDANCE_MODEL =
  process.env.OPENAI_GUIDANCE_MODEL || process.env.OPENAI_PRIMARY_MODEL || "gpt-4o-mini";

type ChatMessage = { role: "user" | "assistant" | "system"; content: string };
type OpenAIMessageContent =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };
type OpenAIChatMessage = {
  role: "user" | "assistant" | "system";
  content: string | OpenAIMessageContent[];
};

function upsertOptionalFieldRule(
  rules: RecognitionOptionalFieldRule[],
  nextRule: RecognitionOptionalFieldRule,
): RecognitionOptionalFieldRule[] {
  const next = rules.filter((rule) => rule.fieldId !== nextRule.fieldId);
  next.push(nextRule);
  return next;
}

function deriveImageTypesFromText(text: string): Array<"POD" | "WEB_TABLE" | "OTHER"> | undefined {
  const out: Array<"POD" | "WEB_TABLE" | "OTHER"> = [];
  if (/(网页|web|列表|在线表格|页面表格|系统列表)/i.test(text)) {
    out.push("WEB_TABLE");
  }
  if (/(pod|手持|签退机|扫描枪|设备界面|PDA)/i.test(text)) {
    out.push("POD");
  }
  return out.length > 0 ? out : undefined;
}

function deriveValidationConfigFromMessages(
  messages: ChatMessage[],
  currentConfig: RecognitionValidationConfig,
): RecognitionValidationConfig {
  let optionalFields = [...currentConfig.optionalFields];

  for (const message of messages) {
    if (message.role !== "user") continue;
    const text = message.content;
    const mentionsTaskCode = /(任务编码|task\s*code|taskcode)/i.test(text);
    const mentionsExceptions = /(错扫数量|错扫|错分|误扫|exceptions?)/i.test(text);
    const wantsNoWarning =
      /(不报警|不要报警|无需报警|不需要报警|不需要警告|无需警告|允许留空|留空即可|留空正常|没有.*不需要.*报警)/i.test(text);
    const wantsNoReview =
      /(不需要标记复核|不要标记复核|不需要复核|不要复核|无需复核|不需要待复核|不要待复核|无需待复核)/i.test(text);

    if (!wantsNoWarning && !wantsNoReview) {
      continue;
    }

    const imageTypes = deriveImageTypesFromText(text);
    const requireModelConfidence = !wantsNoReview;

    if (mentionsTaskCode) {
      optionalFields = upsertOptionalFieldRule(optionalFields, {
        fieldId: "taskCode",
        ...(imageTypes ? { imageTypes } : {}),
        requireModelConfidence,
        note: "用户通过识别管家声明：该类界面任务编码留空不报警。",
      });
    }

    if (mentionsExceptions) {
      optionalFields = upsertOptionalFieldRule(optionalFields, {
        fieldId: "exceptions",
        ...(imageTypes ? { imageTypes } : {}),
        requireModelConfidence,
        note: "用户通过识别管家声明：该类界面错扫数量留空不报警。",
      });
    }
  }

  return { optionalFields };
}

function mergeValidationConfigs(
  base: RecognitionValidationConfig,
  incoming: RecognitionValidationConfig,
): RecognitionValidationConfig {
  let optionalFields = [...base.optionalFields];
  for (const rule of incoming.optionalFields) {
    optionalFields = upsertOptionalFieldRule(optionalFields, rule);
  }
  return { optionalFields };
}

export async function POST(request: Request) {
  return withAuthedStorageTenant(async ({ user, skipAuth }) => {
    try {
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
      thread?: unknown;
    };
    const raw = body.messages;
    if (!Array.isArray(raw) || raw.length === 0) {
      return NextResponse.json({ error: "缺少 messages。" }, { status: 400 });
    }

    const currentWorkingRules =
      typeof body.currentWorkingRules === "string" ? body.currentWorkingRules.trim().slice(0, 20000) : "";
    const currentThread = normalizeAgentThread(body.thread);

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
    const currentRuleCode = extractRecognitionRuleCodeFromWorkingRules(
      currentWorkingRules || rules.workingRules || "",
    );
    const currentValidationConfig = extractRecognitionValidationConfigFromWorkingRules(
      currentWorkingRules || rules.workingRules || "",
    );
    const fallbackContext =
      rules.agentThread && rules.agentThread.length > 0
        ? buildAgentThreadPromptSection(rules.agentThread).slice(0, 8000)
        : "（无历史识别规则对话）";
    const referenceImages = await buildAgentThreadReferenceImages(currentThread, 3, formId);

    const system = `你是 OrSight「识别规则 Agent」的规则工程师。你只允许帮助用户调整截图识别本身的规则，例如：
- 字段含义与字段标签
- OCR 阅读优先级
- 单条记录 / 完整表格模式判断
- 歧义处理、错判规避、复核条件
- 多行拆分或合并的识别原则
- 哪些字段在某类界面里本来就不存在，因此留空时不应报警
- 当前表单字段的输出格式，例如 date 必须写成 YYYY.MM.DD

系统为你开放了一个“当前表单规则代码”区域，它只对当前 form 生效，并会被系统直接执行。你可以修改的只有这块结构化规则代码与对应的识别规则正文，不能改项目其他代码。

你绝不能把以下内容写进规则正文或规则代码：
- 软件架构、页面流程、接口行为、数据库/存储结构
- 表格模板结构、字段清单、导出格式、权限控制、登录/路由/部署
- 任何会修改仓库其他模块的产品改动

如果用户提出这类超出范围的诉求，你可以在 assistantReply 里说明“这不属于当前表单可编辑的识别规则代码范围，需要开发处理”，但 revisedWorkingRules 与 revisedRuleCode 都必须忽略这些诉求，不得把它们写入最终规则。

你必须返回 JSON（不要 Markdown），包含以下字段：
- assistantReply：1 到 4 句中文，简要说明你理解到的识别要求，以及是否有超出识别规则范围的部分。
- revisedWorkingRules：完整的识别规则正文（中文）。只写截图识别相关内容，不要写软件架构或产品改动。不要手动包含任何 JSON 包裹块，系统会自动合并。
- revisedRuleCode：当前表单结构化规则代码 JSON。格式必须为：
{
  "fieldDirectives": [
    {
      "fieldId": "date",
      "outputFormat": "YYYY.MM.DD" | "YYYY-MM-DD" | "MM/DD/YYYY" | "as_visible",
      "exampleValue": "2026.02.04",
      "instruction": "date 必须严格按图上显示格式输出"
    }
  ]
}

系统会把 revisedRuleCode 写入下面这个机器可读代码块中：
${RECOGNITION_RULE_CODE_BEGIN}
{"fieldDirectives":[{"fieldId":"date","outputFormat":"YYYY.MM.DD","exampleValue":"2026.02.04","instruction":"date 按截图格式输出"}]}
${RECOGNITION_RULE_CODE_END}

系统也会把“字段可空/不报警”策略写入下面这个机器可读 JSON 区块中：
${RECOGNITION_VALIDATION_CONFIG_BEGIN}
{"optionalFields":[{"fieldId":"taskCode","imageTypes":["WEB_TABLE"],"requireModelConfidence":true,"note":"网页列表类截图里若本来没有任务编码列，则 taskCode 留空不报警"}]}
${RECOGNITION_VALIDATION_CONFIG_END}

规则：
1. 如果当前没有特殊“字段可空”场景，也必须输出 {"optionalFields":[]}。
2. “fieldId” 目前只在真正需要时填写，如 “taskCode”、“exceptions”。
3. “imageTypes” 可用 “POD”、“WEB_TABLE”、“OTHER”；省略表示所有类型。
4. “requireModelConfidence” 默认应为 true，表示只有当模型本身没有标记 reviewRequired 时，留空才视为正常。
5. revisedRuleCode 也是给系统直接执行的，必须是合法 JSON，且只写当前表单真正需要的字段指令。
6. 如果用户附了截图，你必须优先看图判断格式/标签，再写入 revisedRuleCode；不要只复述用户的话。

【客户端传入的当前识别规则】
"""
${currentWorkingRules || "（空）"}
"""

【当前表单规则代码 JSON】
${serializeRecognitionRuleCode(currentRuleCode)}

【当前字段缺省策略 JSON】
${serializeRecognitionValidationConfig(currentValidationConfig)}

【识别规则的固定边界】
${buildEditableRecognitionRulesSection(null).trim()}

【服务端存档参考】
${serverWorking ? `识别规则存档摘录：\n${serverWorking}` : "（无识别规则存档）"}

【其它识别上下文】
${fallbackContext}`;

    const openaiMessages: OpenAIChatMessage[] = [
      { role: "system", content: system },
      ...messages.map((message) => ({ role: message.role, content: message.content })),
    ];
    if (referenceImages.length > 0) {
      const visualContent: OpenAIMessageContent[] = [
        {
          type: "text",
          text:
            "【本轮规则修改附图】请查看下面这些用户附图，用于判断字段标签、输出格式和歧义处理方式。不要抄写图片里的业务数据，只提炼成规则正文与规则代码。",
        },
      ];
      for (const ref of referenceImages) {
        visualContent.push({ type: "text", text: ref.caption });
        visualContent.push({ type: "image_url", image_url: { url: ref.dataUrl } });
      }
      openaiMessages.push({ role: "user", content: visualContent });
    }

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

    let parsed: {
      assistantReply?: string;
      revisedWorkingRules?: string;
      revisedRuleCode?: RecognitionRuleCode;
      suggestedRules?: string;
    };
    try {
      parsed = JSON.parse(content) as {
        assistantReply?: string;
        revisedWorkingRules?: string;
        revisedRuleCode?: RecognitionRuleCode;
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

    const modelValidationConfig = extractRecognitionValidationConfigFromWorkingRules(revisedWorkingRules);
    const deterministicValidationConfig = deriveValidationConfigFromMessages(messages, currentValidationConfig);
    const revisedValidationConfig = mergeValidationConfigs(modelValidationConfig, deterministicValidationConfig);
    const revisedRuleCode = normalizeRecognitionRuleCode(parsed.revisedRuleCode ?? currentRuleCode);
    revisedWorkingRules = upsertRecognitionValidationConfigBlock(revisedWorkingRules, revisedValidationConfig);
    revisedWorkingRules = upsertRecognitionRuleCodeBlock(revisedWorkingRules, revisedRuleCode).slice(0, 50000);
      return NextResponse.json({ assistantReply, revisedWorkingRules, revisedRuleCode });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Guidance chat failed." },
        { status: 500 },
      );
    }
  });
}
