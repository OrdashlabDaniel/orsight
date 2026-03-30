"""
Generate a Chinese PDF progress report for the POD audit tool project.
Requires: reportlab, Windows font msyh.ttc (Microsoft YaHei).
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY
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
# ASCII filename avoids Windows console / tooling encoding issues; full Chinese title is on the PDF cover.
OUTPUT_PATH = PROJECT_ROOT / "reports" / f"OrSight_progress_report_{date.today().isoformat()}.pdf"
FONT_PATH = Path(r"C:\Windows\Fonts\msyh.ttc")


def register_fonts() -> None:
    if not FONT_PATH.is_file():
        raise FileNotFoundError(f"需要中文字体: {FONT_PATH}")
    pdfmetrics.registerFont(TTFont("YaHei", str(FONT_PATH), subfontIndex=0))


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
            spaceAfter=18,
        ),
        "subtitle": ParagraphStyle(
            "subtitle",
            parent=base["Normal"],
            fontName="YaHei",
            fontSize=11,
            leading=16,
            alignment=TA_CENTER,
            textColor=colors.HexColor("#444444"),
            spaceAfter=24,
        ),
        "h1": ParagraphStyle(
            "h1",
            parent=base["Heading1"],
            fontName="YaHei",
            fontSize=14,
            leading=20,
            spaceBefore=14,
            spaceAfter=8,
            textColor=colors.HexColor("#1a1a1a"),
        ),
        "h2": ParagraphStyle(
            "h2",
            parent=base["Heading2"],
            fontName="YaHei",
            fontSize=12,
            leading=17,
            spaceBefore=10,
            spaceAfter=6,
        ),
        "body": ParagraphStyle(
            "body",
            parent=base["Normal"],
            fontName="YaHei",
            fontSize=10.5,
            leading=16,
            alignment=TA_JUSTIFY,
            spaceAfter=8,
        ),
        "bullet": ParagraphStyle(
            "bullet",
            parent=base["Normal"],
            fontName="YaHei",
            fontSize=10.5,
            leading=15,
            leftIndent=0,
            bulletIndent=0,
            spaceAfter=4,
        ),
    }


def esc(s: str) -> str:
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def build_story(st: dict[str, ParagraphStyle]) -> list:
    story: list = []

    story.append(Paragraph(esc("POD 抽查截图审计与表单填写工具"), st["title"]))
    story.append(Paragraph(esc("项目进度与已完成工作说明（内部报告）"), st["subtitle"]))
    story.append(
        Paragraph(
            esc(f"报告日期：{date.today().isoformat()}　|　代码仓库：pod-audit-tool"),
            st["subtitle"],
        )
    )
    story.append(Spacer(1, 0.3 * cm))

    # --- 1 ---
    story.append(Paragraph(esc("一、项目概述"), st["h1"]))
    story.append(
        Paragraph(
            esc(
                "本项目（OrSight / POD 抽查工具）面向站点日常 POD 抽查截图场景：用户上传截图，"
                "由多模态大模型提取结构化表格字段，系统通过多层规则与一致性校验标记高风险结果，"
                "用户在网页端复核、手工修正后导出 Excel，并将优质标注沉淀到本地训练池以改进后续提示与参考示例。"
                "当前产品定位为单用户工作流工具，尚未扩展为多站点协作与完整计费体系。"
            ),
            st["body"],
        )
    )

    # --- 2 ---
    story.append(Paragraph(esc("二、业务目标与产品流程（对照规划文档）"), st["h1"]))
    story.append(
        Paragraph(
            esc(
                "规划目标强调：零乱填、可追溯、易上手、支持日常重复使用。核心流程包括：选择日期、"
                "批量上传截图、AI 按固定规则提取、规则引擎校验、对高风险记录标记待复核、"
                "网页端确认或修正、导出 Excel、（规划中）保存当日审计记录。MVP 阶段以「上传—识别—校验—编辑—导出」闭环为主。"
            ),
            st["body"],
        )
    )

    # --- 3 ---
    story.append(Paragraph(esc("三、已完成工作（详细清单）"), st["h1"]))

    story.append(Paragraph(esc("3.1 主应用（webapp，Next.js 16 + React 19 + TypeScript）"), st["h2"]))
    items_main = [
        "批量截图上传与拖拽上传；上传列表展示文件名、缩略图等信息。",
        "在线可编辑结果表格：日期、抽查路线、抽查司机、运单数量、未收数量、错扫数量、响应更新状态等字段。",
        "按路线分组展示记录；完全重复行去重（organizeRecords）。",
        "批量调用视觉模型进行表格/截图识别；对标记为待复核的行支持「再次识别」（可切换更强模型）。",
        "待复核/异常行视觉高亮；支持手动删除标记记录。",
        "独立「查看图片」浮层：缩放、平移，布局上便于对照左侧上传区与右侧表格编辑，不遮挡主表格。",
        "独立「打开标注」流程与训练标注工作台（TrainingAnnotationWorkbench）：手工框选与训练数据回写，与纯查看图片分离。",
        "导出 Excel（表头与站点字段对齐思路，文件名可体现记录日期）。",
        "核心校验与提示词集中在 lib/pod.ts；抽取 API 为 app/api/extract/route.ts（含 Sharp 图像处理、多轮一致性、计数区域裁剪复核等）。",
    ]
    story.append(
        ListFlowable(
            [ListItem(Paragraph(esc(t), st["bullet"]), leftIndent=18, bulletType="bullet") for t in items_main],
            bulletType="bullet",
            start="•",
        )
    )
    story.append(Spacer(1, 0.2 * cm))

    story.append(Paragraph(esc("3.2 AI 与校验策略"), st["h2"]))
    items_ai = [
        "默认批量识别模型可配置（环境变量 OPENAI_PRIMARY_MODEL 等，文档中默认策略为 gpt-5-mini；复核/重试可用更强模型如 gpt-5）。",
        "多轮一致性：同图多次识别，结果不一致则标记复核。",
        "来源标签校验：要求模型给出 totalSourceLabel，确保「运单数量」与截图标签（如应领件数）一致；不可靠则清空并标记。",
        "计数区域单独校验：对应领件数、实领件数、已领等区域做裁剪后的辅助验证，防止将「实领/已领」误填为运单数量。",
        "提示词中强调：区分站点车队与抽查路线、网页表多行时每行使用该行快递员路线、多任务与不确定时 reviewRequired。",
        "训练示例与全局规则注入：loadTrainingExamples、loadGlobalRules、视觉参考包与 Agent 线程参考图一并进入请求（仅作布局理解，禁止抄参考图文字）。",
    ]
    story.append(
        ListFlowable(
            [ListItem(Paragraph(esc(t), st["bullet"]), leftIndent=18, bulletType="bullet") for t in items_ai],
            bulletType="bullet",
            start="•",
        )
    )
    story.append(Spacer(1, 0.2 * cm))

    story.append(Paragraph(esc("3.3 训练池与训练相关 API"), st["h2"]))
    items_train = [
        "本地/配置驱动的训练元数据（如 training/examples.json）与训练图片目录（image/training-ai）。",
        "API：训练保存、预览填充、规则、解析文档、指导对话、训练图片访问、状态查询等（app/api/training/*）。",
        "训练页 (protected)/training 与标注组件配合，实现示例辅助提示与人工标注回流。",
        "说明：当前为「示例 + 提示工程 + 数据沉淀」，非线上模型微调流水线。",
    ]
    story.append(
        ListFlowable(
            [ListItem(Paragraph(esc(t), st["bullet"]), leftIndent=18, bulletType="bullet") for t in items_train],
            bulletType="bullet",
            start="•",
        )
    )
    story.append(Spacer(1, 0.2 * cm))

    story.append(Paragraph(esc("3.4 身份认证与账号"), st["h2"]))
    items_auth = [
        "集成 Supabase（@supabase/ssr、@supabase/supabase-js）；middleware 中 updateSession 刷新会话。",
        "登录页、OAuth 回调、受保护路由布局 (protected)；账户相关页面。",
        "开发环境可选 dev mock 登录（api/auth/dev-*），便于本地调试。",
    ]
    story.append(
        ListFlowable(
            [ListItem(Paragraph(esc(t), st["bullet"]), leftIndent=18, bulletType="bullet") for t in items_auth],
            bulletType="bullet",
            start="•",
        )
    )
    story.append(Spacer(1, 0.2 * cm))

    story.append(Paragraph(esc("3.5 表单与其它受保护功能"), st["h2"]))
    story.append(
        Paragraph(
            esc(
                "存在 forms 相关路由（列表与按 formId 详情），用于扩展表单类业务能力；与主 POD 工作台并列于受保护区域内。"
            ),
            st["body"],
        )
    )

    story.append(Paragraph(esc("3.6 用量记录与管理端（规划与骨架）"), st["h2"]))
    story.append(
        Paragraph(
            esc(
                "Supabase SQL 脚本 webapp/supabase/admin_schema.sql 定义 usage_logs（按用户记录操作类型、"
                "图片数量、token、模型等）与 admin_users（管理员白名单），并配置 RLS。"
                "独立应用 admin-webapp（默认端口 3001）提供管理员登录、用户列表、可视化等能力；"
                "配置说明见 ADMIN_SETUP.md。后端可通过 Service Role 写入用量，供后续计费与运营分析。"
            ),
            st["body"],
        )
    )

    story.append(Paragraph(esc("3.7 命令行与文档资产"), st["h2"]))
    items_cli = [
        "pod_fill_guard.py：基于 openpyxl 的校验与 Excel 生成逻辑，与网页端规则同源思路，可供批处理或离线流水线使用。",
        "pod_form_rules.md、pod_vision_prompt.txt：字段与视觉提取说明。",
        "PROJECT_HANDOFF.md、webapp_agent_plan.md：交接与产品阶段规划。",
        "历史样例数据：如 IAH_station_audit_routes.xlsx、manifest 与示例 xlsx（根目录）。",
    ]
    story.append(
        ListFlowable(
            [ListItem(Paragraph(esc(t), st["bullet"]), leftIndent=18, bulletType="bullet") for t in items_cli],
            bulletType="bullet",
            start="•",
        )
    )

    # --- 4 核心业务规则表 ---
    story.append(PageBreak())
    story.append(Paragraph(esc("四、核心业务规则（必须遵守）"), st["h1"]))
    story.append(
        Paragraph(
            esc("以下规则在交接文档与代码校验中反复强调，任何后续迭代均不应破坏。"),
            st["body"],
        )
    )
    rule_data = [
        ["规则要点", "说明摘要"],
        [
            "抽查路线来源",
            "须来自任务区域路线编码，不得用右上角站点/车队标签顶替。",
        ],
        ["运单数量", "仅依据「应领件数」等合法标签；不可靠则清空并复核。"],
        ["未收数量 / 错扫数量", "分别对应「未领取」「错分数量」等截图依据。"],
        ["可疑数值", "禁止静默保留错误运单数量；须进入人工处理流程。"],
        ["待复核能力", "支持再次识别、查看图片、打开标注、手工框选与写入训练池。"],
    ]
    t = Table(rule_data, colWidths=[4.2 * cm, 12.3 * cm])
    t.setStyle(
        TableStyle(
            [
                ("FONT", (0, 0), (-1, -1), "YaHei", 9),
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e8e8e8")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.black),
                ("ALIGN", (0, 0), (-1, -1), "LEFT"),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("GRID", (0, 0), (-1, -1), 0.25, colors.grey),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    story.append(t)
    story.append(Spacer(1, 0.4 * cm))

    # --- 5 技术栈 ---
    story.append(Paragraph(esc("五、技术栈与部署方向"), st["h1"]))
    story.append(
        Paragraph(
            esc(
                "当前实现：Next.js App Router、TypeScript、Tailwind CSS 4、Sharp、xlsx、mammoth、pdf-parse、word-extractor 等。"
                "AI 调用兼容可配置的 OpenAI 兼容接口（OPENAI_BASE_URL）。"
            ),
            st["body"],
        )
    )
    story.append(
        Paragraph(
            esc(
                "规划中的生产形态：Next.js 应用服务器、Clerk 或 Supabase Auth（已部分采用 Supabase）、"
                "Postgres、对象存储承载上传与训练资源、订阅或配额计费。当前训练池与部分资源仍为本地/文件型，"
                "上线前需替换为云存储与数据库元数据。"
            ),
            st["body"],
        )
    )

    # --- 6 风险与下一步 ---
    story.append(Paragraph(esc("六、已知风险与建议后续步骤"), st["h1"]))
    story.append(Paragraph(esc("6.1 风险与注意点"), st["h2"]))
    risks = [
        "查看图片与标注弹层职责分离，合并易导致 UX 与训练数据污染。",
        "查看层不应遮挡表格，需持续保证对照编辑体验。",
        "可疑总量必须清空而非保留，避免「看起来已填」的误判。",
        "部署时必须替换本地文件存储并完善数据库持久化与权限隔离。",
    ]
    story.append(
        ListFlowable(
            [ListItem(Paragraph(esc(t), st["bullet"]), leftIndent=18, bulletType="bullet") for t in risks],
            bulletType="bullet",
            start="•",
        )
    )
    story.append(Paragraph(esc("6.2 建议优先级（来自交接文档）"), st["h2"]))
    next_steps = [
        "持续稳定图片查看与标注工作流。",
        "完善注册/登录与多环境配置（生产密钥与 RLS 策略验证）。",
        "数据与图片上云、历史记录入库。",
        "用户使用量统计与后续付费模型准备。",
    ]
    story.append(
        ListFlowable(
            [ListItem(Paragraph(esc(t), st["bullet"]), leftIndent=18, bulletType="bullet") for t in next_steps],
            bulletType="bullet",
            start="•",
        )
    )

    # --- 7 附录 ---
    story.append(Paragraph(esc("七、关键路径索引（便于评审与续开发）"), st["h1"]))
    paths = [
        "主界面：webapp/src/app/(protected)/page.tsx",
        "抽取 API：webapp/src/app/api/extract/route.ts",
        "领域规则与提示：webapp/src/lib/pod.ts",
        "训练逻辑：webapp/src/lib/training.ts",
        "中间件：webapp/src/middleware.ts",
        "管理库表：webapp/supabase/admin_schema.sql",
        "管理端：admin-webapp/（见 ADMIN_SETUP.md）",
    ]
    story.append(
        ListFlowable(
            [ListItem(Paragraph(esc(p), st["bullet"]), leftIndent=18, bulletType="bullet") for p in paths],
            bulletType="bullet",
            start="•",
        )
    )

    story.append(Spacer(1, 0.6 * cm))
    story.append(
        Paragraph(
            esc(
                "— 报告正文结束 —"
                "<br/><br/>"
                "说明：本报告根据仓库内 PROJECT_HANDOFF.md、webapp_agent_plan.md、ADMIN_SETUP.md 及源代码目录结构归纳；"
                "若与最新代码不一致，以 Git 仓库为准。重新生成：在项目根目录执行 python scripts/generate_progress_report_pdf.py ，"
                "输出默认写入 reports/OrSight_progress_report_日期.pdf 。"
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
        rightMargin=2 * cm,
        leftMargin=2 * cm,
        topMargin=2 * cm,
        bottomMargin=2 * cm,
        title="POD抽查工具项目进度报告",
        author="pod-audit-tool",
    )
    st = styles()
    doc.build(build_story(st))
    print("Wrote:", str(OUTPUT_PATH))


if __name__ == "__main__":
    main()
