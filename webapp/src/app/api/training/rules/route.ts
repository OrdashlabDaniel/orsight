import { NextResponse } from "next/server";

import { getAuthUserOrSkip } from "@/lib/auth-server";
import {
  loadGlobalRules,
  mergeLegacyIntoAgentThreadIfEmpty,
  normalizeAgentThread,
  saveGlobalRules,
  seedWorkingRulesFromLegacy,
  type GlobalRules,
  type GuidanceTurn,
} from "@/lib/training";

export async function GET() {
  try {
    const { user, skipAuth } = await getAuthUserOrSkip();
    if (!skipAuth && !user) {
      return NextResponse.json({ error: "请先登录。" }, { status: 401 });
    }

    const rules = seedWorkingRulesFromLegacy(mergeLegacyIntoAgentThreadIfEmpty(await loadGlobalRules()));
    return NextResponse.json(rules);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load global rules." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const { user, skipAuth } = await getAuthUserOrSkip();
    if (!skipAuth && !user) {
      return NextResponse.json({ error: "请先登录。" }, { status: 401 });
    }

    const payload = (await request.json()) as GlobalRules & { guidanceHistory?: unknown };
    const current = await loadGlobalRules();

    function normalizeGuidance(raw: unknown): GuidanceTurn[] {
      if (!Array.isArray(raw)) {
        return [];
      }
      return raw
        .filter((t): t is GuidanceTurn => {
          if (!t || typeof t !== "object") return false;
          const g = t as Record<string, unknown>;
          return (
            (g.role === "user" || g.role === "assistant") &&
            typeof g.content === "string" &&
            typeof g.ts === "string"
          );
        })
        .map((t) => ({
          role: t.role,
          content: t.content.slice(0, 16000),
          ts: t.ts,
        }));
    }

    const nextGuidance = Object.prototype.hasOwnProperty.call(payload, "guidanceHistory")
      ? normalizeGuidance(payload.guidanceHistory)
      : current.guidanceHistory;

    const nextAgentThread = Object.prototype.hasOwnProperty.call(payload, "agentThread")
      ? normalizeAgentThread(payload.agentThread)
      : current.agentThread;

    const rulesToSave: GlobalRules = {
      instructions: typeof payload.instructions === "string" ? payload.instructions : current.instructions,
      documents: Array.isArray(payload.documents)
        ? payload.documents.map((doc) => ({
            name: typeof doc.name === "string" ? doc.name : "Unnamed Document",
            content: typeof doc.content === "string" ? doc.content : "",
          }))
        : current.documents,
    };

    if (nextGuidance !== undefined) {
      rulesToSave.guidanceHistory = nextGuidance;
    }

    if (nextAgentThread !== undefined) {
      rulesToSave.agentThread = nextAgentThread;
    }

    if (Object.prototype.hasOwnProperty.call(payload, "workingRules")) {
      rulesToSave.workingRules =
        typeof payload.workingRules === "string" ? payload.workingRules.slice(0, 50000) : "";
    } else if (current.workingRules !== undefined) {
      rulesToSave.workingRules = current.workingRules;
    }

    if (Array.isArray(payload.tableFields)) {
      rulesToSave.tableFields = payload.tableFields;
    } else if (current.tableFields !== undefined) {
      rulesToSave.tableFields = current.tableFields;
    }

    await saveGlobalRules(rulesToSave);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save global rules." },
      { status: 500 }
    );
  }
}
