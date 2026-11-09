/**
 * A binary min-heap of items by priority, for the pathfinder's Dijkstra. Items of
 * equal priority come out in no promised order, but the same pushes always give
 * the same pops, so a search over the same network finds the same path.
 */
export class MinHeap<T> {
  private items: T[] = [];
  private priorities: number[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: T, priority: number): void {
    const { items, priorities } = this;
    items.push(item);
    priorities.push(priority);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (priorities[parent] <= priorities[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  /** The item of lowest priority with its priority, removed; undefined when empty. */
  pop(): { item: T; priority: number } | undefined {
    const { items, priorities } = this;
    if (items.length === 0) return undefined;

    const top = { item: items[0], priority: priorities[0] };
    const lastItem = items.pop()!;
    const lastPriority = priorities.pop()!;
    if (items.length === 0) return top;

    items[0] = lastItem;
    priorities[0] = lastPriority;
    let i = 0;
    for (;;) {
      const left = i * 2 + 1;
      const right = left + 1;
      let smallest = i;
      if (left < items.length && priorities[left] < priorities[smallest]) smallest = left;
      if (right < items.length && priorities[right] < priorities[smallest]) smallest = right;
      if (smallest === i) break;
      this.swap(i, smallest);
      i = smallest;
    }
    return top;
  }

  private swap(a: number, b: number): void {
    const { items, priorities } = this;
    [items[a], items[b]] = [items[b], items[a]];
    [priorities[a], priorities[b]] = [priorities[b], priorities[a]];
  }
}
