'use client';

import { fmtTime } from '@/lib/format';
import type { Project } from '@/lib/types';

interface Props {
  projects: Project[];
  onOpen: (name: string) => void;
  onDelete: (project: Project) => void;
}

export default function ProjectsList({ projects, onOpen, onDelete }: Props) {
  if (projects.length === 0) {
    return (
      <div className="text-center text-zinc-500 py-16 text-sm">
        (no projects) — 用 jjplan CLI 创建一个 spec 即可初始化项目
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
      {projects.map((p) => {
        const taskCount = p.specs.reduce((n, s) => n + s.tasks.length, 0);
        return (
          <button
            key={p.name}
            onClick={() => onOpen(p.name)}
            className="group text-left rounded-lg border border-zinc-800 bg-zinc-950 hover:border-zinc-700 hover:bg-zinc-900/60 transition p-4 relative"
          >
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                onDelete(p);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation();
                  onDelete(p);
                }
              }}
              className="absolute top-2.5 right-2.5 px-2 py-0.5 text-[11px] rounded text-zinc-400 hover:text-red-400 hover:bg-red-950/40 transition opacity-0 group-hover:opacity-100"
              aria-label={`delete project ${p.name}`}
            >
              delete
            </span>
            <div className="font-medium truncate pr-12">{p.name}</div>
            <div className="text-xs text-zinc-500 mt-1">
              {p.specs.length} {p.specs.length === 1 ? 'spec' : 'specs'} ·{' '}
              {taskCount} {taskCount === 1 ? 'task' : 'tasks'}
            </div>
            <div className="text-[11px] text-zinc-400 mt-2 font-mono">
              updated {fmtTime(p.updated_at)}
            </div>
          </button>
        );
      })}
    </div>
  );
}
