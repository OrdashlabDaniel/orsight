"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  DEFAULT_FORM_ID,
  buildFormFillHref,
  buildFormSetupHref,
  splitForms,
  type FormDefinition,
} from "@/lib/forms";

type FormsResponse = {
  forms?: FormDefinition[];
  error?: string;
};

type FormMutationResponse = {
  form?: FormDefinition | null;
  error?: string;
};

function statusLabel(form: FormDefinition) {
  return form.ready ? "已完成" : "新建中";
}

function remainingRecycleText(deletedAt?: number | null) {
  if (!deletedAt) {
    return "回收站保留 30 天";
  }
  const remainingMs = deletedAt + 30 * 24 * 60 * 60 * 1000 - Date.now();
  if (remainingMs <= 0) {
    return "即将清空";
  }
  return `剩余 ${Math.ceil(remainingMs / (24 * 60 * 60 * 1000))} 天`;
}

export default function FormsPoolClient() {
  const router = useRouter();
  const [forms, setForms] = useState<FormDefinition[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [workingKey, setWorkingKey] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [noticeMessage, setNoticeMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const { active, recycleBin } = useMemo(() => splitForms(forms), [forms]);

  const loadForms = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage("");
    try {
      const response = await fetch("/api/forms", { cache: "no-store" });
      const payload = (await response.json()) as FormsResponse;
      if (!response.ok) {
        throw new Error(payload.error || "读取填表池失败。");
      }
      setForms(payload.forms || []);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "读取填表池失败。");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadForms();
  }, [loadForms]);

  async function mutateForm(formId: string, body: Record<string, unknown>) {
    const response = await fetch(`/api/forms/${encodeURIComponent(formId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as FormMutationResponse;
    if (!response.ok) {
      throw new Error(payload.error || "更新填表失败。");
    }
    return payload.form || null;
  }

  async function handleCreateForm() {
    setWorkingKey("create");
    setErrorMessage("");
    setNoticeMessage("");
    try {
      const response = await fetch("/api/forms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = (await response.json()) as FormMutationResponse;
      if (!response.ok || !payload.form) {
        throw new Error(payload.error || "新建填表失败。");
      }
      router.push(buildFormSetupHref(payload.form.id));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "新建填表失败。");
    } finally {
      setWorkingKey("");
    }
  }

  async function handleDuplicateForm(form: FormDefinition) {
    setWorkingKey(`duplicate:${form.id}`);
    setErrorMessage("");
    setNoticeMessage("");
    try {
      const duplicated = await mutateForm(form.id, { action: "duplicate" });
      await loadForms();
      setNoticeMessage(duplicated ? `已复制为新的独立填表：${duplicated.name}` : "填表已复制。");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "复制填表失败。");
    } finally {
      setWorkingKey("");
    }
  }

  async function handleDeleteForm(form: FormDefinition) {
    setWorkingKey(`delete:${form.id}`);
    setErrorMessage("");
    setNoticeMessage("");
    try {
      await mutateForm(form.id, { action: "delete" });
      await loadForms();
      setNoticeMessage(`已移入回收站：${form.name}`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "删除填表失败。");
    } finally {
      setWorkingKey("");
    }
  }

  async function handleRestoreForm(form: FormDefinition) {
    setWorkingKey(`restore:${form.id}`);
    setErrorMessage("");
    setNoticeMessage("");
    try {
      await mutateForm(form.id, { action: "restore" });
      await loadForms();
      setNoticeMessage(`已恢复填表：${form.name}`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "恢复填表失败。");
    } finally {
      setWorkingKey("");
    }
  }

  async function handlePermanentDelete(form: FormDefinition) {
    setWorkingKey(`purge:${form.id}`);
    setErrorMessage("");
    setNoticeMessage("");
    try {
      await mutateForm(form.id, { action: "permanent-delete" });
      await loadForms();
      setNoticeMessage(`已永久删除：${form.name}`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "永久删除失败。");
    } finally {
      setWorkingKey("");
    }
  }

  async function handleRename(formId: string) {
    const nextName = editingName.trim();
    if (!nextName) {
      setErrorMessage("请先输入新的填表名称。");
      return;
    }

    setWorkingKey(`rename:${formId}`);
    setErrorMessage("");
    setNoticeMessage("");
    try {
      const form = await mutateForm(formId, { action: "update", name: nextName });
      await loadForms();
      setEditingId(null);
      setEditingName("");
      setNoticeMessage(form ? `已重命名为：${form.name}` : "填表名称已更新。");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "重命名失败。");
    } finally {
      setWorkingKey("");
    }
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-slate-100 px-4 py-6 text-slate-900">
      <div className="mx-auto max-w-6xl space-y-4">
        <header className="rounded-2xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
          <h1 className="text-2xl font-semibold">填表池</h1>
          <p className="mt-2 text-sm text-slate-600">
            在这里管理多个填表。每个填表都拥有独立的填表模式、训练模式、训练池和工作规则。
          </p>
          {noticeMessage ? (
            <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {noticeMessage}
            </div>
          ) : null}
          {errorMessage ? (
            <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {errorMessage}
            </div>
          ) : null}
        </header>

        <section className="grid gap-4 md:grid-cols-2">
          {active.map((form) => {
            const isBusy = Boolean(workingKey) && workingKey.includes(form.id);
            const isDefaultForm = form.id === DEFAULT_FORM_ID;
            return (
              <article key={form.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    {editingId === form.id ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          value={editingName}
                          onChange={(event) => setEditingName(event.target.value)}
                          maxLength={48}
                          autoFocus
                          className="w-64 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                        />
                        <button
                          type="button"
                          onClick={() => void handleRename(form.id)}
                          disabled={isBusy}
                          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                          保存
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(null);
                            setEditingName("");
                          }}
                          className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-500 hover:bg-slate-50"
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-lg font-semibold text-slate-900">{form.name}</h2>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(form.id);
                            setEditingName(form.name);
                          }}
                          className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                        >
                          重命名
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDuplicateForm(form)}
                          disabled={isBusy}
                          className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                        >
                          复制
                        </button>
                        {!isDefaultForm ? (
                          <button
                            type="button"
                            onClick={() => void handleDeleteForm(form)}
                            disabled={isBusy}
                            className="rounded-md border border-rose-300 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                          >
                            删除
                          </button>
                        ) : null}
                      </div>
                    )}
                    <p className="mt-2 text-sm text-slate-600">{form.description}</p>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      form.ready ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {statusLabel(form)}
                  </span>
                </div>

                <div className="mt-5 flex flex-wrap gap-3">
                  {form.ready ? (
                    <Link
                      href={buildFormFillHref(form.id)}
                      className="inline-flex rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      进入填表
                    </Link>
                  ) : (
                    <Link
                      href={buildFormSetupHref(form.id)}
                      className="inline-flex rounded-lg border border-blue-300 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50"
                    >
                      继续配置
                    </Link>
                  )}
                  <Link
                    href={buildFormSetupHref(form.id)}
                    className="inline-flex rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
                  >
                    配置模板与训练
                  </Link>
                </div>
              </article>
            );
          })}

          <article className="rounded-2xl border border-dashed border-slate-300 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">新建填表</h2>
            <p className="mt-2 text-sm text-slate-600">
              创建新的独立填表空间。新填表会拥有自己的表格模板、训练池和专属工作规则。
            </p>
            <div className="mt-5">
              <button
                type="button"
                onClick={() => void handleCreateForm()}
                disabled={workingKey === "create" || isLoading}
                className="inline-flex rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {workingKey === "create" ? "创建中..." : "新建填表"}
              </button>
            </div>
          </article>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-slate-900">填表回收站</h2>
            <span className="text-xs text-slate-500">已删除填表保留 30 天，超时自动清空</span>
          </div>

          {isLoading ? (
            <p className="mt-4 text-sm text-slate-500">正在读取填表池...</p>
          ) : recycleBin.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">回收站为空。</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {recycleBin.map((form) => (
                <li
                  key={form.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
                >
                  <div>
                    <div className="text-sm font-semibold text-slate-800">{form.name}</div>
                    <div className="mt-1 text-xs text-slate-500">{remainingRecycleText(form.deletedAt)}</div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void handleRestoreForm(form)}
                      disabled={workingKey === `restore:${form.id}`}
                      className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-white disabled:opacity-50"
                    >
                      恢复
                    </button>
                    <button
                      type="button"
                      onClick={() => void handlePermanentDelete(form)}
                      disabled={workingKey === `purge:${form.id}`}
                      className="rounded-lg border border-rose-300 px-3 py-2 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                    >
                      永久删除
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
