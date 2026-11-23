/**
 * NEO-236 — a career team the batch would have to CREATE becomes its own
 * review step, walked before the player who needs it.
 *
 * Jason, 2026-09-05, looking at the wizard showing three cramped Location/Name
 * pairs under Travis Bazzana's career list: "How does this dialog know which
 * League the new team is in? I think we need to show a new team dialog instead
 * of that inline thing. So for this example I think we should show 3 modals in
 * the walker: 1. New Team: Sydney Blue Sox 2. New Team: Oregon State Beavers
 * 3. New Player Travis Bazzana which can now use the 2 new teams that were
 * created."
 *
 * Two mechanisms make that sequence happen, and this file covers both:
 *
 *   1. **Staging** (`stageCareerTeamRowsImpl`, reached from
 *      `applyLookupResult` when a player's enrichment lands, from
 *      `decideAllRemaining`'s create branch, and from the public
 *      `stageCareerTeamRows` mutation). Every accepted career team we do not
 *      already hold gets a `team` row in the SAME batch carrying
 *      `source.kind === "careerTeamOf"`.
 *   2. **Ordering** (`walkOrder`, applied by `getBatch`). Insertion order puts
 *      a staged row AFTER its player — its player's lookup is what created it
 *      — so the walk order is composed rather than stored.
 *
 * The bulk "Add All Remaining as New" pre-fill's League half
 * (`prefilledTeamCreate`) is covered here too: it must resolve an existing
 * league to an ID, offer a league we do not hold as a NAME, and create no
 * league row of its own, because reading must not write.
 *
 * Fixture conventions follow convex/entityReviewQueue.test.ts: raw
 * `ctx.db.insert("entityReviewQueue", ...)` rows rather than routing through
 * the real fetch action, `ADMIN_IDENTITY` for the public surface, bare
 * `t.mutation` for the internal one. The scheduled pool enqueue is ASSERTED
 * off `_scheduled_functions` and never drained — `wikidataPool.enqueueAction`
 * reaches the workpool component, which convex-test does not mount.
 */

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { Id } from "./_generated/dataModel";
import { normalizeTeamName } from "./teams";
import { teamFullName } from "../lib/teams/team-name";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const ADMIN_IDENTITY = {
  subject: "user_stage_001",
  issuer: "https://clerk.example.com",
  tokenIdentifier: "clerk|user_stage_001",
  role: "admin",
};

/** A second operator, for the ownership boundary. */
const OTHER_ADMIN = {
  subject: "user_stage_002",
  issuer: "https://clerk.example.com",
  tokenIdentifier: "clerk|user_stage_002",
  role: "admin",
};

const BATCH = "batch-stage";

async function seedSport(
  t: ReturnType<typeof convexTest>,
): Promise<Id<"selectorOptions">> {
  return t.run(async (ctx) =>
    ctx.db.insert("selectorOptions", {
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
    }),
  );
}

/**
 * A review row as `startBatch` writes one — `nameNormalized` included, because
 * that column IS the dedup key staging reads through
 * `by_batch_and_kind_and_name`. A fixture that omitted it would make every
 * "already in the batch" assertion vacuously pass.
 */
async function insertRow(
  t: ReturnType<typeof convexTest>,
  opts: {
    sportId: Id<"selectorOptions">;
    kind: "player" | "team";
    name: string;
    batchId?: string;
    createdByUserId?: string;
    status?: "pending" | "ready" | "error";
    enrichment?: Record<string, unknown>;
    decision?: Record<string, unknown>;
    source?: {
      kind: "careerTeamOf";
      playerRowId: Id<"entityReviewQueue">;
      wikidataId?: string;
      // NEO-248 — the years the operator typed beside the name.
      manualStint?: { fromYear: number; toYear?: number };
    };
  },
): Promise<Id<"entityReviewQueue">> {
  return t.run(async (ctx) =>
    ctx.db.insert("entityReviewQueue", {
      selectorOptionId: opts.sportId,
      batchId: opts.batchId ?? BATCH,
      createdByUserId: opts.createdByUserId ?? ADMIN_IDENTITY.subject,
      kind: opts.kind,
      name: opts.name,
      nameNormalized: normalizeTeamName(opts.name),
      sportId: opts.sportId,
      status: opts.status ?? "pending",
      ...(opts.enrichment ? { enrichment: opts.enrichment as never } : {}),
      ...(opts.decision ? { decision: opts.decision as never } : {}),
      ...(opts.source ? { source: opts.source } : {}),
    }),
  );
}

/** A `teams` row keyed exactly as `teamRowFields` would key it. */
async function insertTeam(
  t: ReturnType<typeof convexTest>,
  sportId: Id<"selectorOptions">,
  parts: { name: string; location?: string },
): Promise<Id<"teams">> {
  return t.run(async (ctx) =>
    ctx.db.insert("teams", {
      name: parts.name,
      ...(parts.location ? { location: parts.location } : {}),
      nameNormalized: normalizeTeamName(teamFullName(parts)),
      sportId,
      lastUpdated: Date.now(),
    }),
  );
}

async function stagedRows(
  t: ReturnType<typeof convexTest>,
): Promise<Array<Record<string, unknown>>> {
  return t.run(async (ctx) => {
    const rows = await ctx.db.query("entityReviewQueue").collect();
    return rows.filter(
      (r) => (r as { source?: { kind?: string } }).source?.kind === "careerTeamOf",
    ) as unknown as Array<Record<string, unknown>>;
  });
}

const ENQUEUE_FN = "wikidataPool:enqueueEntityReviewLookups";

async function scheduledEnqueueArgs(
  t: ReturnType<typeof convexTest>,
): Promise<Array<{ rowIds: Array<Id<"entityReviewQueue">> }>> {
  return t.run(async (ctx) => {
    const rows = await (
      ctx as unknown as {
        db: {
          system: {
            query: (n: string) => {
              collect: () => Promise<
                Array<{
                  name: string;
                  args: Array<{ rowIds: Array<Id<"entityReviewQueue">> }>;
                }>
              >;
            };
          };
        };
      }
    ).db.system.query("_scheduled_functions").collect();
    return rows.filter((r) => r.name === ENQUEUE_FN).map((r) => r.args[0]);
  });
}

/** The lookup landing on a player row — the ordinary staging trigger. */
async function landLookup(
  t: ReturnType<typeof convexTest>,
  id: Id<"entityReviewQueue">,
  careerTeams: Array<{
    name: string;
    fromYear: number;
    toYear?: number;
    wikidataId?: string;
  }>,
) {
  await t.mutation(internal.entityReviewQueue.applyLookupResult, {
    id,
    status: "ready",
    enrichment: { careerTeams },
  });
}

// ===========================================================================
// Staging
// ===========================================================================

describe("stageCareerTeamRows: a career team we do not hold becomes its own step", () => {
  test("stages one pending team row per accepted career team, pointing back at the player", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const playerRowId = await insertRow(t, {
      sportId,
      kind: "player",
      name: "Travis Bazzana",
    });

    await landLookup(t, playerRowId, [
      { name: "Sydney Blue Sox", fromYear: 2019, wikidataId: "Q111" },
      { name: "Oregon State Beavers", fromYear: 2022, wikidataId: "Q222" },
    ]);

    const staged = await stagedRows(t);
    expect(staged.map((r) => r.name)).toEqual([
      "Sydney Blue Sox",
      "Oregon State Beavers",
    ]);
    for (const row of staged) {
      // Same batch, same sport, same owner — a row stamped with anyone else
      // would be unanswerable by the very operator it was staged for.
      expect(row.batchId).toBe(BATCH);
      expect(row.selectorOptionId).toBe(sportId);
      expect(row.createdByUserId).toBe(ADMIN_IDENTITY.subject);
      expect(row.kind).toBe("team");
      // Pending, not ready: its own Wikidata lookup has not run yet, and that
      // lookup is what supplies the League suggestion its New Team step
      // pre-fills from.
      expect(row.status).toBe("pending");
      expect(row.decision).toBeUndefined();
      expect((row.source as { playerRowId: string }).playerRowId).toBe(playerRowId);
    }
  });

  test("carries the P54 team QID onto source.wikidataId, and omits the key when Wikidata gave none", async () => {
    // Linkage, not truth: the QID selects WHICH upstream record the staged
    // row's own lookup reads (`lookupTeamEnrichment(name, sport, knownQid)`),
    // instead of guessing from an English label that EntitySearch routinely
    // misses for club and college sides.
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const playerRowId = await insertRow(t, {
      sportId,
      kind: "player",
      name: "Travis Bazzana",
    });

    await landLookup(t, playerRowId, [
      { name: "Sydney Blue Sox", fromYear: 2019, wikidataId: "Q7660066" },
      { name: "Oregon State Beavers", fromYear: 2022 },
    ]);

    const staged = await stagedRows(t);
    const byName = new Map(staged.map((r) => [r.name as string, r]));
    expect(
      (byName.get("Sydney Blue Sox")!.source as { wikidataId?: string }).wikidataId,
    ).toBe("Q7660066");
    // Absent rather than undefined-valued — nothing downstream should have to
    // tell "no QID" from "a QID that is undefined".
    expect(
      Object.prototype.hasOwnProperty.call(
        byName.get("Oregon State Beavers")!.source as object,
        "wikidataId",
      ),
    ).toBe(false);
  });

  test("two players proposing the same club stage exactly ONE row", async () => {
    // The dedup that keeps the walker from asking the same New Team question
    // twice. Read through `by_batch_and_kind_and_name`, so it works across
    // players without either lookup having to see the other's rows.
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const first = await insertRow(t, { sportId, kind: "player", name: "Player One" });
    const second = await insertRow(t, { sportId, kind: "player", name: "Player Two" });

    await landLookup(t, first, [{ name: "Sydney Blue Sox", fromYear: 2019 }]);
    await landLookup(t, second, [{ name: "Sydney Blue Sox", fromYear: 2021 }]);

    const staged = await stagedRows(t);
    expect(staged).toHaveLength(1);
    // The FIRST player to propose it owns the step — whoever asked first is
    // who the step says it is needed by.
    expect((staged[0].source as { playerRowId: string }).playerRowId).toBe(first);
  });

  test("a checklist team row already in the batch is not staged a second time", async () => {
    // The other direction of the same dedup: the club is on a card too, so it
    // already has a step of its own with no `source`.
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const checklistRowId = await insertRow(t, {
      sportId,
      kind: "team",
      name: "Sydney Blue Sox",
      status: "ready",
    });
    const playerRowId = await insertRow(t, {
      sportId,
      kind: "player",
      name: "Travis Bazzana",
    });

    await landLookup(t, playerRowId, [{ name: "Sydney Blue Sox", fromYear: 2019 }]);

    expect(await stagedRows(t)).toHaveLength(0);
    const rows = await t.run(async (ctx) =>
      ctx.db.query("entityReviewQueue").collect(),
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r._id)).toContain(checklistRowId);
  });

  test("a career team we already hold is a link, not a question — including a SPLIT row", async () => {
    // "San Diego Padres" is the Wikidata label; the row we hold is
    // ("San Diego", "Padres"). `findTeamByFullName` keys on the COMPOSED name
    // and `normalizeTeamName` token-sorts, so the two are the same key and
    // nothing is staged. Asking the operator to re-create a team they already
    // have is how the duplicate franchise gets made.
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    await insertTeam(t, sportId, { location: "San Diego", name: "Padres" });
    const playerRowId = await insertRow(t, {
      sportId,
      kind: "player",
      name: "Tony Gwynn",
    });

    await landLookup(t, playerRowId, [
      { name: "San Diego Padres", fromYear: 1982 },
      { name: "San Diego State Aztecs", fromYear: 1979 },
    ]);

    const staged = await stagedRows(t);
    // Only the side we do NOT hold.
    expect(staged.map((r) => r.name)).toEqual(["San Diego State Aztecs"]);
  });

  test("caps the rows one player can stage at MAX_CAREER_TEAM_CREATES (64)", async () => {
    // A guard rail on an unbounded write, not a security boundary — the same
    // bound the per-decision create list carries.
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const playerRowId = await insertRow(t, {
      sportId,
      kind: "player",
      name: "Journeyman",
    });

    await landLookup(
      t,
      playerRowId,
      Array.from({ length: 70 }, (_, i) => ({
        name: `Club Number ${i}`,
        fromYear: 1990 + i,
      })),
    );

    const staged = await stagedRows(t);
    expect(staged).toHaveLength(64);
    // The first 64 proposals, in order — the cap truncates, it does not sample.
    expect(staged[0].name).toBe("Club Number 0");
    expect(staged[63].name).toBe("Club Number 63");
  });

});

// ===========================================================================
// NEO-248 — the operator's YEARS travel with the step their name staged
// ===========================================================================

/**
 * The NEO-236 regression this covers.
 *
 * A hand-typed career team is two facts at once: a team the batch may have to
 * create, and a stint with years on it. NEO-236 gave the team half a New Team
 * step of its own — and staging that step is what MOVES the wizard's walk off
 * the player row (`waitingOnStagedTeams`). The years lived only in the wizard's
 * per-row React state, which the presented-row effect wiped on the way. So the
 * ordinary path through the feature — type a name, 2001, 2005, press Add — lost
 * the years before the operator had finished the sentence, and nothing anywhere
 * held them.
 *
 * `source.manualStint` is where they live now: on the step the name staged,
 * written only for a HAND-TYPED entry. A Wikidata proposal deliberately writes
 * none — its years are already on the player row's `enrichment.careerTeams`,
 * and that asymmetry is exactly what lets the wizard rebuild the manual chips
 * and only those.
 */
describe("stageCareerTeamRows: a hand-typed stint's years survive the New Team step", () => {

  test("a Wikidata proposal stages a step with NO manualStint on it", async () => {
    // The discriminator the wizard's rehydration reads. A P54 label's years are
    // already on the player row, and a second copy here is a second thing to
    // disagree — the chip for it is rendered from `enrichment.careerTeams`.
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const playerRowId = await insertRow(t, {
      sportId,
      kind: "player",
      name: "Travis Bazzana",
    });

    await landLookup(t, playerRowId, [
      { name: "Sydney Blue Sox", fromYear: 2019, toYear: 2021 },
    ]);

    const staged = await stagedRows(t);
    expect(staged).toHaveLength(1);
    expect(
      Object.prototype.hasOwnProperty.call(
        staged[0].source as object,
        "manualStint",
      ),
    ).toBe(false);
  });

});

// ===========================================================================
// NEO-248 — the bulk create carries a player's hand-typed stints
// ===========================================================================


// ===========================================================================
// NEO-248 — removing a chip is durable
// ===========================================================================


// ===========================================================================
// Walk order (getBatch)
// ===========================================================================


// ===========================================================================
// recordAllRemainingAsCreate — the League half of the pre-fill (NEO-236)
// ===========================================================================


// ===========================================================================
// NEO-236 security review — the five conditions on a807220
// ===========================================================================

describe("security review 2: an unbounded career-team name never reaches the row or the index", () => {
  /**
   * Both sources are text nobody on our side vetted — a Wikidata P54 label, and
   * the `careerTeamNames` a client hands the public mutation. The over-long one
   * is SKIPPED, not thrown on: one absurd label must not cost the player every
   * other step it was staged alongside.
   */
  const OVER_LONG = "Z".repeat(121);

  test("skips an over-long name from enrichment, and stages the rest of the list", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const playerRowId = await insertRow(t, { sportId, kind: "player", name: "Travis Bazzana" });

    await landLookup(t, playerRowId, [
      { name: OVER_LONG, fromYear: 2018 },
      { name: "Sydney Blue Sox", fromYear: 2019 },
    ]);

    const staged = await stagedRows(t);
    expect(staged.map((r) => r.name)).toEqual(["Sydney Blue Sox"]);
  });

  test("the boundary itself is allowed — 120 characters composes into a team", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const playerRowId = await insertRow(t, { sportId, kind: "player", name: "Travis Bazzana" });

    await landLookup(t, playerRowId, [{ name: "Z".repeat(120), fromYear: 2018 }]);

    expect((await stagedRows(t)).length).toBe(1);
  });
});


describe("security review 4: a staged step whose player was reconciled away is dropped", () => {
  /**
   * The `source` exemption keeps a staged row through reconciliation because
   * its name is never in the incoming list — right while its player is still in
   * the batch, wrong once the player is gone, because the step then blocks
   * "all reviewed" on a team nothing needs.
   */
  test("drops an UNDECIDED staged row when its player leaves the incoming set", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const playerRowId = await insertRow(t, { sportId, kind: "player", name: "Travis Bazzana" });
    await landLookup(t, playerRowId, [{ name: "Sydney Blue Sox", fromYear: 2018 }]);
    expect((await stagedRows(t)).length).toBe(1);

    // The player is no longer carried by any card, and was never ruled on.
    await t.mutation(internal.entityReviewQueue.startBatch, {
      selectorOptionId: sportId,
      createdByUserId: ADMIN_IDENTITY.subject,
      sportId,
      playerNames: [],
      teamNames: [],
    });

    expect(await stagedRows(t)).toEqual([]);
    expect(await t.run(async (ctx) => ctx.db.get(playerRowId))).toBeNull();
  });

  test("KEEPS a staged row whose player is still incoming", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const playerRowId = await insertRow(t, { sportId, kind: "player", name: "Travis Bazzana" });
    await landLookup(t, playerRowId, [{ name: "Sydney Blue Sox", fromYear: 2018 }]);

    await t.mutation(internal.entityReviewQueue.startBatch, {
      selectorOptionId: sportId,
      createdByUserId: ADMIN_IDENTITY.subject,
      sportId,
      playerNames: ["Travis Bazzana"],
      teamNames: [],
    });

    expect((await stagedRows(t)).length).toBe(1);
  });

  test("KEEPS a DECIDED staged row even when its player is gone — the operator ruled on it", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const playerRowId = await insertRow(t, { sportId, kind: "player", name: "Travis Bazzana" });
    await landLookup(t, playerRowId, [{ name: "Sydney Blue Sox", fromYear: 2018 }]);
    const stagedId = (await stagedRows(t))[0]._id as Id<"entityReviewQueue">;
    await t.run(async (ctx) =>
      ctx.db.patch(stagedId, { decision: { action: "create", create: { name: "Blue Sox", location: "Sydney" } } }),
    );

    await t.mutation(internal.entityReviewQueue.startBatch, {
      selectorOptionId: sportId,
      createdByUserId: ADMIN_IDENTITY.subject,
      sportId,
      playerNames: [],
      teamNames: [],
    });

    expect((await stagedRows(t)).length).toBe(1);
  });

  test("a DECIDED player keeps its staged step alive too", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const playerRowId = await insertRow(t, { sportId, kind: "player", name: "Travis Bazzana" });
    await landLookup(t, playerRowId, [{ name: "Sydney Blue Sox", fromYear: 2018 }]);
    await t.run(async (ctx) => ctx.db.patch(playerRowId, { decision: { action: "create" } }));

    await t.mutation(internal.entityReviewQueue.startBatch, {
      selectorOptionId: sportId,
      createdByUserId: ADMIN_IDENTITY.subject,
      sportId,
      playerNames: [],
      teamNames: [],
    });

    expect((await stagedRows(t)).length).toBe(1);
  });
});


describe("NEO-307: a stint never links to a team's past — it gets its step", () => {
  /*
   * NEO-307 lets a CARD link a lone team row whose era has ended (a 2026 retro
   * card of the 1911–1957 Brooklyn Dodgers). That allowance is card-only.
   * This path asks "do we already hold this career team?" with the stint's own
   * start year, and nobody plays for a team after it folds: a 2015 Winnipeg
   * Jets stint with only the 1972–1996 row held is NOT held — it needs the
   * 2011 era created, so it gets a New Team step.
   */
  async function insertOriginalJets(
    t: ReturnType<typeof convexTest>,
    sportId: Id<"selectorOptions">,
  ) {
    return t.run(async (ctx) =>
      ctx.db.insert("teams", {
        location: "Winnipeg",
        name: "Jets",
        nameNormalized: normalizeTeamName("Winnipeg Jets"),
        sportId,
        yearsActive: { from: 1972, to: 1996 },
        lastUpdated: Date.now(),
      }),
    );
  }

  test("a 2015 stint with only the 1972–1996 Jets held stages a step", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    await insertOriginalJets(t, sportId);
    const playerRowId = await insertRow(t, {
      sportId,
      kind: "player",
      name: "Blake Wheeler",
    });

    await landLookup(t, playerRowId, [{ name: "Winnipeg Jets", fromYear: 2015 }]);

    const staged = await stagedRows(t);
    expect(staged.map((r) => r.name)).toEqual(["Winnipeg Jets"]);
  });

  test("a 1985 stint at the same lone row is held — a link, no step", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    await insertOriginalJets(t, sportId);
    const playerRowId = await insertRow(t, {
      sportId,
      kind: "player",
      name: "Dale Hawerchuk",
    });

    await landLookup(t, playerRowId, [{ name: "Winnipeg Jets", fromYear: 1985 }]);

    expect(await stagedRows(t)).toEqual([]);
  });
});

// ===========================================================================
// NEO-341 — "Skip remaining names" and a lookup that lands mid-walk
// ===========================================================================

