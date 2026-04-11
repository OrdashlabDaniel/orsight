"use client";

const pdfWorkerUrl = new URL("pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url).toString();

export const SUPPORTED_VISUAL_UPLOAD_ACCEPT =
  ".png,.jpg,.jpeg,.webp,.pdf,image/png,image/jpeg,image/webp,application/pdf";

export const SUPPORTED_VISUAL_UPLOAD_HELPER = "支持 PNG / JPG / JPEG / WEBP / PDF。";

/** 工作台识别：在视觉类之外另支持电子表格与文档（服务端解析正文后走文本识别）。 */
export const SUPPORTED_WORKSPACE_DOCUMENT_ACCEPT =
  ".xlsx,.xls,.csv,.doc,.docx,.txt,.md,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain";

export const SUPPORTED_WORKSPACE_UPLOAD_ACCEPT = `${SUPPORTED_VISUAL_UPLOAD_ACCEPT},${SUPPORTED_WORKSPACE_DOCUMENT_ACCEPT}`;

export const SUPPORTED_WORKSPACE_UPLOAD_HELPER =
  "支持图片 / PDF，以及 Excel（.xlsx / .xls）、CSV、Word（.doc / .docx）、纯文本与 Markdown。";

/** 新建填表 · 模板导入对话框（Excel / 截图 / PDF / Word / 文本等） */
export const TEMPLATE_IMPORT_ACCEPT = `${SUPPORTED_VISUAL_UPLOAD_ACCEPT},.xlsx,.xls,.csv,.doc,.docx,.txt,.md,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain`;

export const TEMPLATE_IMPORT_HELPER =
  "Excel / CSV、截图或 PDF、Word、纯文本或 Markdown；系统将自动选择导入方式。";

const DOCUMENT_EXT = /\.(xlsx|xls|csv|doc|docx|txt|md)$/i;

export function isWorkspaceDocumentFile(file: File): boolean {
  return DOCUMENT_EXT.test(file.name);
}

function documentPlaceholderDataUrl(fileName: string): string {
  const short = fileName.replace(/[<>&"]/g, "").slice(0, 48) || "document";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240">
  <rect width="240" height="240" fill="#f8fafc"/>
  <rect x="36" y="48" width="168" height="144" rx="8" fill="#fff" stroke="#cbd5e1" stroke-width="2"/>
  <path d="M56 78h128M56 98h96M56 118h128M56 138h72" stroke="#94a3b8" stroke-width="3" stroke-linecap="round"/>
  <text x="120" y="210" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" fill="#64748b">${short}</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export type PreparedVisualUpload = {
  file: File;
  previewUrl: string;
};

type PdfJsModule = {
  GlobalWorkerOptions: {
    workerSrc: string;
  };
  getDocument: (src: { data: Uint8Array }) => {
    promise: Promise<{
      getPage: (pageNumber: number) => Promise<{
        getViewport: (args: { scale: number }) => { width: number; height: number };
        render: (args: {
          canvasContext: CanvasRenderingContext2D;
          viewport: { width: number; height: number };
        }) => { promise: Promise<void> };
      }>;
      destroy?: () => Promise<void> | void;
    }>;
    destroy?: () => Promise<void> | void;
  };
};

let pdfJsPromise: Promise<PdfJsModule> | null = null;

function isPdfMimeType(value: string | undefined | null) {
  return (value || "").toLowerCase().includes("pdf");
}

function isPdfFileName(value: string | undefined | null) {
  return (value || "").toLowerCase().endsWith(".pdf");
}

function isPdfBlob(blob: Blob, fileName?: string) {
  return isPdfMimeType(blob.type) || isPdfFileName(fileName);
}

function isPdfSource(value: string) {
  const lower = value.trim().toLowerCase();
  return lower.startsWith("data:application/pdf") || lower.endsWith(".pdf");
}

function replaceFileExtension(fileName: string, nextExtension: string) {
  const baseName = fileName.replace(/\.[^.]+$/, "") || fileName;
  return `${baseName}${nextExtension.startsWith(".") ? nextExtension : `.${nextExtension}`}`;
}

async function blobToDataUrl(blob: Blob) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("文件读取失败。"));
    reader.readAsDataURL(blob);
  });
}

async function getPdfJs() {
  if (!pdfJsPromise) {
    pdfJsPromise = import("pdfjs-dist/legacy/build/pdf.mjs").then((module) => {
      const pdfJs = module as unknown as PdfJsModule;
      if (!pdfJs.GlobalWorkerOptions.workerSrc) {
        pdfJs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      }
      return pdfJs;
    });
  }
  return await pdfJsPromise;
}

async function renderPdfBlobToPngBlob(blob: Blob) {
  const pdfJs = await getPdfJs();
  const data = new Uint8Array(await blob.arrayBuffer());
  const task = pdfJs.getDocument({ data });
  const pdf = await task.promise;

  try {
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("无法创建 PDF 预览画布。");
    }

    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    await page.render({ canvasContext: context, viewport }).promise;

    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => {
        if (value) {
          resolve(value);
        } else {
          reject(new Error("PDF 页面转图片失败。"));
        }
      }, "image/png");
    });

    canvas.width = 0;
    canvas.height = 0;
    return pngBlob;
  } finally {
    await pdf.destroy?.();
    await task.destroy?.();
  }
}

async function cloneImageFile(file: File) {
  const buffer = await file.arrayBuffer();
  const clonedFile = new File([buffer], file.name, {
    type: file.type,
    lastModified: file.lastModified,
  });
  return {
    file: clonedFile,
    previewUrl: URL.createObjectURL(clonedFile),
  };
}

export async function prepareVisualUpload(file: File): Promise<PreparedVisualUpload> {
  if (!isPdfBlob(file, file.name)) {
    return await cloneImageFile(file);
  }

  const pngBlob = await renderPdfBlobToPngBlob(file);
  const renderedFile = new File([pngBlob], replaceFileExtension(file.name, ".png"), {
    type: "image/png",
    lastModified: file.lastModified,
  });
  return {
    file: renderedFile,
    previewUrl: URL.createObjectURL(pngBlob),
  };
}

/** 首页工作台：图片与 PDF 仍转可视预览；表格/文档保留原文件供服务端解析。 */
export async function prepareWorkspaceUpload(file: File): Promise<PreparedVisualUpload> {
  if (isWorkspaceDocumentFile(file)) {
    const buffer = await file.arrayBuffer();
    const cloned = new File([buffer], file.name, {
      type: file.type || "application/octet-stream",
      lastModified: file.lastModified,
    });
    return {
      file: cloned,
      previewUrl: documentPlaceholderDataUrl(file.name),
    };
  }
  return prepareVisualUpload(file);
}

export async function ensureImageDataUrlFromSource(source: string) {
  if (!source) {
    throw new Error("缺少可预览文件源。");
  }
  if (source.startsWith("data:image/")) {
    return source;
  }

  if (source.startsWith("data:application/pdf")) {
    const response = await fetch(source);
    const blob = await response.blob();
    const pngBlob = await renderPdfBlobToPngBlob(blob);
    return await blobToDataUrl(pngBlob);
  }

  const response = await fetch(source);
  const blob = await response.blob();
  if (isPdfBlob(blob) || isPdfSource(source)) {
    const pngBlob = await renderPdfBlobToPngBlob(blob);
    return await blobToDataUrl(pngBlob);
  }
  return await blobToDataUrl(blob);
}
