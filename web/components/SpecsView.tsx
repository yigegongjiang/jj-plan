'use client';

import { useMemo } from 'react';

import { buildChains } from '@/lib/chain';
import type { Project, Spec } from '@/lib/types';
import ChainGraph from './ChainGraph';
import StatusBadge from './StatusBadge';

interface Props {
  project: Project;
  onOpenSpec: (specId: string) => void;
  onEditSpec: (spec: Spec) => void;
  onDeleteSpec: (spec: Spec) => void;
}

export default function SpecsView({
  project,
  onOpenSpec,
  onEditSpec,
  onDeleteSpec,
}: Props) {
  // 对齐 AsksView: 单节点 (length=1) 走 grid 一列 100%; 真链 (length>=2) 才走 ChainGraph 横滑.
  // 避免移动端单 spec 被 ChainGraph 的 flex+min-w-max 撑到 max-w 触发横滚.
  const { standalones, chains } = useMemo(() => {
    const all = buildChains(project.specs);
    const standalones: Spec[] = [];
    const chains: Spec[][] = [];
    for (const c of all) {
      if (c.length === 1) standalones.push(c[0]);
      else chains.push(c);
    }
    return { standalones, chains };
  }, [project.specs]);

  if (standalones.length === 0 && chains.length === 0) {
    return (
      <section>
        <div className="text-sm text-zinc-400 italic px-4 py-8 text-center">
          (no plans)
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      {standalones.length > 0 && (
        <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(min(20rem,100%),1fr))]">
          {standalones.map((spec) => (
            <SpecNode
              key={spec.id}
              spec={spec}
              onOpen={() => onOpenSpec(spec.id)}
              onEdit={() => onEditSpec(spec)}
              onDelete={() => onDeleteSpec(spec)}
            />
          ))}
        </div>
      )}
      {chains.length > 0 && (
        <ChainGraph
          chains={chains}
          renderNode={(spec) => (
            <div className="w-[22rem] shrink-0">
              <SpecNode
                spec={spec}
                onOpen={() => onOpenSpec(spec.id)}
                onEdit={() => onEditSpec(spec)}
                onDelete={() => onDeleteSpec(spec)}
              />
            </div>
          )}
        />
      )}
    </section>
  );
}

interface NodeProps {
  spec: Spec;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function SpecNode({ spec, onOpen, onEdit, onDelete }: NodeProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onOpen();
      }}
      className="group w-full min-w-0 rounded-lg border border-zinc-800 bg-zinc-950 hover:border-zinc-600 hover:bg-zinc-900/60 transition p-3 cursor-pointer"
    >
      <div
        className="text-sm font-medium leading-snug truncate"
        title={spec.title}
      >
        {spec.title}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <StatusBadge status={spec.status} />
          <span className="text-[11px] text-zinc-400 whitespace-nowrap">
            {spec.tasks.length} {spec.tasks.length === 1 ? 'task' : 'tasks'}
          </span>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            className="px-1.5 py-0.5 text-[10px] rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition"
          >
            edit
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="px-1.5 py-0.5 text-[10px] rounded text-zinc-500 hover:text-red-400 hover:bg-red-950/40 transition"
          >
            delete
          </button>
        </div>
      </div>
    </div>
  );
}
