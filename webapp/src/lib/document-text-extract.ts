import * as XLSX from "@e965/xlsx";

const MAX_OUTPUT_CHARS = 200_000;

export type SpreadsheetTable = {
  sheetName: string;
  rows: string[][];
};

export function documentFileExtensionLower(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

function trimTrailingEmptyCells(row: string[]) {
  let end = row.length;
  while (end > 0 && !row[end - 1]?.trim()) {
    end -= 1;
  }
  return row.slice(0, end);
}

function cellToText(value: unknown): string {
  if (value == null) {
    return "";
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  }
  return String(value).replace(/\u0000/g, "").trim();
}

function repairSheetRange(sheet: XLSX.WorkSheet) {
  if (!sheet["!ref"]) {
    return;
  }

  const keys = Object.keys(sheet).filter((key) => !key.startsWith("!"));
  if (keys.length === 0) {
    return;
  }

  const range = XLSX.utils.decode_range(sheet["!ref"]);
  let changed = false;
  for (const key of keys) {
    const cell = XLSX.utils.decode_cell(key);
    if (cell.r > range.e.r) {
      range.e.r = cell.r;
      changed = true;
    }
    if (cell.c > range.e.c) {
      range.e.c = cell.c;
      changed = true;
    }
  }

  if (changed) {
    sheet["!ref"] = XLSX.utils.encode_range(range);
  }
}

export function extractSpreadsheetTables(buffer: Buffer, fileName: string): SpreadsheetTable[] {
  const ext = documentFileExtensionLower(fileName);
  if (ext !== ".xlsx" && ext !== ".xls" && ext !== ".csv") {
    return [];
  }

  const workbook =
    ext === ".csv"
      ? XLSX.read(buffer.toString("utf8"), { type: "string", raw: false, cellDates: true })
      : XLSX.read(buffer, { type: "buffer", raw: false, cellDates: true });

  const tables: SpreadsheetTable[] = [];
  for (const sheetName of workbook.SheetNames.slice(0, 10)) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      continue;
    }

    repairSheetRange(sheet);

    const rawRows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      blankrows: false,
      defval: "",
      raw: false,
    }) as unknown[][];
    const rows = rawRows
      .map((row) => trimTrailingEmptyCells(row.map(cellToText)))
      .filter((row) => row.some((cell) => cell.trim()));

    if (rows.length > 0) {
      tables.push({ sheetName, rows });
    }
  }

  return tables;
}

/** 服务端可从缓冲解析为纯文本的填表数据来源（与 parse-document / extract 共用）。 */
export function estimateSpreadsheetDataRowCount(tables: SpreadsheetTable[]) {
  return tables.reduce((total, table) => {
    const nonEmptyRows = table.rows.filter((row) => row.some((cell) => cell.trim()));
    if (nonEmptyRows.length <= 1) {
      return total + nonEmptyRows.length;
    }
    return total + Math.max(0, nonEmptyRows.length - 1);
  }, 0);
}

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
  } else if (ext === ".xlsx" || ext === ".xls" || ext === ".csv") {
    const parts = extractSpreadsheetTables(buffer, fileName).map(
      (table) => `### ${table.sheetName}\n${table.rows.map((row) => row.join("\t")).join("\n")}`,
    );
    text = parts.join("\n\n");
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
