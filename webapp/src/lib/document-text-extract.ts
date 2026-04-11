import * as XLSX from "xlsx";

const MAX_OUTPUT_CHARS = 200_000;

export function documentFileExtensionLower(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

/** 服务端可从缓冲解析为纯文本的填表数据来源（与 parse-document / extract 共用）。 */
export async function extractDocumentPlainText(
  buffer: Buffer,
  fileName: string,
): Promise<{ text: string; warning?: string }> {
  const ext = documentFileExtensionLower(fileName);
  let text = "";

  if (ext === ".pdf") {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      text = result.text || "";
    } finally {
      await parser.destroy();
    }
  } else if (ext === ".docx") {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    text = result.value || "";
  } else if (ext === ".doc") {
    const WordExtractor = (await import("word-extractor")).default;
    const extractor = new WordExtractor();
    const doc = await extractor.extract(buffer);
    text = doc.getBody() || "";
  } else if (ext === ".xlsx" || ext === ".xls") {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const parts: string[] = [];
    for (const sheetName of workbook.SheetNames.slice(0, 10)) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) {
        continue;
      }
      const csv = XLSX.utils.sheet_to_csv(sheet, { FS: "\t", blankrows: false });
      parts.push(`### ${sheetName}\n${csv}`);
    }
    text = parts.join("\n\n");
  } else if (ext === ".csv") {
    text = buffer.toString("utf8");
  } else if (ext === ".txt" || ext === ".md") {
    text = buffer.toString("utf8");
  } else {
    throw new Error(`不支持的文档扩展名：${ext || "（无扩展名）"}`);
  }

  const trimmed = text.replace(/\u0000/g, "").trim();
  if (!trimmed) {
    return {
      text: "",
      warning:
        "未能提取到可读文本：可能是扫描版 PDF（需 OCR）、加密文件或空文档。可尝试导出为可复制文本的 PDF / 另存为 .docx。",
    };
  }

  const clipped = trimmed.length > MAX_OUTPUT_CHARS ? trimmed.slice(0, MAX_OUTPUT_CHARS) : trimmed;
  const warning =
    trimmed.length > MAX_OUTPUT_CHARS
      ? `正文较长，已截取前 ${MAX_OUTPUT_CHARS} 个字符用于识别。`
      : undefined;

  return { text: clipped, warning };
}

export function isStructuredDocumentFileName(fileName: string): boolean {
  const ext = documentFileExtensionLower(fileName);
  return [".pdf", ".doc", ".docx", ".xlsx", ".xls", ".csv", ".txt", ".md"].includes(ext);
}

export function guessDocumentImageType(fileName: string): "WEB_TABLE" | "OTHER" {
  const ext = documentFileExtensionLower(fileName);
  if (ext === ".xlsx" || ext === ".xls" || ext === ".csv") {
    return "WEB_TABLE";
  }
  return "OTHER";
}
