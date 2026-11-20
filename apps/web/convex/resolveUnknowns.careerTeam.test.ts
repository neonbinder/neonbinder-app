/**
 * NEO-490 (2b) — the review gate's team side of the career-team rule, driven
 * through the real action (`selectorOptions.resolveChecklistEntities`) and the
 * real `selectorOptions.resolveGateTeamNames` query.
 *
 * A printed team name with several closed eras that neither the set year nor
 * the set's history separates is settled by the players on the cards that
 * print it. The answer is a visible decided row (`autoLinked: "careerTeam"`);
 * anything short of one agreed era is asked as before.
 *
 * Fixture: "St. Louis Browns" in two closed eras (1902-1953, 1961-1965) under
 * a 2024 set. Both eras are before the set year, so `resolveTeamForSetYear`
 * answers null with two candidates.
 */

import { convexTest } from "convex-test";
import { afterEach, describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { normalizePlayerName } from "./players";
import { normalizeTeamName } from "./teams";
import { CARD_PLAYER_TEAM_MAX_CARDS } from "./lib/teamRow";
import { cancelScheduled } from "../lib/testing/drain-scheduled";
import { insertTestCard } from "../lib/testing/card-row";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const ADMIN_IDENTITY = {
  subject: "admin_career_team_gate_001",
  issuer: "https://clerk.example.com",
  tokenIdentifier: "clerk|admin_career_team_gate_001",
  name: "Admin User",
  role: "admin",
};

const TEAM_NAME = "St. Louis Browns";

type T = ReturnType<typeof convexTest>;
type Sel = Id<"selectorOptions">;

const live: T[] = [];
function newT(): T {
  const t = convexTest(schema, modules);
  live.push(t);
  return t;
}
afterEach(async () => {
  for (const t of live.splice(0)) await cancelScheduled(t);
});

async function node(
  t: T,
  fields: { level: string; value: string; parentId?: Sel },
): Promise<Sel> {
  return t.run(async (ctx) => {
    const id = await ctx.db.insert("selectorOptions", {
      ...fields,
      platformData: {},
      children: [],
      lastUpdated: Date.now(),
    });
    if (fields.parentId) {
      const parent = await ctx.db.get(fields.parentId);
      await ctx.db.patch(fields.parentId, {
        children: [...(parent?.children ?? []), id],
      });
    }
    return id;
  });
}

/** sport › year 2024 › manufacturer › set › Base + Insert variant types. */
async function setup(t: T) {
  const sportId = await node(t, { level: "sport", value: "Baseball" });
  const year = await node(t, { level: "year", value: "2024", parentId: sportId });
  const brand = await node(t, { level: "manufacturer", value: "Topps", parentId: year });
  const set = await node(t, { level: "setName", value: "Series 1", parentId: brand });
  const base = await node(t, { level: "variantType", value: "Base", parentId: set });
  const insert = await node(t, { level: "variantType", value: "Insert", parentId: set });
  const era = (from: number, to: number) =>
    t.run((ctx) =>
      ctx.db.insert("teams", {
        location: "St. Louis",
        name: "Browns",
        nameNormalized: normalizeTeamName(TEAM_NAME),
        sportId,
        yearsActive: { from, to },
        lastUpdated: Date.now(),
      }),
    );
  const early = await era(1902, 1953);
  const late = await era(1961, 1965);
  return { sportId, base, insert, early, late };
}

function player(t: T, sportId: Sel, name: string, teams: Id<"teams">[]): Promise<Id<"players">> {
  // NEO-602: a stint only supports a row whose era it overlaps, so each stint
  // is dated INSIDE its team's era (its first two seasons).
  return t.run(async (ctx) => {
    const teamYears = [];
    for (const teamId of teams) {
      const from = (await ctx.db.get(teamId))?.yearsActive?.from;
      teamYears.push(
        from === undefined ? { teamId } : { teamId, fromYear: from, toYear: from + 1 },
      );
    }
    return ctx.db.insert("players", {
      name,
      nameNormalized: normalizePlayerName(name),
      sportId,
      teamYears,
      lastUpdated: Date.now(),
    });
  });
}

function card(players: string[], n: number) {
  return {
    cardNumber: `I-${n}`,
    cardName: "Card",
    players,
    teams: [TEAM_NAME],
    platformData: {},
  };
}

async function gate(
  t: T,
  s: { sportId: Sel; insert: Sel },
  cards: ReturnType<typeof card>[],
) {
  return t.withIdentity(ADMIN_IDENTITY).action(api.selectorOptions.resolveChecklistEntities, {
    selectorOptionId: s.insert,
    sportId: s.sportId,
    cards,
  });
}

async function teamRows(t: T, batchId: string | undefined) {
  if (!batchId) return [];
  return (await t.run((ctx) => ctx.db.query("entityReviewQueue").collect())).filter(
    (r) => r.batchId === batchId && r.kind === "team",
  );
}

describe("the gate: a team name with several eras, settled by the card's players (NEO-490)", () => {
  test("one resolved player with a stint on one era makes a decided careerTeam team row", async () => {
    const t = newT();
    const s = await setup(t);
    await player(t, s.sportId, "Satchel Paige", [s.early]);

    const result = await gate(t, s, [card(["Satchel Paige"], 1)]);

    expect(result.unknownTeams).toEqual([]);
    const rows = await teamRows(t, result.batchId);
    expect(rows).toHaveLength(1);
    expect(rows[0].decision).toMatchObject({
      action: "link",
      linkedTeamId: s.early,
      autoLinked: "careerTeam",
    });
  });

  test("a second card for the team whose player is unresolved leaves the team undecided and asked", async () => {
    const t = newT();
    const s = await setup(t);
    await player(t, s.sportId, "Satchel Paige", [s.early]);

    const result = await gate(t, s, [
      card(["Satchel Paige"], 1),
      card(["Nobody Onfile"], 2),
    ]);

    expect(result.unknownTeams).toEqual([TEAM_NAME]);
    const rows = await teamRows(t, result.batchId);
    expect(rows.every((r) => r.decision?.autoLinked !== "careerTeam")).toBe(true);
  });

  test("two cards whose players point at different eras leave the team undecided", async () => {
    const t = newT();
    const s = await setup(t);
    await player(t, s.sportId, "Satchel Paige", [s.early]);
    await player(t, s.sportId, "Ken Boyer", [s.late]);

    const result = await gate(t, s, [card(["Satchel Paige"], 1), card(["Ken Boyer"], 2)]);

    expect(result.unknownTeams).toEqual([TEAM_NAME]);
    const rows = await teamRows(t, result.batchId);
    expect(rows.some((r) => r.decision?.autoLinked === "careerTeam")).toBe(false);
  });

  test("an era the set's history would settle is NOT asked: several rows and no answer go to the operator (NEO-602, invariant 8)", async () => {
    const t = newT();
    const s = await setup(t);
    // The player has no career on either era, and an earlier committed card
    // of this set names `early`. Before NEO-602 history picked `early` here.
    // Two rows answer to the name and nothing separates them, so a tie is the
    // operator's - never auto-picked, never history's.
    await player(t, s.sportId, "Satchel Paige", []);
    await t.run((ctx) =>
      insertTestCard(ctx, {
        selectorOptionId: s.base,
        cardNumber: "1",
        cardName: "Card",
        platformData: {},
        sortOrder: 0,
        lastUpdated: Date.now(),
        teamOnCardIds: [s.early],
      }),
    );

    const result = await gate(t, s, [card(["Satchel Paige"], 1)]);

    expect(result.unknownTeams).toEqual([TEAM_NAME]);
    const rows = await teamRows(t, result.batchId);
    expect(rows.every((r) => r.decision === undefined)).toBe(true);
    expect(rows.some((r) => r.decision?.autoLinked === "setHistory")).toBe(false);
  });

  test("the players outrank the set's history: a player on `late` beats a history card on `early`", async () => {
    const t = newT();
    const s = await setup(t);
    await player(t, s.sportId, "Ken Boyer", [s.late]);
    await t.run((ctx) =>
      insertTestCard(ctx, {
        selectorOptionId: s.base,
        cardNumber: "1",
        cardName: "Card",
        platformData: {},
        sortOrder: 0,
        lastUpdated: Date.now(),
        teamOnCardIds: [s.early],
      }),
    );

    const result = await gate(t, s, [card(["Ken Boyer"], 1)]);

    expect(result.unknownTeams).toEqual([]);
    const rows = await teamRows(t, result.batchId);
    expect(rows).toHaveLength(1);
    expect(rows[0].decision).toMatchObject({ linkedTeamId: s.late, autoLinked: "careerTeam" });
  });

  test("a player with stints on BOTH eras is a tie: the operator is asked", async () => {
    const t = newT();
    const s = await setup(t);
    await player(t, s.sportId, "Satchel Paige", [s.early, s.late]);

    const result = await gate(t, s, [card(["Satchel Paige"], 1)]);

    expect(result.unknownTeams).toEqual([TEAM_NAME]);
    const rows = await teamRows(t, result.batchId);
    expect(rows.some((r) => r.decision?.autoLinked === "careerTeam")).toBe(false);
  });

  test("a stint dated outside the era is no evidence: the operator is asked", async () => {
    const t = newT();
    const s = await setup(t);
    await t.run((ctx) =>
      ctx.db.insert("players", {
        name: "Satchel Paige",
        nameNormalized: normalizePlayerName("Satchel Paige"),
        sportId: s.sportId,
        teamYears: [{ teamId: s.early, fromYear: 1990, toYear: 1995 }],
        lastUpdated: Date.now(),
      }),
    );

    const result = await gate(t, s, [card(["Satchel Paige"], 1)]);

    expect(result.unknownTeams).toEqual([TEAM_NAME]);
  });

  test("a team name printed on exactly the card bound is still settled by players", async () => {
    const t = newT();
    const s = await setup(t);
    await player(t, s.sportId, "Satchel Paige", [s.early]);

    const result = await gate(
      t,
      s,
      Array.from({ length: CARD_PLAYER_TEAM_MAX_CARDS }, (_, i) => card(["Satchel Paige"], i + 1)),
    );

    expect(result.unknownTeams).toEqual([]);
    expect((await teamRows(t, result.batchId))[0]?.decision?.autoLinked).toBe("careerTeam");
  });

  test("a team name printed on more than the card bound is never sent to the query", async () => {
    const t = newT();
    const s = await setup(t);
    await player(t, s.sportId, "Satchel Paige", [s.early]);

    const result = await gate(
      t,
      s,
      Array.from({ length: CARD_PLAYER_TEAM_MAX_CARDS + 1 }, (_, i) =>
        card(["Satchel Paige"], i + 1),
      ),
    );

    expect(result.unknownTeams).toEqual([TEAM_NAME]);
    const rows = await teamRows(t, result.batchId);
    expect(rows.some((r) => r.decision?.autoLinked === "careerTeam")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// NEO-602 - "Oakland Athletics": the 1968-2024 row's own name and the 2025-
// Athletics row's alias, on a 2025 set.
// ---------------------------------------------------------------------------

describe("the gate: a name that is one row's own name and another's alias (NEO-602)", () => {
  const NAME = "Oakland Athletics";

  async function athleticsSetup(t: T) {
    const sportId = await node(t, { level: "sport", value: "Baseball" });
    const year = await node(t, { level: "year", value: "2025", parentId: sportId });
    const brand = await node(t, { level: "manufacturer", value: "Topps", parentId: year });
    const set = await node(t, { level: "setName", value: "Series 1", parentId: brand });
    const base = await node(t, { level: "variantType", value: "Base", parentId: set });
    const insert = await node(t, { level: "variantType", value: "Insert", parentId: set });
    const oakland = await t.run((ctx) =>
      ctx.db.insert("teams", {
        location: "Oakland",
        name: "Athletics",
        nameNormalized: normalizeTeamName(NAME),
        sportId,
        yearsActive: { from: 1968, to: 2024 },
        lastUpdated: Date.now(),
      }),
    );
    const athletics = await t.run(async (ctx) => {
      const id = await ctx.db.insert("teams", {
        name: "Athletics",
        nameNormalized: normalizeTeamName("Athletics"),
        sportId,
        yearsActive: { from: 2025 },
        aliases: [NAME],
        lastUpdated: Date.now(),
      });
      await ctx.db.insert("teamAliases", {
        teamId: id,
        sportId,
        aliasNormalized: normalizeTeamName(NAME),
      });
      return id;
    });
    return { sportId, base, insert, oakland, athletics };
  }

  const athleticsCard = (players: string[], n: number) => ({
    cardNumber: `A-${n}`,
    cardName: "Card",
    players,
    teams: [NAME],
    platformData: {},
  });

  /** A player with explicit stints (the helper above dates them from the era). */
  const withStints = (
    t: T,
    sportId: Sel,
    name: string,
    teamYears: Array<{ teamId: Id<"teams">; fromYear: number; toYear: number }>,
  ) =>
    t.run((ctx) =>
      ctx.db.insert("players", {
        name,
        nameNormalized: normalizePlayerName(name),
        sportId,
        teamYears,
        lastUpdated: Date.now(),
      }),
    );

  test("Rickey Henderson (Oakland 1979-84, 1989-93) on a 2025 card: a visible careerTeam row to Oakland, against the year", async () => {
    const t = newT();
    const s = await athleticsSetup(t);
    await withStints(t, s.sportId, "Rickey Henderson", [
      { teamId: s.oakland, fromYear: 1979, toYear: 1984 },
      { teamId: s.oakland, fromYear: 1989, toYear: 1993 },
    ]);

    const result = await gate(t, s, [athleticsCard(["Rickey Henderson"], 1)]);

    expect(result.unknownTeams).toEqual([]);
    const rows = await teamRows(t, result.batchId);
    expect(rows).toHaveLength(1);
    expect(rows[0].decision).toMatchObject({
      action: "link",
      linkedTeamId: s.oakland,
      autoLinked: "careerTeam",
    });
  });

  test("a player of the 2025- Athletics agrees with the year: linked silently, no team row", async () => {
    const t = newT();
    const s = await athleticsSetup(t);
    await withStints(t, s.sportId, "Jacob Wilson", [
      { teamId: s.athletics, fromYear: 2025, toYear: 2025 },
    ]);

    const result = await gate(t, s, [athleticsCard(["Jacob Wilson"], 1)]);

    expect(result.unknownTeams).toEqual([]);
    expect(await teamRows(t, result.batchId)).toEqual([]);
  });

  test("a card with no player evidence is NOT silently linked to the alias-only Athletics: the operator is asked", async () => {
    const t = newT();
    const s = await athleticsSetup(t);

    const result = await gate(t, s, [athleticsCard([], 1)]);

    expect(result.unknownTeams).toEqual([NAME]);
    expect((await teamRows(t, result.batchId)).every((r) => r.decision === undefined)).toBe(true);
  });

  test("an ambiguous name skips set history even when a committed card names one row", async () => {
    const t = newT();
    const s = await athleticsSetup(t);
    await t.run((ctx) =>
      insertTestCard(ctx, {
        selectorOptionId: s.base,
        cardNumber: "1",
        cardName: "Card",
        platformData: {},
        sortOrder: 0,
        lastUpdated: Date.now(),
        teamOnCardIds: [s.oakland],
      }),
    );

    const result = await gate(t, s, [athleticsCard([], 1)]);

    expect(result.unknownTeams).toEqual([NAME]);
    expect((await teamRows(t, result.batchId)).some((r) => r.decision?.autoLinked === "setHistory")).toBe(false);
  });

  test("a player on both rows is a tie: the operator is asked", async () => {
    const t = newT();
    const s = await athleticsSetup(t);
    await withStints(t, s.sportId, "Tied Player", [
      { teamId: s.oakland, fromYear: 2020, toYear: 2024 },
      { teamId: s.athletics, fromYear: 2025, toYear: 2025 },
    ]);

    const result = await gate(t, s, [athleticsCard(["Tied Player"], 1)]);

    expect(result.unknownTeams).toEqual([NAME]);
  });

  test("resolveGateTeamNames: the shape of each answer", async () => {
    const t = newT();
    const s = await athleticsSetup(t);
    const rickey = await withStints(t, s.sportId, "Rickey Henderson", [
      { teamId: s.oakland, fromYear: 1979, toYear: 1984 },
    ]);
    const askNames = (
      asks: Array<{ name: string; cardPlayerIds?: Id<"players">[][] }>,
      setYear: number | undefined = 2025,
    ) =>
      t.query(internal.selectorOptions.resolveGateTeamNames, {
        sportId: s.sportId,
        ...(setYear !== undefined ? { setYear } : {}),
        asks,
      });
    const ask = async (cardPlayerIds?: Id<"players">[][], setYear: number | undefined = 2025) =>
      (await askNames([{ name: NAME, ...(cardPlayerIds ? { cardPlayerIds } : {}) }], setYear))[0];

    const byPlayers = await ask([[rickey]]);
    expect(byPlayers.ambiguous).toBe(false);
    expect(byPlayers.answer).toMatchObject({
      teamId: s.oakland,
      via: "players",
      agreesWithYear: false,
      fullName: "Oakland Athletics",
    });
    // No players: the alias-only year pick is refused, and flagged ambiguous.
    // (NEO-602: and the two rows it reached, for the team step to offer.)
    const noPlayers = await ask(undefined);
    expect(noPlayers).toMatchObject({ answer: null, ambiguous: true });
    expect([...noPlayers.candidateTeamIds].sort()).toEqual([s.oakland, s.athletics].sort());
    // A 2000 set: the year lands on Oakland, which owns the name.
    const byYear = await ask(undefined, 2000);
    expect(byYear.answer).toMatchObject({ teamId: s.oakland, via: "year", agreesWithYear: true });
    // A name no row holds: no answer, and nothing ambiguous about it.
    expect(await askNames([{ name: "Nowhere Nobodies" }])).toEqual([
      { answer: null, ambiguous: false, candidateTeamIds: [] },
    ]);
    // And the batch answers each ask in place, whatever the others hold.
    const batch = await askNames([
      { name: "Nowhere Nobodies" },
      { name: NAME, cardPlayerIds: [[rickey]] },
      { name: NAME },
    ]);
    expect(batch.map((b) => b.answer?.teamId ?? null)).toEqual([null, s.oakland, null]);
  });

  test("resolveGateTeamNames: a LONE row that begins after the set year is no answer, but not ambiguous (set history may still help)", async () => {
    const t = newT();
    const s = await athleticsSetup(t);
    // "Athletics" is the 2025- row's own name and nobody else's; a 1990 set
    // is before it began, and nothing shows a team's future.
    const [answer] = await t.query(internal.selectorOptions.resolveGateTeamNames, {
      sportId: s.sportId,
      setYear: 1990,
      asks: [{ name: "Athletics" }],
    });
    expect(answer).toEqual({ answer: null, ambiguous: false, candidateTeamIds: [] });
  });
});
