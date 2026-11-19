/**
 * NEO-592 — bounded, order-preserving concurrency for the reads inside ONE
 * Convex query or mutation.
 *
 * ## Why this exists
 *
 * Inside a single transaction, `ctx.db.get` and indexed reads that are awaited
 * together are sent to storage as one batch per round (the backend groups
 * pending reads; `MAX_SYSCALL_BATCH_SIZE` is 16 by default), while reads awaited
 * one after another pay one storage round trip each. The review gate
 * (`resolveChecklistEntities`) did ~660 reads one at a time, so its wall time
 * was its storage latency times 660: 1.8 s on a good run, 7-10 s when storage
 * answered 4-5x slower. The READ SET is unchanged by concurrency (the same
 * documents are read, so invalidation and OCC behave as before); only the
 * latency changes.
 *
 * ## The contract
 *
 *  - **Order-preserving**: element `i` of the result is `fn(items[i], i)`,
 *    whatever order the calls finish in.
 *  - **At most `limit` calls in flight** (default `STORAGE_BATCH_WIDTH`, 16: a
 *    narrower pool leaves batch slots empty, a wider one only queues).
 *  - **Settles every worker before it rethrows.** When one call rejects, no new
 *    item is started, the calls already in flight run to the end, and only then
 *    is the FIRST error (by time) thrown. Nothing is left dangling past the
 *    function's return, which a transaction must not do.
 *
 * Use it only for independent reads. Anything where item `i` needs item
 * `i - 1`'s answer (a cursor walk) stays sequential.
 */

/** Convex sends at most this many concurrent reads to storage as one batch. */
export const STORAGE_BATCH_WIDTH = 16;

export async function mapBounded<T, R>(
  items: ReadonlyArray<T>,
  fn: (item: T, index: number) => Promise<R>,
  limit: number = STORAGE_BATCH_WIDTH,
): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`mapBounded: limit must be a positive integer, got ${limit}`);
  }
  const results: R[] = new Array<R>(items.length);
  const state: { next: number; failed: boolean; error: unknown } = {
    next: 0,
    failed: false,
    error: undefined,
  };
  // A worker never rejects: it records the first failure and stops, so the
  // `Promise.all` below resolves only once EVERY worker has settled.
  const worker = async (): Promise<void> => {
    while (!state.failed) {
      const index = state.next++;
      if (index >= items.length) return;
      try {
        results[index] = await fn(items[index], index);
      } catch (error) {
        if (!state.failed) {
          state.failed = true;
          state.error = error;
        }
        return;
      }
    }
  };
  const workers = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  if (state.failed) throw state.error;
  return results;
}

/**
 * Memoise an async loader by key, caching the PROMISE rather than the value.
 *
 * Once reads run concurrently, a plain `Map<key, value>` cache loses its
 * dedupe: two callers that both miss before either has answered both read.
 * Caching the in-flight promise makes the second caller wait for the first
 * read instead of issuing its own.
 */
export function memoizeAsync<K, V>(load: (key: K) => Promise<V>): (key: K) => Promise<V> {
  const cache = new Map<K, Promise<V>>();
  return (key) => {
    let hit = cache.get(key);
    if (!hit) {
      hit = load(key);
      cache.set(key, hit);
    }
    return hit;
  };
}

/**
 * `Promise.all` that waits for EVERY promise to settle before it throws.
 *
 * `Promise.all` rejects as soon as one input does and leaves the others
 * running; a later rejection among them is then nobody's to handle. For
 * action-level fan-out (several `ctx.runQuery` calls started together) this
 * keeps the same rule `mapBounded` keeps inside a query: nothing is left in
 * flight when the caller sees the error. The error thrown is the first
 * rejection in ARGUMENT order.
 */
export async function settleAll<T extends readonly unknown[]>(
  promises: { [K in keyof T]: Promise<T[K]> },
): Promise<T> {
  const settled = await Promise.allSettled(promises as ReadonlyArray<Promise<unknown>>);
  const values: unknown[] = [];
  for (const result of settled) {
    if (result.status === "rejected") throw result.reason;
    values.push(result.value);
  }
  return values as unknown as T;
}
