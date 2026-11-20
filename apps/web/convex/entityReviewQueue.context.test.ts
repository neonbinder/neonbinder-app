/**
 * NEO-602 — `getInternal` returns the stored row, display context included.
 *
 * The pool's lookup work item (`runEntityReviewLookupImpl`) reads its row
 * through `internal.entityReviewQueue.getInternal`. Its `returns` validator
 * left out `teamContext` and `playerContext`, so every team row (the review
 * gate always writes `teamContext` on one) and every same-name player row
 * failed with a ReturnsValidationError: the lookup threw and the wizard sat on
 * "still looking up". Pinned here:
 *
 *   - `getInternal` returns a row carrying both fields, whole;
 *   - a team row with `teamContext` runs `runEntityReviewLookup` to "ready"
 *     and keeps its context;
 *   - the public `getBatch` still does not hand the client `playerContext`, or
 *     `teamContext`'s cards (it projects `candidateTeamIds` only).
 *
 * Root-level for the convex-test module-registry reason given in
 * convex/wikidataEnrichTeam.test.ts's header.
 */

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { normalizeTeamName } from "./teams";
import { normalizePlayerName } from "./players";
import { __resetEspnTeamListCache } from "./adapters/espn";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

type T = ReturnType<typeof convexTest>;

const ADMIN_IDENTITY = {
  subject: "user_ctx_001",
  issuer: "https://clerk.example.com",
  tokenIdentifier: "clerk|user_ctx_001",
  role: "admin",
};

const NATIONALS_QID = "Q1421";
const MLB_QID = "Q1163715";

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const ESPN_NATIONALS = {
  sports: [
    {
      leagues: [
        {
          teams: [
            {
              team: {
                id: "20",
                displayName: "Washington Nationals",
                location: "Washington",
                color: "ab0003",
                alternateColor: "14225a",
              },
            },
          ],
        },
      ],
    },
  ],
};

function stubFetch(): void {
  vi.stubGlobal(
    "fetch",
    (async (url: string | URL) => {
      const u = String(url);
      const decoded = decodeURIComponent(u);
      if (u.includes("site.web.api.espn.com")) return jsonResponse(ESPN_NATIONALS);
      if (u.includes("query.wikidata.org")) {
        if (decoded.includes("wdt:P118") || decoded.includes("wdt:P571")) {
          return jsonResponse({
            results: {
              bindings: [
                {
                  league: { type: "uri", value: `http://www.wikidata.org/entity/${MLB_QID}` },
                  leagueLabel: { type: "literal", value: "Major League Baseball" },
                  inception: { type: "literal", value: "1969-01-01T00:00:00Z" },
                },
              ],
            },
          });
        }
        return jsonResponse({
          results: {
            bindings: [
              { team: { type: "uri", value: `http://www.wikidata.org/entity/${NATIONALS_QID}` } },
            ],
          },
        });
      }
      throw new Error(`unexpected fetch: ${u}`);
    }) as unknown as typeof fetch,
  );
}

async function seedSport(t: T): Promise<Id<"selectorOptions">> {
  return t.run(async (ctx) =>
    ctx.db.insert("selectorOptions", {
      level: "sport",
      value: "Baseball",
      platformData: {},
      children: [],
      sportConfig: {
        skuCode: "BB",
        league: "MLB",
        espn: { path: "baseball/mlb", leagueName: "Major League Baseball" },
        wikidata: { sportQid: "Q5369", hallOfFameQid: "Q1194380" },
      },
      lastUpdated: 1_700_000_000_000,
    }),
  );
}

async function seedTeam(t: T, sportId: Id<"selectorOptions">, name: string): Promise<Id<"teams">> {
  return t.run(async (ctx) =>
    ctx.db.insert("teams", {
      name,
      nameNormalized: normalizeTeamName(name),
      sportId,
      lastUpdated: Date.now(),
    }),
  );
}

async function seedPlayer(t: T, sportId: Id<"selectorOptions">, name: string): Promise<Id<"players">> {
  return t.run(async (ctx) =>
    ctx.db.insert("players", {
      name,
      nameNormalized: normalizePlayerName(name),
      sportId,
      lastUpdated: Date.now(),
    }),
  );
}

const getRow = (t: T, id: Id<"entityReviewQueue">) => t.run(async (ctx) => ctx.db.get(id));

beforeEach(() => {
  __resetEspnTeamListCache();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("getInternal returns the stored display context", () => {
  test("a team row with teamContext (non-empty cards) and a player row with playerContext both come back whole", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const candidateA = await seedTeam(t, sportId, "Washington Nationals");
    const candidateB = await seedTeam(t, sportId, "Washington Senators");
    const playerId = await seedPlayer(t, sportId, "Bob Allen");

    const teamContext = {
      candidateTeamIds: [candidateA, candidateB],
      cards: [
        { number: "12", players: [{ name: "Bob Allen", playerId }, { name: "Joe Smith" }] },
        { players: [{ name: "Ann Lee" }] },
      ],
      moreCards: 3,
    };
    const playerContext = {
      cards: [{ number: "44", teams: ["Nationals", "Senators"] }, { teams: [] }],
      moreCards: 1,
    };

    const { teamRowId, playerRowId } = await t.run(async (ctx) => {
      const base = {
        selectorOptionId: sportId,
        batchId: "batch-ctx",
        createdByUserId: "user_ctx_001",
        sportId,
        status: "ready" as const,
      };
      return {
        teamRowId: await ctx.db.insert("entityReviewQueue", {
          ...base,
          kind: "team",
          name: "Washington",
          nameNormalized: normalizeTeamName("Washington"),
          teamContext,
        }),
        playerRowId: await ctx.db.insert("entityReviewQueue", {
          ...base,
          kind: "player",
          name: "Bob Allen",
          nameNormalized: normalizePlayerName("Bob Allen"),
          playerContext,
        }),
      };
    });

    const teamRow = await t.query(internal.entityReviewQueue.getInternal, { id: teamRowId });
    expect(teamRow?.teamContext).toEqual(teamContext);
    const playerRow = await t.query(internal.entityReviewQueue.getInternal, { id: playerRowId });
    expect(playerRow?.playerContext).toEqual(playerContext);
  });

  test("the public getBatch still withholds playerContext and teamContext's cards", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const candidate = await seedTeam(t, sportId, "Washington Nationals");
    await t.run(async (ctx) => {
      const base = {
        selectorOptionId: sportId,
        batchId: "batch-ctx",
        createdByUserId: ADMIN_IDENTITY.subject,
        sportId,
        status: "ready" as const,
      };
      await ctx.db.insert("entityReviewQueue", {
        ...base,
        kind: "team",
        name: "Washington",
        nameNormalized: normalizeTeamName("Washington"),
        teamContext: {
          candidateTeamIds: [candidate],
          cards: [{ number: "12", players: [{ name: "Bob Allen" }] }],
          moreCards: 0,
        },
      });
      await ctx.db.insert("entityReviewQueue", {
        ...base,
        kind: "player",
        name: "Bob Allen",
        nameNormalized: normalizePlayerName("Bob Allen"),
        playerContext: { cards: [{ number: "44", teams: ["Nationals"] }], moreCards: 0 },
      });
    });

    const rows = await t
      .withIdentity(ADMIN_IDENTITY)
      .query(api.entityReviewQueue.getBatch, { selectorOptionId: sportId, batchId: "batch-ctx" });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).not.toHaveProperty("playerContext");
      expect(row).not.toHaveProperty("createdByUserId");
    }
    const team = rows.find((r) => r.kind === "team");
    expect(team?.teamContext).toEqual({ candidateTeamIds: [candidate] });
  });
});

describe("runEntityReviewLookup on a team row that carries teamContext", () => {
  test("reads the row, resolves it to 'ready' and keeps the context", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const playerId = await seedPlayer(t, sportId, "Bob Allen");
    const teamContext = {
      candidateTeamIds: [],
      cards: [{ number: "12", players: [{ name: "Bob Allen", playerId }] }],
      moreCards: 0,
    };
    const rowId = await t.run(async (ctx) =>
      ctx.db.insert("entityReviewQueue", {
        selectorOptionId: sportId,
        batchId: "batch-ctx",
        createdByUserId: "user_ctx_001",
        kind: "team",
        name: "Washington Nationals",
        nameNormalized: normalizeTeamName("Washington Nationals"),
        sportId,
        status: "pending",
        teamContext,
      }),
    );
    stubFetch();

    await t.action(internal.adapters.wikidata.runEntityReviewLookup, { rowId });

    const row = await getRow(t, rowId);
    expect(row!.status).toBe("ready");
    expect(row!.enrichment).toMatchObject({ wikidataId: NATIONALS_QID, espnId: "20" });
    expect(row!.teamContext).toEqual(teamContext);
  });
});
