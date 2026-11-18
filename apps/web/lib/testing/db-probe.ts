/**
 * NEO-592 — a counting wrapper for `ctx.db`, for tests that must show HOW a
 * query reads, not only what it answers.
 *
 * `peak` is the most reads in flight at once (a read is "in flight" from the
 * call until its promise settles), so a loop of awaited reads peaks at 1 and a
 * `Promise.all` of sixteen peaks at 16. `total` counts reads, `byTable` counts
 * the index reads (`first` / `unique` / `collect` / `take` / `paginate`) per
 * table, and `gets` counts point reads.
 *
 * Usage, inside `t.run`: `handler._handler({ ...ctx, db: probe.db }, args)`.
 * Writes pass through uncounted.
 */

const TERMINAL = new Set(["first", "unique", "collect", "take", "paginate"]);

export type DbProbe = {
  db: any;
  stats: {
    peak: number;
    total: number;
    gets: number;
    byTable: Record<string, number>;
  };
};

export function probeDb(db: any): DbProbe {
  const stats = { peak: 0, total: 0, gets: 0, byTable: {} as Record<string, number> };
  let inFlight = 0;
  const track = <T>(work: PromiseLike<T>): Promise<T> => {
    stats.total += 1;
    inFlight += 1;
    stats.peak = Math.max(stats.peak, inFlight);
    return Promise.resolve(work).finally(() => {
      inFlight -= 1;
    });
  };
  const wrapQuery = (query: any, table: string): any =>
    new Proxy(query, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          const result = value.apply(target, args);
          if (typeof prop === "string" && TERMINAL.has(prop)) {
            stats.byTable[table] = (stats.byTable[table] ?? 0) + 1;
            return track(result);
          }
          return result && typeof result === "object" ? wrapQuery(result, table) : result;
        };
      },
    });
  const proxy = new Proxy(db, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      if (prop === "get") {
        return (...args: unknown[]) => {
          stats.gets += 1;
          return track(value.apply(target, args));
        };
      }
      if (prop === "query") {
        return (table: string) => wrapQuery(value.call(target, table), table);
      }
      return value.bind(target);
    },
  });
  return { db: proxy, stats };
}
