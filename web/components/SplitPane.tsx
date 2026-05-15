'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

const STORAGE_KEY = 'jjplan_split_ratio';
const DEFAULT_RATIO = 0.5;
const MIN_RATIO = 0.1;
const MAX_RATIO = 0.9;

interface Props {
  top: ReactNode;
  bottom: ReactNode;
}

// Vertical splitter: top/bottom panels share container height by `ratio`.
// Persisted to localStorage so user preference survives page reload.
// Double-click splitter to reset 50/50.
export default function SplitPane({ top, bottom }: Props) {
  const [ratio, setRatio] = useState(DEFAULT_RATIO);
  const [hydrated, setHydrated] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved !== null) {
      const r = Number.parseFloat(saved);
      if (Number.isFinite(r) && r >= MIN_RATIO && r <= MAX_RATIO) {
        setRatio(r);
      }
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(STORAGE_KEY, String(ratio));
  }, [ratio, hydrated]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    // 拖动期间禁止文本选中, 提升体验
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'row-resize';
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    if (rect.height <= 0) return;
    const next = (e.clientY - rect.top) / rect.height;
    const clamped = Math.min(MAX_RATIO, Math.max(MIN_RATIO, next));
    setRatio(clamped);
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
  }, []);

  const onDoubleClick = useCallback(() => {
    setRatio(DEFAULT_RATIO);
  }, []);

  return (
    <div
      ref={containerRef}
      className="flex flex-col h-[calc(100vh-9rem)] min-h-[20rem]"
    >
      <div
        style={{ height: `${ratio * 100}%` }}
        className="min-h-0 overflow-hidden"
      >
        {top}
      </div>
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuemin={MIN_RATIO * 100}
        aria-valuemax={MAX_RATIO * 100}
        title="拖动调整 ASKS / PLANS 比例 · 双击重置 50/50"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        className="h-1.5 shrink-0 cursor-row-resize bg-zinc-800 hover:bg-zinc-600 active:bg-zinc-500 transition-colors my-1 rounded-full"
      />
      <div className="min-h-0 overflow-hidden flex-1">{bottom}</div>
    </div>
  );
}
