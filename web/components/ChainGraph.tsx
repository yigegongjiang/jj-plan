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
      {chains.map((chain) => (
        <div
          key={chain[0].id}
          className="overflow-x-auto no-scrollbar -mx-4 px-4"
        >
          <div className="flex items-stretch gap-2 min-w-max">
            {chain.map((node, idx) => (
              <div
                key={node.id}
                className="flex items-stretch gap-2"
              >
                {renderNode(node, { isSelected: node.id === selectedId })}
                {idx < chain.length - 1 && (
                  <div className="flex items-center text-zinc-500 select-none px-0.5">
                    <Arrow />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
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
