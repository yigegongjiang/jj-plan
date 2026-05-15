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
  scrollHidden?: boolean;
}

export default function ProjectTabs({
  askCount,
  specCount,
  taskCount,
  asks,
  plans,
  scrollHidden = false,
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
    <div className="flex flex-col">
      <div
        role="tablist"
        className={
          'sticky top-[calc(3rem+env(safe-area-inset-top))] sm:top-[calc(3.5rem+env(safe-area-inset-top))] z-10 -mx-3 sm:-mx-4 px-3 sm:px-4 flex items-center gap-4 sm:gap-6 border-b border-zinc-800 bg-zinc-950 sm:bg-zinc-950/90 sm:backdrop-blur transition-transform duration-200 ease-out ' +
          (scrollHidden
            ? '-translate-y-full sm:translate-y-0'
            : 'translate-y-0')
        }
      >
        <TabButton
          active={tab === 'plans'}
          onClick={() => setTab('plans')}
          label="PLANS"
          counts={`${specCount} · ${taskCount}`}
          fullCounts={`${specCount} specs · ${taskCount} tasks`}
        />
        <TabButton
          active={tab === 'asks'}
          onClick={() => setTab('asks')}
          label="ASKS"
          counts={`${askCount}`}
          fullCounts={`${askCount}`}
        />
      </div>
      <div className="pt-3">{tab === 'plans' ? plans : asks}</div>
    </div>
  );
}

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  label: string;
  counts: string;
  fullCounts: string;
}

function TabButton({
  active,
  onClick,
  label,
  counts,
  fullCounts,
}: TabButtonProps) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={
        'flex items-baseline gap-2 px-1 py-1.5 sm:py-2 -mb-px border-b-2 transition-colors ' +
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
      <span className="text-xs text-zinc-500 font-mono">
        <span className="sm:hidden">{counts}</span>
        <span className="hidden sm:inline">{fullCounts}</span>
      </span>
    </button>
  );
}
