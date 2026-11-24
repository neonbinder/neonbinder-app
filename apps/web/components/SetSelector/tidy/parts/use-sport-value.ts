import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

/**
 * The display name of a sport row ("Baseball"), for copy only. The same read
 * `SportSwitch` makes, so Convex serves both from one subscription. Undefined
 * until it lands, and for a sport it does not hold; never keyed on.
 */
export function useSportValue(sportId: Id<"selectorOptions"> | undefined, enabled = true): string | undefined {
  const sports = useQuery(
    api.selectorOptions.getSelectorOptions,
    enabled && sportId !== undefined ? { level: "sport" } : "skip",
  );
  return useMemo(
    () => (sportId === undefined ? undefined : sports?.find((s) => s._id === sportId)?.value),
    [sports, sportId],
  );
}
