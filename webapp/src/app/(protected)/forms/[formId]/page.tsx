import Link from "next/link";
import { notFound } from "next/navigation";

type PageProps = {
  params: Promise<{ formId: string }>;
};

export default async function FormDetailPage({ params }: PageProps) {
  const { formId } = await params;
  const isForm1 = formId === "form-1";
  const isForm2 = formId === "form-2";

  if (!isForm1 && !isForm2) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-6 text-slate-900">
      <div className="mx-auto max-w-4xl space-y-4">
        <header className="rounded-2xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
          <h1 className="text-2xl font-semibold">{isForm1 ? "填表1" : "填表2"}</h1>
          <p className="mt-2 text-sm text-slate-600">
            {isForm1
              ? "这是已完成填表，沿用你现在的成熟页面。"
              : "这是预留填表，后续会接入独立识别规则和训练池。"}
          </p>
        </header>

        <section className="grid gap-4 md:grid-cols-2">
          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold">填表模式</h2>
            <p className="mt-1 text-sm text-slate-600">上传图片、识别并编辑在线表格。</p>
            <div className="mt-4">
              {isForm1 ? (
                <Link href="/" className="inline-flex rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                  进入填表模式
                </Link>
              ) : (
                <button
                  type="button"
                  disabled
                  className="inline-flex cursor-not-allowed rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm font-medium text-slate-400"
                >
                  即将支持
                </button>
              )}
            </div>
          </article>

          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold">图片识别训练模式</h2>
            <p className="mt-1 text-sm text-slate-600">标注样本，持续提升该填表的识别质量。</p>
            <div className="mt-4">
              {isForm1 ? (
                <Link
                  href="/training"
                  className="inline-flex rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  进入训练模式
                </Link>
              ) : (
                <button
                  type="button"
                  disabled
                  className="inline-flex cursor-not-allowed rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm font-medium text-slate-400"
                >
                  即将支持
                </button>
              )}
            </div>
          </article>
        </section>

        <div>
          <Link href="/forms" className="text-sm font-medium text-blue-600 hover:underline">
            ← 返回填表池
          </Link>
        </div>
      </div>
    </main>
  );
}
