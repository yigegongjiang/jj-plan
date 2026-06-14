'use client';

import { useEffect, useState } from 'react';

import { MAX_BODY_LEN, type Ask } from '@/lib/types';

interface Props {
  ask: Ask;
  busy: boolean;
  errorMessage?: string | null;
  onSave: (body: string) => void;
  onCancel: () => void;
}

export default function AskEditDialog({
  ask,
  busy,
  errorMessage,
  onSave,
  onCancel,
}: Props) {
  const [body, setBody] = useState(ask.body);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onCancel();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  const dirty = body !== ask.body;
  const valid = body.length > 0 && body.length <= MAX_BODY_LEN;

  function submit() {
    if (!dirty) {
      onCancel();
      return;
    }
    onSave(body);
  }

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
              edit ask
            </div>
            <div className="text-xs font-mono text-zinc-400 mt-0.5 truncate">
              {ask.id}
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
