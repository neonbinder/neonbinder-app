import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

/**
 * The set's year, as the server reads it for the career gap check: the year
 * level's value, leading digits. `undefined` when `wanted` is false (the
 * ancestor chain is not read then), while it loads, and when it has no year.
 */
export function useSetYear(leafId: Id<"selectorOptions">, wanted: boolean): number | undefined {
  const chain = useQuery(api.selectorOptions.getAncestorChain, wanted ? { id: leafId } : "skip");
  const yearValue = chain?.find((c) => c.level === "year")?.value;
  const parsed = yearValue ? Number.parseInt(yearValue, 10) : Number.NaN;
  return Number.isInteger(parsed) ? parsed : undefined;
}
