/**
 * NEO-211 B/D — the column's reactive status gains a third state.
 *
 * Before this ticket a sync ended in one of two states: an "error" row (the
 * column shows Retry) or no row at all. A sync that SUCCEEDED but removed a
 * marketplace link, or that stored one platform's results while the other was
 * unreachable, had nowhere to say so — the partial-failure warning went into a
 * message string the FE never rendered.
 *
 * "done" is that third state: data was written, and there is something to
 * read. It is deliberately not "error", because offering Retry would imply
 * nothing was stored.
 *
 * The security property pinned here: what lands in `message` is FIXED text
 * built from a platform NAME. `selectorSyncStatus` is reactive state served to
 * the browser, and an adapter's own error can carry a marketplace URL, a
 * response body, or a credential hint (NEO-47).
 */

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { __resetContractCache } from "./credentials";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import {
  partialSyncMessage,
  pausedSyncMessage,
  skippedSyncMessage,
  unaskedSidesNotice,
} from "./selectorSyncStore";
import type { Id } from "./_generated/dataModel";

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/*.*s");

/** Credentials are not under test — hand the BSC adapter a token. */
vi.mock("./credentials", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./credentials")>();
  const { internalAction } = await import("./_generated/server");
  const { v } = await import("convex/values");
  const getSiteToken = internalAction({
    args: { site: v.string() },
    returns: v.any(),
    handler: async () => ({ token: "test-bsc-token" }),
  });
  return {
    ...actual,
    getSiteToken,
    // NEO-605: the BSC adapter reads the token by calling this directly,
    // not through `runAction(getSiteToken)`; the same stub answers both.
    siteTokenForCurrentUser: (ctx: unknown, site: string) =>
      (getSiteToken as unknown as { _handler: (c: unknown, a: { site: string }) => unknown })._handler(ctx, { site }),
    authenticateBsc: internalAction({
      args: { userId: v.optional(v.string()), tokenRefused: v.optional(v.boolean()) },
      returns: v.any(),
      handler: async () => ({ success: true }),
    }),
  };
});

// Warm the mocked module once, before any test runs. The adapters import
// "./credentials" and convex-test's function loader imports it too, and when
// those two first imports overlap (a BSC and a SportLots side fetched together)
// vitest builds the async factory twice, and one importer can fall through to
// the REAL module, so the adapter reads a real token and the sync ends in
// "error". Vitest's own mocker says this does not work for concurrent imports.
// Awaiting it here caches the mocked module before anything can race.
await import("./credentials");

const ADMIN_IDENTITY = {
  subject: "admin_neo211_status",
  issuer: "https://clerk.example.com",
  tokenIdentifier: "clerk|admin_neo211_status",
  name: "Admin User",
  role: "admin",
};

const SENTINEL = 1_000_000;

beforeEach(() => {
  // The browser-contract check is cached per module; a test that answers
  // /health must not hand its answer to the next one.
  __resetContractCache();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("skippedSyncMessage", () => {
  test("names the platform, and says SKIPPED rather than unreachable", () => {
    // NEO-239. Deliberately not `partialSyncMessage`'s wording: "could not be
    // reached" invites a Retry, and a side skipped for want of ids would fail
    // that Retry identically every time — nothing is wrong with the
    // marketplace. The fix is to attach an id, somewhere else entirely.
    const out = skippedSyncMessage(["sportlots"]);
    expect(out).toContain("SportLots");
    expect(out).toContain("skipped");
    expect(out).not.toContain("retry");
    expect(skippedSyncMessage(["bsc"])).toContain("BuySportsCards");
  });

  test("cannot echo adapter output even if handed some", () => {
    // Same property `partialSyncMessage` has, and for the same reason: these
    // two share one platform-name mapping precisely so a future caller cannot
    // get a raw string into reactive state through the newer of them.
    const hostile =
      "https://internal.example/api/login?token=SUPERSECRET body=<html>";
    const out = skippedSyncMessage([hostile]);
    expect(out).not.toContain("SUPERSECRET");
    expect(out).not.toContain("http");
    expect(out).toContain("A marketplace");
  });
});

describe("pausedSyncMessage (NEO-287)", () => {
  test("names the platform, says pause, and reassures nothing was touched", () => {
    const out = pausedSyncMessage(["sportlots"]);
    expect(out).toContain("SportLots");
    expect(out).toContain("pause");
    expect(out).toContain("is on pause");
    expect(pausedSyncMessage(["bsc"])).toContain("BuySportsCards");
  });

  test("pluralises the verb across two platforms", () => {
    const out = pausedSyncMessage(["bsc", "sportlots"]);
    expect(out).toContain("BuySportsCards and SportLots");
    expect(out).toContain("are on pause");
    expect(out).not.toContain("is on pause");
  });

  test("cannot echo adapter output even if handed some", () => {
    const hostile =
      "https://internal.example/api/login?token=SUPERSECRET body=<html>";
    const out = pausedSyncMessage([hostile]);
    expect(out).not.toContain("SUPERSECRET");
    expect(out).not.toContain("http");
    expect(out).toContain("A marketplace");
  });
});

describe("unaskedSidesNotice (NEO-287)", () => {
  test("undefined when nothing was left unasked", () => {
    expect(unaskedSidesNotice([], [])).toBeUndefined();
  });

  test("just the paused sentence when only a side is paused", () => {
    const out = unaskedSidesNotice(["sportlots"], []);
    expect(out).toBe(pausedSyncMessage(["sportlots"]));
  });

  test("just the skipped sentence when only a side lacks ids", () => {
    const out = unaskedSidesNotice([], ["bsc"]);
    expect(out).toBe(skippedSyncMessage(["bsc"]));
  });

  test("paused leads, skipped follows — two sentences, never collapsed", () => {
    const out = unaskedSidesNotice(["sportlots"], ["bsc"]);
    expect(out).toBe(
      `${pausedSyncMessage(["sportlots"])} ${skippedSyncMessage(["bsc"])}`,
    );
  });
});

describe("partialSyncMessage", () => {
  test("names the platform and nothing else", () => {
    expect(partialSyncMessage(["sportlots"])).toContain("SportLots");
    expect(partialSyncMessage(["bsc"])).toContain("BuySportsCards");
    expect(partialSyncMessage(["bsc", "sportlots"])).toContain(
      "BuySportsCards and SportLots",
    );
  });

  test("cannot echo adapter output even if handed some", () => {
    // The real callers only ever pass "bsc" / "sportlots". The fallback is what
    // makes "no adapter text reaches reactive state" a property of this
    // function rather than a habit of its callers.
    const hostile =
      "https://internal.example/api/login?token=SUPERSECRET body=<html>";
    const out = partialSyncMessage([hostile]);
    expect(out).not.toContain("SUPERSECRET");
    expect(out).not.toContain("http");
    expect(out).toContain("A marketplace");
  });
});

describe("selectorSyncStatus", () => {
  async function seedSet(t: ReturnType<typeof convexTest>) {
    return t.run(async (ctx) =>
      ctx.db.insert("selectorOptions", {
        level: "setName",
        value: "Topps",
        platformData: {},
        children: [],
        lastUpdated: SENTINEL,
      }),
    );
  }

  test('a "done" row carries the unlink notice and is readable by the column', async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const rowId = await seedSet(t);

    await t.mutation(internal.selectorOptions.setSelectorSyncStatus, {
      level: "setName",
      status: "done",
      message: partialSyncMessage(["sportlots"]),
      unlinked: [
        { id: rowId, value: "Topps", side: "bsc", hasCards: true },
      ],
      unlinkedTotal: 1,
    });

    const status = await asAdmin.query(
      api.selectorOptions.getSelectorSyncStatus,
      { level: "setName" },
    );
    expect(status).toMatchObject({ status: "done", unlinkedTotal: 1 });
    expect(status?.unlinked?.[0]).toEqual({
      id: rowId,
      value: "Topps",
      side: "bsc",
      hasCards: true,
    });
    expect(status?.message).toContain("SportLots");
  });

  test("a new sync clears the previous run's notice rather than inheriting it", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const rowId = await seedSet(t);

    await t.mutation(internal.selectorOptions.setSelectorSyncStatus, {
      level: "setName",
      status: "done",
      unlinked: [{ id: rowId, value: "Topps", side: "bsc" }],
      unlinkedTotal: 1,
    });
    // A patch is a shallow merge, so without writing every field explicitly a
    // "syncing" row would still be carrying last run's unlink list.
    await t.mutation(internal.selectorOptions.setSelectorSyncStatus, {
      level: "setName",
      status: "syncing",
    });

    const status = await asAdmin.query(
      api.selectorOptions.getSelectorSyncStatus,
      { level: "setName" },
    );
    expect(status?.status).toBe("syncing");
    expect(status?.unlinked).toBeUndefined();
    expect(status?.unlinkedTotal).toBeUndefined();
  });

  test('dismiss removes a "done" row and refuses anything else', async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);

    // "syncing" is live state the action owns; "error" is the column's Retry
    // affordance. Dismissing either would strand or silence the column.
    for (const status of ["syncing", "error"] as const) {
      await t.mutation(internal.selectorOptions.setSelectorSyncStatus, {
        level: "setName",
        status,
      });
      expect(
        await asAdmin.mutation(
          api.selectorOptions.dismissSelectorSyncNotice,
          { level: "setName" },
        ),
      ).toEqual({ dismissed: false });
      expect(
        await asAdmin.query(api.selectorOptions.getSelectorSyncStatus, {
          level: "setName",
        }),
      ).not.toBeNull();
    }

    await t.mutation(internal.selectorOptions.setSelectorSyncStatus, {
      level: "setName",
      status: "done",
      unlinkedTotal: 3,
    });
    expect(
      await asAdmin.mutation(api.selectorOptions.dismissSelectorSyncNotice, {
        level: "setName",
      }),
    ).toEqual({ dismissed: true });
    expect(
      await asAdmin.query(api.selectorOptions.getSelectorSyncStatus, {
        level: "setName",
      }),
    ).toBeNull();
  });

  test("dismiss is admin-gated", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.selectorOptions.setSelectorSyncStatus, {
      level: "setName",
      status: "done",
    });
    await expect(
      t
        .withIdentity({
          subject: "u",
          issuer: "https://clerk.example.com",
          tokenIdentifier: "clerk|u",
          role: "user",
        })
        .mutation(api.selectorOptions.dismissSelectorSyncNotice, {
          level: "setName",
        }),
    ).rejects.toThrow();
  });

  test('a leftover "done" row does not make a populated column re-fetch', async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    await seedSet(t);
    await t.mutation(internal.selectorOptions.setSelectorSyncStatus, {
      level: "setName",
      status: "done",
      unlinkedTotal: 1,
    });

    // The already-populated short-circuit is keyed on the ROWS, not on the
    // status — so an old SPA bundle that does not understand "done" cannot
    // drive a fetch storm by leaving the notice up.
    const res = await asAdmin.action(
      api.selectorOptions.ensureSelectorOptions,
      { level: "setName" },
    );
    // NEO-239 — `skippedSides` rides on every fetch result now, so the FE can
    // tell "we never asked this marketplace" from "it answered with nothing".
    // An already-populated column asked neither, and skipped neither.
    expect(res).toEqual({
      ran: false,
      reason: "already_populated",
      skippedSides: [],
      pausedSides: [],
    });
    // And the notice survives for the admin to read and dismiss.
    expect(
      await asAdmin.query(api.selectorOptions.getSelectorSyncStatus, {
        level: "setName",
      }),
    ).toMatchObject({ status: "done" });
  });
});

describe("adapter output never reaches the persisted status row", () => {
  test("a failing adapter's own text stays in the log, not in reactive state", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const sportId = await t.run(async (ctx) =>
      ctx.db.insert("selectorOptions", {
        level: "sport",
        value: "Baseball",
        platformData: { bsc: { b0: "baseball" }, sportlots: { s0: "BB" } },
        children: [],
        lastUpdated: SENTINEL,
      }),
    );

    vi.stubEnv("NEONBINDER_BROWSER_URL", "http://localhost:9999");
    vi.stubGlobal("fetch", async (url: string | URL | Request) => {
      if (String(url).endsWith("/health")) {
        return new Response(
          JSON.stringify({
            status: "ok",
            environment: "test",
            contractVersion: 1,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      // Exactly the kind of thing an adapter error carries: a marketplace URL,
      // a query string with a credential in it, and a response body.
      return new Response(
        "https://marketplace.example/login?token=SUPERSECRET <html>oops</html>",
        { status: 500 },
      );
    });

    // The adapter retries a 500 after a real setTimeout backoff; fake the
    // timer and step past it instead of sleeping through it.
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const ran = asAdmin.action(api.selectorOptions.ensureSelectorOptions, {
        level: "year",
        parentId: sportId,
      });
      // The backoff timer is only armed once the action reaches it, which can
      // follow real async work (a cold module load): step the fake clock until
      // the action settles, yielding to the real event loop between steps.
      let settled = false;
      void ran.then(
        () => (settled = true),
        () => (settled = true),
      );
      while (!settled) {
        await vi.advanceTimersByTimeAsync(1_000);
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      await ran;
    } finally {
      vi.useRealTimers();
    }

    const status = await asAdmin.query(
      api.selectorOptions.getSelectorSyncStatus,
      { level: "year", parentId: sportId },
    );
    expect(status?.status).toBe("error");
    expect(status?.message).not.toContain("SUPERSECRET");
    expect(status?.message).not.toContain("http");
    expect(status?.message).not.toContain("<html>");
  }, 60_000);
});

// ===========================================================================
// NEO-239 — a side that was never asked is a NOTICE, not silence
// ===========================================================================

/**
 * The operator-visibility half of retiring `isCustom`.
 *
 * Half a populated column with no explanation is the worst outcome of the
 * per-side skip: it looks exactly like "the marketplace had nothing", when in
 * fact nobody asked — and the fix (attach an id) is an action the operator
 * would never think to take from that screen.
 *
 * Both sides skipped is the opposite case and stays SILENT on purpose. That is
 * the hand-made subtree, where a notice on every column down the tree would be
 * about a marketplace the operator never involved, and where 37 Maestro flows
 * plus every "+ Custom" drill depend on the column going idle instantly.
 */
describe("ensureSelectorOptions — the skip reaches the operator", () => {
  /** A sport row linked on BSC only, so SportLots cannot be scoped. */
  async function seedBscOnlySport(t: ReturnType<typeof convexTest>) {
    return t.run(async (ctx) =>
      ctx.db.insert("selectorOptions", {
        level: "sport",
        value: "Baseball",
        platformData: { bsc: { b0: "baseball" } },
        platformSlotSeq: { bsc: 1 },
        children: [],
        lastUpdated: SENTINEL,
      }),
    );
  }

  /** A sport row linked on neither side — the hand-made subtree. */
  async function seedUnlinkedSport(t: ReturnType<typeof convexTest>) {
    return t.run(async (ctx) =>
      ctx.db.insert("selectorOptions", {
        level: "sport",
        value: "E2E Test Sport 3",
        platformData: {},
        children: [],
        lastUpdated: SENTINEL,
      }),
    );
  }

  /** BSC answers with one year; every other request is inert. */
  function stubBscYears() {
    vi.stubGlobal(
      "fetch",
      (async () =>
        new Response(
          JSON.stringify({
            aggregations: {
              year: [{ label: "2024", slug: "2024", count: 12 }],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )) as unknown as typeof fetch,
    );
  }

  test("ONE side skipped: status is done, with the fixed skipped-side message", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const sportId = await seedBscOnlySport(t);
    stubBscYears();

    const res = await asAdmin.action(api.selectorOptions.ensureSelectorOptions, {
      level: "year",
      parentId: sportId,
    });

    expect(res.ran).toBe(true);
    expect(res.skippedSides).toEqual(["sportlots"]);

    const status = await asAdmin.query(
      api.selectorOptions.getSelectorSyncStatus,
      { level: "year", parentId: sportId },
    );
    // "done", not "error": data WAS written, and Retry would imply it was not.
    expect(status?.status).toBe("done");
    expect(status?.message).toBe(skippedSyncMessage(["sportlots"]));
    // Fixed text: the platform name, and nothing from the row or the adapter.
    expect(status?.message).not.toContain("Baseball");
    expect(status?.message).not.toContain("baseball");
  });

  test("BOTH sides skipped: the status is CLEARED and says nothing", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const sportId = await seedUnlinkedSport(t);
    // A stale notice from an earlier run must not survive the skip either —
    // the column has to reach idle, not "idle with a leftover message".
    await t.mutation(internal.selectorOptions.setSelectorSyncStatus, {
      level: "year",
      parentId: sportId,
      status: "done",
      message: "left over from a previous run",
    });

    const res = await asAdmin.action(api.selectorOptions.ensureSelectorOptions, {
      level: "year",
      parentId: sportId,
    });

    // `ran: false` — nothing was even attempted, which is what makes the skip
    // instant rather than a round trip the column waits on.
    expect(res.ran).toBe(false);
    expect(res.reason).toBe("no_marketplace_ids");
    expect(res.skippedSides).toEqual(["bsc", "sportlots"]);

    expect(
      await asAdmin.query(api.selectorOptions.getSelectorSyncStatus, {
        level: "year",
        parentId: sportId,
      }),
    ).toBeNull();
  });
});
