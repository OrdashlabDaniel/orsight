import FormsPoolBoard from "@/components/FormsPoolBoard";

export default function FormsPoolPage() {
  return <FormsPoolBoard />;
}

/*

type FormCard = {
  id: string;
  name: string;
  desc: string;
  status: string;
  ready: boolean;
  fillHref: string;
  createdAt: number;
};

type RecycleBinItem = {
  id: string;
  form: FormCard;
  deletedAt: number;
  expireAt: number;
};

function createDefaultForms(): FormCard[] {
  return [
    {
      id: "form-1",
      name: "抽擦路线表",
      desc: "已完成：沿用当前线上填表与训练能力。",
      status: "已完成",
      ready: true,
      fillHref: "/",
      createdAt: Date.now(),
    },
  ];
}

export default function FormsPoolPage() {
  const [forms, setForms] = useState<FormCard[]>([]);
  const [recycleBin, setRecycleBin] = useState<RecycleBinItem[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<FormCard | null>(null);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  const formsStorageKey = "orsight.forms.pool.forms";
  const recycleStorageKey = "orsight.forms.pool.recycleBin";
  const retentionMs = 30 * 24 * 60 * 60 * 1000;

  function getRemainingText(expireAt: number) {
    const ms = expireAt - Date.now();
    if (ms <= 0) return "已过期";
    const days = Math.ceil(ms / (24 * 60 * 60 * 1000));
    return `剩余 ${days} 天`;
  }

  useEffect(() => {
    try {
      const rawForms = localStorage.getItem(formsStorageKey);
      const loadedForms = rawForms ? (JSON.parse(rawForms) as FormCard[]) : null;
      const nextForms =
        Array.isArray(loadedForms) && loadedForms.length > 0
          ? loadedForms.filter(
              (f): f is FormCard =>
                !!f &&
                typeof f.id === "string" &&
                typeof f.name === "string" &&
                typeof f.desc === "string" &&
                typeof f.status === "string" &&
                typeof f.ready === "boolean" &&
                typeof f.fillHref === "string",
            )
          : createDefaultForms();

      const now = Date.now();
      const rawRecycle = localStorage.getItem(recycleStorageKey);
      const parsedRecycle = rawRecycle ? (JSON.parse(rawRecycle) as unknown) : [];
      const recycleItems: RecycleBinItem[] = [];

      if (Array.isArray(parsedRecycle)) {
        for (const item of parsedRecycle) {
          if (
            item &&
            typeof item === "object" &&
            typeof (item as RecycleBinItem).id === "string" &&
            typeof (item as RecycleBinItem).deletedAt === "number" &&
            typeof (item as RecycleBinItem).expireAt === "number" &&
            (item as RecycleBinItem).form &&
            typeof (item as RecycleBinItem).form.name === "string"
          ) {
            recycleItems.push(item as RecycleBinItem);
          }
        }
      }

      const activeRecycle = recycleItems.filter((x) => x.expireAt > now);
      setRecycleBin(activeRecycle);
      localStorage.setItem(recycleStorageKey, JSON.stringify(activeRecycle));
      const deletedSet = new Set(activeRecycle.map((x) => x.id));
      setForms(nextForms.filter((f) => !deletedSet.has(f.id)));
    } catch {
      setForms(createDefaultForms());
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(formsStorageKey, JSON.stringify(forms));
    } catch {
      // ignore storage write errors
    }
  }, [forms]);

  useEffect(() => {
    try {
      localStorage.setItem(recycleStorageKey, JSON.stringify(recycleBin));
    } catch {
      // ignore storage write errors
    }
  }, [recycleBin]);

  function createForm() {
    const now = Date.now();
    const count = forms.length + recycleBin.length + 1;
    const newForm: FormCard = {
      id: `form-${now}`,
      name: `新建填表${count}`,
      desc: "待配置：将接入独立规则、独立训练池。",
      status: "规划中",
      ready: false,
      fillHref: "",
      createdAt: now,
    };
    setForms((current) => [...current, newForm]);
  }

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

  async function confirmDelete() {
    if (!deleteTarget) return;
    if (!deletePassword.trim()) {
      setDeleteError("请输入登录密码以确认删除。");
      return;
    }

    setIsDeleting(true);
    setDeleteError("");
    try {
      if (isSupabaseAuthEnabled()) {
        const supabase = createClient();
        const {
          data: { user },
          error: userErr,
        } = await supabase.auth.getUser();
        if (userErr || !user?.email) {
          throw new Error("无法读取当前登录信息，请重新登录后再试。");
        }
        const { error: signInErr } = await supabase.auth.signInWithPassword({
          email: user.email,
          password: deletePassword,
        });
        if (signInErr) {
          throw new Error("密码不正确，删除已取消。");
        }
      }

      const id = deleteTarget.id;
      setForms((current) => current.filter((f) => f.id !== id));
      const now = Date.now();
      setRecycleBin((current) => {
        const rest = current.filter((x) => x.id !== id);
        return [
          ...rest,
          {
            id,
            form: deleteTarget,
            deletedAt: now,
            expireAt: now + retentionMs,
          },
        ];
      });
      if (editingId === id) {
        setEditingId(null);
        setEditingName("");
      }
      setDeleteTarget(null);
      setDeletePassword("");
      setDeleteError("");
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "删除失败，请重试。");
    } finally {
      setIsDeleting(false);
    }
  }

  function restoreForm(item: RecycleBinItem) {
    setRecycleBin((current) => current.filter((x) => x.id !== item.id));
    setForms((current) => {
      const exists = current.some((f) => f.id === item.id);
      if (exists) return current;
      return [...current, item.form];
    });
  }

  function permanentlyDelete(itemId: string) {
    setRecycleBin((current) => current.filter((x) => x.id !== itemId));
  }

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-6 text-slate-900">
      <div className="mx-auto w-[80%] max-w-full space-y-4">
        <header className="rounded-2xl border border-slate-200 bg-white px-6 py-5 shadow-sm">
          <h1 className="text-2xl font-semibold">首页</h1>
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
                      <button
                        type="button"
                        onClick={() => {
                          setDeleteTarget(form);
                          setDeletePassword("");
                          setDeleteError("");
                        }}
                        className="rounded-md border border-rose-300 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50"
                      >
                        删除
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
                onClick={() => createForm()}
                className="inline-flex rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                新建填表
              </button>
            </div>
          </article>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-slate-900">填表回收站</h2>
            <span className="text-xs text-slate-500">已删除填表保留 30 天，超时自动清空</span>
          </div>

          {recycleBin.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">回收站为空。</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {recycleBin
                .slice()
                .sort((a, b) => b.deletedAt - a.deletedAt)
                .map((item) => (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-900">{item.form.name}</p>
                      <p className="text-xs text-slate-500">
                        删除于 {new Date(item.deletedAt).toLocaleString()} · {getRemainingText(item.expireAt)}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => restoreForm(item)}
                        className="rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-white"
                      >
                        恢复
                      </button>
                      <button
                        type="button"
                        onClick={() => permanentlyDelete(item.id)}
                        className="rounded-md border border-rose-300 px-2.5 py-1 text-xs text-rose-700 hover:bg-rose-50"
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

      {deleteTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 px-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-900">删除填表</h3>
            <p className="mt-2 text-sm text-slate-600">
              你正在删除 <strong>{deleteTarget.name}</strong>。请输入当前登录密码确认。
            </p>
            <div className="mt-4">
              <label className="text-sm font-medium text-slate-700">登录密码</label>
              <input
                type="password"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                autoFocus
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                placeholder="输入密码以确认删除"
              />
            </div>
            {deleteError ? (
              <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {deleteError}
              </p>
            ) : null}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  if (isDeleting) return;
                  setDeleteTarget(null);
                  setDeletePassword("");
                  setDeleteError("");
                }}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                取消
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => void confirmDelete()}
                className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-60"
              >
                {isDeleting ? "校验中..." : "确认删除"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
*/
