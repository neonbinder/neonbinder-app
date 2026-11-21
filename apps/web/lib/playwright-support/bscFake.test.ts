/**
 * NEO-552 — `playwright/support/bscFake.ts`, the helper every fake-BSC fault in
 * a spec goes through. Its teardown is what keeps a fault, and the call gate a
 * fault opened, from leaking into the next spec on the worker. That cannot be
 * seen from a green E2E run, so it is pinned here.
 *
 * NEO-628: the BSC call gate is per test user against the fake, so a fault
 * that opens it stops only the worker that posted it. There is no breaker tag
 * any more: a 429, 503, hang or reset rule posts from any spec.
 *
 * Lives under lib/ (collected as a node test) rather than playwright/, which
 * the unit-test verifier excludes by design. Nothing here opens a browser:
 * the page-driving `hop` is replaced by a recorder.
 */
import { describe, expect, test, vi } from "vitest";
import { BSC_PATH, BscFake, bscFault, type BscFaultRule } from "../../playwright/support/bscFake";

type Hop = { query: string; expected: string };

/** A BscFake whose hop records what it was asked and opens nothing. */
function fake() {
  const newPage = vi.fn();
  const f = new BscFake({ newPage } as never, 1_000);
  const hops: Hop[] = [];
  vi.spyOn(f as unknown as { hop: (q: string, e: string) => Promise<void> }, "hop").mockImplementation(
    async (query, expected) => {
      hops.push({ query, expected });
    },
  );
  return { f, hops, newPage };
}

const slow = bscFault.slow(BSC_PATH.profile, 100);
const GATE_RULES: ReadonlyArray<[string, BscFaultRule]> = [
  ["429", bscFault.tooManyRequests(BSC_PATH.cardListing)],
  ["503", bscFault.unavailable(BSC_PATH.filters)],
  ["hang", bscFault.hangs(BSC_PATH.sellerSheet)],
  ["reset", bscFault.answersUnavailable(BSC_PATH.sellerWrite)],
];

describe("setFaults: any rule posts from any spec", () => {
  test.each(GATE_RULES)("a %s rule posts, exactly as given", async (_kind, rule) => {
    const { f, hops } = fake();
    await f.setFaults([rule]);
    expect(hops).toHaveLength(1);
    expect(hops[0].expected).toBe("Fault rules set");
    expect(decodeURIComponent(hops[0].query.replace(/^rules=/, ""))).toBe(JSON.stringify([rule]));
  });

  test("a gate-opening rule among safe ones posts them all together", async () => {
    const { f, hops } = fake();
    const rules = [slow, bscFault.tooManyRequests(BSC_PATH.cardListing)];
    await f.setFaults(rules);
    expect(hops).toHaveLength(1);
    expect(decodeURIComponent(hops[0].query.replace(/^rules=/, ""))).toBe(JSON.stringify(rules));
  });

  test("a delay posts too", async () => {
    const { f, hops } = fake();
    await f.setFaults([slow]);
    expect(hops).toHaveLength(1);
    expect(hops[0].expected).toBe("Fault rules set");
  });

  test("an eBay template is refused on the BuySportsCards side, and nothing is sent", async () => {
    const { f, hops, newPage } = fake();
    await expect(f.setFaults([bscFault.slow("ebay/sell/inventory", 1, { method: "GET" })])).rejects.toThrow(/is the other site's/);
    expect(hops).toEqual([]);
    expect(newPage).not.toHaveBeenCalled();
  });
});

describe("METHOD_OF: the verb each path template is matched with", () => {
  const methodOf = (path: string, o = {}) => bscFault.slow(path, 1, o).match.method;

  test.each([
    ["cardListing", "GET"],
    ["profile", "GET"],
    ["orderDetail", "GET"],
    ["filters", "POST"],
    ["results", "POST"],
    ["sellerSheet", "POST"],
    ["sellerWrite", "PUT"],
    ["orderHistory", "POST"],
  ] as const)("BSC_PATH.%s is %s", (key, method) => {
    expect(methodOf(BSC_PATH[key])).toBe(method);
  });

  test("every BSC_PATH template has a verb", () => {
    for (const path of Object.values(BSC_PATH)) expect(() => methodOf(path)).not.toThrow();
  });

  test("a template outside BSC_PATH must name its method, and an explicit method wins", () => {
    expect(() => methodOf("seller/other")).toThrow(/Name the HTTP method for a fault on seller\/other/);
    expect(methodOf("seller/other", { method: "DELETE" })).toBe("DELETE");
    expect(methodOf(BSC_PATH.profile, { method: "POST" })).toBe("POST");
  });

  test("a rule carries only the options it was given", () => {
    expect(bscFault.slow(BSC_PATH.cardListing, 250)).toEqual({
      match: { method: "GET", pathTemplate: BSC_PATH.cardListing },
      kind: "delay",
      delayMs: 250,
    });
    expect(bscFault.tooManyRequests(BSC_PATH.cardListing, { retryAfterS: 90, cardId: "7", times: 2, ttlS: 30 })).toEqual({
      match: { method: "GET", pathTemplate: BSC_PATH.cardListing, cardId: "7" },
      kind: "429",
      retryAfterS: 90,
      times: 2,
      ttlS: 30,
    });
  });
});

describe("teardown: what is cleared, and when", () => {
  test("a test that set no rule clears nothing", async () => {
    const { f, hops } = fake();
    await f.teardown();
    expect(hops).toEqual([]);
  });

  test("after a rule that cannot open the gate it clears the faults and leaves the gate alone", async () => {
    const { f, hops } = fake();
    await f.setFaults([slow]);
    await f.teardown();
    expect(hops.map((h) => h.query)).toEqual([expect.stringMatching(/^rules=/), "clear=faults"]);
    expect(hops[1].expected).toBe("Cleared");
  });

  test.each(GATE_RULES)("after a %s rule it clears the faults and the worker's gate (clear=all)", async (_kind, rule) => {
    const { f, hops } = fake();
    await f.setFaults([rule]);
    await f.teardown();
    expect(hops.at(-1)?.query).toBe("clear=all");
  });

  test("a gate-opening rule set after a safe one still clears the gate", async () => {
    const { f, hops } = fake();
    await f.setFaults([slow]);
    await f.setFaults([bscFault.unavailable(BSC_PATH.filters)]);
    await f.teardown();
    expect(hops.at(-1)?.query).toBe("clear=all");
  });

  test("a gate-opening rule replaced by a safe one still clears the gate: the gate may already have opened", async () => {
    const { f, hops } = fake();
    await f.setFaults([bscFault.tooManyRequests(BSC_PATH.profile)]);
    await f.setFaults([slow]);
    await f.teardown();
    expect(hops.at(-1)?.query).toBe("clear=all");
  });

  test("a second teardown clears nothing more", async () => {
    const { f, hops } = fake();
    await f.setFaults([bscFault.hangs(BSC_PATH.profile)]);
    await f.teardown();
    const after = hops.length;
    await f.teardown();
    expect(hops).toHaveLength(after);
  });

  test("a clear that fails is not swallowed, and the next teardown tries again", async () => {
    const { f, hops } = fake();
    await f.setFaults([bscFault.hangs(BSC_PATH.profile)]);
    const hop = (f as unknown as { hop: ReturnType<typeof vi.fn> }).hop;
    hop.mockRejectedValueOnce(new Error("could not clear"));

    await expect(f.teardown()).rejects.toThrow("could not clear");
    await f.teardown();

    expect(hops.at(-1)?.query).toBe("clear=all");
  });

  test("addOrder is not undone by teardown", async () => {
    const { f, hops } = fake();
    await f.addOrder({ items: [{ cardId: "1", condition: "NM", quantity: 1 }] });
    await f.teardown();
    expect(hops.map((h) => h.expected)).toEqual(["Order added"]);
  });
});
