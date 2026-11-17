/**
 * NEO-574 — the career check's server reads: `coverageForPreview`,
 * `relinkCandidates`, the internal `coverageForPairs`, and the gate's
 * `careerContext` on `resolveChecklistEntities`.
 *
 * The rule itself (strict year, id / franchise / name keys, an empty career
 * covers nothing) is pinned purely in `lib/careerCoverage.test.ts`; these
 * tests prove the reads apply it to real rows and stay admin-gated.
 */
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { normalizeTeamName } from "./teams";
import { normalizePlayerName } from "./players";
import { CAREER_COVERAGE_MAX_PAIRS } from "./lib/careerCoverage";
import { COVERAGE_PAIRS_PER_INTERNAL_READ } from "./careerCoverage";
import { cancelScheduled } from "../lib/testing/drain-scheduled";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const ADMIN = {
  subject: "admin_career_coverage_001",
  issuer: "https://clerk.example.com",
  tokenIdentifier: "clerk|admin_career_coverage_001",
  name: "Admin User",
  role: "admin",
};
const MEMBER = {
  subject: "member_career_coverage_001",
  issuer: "https://clerk.example.com",
  tokenIdentifier: "clerk|member_career_coverage_001",
  name: "Member",
};

type T = ReturnType<typeof convexTest>;

/** sport › year › setName › leaf, the year being `year` (null: no year row). */
async function seedSet(t: T, year: string | null = "1990") {
  return t.run(async (ctx) => {
    const now = Date.now();
    const sportId = await ctx.db.insert("selectorOptions", {
      level: "sport",
      value: "Baseball",
      sportConfig: { skuCode: "BB", league: "MLB" },
      platformData: {},
      children: [],
      lastUpdated: now,
    });
    const yearId =
      year === null
        ? undefined
        : await ctx.db.insert("selectorOptions", {
            level: "year",
            value: year,
            platformData: {},
            parentId: sportId,
            children: [],
            lastUpdated: now,
          });
    const setNameId = await ctx.db.insert("selectorOptions", {
      level: "setName",
      value: "Topps",
      platformData: {},
      parentId: yearId ?? sportId,
      children: [],
      lastUpdated: now,
    });
    const leafId = await ctx.db.insert("selectorOptions", {
      level: "variantType",
      value: "Base",
      platformData: {},
      parentId: setNameId,
      children: [],
      lastUpdated: now,
    });
    await ctx.db.patch(setNameId, { children: [leafId] });
    if (yearId) await ctx.db.patch(yearId, { children: [setNameId] });
    await ctx.db.patch(sportId, { children: [yearId ?? setNameId] });
    return { sportId, leafId };
  });
}

async function insertTeam(
  t: T,
  sportId: Id<"selectorOptions">,
  location: string,
  name: string,
  franchiseId?: Id<"franchises">,
) {
  return t.run((ctx) =>
    ctx.db.insert("teams", {
      location,
      name,
      nameNormalized: normalizeTeamName(`${location} ${name}`),
      sportId,
      ...(franchiseId ? { franchiseId } : {}),
      lastUpdated: Date.now(),
    }),
  );
}

async function insertFranchise(t: T, sportId: Id<"selectorOptions">, name: string) {
  return t.run((ctx) =>
    ctx.db.insert("franchises", {
      name,
      nameNormalized: normalizeTeamName(name),
      sportId,
      lastUpdated: Date.now(),
    }),
  );
}

async function insertPlayer(
  t: T,
  sportId: Id<"selectorOptions">,
  name: string,
  teamYears?: Array<{ teamId: Id<"teams">; fromYear?: number; toYear?: number }>,
) {
  return t.run((ctx) =>
    ctx.db.insert("players", {
      name,
      nameNormalized: normalizePlayerName(name),
      sportId,
      ...(teamYears ? { teamYears } : {}),
      lastUpdated: Date.now(),
    }),
  );
}

describe("coverageForPreview", () => {
  test("is admin-only", async () => {
    const t = convexTest(schema, modules);
    const { leafId } = await seedSet(t);
    await expect(
      t.query(api.careerCoverage.coverageForPreview, { selectorOptionId: leafId, pairs: [] }),
    ).rejects.toThrow();
    await expect(
      t.withIdentity(MEMBER).query(api.careerCoverage.coverageForPreview, {
        selectorOptionId: leafId,
        pairs: [],
      }),
    ).rejects.toThrow(/admin/i);
  });

  test("a stint on the team by id covers; an empty career and a different team do not", async () => {
    const t = convexTest(schema, modules);
    const { sportId, leafId } = await seedSet(t, "1990");
    const padres = await insertTeam(t, sportId, "San Diego", "Padres");
    const cubs = await insertTeam(t, sportId, "Chicago", "Cubs");
    const onPadres = await insertPlayer(t, sportId, "Tony Gwynn", [{ teamId: padres, fromYear: 1982, toYear: 2001 }]);
    const noCareer = await insertPlayer(t, sportId, "Nobody Career");

    const out = await t.withIdentity(ADMIN).query(api.careerCoverage.coverageForPreview, {
      selectorOptionId: leafId,
      pairs: [
        { playerId: onPadres, teamId: padres },
        { playerId: onPadres, teamId: cubs },
        { playerId: noCareer, teamId: padres },
      ],
    });
    expect(out.setYear).toBe(1990);
    expect(out.results.map((r) => r.covered)).toEqual([true, false, false]);
    // Aligned with the input, ids echoed.
    expect(out.results[1]).toMatchObject({ playerId: onPadres, teamId: cubs });
  });

  test("strict year: a stint beginning in the card's year covers, one a year later does not", async () => {
    const t = convexTest(schema, modules);
    const { sportId, leafId } = await seedSet(t, "1990");
    const padres = await insertTeam(t, sportId, "San Diego", "Padres");
    const sameYear = await insertPlayer(t, sportId, "Same Year", [{ teamId: padres, fromYear: 1990 }]);
    const nextYear = await insertPlayer(t, sportId, "Next Year", [{ teamId: padres, fromYear: 1991 }]);
    const out = await t.withIdentity(ADMIN).query(api.careerCoverage.coverageForPreview, {
      selectorOptionId: leafId,
      pairs: [
        { playerId: sameYear, teamId: padres },
        { playerId: nextYear, teamId: padres },
      ],
    });
    expect(out.results.map((r) => r.covered)).toEqual([true, false]);
  });

  test("an undated stint covers", async () => {
    const t = convexTest(schema, modules);
    const { sportId, leafId } = await seedSet(t, "1990");
    const padres = await insertTeam(t, sportId, "San Diego", "Padres");
    const college = await insertPlayer(t, sportId, "Undated", [{ teamId: padres }]);
    const out = await t.withIdentity(ADMIN).query(api.careerCoverage.coverageForPreview, {
      selectorOptionId: leafId,
      pairs: [{ playerId: college, teamId: padres }],
    });
    expect(out.results[0].covered).toBe(true);
  });

  test("a franchise link covers a stint under another name", async () => {
    const t = convexTest(schema, modules);
    const { sportId, leafId } = await seedSet(t, "1999");
    const franchise = await insertFranchise(t, sportId, "Titans / Oilers");
    const oilers = await insertTeam(t, sportId, "Houston", "Oilers", franchise);
    const titans = await insertTeam(t, sportId, "Tennessee", "Titans", franchise);
    const lonelyTitans = await insertTeam(t, sportId, "Nashville", "Zephyrs");
    const player = await insertPlayer(t, sportId, "Steve McNair", [{ teamId: oilers, fromYear: 1995, toYear: 1996 }]);
    const out = await t.withIdentity(ADMIN).query(api.careerCoverage.coverageForPreview, {
      selectorOptionId: leafId,
      pairs: [
        { playerId: player, teamId: titans },
        { playerId: player, teamId: lonelyTitans },
      ],
    });
    expect(out.results.map((r) => r.covered)).toEqual([true, false]);
  });

  test("a team given only by text (one this batch creates) matches another row of that name, else is uncovered", async () => {
    const t = convexTest(schema, modules);
    const { sportId, leafId } = await seedSet(t, "2015");
    const oldJets = await insertTeam(t, sportId, "Winnipeg", "Jets");
    const player = await insertPlayer(t, sportId, "Journeyman", [{ teamId: oldJets, fromYear: 1990 }]);
    const out = await t.withIdentity(ADMIN).query(api.careerCoverage.coverageForPreview, {
      selectorOptionId: leafId,
      pairs: [
        { playerId: player, teamName: "Winnipeg Jets" },
        { playerId: player, teamName: "Brand New Club" },
      ],
    });
    expect(out.results.map((r) => r.covered)).toEqual([true, false]);
  });

  test("a set with no year answers setYear null and every pair covered", async () => {
    const t = convexTest(schema, modules);
    const { sportId, leafId } = await seedSet(t, null);
    const padres = await insertTeam(t, sportId, "San Diego", "Padres");
    const player = await insertPlayer(t, sportId, "No Career");
    const out = await t.withIdentity(ADMIN).query(api.careerCoverage.coverageForPreview, {
      selectorOptionId: leafId,
      pairs: [{ playerId: player, teamId: padres }],
    });
    expect(out.setYear).toBeNull();
    expect(out.results[0].covered).toBe(true);
  });

  test("more than the pair limit is refused, never truncated", async () => {
    const t = convexTest(schema, modules);
    const { sportId, leafId } = await seedSet(t);
    const padres = await insertTeam(t, sportId, "San Diego", "Padres");
    const player = await insertPlayer(t, sportId, "Somebody");
    const pairs = Array.from({ length: CAREER_COVERAGE_MAX_PAIRS + 1 }, () => ({
      playerId: player,
      teamId: padres,
    }));
    await expect(
      t.withIdentity(ADMIN).query(api.careerCoverage.coverageForPreview, { selectorOptionId: leafId, pairs }),
    ).rejects.toThrow(/pair limit/);
    // Exactly the limit is fine.
    const ok = await t.withIdentity(ADMIN).query(api.careerCoverage.coverageForPreview, {
      selectorOptionId: leafId,
      pairs: pairs.slice(0, CAREER_COVERAGE_MAX_PAIRS),
    });
    expect(ok.results).toHaveLength(CAREER_COVERAGE_MAX_PAIRS);
  });

  test("a player that no longer exists reads as covered (nothing to add a stint to)", async () => {
    const t = convexTest(schema, modules);
    const { sportId, leafId } = await seedSet(t);
    const padres = await insertTeam(t, sportId, "San Diego", "Padres");
    const player = await insertPlayer(t, sportId, "Gone");
    await t.run((ctx) => ctx.db.delete(player));
    const out = await t.withIdentity(ADMIN).query(api.careerCoverage.coverageForPreview, {
      selectorOptionId: leafId,
      pairs: [{ playerId: player, teamId: padres }],
    });
    expect(out.results[0].covered).toBe(true);
  });
});

describe("coverageForPairs (internal)", () => {
  test("answers the same question for the gate and refuses an oversized page", async () => {
    const t = convexTest(schema, modules);
    const { sportId } = await seedSet(t, "1990");
    const padres = await insertTeam(t, sportId, "San Diego", "Padres");
    const player = await insertPlayer(t, sportId, "Somebody");
    const results = await t.query(internal.careerCoverage.coverageForPairs, {
      sportId,
      setYear: 1990,
      pairs: [{ playerId: player, teamId: padres }],
    });
    expect(results).toEqual([{ playerId: player, teamId: padres, covered: false }]);
    await expect(
      t.query(internal.careerCoverage.coverageForPairs, {
        sportId,
        setYear: 1990,
        pairs: Array.from({ length: COVERAGE_PAIRS_PER_INTERNAL_READ + 1 }, () => ({
          playerId: player,
          teamId: padres,
        })),
      }),
    ).rejects.toThrow(/page/);
  });
});

describe("relinkCandidates", () => {
  test("is admin-only", async () => {
    const t = convexTest(schema, modules);
    const { leafId } = await seedSet(t);
    await expect(
      t.withIdentity(MEMBER).query(api.careerCoverage.relinkCandidates, {
        selectorOptionId: leafId,
        printedName: "Bob Allen",
      }),
    ).rejects.toThrow(/admin/i);
  });

  test("lists same-name players with the ones covering the card's team first, and leaves out the excluded one", async () => {
    const t = convexTest(schema, modules);
    const { sportId, leafId } = await seedSet(t, "1990");
    const padres = await insertTeam(t, sportId, "San Diego", "Padres");
    const cubs = await insertTeam(t, sportId, "Chicago", "Cubs");
    const wrongTeam = await insertPlayer(t, sportId, "Bob Allen", [{ teamId: cubs, fromYear: 1985, toYear: 1992 }]);
    const covering = await insertPlayer(t, sportId, "Bob Allen", [{ teamId: padres, fromYear: 1986, toYear: 1993 }]);
    const current = await insertPlayer(t, sportId, "Bob Allen", [{ teamId: cubs, fromYear: 1930, toYear: 1935 }]);
    await insertPlayer(t, sportId, "Somebody Else", [{ teamId: padres, fromYear: 1986 }]);

    const out = await t.withIdentity(ADMIN).query(api.careerCoverage.relinkCandidates, {
      selectorOptionId: leafId,
      printedName: "bob allen",
      teamId: padres,
      excludePlayerId: current,
    });
    expect(out.setYear).toBe(1990);
    expect(out.candidates.map((c) => c.playerId)).toEqual([covering, wrongTeam]);
    expect(out.candidates.map((c) => c.covers)).toEqual([true, false]);
    expect(out.candidates[0].careerSummary.length).toBeGreaterThan(0);
  });

  test("a name nobody answers to gives no candidates", async () => {
    const t = convexTest(schema, modules);
    const { leafId } = await seedSet(t);
    const out = await t.withIdentity(ADMIN).query(api.careerCoverage.relinkCandidates, {
      selectorOptionId: leafId,
      printedName: "Nobody Known",
    });
    expect(out.candidates).toEqual([]);
  });
});

describe("resolveChecklistEntities — careerContext", () => {
  function card(cardNumber: string, players: string[], teams: string[]) {
    return { cardNumber, cardName: "Card", players, teams, platformData: {} };
  }

  test("reports the resolved printed names, the set year and the uncovered (team, players)", async () => {
    const t = convexTest(schema, modules);
    const { sportId, leafId } = await seedSet(t, "1990");
    const padres = await insertTeam(t, sportId, "San Diego", "Padres");
    const cubs = await insertTeam(t, sportId, "Chicago", "Cubs");
    const gwynn = await insertPlayer(t, sportId, "Tony Gwynn", [{ teamId: padres, fromYear: 1982 }]);
    const sandberg = await insertPlayer(t, sportId, "Ryne Sandberg", [{ teamId: cubs, fromYear: 1982 }]);

    const result = await t.withIdentity(ADMIN).action(api.selectorOptions.resolveChecklistEntities, {
      selectorOptionId: leafId,
      sportId,
      cards: [
        card("1", ["Tony Gwynn"], ["San Diego Padres"]),
        // Sandberg never played for the Padres: a gap.
        card("2", ["Ryne Sandberg"], ["San Diego Padres"]),
        // Two players on one card: never in a gap.
        card("3", ["Tony Gwynn", "Ryne Sandberg"], ["Chicago Cubs"]),
      ],
    });

    expect(result.careerContext?.setYear).toBe(1990);
    expect(result.careerContext?.players).toEqual(
      expect.arrayContaining([
        { printed: "Tony Gwynn", playerId: gwynn },
        { printed: "Ryne Sandberg", playerId: sandberg },
      ]),
    );
    expect(result.careerContext?.teams).toEqual(
      expect.arrayContaining([
        { printed: "San Diego Padres", teamId: padres },
        { printed: "Chicago Cubs", teamId: cubs },
      ]),
    );
    expect(result.careerContext?.gaps).toEqual([{ teamId: padres, playerIds: [sandberg] }]);
  });

  test("a player resolved but with an empty career is a gap", async () => {
    const t = convexTest(schema, modules);
    const { sportId, leafId } = await seedSet(t, "1990");
    const padres = await insertTeam(t, sportId, "San Diego", "Padres");
    const bare = await insertPlayer(t, sportId, "Bare Career");
    const result = await t.withIdentity(ADMIN).action(api.selectorOptions.resolveChecklistEntities, {
      selectorOptionId: leafId,
      sportId,
      cards: [card("1", ["Bare Career"], ["San Diego Padres"])],
    });
    expect(result.careerContext?.gaps).toEqual([{ teamId: padres, playerIds: [bare] }]);
  });

  test("a set with no year has no gaps and no setYear", async () => {
    const t = convexTest(schema, modules);
    const { sportId, leafId } = await seedSet(t, null);
    await insertTeam(t, sportId, "San Diego", "Padres");
    await insertPlayer(t, sportId, "Bare Career");
    const result = await t.withIdentity(ADMIN).action(api.selectorOptions.resolveChecklistEntities, {
      selectorOptionId: leafId,
      sportId,
      cards: [card("1", ["Bare Career"], ["San Diego Padres"])],
    });
    expect(result.careerContext?.setYear).toBeUndefined();
    expect(result.careerContext?.gaps).toEqual([]);
  });

  test("a name the gate sends to the wizard is in neither list", async () => {
    const t = convexTest(schema, modules);
    const { sportId, leafId } = await seedSet(t, "1990");
    await insertTeam(t, sportId, "San Diego", "Padres");
    const result = await t.withIdentity(ADMIN).action(api.selectorOptions.resolveChecklistEntities, {
      selectorOptionId: leafId,
      sportId,
      cards: [card("1", ["Nobody Known"], ["Gotham Knights"])],
    });
    expect(result.careerContext?.players).toEqual([]);
    expect(result.careerContext?.teams).toEqual([]);
    expect(result.careerContext?.gaps).toEqual([]);
    await cancelScheduled(t);
  });
});
