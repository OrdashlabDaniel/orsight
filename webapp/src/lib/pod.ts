export type PodRecord = {
  id: string;
  imageName: string;
  date: string;
  route: string;
  driver: string;
  total: number | "";
  unscanned: number | "";
  exceptions: number | "";
  waybillStatus?: string;
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
  "响应更新状态",
];

export const visionPrompt = `你是 OrSight，负责从各种截图（如 POD 签退设备屏幕、系统网页表格等）中读取结构化信息。请严格按照下面规则读取单张截图，并只返回 JSON。

核心原则：
1. 动态学习映射：你需要根据提供的【全局提取规则与用户指示】和【历史标注示例】来学习每个字段在不同类型图片上的对应位置和标签名。
2. 绝不猜测：如果图片上的信息不符合任何已知示例或全局规则的模式，或者你找不到明确对应的标签，绝对不要去猜。宁可填 null/空，并将 reviewRequired 设为 true。
3. 只要有任何不确定，就把 reviewRequired 设为 true，并写明 reviewReason。

通用规则（除非全局规则或示例另有说明）：
1. 日期：提取日期，格式统一为 M/D/YYYY（例如 3/23/2026）。对于网页表格，通常在“派送日期”列。
2. 运单数量：提取后，必须在 totalSourceLabel 中记录你提取该数字时所依据的原文标签（例如“应领件数”、“运单数量”等，这两个都是合法的）。如果该标签不属于训练示例或全局规则中明确指示的合法来源，把 total 设为 null，totalSourceLabel 设为空，并开启复核。
3. 站点车队：注意区分站点车队与抽查路线，不要混淆。
4. 抽查路线 (route) 与「区域」类列：网页/系统表格里若同时存在「线路区域名称」「区域」等粗粒度列（如 IAH01-160、IAH01-211）与「快递员路线」「配送路线」等细粒度列（如 IAH01-160-A、IAH01-211-D），**必须**从细粒度列读取 route；**每一行只使用该行的快递员路线**，禁止把首行或屏幕上最先出现的区域名套用到其它行。仅当截图中确实没有快递员路线列时，才可用区域列作为 route，并设 reviewRequired 说明依据。
5. 绝对不能把“已领”、“司机领取量”、“实领件数”等明显代表已完成的数字当成“运单数量”。
6. 若存在多行数据（例如网页表格、手写表格），请提取**所有**清晰可见的行，将每一行作为一个独立的记录放入 records 数组中。
7. 响应更新状态 (waybillStatus) 的逻辑：如果未收数量为 0，则状态为 "全领取"；如果未收数量大于 0，则状态为 "待更新"。绝对不要使用 "正常" 等其他词汇。
8. 错扫数量 (exceptions)：如果表格中没有明确的错扫数量列，请填 null。

返回格式：
{
  "imageType": "POD", // 如果是手持设备拍照/截图则填 "POD"，如果是电脑网页/表格截图则填 "WEB_TABLE"，其他填 "OTHER"
  "records": [
    {
      "date": "3/14/2026",
      "route": "IAH01-201-M",
      "driver": "Leonardo Mesa",
      "total": 84,
      "totalSourceLabel": "应领件数",
      "unscanned": 1,
      "exceptions": null,
      "waybillStatus": "待更新",
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

  const numericFields: Array<[keyof PodRecord, string, boolean]> = [
    ["total", "运单数量", true],
    ["unscanned", "未收数量", true],
    ["exceptions", "错扫数量", false], // 错扫数量可以为空
  ];

  for (const [field, label, required] of numericFields) {
    const value = record[field];
    if (value === "" && !required) {
      continue;
    }
    if (value !== "" && (typeof value !== "number" || value < 0)) {
      issues.push({
        imageName: record.imageName,
        route: record.route,
        message: `${label} 不是有效数字。`,
        level: "error",
      });
    }
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
    records.waybillStatus || "",
  ];
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

function mergeDuplicateRecordGroup(group: PodRecord[]): PodRecord {
  const base = { ...group[0]! };
  for (let i = 1; i < group.length; i++) {
    const next = group[i]!;
    base.imageName = mergeTextList(base.imageName, next.imageName, " | ");
    base.reviewRequired = Boolean(base.reviewRequired || next.reviewRequired);
    base.reviewReason = mergeTextList(base.reviewReason || "", next.reviewReason || "", " | ") || null;
    base.stationTeam = base.stationTeam || next.stationTeam;
    base.waybillStatus = base.waybillStatus || next.waybillStatus;
  }
  return base;
}

export function organizeRecords(records: PodRecord[]): OrganizedRecordsResult {
  const keyWithoutImage = (record: PodRecord) =>
    JSON.stringify({
      date: record.date,
      route: record.route,
      driver: record.driver,
      total: record.total,
      unscanned: record.unscanned,
      exceptions: record.exceptions,
      waybillStatus: record.waybillStatus,
      totalSourceLabel: record.totalSourceLabel || "",
      stationTeam: record.stationTeam || "",
    });

  const byBizKey = new Map<string, PodRecord[]>();
  for (const record of records) {
    const k = keyWithoutImage(record);
    const list = byBizKey.get(k) ?? [];
    list.push(record);
    byBizKey.set(k, list);
  }

  const flattened: PodRecord[] = [];
  let duplicateCount = 0;

  for (const [, group] of byBizKey) {
    const uniqueSourceNames = new Set(group.map((r) => r.imageName));
    if (uniqueSourceNames.size <= 1) {
      flattened.push(...group);
      continue;
    }
    const merged = mergeDuplicateRecordGroup(group);
    duplicateCount += group.length - 1;
    flattened.push(merged);
  }

  const sortedRecords = flattened.sort((left, right) => {
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
