/**
 * NEO-555 — the fake eBay's controls in `fakeBsc.ts`: `ebayConsent`,
 * `ebaySeller`, `ebayOrders` and `ebayTarget`, and the fault rules the fake
 * takes for eBay paths (`ebayError`, `unauthorized`, a trailing `/*`). Each
 * acts only on this deployment's own namespaces and only when the deployment
 * is on the fake eBay; beside a sandbox, production or real-BSC deployment it
 * sends nothing. `fetch` is stubbed; nothing leaves the process.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { ebayOrderRefusal, fulfillmentPoliciesRefusal } from "./fakeBsc";

vi.mock("./lib/bscFakeIdToken", () => ({
  nodeBscIdToken: async () => "stub-id-token",
  idTokenExpiresAt: (_token: string, fallback: number) => fallback,
}));

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const FAKE_ORIGIN = "https://neonbinder-fake-bsc-0000-uc.a.run.app";
const NS = "happy-otter-123-0123456789ab";
const OTHER_NS = "sad-badger-456-0123456789ab";

function armFake(over: Record<string, string> = {}) {
  const env: Record<string, string> = {
    NEONBINDER_BSC_API_BASE: FAKE_ORIGIN,
    NEONBINDER_FAKE_BSC_KEY: "caller-key",
    TESTING_RESET_SECRET: "armed",
    CONVEX_CLOUD_URL: "https://happy-otter-123.convex.cloud",
    EBAY_ENVIRONMENT: "fake",
    EBAY_CLIENT_ID: "",
    EBAY_RU_NAME: "",
    ...over,
  };
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
}

type Spy = ReturnType<typeof stubFetch>;
function stubFetch(answer: () => Response | Promise<Response>) {
  const spy = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => answer());
  vi.stubGlobal("fetch", spy);
  return spy;
}
const bodyOf = (spy: Spy, i = 0) => JSON.parse(String(spy.mock.calls[i][1]?.body)) as Record<string, unknown>;
const urlOf = (spy: Spy, i = 0) => String(spy.mock.calls[i][0]);
const headersOf = (spy: Spy, i = 0) => new Headers(spy.mock.calls[i][1]?.headers);

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const t = () => convexTest(schema, modules);

describe("ebayTarget", () => {
  test("a wired deployment says fake, and sends nothing", async () => {
    armFake();
    const spy = stubFetch(() => Response.json({}));
    expect(await t().action(internal.fakeBsc.ebayTarget, {})).toEqual({ mode: "fake" });
    expect(spy).not.toHaveBeenCalled();
  });

  test.each([
    ["sandbox", { EBAY_ENVIRONMENT: "sandbox", EBAY_CLIENT_ID: "c", EBAY_RU_NAME: "r" }, "sandbox"],
    ["production", { EBAY_ENVIRONMENT: "production", EBAY_CLIENT_ID: "c", EBAY_RU_NAME: "r" }, "production"],
    ["nothing set", { EBAY_ENVIRONMENT: "" }, "unconfigured"],
    ["fake asked for beside no testing flag (never another eBay)", { TESTING_RESET_SECRET: "", EBAY_CLIENT_ID: "c", EBAY_RU_NAME: "r" }, "unconfigured"],
    ["fake asked for on the real BSC", { NEONBINDER_BSC_API_BASE: "" }, "unconfigured"],
  ])("%s", async (_name, over, mode) => {
    armFake(over);
    expect(await t().action(internal.fakeBsc.ebayTarget, {})).toEqual({ mode });
  });
});

describe("ebayConsent", () => {
  test("posts the namespace to /__fake/ebay/consent with the caller key and the ID token, and returns the code", async () => {
    armFake();
    const spy = stubFetch(() => Response.json({ code: "v^1.1#fake#abc", expiresIn: 300 }));
    expect(await t().action(internal.fakeBsc.ebayConsent, { ns: NS })).toEqual({ code: "v^1.1#fake#abc" });
    expect(urlOf(spy)).toBe(`${FAKE_ORIGIN}/__fake/ebay/consent`);
    expect(spy.mock.calls[0][1]?.method).toBe("POST");
    expect(spy.mock.calls[0][1]?.redirect).toBe("error");
    expect(bodyOf(spy)).toEqual({ ns: NS });
    expect(headersOf(spy).get("x-nb-fake-bsc-key")).toBe("caller-key");
    expect(headersOf(spy).get("x-nb-fake-id-token")).toBe("stub-id-token");
  });

  test("the second eBay account for the same user is asked for by seller", async () => {
    armFake();
    const spy = stubFetch(() => Response.json({ code: "c2" }));
    await t().action(internal.fakeBsc.ebayConsent, { ns: NS, seller: "alt" });
    expect(bodyOf(spy)).toEqual({ ns: NS, seller: "alt" });
  });

  test("another deployment's namespace is refused before anything is sent", async () => {
    armFake();
    const spy = stubFetch(() => Response.json({ code: "c" }));
    await expect(t().action(internal.fakeBsc.ebayConsent, { ns: OTHER_NS })).rejects.toThrow(/namespace/);
    await expect(t().action(internal.fakeBsc.ebayConsent, { ns: "happy-otter-123-" })).rejects.toThrow(/namespace/);
    expect(spy).not.toHaveBeenCalled();
  });

  test.each([
    ["a sandbox eBay", { EBAY_ENVIRONMENT: "sandbox", EBAY_CLIENT_ID: "c", EBAY_RU_NAME: "r" }],
    ["a production eBay", { EBAY_ENVIRONMENT: "production", EBAY_CLIENT_ID: "c", EBAY_RU_NAME: "r" }],
    ["the real BSC", { NEONBINDER_BSC_API_BASE: "" }],
    ["no testing flag", { TESTING_RESET_SECRET: "" }],
  ])("beside %s there is no consent to give: it throws and sends nothing", async (_name, over) => {
    armFake(over);
    const spy = stubFetch(() => Response.json({ code: "c" }));
    await expect(t().action(internal.fakeBsc.ebayConsent, { ns: NS })).rejects.toThrow(/unavailable/);
    expect(spy).not.toHaveBeenCalled();
  });

  test.each([
    ["a refusal", () => new Response("", { status: 400 }), /failed: 400/],
    ["no code", () => Response.json({}), /unreadable/],
    ["a non-string code", () => Response.json({ code: 5 }), /unreadable/],
    ["an empty code", () => Response.json({ code: "" }), /unreadable/],
    ["a code over 4096 characters", () => Response.json({ code: "x".repeat(4097) }), /unreadable/],
    ["a body that is not JSON", () => new Response("nope", { status: 200 }), /unreadable/],
  ])("%s from the fake throws a fixed message", async (_name, answer, message) => {
    armFake();
    stubFetch(answer);
    await expect(t().action(internal.fakeBsc.ebayConsent, { ns: NS })).rejects.toThrow(message);
  });

  test("the thrown message carries no key or token", async () => {
    armFake();
    stubFetch(() => new Response("", { status: 500 }));
    const err = await t().action(internal.fakeBsc.ebayConsent, { ns: NS }).catch((e: unknown) => String(e));
    expect(err).not.toMatch(/caller-key|stub-id-token/);
  });
});

describe("ebaySeller", () => {
  const POLICY = { name: "Flat PWE", costType: "FLAT_RATE" as const, services: [{ code: "USPSFirstClass", costCents: 99 }] };

  test("seeds policies and returns their ids in the order given", async () => {
    armFake();
    const spy = stubFetch(() => Response.json({ ok: true, fulfillmentPolicyIds: ["p1", "p2"], optedIn: true }));
    const out = await t().action(internal.fakeBsc.ebaySeller, {
      ns: NS,
      fulfillmentPolicies: [POLICY, { name: "Free", services: [{ code: "USPSGroundAdvantage", freeShipping: true }] }],
    });
    expect(out).toEqual({ ok: true, skipped: false, fulfillmentPolicyIds: ["p1", "p2"], optedIn: true });
    expect(urlOf(spy)).toBe(`${FAKE_ORIGIN}/__fake/ebay/seller`);
    expect(bodyOf(spy)).toEqual({
      ns: NS,
      fulfillmentPolicies: [POLICY, { name: "Free", services: [{ code: "USPSGroundAdvantage", freeShipping: true }] }],
    });
  });

  test("optedIn alone, on the second seller, sends only what was given", async () => {
    armFake();
    const spy = stubFetch(() => Response.json({ ok: true, fulfillmentPolicyIds: [], optedIn: false }));
    const out = await t().action(internal.fakeBsc.ebaySeller, { ns: NS, seller: "alt", optedIn: false });
    expect(out).toEqual({ ok: true, skipped: false, fulfillmentPolicyIds: [], optedIn: false });
    expect(bodyOf(spy)).toEqual({ ns: NS, seller: "alt", optedIn: false });
  });

  test("an unreadable answer reads as no ids and an unknown opt-in, never a guess", async () => {
    armFake();
    stubFetch(() => Response.json({ ok: true, fulfillmentPolicyIds: [1, "p"], optedIn: "yes" }));
    expect(await t().action(internal.fakeBsc.ebaySeller, { ns: NS, optedIn: true })).toEqual({
      ok: true,
      skipped: false,
      fulfillmentPolicyIds: ["p"],
      optedIn: null,
    });
  });

  test("skipped, sending nothing, beside a sandbox eBay", async () => {
    armFake({ EBAY_ENVIRONMENT: "sandbox", EBAY_CLIENT_ID: "c", EBAY_RU_NAME: "r" });
    const spy = stubFetch(() => Response.json({}));
    expect(await t().action(internal.fakeBsc.ebaySeller, { ns: NS, fulfillmentPolicies: [POLICY] })).toEqual({
      ok: true,
      skipped: true,
      fulfillmentPolicyIds: [],
      optedIn: null,
    });
    expect(spy).not.toHaveBeenCalled();
  });

  test("another deployment's namespace is refused", async () => {
    armFake();
    const spy = stubFetch(() => Response.json({}));
    expect(await t().action(internal.fakeBsc.ebaySeller, { ns: OTHER_NS, optedIn: true })).toEqual({
      ok: false,
      error: "namespace refused",
    });
    expect(spy).not.toHaveBeenCalled();
  });

  test.each([
    ["no policies", []],
    ["eleven policies", Array.from({ length: 11 }, (_, i) => ({ ...POLICY, name: `P${i}` }))],
    ["a blank name", [{ ...POLICY, name: "" }]],
    ["a name over 64", [{ ...POLICY, name: "n".repeat(65) }]],
    ["a control character in the name", [{ ...POLICY, name: "a\nb" }]],
    ["no services", [{ ...POLICY, services: [] }]],
    ["six services", [{ ...POLICY, services: Array.from({ length: 6 }, () => ({ code: "A" })) }]],
    ["a service code with a space", [{ ...POLICY, services: [{ code: "USPS First" }] }]],
    ["a fractional cost", [{ ...POLICY, services: [{ code: "A", costCents: 1.5 }] }]],
    ["a negative cost", [{ ...POLICY, services: [{ code: "A", costCents: -1 }] }]],
    ["a cost over $1000", [{ ...POLICY, services: [{ code: "A", costCents: 100_001 }] }]],
    ["a carrier with a slash", [{ ...POLICY, services: [{ code: "A", carrier: "U/S" }] }]],
  ])("%s is refused before anything is sent", async (_name, fulfillmentPolicies) => {
    armFake();
    const spy = stubFetch(() => Response.json({ ok: true }));
    const out = await t().action(internal.fakeBsc.ebaySeller, { ns: NS, fulfillmentPolicies });
    expect(out).toMatchObject({ ok: false, error: "fulfillmentPolicies refused" });
    expect(spy).not.toHaveBeenCalled();
    expect(fulfillmentPoliciesRefusal(fulfillmentPolicies)).not.toBeNull();
  });

  test("the fake's own refusal (a name already held, 409) comes back with its status and reason", async () => {
    armFake();
    stubFetch(() => Response.json({ error: "a fulfillment policy named Flat PWE already exists" }, { status: 409 }));
    const out = await t().action(internal.fakeBsc.ebaySeller, { ns: NS, fulfillmentPolicies: [POLICY] });
    expect(out).toEqual({
      ok: false,
      status: 409,
      error: "http",
      detail: "a fulfillment policy named Flat PWE already exists",
    });
  });
});

describe("ebayOrders", () => {
  const ORDER = { lines: [{ sku: "NB2-abc-NM", quantity: 1, priceCents: 500 }, { title: "Some other card", quantity: 2 }] };

  test("posts the order and returns the ids the fake gave it", async () => {
    armFake();
    const spy = stubFetch(() => Response.json({ ok: true, orderIds: ["11-22222-33333"], orders: [] }));
    const out = await t().action(internal.fakeBsc.ebayOrders, { ns: NS, order: { ...ORDER, paymentStatus: "PAID" } });
    expect(out).toEqual({ ok: true, skipped: false, orderIds: ["11-22222-33333"] });
    expect(urlOf(spy)).toBe(`${FAKE_ORIGIN}/__fake/ebay/orders`);
    expect(bodyOf(spy)).toEqual({ ns: NS, order: { ...ORDER, paymentStatus: "PAID" } });
  });

  test("on the second seller, replacing a known order (a cancel)", async () => {
    armFake();
    const spy = stubFetch(() => Response.json({ ok: true, orderIds: ["77-1"] }));
    await t().action(internal.fakeBsc.ebayOrders, { ns: NS, seller: "alt", order: { ...ORDER, orderId: "77-1", cancelled: true } });
    expect(bodyOf(spy)).toMatchObject({ seller: "alt", order: { orderId: "77-1", cancelled: true } });
  });

  test("skipped, sending nothing, outside the fake eBay", async () => {
    armFake({ NEONBINDER_BSC_API_BASE: "", EBAY_ENVIRONMENT: "sandbox", EBAY_CLIENT_ID: "c", EBAY_RU_NAME: "r" });
    const spy = stubFetch(() => Response.json({}));
    expect(await t().action(internal.fakeBsc.ebayOrders, { ns: NS, order: ORDER })).toEqual({
      ok: true,
      skipped: true,
      orderIds: [],
    });
    expect(spy).not.toHaveBeenCalled();
  });

  test("another deployment's namespace is refused", async () => {
    armFake();
    const spy = stubFetch(() => Response.json({}));
    expect(await t().action(internal.fakeBsc.ebayOrders, { ns: OTHER_NS, order: ORDER })).toEqual({
      ok: false,
      error: "namespace refused",
    });
    expect(spy).not.toHaveBeenCalled();
  });

  test.each([
    ["no lines", { lines: [] }],
    ["fifty-one lines", { lines: Array.from({ length: 51 }, () => ({ quantity: 1 })) }],
    ["a quantity of 0", { lines: [{ quantity: 0 }] }],
    ["a quantity over 1000", { lines: [{ quantity: 1001 }] }],
    ["a fractional quantity", { lines: [{ quantity: 1.5 }] }],
    ["a negative price", { lines: [{ quantity: 1, priceCents: -1 }] }],
    ["a SKU over 50", { lines: [{ quantity: 1, sku: "s".repeat(51) }] }],
    ["a blank title", { lines: [{ quantity: 1, title: "" }] }],
    ["a title over 80", { lines: [{ quantity: 1, title: "t".repeat(81) }] }],
    ["a control character in the title", { lines: [{ quantity: 1, title: "a\tb" }] }],
    ["a listing id that is not digits", { lines: [{ quantity: 1, listingId: "12ab" }] }],
    ["an order id with a slash", { orderId: "a/b", lines: [{ quantity: 1 }] }],
    ["a creation date of 0", { creationDateMs: 0, lines: [{ quantity: 1 }] }],
  ])("%s is refused before anything is sent", async (_name, order) => {
    armFake();
    const spy = stubFetch(() => Response.json({ ok: true }));
    const out = await t().action(internal.fakeBsc.ebayOrders, { ns: NS, order });
    expect(out).toMatchObject({ ok: false, error: "order refused" });
    expect(spy).not.toHaveBeenCalled();
    expect(ebayOrderRefusal(order)).not.toBeNull();
  });

  test("a payment status the fake does not know is refused by the validator", async () => {
    armFake();
    stubFetch(() => Response.json({ ok: true }));
    await expect(
      t().action(internal.fakeBsc.ebayOrders, { ns: NS, order: { ...ORDER, paymentStatus: "MAYBE" as never } }),
    ).rejects.toThrow();
  });

  test("the fake's own refusal (409) comes back with its status", async () => {
    armFake();
    stubFetch(() => Response.json({ error: "too many orders for this seller", added: [] }, { status: 409 }));
    expect(await t().action(internal.fakeBsc.ebayOrders, { ns: NS, order: ORDER })).toEqual({
      ok: false,
      status: 409,
      error: "http",
      detail: "too many orders for this seller",
    });
  });
});

describe("setFaults for eBay paths", () => {
  const rule = (over: Record<string, unknown> = {}) =>
    ({
      match: { method: "POST", pathTemplate: "ebay/api/sell/inventory/v1/offer/:offerId/publish" },
      kind: "ebayError",
      status: 400,
      errorIds: [25007],
      ...over,
    }) as never;
  const set = (rules: unknown[]) => t().action(internal.fakeBsc.setFaults, { ns: NS, rules: rules as never });

  test("an ebayError rule goes to the fake with its status and error ids", async () => {
    armFake();
    const spy = stubFetch(() => Response.json({ ok: true }));
    expect(await set([rule({ times: 1 })])).toEqual({ ok: true, skipped: false });
    expect(urlOf(spy)).toBe(`${FAKE_ORIGIN}/__fake/faults`);
    expect(bodyOf(spy)).toEqual({
      ns: NS,
      rules: [
        {
          match: { method: "POST", pathTemplate: "ebay/api/sell/inventory/v1/offer/:offerId/publish" },
          kind: "ebayError",
          status: 400,
          errorIds: [25007],
          times: 1,
        },
      ],
    });
  });

  test("an unauthorized rule goes through", async () => {
    armFake();
    const spy = stubFetch(() => Response.json({ ok: true }));
    expect(
      await set([rule({ kind: "unauthorized", status: undefined, errorIds: undefined, times: 1, match: { method: "GET", pathTemplate: "ebay/api/sell/account/v1/program/get_opted_in_programs" } })]),
    ).toEqual({ ok: true, skipped: false });
    expect(bodyOf(spy).rules).toMatchObject([{ kind: "unauthorized", times: 1 }]);
  });

  test("a trailing /* is accepted on an eBay template, and the existing kinds still work on it", async () => {
    armFake();
    const spy = stubFetch(() => Response.json({ ok: true }));
    expect(
      await set([
        rule({ kind: "503", status: undefined, errorIds: undefined, match: { method: "GET", pathTemplate: "ebay/api/sell/*" } }),
      ]),
    ).toEqual({ ok: true, skipped: false });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test("an eBay-path rule sets alongside a BSC rule in one list", async () => {
    armFake();
    const spy = stubFetch(() => Response.json({ ok: true }));
    expect(
      await set([
        { match: { method: "GET", pathTemplate: "seller/order/:id" }, kind: "429" },
        rule(),
      ]),
    ).toEqual({ ok: true, skipped: false });
    expect((bodyOf(spy).rules as unknown[]).length).toBe(2);
  });

  test.each([
    ["a bare star", "*"],
    ["a bare /*", "/*"],
    ["a mid-path star", "ebay/*/publish"],
    ["a star not after a slash", "ebay/api/sell*"],
    ["two stars", "ebay/api/*/*"],
    ["a double slash before the star", "ebay//*"],
    ["a parent segment", "ebay/api/../x"],
    ["a scheme-like host", "https://x/*"],
    ["a space", "ebay/api/sell /*"],
    ["over 200 characters", `ebay/${"a".repeat(200)}`],
  ])("%s is refused and nothing is sent", async (_name, pathTemplate) => {
    armFake();
    const spy = stubFetch(() => Response.json({ ok: true }));
    expect(await set([rule({ match: { method: "POST", pathTemplate } })])).toEqual({ ok: false, error: "rules refused" });
    expect(spy).not.toHaveBeenCalled();
  });

  test.each([
    ["ebayError on a BSC template", { match: { method: "POST", pathTemplate: "seller/order/:id" } }],
    ["unauthorized on a BSC template", { kind: "unauthorized", status: undefined, errorIds: undefined, match: { method: "GET", pathTemplate: "seller/order/:id" } }],
    ["status on a 429 rule", { kind: "429", errorIds: undefined }],
    ["errorIds on a 503 rule", { kind: "503", status: undefined }],
  ])("%s is refused and nothing is sent", async (_name, over) => {
    armFake();
    const spy = stubFetch(() => Response.json({ ok: true }));
    expect(await set([rule(over)])).toEqual({ ok: false, error: "rules refused" });
    expect(spy).not.toHaveBeenCalled();
  });

  test("a /* on a BSC template is not this action's to relax: it still goes only if the template is well formed", async () => {
    armFake();
    const spy = stubFetch(() => Response.json({ ok: true }));
    // Well-formed prefix, non-eBay kind: the fake decides what it matches; Convex's own caller (testing.ts) is the one that refuses it.
    expect(await set([{ match: { method: "GET", pathTemplate: "seller/*" }, kind: "429" }])).toEqual({ ok: true, skipped: false });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test("outside the fake nothing is sent", async () => {
    armFake({ NEONBINDER_BSC_API_BASE: "", EBAY_ENVIRONMENT: "sandbox", EBAY_CLIENT_ID: "c", EBAY_RU_NAME: "r" });
    const spy = stubFetch(() => Response.json({}));
    expect(await set([rule()])).toEqual({ ok: true, skipped: true });
    expect(spy).not.toHaveBeenCalled();
  });
});
