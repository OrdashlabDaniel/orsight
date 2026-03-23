import { NextResponse } from "next/server";

import { getAuthUserOrSkip } from "@/lib/auth-server";
import { loadGlobalRules, saveGlobalRules, type GlobalRules } from "@/lib/training";

export async function GET() {
  try {
    const { user, skipAuth } = await getAuthUserOrSkip();
    if (!skipAuth && !user) {
      return NextResponse.json({ error: "请先登录。" }, { status: 401 });
    }

    const rules = await loadGlobalRules();
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

    const payload = (await request.json()) as GlobalRules;
    
    // Basic validation
    const rulesToSave: GlobalRules = {
      instructions: typeof payload.instructions === "string" ? payload.instructions : "",
      documents: Array.isArray(payload.documents) 
        ? payload.documents.map(doc => ({
            name: typeof doc.name === "string" ? doc.name : "Unnamed Document",
            content: typeof doc.content === "string" ? doc.content : ""
          }))
        : []
    };

    await saveGlobalRules(rulesToSave);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save global rules." },
      { status: 500 }
    );
  }
}
