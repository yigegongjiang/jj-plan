import type { SpecStatus, TaskStatus } from '@/lib/types';

const COLOR: Record<SpecStatus | TaskStatus, string> = {
  todo: 'bg-zinc-800/60 text-zinc-400 border-zinc-700',
  active: 'bg-blue-950/60 text-blue-300 border-blue-900',
  doing: 'bg-blue-950/60 text-blue-300 border-blue-900',
  done: 'bg-emerald-950/60 text-emerald-300 border-emerald-900',
  blocked: 'bg-red-950/60 text-red-300 border-red-900',
};

export default function StatusBadge({
  status,
}: {
  status: SpecStatus | TaskStatus;
}) {
  const cls = COLOR[status] ?? 'bg-zinc-800 text-zinc-400 border-zinc-700';
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider border ${cls}`}
    >
      {status}
    </span>
  );
}
