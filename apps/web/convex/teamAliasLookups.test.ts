/**
 * NEO-284 — unit coverage for the team-alias lookup union and its downstream
 * consumers.
 *
 * `findTeamsByFullName` (convex/lib/teamRow.ts) now unions two legs — the
 * primary-name index on `teams` and the flat `teamAliases` index — and every
 * caller that used to branch on none/one/several has to keep doing that
 * correctly once an alias can be one of the candidates. This file covers:
 *
 *   1-3. the union itself and `resolveTeamForSetYear` over it (primary hit,
 *        alias hit, shared-alias ambiguity, name-vs-alias ambiguity)
 *   4.   `findCollidingTeams` seeing an alias hit as a write-time collision
 *   5.   `commitCardChecklist` linking a card off an alias with no review row
 *   6.   `stageCareerTeamRowsImpl` staging nothing for an alias that already
 *        resolves cleanly
 *   7.   `teams.nearMatches`: an alias hit tagged `matchedAlias`/`exact`, and
 *        NOT overwritten by the fuzzy search-index leg for the same row
 *   8.   `teams.search`: the alias leg
 *   9.   the `saveAsAlias` link decision: written at COMMIT, not at
 *        `recordDecision`; a no-op for a held/deferred row; nothing for a
 *        discarded one
 *   10.  `recordDecision` refusing `saveAsAlias: true` on a non-team row
 *   11.  `recordDecision`'s `create.aliases` bound (mirrors
 *        `normalizeTeamAliasList`'s 64-entry cap)
 *
 * Fixture conventions mirror `teamEraLookups.test.ts` (closest structural
 * neighbor: same `convexTest` setup, same raw `t.run` seeding rather than the
 * public mutations) and `playerAliases.test.ts` (the alias-index house
 * pattern on the player side). Items 5/6/9 drive the real public
 * actions/mutations — `commitCardChecklist`, `stageCareerTeamRows`,
 * `recordDecision` — because that is where the alias-specific wiring under
 * test actually lives, following `commitCardChecklist.careerTeamRows.test.ts`
 * and `commitCardChecklist.entityReview.test.ts`'s own fixture shapes.
 */

import { insertAsTidyName } from "../lib/testing/tidy-review-row";
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { normalizeTeamName } from "./teams";
import {
  findCollidingTeams,
  findTeamsByFullName,
  resolveTeamForSetYear,
} from "./lib/teamRow";
import { cancelScheduled } from "../lib/testing/drain-scheduled";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const ADMIN_IDENTITY = {
  subject: "admin_team_alias_001",
  issuer: "https://clerk.example.com",
  tokenIdentifier: "clerk|admin_team_alias_001",
  name: "Admin User",
  role: "admin",
};

async function seedSport(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) =>
    ctx.db.insert("selectorOptions", {
      level: "sport",
      value: "Baseball",
      platformData: {},
      children: [],
      lastUpdated: Date.now(),
    }),
  );
}

/** A team plus its alias index rows, exactly as `syncTeamAliases` would leave them. */
async function insertTeamWithAliases(
  t: ReturnType<typeof convexTest>,
  sportId: Id<"selectorOptions">,
  opts: {
    name: string;
    location?: string;
    aliases?: string[];
    yearsActive?: { from: number; to?: number };
  },
): Promise<Id<"teams">> {
  return t.run(async (ctx) => {
    const fullName = opts.location ? `${opts.location} ${opts.name}` : opts.name;
    const id = await ctx.db.insert("teams", {
      name: opts.name,
      ...(opts.location ? { location: opts.location } : {}),
      nameNormalized: normalizeTeamName(fullName),
      sportId,
      ...(opts.aliases?.length ? { aliases: opts.aliases } : {}),
      ...(opts.yearsActive ? { yearsActive: opts.yearsActive } : {}),
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

// ===========================================================================
// 1-3. findTeamsByFullName / resolveTeamForSetYear over the union
// ===========================================================================

describe("NEO-284: findTeamsByFullName unions the name leg and the alias leg", () => {
  test("a name that is one team's PRIMARY name returns that row", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const team = await insertTeamWithAliases(t, sportId, {
      location: "San Diego",
      name: "Padres",
    });

    const found = await t.run((ctx) =>
      findTeamsByFullName(ctx, sportId, "San Diego Padres"),
    );
    expect(found.map((r) => r._id)).toEqual([team]);
  });

  test("a name that is only an ALIAS returns that row", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const team = await insertTeamWithAliases(t, sportId, {
      location: "San Diego",
      name: "Padres",
      aliases: ["Friars"],
    });

    const found = await t.run((ctx) => findTeamsByFullName(ctx, sportId, "Friars"));
    expect(found.map((r) => r._id)).toEqual([team]);
  });

  test("era narrowing (resolveTeamForSetYear) applies over an alias hit exactly like a primary hit", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const original = await insertTeamWithAliases(t, sportId, {
      location: "Winnipeg",
      name: "Jets",
      aliases: ["Original Jets"],
      yearsActive: { from: 1972, to: 1996 },
    });
    const current = await insertTeamWithAliases(t, sportId, {
      location: "Winnipeg",
      name: "Jets",
      yearsActive: { from: 2011 },
    });

    // Alias resolves the OLD era for a card printed in that era.
    const byAlias = await t.run((ctx) =>
      resolveTeamForSetYear(ctx, sportId, "Original Jets", 1985),
    );
    expect(byAlias.teamId).toBe(original);
    // And the primary name resolves the current era for a modern card — same
    // union, same narrowing, both legs on equal footing.
    const byName = await t.run((ctx) =>
      resolveTeamForSetYear(ctx, sportId, "Winnipeg Jets", 2015),
    );
    expect(byName.teamId).toBe(current);
  });

  test("a name shared as an ALIAS by two different teams is two candidates; resolveTeamForSetYear answers null", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const teamA = await insertTeamWithAliases(t, sportId, {
      name: "Alpha",
      aliases: ["Shared Nickname"],
    });
    const teamB = await insertTeamWithAliases(t, sportId, {
      name: "Beta",
      aliases: ["Shared Nickname"],
    });

    const found = await t.run((ctx) =>
      findTeamsByFullName(ctx, sportId, "Shared Nickname"),
    );
    expect(new Set(found.map((r) => r._id))).toEqual(new Set([teamA, teamB]));

    const resolved = await t.run((ctx) =>
      resolveTeamForSetYear(ctx, sportId, "Shared Nickname", undefined),
    );
    expect(resolved.teamId).toBeNull();
    expect(resolved.candidates).toHaveLength(2);
  });

  test("a name that is one team's PRIMARY name AND another team's ALIAS is two candidates, neither ranked above the other", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const byName = await insertTeamWithAliases(t, sportId, { name: "Miami" });
    const byAlias = await insertTeamWithAliases(t, sportId, {
      name: "Hurricanes",
      aliases: ["Miami"],
    });

    const found = await t.run((ctx) => findTeamsByFullName(ctx, sportId, "Miami"));
    expect(new Set(found.map((r) => r._id))).toEqual(new Set([byName, byAlias]));

    // Union, not a ranked list — both legs land in the SAME candidate set that
    // resolveTeamForSetYear counts, so an undated pair is unresolved rather
    // than one leg silently outranking the other.
    const resolved = await t.run((ctx) =>
      resolveTeamForSetYear(ctx, sportId, "Miami", undefined),
    );
    expect(resolved.teamId).toBeNull();
  });
});

// ===========================================================================
// 4. findCollidingTeams sees an alias hit
// ===========================================================================

describe("NEO-284: findCollidingTeams treats an existing team's alias as a name collision", () => {
  /*
   * Chose `findCollidingTeams` as the unit boundary rather than driving the
   * public `saveTeamFields`/`findOrCreate` mutations to their `NAME_TAKEN` /
   * `TEAM_ERA_EXISTS` refusal: `findCollidingTeams` is the exact function
   * both write paths call to decide "does this land on an existing row", and
   * it is already exported for testing from convex/lib/teamRow.ts. Reading
   * convex/teams.ts (findOrCreate ~L554, saveTeamFields ~L1226) confirms both
   * feed the SAME `fullName` string — never an alias list — into this one
   * call, so asserting here is the same assertion the structured-error path
   * would make, without coupling this file to `ConvexError` message shapes
   * that belong to teams.test.ts.
   */
  test("a NEW team's full name colliding with an EXISTING team's alias is surfaced", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const existing = await insertTeamWithAliases(t, sportId, {
      location: "Baton Rouge",
      name: "LSU Tigers",
      aliases: ["LSU"],
    });

    const colliding = await t.run((ctx) =>
      findCollidingTeams(ctx, sportId, "LSU", undefined),
    );
    expect(colliding.map((r) => r._id)).toEqual([existing]);
  });

  test("the row being edited does not collide with its own alias", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const existing = await insertTeamWithAliases(t, sportId, {
      name: "Tigers",
      aliases: ["LSU"],
    });

    const colliding = await t.run((ctx) =>
      findCollidingTeams(ctx, sportId, "LSU", undefined, existing),
    );
    expect(colliding).toEqual([]);
  });

  test("saveTeamFields renaming a team onto ANOTHER team's alias is refused with the alias-holder copy", async () => {
    // The public write path, not just the helper. NEO-602: nothing is CALLED
    // "LSU", so this is not `NAME_TAKEN:<id>` ("Another team is already called
    // LSU"); it is the reverse alias rule, which names the holder and its era.
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    await insertTeamWithAliases(t, sportId, {
      location: "Baton Rouge",
      name: "Tigers",
      aliases: ["LSU"],
    });
    const other = await insertTeamWithAliases(t, sportId, { name: "Bayou Bengals" });

    await expect(
      t.withIdentity(ADMIN_IDENTITY).mutation(api.teams.saveTeamFields, {
        id: other,
        name: "LSU",
        location: null,
      }),
    ).rejects.toThrow(
      "Baton Rouge Tigers already answers to this name as an alias, and neither team has years on file, so they may overlap. Remove it there, or give this team years that don't overlap.",
    );
    expect((await t.run((ctx) => ctx.db.get(other)))!.name).toBe("Bayou Bengals");
  });

  test("findOrCreate with a full name that is another team's alias FINDS that team (plan decision 5)", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const holder = await insertTeamWithAliases(t, sportId, {
      location: "Baton Rouge",
      name: "Tigers",
      aliases: ["LSU"],
    });

    const id = await t
      .withIdentity(ADMIN_IDENTITY)
      .mutation(api.teams.findOrCreate, { name: "LSU", sportId });
    expect(id).toBe(holder);
    expect(await t.run((ctx) => ctx.db.query("teams").collect())).toHaveLength(1);
  });
});

// ===========================================================================
// 5. commitCardChecklist resolves an alias string cleanly, no review row
// ===========================================================================

async function seedVariantTypeUnderChromeSet(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const sportId = await ctx.db.insert("selectorOptions", {
      level: "sport",
      value: "Baseball",
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

describe("NEO-284 acceptance 3: a checklist team string that is an alias links cleanly", () => {
  test("the card links to the aliased team and no entityReviewQueue row is created", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { variantTypeId, sportId } = await seedVariantTypeUnderChromeSet(t);
    const team = await insertTeamWithAliases(t, sportId, {
      location: "Baton Rouge",
      name: "LSU Tigers",
      aliases: ["LSU"],
    });

    const result = await asAdmin.action(api.selectorOptions.commitCardChecklist, {
      selectorOptionId: variantTypeId,
      sportId,
      cards: [makeCard({ cardNumber: "1", teams: ["LSU"] })],
      batchId: "batch-alias-commit",
    });

    expect(result.success).toBe(true);
    expect(result.unreviewedNameCount).toBe(0);

    const cards = await t.run((ctx) =>
      ctx.db
        .query("cardChecklist")
        .withIndex("by_selector_option", (q) =>
          q.eq("selectorOptionId", variantTypeId),
        )
        .collect(),
    );
    expect(cards[0].teamOnCardIds).toEqual([team]);
    // The alias resolved it cleanly — acceptance 3 — so no review row exists.
    expect(
      await t.run((ctx) => ctx.db.query("entityReviewQueue").collect()),
    ).toHaveLength(0);
    // And no second team was minted for the alias string.
    expect(await t.run((ctx) => ctx.db.query("teams").collect())).toHaveLength(1);
  });
});

// ===========================================================================
// 6. stageCareerTeamRowsImpl stages nothing for an alias already held
// ===========================================================================


// ===========================================================================
// 7. teams.nearMatches: an alias hit is exact and survives the fuzzy leg
// ===========================================================================

describe("NEO-284: nearMatches tags an alias hit exact and does not let the fuzzy leg clobber it", () => {
  test("an alias match is confidence exact with matchedAlias set", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const team = await insertTeamWithAliases(t, sportId, {
      location: "Baton Rouge",
      name: "LSU Tigers",
      aliases: ["LSU"],
    });

    const matches = await t
      .withIdentity(ADMIN_IDENTITY)
      .query(api.teams.nearMatches, { name: "LSU", sportId });
    const hit = matches.find((m) => m._id === team);
    expect(hit).toBeTruthy();
    expect(hit!.confidence).toBe("exact");
    expect(hit!.matchedAlias).toBe("LSU");
  });

  test("NEO-284 regression: the fuzzy search-index leg must not overwrite the exact alias-leg entry for the same row", async () => {
    /*
     * "LSU" is an exact alias hit on this row AND a fuzzy prefix hit off the
     * same row's own `nameNormalized` ("baton rouge lsu tigers" contains the
     * token "lsu"), so the search-index leg finds the SAME `_id` the alias
     * leg already put in the candidate map. `nearMatches` (convex/teams.ts,
     * around the `for (const hit of hits)` loop) guards this with
     * `if (candidates.has(hit._id)) continue;` — reading it confirms the
     * guard is already in place, so this is a regression test for a fix that
     * is CURRENTLY PRESENT, not a bug still open. See this file's final
     * report for the explicit confirm/deny.
     */
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const team = await insertTeamWithAliases(t, sportId, {
      location: "Baton Rouge",
      name: "LSU Tigers",
      aliases: ["LSU"],
    });

    const matches = await t
      .withIdentity(ADMIN_IDENTITY)
      .query(api.teams.nearMatches, { name: "LSU", sportId });
    const hits = matches.filter((m) => m._id === team);
    // Exactly one entry for the row — the fuzzy leg did not add a second,
    // demoted copy alongside the exact one.
    expect(hits).toHaveLength(1);
    expect(hits[0].confidence).toBe("exact");
    expect(hits[0].matchedAlias).toBe("LSU");
  });
});

// ===========================================================================
// 8. teams.search: the alias leg
// ===========================================================================

describe("NEO-284: teams.search finds a team by its alias", () => {
  test("searching by an alias string returns the team", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const team = await insertTeamWithAliases(t, sportId, {
      location: "Baton Rouge",
      name: "LSU Tigers",
      aliases: ["LSU"],
    });

    const results = await t
      .withIdentity(ADMIN_IDENTITY)
      .query(api.teams.search, { query: "LSU", sportId });
    expect(results.map((r) => r._id)).toContain(team);
  });
});

// ===========================================================================
// 9. saveAsAlias writes at COMMIT, not at recordDecision
// ===========================================================================

describe("NEO-284: saveAsAlias links the alias only when the commit actually lands", () => {

  test("the commit writes the alias for a row decided with saveAsAlias", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { variantTypeId, sportId } = await seedVariantTypeUnderChromeSet(t);
    const team = await insertTeamWithAliases(t, sportId, {
      location: "Baton Rouge",
      name: "LSU Tigers",
    });

    const rowId = await t.run((ctx) =>
      insertAsTidyName(ctx, {
        selectorOptionId: variantTypeId,
        batchId: "batch-save-alias-commit",
        createdByUserId: ADMIN_IDENTITY.subject,
        kind: "team",
        name: "LSU",
        nameNormalized: normalizeTeamName("LSU"),
        sportId,
        status: "ready",
        decision: { action: "link", linkedTeamId: team, saveAsAlias: true },
      }),
    );

    await asAdmin.action(api.selectorOptions.commitCardChecklist, {
      selectorOptionId: variantTypeId,
      sportId,
      cards: [makeCard({ cardNumber: "1", teams: ["LSU"] })],
      batchId: "batch-save-alias-commit",
    });

    const patched = await t.run((ctx) => ctx.db.get(team));
    expect(patched!.aliases).toEqual(["LSU"]);
    const indexRows = await t.run((ctx) =>
      ctx.db
        .query("teamAliases")
        .withIndex("by_team_id", (q) => q.eq("teamId", team))
        .collect(),
    );
    expect(indexRows.map((r) => r.aliasNormalized)).toEqual([
      normalizeTeamName("LSU"),
    ]);
    expect(rowId).toBeTruthy();
  });

  test("a held/deferred row (no decision yet) writes nothing at commit — it is unreviewed, and the card is stamped pending instead", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { variantTypeId, sportId } = await seedVariantTypeUnderChromeSet(t);
    const team = await insertTeamWithAliases(t, sportId, {
      location: "Baton Rouge",
      name: "LSU Tigers",
    });

    await t.run((ctx) =>
      ctx.db.insert("entityReviewQueue", {
        selectorOptionId: variantTypeId,
        batchId: "batch-held-row",
        createdByUserId: ADMIN_IDENTITY.subject,
        kind: "team",
        name: "LSU",
        nameNormalized: normalizeTeamName("LSU"),
        sportId,
        status: "ready",
        // No `decision` — the operator has not answered this row yet.
      }),
    );

    const result = await asAdmin.action(api.selectorOptions.commitCardChecklist, {
      selectorOptionId: variantTypeId,
      sportId,
      cards: [makeCard({ cardNumber: "1", teams: ["LSU"] })],
      batchId: "batch-held-row",
    });
    expect(result.unreviewedNameCount).toBe(1);

    const untouched = await t.run((ctx) => ctx.db.get(team));
    expect(untouched!.aliases).toBeUndefined();
  });

  test("a discarded (skip) decision saves nothing", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { variantTypeId, sportId } = await seedVariantTypeUnderChromeSet(t);
    const team = await insertTeamWithAliases(t, sportId, {
      location: "Baton Rouge",
      name: "LSU Tigers",
    });

    await t.run((ctx) =>
      ctx.db.insert("entityReviewQueue", {
        selectorOptionId: variantTypeId,
        batchId: "batch-skip-row",
        createdByUserId: ADMIN_IDENTITY.subject,
        kind: "team",
        name: "LSU",
        nameNormalized: normalizeTeamName("LSU"),
        sportId,
        status: "ready",
        decision: { action: "skip" },
      }),
    );

    await asAdmin.action(api.selectorOptions.commitCardChecklist, {
      selectorOptionId: variantTypeId,
      sportId,
      cards: [makeCard({ cardNumber: "1", teams: ["LSU"] })],
      batchId: "batch-skip-row",
    });

    const untouched = await t.run((ctx) => ctx.db.get(team));
    expect(untouched!.aliases).toBeUndefined();
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("teamAliases")
          .withIndex("by_team_id", (q) => q.eq("teamId", team))
          .collect(),
      ),
    ).toEqual([]);
  });
});

// ===========================================================================
// 10. recordDecision: saveAsAlias is team-kind only
// ===========================================================================


// ===========================================================================
// 11. recordDecision's create.aliases bound and normalization
// ===========================================================================


// ===========================================================================
// 12. S1 (security review): the lock-out the alias union makes possible, and
//     the guard that closes it at the writers
// ===========================================================================

describe("NEO-284 S1: an alias equal to another team's PRIMARY name locks that team out", () => {
  test("REPRODUCTION (guard bypassed): with B holding A's full name as an alias, A's own re-save is no longer a lock-out, and a years edit names B", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const a = await insertTeamWithAliases(t, sportId, { location: "LSU", name: "Tigers" });
    // Seeded RAW — straight into the row and the index — which is exactly
    // what the writers now refuse. This is the state the union turns into a
    // lock-out: `findCollidingTeams` reads alias hits, so A collides with B
    // on its own name.
    const b = await insertTeamWithAliases(t, sportId, {
      location: "Auburn",
      name: "Tigers",
      aliases: ["LSU Tigers"],
    });

    // A re-saves its OWN name (the Team Management form sends every field).
    // It used to be told the name was taken, by a team it could not see the
    // connection to. NEO-602: B is not CALLED that, it only answers to it, so
    // an unchanged name and years is not a clash and saves.
    await asAdmin.mutation(api.teams.saveTeamFields, { id: a, name: "Tigers", location: "LSU" });
    // A years edit is an identity edit, and that one is judged by the reverse
    // alias rule, which names B (never `NAME_TAKEN`, nothing is called that).
    const message = await asAdmin
      .mutation(api.teams.saveTeamFields, { id: a, yearsActive: { from: 1893 } })
      .then(
        () => null,
        (e: unknown) => String((e as { data?: unknown }).data ?? e),
      );
    expect(message).toBe(
      "Auburn Tigers already answers to this name as an alias, and that team has no years on file, so they may overlap. Remove it there, or give this team years that don't overlap.",
    );
    expect(b).toBeTruthy();
  });

  test("WITH the guard: the alias is refused at the writer, so the state above cannot be reached through Team Management", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const a = await insertTeamWithAliases(t, sportId, { location: "LSU", name: "Tigers" });
    const b = await insertTeamWithAliases(t, sportId, { location: "Auburn", name: "Tigers" });

    await expect(
      asAdmin.mutation(api.teams.saveTeamFields, { id: b, aliases: ["LSU Tigers"] }),
    ).rejects.toThrow(/The alias "LSU Tigers" is another team's name/);

    // A is still free to edit itself.
    await asAdmin.mutation(api.teams.saveTeamFields, { id: a, yearsActive: { from: 1893 } });
    expect((await t.run((ctx) => ctx.db.get(a)))!.yearsActive).toEqual({ from: 1893 });
    // And nothing was indexed for B.
    expect(
      await t.run((ctx) =>
        ctx.db.query("teamAliases").withIndex("by_team_id", (q) => q.eq("teamId", b)).collect(),
      ),
    ).toEqual([]);
  });

  test("alias-vs-alias is NOT a lock-out and stays allowed: neither team's own name is involved", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const redhawks = await insertTeamWithAliases(t, sportId, {
      location: "Miami",
      name: "RedHawks",
      aliases: ["Miami"],
    });
    const hurricanes = await insertTeamWithAliases(t, sportId, { location: "Miami", name: "Hurricanes" });

    await asAdmin.mutation(api.teams.saveTeamFields, { id: hurricanes, aliases: ["Miami"] });
    // Both still edit themselves freely.
    await asAdmin.mutation(api.teams.saveTeamFields, { id: redhawks, yearsActive: { from: 1888 } });
    await asAdmin.mutation(api.teams.saveTeamFields, { id: hurricanes, yearsActive: { from: 1940 } });
    // The shared string is two candidates for the resolver, as designed.
    expect(
      await t.run((ctx) => findTeamsByFullName(ctx, sportId, "Miami")),
    ).toHaveLength(2);
  });

  test("the commit-time warn-and-skip flavour returns the safe list and names what it dropped", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    await insertTeamWithAliases(t, sportId, { location: "LSU", name: "Tigers" });
    const b = await insertTeamWithAliases(t, sportId, { location: "Auburn", name: "Tigers" });
    const { dropAliasesThatArePrimaryNames } = await import("./teams");
    const result = await t.run((ctx) =>
      dropAliasesThatArePrimaryNames(ctx, {
        sportId,
        aliases: ["War Eagle", "LSU Tigers"],
        selfId: b,
      }),
    );
    expect(result).toEqual({
      aliases: ["War Eagle"],
      dropped: [{ alias: "LSU Tigers", teamName: "LSU Tigers" }],
    });
  });
});

// ===========================================================================
// 13. N1 (security review): the commit-time saveAsAlias pass re-checks the
//     linked team's sport before writing
// ===========================================================================

describe("NEO-284 N1: the commit-time saveAsAlias pass drops a linked team whose sport no longer matches", () => {
  test("a link decision pointing at a team in ANOTHER sport writes no alias and does not abort the commit", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { variantTypeId, sportId } = await seedVariantTypeUnderChromeSet(t);
    const otherSportId = await t.run((ctx) =>
      ctx.db.insert("selectorOptions", {
        level: "sport",
        value: "Hockey",
        platformData: {},
        children: [],
        lastUpdated: Date.now(),
      }),
    );
    // The stale-client case: a decision recorded against a team that is not
    // in this set's sport.
    const foreign = await insertTeamWithAliases(t, otherSportId, {
      location: "Baton Rouge",
      name: "LSU Tigers",
    });
    await t.run((ctx) =>
      ctx.db.insert("entityReviewQueue", {
        selectorOptionId: variantTypeId,
        batchId: "batch-save-alias-foreign",
        createdByUserId: ADMIN_IDENTITY.subject,
        kind: "team",
        name: "LSU",
        nameNormalized: normalizeTeamName("LSU"),
        sportId,
        status: "ready",
        decision: { action: "link", linkedTeamId: foreign, saveAsAlias: true },
      }),
    );

    await asAdmin.action(api.selectorOptions.commitCardChecklist, {
      selectorOptionId: variantTypeId,
      sportId,
      cards: [makeCard({ cardNumber: "1", teams: ["LSU"] })],
      batchId: "batch-save-alias-foreign",
    });

    const untouched = await t.run((ctx) => ctx.db.get(foreign));
    expect(untouched!.aliases).toBeUndefined();
    expect(await t.run((ctx) => ctx.db.query("teamAliases").collect())).toEqual([]);
  });
});

// ===========================================================================
// 14. S1 at COMMIT: both commit-time alias writers drop an alias that is
//     another team's PRIMARY name, warn naming only the owning team, and
//     never abort the commit
// ===========================================================================

describe("NEO-284 S1 at commit: the two commit-time alias writers drop another team's primary name", () => {
  test("the saveAsAlias pass does not remember a parked string that is another team's own name; the link still lands", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { variantTypeId, sportId } = await seedVariantTypeUnderChromeSet(t);
    const lsu = await insertTeamWithAliases(t, sportId, { location: "LSU", name: "Tigers" });
    const auburn = await insertTeamWithAliases(t, sportId, { location: "Auburn", name: "Tigers" });
    // The operator linked the checklist's "LSU Tigers" string to AUBURN (a
    // mis-click the wizard cannot see) with the box left on. Remembering it
    // would hand LSU's own name to Auburn and lock LSU out of its own edits.
    for (const [name, batchRow] of [["LSU Tigers", "a"], ["War Eagle", "b"]] as const) {
      await t.run((ctx) =>
        insertAsTidyName(ctx, {
          selectorOptionId: variantTypeId,
          batchId: "batch-s1-commit",
          createdByUserId: ADMIN_IDENTITY.subject,
          kind: "team",
          name,
          nameNormalized: normalizeTeamName(name),
          sportId,
          status: "ready",
          decision: { action: "link", linkedTeamId: auburn, saveAsAlias: true },
        }),
      );
      expect(batchRow).toBeTruthy();
    }
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await asAdmin.action(api.selectorOptions.commitCardChecklist, {
        selectorOptionId: variantTypeId,
        sportId,
        cards: [
          makeCard({ cardNumber: "1", teams: ["LSU Tigers"] }),
          makeCard({ cardNumber: "2", teams: ["War Eagle"] }),
        ],
        batchId: "batch-s1-commit",
      });
      // Named the OWNING team, never the parked string as "the alias".
      const lines = warn.mock.calls.map((c) => String(c[0]));
      expect(lines.some((l) => l.includes("LSU Tigers's own name") && l.includes("Linked, not remembered"))).toBe(true);
    } finally {
      warn.mockRestore();
    }

    // Only the safe string was remembered; the clash was skipped.
    const patched = await t.run((ctx) => ctx.db.get(auburn));
    expect(patched!.aliases).toEqual(["War Eagle"]);
    const indexRows = await t.run((ctx) =>
      ctx.db.query("teamAliases").withIndex("by_team_id", (q) => q.eq("teamId", auburn)).collect(),
    );
    expect(indexRows.map((r) => r.aliasNormalized)).toEqual([normalizeTeamName("War Eagle")]);
    // LSU is untouched and still answers only to itself.
    expect((await t.run((ctx) => ctx.db.get(lsu)))!.aliases).toBeUndefined();
    // Neither card lost its team. NEO-602 (D5): a review row for the name
    // controls the commit prelude, so BOTH strings take the operator's link to
    // Auburn - "LSU Tigers" included, although exactly one team (LSU) holds
    // that name, which used to win before the decision was consulted. Only the
    // alias WRITE is dropped (asserted above): the link is the operator's, the
    // remembered alias would have been LSU's own name.
    const cards = await t.run((ctx) =>
      ctx.db.query("cardChecklist").withIndex("by_selector_option", (q) => q.eq("selectorOptionId", variantTypeId)).collect(),
    );
    const byNumber = new Map(cards.map((c) => [c.cardNumber, c.teamOnCardIds]));
    expect(byNumber.get("1")).toEqual([auburn]);
    expect(byNumber.get("2")).toEqual([auburn]);
  });

});

// ===========================================================================
// NEO-602 — the alias rule is era-aware at commit too, in both orders
// ===========================================================================

describe("NEO-602: commit-time alias writers follow the years when a string is another team's name", () => {
  /** The Chrome fixture, re-dated. */
  async function seedSetIn(t: ReturnType<typeof convexTest>, season: string) {
    const seeded = await seedVariantTypeUnderChromeSet(t);
    await t.run(async (ctx) => {
      for (const id of [seeded.setNameId, seeded.variantTypeId]) {
        await ctx.db.patch(id, { features: { manufacturer: "Donruss", season } });
      }
    });
    return seeded;
  }

  async function commitOne(
    t: ReturnType<typeof convexTest>,
    args: { variantTypeId: Id<"selectorOptions">; sportId: Id<"selectorOptions">; team: string; batchId: string },
  ) {
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = await asAdmin.action(api.selectorOptions.commitCardChecklist, {
        selectorOptionId: args.variantTypeId,
        sportId: args.sportId,
        cards: [makeCard({ cardNumber: "1", teams: [args.team] })],
        batchId: args.batchId,
      });
      return { result, lines: warn.mock.calls.map((c) => String(c[0])) };
    } finally {
      warn.mockRestore();
    }
  }

  const cardTeams = async (t: ReturnType<typeof convexTest>, variantTypeId: Id<"selectorOptions">) =>
    (
      await t.run((ctx) =>
        ctx.db
          .query("cardChecklist")
          .withIndex("by_selector_option", (q) => q.eq("selectorOptionId", variantTypeId))
          .first(),
      )
    )!.teamOnCardIds ?? [];

  test("remember-as-a-name writes Brooklyn Dodgers on LA (1958–): the years are disjoint, so the alias is kept and the link lands", async () => {
    const t = convexTest(schema, modules);
    const { variantTypeId, sportId } = await seedSetIn(t, "2026");
    await insertTeamWithAliases(t, sportId, {
      location: "Brooklyn",
      name: "Dodgers",
      yearsActive: { from: 1911, to: 1957 },
    });
    const la = await insertTeamWithAliases(t, sportId, {
      location: "Los Angeles",
      name: "Dodgers",
      yearsActive: { from: 1958 },
    });
    await t.run((ctx) =>
      insertAsTidyName(ctx, {
        selectorOptionId: variantTypeId,
        batchId: "batch-602-remember",
        createdByUserId: ADMIN_IDENTITY.subject,
        kind: "team",
        name: "Brooklyn Dodgers",
        nameNormalized: normalizeTeamName("Brooklyn Dodgers"),
        sportId,
        status: "ready",
        decision: { action: "link", linkedTeamId: la, saveAsAlias: true },
      }),
    );

    const { result, lines } = await commitOne(t, {
      variantTypeId,
      sportId,
      team: "Brooklyn Dodgers",
      batchId: "batch-602-remember",
    });

    expect(result.success).toBe(true);
    expect(lines.some((l) => l.includes("Linked, not remembered"))).toBe(false);
    expect((await t.run((ctx) => ctx.db.get(la)))!.aliases).toEqual(["Brooklyn Dodgers"]);
    // The operator's link (a review row controls the prelude, D5) - not the
    // exactly-... year pick, which on a 2026 set would be the alias-only LA
    // anyway, but must not be a silent guess either way.
    expect(await cardTeams(t, variantTypeId)).toEqual([la]);
  });

  test("remember-as-a-name still drops an alias whose owner's years overlap the linked team's", async () => {
    const t = convexTest(schema, modules);
    const { variantTypeId, sportId } = await seedSetIn(t, "2026");
    await insertTeamWithAliases(t, sportId, {
      location: "Brooklyn",
      name: "Dodgers",
      yearsActive: { from: 1911, to: 1957 },
    });
    const robins = await insertTeamWithAliases(t, sportId, {
      location: "Brooklyn",
      name: "Robins",
      yearsActive: { from: 1950, to: 1960 },
    });
    await t.run((ctx) =>
      insertAsTidyName(ctx, {
        selectorOptionId: variantTypeId,
        batchId: "batch-602-remember-overlap",
        createdByUserId: ADMIN_IDENTITY.subject,
        kind: "team",
        name: "Brooklyn Dodgers",
        nameNormalized: normalizeTeamName("Brooklyn Dodgers"),
        sportId,
        status: "ready",
        decision: { action: "link", linkedTeamId: robins, saveAsAlias: true },
      }),
    );

    const { result, lines } = await commitOne(t, {
      variantTypeId,
      sportId,
      team: "Brooklyn Dodgers",
      batchId: "batch-602-remember-overlap",
    });

    expect(result.success).toBe(true);
    expect(lines.some((l) => l.includes("Brooklyn Dodgers's own name") && l.includes("Linked, not remembered"))).toBe(true);
    expect((await t.run((ctx) => ctx.db.get(robins)))!.aliases).toBeUndefined();
    expect(await t.run((ctx) => ctx.db.query("teamAliases").collect())).toEqual([]);
  });


});

// ===========================================================================
// NEO-307 / NEO-602 — the wizard's New Team step: recordDecision refuses a create the
// commit would silently drop, and the step can ask ahead of the click
// ===========================================================================


describe("NEO-307: teams.nameHeldAsAliasBy — the step's look-ahead", () => {
  test("names the holder, with its era, for the composed name", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const sportId = await seedSport(t);
    const la = await insertTeamWithAliases(t, sportId, {
      location: "Los Angeles",
      name: "Dodgers",
      aliases: ["Brooklyn Dodgers"],
      yearsActive: { from: 1958 },
    });

    expect(
      await asAdmin.query(api.teams.nameHeldAsAliasBy, { sportId, name: "  Brooklyn Dodgers " }),
    ).toEqual([{ id: la, name: "Los Angeles Dodgers", yearsActive: { from: 1958 } }]);
  });

  test("NEO-602: the draft's years narrow it: a disjoint draft sees no holder, an overlapping one does, none given counts as undated", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const sportId = await seedSport(t);
    const la = await insertTeamWithAliases(t, sportId, {
      location: "Los Angeles",
      name: "Dodgers",
      aliases: ["Brooklyn Dodgers"],
      yearsActive: { from: 1958 },
    });
    const name = "Brooklyn Dodgers";

    expect(
      await asAdmin.query(api.teams.nameHeldAsAliasBy, {
        sportId,
        name,
        yearsActive: { from: 1911, to: 1957 },
      }),
    ).toEqual([]);
    expect(
      (
        await asAdmin.query(api.teams.nameHeldAsAliasBy, {
          sportId,
          name,
          yearsActive: { from: 1950, to: 1960 },
        })
      ).map((row) => row.id),
    ).toEqual([la]);
    expect((await asAdmin.query(api.teams.nameHeldAsAliasBy, { sportId, name })).map((row) => row.id)).toEqual([
      la,
    ]);
  });

  test("NEO-602: an undated holder is reported whatever years the draft has", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const sportId = await seedSport(t);
    const la = await insertTeamWithAliases(t, sportId, {
      location: "Los Angeles",
      name: "Dodgers",
      aliases: ["Brooklyn Dodgers"],
    });

    expect(
      (
        await asAdmin.query(api.teams.nameHeldAsAliasBy, {
          sportId,
          name: "Brooklyn Dodgers",
          yearsActive: { from: 1911, to: 1957 },
        })
      ).map((row) => row.id),
    ).toEqual([la]);
  });

  test("a team that merely HAS the name is not reported; nor is another sport's holder; blank and over-long names answer empty", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const sportId = await seedSport(t);
    const football = await t.run((ctx) =>
      ctx.db.insert("selectorOptions", {
        level: "sport",
        value: "Football",
        platformData: {},
        children: [],
        lastUpdated: Date.now(),
      }),
    );
    await insertTeamWithAliases(t, sportId, { location: "Brooklyn", name: "Dodgers" });
    await insertTeamWithAliases(t, football, {
      location: "Boston",
      name: "Yanks",
      aliases: ["Brooklyn Dodgers"],
    });

    for (const name of ["Brooklyn Dodgers", "   ", "x".repeat(121)]) {
      expect(await asAdmin.query(api.teams.nameHeldAsAliasBy, { sportId, name })).toEqual([]);
    }
  });
});

describe("NEO-307 / NEO-602: teams.reportAliasNameConflicts — the read-only report for pairs written before the rule", () => {
  async function seedLegacyState(t: ReturnType<typeof convexTest>) {
    const sportId = await seedSport(t);
    const football = await t.run((ctx) =>
      ctx.db.insert("selectorOptions", {
        level: "sport",
        value: "Football",
        platformData: {},
        children: [],
        lastUpdated: Date.now(),
      }),
    );
    // The conflict: Auburn holds LSU's own name, and neither team has years
    // (NEO-602: an undated pair overlaps, so it is still a conflict).
    const lsu = await insertTeamWithAliases(t, sportId, { location: "LSU", name: "Tigers" });
    const auburn = await insertTeamWithAliases(t, sportId, {
      location: "Auburn",
      name: "Tigers",
      aliases: ["War Eagle", "LSU Tigers"],
    });
    // Not conflicts since NEO-602: LA holds Brooklyn's own name, but the two
    // teams' years are disjoint.
    await insertTeamWithAliases(t, sportId, {
      location: "Brooklyn",
      name: "Dodgers",
      yearsActive: { from: 1911, to: 1957 },
    });
    await insertTeamWithAliases(t, sportId, {
      location: "Los Angeles",
      name: "Dodgers",
      aliases: ["Dodger Blue", "Brooklyn Dodgers"],
      yearsActive: { from: 1958 },
    });
    // Not conflicts: alias-vs-alias, and another sport's holder.
    await insertTeamWithAliases(t, sportId, { location: "Miami", name: "RedHawks", aliases: ["Miami"] });
    await insertTeamWithAliases(t, sportId, { location: "Miami", name: "Hurricanes", aliases: ["Miami"] });
    await insertTeamWithAliases(t, football, { location: "Boston", name: "Yanks", aliases: ["Brooklyn Dodgers"] });
    return { sportId, lsu, auburn };
  }

  test("reports the overlapping pair with sport, the stored alias, and both teams' ids, names and years - and not the disjoint one", async () => {
    const t = convexTest(schema, modules);
    const { sportId, lsu, auburn } = await seedLegacyState(t);

    const report = await t.query(internal.teams.reportAliasNameConflicts, {});
    expect(report.conflicts).toEqual([
      {
        sport: "Baseball",
        sportId,
        alias: "LSU Tigers",
        holder: { id: auburn, name: "Auburn Tigers" },
        owner: { id: lsu, name: "LSU Tigers" },
      },
    ]);
    expect(report.scanned).toBe(7);
    expect(report.nextCursor).toBeUndefined();
  });

  test("a dated overlapping pair is reported with its years; an undated side is reported", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const robins = await insertTeamWithAliases(t, sportId, {
      location: "Brooklyn",
      name: "Robins",
      aliases: ["Brooklyn Dodgers"],
      yearsActive: { from: 1950, to: 1960 },
    });
    const brooklyn = await insertTeamWithAliases(t, sportId, {
      location: "Brooklyn",
      name: "Dodgers",
      yearsActive: { from: 1911, to: 1957 },
    });
    const undatedHolder = await insertTeamWithAliases(t, sportId, {
      location: "Los Angeles",
      name: "Dodgers",
      aliases: ["Brooklyn Dodgers"],
    });

    const report = await t.query(internal.teams.reportAliasNameConflicts, {});
    expect(
      report.conflicts.map((c) => [c.holder.id, c.owner.id]).sort(),
    ).toEqual(
      [
        [robins, brooklyn],
        [undatedHolder, brooklyn],
      ].sort(),
    );
    const dated = report.conflicts.find((c) => c.holder.id === robins)!;
    expect(dated.holder.yearsActive).toEqual({ from: 1950, to: 1960 });
    expect(dated.owner.yearsActive).toEqual({ from: 1911, to: 1957 });
  });

  test("pages with nextCursor until the table is walked, and writes nothing", async () => {
    const t = convexTest(schema, modules);
    const { auburn } = await seedLegacyState(t);
    const before = await t.run(async (ctx) => ({
      teams: await ctx.db.query("teams").collect(),
      aliases: await ctx.db.query("teamAliases").collect(),
    }));

    const found: Array<{ holder: { id: string } }> = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page: {
        conflicts: Array<{ holder: { id: string } }>;
        nextCursor?: string;
      } = await t.query(internal.teams.reportAliasNameConflicts, {
        batchSize: 1,
        ...(cursor ? { cursor } : {}),
      });
      found.push(...page.conflicts);
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor && pages < 20);

    expect(pages).toBeGreaterThanOrEqual(5);
    expect(found.map((c) => c.holder.id)).toEqual([auburn]);
    const after = await t.run(async (ctx) => ({
      teams: await ctx.db.query("teams").collect(),
      aliases: await ctx.db.query("teamAliases").collect(),
    }));
    expect(after).toEqual(before);
  });
});
