export type PodRecord = {
  id: string;
  imageName: string;
  date: string;
  route: string;
  driver: string;
  total: number | "";
  unscanned: number | "";
  exceptions: number | "";
  stationTeam?: string;
  totalSourceLabel?: string;
  reviewRequired?: boolean;
  reviewReason?: string | null;
};

export type ExtractionIssue = {
  imageName: string;
  route?: string;
  message: string;
  level: "warning" | "error";
  code?: string;
};

export type ExtractionResponse = {
  records: PodRecord[];
  issues: ExtractionIssue[];
  modelUsed?: string;
  mode?: "primary" | "review" | string;
  trainingExamplesLoaded?: number;
};

export type OrganizedRecordsResult = {
  records: PodRecord[];
  duplicateCount: number;
};

export const excelHeaders = [
  "日期",
  "抽查路线",
  "抽查司机",
  "运单数量",
  "未收数量",
  "错扫数量",
  "晚间更新状态",
  "单号",
];

export const visionPrompt = `你是 OrSight，负责从站点 POD 签退/抽查截图中读取结构化信息。请严格按照下面规则读取单张截图，并只返回 JSON。

规则：
1. 日期：从 签到时间/签退时间 中提取日期，格式统一为 M/D/YYYY。
2. 抽查司机：顶部左侧司机姓名。
3. 抽查路线：任务区域中、位于 实领件数 下方的路线号，例如 IAH01-201-M。
4. 运单数量：只能取 应领件数 右侧的数字，并且必须返回 totalSourceLabel="应领件数"。
5. 未收数量：只能取 未领取 下方数字。
6. 错扫数量：只能取 错分数量。
7. 顶部右侧站点车队（例如 IAH-TSL / IAH-MEL / IAH-FHL）绝对不能写入抽查路线。
8. 绝对不能把 已领、司机领取量、实领件数 当成 运单数量。
9. 如果看不清 应领件数 的标签或数字，就不要猜；把 total 设为 null，并把 totalSourceLabel 设为空，并把 reviewRequired 设为 true。
10. 若存在 任务列表(2) 或更多，只提取截图中完整清晰显示的任务。不能用差值推断未完整显示的任务。
11. 只要有任何不确定，就把 reviewRequired 设为 true，并写明 reviewReason。

返回格式：
{
  "records": [
    {
      "date": "3/14/2026",
      "route": "IAH01-201-M",
      "driver": "Leonardo Mesa",
      "total": 84,
      "totalSourceLabel": "应领件数",
      "unscanned": 1,
      "exceptions": 1,
      "stationTeam": "IAH-TSL",
      "reviewRequired": false,
      "reviewReason": null
    }
  ]
}

不要输出 Markdown，不要输出解释，不要猜。`;

const routePattern = /^IAH\d{2}-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)?$/;
const stationTeamPattern = /^IAH-[A-Za-z]+$/;

export function normalizeText(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

export function normalizeNumber(value: unknown): number | "" {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return "";
}

export function validateRecord(record: PodRecord): ExtractionIssue[] {
  const issues: ExtractionIssue[] = [];

  if (!record.date) {
    issues.push({
      imageName: record.imageName,
      route: record.route,
      message: "缺少日期。",
      level: "error",
    });
  }

  if (!record.route) {
    issues.push({
      imageName: record.imageName,
      route: record.route,
      message: "缺少抽查路线。",
      level: "error",
    });
  } else if (!routePattern.test(record.route)) {
    issues.push({
      imageName: record.imageName,
      route: record.route,
      message: "路线格式异常，可能误用了站点车队字段。",
      level: "error",
    });
  }

  if (record.stationTeam && record.route === record.stationTeam) {
    issues.push({
      imageName: record.imageName,
      route: record.route,
      message: "抽查路线与站点车队相同，字段映射明显错误。",
      level: "error",
    });
  }

  if (record.stationTeam && !stationTeamPattern.test(record.stationTeam)) {
    issues.push({
      imageName: record.imageName,
      route: record.route,
      message: "站点车队字段格式异常，请人工确认。",
      level: "warning",
    });
  }

  if (!record.driver) {
    issues.push({
      imageName: record.imageName,
      route: record.route,
      message: "缺少司机姓名。",
      level: "error",
    });
  }

  const numericFields: Array<[keyof PodRecord, string]> = [
    ["total", "运单数量"],
    ["unscanned", "未收数量"],
    ["exceptions", "错扫数量"],
  ];

  for (const [field, label] of numericFields) {
    const value = record[field];
    if (typeof value !== "number" || value < 0) {
      issues.push({
        imageName: record.imageName,
        route: record.route,
        message: `${label} 不是有效数字。`,
        level: "error",
      });
    }
  }

  if (record.total !== "" && record.totalSourceLabel && record.totalSourceLabel !== "应领件数") {
    issues.push({
      imageName: record.imageName,
      route: record.route,
      message: `运单数量来源错误，当前来源是“${record.totalSourceLabel}”，必须来自“应领件数”。`,
      level: "error",
      code: "total_source_mismatch",
    });
  }

  if (record.total !== "" && !record.totalSourceLabel) {
    issues.push({
      imageName: record.imageName,
      route: record.route,
      message: "运单数量有值，但没有提供明确来源标签，必须人工复核。",
      level: "error",
      code: "total_source_missing",
    });
  }

  if (record.reviewRequired) {
    issues.push({
      imageName: record.imageName,
      route: record.route,
      message: record.reviewReason || "该记录需要人工复核。",
      level: "warning",
    });
  }

  return issues;
}

export function toExcelRows(records: PodRecord) {
  return [
    records.date,
    records.route,
    records.driver,
    records.total,
    records.unscanned,
    records.exceptions,
    "",
    "",
  ];
}

function businessKey(record: PodRecord): string {
  return JSON.stringify({
    date: record.date,
    route: record.route,
    driver: record.driver,
    total: record.total,
    unscanned: record.unscanned,
    exceptions: record.exceptions,
  });
}

function mergeTextList(currentValue: string, nextValue: string, separator: string): string {
  const values = new Set(
    [currentValue, nextValue]
      .flatMap((value) => value.split(separator))
      .map((value) => value.trim())
      .filter(Boolean),
  );
  return Array.from(values).join(separator);
}

export function organizeRecords(records: PodRecord[]): OrganizedRecordsResult {
  const mergedByKey = new Map<string, PodRecord>();
  let duplicateCount = 0;

  for (const record of records) {
    const key = businessKey(record);
    const existing = mergedByKey.get(key);

    if (!existing) {
      mergedByKey.set(key, { ...record });
      continue;
    }

    duplicateCount += 1;

    existing.imageName = mergeTextList(existing.imageName, record.imageName, " | ");
    existing.reviewRequired = Boolean(existing.reviewRequired || record.reviewRequired);
    existing.reviewReason = mergeTextList(existing.reviewReason || "", record.reviewReason || "", " | ") || null;
    existing.stationTeam = existing.stationTeam || record.stationTeam;
  }

  const sortedRecords = Array.from(mergedByKey.values()).sort((left, right) => {
    const routeCompare = left.route.localeCompare(right.route, "en");
    if (routeCompare !== 0) {
      return routeCompare;
    }

    const dateCompare = left.date.localeCompare(right.date, "en");
    if (dateCompare !== 0) {
      return dateCompare;
    }

    const driverCompare = left.driver.localeCompare(right.driver, "en");
    if (driverCompare !== 0) {
      return driverCompare;
    }

    return left.imageName.localeCompare(right.imageName, "en");
  });

  return {
    records: sortedRecords,
    duplicateCount,
  };
}
