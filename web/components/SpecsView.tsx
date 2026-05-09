'use client';

import { useMemo } from 'react';

import { buildChains } from '@/lib/chain';
import { fmtTime } from '@/lib/format';
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
  const chains = useMemo(() => buildChains(project.specs), [project.specs]);

  const taskCount = project.specs.reduce((n, s) => n + s.tasks.length, 0);

  return (
    <div className="space-y-5">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h2 className="text-xl font-semibold">{project.name}</h2>
        <span className="text-xs text-zinc-500">
          {project.specs.length} {project.specs.length === 1 ? 'spec' : 'specs'}{' '}
          · {taskCount} {taskCount === 1 ? 'task' : 'tasks'}
        </span>
        <span className="text-[11px] text-zinc-400 font-mono">
          updated {fmtTime(project.updated_at)}
        </span>
      </div>

      <ChainGraph
        chains={chains}
        emptyText="(no specs) — 用 jjplan CLI 创建一个 spec"
        renderNode={(spec) => (
          <SpecNode
            spec={spec}
            onOpen={() => onOpenSpec(spec.id)}
            onEdit={() => onEditSpec(spec)}
            onDelete={() => onDeleteSpec(spec)}
          />
        )}
      />
    </div>
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
      className="group relative w-56 rounded-lg border border-zinc-800 bg-zinc-950 hover:border-zinc-600 hover:bg-zinc-900/60 transition p-3 cursor-pointer"
    >
      <div className="absolute top-1.5 right-1.5 flex gap-0.5 opacity-0 group-hover:opacity-100 transition">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          className="px-1.5 py-0.5 text-[10px] rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800"
        >
          edit
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="px-1.5 py-0.5 text-[10px] rounded text-zinc-500 hover:text-red-400 hover:bg-red-950/40"
        >
          delete
        </button>
      </div>
      <div className="text-sm font-medium leading-snug pr-10 line-clamp-2 break-words">
        {spec.title}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <StatusBadge status={spec.status} />
        <span className="text-[11px] text-zinc-400">
          {spec.tasks.length} {spec.tasks.length === 1 ? 'task' : 'tasks'}
        </span>
      </div>
    </div>
  );
}
