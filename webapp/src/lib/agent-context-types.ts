/** 填表 Agent 对话线程（仅存类型，供前后端共用，无 Node 依赖） */

export type AgentAsset =
  | { kind: "image"; name: string; imageName: string }
  | { kind: "document"; name: string; excerpt: string };

export type AgentThreadTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  ts: string;
  assets?: AgentAsset[];
  /** 助手返回的可执行规则摘要（可选，已包含在填表提示中） */
  suggestedRules?: string;
};
