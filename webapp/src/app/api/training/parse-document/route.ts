import { NextResponse } from "next/server";

import { getAuthUserOrSkip } from "@/lib/auth-server";
import { extractDocumentPlainText, documentFileExtensionLower } from "@/lib/document-text-extract";

export const runtime = "nodejs";

const MAX_BYTES = 12 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const { user, skipAuth } = await getAuthUserOrSkip();
    if (!skipAuth && !user) {
      return NextResponse.json({ error: "请先登录。" }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "缺少文件。" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "文件过大（最大 12MB）。" }, { status: 400 });
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const ext = documentFileExtensionLower(file.name);

    if (!ext) {
      return NextResponse.json({ error: "无法识别文件扩展名。" }, { status: 400 });
    }

    try {
      const { text, warning } = await extractDocumentPlainText(buf, file.name);
      if (!text.trim()) {
        return NextResponse.json({
          text: "",
          warning: warning || "未能提取到可读文本。",
        });
      }
      return NextResponse.json({ text, warning });
    } catch (error) {
      const message = error instanceof Error ? error.message : "文档解析失败。";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "文档解析失败。" },
      { status: 500 },
    );
  }
}
