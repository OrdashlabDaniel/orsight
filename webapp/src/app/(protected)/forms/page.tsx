 "use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type FormCard = {
  id: string;
  name: string;
  desc: string;
  status: string;
  ready: boolean;
  fillHref: string;
};

const initialForms: FormCard[] = [
  {
    id: "form-1",
    name: "填表1",
    desc: "已完成：沿用当前线上填表与训练能力。",
    status: "已完成",
    ready: true,
    fillHref: "/",
  },
  {
    id: "form-2",
    name: "填表2",
    desc: "待配置：将接入独立规则、独立训练池。",
    status: "规划中",
    ready: false,
    fillHref: "",
  },
];

export default function FormsPoolPage() {
  const [forms, setForms] = useState<FormCard[]>(initialForms);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const storageKey = "orsight.forms.pool.names";

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const saved = JSON.parse(raw) as Record<string, string>;
      setForms((current) =>
        current.map((f) => ({
          ...f,
          name: typeof saved[f.id] === "string" && saved[f.id].trim() ? saved[f.id].trim() : f.name,
        })),
      );
    } catch {
      // ignore malformed local storage
    }
  }, []);

  const nameMap = useMemo(() => {
    const next: Record<string, string> = {};
    for (const f of forms) {
      next[f.id] = f.name;
    }
    return next;
  }, [forms]);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(nameMap));
    } catch {
      // ignore storage write errors
    }
  }, [nameMap]);

  function startRename(form: FormCard) {
    setEditingId(form.id);
    setEditingName(form.name);
  }

  function saveRename(formId: string) {
    const nextName = editingName.trim();
    if (!nextName) return;
    setForms((current) => current.map((f) => (f.id === formId ? { ...f, name: nextName } : f)));
    setEditingId(null);
    setEditingName("");
  }

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-6 text-slate-900">
      <div className="mx-auto max-w-6xl space-y-4">
        <header className="rounded-2xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
          <h1 className="text-2xl font-semibold">填表池</h1>
          <p className="mt-2 text-sm text-slate-600">
            在这里管理多个填表。点击填表后将直接进入该填表的填表模式。
          </p>
        </header>

        <section className="grid gap-4 md:grid-cols-2">
          {forms.map((form) => (
            <article key={form.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  {editingId === form.id ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        className="w-48 rounded-md border border-slate-300 px-2 py-1 text-sm outline-none focus:border-blue-500"
                        maxLength={32}
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={() => saveRename(form.id)}
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                      >
                        保存
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(null);
                          setEditingName("");
                        }}
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50"
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-semibold text-slate-900">{form.name}</h2>
                      <button
                        type="button"
                        onClick={() => startRename(form)}
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                      >
                        重命名
                      </button>
                    </div>
                  )}
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
                {form.ready ? (
                  <Link
                    href={form.fillHref}
                    className="inline-flex rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    进入 {form.name}
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
