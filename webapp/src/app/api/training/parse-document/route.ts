import { NextResponse } from "next/server";

import { getAuthUserOrSkip } from "@/lib/auth-server";

export const runtime = "nodejs";

const MAX_BYTES = 12 * 1024 * 1024;

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

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
    const ext = extOf(file.name);

    let text = "";

    if (ext === ".pdf") {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: buf });
      try {
        const result = await parser.getText();
        text = result.text || "";
      } finally {
        await parser.destroy();
      }
    } else if (ext === ".docx") {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer: buf });
      text = result.value || "";
    } else if (ext === ".doc") {
      const WordExtractor = (await import("word-extractor")).default;
      const extractor = new WordExtractor();
      const doc = await extractor.extract(buf);
      text = doc.getBody() || "";
    } else {
      return NextResponse.json({ error: "服务端仅解析 PDF、DOC、DOCX；纯文本请在本页直接上传。" }, { status: 400 });
    }

    const trimmed = text.replace(/\u0000/g, "").trim();
    if (!trimmed) {
      return NextResponse.json({
        text: "",
        warning:
          "未能提取到可读文本：可能是扫描版 PDF（需 OCR）、加密文件或空文档。可尝试导出为可复制文本的 PDF / 另存为 .docx。",
      });
    }

    return NextResponse.json({ text: trimmed });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "文档解析失败。" },
      { status: 500 },
    );
  }
}
