import { NextResponse } from "next/server";

import { getAuthUserOrSkip } from "@/lib/auth-server";
import { getTrainingImageDataUrl } from "@/lib/training";

export async function GET(request: Request) {
  const { user, skipAuth } = await getAuthUserOrSkip();
  if (!skipAuth && !user) {
    return NextResponse.json({ error: "请先登录。" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const imageName = searchParams.get("imageName");
  const raw = searchParams.get("raw") === "1";

  if (!imageName) {
    return NextResponse.json({ error: "Missing imageName." }, { status: 400 });
  }

  const dataUrl = await getTrainingImageDataUrl(imageName);
  if (!dataUrl) {
    return NextResponse.json({ error: "Training image not found." }, { status: 404 });
  }

  if (raw) {
    const matched = dataUrl.match(/^data:(.+);base64,(.+)$/);
    if (!matched) {
      return NextResponse.json({ error: "Training image decode failed." }, { status: 500 });
    }

    const mimeType = matched[1] || "image/jpeg";
    const buffer = Buffer.from(matched[2] || "", "base64");
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": mimeType,
        "Cache-Control": "private, max-age=300",
      },
    });
  }

  return NextResponse.json({ imageName, dataUrl });
}
