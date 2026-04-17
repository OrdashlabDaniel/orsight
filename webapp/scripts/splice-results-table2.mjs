import fs from "fs";

const p = new URL("../src/app/(protected)/page.tsx", import.meta.url);
let s = fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");

const start = s.indexOf("            {visibleIssues.length ? (");
if (start < 0) throw new Error("visibleIssues block not found");

const tableDiv = s.indexOf('<div className="max-h-[min(70vh,880px)] min-h-0 flex-1 overflow-auto">', start);
if (tableDiv < 0) throw new Error("table wrapper not found");

const tableOpen = s.indexOf('<table className="min-w-full border-separate border-spacing-0 text-sm">', tableDiv);
const tableEnd = s.indexOf("              </table>", tableOpen) + "              </table>".length;
const afterTable = s.indexOf("            </div>", tableEnd) + "            </div>".length;

const tableBody = s.slice(tableOpen, tableEnd).replace(/^              /gm, "      ");
const renderFn =
  "  const renderResultsTable = () => (\n" +
  '    <div className="min-h-full bg-slate-50">\n' +
  tableBody +
  "\n    </div>\n  );\n\n";

const newBlock = `            {visibleIssues.length ? (
              <div
                ref={splitResultsRef}
                className="flex min-h-0 flex-1 flex-col overflow-hidden"
              >
                <div
                  className="flex min-h-0 shrink-0 flex-col border-b border-[var(--border)] bg-[var(--background)] px-4 pt-3"
                  style={{ height: remindersPanelHeightPx }}
                >
                  <div className="mb-1.5 shrink-0 text-xs font-medium text-[var(--muted-foreground)]">
                    {t("home.reminders")}
                  </div>
                  <div className="min-h-0 flex-1 space-y-1.5 overflow-auto pb-3 text-sm">
                    {visibleIssues.map((issue, index) => (
                      <div
                        key={\`\${issue.imageName}-\${issue.route || "none"}-\${index}\`}
                        className={\`rounded-md px-2 py-1.5 \${issue.level === "error" ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-900"}\`}
                      >
                        <span className="font-medium">{issue.imageName}</span>
                        {issue.route ? \` / \${issue.route}\` : ""}
                        {\`\uFF1A\${issue.message}\`}
                      </div>
                    ))}
                  </div>
                </div>
                <div
                  role="separator"
                  aria-orientation="horizontal"
                  aria-label={t("home.resizeRemindersPanel")}
                  className="relative z-10 h-3 w-full shrink-0 cursor-row-resize touch-none select-none"
                  onPointerDown={beginRemindersTableResize}
                >
                  <div className="pointer-events-none absolute inset-x-4 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-[var(--border)] group-hover:bg-blue-500" />
                </div>
                <div className="min-h-0 min-w-0 flex-1 overflow-auto bg-slate-50">{renderResultsTable()}</div>
              </div>
            ) : (
              <div className="min-h-0 min-w-0 flex-1 overflow-auto bg-slate-50">{renderResultsTable()}</div>
            )}
`;

if (s.includes("const renderResultsTable = () => (")) {
  throw new Error("renderResultsTable already exists");
}

const nLoc = '  const nLoc = locale === "en" ? "en-US" : "zh-CN";';
const i = s.indexOf(nLoc);
if (i < 0) throw new Error("nLoc not found");

s = s.slice(0, i) + renderFn + s.slice(i, start) + newBlock + s.slice(afterTable);
fs.writeFileSync(p, s);
console.log("ok");
