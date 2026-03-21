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

  if (!imageName) {
    return NextResponse.json({ error: "Missing imageName." }, { status: 400 });
  }

  const dataUrl = await getTrainingImageDataUrl(imageName);
  if (!dataUrl) {
    return NextResponse.json({ error: "Training image not found." }, { status: 404 });
  }

  return NextResponse.json({ imageName, dataUrl });
}
