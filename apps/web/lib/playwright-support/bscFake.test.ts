/**
 * NEO-552 — `playwright/support/bscFake.ts`, the helper every fake-BSC fault in
 * a spec goes through. Its guard is what keeps one spec's 429 from stopping
 * every other shard's BuySportsCards calls, and its teardown is what keeps a
 * fault from leaking into the next spec on the worker. Neither can be seen
 * from a green E2E run, so both are pinned here.
 *
 * Lives under lib/ (collected as a node test) rather than playwright/, which
 * the unit-test verifier excludes by design. Nothing here opens a browser:
 * the page-driving `hop` is replaced by a recorder.
 */
import { describe, expect, test, vi } from "vitest";
import { BSC_PATH, BscFake, bscFault, type BscFaultRule } from "../../playwright/support/bscFake";

type Hop = { query: string; expected: string };

/** A BscFake whose hop records what it was asked and opens nothing. */
function fake(tags: readonly string[]) {
  const newPage = vi.fn();
  const f = new BscFake({ newPage } as never, tags, 1_000);
  const hops: Hop[] = [];
  vi.spyOn(f as unknown as { hop: (q: string, e: string) => Promise<void> }, "hop").mockImplementation(
    async (query, expected) => {
      hops.push({ query, expected });
    },
  );
  return { f, hops, newPage };
}

const slow = bscFault.slow(BSC_PATH.profile, 100);
const BREAKER_RULES: ReadonlyArray<[string, BscFaultRule]> = [
  ["429", bscFault.tooManyRequests(BSC_PATH.cardListing)],
  ["503", bscFault.unavailable(BSC_PATH.filters)],
  ["hang", bscFault.hangs(BSC_PATH.sellerSheet)],
  ["reset", bscFault.dropsConnection(BSC_PATH.sellerWrite)],
];

describe("setFaults: the @bsc-breaker guard", () => {
  test.each(BREAKER_RULES)("a %s rule without the tag throws, naming the tag, and sends nothing", async (_kind, rule) => {
    const { f, hops, newPage } = fake(["@set-selector"]);

    await expect(f.setFaults([rule])).rejects.toThrow(/Tag this spec "@bsc-breaker"/);

    expect(hops).toEqual([]);
    expect(newPage).not.toHaveBeenCalled();
  });

  test("one risky rule among safe ones still throws, and none of them are sent", async () => {
    const { f, hops } = fake([]);
    await expect(f.setFaults([slow, bscFault.tooManyRequests(BSC_PATH.cardListing)])).rejects.toThrow(/429 fault on marketplace\/card\/:id\/card-listing/);
    expect(hops).toEqual([]);
  });

  test("a refused set leaves nothing to tear down", async () => {
    const { f, hops } = fake([]);
    await f.setFaults([bscFault.hangs(BSC_PATH.profile)]).catch(() => {});
    await f.teardown();
    expect(hops).toEqual([]);
  });

  test.each(BREAKER_RULES)("a %s rule is sent in a spec tagged @bsc-breaker", async (_kind, rule) => {
    const { f, hops } = fake(["@set-selector", "@bsc-breaker"]);
    await f.setFaults([rule]);
    expect(hops).toHaveLength(1);
    expect(hops[0].expected).toBe("Fault rules set");
    expect(decodeURIComponent(hops[0].query.replace(/^rules=/, ""))).toBe(JSON.stringify([rule]));
  });

  test("a delay is sent without the tag", async () => {
    const { f, hops } = fake([]);
    await f.setFaults([slow]);
    expect(hops).toHaveLength(1);
    expect(hops[0].expected).toBe("Fault rules set");
  });

  test("a tag that only looks like the breaker tag does not unlock it", async () => {
    const { f } = fake(["@bsc-breaker-ish", "bsc-breaker"]);
    await expect(f.setFaults([bscFault.tooManyRequests(BSC_PATH.profile)])).rejects.toThrow(/@bsc-breaker/);
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
    const { f, hops } = fake(["@bsc-breaker"]);
    await f.teardown();
    expect(hops).toEqual([]);
  });

  test("after a non-breaker rule it clears the faults and leaves the gate alone", async () => {
    const { f, hops } = fake([]);
    await f.setFaults([slow]);
    await f.teardown();
    expect(hops.map((h) => h.query)).toEqual([expect.stringMatching(/^rules=/), "clear=faults"]);
    expect(hops[1].expected).toBe("Cleared");
  });

  test.each(BREAKER_RULES)("after a %s rule it clears the faults and the gate", async (_kind, rule) => {
    const { f, hops } = fake(["@bsc-breaker"]);
    await f.setFaults([rule]);
    await f.teardown();
    expect(hops.at(-1)?.query).toBe("clear=all");
  });

  test("a breaker rule set after a safe one still clears the gate", async () => {
    const { f, hops } = fake(["@bsc-breaker"]);
    await f.setFaults([slow]);
    await f.setFaults([bscFault.unavailable(BSC_PATH.filters)]);
    await f.teardown();
    expect(hops.at(-1)?.query).toBe("clear=all");
  });

  test("a breaker rule replaced by a safe one still clears the gate: the gate may already have opened", async () => {
    const { f, hops } = fake(["@bsc-breaker"]);
    await f.setFaults([bscFault.tooManyRequests(BSC_PATH.profile)]);
    await f.setFaults([slow]);
    await f.teardown();
    expect(hops.at(-1)?.query).toBe("clear=all");
  });

  test("a second teardown clears nothing more", async () => {
    const { f, hops } = fake(["@bsc-breaker"]);
    await f.setFaults([bscFault.hangs(BSC_PATH.profile)]);
    await f.teardown();
    const after = hops.length;
    await f.teardown();
    expect(hops).toHaveLength(after);
  });

  test("a clear that fails is not swallowed, and the next teardown tries again", async () => {
    const { f, hops } = fake(["@bsc-breaker"]);
    await f.setFaults([bscFault.hangs(BSC_PATH.profile)]);
    const hop = (f as unknown as { hop: ReturnType<typeof vi.fn> }).hop;
    hop.mockRejectedValueOnce(new Error("could not clear"));

    await expect(f.teardown()).rejects.toThrow("could not clear");
    await f.teardown();

    expect(hops.at(-1)?.query).toBe("clear=all");
  });

  test("addOrder is not undone by teardown", async () => {
    const { f, hops } = fake([]);
    await f.addOrder({ items: [{ cardId: "1", condition: "NM", quantity: 1 }] });
    await f.teardown();
    expect(hops.map((h) => h.expected)).toEqual(["Order added"]);
  });
});
