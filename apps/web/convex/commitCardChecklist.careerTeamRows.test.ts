/**
 * NEO-236 — the commit prelude's staged-career-team pass.
 *
 * A career team the batch has to create is no longer three inline inputs on
 * the player's step; it is a `team` review row of its own carrying
 * `source.kind === "careerTeamOf"`, answered with the same New Team step a
 * checklist team gets — Location, Name, and the League that previously had no
 * way of being asked about at all. This file covers what
 * `commitCardChecklistPrelude` does with those answers.
 *
 * Two things about the prelude changed, and both are load-bearing:
 *
 *   1. **Loop order.** It is now skips → staged `careerTeamOf` rows → the
 *      checklist TEAM loop → the PLAYER loop. Player used to come before team.
 *      Nothing hands an id across: the player loop resolves each stint by
 *      `findTeamByFullName`, so a team created in the staged pass is simply
 *      FOUND there. That is why the pass has to run first.
 *   2. **League precedence** (`reviewedTeamFields`). The operator's answer
 *      wins — an id, a name, or `null` for "no league" — then the lookup's
 *      suggestion, then nothing. NEO-331 (Jason, 2026-10-10): "An unanswered
 *      League stays blank, same as No league. No team lands under MLB without
 *      someone saying so." The sport default is never applied, so the old
 *      `leagueChosen` flag that kept "no league" apart from "not answered" is
 *      gone — both write no `leagueId`.
 *
 * Fixture conventions mirror convex/commitCardChecklist.entityReview.test.ts:
 * the same sport → setName → variantType tree, review rows inserted raw so
 * each test controls the exact decision shape, and the commit driven through
 * the real `api.selectorOptions.commitCardChecklist` action.
 */

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { Id } from "./_generated/dataModel";
import { normalizeTeamName } from "./teams";
import { cancelScheduled } from "../lib/testing/drain-scheduled";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const ADMIN_IDENTITY = {
  subject: "admin_career_team_001",
  issuer: "https://clerk.example.com",
  tokenIdentifier: "clerk|admin_career_team_001",
  name: "Admin User",
  role: "admin",
};

const BATCH = "batch-career";

async function seedTree(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const sportId = await ctx.db.insert("selectorOptions", {
      level: "sport",
      value: "Baseball",
      // Configured league — so "the sport default did NOT win" is a claim with
      // something to lose to.
      sportConfig: {
        skuCode: "BB",
        league: "MLB",
        espn: { path: "baseball/mlb", leagueName: "Major League Baseball" },
        wikidata: { sportQid: "Q5369", hallOfFameQid: "Q1194380" },
      },
      platformData: {},
      children: [],
      lastUpdated: Date.now(),
    });
    const setNameId = await ctx.db.insert("selectorOptions", {
      level: "setName",
      value: "Chrome",
      platformData: {},
      features: { manufacturer: "Topps", season: "2024" },
      parentId: sportId,
      children: [],
      lastUpdated: Date.now(),
    });
    await ctx.db.patch(sportId, { children: [setNameId] });
    const variantTypeId = await ctx.db.insert("selectorOptions", {
      level: "variantType",
      value: "Base",
      platformData: {},
      features: { manufacturer: "Topps", season: "2024" },
      parentId: setNameId,
      children: [],
      lastUpdated: Date.now(),
    });
    await ctx.db.patch(setNameId, { children: [variantTypeId] });
    return { sportId, setNameId, variantTypeId };
  });
}

function makeCard(
  overrides: Partial<{
    cardNumber: string;
    cardName: string;
    players: string[];
    teams: string[];
  }> = {},
) {
  return {
    cardNumber: overrides.cardNumber ?? "1",
    cardName: overrides.cardName ?? "Card",
    team: undefined,
    teams: overrides.teams ?? [],
    players: overrides.players ?? [],
    attributes: [],
    isRookie: false,
    isRelic: false,
    printRun: undefined,
    autographType: undefined,
    cardVariation: undefined,
    platformData: {},
    unmatched: undefined,
  };
}

type TeamCreate = {
  location?: string;
  name: string;
  leagueId?: Id<"leagues"> | null;
  leagueName?: string;
};

async function insertReviewRow(
  t: ReturnType<typeof convexTest>,
  opts: {
    selectorOptionId: Id<"selectorOptions">;
    sportId: Id<"selectorOptions">;
    kind: "player" | "team";
    name: string;
    decision?: Record<string, unknown>;
    enrichment?: Record<string, unknown>;
    source?: { kind: "careerTeamOf"; playerRowId: Id<"entityReviewQueue"> };
    /**
     * NEO-248 — whose review session this row belongs to. Defaulted, because
     * every test here inserts its decisions directly; a test that drives the
     * PUBLIC mutations instead has to stamp the identity it calls them with,
     * which is what `assertOwnsRow` compares against.
     */
    createdByUserId?: string;
  },
): Promise<Id<"entityReviewQueue">> {
  return t.run(async (ctx) =>
    ctx.db.insert("entityReviewQueue", {
      selectorOptionId: opts.selectorOptionId,
      batchId: BATCH,
      createdByUserId: opts.createdByUserId ?? "user_review_001",
      kind: opts.kind,
      name: opts.name,
      nameNormalized: normalizeTeamName(opts.name),
      sportId: opts.sportId,
      status: "ready",
      ...(opts.decision ? { decision: opts.decision as never } : {}),
      ...(opts.enrichment ? { enrichment: opts.enrichment as never } : {}),
      ...(opts.source ? { source: opts.source } : {}),
    }),
  );
}

/** Every `teams` row, by its composed identity key, for whole-table claims. */
async function allTeams(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => ctx.db.query("teams").collect());
}

/**
 * NEO-331: a league NAME on a decision (the operator's `leagueName`, the
 * enrichment's suggestion) is LINK-ONLY at commit — it never mints a league,
 * because a league requires a level. Tests whose point is the PRECEDENCE
 * between names seed the league so the name has something to link.
 */
async function seedLeagueNamed(
  t: ReturnType<typeof convexTest>,
  sportId: Id<"selectorOptions">,
  name: string,
  level: "major" | "other" = "other",
): Promise<Id<"leagues">> {
  return t.run(async (ctx) =>
    ctx.db.insert("leagues", {
      name,
      nameNormalized: name.toLowerCase(),
      sportId,
      level,
      lastUpdated: Date.now(),
    }),
  );
}

async function leagueNameOf(
  t: ReturnType<typeof convexTest>,
  leagueId: Id<"leagues"> | undefined,
): Promise<string | undefined> {
  if (!leagueId) return undefined;
  return t.run(async (ctx) => (await ctx.db.get(leagueId))?.name);
}

/**
 * The `players` row with this display name.
 *
 * Looked up by `name` rather than by `nameNormalized`, because the prelude's
 * normaliser TOKEN-SORTS: "Travis Bazzana" is stored under "bazzana travis",
 * and a fixture that hard-coded the readable order would silently find
 * nothing.
 */
async function playerNamed(t: ReturnType<typeof convexTest>, name: string) {
  return t.run(async (ctx) => {
    const rows = await ctx.db.query("players").collect();
    return rows.find((row) => row.name === name) ?? null;
  });
}

// ===========================================================================
// The sequence Jason asked for, end to end
// ===========================================================================


// ===========================================================================
// The old shape still commits exactly as before
// ===========================================================================


// ===========================================================================
// NEO-236 security review, finding 1 — the prelude re-checks the stored league
// ===========================================================================


// ===========================================================================
// NEO-307 — the past-era allowance is for CARDS, never for a career stint
// ===========================================================================


// ===========================================================================
// NEO-307 — a career-team create whose name exactly one team holds as an
// alias becomes a link to that team (Jason's call), never a refusal
// ===========================================================================

describe("NEO-307: a career team held as an alias by ONE team links to it, and the player saves", () => {
  /** A team plus its alias index rows, as `syncTeamAliases` would leave them. */
  async function insertAliasedTeam(
    t: ReturnType<typeof convexTest>,
    sportId: Id<"selectorOptions">,
    opts: { location: string; name: string; aliases?: string[]; from?: number },
  ): Promise<Id<"teams">> {
    return t.run(async (ctx) => {
      const id = await ctx.db.insert("teams", {
        location: opts.location,
        name: opts.name,
        nameNormalized: normalizeTeamName(`${opts.location} ${opts.name}`),
        sportId,
        ...(opts.aliases?.length ? { aliases: opts.aliases } : {}),
        ...(opts.from !== undefined ? { yearsActive: { from: opts.from } } : {}),
        lastUpdated: Date.now(),
      });
      for (const alias of opts.aliases ?? []) {
        await ctx.db.insert("teamAliases", {
          teamId: id,
          sportId,
          aliasNormalized: normalizeTeamName(alias),
        });
      }
      return id;
    });
  }

  /** Pee Wee Reese, whose Wikidata career is one Brooklyn Dodgers stint. */
  async function reeseRow(
    t: ReturnType<typeof convexTest>,
    variantTypeId: Id<"selectorOptions">,
    sportId: Id<"selectorOptions">,
  ) {
    return insertReviewRow(t, {
      selectorOptionId: variantTypeId,
      sportId,
      kind: "player",
      name: "Pee Wee Reese",
      // `recordDecision` is called for real here, so the row must belong to
      // the calling operator.
      createdByUserId: ADMIN_IDENTITY.subject,
      enrichment: {
        careerTeams: [{ name: "Brooklyn Dodgers", fromYear: 1940, toYear: 1957 }],
      },
    });
  }

  const BROOKLYN_CREATE = [
    { sourceName: "Brooklyn Dodgers", location: "Brooklyn", name: "Dodgers" },
  ];

  const commitReese = (
    asAdmin: ReturnType<ReturnType<typeof convexTest>["withIdentity"]>,
    variantTypeId: Id<"selectorOptions">,
    sportId: Id<"selectorOptions">,
  ) =>
    asAdmin.action(api.selectorOptions.commitCardChecklist, {
      selectorOptionId: variantTypeId,
      sportId,
      cards: [makeCard({ cardName: "Pee Wee Reese", players: ["Pee Wee Reese"] })],
      batchId: BATCH,
    });


  test("TWO holders: still refused — never guess between them — and nothing is recorded", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { variantTypeId, sportId } = await seedTree(t);
    await insertAliasedTeam(t, sportId, {
      location: "Los Angeles",
      name: "Dodgers",
      aliases: ["Brooklyn Dodgers"],
    });
    await insertAliasedTeam(t, sportId, {
      location: "Brooklyn",
      name: "Robins",
      aliases: ["Brooklyn Dodgers"],
    });
    const rowId = await reeseRow(t, variantTypeId, sportId);

    await expect(
      asAdmin.mutation(api.entityReviewQueue.recordDecision, {
        reviewRowId: rowId,
        action: "create",
        createTeams: BROOKLYN_CREATE,
      }),
    ).rejects.toThrow(/already answers to this name as an alias/);
    expect((await t.run((ctx) => ctx.db.get(rowId)))!.decision).toBeUndefined();
  });


});
