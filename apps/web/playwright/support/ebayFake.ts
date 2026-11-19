/**
 * NEO-555: how a spec sets up the worker's stand-in eBay seller, hands it an
 * order, runs its sales poll, or makes eBay refuse. Every test deployment's eBay
 * is the fake (services/fake-bsc, CONTRACT.md "Fake eBay"), one seller per test
 * user (and a second, `alt`, for "Agree as another eBay account"), so nothing a
 * spec does here reaches a real marketplace or another shard. This is the one
 * place that asks.
 *
 *   test("...", { tag: ["@profile"] }, async ({ page, signIn, ebayFake }) => {
 *     await signIn("/profile/ebay");
 *     await ebayFake.holdShippingPolicy(EBAY_POLICY.free);
 *     await ebayFake.setFaults([ebayFault.error(EBAY_PATH.publish, 400, [25007], { times: 1 })]);
 *   });
 *
 * HOW. A spec cannot call a Convex action, so the helpers open the signed-in
 * worker's second page on `/testing/ebay-fake?...` (the NEO-555 hop, which calls
 * `api.testing.setMyEbaySeller` / `addMyEbayOrder` / `pollMySalesNow` as that
 * worker), read its status line and close it. The spec's own page is never
 * moved. Faults go through the BuySportsCards hop, because the fake keeps ONE
 * rule list per worker for both sites (./bscFake.ts header): `setFaults` here
 * replaces the eBay rules and keeps any BuySportsCards ones.
 *
 * TEARDOWN. The fault rules go with the `bscFake` fixture's teardown (it owns
 * the list). Seller state does NOT: the fake keeps a seller's shipping policies,
 * opt-in, payment and returns policies, location, listings and orders in memory
 * for the namespace until the scripted reset (a pass's seed) or a fake restart.
 * So a seller a spec sets up is the one the next spec on the worker finds:
 *   - `holdShippingPolicy` treats "already holds that name" as done (the fake
 *     answers a held name with 409), so the specs that need policies on the
 *     main seller converge on the same fixed set (`EBAY_POLICY`), whichever
 *     runs first;
 *   - a spec that needs a seller with NOTHING (the no-shipping-policy state)
 *     uses the `alt` seller, which no other spec sets up, and is fresh-only.
 *
 * ORDERS stay on the fake seller too (no per-order delete). An order a spec
 * injects names cards that spec listed, so it must be their sole writer.
 *
 * Contract helpers only: nothing here asserts product behaviour.
 */
import type { BrowserContext, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import type { BscFake, FakeFaultRule } from "./bscFake";

/** The eBay path templates the fake's rules match on (services/fake-bsc/src/ebay/paths.ts). */
export const EBAY_PATH = {
  /** The listing write of the cards' details (titles, photos, facts): POST, bulk. */
  bulkItems: "ebay/api/sell/inventory/v1/bulk_create_or_replace_inventory_item",
  /** Going live, one offer at a time: POST. */
  publish: "ebay/api/sell/inventory/v1/offer/:offerId/publish",
  /** Every seller call under the Sell APIs (a prefix rule). */
  sell: "ebay/api/sell/*",
} as const;

type Method = FakeFaultRule["match"]["method"];

/** The method eBay uses on each fixed template; a rule on a prefix must name its own (the fake has no "any"). */
const METHOD_OF: Readonly<Record<string, Method>> = {
  [EBAY_PATH.bulkItems]: "POST",
  [EBAY_PATH.publish]: "POST",
};

interface RuleOptions {
  method?: Method;
  times?: number;
  ttlS?: number;
}

function ruleOf(kind: "ebayError" | "unauthorized", pathTemplate: string, o: RuleOptions, extra: Pick<FakeFaultRule, "status" | "errorIds"> = {}): FakeFaultRule {
  const method = o.method ?? METHOD_OF[pathTemplate];
  if (method === undefined) throw new Error(`Name the HTTP method for a fault on ${pathTemplate}: it is not one of EBAY_PATH's fixed templates.`);
  return {
    match: { method, pathTemplate },
    kind,
    ...extra,
    ...(o.times !== undefined ? { times: o.times } : {}),
    ...(o.ttlS !== undefined ? { ttlS: o.ttlS } : {}),
  };
}

/** Builders for the eBay rules specs ask for; each reads as the behaviour it makes. No eBay rule touches the BSC call gate. */
export const ebayFault = {
  /** Answer `status` with eBay's error body carrying `errorIds` (on a bulk path, one refused entry per request entry). */
  error: (pathTemplate: string, status: number, errorIds: readonly number[], o: RuleOptions = {}): FakeFaultRule =>
    ruleOf("ebayError", pathTemplate, o, { status, errorIds: [...errorIds] }),
  /** Answer 401 with eBay's OAuth body, so NB refreshes its token and tries once more. Use `times`. */
  unauthorized: (pathTemplate: string, o: RuleOptions = {}): FakeFaultRule => ruleOf("unauthorized", pathTemplate, o),
};

/** One shipping service of a seeded fulfillment policy (eBay's own codes). */
export interface EbayShippingService {
  code: string;
  carrier?: string;
  costCents?: number;
  freeShipping?: boolean;
}

/** A shipping (fulfillment) policy a real seller would already hold; NB never makes one (NEO-423). */
export interface EbayShippingPolicy {
  name: string;
  costType?: "FLAT_RATE" | "CALCULATED";
  services: EbayShippingService[];
}

/**
 * The fixed shipping policies the specs seed on the main seller (the names the
 * eBay sandbox seller held before NEO-555). Fixed, not minted: the fake keeps
 * them for the namespace, and a held name is the same policy for every spec.
 *   - free: flat, free Standard Envelope (offered for cards under $20 only:
 *     Standard Envelope covers nothing at $20 and up) plus free Ground Advantage,
 *     so it is offered in both slots;
 *   - tracked: calculated USPS Ground Advantage, offered in both slots.
 */
export const EBAY_POLICY = {
  free: {
    name: "NB Free Shipping",
    costType: "FLAT_RATE",
    services: [
      { code: "US_eBayStandardEnvelope", freeShipping: true, costCents: 0 },
      { code: "USPSGroundAdvantage", carrier: "USPS", freeShipping: true, costCents: 0 },
    ],
  },
  tracked: {
    name: "NB Tracked (USPS Ground Advantage)",
    costType: "CALCULATED",
    services: [{ code: "USPSGroundAdvantage", carrier: "USPS" }],
  },
} as const satisfies Record<string, EbayShippingPolicy>;

/** Which of the worker's two fake eBay sellers: the one Connect's "Agree" makes, or "Agree as another eBay account"'s. */
export type EbaySeller = "main" | "alt";

/**
 * One line of an eBay order. Either a sale NB did not list (`title`, no SKU:
 * NB shows it under eBay's title and touches no box), or (NEO-555)
 * `listedCardNumber`, a card THIS
 * worker listed on eBay named by its printed number as the checklist shows it
 * ("FS-1"). An NB SKU embeds NB's own card id, which no screen shows, so a spec
 * cannot name a sold listing any other way. The control is to resolve the
 * number against the caller's own eBay links, exactly one (card numbers are not
 * unique, CLAUDE.md invariant 7), fill the line's SKU and listing id, and
 * refuse otherwise.
 */
export type EbayOrderLine =
  | { title: string; quantity: number; priceCents?: number }
  | { listedCardNumber: string; quantity: number; priceCents?: number };

/** An order a buyer places on eBay (`api.testing.addMyEbayOrder`). Paid and not yet shipped by default. */
export interface EbayOrder {
  orderId?: string;
  /**
   * `FULFILLED`: already shipped, so it is a sale (the box goes down) that
   * never sits on the Pick List. Specs on the worker's main account use it: an
   * order left to ship stays on that account's Pick List for every later spec.
   */
  fulfillmentStatus?: "NOT_STARTED" | "IN_PROGRESS" | "FULFILLED";
  lines: EbayOrderLine[];
}

const STATUS = /^\[testing-ebay-fake\] /;
const DONE = /^\[testing-ebay-fake\] (Seller set|Order added|Polled)/;
const FAILED = /^\[testing-ebay-fake\] (Error:|Give exactly|\?(seller|order|poll)=|Testing mode)/;
/**
 * The fake's answer to a shipping policy name the seller already holds
 * (`setMyEbaySeller`, `requireFakeEbayDone`). Not anchored at the end: the
 * Convex client appends the server's stack ("at requireFakeEbayDone ...
 * Called by client") to the message the hop shows.
 */
const ALREADY_HELD = /Fake eBay did not set the seller up: http \(409\)(\s|$)/;

/**
 * The control a spec drives through the `ebayFake` fixture. One per test, bound
 * to the signed-in worker's browser context.
 */
export class EbayFake {
  constructor(
    private readonly context: BrowserContext,
    /** The worker's fault list, which this shares with BuySportsCards (the `bscFake` fixture). */
    private readonly faults: BscFake,
    /** The first arrival on a new page pays the app's cold load and Clerk handshake (the suite's LAUNCH_GATE). */
    private readonly arrivalMs: number,
  ) {}

  /**
   * The seller holds `policy` (a shipping policy with that name), seeded now or
   * already there from an earlier spec on the worker. Seeding opts the seller
   * into business policies, as a seller who has made one is.
   *
   * Contract: ENTRY the worker is signed in. EXIT the fake seller holds a policy named `policy.name`.
   */
  async holdShippingPolicy(policy: EbayShippingPolicy, seller: EbaySeller = "main"): Promise<void> {
    const body = { ...(seller === "alt" ? { seller } : {}), fulfillmentPolicies: [policy] };
    await this.hop(`seller=${encodeURIComponent(JSON.stringify(body))}`, "Seller set", ALREADY_HELD);
  }

  /** Add one order to the seller's history. Not undone at teardown (see the header). */
  async addOrder(order: EbayOrder, seller: EbaySeller = "main"): Promise<void> {
    const body = { ...order, ...(seller === "alt" ? { seller } : {}) };
    await this.hop(`order=${encodeURIComponent(JSON.stringify(body))}`, "Order added");
  }

  /**
   * Run the worker's eBay sales poll now and wait for it (`api.testing.pollMySalesNow`).
   * Passes whether it or the cron's poll stores the order: assert the screen after it, never the count.
   */
  async pollNow(): Promise<void> {
    await this.hop("poll=1", "Polled");
  }

  /** Replace the worker's eBay fault rules (any BuySportsCards rules stay); `[]` drops them. */
  async setFaults(rules: readonly FakeFaultRule[]): Promise<void> {
    await this.faults.setSiteFaults("ebay", rules);
  }

  private async hop(query: string, expected: string, alsoDone?: RegExp): Promise<void> {
    const control: Page = await this.context.newPage();
    try {
      await control.goto(`/testing/ebay-fake?${query}`, { waitUntil: "domcontentloaded" });
      // The hop's one status line (role=status, inside <main>).
      const line = control.getByRole("status");
      const done = line.filter({ hasText: DONE });
      const failed = line.filter({ hasText: FAILED });
      await expect(done.or(failed).first()).toBeVisible({ timeout: this.arrivalMs });
      if (await failed.isVisible()) {
        const said = (await failed.innerText()).replace(STATUS, "");
        if (alsoDone?.test(said)) return;
        throw new Error(`The fake eBay control refused (${expected}): ${said}`);
      }
      await expect(line.filter({ hasText: new RegExp(`^\\[testing-ebay-fake\\] ${expected}`) })).toBeVisible();
    } finally {
      await control.close();
    }
  }
}
