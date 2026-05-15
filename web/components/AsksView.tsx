'use client';

import { useMemo, useState } from 'react';

import { buildChains } from '@/lib/chain';
import { fmtTime } from '@/lib/format';
import type { Ask } from '@/lib/types';
import ChainGraph from './ChainGraph';

interface Props {
  asks: Ask[] | null;
  onEdit: (ask: Ask) => void;
  onDelete: (ask: Ask) => void;
}

export default function AsksView({ asks, onEdit, onDelete }: Props) {
  const chains = useMemo(() => (asks ? buildChains(asks) : []), [asks]);

  if (asks === null) {
    return (
      <section className="space-y-3">
        <Header count={null} />
        <div className="text-xs text-zinc-500">loading…</div>
      </section>
    );
  }
  return (
    <section className="space-y-3">
      <Header count={asks.length} />
      <ChainGraph
        chains={chains}
        emptyText="(no asks)"
        renderNode={(ask) => (
          <AskCard
            ask={ask}
            onEdit={() => onEdit(ask)}
            onDelete={() => onDelete(ask)}
          />
        )}
      />
    </section>
  );
}

function Header({ count }: { count: number | null }) {
  return (
    <div className="flex items-baseline gap-3 flex-wrap">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
        asks
      </h3>
      {count !== null && (
        <span className="text-[11px] text-zinc-500">
          {count} {count === 1 ? 'ask' : 'asks'}
        </span>
      )}
    </div>
  );
}

function AskCard({
  ask,
  onEdit,
  onDelete,
}: {
  ask: Ask;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  // 仅当内容可能超出 clamp 时才显示 expand 按钮; 短内容隐去, 避免噪声
  const mayOverflow = useMemo(() => bodyMayOverflow(ask.body), [ask.body]);

  return (
    <div className="w-[22rem] shrink-0 rounded-lg border border-zinc-800 bg-zinc-950 hover:border-zinc-600 transition p-3 flex flex-col gap-2">
      <div
        className={
          expanded
            ? 'text-sm leading-snug text-zinc-100 whitespace-pre-wrap break-words'
            : 'text-sm leading-snug text-zinc-100 whitespace-pre-wrap break-words line-clamp-6'
        }
      >
        {ask.body}
      </div>
      {mayOverflow && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="self-start text-[11px] text-zinc-500 hover:text-zinc-200 transition"
        >
          {expanded ? '× collapse' : '▾ expand'}
        </button>
      )}
      {ask.origin.length > 0 && (
        <details className="text-[11px] text-zinc-500">
          <summary className="cursor-pointer select-none hover:text-zinc-300">
            origin
          </summary>
          <div className="mt-1 px-2 py-1.5 rounded bg-zinc-900/60 whitespace-pre-wrap break-words font-mono text-zinc-400">
            {ask.origin}
          </div>
        </details>
      )}
      <div className="mt-auto pt-1.5 flex items-center justify-between gap-2 border-t border-zinc-900">
        <div className="flex flex-col min-w-0">
          <span
            className="text-[10px] font-mono text-zinc-500 truncate"
            title={ask.id}
          >
            {ask.id}
          </span>
          <span className="text-[10px] font-mono text-zinc-500">
            {fmtTime(ask.updated_at)}
          </span>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={onEdit}
            className="px-1.5 py-0.5 text-[10px] rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition"
          >
            edit
          </button>
          <button
            onClick={onDelete}
            className="px-1.5 py-0.5 text-[10px] rounded text-zinc-500 hover:text-red-400 hover:bg-red-950/40 transition"
          >
            delete
          </button>
        </div>
      </div>
    </div>
  );
}

// Heuristic: 真正超出 line-clamp-6 时才暴露 expand. 字数/换行任一超阈值即视为可能溢出
function bodyMayOverflow(body: string): boolean {
  if (body.length > 180) return true;
  const lines = body.split('\n').length;
  return lines > 6;
}
