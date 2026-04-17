import fs from "fs";

const body = fs.readFileSync(new URL("./_report-body.html", import.meta.url), "utf8");
const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>Orsight 项目报告</title>
<style>
body { font-family: "Microsoft YaHei", "Noto Sans SC", SimHei, sans-serif; line-height: 1.55; max-width: 900px; margin: 0 auto; padding: 28px; color: #111; }
h1 { font-size: 22pt; margin-top: 0; }
h2 { font-size: 14pt; border-bottom: 1px solid #ccc; padding-bottom: 4px; margin-top: 22pt; page-break-after: avoid; }
h3 { font-size: 12pt; margin-top: 14pt; page-break-after: avoid; }
table { border-collapse: collapse; width: 100%; margin: 10pt 0; font-size: 10pt; }
th, td { border: 1px solid #bbb; padding: 6px 8px; vertical-align: top; }
th { background: #f3f4f6; }
code { font-family: Consolas, monospace; font-size: 9pt; background: #f6f8fa; padding: 1px 4px; border-radius: 3px; }
ul, ol { padding-left: 1.2em; }
hr { border: none; border-top: 1px solid #ddd; margin: 18pt 0; }
@page { size: A4; margin: 18mm; }
@media print { body { padding: 0; } }
</style>
</head>
<body>
${body}
</body>
</html>`;

fs.writeFileSync(new URL("./Orsight-Project-Report-2026-04.html", import.meta.url), html, "utf8");
