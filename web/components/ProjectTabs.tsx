'use client';

import { useEffect, useState, type ReactNode } from 'react';

const STORAGE_KEY = 'jjplan_project_tab';
type Tab = 'plans' | 'asks';
const DEFAULT_TAB: Tab = 'plans';

interface Props {
  askCount: number;
  specCount: number;
  taskCount: number;
  asks: ReactNode;
  plans: ReactNode;
}

export default function ProjectTabs({
  askCount,
  specCount,
  taskCount,
  asks,
  plans,
}: Props) {
  const [tab, setTab] = useState<Tab>(DEFAULT_TAB);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'plans' || saved === 'asks') setTab(saved);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(STORAGE_KEY, tab);
  }, [tab, hydrated]);

  return (
    <div className="flex flex-col h-[calc(100vh-9rem)] min-h-[20rem]">
      <div
        role="tablist"
        className="flex items-center gap-6 shrink-0 border-b border-zinc-800"
      >
        <TabButton
          active={tab === 'plans'}
          onClick={() => setTab('plans')}
          label="PLANS"
          counts={`${specCount} specs · ${taskCount} tasks`}
        />
        <TabButton
          active={tab === 'asks'}
          onClick={() => setTab('asks')}
          label="ASKS"
          counts={`${askCount}`}
        />
      </div>
      <div className="flex-1 min-h-0 overflow-hidden pt-3">
        {tab === 'plans' ? plans : asks}
      </div>
    </div>
  );
}

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  label: string;
  counts: string;
}

function TabButton({ active, onClick, label, counts }: TabButtonProps) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={
        'flex items-baseline gap-2 px-1 py-2 -mb-px border-b-2 transition-colors ' +
        (active
          ? 'border-zinc-100 text-zinc-100'
          : 'border-transparent text-zinc-500 hover:text-zinc-300')
      }
    >
      <span
        className={
          'text-sm uppercase tracking-wider ' +
          (active ? 'font-semibold' : 'font-medium')
        }
      >
        {label}
      </span>
      <span className="text-xs text-zinc-500 font-mono">{counts}</span>
    </button>
  );
}
