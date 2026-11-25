/**
 * NEO-552: how a spec makes the fake BuySportsCards misbehave, or hands its
 * seller an order. Previews, worktree deployments and dev call a fake BSC, never
 * the real site, so a slow answer, a 429 or a 503 happens only when a spec asks
 * for it. This is the one place that asks.
 *
 *   test("...", { tag: ["@set-selector"] }, async ({ page, signIn, bscFake }) => {
 *     await signIn("/set-selector");
 *     await bscFake.setFaults([bscFault.tooManyRequests(BSC_PATH.cardListing, { retryAfterS: 90 })]);
 *     // ... press Sync; the fake answers 429 until teardown clears the rules.
 *   });
 *
 * HOW. A spec cannot call a Convex action, so the helpers open the signed-in
 * worker's second page on `/testing/bsc-fake?...` (the NEO-552 hop, which calls
 * `api.testing.setMyBscFaults` / `addMyBscOrder` / `clearMyBscFaults` /
 * `clearBscCallGate` / `cancelMyBscTeamChecks` as that worker), read its status
 * line and close it. The
 * spec's own page is never moved. Every rule lands on the worker's OWN fake
 * account (a namespace per test user), so a fault never reaches another shard.
 *
 * TEARDOWN IS AUTOMATIC. `bscFake` is a fixture (support/fixtures.ts): when the
 * test ends, red or green, it drops the fault rules the test set and, if any
 * rule could have opened the BSC call gate, clears that too. A rule's own TTL
 * is not a teardown: the next spec on the worker would meet what is left of it.
 * A teardown that cannot clear fails the test, by name.
 *
 * THE CALL GATE IS THIS WORKER'S OWN (NEO-628). Against the fake, Convex keeps
 * one BSC call gate per test user, keyed on the user's fake namespace
 * (`convex/bscCallGate.ts`; against the real BSC it stays one per deployment).
 * A 429 opens it at once, and five consecutive 5xx or timeouts open it too (no
 * fault drops the connection: a `reset` answers 503 at once, and a `hang` the
 * caller outwaits ends in a 503 at its 2-minute cap); while it is open the
 * worker's own BSC calls are refused, and no other shard's. So any rule, a
 * `429`, `503`, `hang` or `reset` included, may be posted from any spec, which
 * runs in the ordinary shards and retries like any other. The fault only has to
 * be the spec's own subject: a rule that opens the gate stops every later BSC
 * call this test makes, so a spec that needs BSC after the fault clears it
 * first (`clear()`). A `delay` shorter than the caller's own timeout (a
 * card-listing call gives up at 5 s, the seller profile read at 20 s, the
 * seller sheet at 90 s) is an answer; one that outlasts it counts as a failure
 * to the gate, like a `hang`.
 *
 * ORDERS are not cleared by teardown: the fake has no per-order delete, only a
 * whole-account reset, which would wipe the worker's listings too. An order
 * stays on the worker's fake account until the next reset, so a spec that
 * injects one must be the only user of the cards it names. `pollNow()` (NEO-555)
 * runs the worker's BuySportsCards sales poll at once and waits for it, so a
 * spec need not wait out the 15-minute cron; when the cron's poll lands first
 * the order is already stored and the poll reads nothing new, and the hop says
 * "Polled" either way (assert the screen, not the count).
 *
 * ONE FAULT LIST PER NAMESPACE (NEO-555). The fake keeps one list of rules per
 * worker for BOTH marketplaces it stands in for, and every `?rules=` visit
 * REPLACES that list. So this class holds the worker's rules for each site and
 * always posts the two merged: `setFaults` replaces the BuySportsCards rules and
 * keeps the eBay ones, and the `ebayFake` fixture (./ebayFake.ts) replaces the
 * eBay rules through `setSiteFaults("ebay", …)` and keeps the BuySportsCards ones.
 * A spec that sets eBay faults never clears its own BuySportsCards faults, and
 * the other way round. Teardown drops both.
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

/**
 * One fault rule on the worker's list, either site's, as `api.testing.setMyBscFaults`
 * takes it (services/fake-bsc/CONTRACT.md, "Faults"). The eBay kinds and their
 * `status` / `errorIds` are built by ./ebayFake.ts (`ebayFault`).
 */
export interface FakeFaultRule {
  match: { method: BscMethod; pathTemplate: string; cardId?: string };
  kind: BscFaultKind | "ebayError" | "unauthorized";
  delayMs?: number;
  retryAfterS?: number;
  times?: number;
  ttlS?: number;
  /** `ebayError` only: the HTTP status answered (400 to 599). */
  status?: number;
  /** `ebayError` only: eBay's error ids in the body (1 to 10). */
  errorIds?: number[];
}

/** The site a rule is about: eBay rules match `ebay/…` templates, every other template is BuySportsCards. */
export type FakeSite = "bsc" | "ebay";
const siteOf = (rule: FakeFaultRule): FakeSite => (rule.match.pathTemplate.startsWith("ebay/") ? "ebay" : "bsc");
/** The fake's cap on one namespace's list (`MAX_FAKE_BSC_FAULT_RULES`, convex/testing.ts). */
const MAX_RULES = 20;

/** One BuySportsCards fault rule, as `api.testing.setMyBscFaults` takes it (services/fake-bsc/CONTRACT.md, "Faults"). */
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

/** The kinds that can open the worker's BSC call gate, so teardown clears the gate too. */
const GATE_KINDS: ReadonlySet<BscFaultKind> = new Set(["429", "503", "hang", "reset"]);

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
  /** Answer 429 (with `Retry-After` when given). Opens the worker's call gate at once. */
  tooManyRequests: (pathTemplate: string, o: RuleOptions & { retryAfterS?: number } = {}): BscFaultRule =>
    ruleOf("429", pathTemplate, o, o.retryAfterS !== undefined ? { retryAfterS: o.retryAfterS } : {}),
  /** Answer 503. Five in a row open the worker's call gate. */
  unavailable: (pathTemplate: string, o: RuleOptions & { retryAfterS?: number } = {}): BscFaultRule =>
    ruleOf("503", pathTemplate, o, o.retryAfterS !== undefined ? { retryAfterS: o.retryAfterS } : {}),
  /** Hold the answer for `delayMs`, then answer normally. Keep it under the caller's own timeout. */
  slow: (pathTemplate: string, delayMs: number, o: RuleOptions = {}): BscFaultRule => ruleOf("delay", pathTemplate, o, { delayMs }),
  /** Hold the answer: the caller's own timeout ends the call (the fake answers 503 at its 2-minute cap). Counts as a failure to the worker's gate. */
  hangs: (pathTemplate: string, o: RuleOptions = {}): BscFaultRule => ruleOf("hang", pathTemplate, o),
  /** Answer 503 at once, with no `Retry-After` (the fake's `reset` kind; it never drops the socket). Counts as a failure to the worker's gate. */
  answersUnavailable: (pathTemplate: string, o: RuleOptions = {}): BscFaultRule => ruleOf("reset", pathTemplate, o),
};

/**
 * One item of an order. Either the BuySportsCards ids themselves, or (NEO-555)
 * `listedCardNumber`: a card
 * THIS worker listed on BuySportsCards, named by its printed number as the
 * checklist shows it ("FS-1"). A spec never sees a BuySportsCards card id or an
 * NB SKU (neither is on any screen), so it cannot name a sold card any other
 * way. The control is to resolve the number against the caller's own live
 * BuySportsCards links, exactly one (card numbers are not unique, CLAUDE.md
 * invariant 7), and refuse otherwise.
 */
export type BscOrderItem =
  | { cardId: string; condition: string; quantity: number; priceCents?: number; sellerSku?: string }
  | { listedCardNumber: string; quantity: number; priceCents?: number };

/** An order a buyer places, in NB's terms (`api.testing.addMyBscOrder`). */
export interface BscOrder {
  orderNo?: string;
  /** Default `READY_TO_SHIP`. */
  status?: string;
  orderDateMs?: number;
  items: BscOrderItem[];
}

const STATUS = /^\[testing-bsc-fake\] /;
export const DONE = /^\[testing-bsc-fake\] (Fault rules set|Order added|Cleared|Polled)/;
export const FAILED = /^\[testing-bsc-fake\] (Error:|Give exactly|\?(rules|order|clear|poll)=|Testing mode)/;

/**
 * The control a spec drives through the `bscFake` fixture. One per test, bound
 * to the signed-in worker's browser context.
 */
export class BscFake {
  private rulesSet = false;
  private gateAtRisk = false;
  /** The worker's rules per site, as last posted (the fake holds them merged). */
  private readonly rules: Record<FakeSite, readonly FakeFaultRule[]> = { bsc: [], ebay: [] };

  constructor(
    private readonly context: BrowserContext,
    /** The first arrival on a new page pays the app's cold load and Clerk handshake (the suite's LAUNCH_GATE). */
    private readonly arrivalMs: number,
  ) {}

  /**
   * Replace the worker's fault rules with `rules` (1 to 20). The rules stay until
   * `clear()`, the test's end or their own TTL. A rule that can open the
   * worker's call gate marks the gate for clearing at teardown.
   *
   * Contract: ENTRY the worker is signed in (the spec has passed its `signIn` gate). EXIT the fake holds
   * the rules.
   */
  async setFaults(rules: readonly BscFaultRule[]): Promise<void> {
    await this.setSiteFaults("bsc", rules);
  }

  /**
   * Replace ONE site's rules and keep the other's: the fake's list is posted
   * merged (the header). An empty `rules` drops that site's rules only. The
   * eBay side is reached through the `ebayFake` fixture; a spec calls
   * `setFaults` for BuySportsCards.
   *
   * Contract: ENTRY the worker is signed in. EXIT the fake holds exactly the
   * merged rules (or none, when both sites are empty).
   */
  async setSiteFaults(site: FakeSite, rules: readonly FakeFaultRule[]): Promise<void> {
    const strays = rules.filter((r) => siteOf(r) !== site);
    if (strays.length > 0) {
      throw new Error(
        `A ${site === "ebay" ? "fake eBay" : "fake BuySportsCards"} fault must match ${site === "ebay" ? "an ebay/ template" : "a BuySportsCards template (not ebay/)"}: ` +
          `${strays[0].match.pathTemplate} is the other site's.`,
      );
    }
    const risky = rules.filter((r) => GATE_KINDS.has(r.kind as BscFaultKind));
    const merged = [...(site === "bsc" ? rules : this.rules.bsc), ...(site === "ebay" ? rules : this.rules.ebay)];
    if (merged.length > MAX_RULES) {
      throw new Error(`The fake holds at most ${MAX_RULES} fault rules per worker, both sites together; this would post ${merged.length}.`);
    }
    if (site === "bsc" && risky.length > 0) this.gateAtRisk = true;
    if (merged.length === 0) {
      // Nothing left on either site: the fake refuses an empty list, so drop it.
      if (this.rulesSet) await this.hop("clear=faults", "Cleared");
      this.rulesSet = false;
    } else {
      this.rulesSet = true;
      await this.hop(`rules=${encodeURIComponent(JSON.stringify(merged))}`, "Fault rules set");
    }
    this.rules[site] = [...rules];
  }

  /** Add one order to the worker's fake seller history. Not cleared at teardown (see the header). */
  async addOrder(order: BscOrder): Promise<void> {
    await this.hop(`order=${encodeURIComponent(JSON.stringify(order))}`, "Order added");
  }

  /**
   * Run the worker's BuySportsCards sales poll now and wait for it (`api.testing.pollMySalesNow`).
   * Passes whether it or the cron's poll stores the order: assert the screen after it, never the count.
   */
  async pollNow(): Promise<void> {
    await this.hop("poll=1", "Polled");
  }

  /**
   * Drop the worker's fault rules now (both sites), and the worker's own call
   * gate when a rule could have opened it (`clear=all` clears this test user's
   * gate only, never another worker's).
   */
  async clear(): Promise<void> {
    if (!this.rulesSet && !this.gateAtRisk) return;
    const what = this.gateAtRisk ? "all" : "faults";
    await this.hop(`clear=${what}`, "Cleared");
    this.rulesSet = false;
    this.gateAtRisk = false;
    this.rules.bsc = [];
    this.rules.ebay = [];
  }

  /**
   * NEO-644: cancel the background BSC team lookups this worker's test user
   * queued (`clear=lane`, `api.testing.cancelMyBscTeamChecks`), and no other
   * worker's. The lane is one slot per deployment, so a spec that leaves cards
   * waiting on it (the 429 and stall specs) holds every other shard's per-card
   * lookups behind them. Not part of the fixture's teardown: a spec that
   * queues cards calls it from its own `test.afterEach`. A lookup already
   * running finishes.
   *
   * Contract: ENTRY the worker is signed in. EXIT none of this user's lane
   * items that had not started is left to run; returns N, how many it
   * cancelled, read off the hop's "Cleared: lane, N queued team lookups." line
   * (a spec that queued cards asserts N >= 1, so a teardown that stopped
   * finding them goes red).
   */
  async clearTeamLane(): Promise<number> {
    const line = await this.hop("clear=lane", "Cleared: lane, \\d+ queued team lookups\\.");
    const n = /Cleared: lane, (\d+) queued team lookups\./.exec(line)?.[1];
    if (n === undefined) throw new Error(`The fake BuySportsCards lane clear printed no count: ${line}`);
    return Number(n);
  }

  /** The fixture's teardown: `clear()`, and it throws if the fake or the gate could not be cleared. */
  async teardown(): Promise<void> {
    await this.clear();
  }

  /** Opens the hop, waits for its line to read `expected` (a regex source) and returns that line's text. */
  private async hop(query: string, expected: string): Promise<string> {
    const control: Page = await this.context.newPage();
    try {
      await control.goto(`/testing/bsc-fake?${query}`, { waitUntil: "domcontentloaded" });
      // The hop's one status line (role=status, inside <main>).
      const line = control.getByRole("status");
      const done = line.filter({ hasText: DONE });
      const failed = line.filter({ hasText: FAILED });
      await expect(done.or(failed).first()).toBeVisible({ timeout: this.arrivalMs });
      if (await failed.isVisible()) {
        throw new Error(`The fake BuySportsCards control refused (${expected}): ${(await failed.innerText()).replace(STATUS, "")}`);
      }
      const settled = line.filter({ hasText: new RegExp(`^\\[testing-bsc-fake\\] ${expected}`) });
      await expect(settled).toBeVisible();
      return (await settled.innerText()).replace(STATUS, "");
    } finally {
      await control.close();
    }
  }
}
