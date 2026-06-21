'use client';

// Import / export bar for the notes list page.
//
//   * "导入" opens a hidden file picker; on selection we POST the file to
//     /api/import. On success we router.refresh() so the new rows appear
//     without a full reload.
//   * "导出全部" is just a plain anchor pointing at /api/export?scope=all;
//     the browser handles the download.
//
// Errors are surfaced inline as a small message. We never throw — the worst
// case is a flash of an error string that disappears on the next interaction.

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Download, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';

type ImportResponse = {
  data?: {
    imported: number;
    files?: number;
    errors: { filename: string; message: string }[];
    created?: string[];
  };
  error?: string;
  message?: string;
};

export function ImportExportBar() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isImporting, startImport] = useTransition();
  const [status, setStatus] = useState<{
    kind: 'idle' | 'success' | 'error';
    message: string;
  }>({ kind: 'idle', message: '' });

  const isMac =
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  const acceptLabel = isMac ? '导入 (⌘+O)' : '导入 (Ctrl+O)';

  function openPicker() {
    setStatus({ kind: 'idle', message: '' });
    fileInputRef.current?.click();
  }

  function onFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    // HTML <input multiple> exposes every chosen file via `event.target.files`.
    // We send them ALL to the server; the route's `form.getAll('file')`
    // returns one entry per chosen file and processes each independently.
    const files = event.target.files
      ? Array.from(event.target.files)
      : [];
    // Reset the input value so the same file can be re-selected after a
    // failed import.
    event.target.value = '';
    if (files.length === 0) return;
    startImport(async () => {
      try {
        const form = new FormData();
        for (const file of files) {
          // `append` (not `set`) — each file becomes its own form entry
          // with the same field name, which is what `form.getAll('file')`
          // on the server expects.
          form.append('file', file);
        }
        const res = await fetch('/api/import', {
          method: 'POST',
          body: form,
        });
        const payload = (await res.json().catch(() => ({}))) as ImportResponse;
        if (!res.ok) {
          setStatus({
            kind: 'error',
            message: payload.message || payload.error || '导入失败',
          });
          return;
        }
        const imported = payload.data?.imported ?? 0;
        const errorCount = payload.data?.errors?.length ?? 0;
        if (imported === 0 && errorCount > 0) {
          const first = payload.data?.errors?.[0];
          setStatus({
            kind: 'error',
            message:
              first?.message ||
              `导入失败（${errorCount} 个文件出错）`,
          });
          return;
        }
        if (imported > 0 && errorCount > 0) {
          setStatus({
            kind: 'success',
            message: `已导入 ${imported} 篇，${errorCount} 个文件失败`,
          });
        } else {
          const files = payload.data?.files;
          setStatus({
            kind: 'success',
            message:
              files && files > 1
                ? `已从 ${files} 个文件导入 ${imported} 篇`
                : `已导入 ${imported} 篇`,
          });
        }
        router.refresh();
      } catch (err) {
        console.error('[import] upload failed:', err);
        setStatus({
          kind: 'error',
          message: '网络错误，请重试',
        });
      }
    });
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.markdown,.mdown,.mkd,.txt,.zip"
        multiple
        className="hidden"
        onChange={onFileChange}
        aria-hidden
        tabIndex={-1}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={openPicker}
        disabled={isImporting}
        title="可一次选择多个 .md / .txt / .zip 文件批量导入"
      >
        <Upload className="mr-1 h-4 w-4" />
        {isImporting ? '导入中…' : acceptLabel}
      </Button>
      <Button asChild variant="outline" size="sm">
        <a href="/api/export?scope=all">
          <Download className="mr-1 h-4 w-4" />
          导出全部
        </a>
      </Button>
      {status.kind !== 'idle' ? (
        <span
          role="status"
          className={
            status.kind === 'success'
              ? 'text-sm text-muted-foreground'
              : 'text-sm text-destructive'
          }
        >
          {status.message}
        </span>
      ) : null}
    </div>
  );
}
