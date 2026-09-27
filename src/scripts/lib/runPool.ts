/**
 * Run `task` over `items`, at most `concurrency` at a time, and return the
 * results in the order of `items` however the workers happen to interleave.
 *
 * A throw stops the other workers from picking up more work; once the tasks
 * already in flight have finished, the pool rejects with the first error. A task that can fail in an expected
 * way should return that as a result instead, so that a throw keeps meaning
 * "something is wrong with the run", not "this item failed".
 *
 * `onProgress` is called with the number of items finished after each one.
 */
export async function runPool<T, R>(
  items: readonly T[],
  concurrency: number,
  task: (item: T, index: number) => Promise<R>,
  onProgress?: (done: number) => void,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  let done = 0;
  let aborted = false;

  const worker = async (): Promise<void> => {
    while (!aborted) {
      const index = nextIndex++;
      if (index >= items.length) return;

      try {
        results[index] = await task(items[index], index);
      } catch (error) {
        aborted = true;
        throw error;
      }

      done++;
      onProgress?.(done);
    }
  };

  const workerCount = Math.min(Math.max(1, Math.floor(concurrency) || 1), items.length);

  // allSettled, not all: a rejection must not return control to a caller that
  // then ends the pool its other tasks are still querying through.
  const settled = await Promise.allSettled(Array.from({ length: workerCount }, () => worker()));
  const failure = settled.find((outcome) => outcome.status === "rejected");
  if (failure) throw failure.reason;
  return results;
}
