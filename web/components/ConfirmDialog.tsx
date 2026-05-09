'use client';

import { useEffect } from 'react';

interface Props {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  title,
  message,
  confirmLabel = 'confirm',
  cancelLabel = 'cancel',
  danger = false,
  busy,
  onConfirm,
  onCancel,
}: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onCancel();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div className="w-full max-w-md rounded-lg bg-zinc-950 border border-zinc-800 shadow-2xl overflow-hidden">
        <div className="p-5">
          <h2 className="text-base font-semibold">{title}</h2>
          <p className="mt-2 text-sm text-zinc-400">{message}</p>
        </div>
        <div className="px-5 py-3 border-t border-zinc-800 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-1.5 text-sm rounded-md border border-zinc-800 hover:bg-zinc-900 transition disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className={`px-4 py-1.5 text-sm rounded-md font-medium transition disabled:opacity-50 ${
              danger
                ? 'bg-red-500 text-zinc-950 hover:bg-red-400'
                : 'bg-blue-500 text-zinc-950 hover:bg-blue-400'
            }`}
          >
            {busy ? '…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
