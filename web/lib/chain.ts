// Build ordered chains from a list of items linked via `prev_id`.
//
// Each chain is laid out head → ... → tail. An item is treated as a head
// when its `prev_id` is null OR points outside the input list (defensive
// fallback against orphaned references). Input order is preserved: the
// server returns specs already sorted by head's `updated_at DESC` with
// successors trailing their head, so we just collect heads as we encounter
// them and walk each chain forward.

export interface ChainItem {
  id: string;
  prev_id: string | null;
}

export function buildChains<T extends ChainItem>(items: T[]): T[][] {
  const byId = new Map<string, T>();
  for (const it of items) byId.set(it.id, it);

  const successor = new Map<string, T>();
  const heads: T[] = [];
  for (const it of items) {
    if (it.prev_id !== null && byId.has(it.prev_id)) {
      successor.set(it.prev_id, it);
    } else {
      heads.push(it);
    }
  }

  const chains: T[][] = [];
  const visited = new Set<string>();
  for (const head of heads) {
    if (visited.has(head.id)) continue;
    const chain: T[] = [head];
    visited.add(head.id);
    let cur: T = head;
    while (true) {
      const nxt = successor.get(cur.id);
      if (!nxt || visited.has(nxt.id)) break;
      chain.push(nxt);
      visited.add(nxt.id);
      cur = nxt;
    }
    chains.push(chain);
  }

  return chains;
}
