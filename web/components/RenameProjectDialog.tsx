'use client';

import { useEffect, useMemo, useState } from 'react';

import { MAX_PROJECT_NAME_LEN, type Project } from '@/lib/types';

interface Props {
  project: Project;
  existingNames: string[];
  busy: boolean;
  errorMessage?: string | null;
  onSubmit: (newName: string) => void;
  onCancel: () => void;
}

export default function RenameProjectDialog({
  project,
  existingNames,
  busy,
  errorMessage,
  onSubmit,
  onCancel,
}: Props) {
  const [name, setName] = useState(project.name);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onCancel();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  const trimmed = name.trim();
  const willMerge = useMemo(
    () =>
      trimmed.length > 0 &&
      trimmed !== project.name &&
      existingNames.some((n) => n === trimmed && n !== project.name),
    [trimmed, project.name, existingNames],
  );

  const valid =
    trimmed.length > 0 &&
    trimmed.length <= MAX_PROJECT_NAME_LEN &&
    trimmed !== project.name;

  function submit() {
    if (!valid) return;
    onSubmit(trimmed);
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div className="w-full max-w-md rounded-lg bg-zinc-950 border border-zinc-800 shadow-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-zinc-800 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs text-zinc-500 uppercase tracking-wider">
              rename project
            </div>
            <div className="text-xs font-mono text-zinc-400 mt-0.5 truncate">
              {project.name}
            </div>
          </div>
          <button
            disabled={busy}
            onClick={onCancel}
            className="text-zinc-500 hover:text-zinc-300 disabled:opacity-50 text-xl leading-none shrink-0"
            aria-label="close"
          >
            ×
          </button>
        </div>
        <div className="p-5 space-y-4">
          <label className="block">
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-zinc-500 uppercase tracking-wider">
                new name
              </span>
              <span className="text-[10px] text-zinc-400 font-mono">
                {trimmed.length}/{MAX_PROJECT_NAME_LEN}
              </span>
            </div>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && valid && !busy) submit();
              }}
              maxLength={MAX_PROJECT_NAME_LEN}
              className="mt-1.5 w-full px-3 py-2 rounded-md bg-zinc-900 border border-zinc-800 focus:border-blue-500 focus:outline-none text-sm font-mono"
              spellCheck={false}
            />
          </label>

          {willMerge && (
            <div className="px-3 py-2 rounded-md border border-amber-900 bg-amber-950/40 text-amber-300 text-xs leading-relaxed">
              目标 project「{trimmed}」已存在; 提交后会把当前 project 的
              spec / task / ask 全部合并进去, 旧 project 名将消失. 此操作不可撤销.
            </div>
          )}

          {errorMessage && (
            <div className="px-3 py-2 rounded-md border border-red-900 bg-red-950/40 text-red-300 text-xs">
              {errorMessage}
            </div>
          )}
        </div>
        <div className="px-5 py-3 border-t border-zinc-800 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-1.5 text-sm rounded-md border border-zinc-800 hover:bg-zinc-900 transition disabled:opacity-50"
          >
            cancel
          </button>
          <button
            onClick={submit}
            disabled={busy || !valid}
            className={`px-4 py-1.5 text-sm rounded-md font-medium transition disabled:opacity-50 ${
              willMerge
                ? 'bg-amber-500 text-zinc-950 hover:bg-amber-400'
                : 'bg-blue-500 text-zinc-950 hover:bg-blue-400'
            }`}
          >
            {busy ? '…' : willMerge ? 'merge' : 'rename'}
          </button>
        </div>
      </div>
    </div>
  );
}
