import Link from "next/link";

const forms = [
  {
    id: "form-1",
    name: "填表1",
    desc: "已完成：沿用当前线上填表与训练能力。",
    status: "已完成",
    ready: true,
  },
  {
    id: "form-2",
    name: "填表2",
    desc: "待配置：将接入独立规则、独立训练池。",
    status: "规划中",
    ready: false,
  },
];

export default function FormsPoolPage() {
  return (
    <main className="min-h-screen bg-slate-100 px-4 py-6 text-slate-900">
      <div className="mx-auto max-w-6xl space-y-4">
        <header className="rounded-2xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
          <h1 className="text-2xl font-semibold">填表池</h1>
          <p className="mt-2 text-sm text-slate-600">
            在这里管理多个填表。每个填表下都有「填表模式」与「图片识别训练模式」。
          </p>
        </header>

        <section className="grid gap-4 md:grid-cols-2">
          {forms.map((form) => (
            <article key={form.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{form.name}</h2>
                  <p className="mt-1 text-sm text-slate-600">{form.desc}</p>
                </div>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                    form.ready ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                  }`}
                >
                  {form.status}
                </span>
              </div>

              <div className="mt-4">
                <Link
                  href={`/forms/${form.id}`}
                  className="inline-flex rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  进入 {form.name}
                </Link>
              </div>
            </article>
          ))}

          <article className="rounded-2xl border border-dashed border-slate-300 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">新建填表</h2>
            <p className="mt-1 text-sm text-slate-600">创建新的填表空间（后续接入独立训练与规则）。</p>
            <div className="mt-4">
              <button
                type="button"
                disabled
                className="inline-flex cursor-not-allowed rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm font-medium text-slate-400"
                title="下一步升级中"
              >
                即将支持
              </button>
            </div>
          </article>
        </section>
      </div>
    </main>
  );
}
