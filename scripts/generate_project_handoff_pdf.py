"""
Generate a detailed Chinese PDF handoff report for the OrSight repository.
Audience: human engineers and AI assistants continuing the work.

Requires: pip install reportlab
Font: Microsoft YaHei at C:\\Windows\\Fonts\\msyh.ttc (standard on Chinese Windows).

Usage (from repo root):
  python scripts/generate_project_handoff_pdf.py
Output:
  reports/OrSight_Project_Handoff_<date>.pdf
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    ListFlowable,
    ListItem,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

PROJECT_ROOT = Path(__file__).resolve().parents[1]
REPORT_DATE = date.today()
OUTPUT_PATH = PROJECT_ROOT / "reports" / f"OrSight_Project_Handoff_{REPORT_DATE.isoformat()}.pdf"
FONT_PATH = Path(r"C:\Windows\Fonts\msyh.ttc")


def register_fonts() -> None:
    if not FONT_PATH.is_file():
        raise FileNotFoundError(f"需要中文字体: {FONT_PATH}")
    pdfmetrics.registerFont(TTFont("YaHei", str(FONT_PATH), subfontIndex=0))


def esc(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "title",
            parent=base["Heading1"],
            fontName="YaHei",
            fontSize=20,
            leading=28,
            alignment=TA_CENTER,
            spaceAfter=14,
        ),
        "subtitle": ParagraphStyle(
            "subtitle",
            parent=base["Normal"],
            fontName="YaHei",
            fontSize=11,
            leading=16,
            alignment=TA_CENTER,
            textColor=colors.HexColor("#444444"),
            spaceAfter=20,
        ),
        "h1": ParagraphStyle(
            "h1",
            parent=base["Heading1"],
            fontName="YaHei",
            fontSize=14,
            leading=20,
            spaceBefore=12,
            spaceAfter=8,
            textColor=colors.HexColor("#1a1a1a"),
        ),
        "h2": ParagraphStyle(
            "h2",
            parent=base["Heading2"],
            fontName="YaHei",
            fontSize=11.5,
            leading=17,
            spaceBefore=8,
            spaceAfter=5,
        ),
        "body": ParagraphStyle(
            "body",
            parent=base["Normal"],
            fontName="YaHei",
            fontSize=10.5,
            leading=16,
            alignment=TA_JUSTIFY,
            spaceAfter=7,
        ),
        "mono_note": ParagraphStyle(
            "mono_note",
            parent=base["Normal"],
            fontName="YaHei",
            fontSize=9.5,
            leading=14,
            alignment=TA_LEFT,
            textColor=colors.HexColor("#333333"),
            spaceAfter=5,
        ),
        "bullet": ParagraphStyle(
            "bullet",
            parent=base["Normal"],
            fontName="YaHei",
            fontSize=10.5,
            leading=15,
            spaceAfter=3,
        ),
    }


def bullets(st: dict, items: list[str]) -> ListFlowable:
    return ListFlowable(
        [ListItem(Paragraph(esc(t), st["bullet"]), leftIndent=18, bulletType="bullet") for t in items],
        bulletType="bullet",
        start="•",
    )


def data_table(rows: list[list[str]], col_widths: list[float]) -> Table:
    wrapped = [[Paragraph(esc(c), ParagraphStyle("c", fontName="YaHei", fontSize=9, leading=13)) for c in r] for r in rows]
    t = Table(wrapped, colWidths=col_widths)
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e8e8e8")),
                ("ALIGN", (0, 0), (-1, -1), "LEFT"),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("GRID", (0, 0), (-1, -1), 0.25, colors.grey),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    return t


def build_story(st: dict[str, ParagraphStyle]) -> list:
    story: list = []
    w = 16.5 * cm

    story.append(Paragraph(esc("OrSight（POD 抽查 / 签退截图）项目交接报告"), st["title"]))
    story.append(Paragraph(esc("面向工程师与 AI 助手的统一说明文档"), st["subtitle"]))
    story.append(
        Paragraph(
            esc(
                f"报告日期：{REPORT_DATE.isoformat()}　|　仓库：Orsight　|　"
                "主应用 webapp（Next.js）+ 管理端 admin-webapp"
            ),
            st["subtitle"],
        )
    )
    story.append(Spacer(1, 0.4 * cm))

    # --- 0 摘要 ---
    story.append(Paragraph(esc("0. 执行摘要"), st["h1"]))
    story.append(
        Paragraph(
            esc(
                "OrSight 让用户上传 POD 设备或网页表格截图，通过兼容 OpenAI 的多模态接口抽取结构化行数据，"
                "在浏览器中编辑、导出 Excel，并对高风险字段标红与待复核。训练池通过 Supabase 或本地 JSON/图片目录"
                "沉淀人工确认的样本与框选坐标，用于提示词、参考图与按区域裁剪的二次 OCR，而非传统 LoRA 微调。"
                "管理端独立部署，用于用量与用户可视化。"
            ),
            st["body"],
        )
    )
    story.append(
        Paragraph(
            esc(
                "【给 AI】改识别逻辑时必联动阅读：webapp/src/app/api/extract/route.ts、"
                "webapp/src/lib/pod.ts、webapp/src/lib/training.ts。"
                "训练框必须使用 coordSpace: \"image\"（位图归一化坐标），否则批量裁剪增强不生效。"
            ),
            st["mono_note"],
        )
    )

    story.append(PageBreak())

    # --- 1 产品 ---
    story.append(Paragraph(esc("1. 产品定位与边界"), st["h1"]))
    story.append(
        Paragraph(
            esc(
                "是什么：批量上传截图 → AI 填表 → 人工复核/修正 → 复制或下载表格；可将正确样本写入训练池以改进后续识别。"
            ),
            st["body"],
        )
    )
    story.append(
        Paragraph(
            esc(
                "不是什么：不是离线模型微调流水线；默认不把每次填表结果持久化到业务库（表格主要在内存，刷新可能丢失）；"
                "持久化重点是训练池与（若配置）usage_logs。"
            ),
            st["body"],
        )
    )

    # --- 2 结构 ---
    story.append(Paragraph(esc("2. 仓库结构（关键路径）"), st["h1"]))
    tree_lines = [
        "webapp/ — 主站 Next.js 16 + React 19 + TS；App Router；Tailwind 4",
        "  src/app/(protected)/page.tsx — 填表主页",
        "  src/app/(protected)/training/page.tsx — 训练模式",
        "  src/app/(protected)/forms/ — 扩展表单能力（列表、formId、setup）",
        "  src/app/api/extract/route.ts — 批量/复核识别核心（体量很大）",
        "  src/app/api/training/* — 训练保存、图片、规则、预览、对话等",
        "  src/lib/pod.ts — PodRecord、visionPrompt、validateRecord、organizeRecords",
        "  src/lib/training.ts — 训练样本加载、提示拼装、参考图",
        "  src/components/TrainingAnnotationWorkbench.tsx — 标注工作台",
        "  src/components/RecognitionAgentDock.tsx — 识别侧 Agent 停靠 UI",
        "  supabase/*.sql — schema、admin_schema、辅助修复脚本",
        "admin-webapp/ — 管理后台（常用端口 3001），viz 可视化、用户列表",
        "training/ — 无 Supabase 时本地训练元数据（如 examples.json）",
        "image/training-ai/ — 无 Supabase 时本地训练图片目录",
        "scripts/ — 本 PDF 生成脚本等",
        "pod_fill_guard.py — openpyxl 离线校验与 Excel 生成",
        "PROJECT_HANDOFF.md — Markdown 版交接（与本文互补，代码变更时请同步）",
    ]
    story.append(bullets(st, tree_lines))

    # --- 3 技术栈 ---
    story.append(Paragraph(esc("3. 技术栈"), st["h1"]))
    stack_rows = [
        ["层级", "技术"],
        ["主应用框架", "Next.js App Router、TypeScript、React 19"],
        ["样式", "Tailwind CSS 4"],
        ["AI", "OpenAI 兼容 POST /v1/chat/completions；response_format: json_object；图片 image_url / data URL"],
        ["图像", "sharp 服务端裁剪"],
        ["文档解析", "mammoth、pdf-parse / pdfjs-dist、word-extractor、xlsx"],
        ["认证", "Supabase Auth；可选开发 Cookie 假登录"],
        ["数据", "Supabase Postgres + Storage（training-images）；本地文件兜底"],
    ]
    story.append(data_table(stack_rows, [3.2 * cm, 13.3 * cm]))
    story.append(Spacer(1, 0.3 * cm))

    story.append(PageBreak())

    # --- 4 业务规则 ---
    story.append(Paragraph(esc("4. 核心业务规则（与代码须一致）"), st["h1"]))
    story.append(
        Paragraph(
            esc(
                "以下规则体现在 webapp/src/lib/pod.ts 的 visionPrompt、validateRecord，以及 api/extract 的后处理中。"
                "修改前请全文搜索影响面。"
            ),
            st["body"],
        )
    )
    rule_rows = [
        ["要点", "说明"],
        [
            "抽查路线 route",
            "须为快递员任务路线形态（如 IAH01-030-C，含两位区域数字）。"
            "不得把顶部站点车队（如 IAH-BAA）写入 route；误填会被挪到 stationTeam 并标复核。",
        ],
        [
            "运单数量 total",
            "须来自应领件数或训练池认可的 totalSourceLabel（如应收件数）。"
            "实领/已领等不得冒充 total；可疑时宁可清空并复核。",
        ],
        ["未收 unscanned", "对应未领取等语义，勿与角标装饰数字混淆。"],
        ["错扫 exceptions", "对应错分/错扫等列；勿与未收混淆。"],
        [
            "多图合并",
            "organizeRecords 按业务键合并跨图完全相同行；imageName 用「 | 」连接；mergedSourceCount≥2。",
        ],
    ]
    story.append(data_table(rule_rows, [3.0 * cm, 13.5 * cm]))

    # --- 5 数据模型 ---
    story.append(Paragraph(esc("5. 数据模型 PodRecord（摘要）"), st["h1"]))
    story.append(
        Paragraph(
            esc(
                "完整类型见 webapp/src/lib/pod.ts。ExtractionIssue 带 level（warning/error）与可选 code，用于前端徽章与排查。"
            ),
            st["body"],
        )
    )
    pod_rows = [
        ["字段", "含义"],
        ["id", "前端行 id，常含 imageName-index"],
        ["imageName", "来源文件名；合并行为 a.jpg | b.jpg"],
        ["date / route / driver", "日期、抽查路线、司机"],
        ["taskCode", "任务编码（若截图可见）"],
        ["total / unscanned / exceptions", "数字或空字符串"],
        ["totalSourceLabel", "运单数量所依据的可见标签原文"],
        ["waybillStatus", "如 待更新 / 全领取"],
        ["stationTeam", "站点车队代码"],
        ["customFieldValues", "扩展列键值"],
        ["reviewRequired / reviewReason", "待复核与原因"],
        ["mergedSourceCount", "≥2 表示跨图合并前的条数"],
    ]
    story.append(data_table(pod_rows, [3.5 * cm, 13.0 * cm]))
    story.append(Spacer(1, 0.2 * cm))

    # --- 6 extract 流水线 ---
    story.append(Paragraph(esc("6. 识别流水线 POST /api/extract（逻辑索引）"), st["h1"]))
    ext_items = [
        "认证：getAuthUserOrSkip；无 Supabase 且关闭强制登录时可 skip。",
        "性能：buildExtractVisionContext 每请求构建一次（训练样本、全局规则、参考图并行）。",
        "一致性：环境变量 EXTRACT_CONSISTENCY_ATTEMPTS（2～8，默认 4），同图多路主识别，签名不一致则 consistency_mismatch。",
        "主 Vision：visionPrompt + 训练段 + 参考图 + 当前整图 → imageType + records。",
        "POD 单条记录且训练框为 image 坐标：对 route/total/unscanned/exceptions 区域并行裁剪 OCR 再合并。",
        "repairRouteVersusStationTeamRecord、markSourceMismatchForReview、计数器 callCounterVerifier / applyCounterVerification。",
        "可选异步 usage_logs（需 Service Role）。",
    ]
    story.append(bullets(st, ext_items))

    story.append(PageBreak())

    # --- 7 前端 ---
    story.append(Paragraph(esc("7. 前端主界面要点"), st["h1"]))
    story.append(
        Paragraph(
            esc(
                "webapp/src/app/(protected)/page.tsx：多图并发请求 /api/extract，合并 records/issues；"
                "再次识别 mode: review 使用 OPENAI_REVIEW_MODEL；查看原图解析「 | 」多文件名；"
                "打开标注对接 TrainingAnnotationWorkbench 与 /api/training/image。"
            ),
            st["body"],
        )
    )

    # --- 8 训练 ---
    story.append(Paragraph(esc("8. 训练系统与类型"), st["h1"]))
    story.append(
        Paragraph(
            esc(
                "TrainingExample / TrainingBox 等定义在 training.ts。"
                "全局规则等特殊行：training_examples 表中 image_name === \"__global_rules__\"，勿与普通样本混淆。"
            ),
            st["body"],
        )
    )
    story.append(Paragraph(esc("8.1 webapp API 路由一览"), st["h2"]))
    api_rows = [
        ["方法与路径", "作用"],
        ["POST /api/extract", "批量/复核视觉抽取（核心）"],
        ["POST /api/training/save", "写入训练样本（Supabase upsert 或本地）"],
        ["GET /api/training/image", "按 imageName 返回图片 data URL"],
        ["GET /api/training/status", "训练池状态"],
        ["GET/POST /api/training/rules", "全局规则 / workingRules"],
        ["POST /api/training/preview-fill", "框内裁剪预览填充"],
        ["POST /api/training/guidance-chat", "指导对话（Agent）"],
        ["POST /api/training/parse-document", "解析上传文档入上下文"],
        ["POST /api/training/context-asset", "上下文资源"],
        ["GET/POST /api/forms", "表单列表与创建"],
        ["GET/POST /api/forms/[formId]", "单表单读写"],
        ["POST /api/forms/template-from-image", "从图生成模板"],
        ["GET/POST /api/table-fields", "表格字段配置"],
        ["GET /api/auth/dev-session", "开发会话查询"],
        ["POST /api/auth/dev-login、dev-logout", "开发假登录"],
    ]
    story.append(data_table(api_rows, [5.2 * cm, 11.3 * cm]))
    story.append(Spacer(1, 0.25 * cm))

    env_rows = [
        ["变量", "说明"],
        ["OPENAI_API_KEY", "必填"],
        ["OPENAI_BASE_URL", "兼容网关地址，默认官方"],
        ["OPENAI_PRIMARY_MODEL", "批量识别"],
        ["OPENAI_REVIEW_MODEL", "再次识别"],
        ["OPENAI_REASONING_EFFORT", "建议 minimal"],
        ["OPENAI_PREVIEW_MODEL / OPENAI_GUIDANCE_MODEL", "可选"],
        ["EXTRACT_CONSISTENCY_ATTEMPTS", "2～8，默认 4"],
        ["TRAINING_PROMPT_EXAMPLES 等", "训练注入条数上限（见 PROJECT_HANDOFF）"],
        ["NEXT_PUBLIC_REQUIRE_LOGIN", "false 可无 Supabase 时跳过强制登录"],
        ["NEXT_PUBLIC_DEV_MOCK_LOGIN", "开发假登录开关"],
        ["NEXT_PUBLIC_SUPABASE_URL / ANON_KEY", "前端与服务端用户态"],
        ["SUPABASE_SERVICE_ROLE_KEY", "服务端写训练池、usage_logs"],
    ]
    story.append(Paragraph(esc("8.2 主应用环境变量（摘要）"), st["h2"]))
    story.append(data_table(env_rows, [5.0 * cm, 11.5 * cm]))
    story.append(Spacer(1, 0.2 * cm))
    story.append(Paragraph(esc("8.3 训练提示注入（可选）"), st["h2"]))
    train_env_rows = [
        ["变量", "说明"],
        ["TRAINING_PROMPT_EXAMPLES", "注入提示的文本样本条数上限（默认约 12）"],
        ["TRAINING_BOX_HINT_EXAMPLES", "带框说明的样本数（默认约 8）"],
        ["TRAINING_VISUAL_REF_IMAGES", "附加参考图张数，0 关闭（默认 2）"],
        ["AGENT_CONTEXT_REF_IMAGES", "Agent 线程附图张数上限"],
    ]
    story.append(data_table(train_env_rows, [5.2 * cm, 11.3 * cm]))

    story.append(PageBreak())

    # --- 9 Supabase ---
    story.append(Paragraph(esc("9. Supabase 与本地兜底"), st["h1"]))
    story.append(
        Paragraph(
            esc(
                "初始化：webapp/supabase/schema.sql（训练表与 Storage 桶）。"
                "管理端：webapp/supabase/admin_schema.sql（usage_logs、admin_users）。"
                "详见 webapp/SUPABASE_SETUP.md、webapp/AUTH.md、ADMIN_SETUP.md。"
            ),
            st["body"],
        )
    )

    # --- 10 admin ---
    story.append(Paragraph(esc("10. admin-webapp"), st["h1"]))
    story.append(
        Paragraph(
            esc(
                "独立 Next 应用；需同一 Supabase 项目的 URL/anon，以及 SUPABASE_SERVICE_ROLE_KEY。"
                "路由包含受保护用户列表、viz 可视化等；健康检查 GET /api/health/supabase。"
                "启动：cd admin-webapp && npm install && npm run dev（默认 3001）。"
            ),
            st["body"],
        )
    )

    # --- 11 AI 约束 ---
    story.append(Paragraph(esc("11. 给后续 AI 的硬性约束"), st["h1"]))
    ai_items = [
        "改识别前通读 extract/route.ts、pod.ts、training.ts 三处。",
        "查看图片与标注工作台职责分离；勿把训练标注混进只读查看层。",
        "可疑运单数量策略：清空 + 复核，而非静默保留错误数字。",
        "合并行：解析 getSourceImageNames；删除、再识别、查看需考虑多图。",
        "勿提交 .env.local、service_role、用户私有图片。",
    ]
    story.append(bullets(st, ai_items))

    # --- 12 自检 ---
    story.append(Paragraph(esc("12. 接手自检清单"), st["h1"]))
    chk = [
        "webapp：npm install && npm run dev，能打开填表页。",
        ".env.local：至少 OPENAI_API_KEY；若需登录则配置 Supabase。",
        "上传一张 POD → 识别 → 表格有数据；故意错误样本出现待复核。",
        "训练页保存带 image 坐标框的样本 → 同构图批量识别观察 total/route 等是否改善。",
        "（可选）执行 schema.sql / admin_schema.sql，验证训练池与管理员登录。",
    ]
    story.append(bullets(st, chk))

    # --- 13 文档索引 ---
    story.append(Paragraph(esc("13. 文档与脚本索引"), st["h1"]))
    doc_items = [
        "PROJECT_HANDOFF.md — Markdown 详细交接（表格更全时可优先维护该文件）",
        "webapp/README.md — 用户向功能与启动",
        "webapp/AUTH.md — 登录与假登录",
        "webapp/SUPABASE_SETUP.md — 库表与 Storage",
        "ADMIN_SETUP.md — 管理端",
        "pod_form_rules.md — 业务规则叙述",
        "scripts/generate_progress_report_pdf.py — 另一版进度报告 PDF",
        "scripts/generate_project_handoff_pdf.py — 生成本 PDF",
    ]
    story.append(bullets(st, doc_items))

    story.append(Spacer(1, 0.5 * cm))
    story.append(
        Paragraph(
            esc(
                "— 正文结束 —"
                "<br/><br/>"
                "说明：本 PDF 根据仓库扫描与 PROJECT_HANDOFF.md 归纳；若与最新代码不一致，以 Git 为准。"
                "重新生成：在项目根目录执行 python scripts/generate_project_handoff_pdf.py 。"
            ),
            st["body"],
        )
    )

    return story


def main() -> None:
    register_fonts()
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(
        str(OUTPUT_PATH),
        pagesize=A4,
        rightMargin=1.8 * cm,
        leftMargin=1.8 * cm,
        topMargin=1.8 * cm,
        bottomMargin=1.8 * cm,
        title="OrSight Project Handoff",
        author="Orsight",
    )
    st = styles()
    doc.build(build_story(st))
    print("Wrote:", str(OUTPUT_PATH))


if __name__ == "__main__":
    main()
