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
  const chains = useMemo(() => buildChains(project.specs), [project.specs]);

  return (
    <section>
      <ChainGraph
        chains={chains}
        emptyText="(no plans)"
        renderNode={(spec) => (
          <SpecNode
            spec={spec}
            onOpen={() => onOpenSpec(spec.id)}
            onEdit={() => onEditSpec(spec)}
            onDelete={() => onDeleteSpec(spec)}
          />
        )}
      />
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
      className="group min-w-[16rem] max-w-[28rem] rounded-lg border border-zinc-800 bg-zinc-950 hover:border-zinc-600 hover:bg-zinc-900/60 transition p-3 cursor-pointer"
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
