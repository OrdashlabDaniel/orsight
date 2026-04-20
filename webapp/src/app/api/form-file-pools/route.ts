import { NextResponse } from "next/server";

import { getFormIdFromFormData, getFormIdFromRequest } from "@/lib/form-request";
import {
  deleteFormFileFromPool,
  getFormFileFromPool,
  listFormFilePool,
  parseFormFilePoolName,
  saveFormFileToPool,
} from "@/lib/form-file-pools";
import { withAuthedStorageTenant } from "@/lib/storage-tenant";

const MAX_BYTES = 20 * 1024 * 1024;

function contentDisposition(fileName: string, inline: boolean) {
  return `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export async function GET(request: Request) {
  return withAuthedStorageTenant(async ({ user, skipAuth }) => {
    try {
      if (!skipAuth && !user) {
        return NextResponse.json({ error: "请先登录。" }, { status: 401 });
      }

      const { searchParams } = new URL(request.url);
      const pool = parseFormFilePoolName(searchParams.get("pool"));
      const fileId = searchParams.get("fileId");
      const raw = searchParams.get("raw") === "1";
      const formId = getFormIdFromRequest(request);

      if (fileId && raw) {
        const binary = await getFormFileFromPool(pool, fileId, formId);
        if (!binary) {
          return NextResponse.json({ error: "文件不存在。" }, { status: 404 });
        }
        const inline = /^image\/|application\/pdf|text\//i.test(binary.mimeType || "");
        return new NextResponse(new Uint8Array(binary.buffer), {
          headers: {
            "Content-Type": binary.mimeType || "application/octet-stream",
            "Content-Disposition": contentDisposition(binary.fileName, inline),
            "Cache-Control": "private, max-age=300, stale-while-revalidate=120",
          },
        });
      }

      const files = await listFormFilePool(pool, formId);
      return NextResponse.json({ ok: true, pool, files });
    } catch (error) {
      return NextResponse.json(
        {
          error: error instanceof Error ? error.message : "文件池读取失败。",
        },
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

      const formData = await request.formData();
      const pool = parseFormFilePoolName(typeof formData.get("pool") === "string" ? String(formData.get("pool")) : "");
      const formId = getFormIdFromFormData(formData);
      const source = typeof formData.get("source") === "string" ? String(formData.get("source")).trim() : "";
      const file = formData.get("file");
      if (!(file instanceof File) || file.size < 1) {
        return NextResponse.json({ error: "请上传有效文件。" }, { status: 400 });
      }
      if (file.size > MAX_BYTES) {
        return NextResponse.json({ error: "文件过大（最大 20MB）。" }, { status: 400 });
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const saved = await saveFormFileToPool(
        {
          pool,
          fileName: file.name || `upload-${Date.now()}`,
          mimeType: file.type || undefined,
          buffer,
          source: source || undefined,
        },
        formId,
      );

      return NextResponse.json({ ok: true, pool, file: saved });
    } catch (error) {
      return NextResponse.json(
        {
          error: error instanceof Error ? error.message : "文件池上传失败。",
        },
        { status: 500 },
      );
    }
  });
}

export async function DELETE(request: Request) {
  return withAuthedStorageTenant(async ({ user, skipAuth }) => {
    try {
      if (!skipAuth && !user) {
        return NextResponse.json({ error: "请先登录。" }, { status: 401 });
      }

      const { searchParams } = new URL(request.url);
      const pool = parseFormFilePoolName(searchParams.get("pool"));
      const fileId = searchParams.get("fileId");
      const formId = getFormIdFromRequest(request);
      if (!fileId) {
        return NextResponse.json({ error: "缺少 fileId。" }, { status: 400 });
      }

      const deleted = await deleteFormFileFromPool(pool, fileId, formId);
      if (!deleted) {
        return NextResponse.json({ error: "文件不存在。" }, { status: 404 });
      }

      return NextResponse.json({ ok: true, pool, fileId });
    } catch (error) {
      return NextResponse.json(
        {
          error: error instanceof Error ? error.message : "文件池删除失败。",
        },
        { status: 500 },
      );
    }
  });
}
