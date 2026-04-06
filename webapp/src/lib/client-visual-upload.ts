"use client";

const pdfWorkerUrl = new URL("pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url).toString();

export const SUPPORTED_VISUAL_UPLOAD_ACCEPT =
  ".png,.jpg,.jpeg,.webp,.pdf,image/png,image/jpeg,image/webp,application/pdf";

export const SUPPORTED_VISUAL_UPLOAD_HELPER = "支持 PNG / JPG / JPEG / WEBP / PDF。";

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
