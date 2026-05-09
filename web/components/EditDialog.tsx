'use client';

import { useEffect, useState } from 'react';

import { MAX_BODY_LEN, MAX_TITLE_LEN } from '@/lib/types';

export interface EditTarget {
  kind: 'spec' | 'task';
  id: string;
  title: string;
  body: string;
  status: string;
  statuses: readonly string[];
}

export interface EditDraft {
  title?: string;
  body?: string;
  status?: string;
}

interface Props {
  target: EditTarget;
  busy: boolean;
  errorMessage?: string | null;
  onSave: (draft: EditDraft) => void;
  onCancel: () => void;
}

export default function EditDialog({
  target,
  busy,
  errorMessage,
  onSave,
  onCancel,
}: Props) {
  const [title, setTitle] = useState(target.title);
  const [body, setBody] = useState(target.body);
  const [status, setStatus] = useState(target.status);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onCancel();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  function submit() {
    const draft: EditDraft = {};
    if (title !== target.title) draft.title = title;
    if (body !== target.body) draft.body = body;
    if (status !== target.status) draft.status = status;
    if (Object.keys(draft).length === 0) {
      onCancel();
      return;
    }
    onSave(draft);
  }

  const dirty =
    title !== target.title ||
    body !== target.body ||
    status !== target.status;
  const valid =
    title.trim().length > 0 &&
    title.length <= MAX_TITLE_LEN &&
    body.length <= MAX_BODY_LEN;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div className="w-full max-w-xl rounded-lg bg-zinc-950 border border-zinc-800 shadow-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-zinc-800 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs text-zinc-500 uppercase tracking-wider">
              edit {target.kind}
            </div>
            <div className="text-xs font-mono text-zinc-400 mt-0.5 truncate">
              {target.id}
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
                title
              </span>
              <span className="text-[10px] text-zinc-400 font-mono">
                {title.length}/{MAX_TITLE_LEN}
              </span>
            </div>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={MAX_TITLE_LEN}
              className="mt-1.5 w-full px-3 py-2 rounded-md bg-zinc-900 border border-zinc-800 focus:border-blue-500 focus:outline-none text-sm"
            />
          </label>

          <label className="block">
            <span className="text-xs text-zinc-500 uppercase tracking-wider">
              status
            </span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="mt-1.5 w-full px-3 py-2 rounded-md bg-zinc-900 border border-zinc-800 focus:border-blue-500 focus:outline-none text-sm cursor-pointer"
            >
              {target.statuses.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-zinc-500 uppercase tracking-wider">
                body
              </span>
              <span className="text-[10px] text-zinc-400 font-mono">
                {body.length}/{MAX_BODY_LEN}
              </span>
            </div>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              maxLength={MAX_BODY_LEN}
              className="mt-1.5 w-full px-3 py-2 rounded-md bg-zinc-900 border border-zinc-800 focus:border-blue-500 focus:outline-none text-sm font-mono resize-y"
              spellCheck={false}
            />
          </label>

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
            disabled={busy || !valid || !dirty}
            className="px-4 py-1.5 text-sm rounded-md bg-blue-500 text-zinc-950 font-medium hover:bg-blue-400 transition disabled:opacity-50"
          >
            {busy ? 'saving…' : 'save'}
          </button>
        </div>
      </div>
    </div>
  );
}
