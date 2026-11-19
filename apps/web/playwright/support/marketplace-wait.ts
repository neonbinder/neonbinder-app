/**
 * NEO-487: how a spec waits on a live marketplace without a flat timeout.
 *
 * Jason's rule: if BuySportsCards took n seconds, the step gets n + 7 s, never a
 * flat bump. The product says when it is waiting: while a call to the marketplace
 * is outstanding (a checklist fetch, Build from Base, a listing step) the screen
 * shows a `role="status"` line "Waiting on BuySportsCards…" with running seconds,
 * and nothing else shows it. `expectAfterMarketplace` waits for a target and
 * gives it its own 7 s (GUIDE hard rule 3, the standard budget) PLUS every
 * second that status was on screen:
 *
 *   own time = elapsed - n,  fails when own time > 7 s
 *
 * so a marketplace that answers slowly (or pushes back and makes us wait) never
 * fails a spec, while a step whose own work is slow still does. A hard cap
 * (default 180 s) ends a marketplace that never answers: past it the wait is a
 * red whatever the status says. The measured n goes into the test report as an
 * annotation (`marketplace-wait`), so a slow marketplace is visible in the run
 * rather than hidden in a timeout.
 *
 * HOW n IS MEASURED. The product shows the status only after a wait has lasted
 * ANNOUNCE_AFTER_MS (1.5 s), so n starts at (first seen - 1.5 s): that time is
 * measured, the marketplace's, not a bump. The status is sampled about every 250 ms (a wait on the
 * target itself, so a landing is seen at once, never a sleep). An interval counts
 * as waiting when the status was on screen at either end of it, so n runs at most
 * one sample high per episode: the tolerance favours the product's slowness being
 * the marketplace's, never ours. The status is shown only while a call is
 * outstanding and lingers a short idle grace after it, which only adds to n.
 *
 * This is the ONE implementation of that rule. A spec never writes its own loop
 * around the status, and never passes a flat `timeout` to a step that waits on
 * BuySportsCards.
 *
 * NEO-552 follow-up (Jason, 2026-11-15: "we should be fast always from the bsc mock
 * server"). BuySportsCards is the fake, so the rule for a BSC step is:
 *  1. a step the screen's "Waiting on BuySportsCards" line covers uses
 *     `expectAfterMarketplace` (or `pickAfterBscSync`), no flat number;
 *  2. a BSC-only step with no such line gets the standard 7 s when its measured
 *     longest run was 3.5 s or less, else ceil(longest + 7 s), the measurement
 *     written at the site;
 *  3. a step that also drives SportLots keeps its old ceiling while SportLots is
 *     live and follows 1-2 while it is paused: `expectStepWithSportLots`, below,
 *     the one place a budget branches on the operator switch.
 */
import { errors, expect, type Locator, type Page } from "@playwright/test";
import type { FlowEnv } from "./env";
import { test } from "./fixtures";

/** What a step is allowed, apart from the marketplace's time (GUIDE hard rule 3). */
const OWN_TIME_MS = 7_000;
/** The longest any single marketplace wait may last, whatever the status says. */
const CAP_MS = 180_000;
/** How often the status is sampled. */
const SAMPLE_MS = 250;
/**
 * The product's own ANNOUNCE_AFTER_MS (WaitingOnMarketplace): the status mounts
 * only once a wait has already lasted this long, so when it first appears the
 * marketplace is known to have taken at least this long. Keep it equal to the product's.
 */
const ANNOUNCE_AFTER_MS = 1_500;

/** The status line a marketplace wait shows, by the platform's name. Contract: a locator, nothing waited for. */
export function waitingOn(page: Page | Locator, platform: string): Locator {
  return page.getByRole("status").filter({ hasText: `Waiting on ${platform}` }).first();
}

export interface MarketplaceWaitOptions {
  /** How the screen names the marketplace; the status reads "Waiting on <platform>…". */
  platform: string;
  /** The hard cap, ms. Default 180 s. A reason to change it belongs at the call site. */
  cap?: number;
  /** What is being waited for, for the failure message and the report. */
  what?: string;
  /** Wait for the target to be visible (default) or to go away. */
  state?: "visible" | "hidden";
}

/**
 * Wait for `target` to be visible (or, with `state: "hidden"`, to go away): 7 s of our own time plus the time the
 * "Waiting on <platform>…" status is on screen, capped. Throws, naming the
 * measurement, when our own share passes 7 s or the cap is reached.
 *
 * Contract: ENTRY the step that starts the wait has been taken. EXIT `target`
 * is visible (or hidden). A `target` that resolves to several elements fails
 * (strict mode), as in any other assert.
 */
export async function expectAfterMarketplace(
  page: Page,
  target: Locator,
  { platform, cap = CAP_MS, what = "the step", state = "visible" }: MarketplaceWaitOptions,
): Promise<void> {
  const status = waitingOn(page, platform);
  const started = Date.now();
  let previous = started;
  let previousSeen = false;
  let waited = 0;
  /** The end of the last stretch counted as the marketplace's (an episode's back-credit stops there). */
  let countedUntil = started;
  for (;;) {
    try {
      await target.waitFor({ state, timeout: SAMPLE_MS });
      note(platform, what, waited, Date.now() - started);
      return;
    } catch (error) {
      if (!(error instanceof errors.TimeoutError)) throw error;
    }
    const now = Date.now();
    const seen = await status.isVisible();
    if (seen && !previousSeen) {
      // A new episode: the product held the status back for ANNOUNCE_AFTER_MS, so the
      // marketplace had already been answering that long (never before the last counted stretch).
      waited += Math.max(0, Math.min(ANNOUNCE_AFTER_MS - (now - previous), previous - countedUntil));
    }
    if (seen || previousSeen) {
      waited += now - previous;
      countedUntil = now;
    }
    previous = now;
    previousSeen = seen;
    const elapsed = now - started;
    if (elapsed >= cap) {
      note(platform, what, waited, elapsed);
      throw new Error(
        `${what} was not on screen after the ${seconds(cap)} cap (${platform} held it ${seconds(waited)}, our own time ${seconds(elapsed - waited)})`,
      );
    }
    if (elapsed - waited > OWN_TIME_MS) {
      note(platform, what, waited, elapsed);
      throw new Error(
        `${what} was not on screen: ${seconds(elapsed)} passed, ${platform} held it ${seconds(waited)}, so our own time is ${seconds(elapsed - waited)} against ${seconds(OWN_TIME_MS)}`,
      );
    }
  }
}

export interface SportLotsStepOptions {
  /** The step's old ceiling, kept while SportLots is live (the step also drives a live SportLots round trip). */
  liveMs: number;
  /** What is being waited for, for the failure message and the report. */
  what: string;
  /**
   * Paused-SportLots budget for a step the wait line does NOT cover (`statusLine: false`,
   * rule 2): the standard 7 s by default, or ceil(longest measured + 7 s) with the
   * measurement in a comment at the site. Ignored when the wait line covers the step.
   */
  pausedMs?: number;
  /**
   * Whether the wait line covers this step while it runs (rule 1). Default true: paused,
   * the step is `expectAfterMarketplace`. False: paused, a plain `pausedMs` (default 7 s).
   */
  statusLine?: boolean;
  /** Wait for the target to be visible (default) or to go away. */
  state?: "visible" | "hidden";
}

/**
 * A step that also drives SportLots (rule 3 of the header). While SportLots is live it
 * keeps `liveMs`, its old ceiling, because a live SportLots round trip is not the
 * fake's pace. While SportLots is paused the step is BuySportsCards only and follows
 * rules 1-2: `expectAfterMarketplace` when the wait line covers it, else a plain
 * `pausedMs` (7 s unless the site measured a longer BSC run). The ONE place a spec's
 * BSC budget branches on `env.SL_PAUSED`.
 *
 * Contract: ENTRY the step that starts the wait has been taken. EXIT `target` is
 * visible (or hidden, with `state: "hidden"`).
 */
export async function expectStepWithSportLots(
  page: Page,
  target: Locator,
  env: Pick<FlowEnv, "SL_PAUSED">,
  { liveMs, what, pausedMs = OWN_TIME_MS, statusLine = true, state = "visible" }: SportLotsStepOptions,
): Promise<void> {
  if (!env.SL_PAUSED) {
    await (state === "visible" ? expect(target).toBeVisible({ timeout: liveMs }) : expect(target).toBeHidden({ timeout: liveMs }));
  } else if (statusLine) {
    await expectAfterMarketplace(page, target, { platform: "BuySportsCards", what, state });
  } else {
    await (state === "visible" ? expect(target).toBeVisible({ timeout: pausedMs }) : expect(target).toBeHidden({ timeout: pausedMs }));
  }
}

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;

/** Put the measurement in the report (an annotation), whether the wait passed or failed. */
function note(platform: string, what: string, waited: number, elapsed: number): void {
  try {
    test.info().annotations.push({
      type: "marketplace-wait",
      description: `${what}: ${platform} held ${seconds(waited)} of ${seconds(elapsed)}`,
    });
  } catch {
    // Not inside a test (a helper run on its own): the thrown message still carries the numbers.
  }
}

/**
 * NEO-489 (Jason, 2026-11-11): a BSC 429, or a cooldown already open, on a spec's live
 * per-card lookup is a PASS, not a red. The product then asks the operator instead of
 * guessing (invariant 8), so a spec whose live card can land either way accepts both
 * outcomes and says which one it met: `answered` (BSC answered, so its pre-fill or chip
 * shows) or `cooldown` (the lookup was skipped or refused, so the operator picks). Both
 * branches keep every other assert unconditional. The outcome goes into the report as a
 * `bsc-lookup` annotation, so the run shows which branch ran.
 */
export type BscLookupOutcome = "answered" | "cooldown";

export function bscLookupOutcome(outcome: BscLookupOutcome, who: string): void {
  try {
    test.info().annotations.push({ type: "bsc-lookup", description: `${who}: ${outcome}` });
  } catch {
    // Not inside a test (a helper run on its own): nothing to annotate.
  }
}
