'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { fmtTime } from '@/lib/format';
import type { Spec, Task } from '@/lib/types';
import ChainGraph from './ChainGraph';
import StatusBadge from './StatusBadge';

interface Props {
  spec: Spec;
  onEditSpec: (spec: Spec) => void;
  onDeleteSpec: (spec: Spec) => void;
  onEditTask: (task: Task) => void;
  onDeleteTask: (task: Task) => void;
}

export default function SpecDetail({
  spec,
  onEditSpec,
  onDeleteSpec,
  onEditTask,
  onDeleteTask,
}: Props) {
  // tasks 已由 worker 按链表顺序返回，所以单 chain
  const taskChain: Task[][] = spec.tasks.length > 0 ? [spec.tasks] : [];

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const itemRefs = useRef<Map<string, HTMLElement>>(new Map());

  // 选中态在 spec 切换时重置；选中 task 被删后清空
  useEffect(() => {
    setSelectedId(null);
  }, [spec.id]);
  useEffect(() => {
    if (selectedId && !spec.tasks.some((t) => t.id === selectedId)) {
      setSelectedId(null);
    }
  }, [spec.tasks, selectedId]);

  const registerItem = useCallback(
    (id: string) => (el: HTMLElement | null) => {
      if (el) itemRefs.current.set(id, el);
      else itemRefs.current.delete(id);
    },
    [],
  );

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id);
    const el = itemRefs.current.get(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex items-start gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2 flex-wrap">
              <h2 className="text-xl font-semibold break-words">
                {spec.title}
              </h2>
              <StatusBadge status={spec.status} />
            </div>
            <div className="text-[11px] text-zinc-400 mt-1 font-mono">
              updated {fmtTime(spec.updated_at)}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => onEditSpec(spec)}
              className="px-2 py-1 text-xs rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition"
            >
              edit
            </button>
            <button
              onClick={() => onDeleteSpec(spec)}
              className="px-2 py-1 text-xs rounded text-zinc-500 hover:text-red-400 hover:bg-red-950/40 transition"
            >
              delete
            </button>
          </div>
        </div>

        {spec.body ? (
          <pre className="px-4 py-3 rounded-md bg-zinc-950 border border-zinc-800 whitespace-pre-wrap break-words font-mono text-sm text-zinc-300">
            {spec.body}
          </pre>
        ) : (
          <div className="text-xs text-zinc-400 italic">(empty body)</div>
        )}
      </section>

      <section className="space-y-3">
        <div className="text-[11px] text-zinc-500 uppercase tracking-wider">
          tasks ({spec.tasks.length})
        </div>
        <ChainGraph
          chains={taskChain}
          selectedId={selectedId}
          emptyText="(no tasks) — 用 jjplan CLI 在此 spec 下创建一个 task"
          renderNode={(task, { isSelected }) => (
            <TaskNode
              task={task}
              seq={spec.tasks.indexOf(task) + 1}
              total={spec.tasks.length}
              isSelected={isSelected}
              onClick={() => handleSelect(task.id)}
            />
          )}
        />
      </section>

      {spec.tasks.length > 0 && (
        <section className="space-y-3">
          {spec.tasks.map((task, idx) => (
            <TaskItem
              key={task.id}
              task={task}
              seq={idx + 1}
              total={spec.tasks.length}
              isSelected={task.id === selectedId}
              registerRef={registerItem(task.id)}
              onEdit={() => onEditTask(task)}
              onDelete={() => onDeleteTask(task)}
            />
          ))}
        </section>
      )}
    </div>
  );
}

interface NodeProps {
  task: Task;
  seq: number;
  total: number;
  isSelected: boolean;
  onClick: () => void;
}

function TaskNode({ task, seq, total, isSelected, onClick }: NodeProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onClick();
      }}
      className={`relative w-48 rounded-lg border bg-zinc-950 transition p-3 cursor-pointer ${
        isSelected
          ? 'border-blue-500 bg-blue-950/20'
          : 'border-zinc-800 hover:border-zinc-600 hover:bg-zinc-900/60'
      }`}
    >
      <div className="flex items-center gap-2 text-[10px] text-zinc-400 font-mono tabular-nums">
        {seq}/{total}
      </div>
      <div className="mt-1 text-sm font-medium leading-snug line-clamp-2 break-words">
        {task.title}
      </div>
      <div className="mt-2">
        <StatusBadge status={task.status} />
      </div>
    </div>
  );
}

interface ItemProps {
  task: Task;
  seq: number;
  total: number;
  isSelected: boolean;
  registerRef: (el: HTMLElement | null) => void;
  onEdit: () => void;
  onDelete: () => void;
}

function TaskItem({
  task,
  seq,
  total,
  isSelected,
  registerRef,
  onEdit,
  onDelete,
}: ItemProps) {
  return (
    <section
      ref={registerRef}
      className={`scroll-mt-20 rounded-md border p-4 space-y-3 transition ${
        isSelected
          ? 'border-blue-500 bg-blue-950/20'
          : 'border-zinc-800 bg-zinc-900/40'
      }`}
    >
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-[10px] text-zinc-500 font-mono tabular-nums">
              {seq}/{total}
            </span>
            <span className="text-sm font-medium break-words">
              {task.title}
            </span>
            <StatusBadge status={task.status} />
          </div>
          <div className="text-[11px] text-zinc-400 mt-1 font-mono">
            updated {fmtTime(task.updated_at)}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onEdit}
            className="px-2 py-1 text-xs rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition"
          >
            edit
          </button>
          <button
            onClick={onDelete}
            className="px-2 py-1 text-xs rounded text-zinc-500 hover:text-red-400 hover:bg-red-950/40 transition"
          >
            delete
          </button>
        </div>
      </div>
      {task.body ? (
        <pre className="px-3 py-2 rounded bg-zinc-950 border border-zinc-800 whitespace-pre-wrap break-words font-mono text-xs text-zinc-300">
          {task.body}
        </pre>
      ) : (
        <div className="text-xs text-zinc-400 italic">(empty body)</div>
      )}
    </section>
  );
}
