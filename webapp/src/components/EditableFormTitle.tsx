"use client";

import { useEffect, useMemo, useState } from "react";

import { useLocale } from "@/i18n/LocaleProvider";
import { getLocalizedFormName } from "@/lib/form-display";
import type { FormDefinition } from "@/lib/forms";

type FormResponse = {
  form?: FormDefinition | null;
  error?: string;
};

type EditableFormTitleProps = {
  formId: string;
  onNotice?: (message: string) => void;
  onError?: (message: string) => void;
  titleClassName?: string;
  wrapperClassName?: string;
};

export function EditableFormTitle({
  formId,
  onNotice,
  onError,
  titleClassName = "text-[20px] font-medium leading-7 tracking-[0.06em] text-slate-600",
  wrapperClassName = "flex flex-wrap items-center gap-2.5",
}: EditableFormTitleProps) {
  const { locale, t } = useLocale();
  const [form, setForm] = useState<FormDefinition | null>(null);
  const [draftName, setDraftName] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const localizedTitle = useMemo(() => {
    if (!form) {
      return "";
    }
    return getLocalizedFormName(form, locale);
  }, [form, locale]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch(`/api/forms/${encodeURIComponent(formId)}`, { cache: "no-store" });
        const payload = (await response.json().catch(() => null)) as FormResponse | null;
        if (!response.ok || !payload?.form) {
          throw new Error(payload?.error || "Failed to load form.");
        }
        if (cancelled) {
          return;
        }
        setForm(payload.form);
        setDraftName(payload.form.name);
        setIsEditing(false);
      } catch {
        if (cancelled) {
          return;
        }
        setForm(null);
        setDraftName("");
        setIsEditing(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [formId]);

  async function saveRename() {
    const nextName = draftName.trim();
    if (!nextName) {
      onError?.(t("formsPool.errRenameEmpty"));
      return;
    }

    setIsSaving(true);
    onError?.("");
    try {
      const response = await fetch(`/api/forms/${encodeURIComponent(formId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update",
          name: nextName,
        }),
      });
      const payload = (await response.json().catch(() => null)) as FormResponse | null;
      if (!response.ok || !payload?.form) {
        throw new Error(payload?.error || t("formsPool.errRename"));
      }

      setForm(payload.form);
      setDraftName(payload.form.name);
      setIsEditing(false);
      onNotice?.(t("formsPool.renamed", { name: getLocalizedFormName(payload.form, locale) }));
    } catch (error) {
      onError?.(error instanceof Error ? error.message : t("formsPool.errRename"));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className={wrapperClassName}>
      {isEditing ? (
        <>
          <input
            type="text"
            value={draftName}
            onChange={(event) => setDraftName(event.target.value.slice(0, 48))}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void saveRename();
              }
              if (event.key === "Escape") {
                setDraftName(form?.name || "");
                setIsEditing(false);
              }
            }}
            autoFocus
            className="min-w-[220px] max-w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm tracking-[0.02em] text-slate-700 outline-none focus:border-slate-400"
          />
          <button
            type="button"
            onClick={() => void saveRename()}
            disabled={isSaving}
            className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-medium tracking-[0.04em] text-slate-500 hover:bg-slate-100 disabled:opacity-50"
          >
            {isSaving ? t("formSetup.saving") : t("formsPool.save")}
          </button>
          <button
            type="button"
            onClick={() => {
              setDraftName(form?.name || "");
              setIsEditing(false);
            }}
            disabled={isSaving}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] tracking-[0.04em] text-slate-400 hover:bg-slate-50 disabled:opacity-50"
          >
            {t("formsPool.cancel")}
          </button>
        </>
      ) : (
        <>
          <h1 className={titleClassName}>{localizedTitle}</h1>
          <button
            type="button"
            onClick={() => {
              setDraftName(form?.name || "");
              setIsEditing(true);
            }}
            disabled={!form}
            className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium tracking-[0.04em] text-slate-500 hover:bg-slate-100 disabled:opacity-50"
          >
            {t("formsPool.rename")}
          </button>
        </>
      )}
    </div>
  );
}
