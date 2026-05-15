'use client';

import type { ReactNode } from 'react';

interface NodeLike {
  id: string;
}

interface Props<T extends NodeLike> {
  chains: T[][];
  renderNode: (node: T, ctx: { isSelected: boolean }) => ReactNode;
  selectedId?: string | null;
  emptyText?: string;
}

export default function ChainGraph<T extends NodeLike>({
  chains,
  renderNode,
  selectedId,
  emptyText,
}: Props<T>) {
  if (chains.length === 0) {
    return (
      <div className="text-sm text-zinc-400 italic px-4 py-8 text-center">
        {emptyText ?? '(empty)'}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {chains.map((chain) => {
        const isChain = chain.length >= 2;
        return (
          <div key={chain[0].id} className="space-y-1.5">
            {isChain && (
              <div className="flex items-center gap-1.5 px-1 text-[11px] text-zinc-500 font-mono">
                <ChainBadge />
                <span>
                  chain · {chain.length} items · swipe{' '}
                  <span aria-hidden>→</span>
                </span>
              </div>
            )}
            <div className="relative -mx-4">
              <div className="overflow-x-auto no-scrollbar px-4">
                <div className="flex items-stretch gap-2 min-w-max">
                  {chain.map((node, idx) => (
                    <div key={node.id} className="flex items-stretch gap-2">
                      <div
                        className={
                          isChain && idx === 0
                            ? 'flex items-stretch border-l-2 border-zinc-700 pl-1.5'
                            : 'flex items-stretch'
                        }
                      >
                        {renderNode(node, {
                          isSelected: node.id === selectedId,
                        })}
                      </div>
                      {idx < chain.length - 1 && (
                        <div className="flex items-center text-zinc-500 select-none px-0.5">
                          <Arrow />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              {isChain && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute top-0 right-0 bottom-0 w-8 bg-gradient-to-l from-zinc-950 to-transparent"
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Arrow() {
  return (
    <svg
      width="20"
      height="14"
      viewBox="0 0 20 14"
      fill="none"
      aria-hidden
    >
      <path
        d="M1 7H17M17 7L12 2M17 7L12 12"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChainBadge() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
      className="shrink-0"
    >
      <path
        d="M6.5 9.5L9.5 6.5M5.5 10.5L4.5 11.5C3.4 12.6 1.6 12.6 0.5 11.5C-0.6 10.4 -0.6 8.6 0.5 7.5L3.5 4.5C4.6 3.4 6.4 3.4 7.5 4.5M10.5 5.5L11.5 4.5C12.6 3.4 14.4 3.4 15.5 4.5C16.6 5.6 16.6 7.4 15.5 8.5L12.5 11.5C11.4 12.6 9.6 12.6 8.5 11.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
