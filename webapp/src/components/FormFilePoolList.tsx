"use client";

import type { ReactNode } from "react";

import type { FormFilePoolItem } from "@/lib/form-file-pools";

type FormFilePoolListProps = {
  title: string;
  description: string;
  files: FormFilePoolItem[];
  emptyText: string;
  countLabel: string;
  openLabel: string;
  deleteLabel: string;
  deletingLabel: string;
  buildFileHref: (file: FormFilePoolItem) => string;
  onDelete: (file: FormFilePoolItem) => void | Promise<void>;
  deletingFileId?: string | null;
  children?: ReactNode;
};

function formatBytes(size: number) {
  if (size >= 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (size >= 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${size} B`;
}

function fileBadgeLabel(file: FormFilePoolItem) {
  const ext = file.fileName.includes(".") ? file.fileName.split(".").pop()?.toUpperCase() : "";
  if (ext) {
    return ext.slice(0, 8);
  }
  switch (file.kind) {
    case "image":
      return "IMG";
    case "pdf":
      return "PDF";
    case "spreadsheet":
      return "SHEET";
    case "document":
      return "DOC";
    case "text":
      return "TEXT";
    default:
      return "FILE";
  }
}

function formatUploadedAt(uploadedAt: number) {
  try {
    return new Date(uploadedAt).toLocaleString();
  } catch {
    return "";
  }
}

export function FormFilePoolList({
  title,
  description,
  files,
  emptyText,
  countLabel,
  openLabel,
  deleteLabel,
  deletingLabel,
  buildFileHref,
  onDelete,
  deletingFileId,
  children,
}: FormFilePoolListProps) {
  return (
    <section className="shrink-0 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">{title}</h3>
          <p className="mt-0.5 max-w-2xl text-xs text-[var(--muted-foreground)]">{description}</p>
        </div>
        <div className="rounded-full bg-[var(--accent-muted)] px-2.5 py-1 text-[11px] text-[var(--muted-foreground)]">
          {countLabel}
        </div>
      </div>

      {children ? <div className="mt-3">{children}</div> : null}

      {files.length ? (
        <div className="mt-3 max-h-72 overflow-y-auto rounded-lg border border-[var(--border)]">
          <ul className="divide-y divide-[var(--border)]">
            {files.map((file) => (
              <li key={file.id} className="flex items-start gap-3 px-3 py-3">
                <div className="mt-0.5 rounded-full border border-[var(--border)] bg-[var(--background)] px-2 py-0.5 text-[10px] font-medium tracking-wide text-[var(--muted-foreground)]">
                  {fileBadgeLabel(file)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium" title={file.fileName}>
                    {file.fileName}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--muted-foreground)]">
                    <span>{formatBytes(file.size)}</span>
                    <span>{formatUploadedAt(file.uploadedAt)}</span>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <a
                    href={buildFileHref(file)}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--foreground)] hover:bg-[var(--accent-muted)]"
                  >
                    {openLabel}
                  </a>
                  <button
                    type="button"
                    onClick={() => void onDelete(file)}
                    disabled={deletingFileId === file.id}
                    className="rounded-md border border-rose-200 px-2.5 py-1 text-xs text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {deletingFileId === file.id ? deletingLabel : deleteLabel}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="mt-3 rounded-lg border border-dashed border-[var(--border)] bg-[var(--background)] px-4 py-6 text-center text-sm text-[var(--muted-foreground)]">
          {emptyText}
        </div>
      )}
    </section>
  );
}
