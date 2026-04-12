import {
  getDefaultFieldDefinition,
  isBuiltInFieldId,
  type TableFieldDefinition,
} from "@/lib/table-fields";

/** English column titles for default built-in template (storage keeps Chinese labels). */
const BUILT_IN_LABEL_EN: Record<string, string> = {
  date: "Date",
  route: "Spot-check route",
  driver: "Spot-check driver",
  taskCode: "Task code",
  total: "Waybill count",
  unscanned: "Unreceived count",
  exceptions: "Exception count",
  waybillStatus: "Response update status",
  stationTeam: "Station / fleet",
};

/**
 * Show English labels in English UI for built-in columns that still use the default Chinese titles.
 * Renamed columns (any label ≠ default for that id) are shown as stored.
 */
export function getLocalizedTableFieldLabel(field: TableFieldDefinition, locale: string): string {
  if (locale !== "en" || !field.builtIn || !isBuiltInFieldId(field.id)) {
    return field.label;
  }
  const canonicalZh = getDefaultFieldDefinition(field.id)?.label;
  if (canonicalZh != null && field.label !== canonicalZh) {
    return field.label;
  }
  return BUILT_IN_LABEL_EN[field.id] ?? field.label;
}
