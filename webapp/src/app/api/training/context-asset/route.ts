import { NextResponse } from "next/server";

import { getAuthUserOrSkip } from "@/lib/auth-server";
import { getFormIdFromFormData } from "@/lib/form-request";
import { saveAgentContextImageDataUrl } from "@/lib/training";

function extensionFromMime(mime: string) {
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  return "jpg";
}

export async function POST(request: Request) {
  try {
    const { user, skipAuth } = await getAuthUserOrSkip();
    if (!skipAuth && !user) {
      return NextResponse.json({ error: "请先登录。" }, { status: 401 });
    }

    const formData = await request.formData();
    const formId = getFormIdFromFormData(formData);
    const file = formData.get("file");
    if (!(file instanceof File) || file.size < 1) {
      return NextResponse.json({ error: "请上传有效的图片文件。" }, { status: 400 });
    }

    const mime = file.type || "image/jpeg";
    if (!mime.startsWith("image/")) {
      return NextResponse.json({ error: "仅支持图片。" }, { status: 400 });
    }

    const maxBytes = 12 * 1024 * 1024;
    if (file.size > maxBytes) {
      return NextResponse.json({ error: "图片过大（最大 12MB）。" }, { status: 400 });
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
    const ext = extensionFromMime(mime);
    const imageName = `ctx-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;

    await saveAgentContextImageDataUrl(imageName, dataUrl, formId);

    return NextResponse.json({
      ok: true,
      imageName,
      originalName: file.name || imageName,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "上传失败。" },
      { status: 500 },
    );
  }
}
