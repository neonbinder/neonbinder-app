/**
 * NEO-645 — `runTidyNameLookupImpl`: what status a name row lands with.
 *
 * ## The bug these pin
 *
 * Every lookup that returned nothing was written `status: "error"`: a plain
 * Wikidata miss and a sport with no Wikidata mapping, the same as a network
 * failure. "Add all N new players" offers a name only when its lookup
 * FINISHED (`ready`), so it never offered a new rookie, the exact name it
 * exists for. The row now says which of the two it is:
 *
 *   - a lookup that finished and found nothing (Wikidata answered with no
 *     match, or the sport has no Wikidata mapping so nothing was asked) is
 *     `ready` with no enrichment, and the Player tile still reads "No Wikidata
 *     match found." from the missing enrichment;
 *   - a lookup that could not complete (a 4xx the endpoint will not change its
 *     mind on, an unreadable answer, a thrown error) stays `error`;
 *   - an unreachable Wikidata (a timeout, a 5xx, a 429) writes nothing and
 *     throws retryably, so the pool asks again; the backstop ages a row that
 *     never resolves to `error`.
 *
 * A stub ctx rather than convex-test: the status written is the whole point,
 * and the stub records exactly what `applyLookupResult` was handed.
 */

import { getFunctionName, type FunctionReference } from "convex/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  __setEmptySearchReaskBackoffForTests,
  runTidyNameLookupImpl,
  type EntityReviewLookupCtx,
} from "./wikidata";
import { WikidataUnavailableError } from "../../lib/errors/wikidata-unavailable";
import { __resetEspnTeamListCache } from "./espn";

beforeAll(() => __setEmptySearchReaskBackoffForTests(0));
afterAll(() => __setEmptySearchReaskBackoffForTests(undefined));

const ROW_ID = "tidy_name_1" as unknown as Id<"tidyNames">;
const SPORT_ID = "sport_option_1" as unknown as Id<"selectorOptions">;
const MATCHED_QID = "Q123456";
const GEN = 2;

const MAPPED_SPORT = { label: "Baseball", wikidata: { sportQid: "Q5369" } };
/** A sport row with no `sportConfig.wikidata`: nothing can be asked. */
const UNMAPPED_SPORT = { label: "Pickleball" };

const rowOf = (kind: "player" | "team") => ({
  kind,
  name: kind === "player" ? "Quinn Rookie" : "Springfield Isotopes",
  sportId: SPORT_ID,
  status: "pending" as const,
  lookupGen: GEN,
});

type Write = { id: Id<"tidyNames">; gen: number; status: string; enrichment?: unknown };

function stubCtx(options: {
  kind?: "player" | "team";
  sport?: Record<string, unknown> | null;
  sportQueryThrows?: Error;
}) {
  const writes: Write[] = [];
  const ctx = {
    runQuery: async (ref: FunctionReference<"query">) => {
      switch (getFunctionName(ref)) {
        case getFunctionName(internal.tidyNames.getForLookup):
          return rowOf(options.kind ?? "player");
        case getFunctionName(internal.selectorOptions.getSportEnrichmentContext):
          if (options.sportQueryThrows) throw options.sportQueryThrows;
          return options.sport === undefined ? MAPPED_SPORT : options.sport;
        default:
          throw new Error(`unexpected query: ${getFunctionName(ref)}`);
      }
    },
    runMutation: async (ref: FunctionReference<"mutation">, args: Write) => {
      const name = getFunctionName(ref);
      if (name !== getFunctionName(internal.tidyNames.applyLookupResult)) {
        throw new Error(`unexpected mutation: ${name}`);
      }
      writes.push(args);
      return null;
    },
  } as unknown as EntityReviewLookupCtx;
  return { ctx, writes };
}

const NO_SLEEP = { sleep: async () => {} };
const run = (ctx: EntityReviewLookupCtx) =>
  runTidyNameLookupImpl(ctx, { tidyNameId: ROW_ID, gen: GEN }, NO_SLEEP);

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const uri = (qid: string) => ({ type: "uri", value: `http://www.wikidata.org/entity/${qid}` });

/** The entity search answers `qid` (or nothing); the detail query answers one team stint. */
function stubFetch(qid: string | null): void {
  vi.stubGlobal(
    "fetch",
    (async (url: string | URL) => {
      const decoded = decodeURIComponent(String(url));
      if (decoded.includes("p:P54") || decoded.includes("wdt:P166")) {
        return jsonResponse({ results: { bindings: [{}] } });
      }
      return jsonResponse({ results: { bindings: qid ? [{ player: uri(qid), team: uri(qid) }] : [] } });
    }) as unknown as typeof fetch,
  );
}
/** Every request gets this status and no usable body. */
function stubFetchStatus(status: number): void {
  vi.stubGlobal("fetch", (async () => jsonResponse({}, status)) as unknown as typeof fetch);
}

beforeEach(() => {
  __resetEspnTeamListCache();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a player lookup", () => {
  test("that matched is `ready` with its enrichment", async () => {
    stubFetch(MATCHED_QID);
    const { ctx, writes } = stubCtx({});
    await run(ctx);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ id: ROW_ID, gen: GEN, status: "ready" });
    expect(writes[0].enrichment).toMatchObject({ wikidataId: MATCHED_QID });
  });

  test("that finished with no Wikidata match is `ready` with no enrichment", async () => {
    stubFetch(null);
    const { ctx, writes } = stubCtx({});
    await run(ctx);
    expect(writes).toHaveLength(1);
    expect(writes[0].status).toBe("ready");
    expect(writes[0].enrichment).toBeUndefined();
  });

  test("in a sport with no Wikidata mapping is `ready` with no enrichment, and asks nothing", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { ctx, writes } = stubCtx({ sport: UNMAPPED_SPORT });
    await run(ctx);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(writes).toHaveLength(1);
    expect(writes[0].status).toBe("ready");
    expect(writes[0].enrichment).toBeUndefined();
  });

  test("whose sport row is gone has nothing to ask and is `ready` with no enrichment", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { ctx, writes } = stubCtx({ sport: null });
    await run(ctx);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(writes.map((w) => w.status)).toEqual(["ready"]);
    expect(writes[0].enrichment).toBeUndefined();
  });

  test("that the endpoint refused (a 400) is `error`: it did not finish", async () => {
    stubFetchStatus(400);
    const { ctx, writes } = stubCtx({});
    await run(ctx);
    expect(writes).toHaveLength(1);
    expect(writes[0].status).toBe("error");
    expect(writes[0].enrichment).toBeUndefined();
  });

  test("that threw is `error`", async () => {
    stubFetch(null);
    const { ctx, writes } = stubCtx({ sportQueryThrows: new Error("boom") });
    await run(ctx);
    expect(writes).toHaveLength(1);
    expect(writes[0].status).toBe("error");
    expect(writes[0].enrichment).toBeUndefined();
  });

  test.each([500, 429])(
    "that found Wikidata unavailable (a %i) writes nothing and throws retryably",
    async (status) => {
      stubFetchStatus(status);
      const { ctx, writes } = stubCtx({});
      const outcome = await run(ctx).then(
        () => "resolved" as const,
        (error: unknown) => error,
      );
      expect(outcome).toBeInstanceOf(WikidataUnavailableError);
      expect(writes).toEqual([]);
    },
  );

  test("for a row that moved to a newer generation writes nothing at all", async () => {
    stubFetch(null);
    const { ctx, writes } = stubCtx({});
    await runTidyNameLookupImpl(ctx, { tidyNameId: ROW_ID, gen: GEN - 1 }, NO_SLEEP);
    expect(writes).toEqual([]);
  });
});

describe("a team lookup", () => {
  test("that finished with no match is `ready` with no enrichment", async () => {
    stubFetch(null);
    const { ctx, writes } = stubCtx({ kind: "team" });
    await run(ctx);
    expect(writes).toHaveLength(1);
    expect(writes[0].status).toBe("ready");
    expect(writes[0].enrichment).toBeUndefined();
  });

  test("that the endpoint refused (a 400) is `error`", async () => {
    stubFetchStatus(400);
    const { ctx, writes } = stubCtx({ kind: "team" });
    await run(ctx);
    expect(writes.map((w) => w.status)).toEqual(["error"]);
    expect(writes[0].enrichment).toBeUndefined();
  });
});
