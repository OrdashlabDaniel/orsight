import { NextResponse } from "next/server";
import sharp from "sharp";

import { getAuthUserOrSkip } from "@/lib/auth-server";
import { getFormIdFromRequest } from "@/lib/form-request";
import { deleteTrainingPoolImage, getTrainingImageBinary, getTrainingImageDataUrl } from "@/lib/training";

export async function GET(request: Request) {
  const { user, skipAuth } = await getAuthUserOrSkip();
  if (!skipAuth && !user) {
    return NextResponse.json({ error: "请先登录。" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const imageName = searchParams.get("imageName");
  const raw = searchParams.get("raw") === "1";
  const thumbnail = searchParams.get("thumbnail") === "1";
  const formId = getFormIdFromRequest(request);

  if (!imageName) {
    return NextResponse.json({ error: "Missing imageName." }, { status: 400 });
  }

  if (raw) {
    const imageBinary = await getTrainingImageBinary(imageName, formId);
    if (!imageBinary) {
      return NextResponse.json({ error: "Training image not found." }, { status: 404 });
    }

    let buffer = imageBinary.buffer;
    let mimeType = imageBinary.mimeType || "image/jpeg";

    if (thumbnail && mimeType.startsWith("image/")) {
      try {
        buffer = await sharp(buffer)
          .resize({ width: 720, height: 720, fit: "inside", withoutEnlargement: true })
          .webp({ quality: 82 })
          .toBuffer();
        mimeType = "image/webp";
      } catch (error) {
        console.error("Failed to create training thumbnail:", error);
      }
    }

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": mimeType,
        "Cache-Control": "private, max-age=600, stale-while-revalidate=300",
      },
    });
  }

  const dataUrl = await getTrainingImageDataUrl(imageName, formId);
  if (!dataUrl) {
    return NextResponse.json({ error: "Training image not found." }, { status: 404 });
  }

  return NextResponse.json({ imageName, dataUrl });
}

export async function DELETE(request: Request) {
  try {
    const { user, skipAuth } = await getAuthUserOrSkip();
    if (!skipAuth && !user) {
      return NextResponse.json({ error: "请先登录。" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const imageName = searchParams.get("imageName");
    const formId = getFormIdFromRequest(request);

    if (!imageName) {
      return NextResponse.json({ error: "Missing imageName." }, { status: 400 });
    }

    await deleteTrainingPoolImage(imageName, formId);
    return NextResponse.json({ ok: true, imageName });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to delete training image.",
      },
      { status: 500 },
    );
  }
}
