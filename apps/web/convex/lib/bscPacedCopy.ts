/**
 * NEO-552 — what a collector or operator reads when NeonBinder's own call gate
 * (`bscFetch`, `x-nb-bsc-breaker`) held a BuySportsCards call back. BSC was
 * never asked, so this copy never blames BSC and never names an error code.
 * NB's voice, no internal words (gate, breaker, throttle, 429).
 *
 * Pure and runtime-free: the default-runtime seller client, the Node catalogue
 * adapter and the checklist copy in `parallelChecklistBuild.ts` all read it.
 */

/**
 * The seller sync line. `SyncStatusView` frames it: "Hit a snag: <this> The
 * next round tries again." The next round is automatic, so there is nothing
 * for the collector to do and the copy asks nothing of them.
 */
export const BSC_PACED_SELLER =
  "NeonBinder is pacing its calls to BuySportsCards, so it held this one back for a bit.";

/** The longest wait the catalogue copy names in seconds; past it, minutes. */
const SECONDS_MAX = 90;

/**
 * A catalogue fetch (sets, years, a checklist) an operator started and can
 * simply run again. `retryAfterS` is the gate's own `Retry-After`, when it gave
 * one; without it the copy says "a minute".
 */
export function bscPacedCatalogueMessage(retryAfterS?: number): string {
  const plural = (n: number, unit: string) => `about ${n} ${unit}${n === 1 ? "" : "s"}`;
  const wait =
    retryAfterS === undefined || !Number.isFinite(retryAfterS) || retryAfterS <= 0
      ? "a minute"
      : retryAfterS <= SECONDS_MAX
        ? plural(Math.ceil(retryAfterS), "second")
        : plural(Math.ceil(retryAfterS / 60), "minute");
  return `NeonBinder is pacing its calls to BuySportsCards, so it didn't ask just now. No sweat: give it ${wait} and try again.`;
}

/** Recognises the copy above in a free-text message (`failureFromMessage`, `classifyAdapterError`). */
export const BSC_PACED_MARKER = "pacing its calls to";

/** The gate's `Retry-After` on its own refusal, in seconds, when it sent a usable one. */
export function pacedRetryAfterS(headers: Pick<Headers, "get">): number | undefined {
  const raw = headers.get("retry-after");
  if (raw === null) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
