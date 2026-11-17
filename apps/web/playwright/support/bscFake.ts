/**
 * NEO-552: how a spec makes the fake BuySportsCards misbehave, or hands its
 * seller an order. Previews, worktree deployments and dev call a fake BSC, never
 * the real site, so a slow answer, a 429 or a 503 happens only when a spec asks
 * for it. This is the one place that asks.
 *
 *   test("...", { tag: ["@set-selector", "@bsc-breaker"] }, async ({ page, signIn, bscFake }) => {
 *     await signIn("/set-selector");
 *     await bscFake.setFaults([bscFault.tooManyRequests(BSC_PATH.cardListing, { retryAfterS: 90 })]);
 *     // ... press Sync; the fake answers 429 until teardown clears the rules.
 *   });
 *
 * HOW. A spec cannot call a Convex action, so the helpers open the signed-in
 * worker's second page on `/testing/bsc-fake?...` (the NEO-552 hop, which calls
 * `api.testing.setMyBscFaults` / `addMyBscOrder` / `clearMyBscFaults` /
 * `clearBscCallGate` as that worker), read its status line and close it. The
 * spec's own page is never moved. Every rule lands on the worker's OWN fake
 * account (a namespace per test user), so a fault never reaches another shard.
 *
 * TEARDOWN IS AUTOMATIC. `bscFake` is a fixture (support/fixtures.ts): when the
 * test ends, red or green, it drops the fault rules the test set and, if any
 * rule could have opened the BSC call gate, clears that too. A rule's own TTL
 * is not a teardown: the next spec on the worker would meet what is left of it.
 * A teardown that cannot clear fails the test, by name.
 *
 * THE CALL GATE IS DEPLOYMENT-WIDE. Convex keeps ONE breaker per deployment
 * (`convex/bscCallGate.ts`; its token bucket is not applied against the fake, so there is no rate cap). A 429 opens it at once, and five
 * consecutive 5xx or timeouts open it too (no fault drops the connection: a
 * `reset` answers 503 at once, and a `hang` the caller outwaits ends in a 503 at
 * its 2-minute cap); while it is open EVERY shard's BSC calls are refused. So a rule of kind `429`, `503`,
 * `hang` or `reset` is allowed only in a spec tagged `@bsc-breaker` (listed in
 * `BREAKER_SPECS`, project-scope.mjs), which CI runs alone after every shard;
 * `setFaults` throws on the others. A `delay` is fine anywhere as long as it is
 * shorter than the caller's own timeout (a card-listing call gives up at 5 s,
 * the seller profile read at 20 s, the seller sheet at 90 s): a delay that
 * outlasts the timeout is a failure to the gate, and belongs in a breaker spec.
 *
 * ORDERS are not cleared by teardown: the fake has no per-order delete, only a
 * whole-account reset, which would wipe the worker's listings too. An order
 * stays on the worker's fake account until the next reset, so a spec that
 * injects one must be the only user of the cards it names.
 *
 * Contract helpers only: nothing here asserts product behaviour.
 */
import type { BrowserContext, Page } from "@playwright/test";
import { expect } from "@playwright/test";

/** The BSC path templates the fake's rules match on (the same names Convex's call telemetry uses). */
export const BSC_PATH = {
  /** The team lookup behind a checklist fetch: GET marketplace/card/:id/card-listing. Public, per card. */
  cardListing: "marketplace/card/:id/card-listing",
  /** The collector's seller profile: GET. */
  profile: "marketplace/user/profile",
  /** The catalogue's facets: POST. */
  filters: "search/bulk-upload/filters",
  /** The catalogue's rows: POST. */
  results: "search/bulk-upload/results",
  /** The seller's sheet: POST. */
  sellerSheet: "seller/bulk-upload/results",
  /** The listing write: PUT. */
  sellerWrite: "seller/bulk-upload",
  /** The seller's order history: POST. */
  orderHistory: "seller/order/history",
  /** One order: GET. */
  orderDetail: "seller/order/:id",
} as const;

export type BscMethod = "GET" | "POST" | "PUT" | "DELETE";
export type BscFaultKind = "429" | "503" | "delay" | "hang" | "reset";

/** One fault rule, as `api.testing.setMyBscFaults` takes it (services/fake-bsc/CONTRACT.md, "Faults"). */
export interface BscFaultRule {
  match: { method: BscMethod; pathTemplate: string; cardId?: string };
  kind: BscFaultKind;
  /** `delay` only: how long the fake holds the answer (0 to 120000 ms). */
  delayMs?: number;
  /** `429` / `503`: the Retry-After the fake sends, seconds (0 to 3600). */
  retryAfterS?: number;
  /** How many matching requests it applies to (1 to 1000); unlimited until its TTL when omitted. */
  times?: number;
  /** How long it lives, seconds (1 to 3600); the fake's default is 10 minutes. */
  ttlS?: number;
}

/** The kinds that can open the deployment-wide BSC call gate, so need `@bsc-breaker`. */
const BREAKER_KINDS: ReadonlySet<BscFaultKind> = new Set(["429", "503", "hang", "reset"]);
/** The tag a spec carries when it may open the gate (project-scope.mjs BREAKER_TAG). */
const BREAKER_TAG = "@bsc-breaker";

interface RuleOptions {
  method?: BscMethod;
  cardId?: string;
  times?: number;
  ttlS?: number;
}

/** The method BSC uses on each path template; a rule on any other template names its method. */
const METHOD_OF: Readonly<Record<string, BscMethod>> = {
  [BSC_PATH.cardListing]: "GET",
  [BSC_PATH.profile]: "GET",
  [BSC_PATH.orderDetail]: "GET",
  [BSC_PATH.filters]: "POST",
  [BSC_PATH.results]: "POST",
  [BSC_PATH.sellerSheet]: "POST",
  [BSC_PATH.sellerWrite]: "PUT",
  [BSC_PATH.orderHistory]: "POST",
};

function ruleOf(
  kind: BscFaultKind,
  pathTemplate: string,
  { method, cardId, times, ttlS }: RuleOptions,
  extra: Pick<BscFaultRule, "delayMs" | "retryAfterS"> = {},
): BscFaultRule {
  const verb = method ?? METHOD_OF[pathTemplate];
  if (verb === undefined) throw new Error(`Name the HTTP method for a fault on ${pathTemplate}: it is not one of BSC_PATH.`);
  return {
    match: { method: verb, pathTemplate, ...(cardId ? { cardId } : {}) },
    kind,
    ...extra,
    ...(times !== undefined ? { times } : {}),
    ...(ttlS !== undefined ? { ttlS } : {}),
  };
}

/** Builders for the rules specs ask for; each reads as the behaviour it makes. */
export const bscFault = {
  /** Answer 429 (with `Retry-After` when given). Opens the call gate: `@bsc-breaker` only. */
  tooManyRequests: (pathTemplate: string, o: RuleOptions & { retryAfterS?: number } = {}): BscFaultRule =>
    ruleOf("429", pathTemplate, o, o.retryAfterS !== undefined ? { retryAfterS: o.retryAfterS } : {}),
  /** Answer 503. Five in a row open the call gate: `@bsc-breaker` only. */
  unavailable: (pathTemplate: string, o: RuleOptions & { retryAfterS?: number } = {}): BscFaultRule =>
    ruleOf("503", pathTemplate, o, o.retryAfterS !== undefined ? { retryAfterS: o.retryAfterS } : {}),
  /** Hold the answer for `delayMs`, then answer normally. Keep it under the caller's own timeout. */
  slow: (pathTemplate: string, delayMs: number, o: RuleOptions = {}): BscFaultRule => ruleOf("delay", pathTemplate, o, { delayMs }),
  /** Hold the answer: the caller's own timeout ends the call (the fake answers 503 at its 2-minute cap). Counts as a failure to the gate: `@bsc-breaker` only. */
  hangs: (pathTemplate: string, o: RuleOptions = {}): BscFaultRule => ruleOf("hang", pathTemplate, o),
  /** Answer 503 at once, with no `Retry-After` (the fake's `reset` kind; it never drops the socket). Counts as a failure to the gate: `@bsc-breaker` only. */
  answersUnavailable: (pathTemplate: string, o: RuleOptions = {}): BscFaultRule => ruleOf("reset", pathTemplate, o),
};

/** An order a buyer places, in NB's terms (`api.testing.addMyBscOrder`). */
export interface BscOrder {
  orderNo?: string;
  /** Default `READY_TO_SHIP`. */
  status?: string;
  orderDateMs?: number;
  items: Array<{ cardId: string; condition: string; quantity: number; priceCents?: number; sellerSku?: string }>;
}

const STATUS = /^\[testing-bsc-fake\] /;
export const DONE = /^\[testing-bsc-fake\] (Fault rules set|Order added|Cleared)/;
export const FAILED = /^\[testing-bsc-fake\] (Error:|Give exactly|\?(rules|order|clear)=|Testing mode)/;

/**
 * The control a spec drives through the `bscFake` fixture. One per test, bound
 * to the signed-in worker's browser context.
 */
export class BscFake {
  private rulesSet = false;
  private gateAtRisk = false;
  private readonly breakerAllowed: boolean;

  constructor(
    private readonly context: BrowserContext,
    tags: readonly string[],
    /** The first arrival on a new page pays the app's cold load and Clerk handshake (the suite's LAUNCH_GATE). */
    private readonly arrivalMs: number,
  ) {
    this.breakerAllowed = tags.includes(BREAKER_TAG);
  }

  /**
   * Replace the worker's fault rules with `rules` (1 to 20). The rules stay until
   * `clear()`, the test's end or their own TTL. Throws on a rule that can open
   * the call gate in a spec without `@bsc-breaker`.
   *
   * Contract: ENTRY the worker is signed in (the spec has passed its `signIn` gate). EXIT the fake holds
   * the rules.
   */
  async setFaults(rules: readonly BscFaultRule[]): Promise<void> {
    const risky = rules.filter((r) => BREAKER_KINDS.has(r.kind));
    if (risky.length > 0 && !this.breakerAllowed) {
      throw new Error(
        `A ${risky[0].kind} fault on ${risky[0].match.pathTemplate} can open the deployment-wide BSC call gate, which stops every shard's BuySportsCards calls. ` +
          `Tag this spec "${BREAKER_TAG}" and list it in BREAKER_SPECS (playwright/project-scope.mjs) so CI runs it alone after the shards.`,
      );
    }
    this.rulesSet = true;
    if (risky.length > 0) this.gateAtRisk = true;
    await this.hop(`rules=${encodeURIComponent(JSON.stringify(rules))}`, "Fault rules set");
  }

  /** Add one order to the worker's fake seller history. Not cleared at teardown (see the header). */
  async addOrder(order: BscOrder): Promise<void> {
    await this.hop(`order=${encodeURIComponent(JSON.stringify(order))}`, "Order added");
  }

  /** Drop the worker's fault rules now, and the call gate when a rule could have opened it. */
  async clear(): Promise<void> {
    if (!this.rulesSet && !this.gateAtRisk) return;
    const what = this.gateAtRisk ? "all" : "faults";
    await this.hop(`clear=${what}`, "Cleared");
    this.rulesSet = false;
    this.gateAtRisk = false;
  }

  /** The fixture's teardown: `clear()`, and it throws if the fake or the gate could not be cleared. */
  async teardown(): Promise<void> {
    await this.clear();
  }

  private async hop(query: string, expected: string): Promise<void> {
    const control: Page = await this.context.newPage();
    try {
      await control.goto(`/testing/bsc-fake?${query}`, { waitUntil: "domcontentloaded" });
      const done = control.getByText(DONE);
      const failed = control.getByText(FAILED);
      await expect(done.or(failed).first()).toBeVisible({ timeout: this.arrivalMs });
      if (await failed.isVisible()) {
        throw new Error(`The fake BuySportsCards control refused (${expected}): ${(await failed.innerText()).replace(STATUS, "")}`);
      }
      await expect(control.getByText(new RegExp(`^\\[testing-bsc-fake\\] ${expected}`))).toBeVisible();
    } finally {
      await control.close();
    }
  }
}
