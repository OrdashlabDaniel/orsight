import { NextResponse } from "next/server";

import { getFormIdFromRequest } from "@/lib/form-request";
import {
  loadGlobalRules,
  mergeLegacyIntoAgentThreadIfEmpty,
  normalizeAgentThread,
  saveGlobalRules,
  seedWorkingRulesFromLegacy,
  type GlobalRules,
} from "@/lib/training";
import { withAuthedStorageTenant } from "@/lib/storage-tenant";

function buildEditableRecognitionRulesPayload(rules: GlobalRules) {
  return {
    workingRules: typeof rules.workingRules === "string" ? rules.workingRules : "",
    agentThread: Array.isArray(rules.agentThread) ? normalizeAgentThread(rules.agentThread) : [],
  };
}

export async function GET(request: Request) {
  return withAuthedStorageTenant(async ({ user, skipAuth }) => {
    try {
      if (!skipAuth && !user) {
        return NextResponse.json({ error: "请先登录。" }, { status: 401 });
      }

      const formId = getFormIdFromRequest(request);
      const rules = seedWorkingRulesFromLegacy(mergeLegacyIntoAgentThreadIfEmpty(await loadGlobalRules(formId)));
      return NextResponse.json(buildEditableRecognitionRulesPayload(rules));
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Failed to load recognition rules." },
        { status: 500 },
      );
    }
  });
}

export async function POST(request: Request) {
  return withAuthedStorageTenant(async ({ user, skipAuth }) => {
    try {
      if (!skipAuth && !user) {
        return NextResponse.json({ error: "请先登录。" }, { status: 401 });
      }

      const formId = getFormIdFromRequest(request);
      const payload = (await request.json()) as Partial<GlobalRules>;
      const current = await loadGlobalRules(formId);

      const rulesToSave: GlobalRules = {
        instructions: current.instructions,
        documents: Array.isArray(current.documents) ? current.documents.map((doc) => ({ ...doc })) : [],
        guidanceHistory: Array.isArray(current.guidanceHistory) ? [...current.guidanceHistory] : [],
        tableFields: Array.isArray(current.tableFields) ? [...current.tableFields] : current.tableFields,
        workingRules: Object.prototype.hasOwnProperty.call(payload, "workingRules")
          ? typeof payload.workingRules === "string"
            ? payload.workingRules.slice(0, 50000)
            : ""
          : current.workingRules,
        agentThread: Object.prototype.hasOwnProperty.call(payload, "agentThread")
          ? normalizeAgentThread(payload.agentThread)
          : current.agentThread,
      };

      await saveGlobalRules(rulesToSave, formId);
      return NextResponse.json({ ok: true, ...buildEditableRecognitionRulesPayload(rulesToSave) });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Failed to save recognition rules." },
        { status: 500 },
      );
    }
  });
}
