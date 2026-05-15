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
  // Split chains: length=1 (standalone) flows into a CSS grid so独立 ask 在宽屏并排,
  // length>=2 (real chains) keep ChainGraph 的横向链式语义。
  const { standalones, chains } = useMemo(() => {
    if (!asks) return { standalones: [] as Ask[], chains: [] as Ask[][] };
    const all = buildChains(asks);
    const standalones: Ask[] = [];
    const chains: Ask[][] = [];
    for (const c of all) {
      if (c.length === 1) standalones.push(c[0]);
      else chains.push(c);
    }
    return { standalones, chains };
  }, [asks]);

  if (asks === null) {
    return (
      <section>
        <div className="text-xs text-zinc-500">loading…</div>
      </section>
    );
  }

  const isEmpty = standalones.length === 0 && chains.length === 0;

  if (isEmpty) {
    return (
      <section>
        <div className="text-sm text-zinc-400 italic px-4 py-8 text-center">
          (no asks)
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      {standalones.length > 0 && (
        <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(22rem,1fr))]">
          {standalones.map((ask) => (
            <AskCard
              key={ask.id}
              ask={ask}
              onEdit={() => onEdit(ask)}
              onDelete={() => onDelete(ask)}
            />
          ))}
        </div>
      )}
      {chains.length > 0 && (
        <ChainGraph
          chains={chains}
          renderNode={(ask) => (
            <div className="w-[22rem] shrink-0">
              <AskCard
                ask={ask}
                onEdit={() => onEdit(ask)}
                onDelete={() => onDelete(ask)}
              />
            </div>
          )}
        />
      )}
    </section>
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
    <div className="w-full min-w-0 rounded-lg border border-zinc-800 bg-zinc-950 hover:border-zinc-600 transition p-3 flex flex-col gap-2">
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
