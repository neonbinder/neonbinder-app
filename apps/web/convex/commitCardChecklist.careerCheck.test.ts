/**
 * NEO-574 — the commit side of the wizard's "career check".
 *
 * Two answers reach the commit: `careerStints` (add a stint to an existing
 * player; its own phase after the prelude's resolve walk) and a card's
 * `playerIdByName` (link THIS card's printed name to a different existing
 * player, mirroring `teamIds`). Both are client-chosen ids, so both are
 * re-validated before any phase writes, and a refusal writes nothing.
 */
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { normalizeTeamName } from "./teams";
import { normalizePlayerName, MAX_CAREER_STINT_APPENDS, MAX_PLAYER_TEAM_YEARS } from "./players";
import { maxCareerYear } from "../lib/players/career-years";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const ADMIN = {
  subject: "admin_career_commit_001",
  issuer: "https://clerk.example.com",
  tokenIdentifier: "clerk|admin_career_commit_001",
  name: "Admin User",
  role: "admin",
};

type T = ReturnType<typeof convexTest>;

async function seedSet(t: T, name = "Baseball", year = "1990") {
  return t.run(async (ctx) => {
    const now = Date.now();
    const sportId = await ctx.db.insert("selectorOptions", {
      level: "sport",
      value: name,
      sportConfig: { skuCode: name === "Baseball" ? "BB" : "FB", league: "MLB" },
      platformData: {},
      children: [],
      lastUpdated: now,
    });
    const yearId = await ctx.db.insert("selectorOptions", {
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
      parentId: yearId,
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
    await ctx.db.patch(yearId, { children: [setNameId] });
    await ctx.db.patch(sportId, { children: [yearId] });
    return { sportId, leafId };
  });
}

function insertTeam(
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

function insertPlayer(
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

/**
 * NEO-602 — "Oakland Athletics" is the Oakland row's own name (1968-2024) and,
 * from 2025, an alias of the Athletics (own name "Athletics"). On a 2025 set
 * the year alone points at the Athletics through an alias, which the card rule
 * refuses while another row holds the name as its own; a player's career is
 * what may settle it.
 */
const TWO_ERA_NAME = "Oakland Athletics";

async function seedTwoEraTeams(t: T, sportId: Id<"selectorOptions">) {
  const oakland = await t.run((ctx) =>
    ctx.db.insert("teams", {
      location: "Oakland",
      name: "Athletics",
      nameNormalized: normalizeTeamName(TWO_ERA_NAME),
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
      aliases: [TWO_ERA_NAME],
      lastUpdated: Date.now(),
    });
    await ctx.db.insert("teamAliases", {
      teamId: id,
      sportId,
      aliasNormalized: normalizeTeamName(TWO_ERA_NAME),
    });
    return id;
  });
  return { oakland, athletics };
}

type CardOverrides = {
  cardNumber?: string;
  players?: string[];
  teams?: string[];
  teamIds?: Id<"teams">[];
  playerIdByName?: Array<{ name: string; playerId: Id<"players"> }>;
};

function makeCard(o: CardOverrides = {}) {
  return {
    cardNumber: o.cardNumber ?? "1",
    cardName: "Card",
    team: undefined,
    teams: o.teams ?? [],
    players: o.players ?? [],
    attributes: [],
    isRookie: false,
    isRelic: false,
    printRun: undefined,
    autographType: undefined,
    cardVariation: undefined,
    platformData: {},
    unmatched: undefined,
    ...(o.teamIds ? { teamIds: o.teamIds } : {}),
    ...(o.playerIdByName ? { playerIdByName: o.playerIdByName } : {}),
  };
}

type Careers = Array<{
  playerId: Id<"players">;
  teamId?: Id<"teams">;
  teamName?: string;
  fromYear: number;
  toYear?: number;
}>;

function commit(
  t: T,
  ids: { sportId: Id<"selectorOptions">; leafId: Id<"selectorOptions"> },
  cards: ReturnType<typeof makeCard>[],
  extra: { careerStints?: Careers; batchId?: string } = {},
) {
  return t.withIdentity(ADMIN).action(api.selectorOptions.commitCardChecklist, {
    selectorOptionId: ids.leafId,
    sportId: ids.sportId,
    cards,
    ...extra,
  });
}

function cardsOf(t: T, leafId: Id<"selectorOptions">) {
  return t.run((ctx) =>
    ctx.db
      .query("cardChecklist")
      .withIndex("by_selector_option", (q) => q.eq("selectorOptionId", leafId))
      .collect(),
  );
}

function teamYearsOf(t: T, id: Id<"players">) {
  return t.run(async (ctx) => (await ctx.db.get(id))?.teamYears ?? []);
}

describe("commitCardChecklist — careerStints", () => {
  test("appends the stint to an existing player in canonical order, and a retry adds nothing twice", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedSet(t);
    const padres = await insertTeam(t, ids.sportId, "San Diego", "Padres");
    const cubs = await insertTeam(t, ids.sportId, "Chicago", "Cubs");
    const gwynn = await insertPlayer(t, ids.sportId, "Tony Gwynn", [{ teamId: cubs, fromYear: 1985, toYear: 1986 }]);
    const stints: Careers = [{ playerId: gwynn, teamId: padres, fromYear: 1982, toYear: 1984 }];

    const first = await commit(t, ids, [makeCard({ players: ["Tony Gwynn"], teams: ["San Diego Padres"] })], {
      careerStints: stints,
    });
    expect(first.careerStints).toEqual({ added: 1, existing: 0, skipped: 0 });
    expect(await teamYearsOf(t, gwynn)).toEqual([
      { teamId: padres, fromYear: 1982, toYear: 1984 },
      { teamId: cubs, fromYear: 1985, toYear: 1986 },
    ]);

    // The same commit again: the (team, fromYear) key already exists.
    const retry = await commit(t, ids, [makeCard({ players: ["Tony Gwynn"], teams: ["San Diego Padres"] })], {
      careerStints: stints,
    });
    expect(retry.careerStints).toEqual({ added: 0, existing: 1, skipped: 0 });
    expect(await teamYearsOf(t, gwynn)).toHaveLength(2);
  });



  test("stints for several players in one commit each land on their own player", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedSet(t);
    const padres = await insertTeam(t, ids.sportId, "San Diego", "Padres");
    const cubs = await insertTeam(t, ids.sportId, "Chicago", "Cubs");
    const gwynn = await insertPlayer(t, ids.sportId, "Tony Gwynn");
    const sandberg = await insertPlayer(t, ids.sportId, "Ryne Sandberg");

    const result = await commit(t, ids, [makeCard({ players: ["Tony Gwynn"] })], {
      careerStints: [
        { playerId: gwynn, teamId: padres, fromYear: 1982 },
        { playerId: sandberg, teamId: cubs, fromYear: 1982 },
        { playerId: gwynn, teamId: cubs, fromYear: 1999, toYear: 2000 },
      ],
    });

    expect(result.careerStints).toEqual({ added: 3, existing: 0, skipped: 0 });
    expect(await teamYearsOf(t, gwynn)).toEqual([
      { teamId: padres, fromYear: 1982 },
      { teamId: cubs, fromYear: 1999, toYear: 2000 },
    ]);
    expect(await teamYearsOf(t, sandberg)).toEqual([{ teamId: cubs, fromYear: 1982 }]);
  });

  test("one unresolvable stint among several is skipped and counted; the rest still land", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedSet(t);
    const padres = await insertTeam(t, ids.sportId, "San Diego", "Padres");
    const gwynn = await insertPlayer(t, ids.sportId, "Tony Gwynn");

    const result = await commit(t, ids, [makeCard({ players: ["Tony Gwynn"] })], {
      careerStints: [
        { playerId: gwynn, teamId: padres, fromYear: 1982 },
        { playerId: gwynn, teamName: "Nobody Heard Of Them", fromYear: 1988 },
        { playerId: gwynn, teamId: padres, fromYear: 1990 },
      ],
    });

    expect(result.careerStints).toEqual({ added: 2, existing: 0, skipped: 1 });
    expect(await teamYearsOf(t, gwynn)).toEqual([
      { teamId: padres, fromYear: 1982 },
      { teamId: padres, fromYear: 1990 },
    ]);
  });

  test("a career already at the cap takes no more: the extra stints are skipped and counted", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedSet(t);
    const padres = await insertTeam(t, ids.sportId, "San Diego", "Padres");
    const full = Array.from({ length: MAX_PLAYER_TEAM_YEARS - 1 }, (_, i) => ({
      teamId: padres,
      fromYear: 1900 + i,
    }));
    const gwynn = await insertPlayer(t, ids.sportId, "Tony Gwynn", full);

    const result = await commit(t, ids, [makeCard({ players: ["Tony Gwynn"] })], {
      careerStints: [
        { playerId: gwynn, teamId: padres, fromYear: 1990 },
        { playerId: gwynn, teamId: padres, fromYear: 1991 },
      ],
    });

    expect(result.careerStints).toEqual({ added: 1, existing: 0, skipped: 1 });
    expect(await teamYearsOf(t, gwynn)).toHaveLength(MAX_PLAYER_TEAM_YEARS);
  });

  test("a stint naming a printed team that resolves to nothing is skipped and counted, never guessed", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedSet(t);
    const gwynn = await insertPlayer(t, ids.sportId, "Tony Gwynn");

    const result = await commit(t, ids, [makeCard({ players: ["Tony Gwynn"] })], {
      careerStints: [{ playerId: gwynn, teamName: "Nobody Heard Of Them", fromYear: 1988 }],
    });

    expect(result.careerStints).toEqual({ added: 0, existing: 0, skipped: 1 });
    expect(await teamYearsOf(t, gwynn)).toEqual([]);
  });

  test("a stint for a player who vanished is skipped; the rest of the commit lands", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedSet(t);
    const padres = await insertTeam(t, ids.sportId, "San Diego", "Padres");
    const gone = await insertPlayer(t, ids.sportId, "Gone Player");
    await t.run((ctx) => ctx.db.delete(gone));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = await commit(t, ids, [makeCard({ players: ["Somebody"] })], {
        careerStints: [{ playerId: gone, teamId: padres, fromYear: 1988 }],
      });
      expect(result.success).toBe(true);
      expect(result.careerStints).toEqual({ added: 0, existing: 0, skipped: 1 });
    } finally {
      warn.mockRestore();
    }
    expect(await cardsOf(t, ids.leafId)).toHaveLength(1);
  });

  test("logs ids and counts only, never a name", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedSet(t);
    const padres = await insertTeam(t, ids.sportId, "San Diego", "Padres");
    const gwynn = await insertPlayer(t, ids.sportId, "Tony Gwynn");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await commit(t, ids, [makeCard({ players: ["Tony Gwynn"], teams: ["San Diego Padres"] })], {
        careerStints: [{ playerId: gwynn, teamId: padres, fromYear: 1988 }],
      });
      const lines = log.mock.calls.map((c) => String(c[0])).filter((s) => s.includes("commit_career_stints"));
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0])).toMatchObject({ requested: 1, players: 1, added: 1, existing: 0, skipped: 0 });
      expect(lines[0]).not.toContain("Gwynn");
      expect(lines[0]).not.toContain("Padres");
    } finally {
      log.mockRestore();
    }
  });

  test.each([
    ["both a team id and a team name", (p: Id<"players">, tm: Id<"teams">) => [{ playerId: p, teamId: tm, teamName: "X", fromYear: 1988 }], /exactly one team/],
    ["no team at all", (p: Id<"players">) => [{ playerId: p, fromYear: 1988 }], /exactly one team/],
    ["a blank team name", (p: Id<"players">) => [{ playerId: p, teamName: "  ", fromYear: 1988 }], /exactly one team/],
    ["a start year before the floor", (p: Id<"players">, tm: Id<"teams">) => [{ playerId: p, teamId: tm, fromYear: 1500 }], /fromYear/],
    ["a start year past next year", (p: Id<"players">, tm: Id<"teams">) => [{ playerId: p, teamId: tm, fromYear: maxCareerYear() + 1 }], /fromYear/],
    ["an end year before the start", (p: Id<"players">, tm: Id<"teams">) => [{ playerId: p, teamId: tm, fromYear: 1990, toYear: 1989 }], /toYear/],
  ])("refuses %s before writing anything", async (_label, build, message) => {
    const t = convexTest(schema, modules);
    const ids = await seedSet(t);
    const padres = await insertTeam(t, ids.sportId, "San Diego", "Padres");
    const gwynn = await insertPlayer(t, ids.sportId, "Tony Gwynn");

    await expect(
      commit(t, ids, [makeCard({ players: ["Tony Gwynn"] })], { careerStints: build(gwynn, padres) }),
    ).rejects.toThrow(message);
    expect(await cardsOf(t, ids.leafId)).toEqual([]);
    expect(await teamYearsOf(t, gwynn)).toEqual([]);
  });

  test("refuses more stints than the limit", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedSet(t);
    const padres = await insertTeam(t, ids.sportId, "San Diego", "Padres");
    const gwynn = await insertPlayer(t, ids.sportId, "Tony Gwynn");
    const many: Careers = Array.from({ length: MAX_CAREER_STINT_APPENDS + 1 }, (_, i) => ({
      playerId: gwynn,
      teamId: padres,
      fromYear: 1900 + (i % 100),
    }));
    await expect(commit(t, ids, [makeCard()], { careerStints: many })).rejects.toThrow(/limit/);
  });

  test("refuses a player from another sport, and writes nothing", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedSet(t);
    const football = await seedSet(t, "Football");
    const padres = await insertTeam(t, ids.sportId, "San Diego", "Padres");
    const stranger = await insertPlayer(t, football.sportId, "Gridiron Guy");

    await expect(
      commit(t, ids, [makeCard({ players: ["Somebody"] })], {
        careerStints: [{ playerId: stranger, teamId: padres, fromYear: 1988 }],
      }),
    ).rejects.toThrow(/another sport/);
    expect(await cardsOf(t, ids.leafId)).toEqual([]);
    expect(await teamYearsOf(t, stranger)).toEqual([]);
  });

  test("refuses a team from another sport", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedSet(t);
    const football = await seedSet(t, "Football");
    const foreignTeam = await insertTeam(t, football.sportId, "Green Bay", "Packers");
    const gwynn = await insertPlayer(t, ids.sportId, "Tony Gwynn");

    await expect(
      commit(t, ids, [makeCard()], {
        careerStints: [{ playerId: gwynn, teamId: foreignTeam, fromYear: 1988 }],
      }),
    ).rejects.toThrow(/another sport/);
    expect(await teamYearsOf(t, gwynn)).toEqual([]);
  });
});

describe("commitCardChecklist — a card's playerIdByName", () => {
  test("links THIS card's printed name to the chosen player; the name on the card stays; the title names the chosen player", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedSet(t);
    const printedMatch = await insertPlayer(t, ids.sportId, "Bob Allen");
    const chosen = await insertPlayer(t, ids.sportId, "Robert Allen");

    await commit(t, ids, [
      makeCard({ cardNumber: "1", players: ["Bob Allen"], playerIdByName: [{ name: "Bob Allen", playerId: chosen }] }),
      makeCard({ cardNumber: "2", players: ["Bob Allen"] }),
    ]);

    const cards = await cardsOf(t, ids.leafId);
    const one = cards.find((c) => c.cardNumber === "1")!;
    const two = cards.find((c) => c.cardNumber === "2")!;
    expect(one.playerIds).toEqual([chosen]);
    expect(one.playerLinks).toEqual([{ playerId: chosen, nameOnCard: "Bob Allen" }]);
    expect(one.listingTitle).toContain("Robert Allen");
    expect(one.listingTitle).not.toContain("Bob Allen");
    // The other card, with no override, keeps the name's ordinary resolution.
    expect(two.playerIds).toEqual([printedMatch]);
    expect(two.playerLinks).toEqual([{ playerId: printedMatch, nameOnCard: "Bob Allen" }]);
  });

  test("a name the operator re-linked is not left pending even when nothing else resolved it", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedSet(t);
    const chosen = await insertPlayer(t, ids.sportId, "Robert Allen");

    await commit(t, ids, [
      makeCard({ players: ["Bobby Unknown"], playerIdByName: [{ name: "Bobby Unknown", playerId: chosen }] }),
    ]);

    const [card] = await cardsOf(t, ids.leafId);
    expect(card.playerIds).toEqual([chosen]);
    expect(card.pendingPlayerNames ?? []).toEqual([]);
  });

  test("an override for a name the card does not print changes nothing", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedSet(t);
    const only = await insertPlayer(t, ids.sportId, "Bob Allen");
    const other = await insertPlayer(t, ids.sportId, "Robert Allen");

    await commit(t, ids, [
      makeCard({ players: ["Bob Allen"], playerIdByName: [{ name: "Somebody Else", playerId: other }] }),
    ]);

    const [card] = await cardsOf(t, ids.leafId);
    expect(card.playerIds).toEqual([only]);
  });

  test("an override to a player in another sport refuses the commit and writes nothing", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedSet(t);
    const football = await seedSet(t, "Football");
    const stranger = await insertPlayer(t, football.sportId, "Bob Allen Jr");

    await expect(
      commit(t, ids, [
        makeCard({ players: ["Bob Allen"], playerIdByName: [{ name: "Bob Allen", playerId: stranger }] }),
      ]),
    ).rejects.toThrow(/another sport/);
    expect(await cardsOf(t, ids.leafId)).toEqual([]);
  });

  test("an override to a player deleted since is dropped, and the name resolves as it would have", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedSet(t);
    const only = await insertPlayer(t, ids.sportId, "Bob Allen");
    const gone = await insertPlayer(t, ids.sportId, "Gone Player");
    await t.run((ctx) => ctx.db.delete(gone));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await commit(t, ids, [
        makeCard({ players: ["Bob Allen"], playerIdByName: [{ name: "Bob Allen", playerId: gone }] }),
      ]);
      expect(warn.mock.calls.map((c) => String(c[0])).some((s) => s.includes("commit_operator_player_ids_missing"))).toBe(true);
    } finally {
      warn.mockRestore();
    }
    const [card] = await cardsOf(t, ids.leafId);
    expect(card.playerIds).toEqual([only]);
  });

  test("a re-link onto the player another name on the card already resolves to is written once", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedSet(t);
    const bob = await insertPlayer(t, ids.sportId, "Bob Allen");
    const jim = await insertPlayer(t, ids.sportId, "Jim Beam");

    // "Jim Beam" resolves to jim; the operator re-linked "Bob Allen" to jim too.
    await commit(t, ids, [
      makeCard({
        players: ["Jim Beam", "Bob Allen"],
        playerIdByName: [{ name: "Bob Allen", playerId: jim }],
      }),
    ]);

    const [card] = await cardsOf(t, ids.leafId);
    expect(card.playerIds).toEqual([jim]);
    expect(card.playerLinks).toEqual([{ playerId: jim, nameOnCard: "Jim Beam" }]);
    expect(card.playerIds).not.toContain(bob);
  });

  test("the same collision in the other order (re-link first) is also written once", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedSet(t);
    await insertPlayer(t, ids.sportId, "Bob Allen");
    const jim = await insertPlayer(t, ids.sportId, "Jim Beam");

    await commit(t, ids, [
      makeCard({
        players: ["Bob Allen", "Jim Beam"],
        playerIdByName: [{ name: "Bob Allen", playerId: jim }],
      }),
    ]);

    const [card] = await cardsOf(t, ids.leafId);
    expect(card.playerIds).toEqual([jim]);
    expect(card.playerLinks).toHaveLength(1);
  });

  test("two names re-linked to one player give that player one link", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedSet(t);
    const jim = await insertPlayer(t, ids.sportId, "Jim Beam");

    await commit(t, ids, [
      makeCard({
        players: ["Bobby One", "Bobby Two"],
        playerIdByName: [
          { name: "Bobby One", playerId: jim },
          { name: "Bobby Two", playerId: jim },
        ],
      }),
    ]);

    const [card] = await cardsOf(t, ids.leafId);
    expect(card.playerIds).toEqual([jim]);
    expect(card.playerLinks).toEqual([{ playerId: jim, nameOnCard: "Bobby One" }]);
    // The skipped name was not answered by anything, so it is still pending.
    expect(card.pendingPlayerNames ?? []).toContain("Bobby Two");
  });

  test("more re-links than a card may print is refused", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedSet(t);
    const p = await insertPlayer(t, ids.sportId, "Bob Allen");
    const many = Array.from({ length: 40 }, (_, i) => ({ name: `Name ${i}`, playerId: p }));
    await expect(commit(t, ids, [makeCard({ playerIdByName: many })])).rejects.toThrow(/re-links/);
  });
});

describe("commitCardChecklist — a card's playerIdByName and a two-era team name", () => {
  test("the chosen player's career decides the era, not the career of the player the printed name ordinarily resolves to", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedSet(t, "Baseball", "2025");
    const { oakland, athletics } = await seedTwoEraTeams(t, ids.sportId);
    // The printed name resolves to a namesake whose career is Oakland's; the
    // operator linked this card to Jacob Wilson, whose career is the Athletics'.
    await insertPlayer(t, ids.sportId, "Bob Allen", [{ teamId: oakland, fromYear: 1979, toYear: 1984 }]);
    const chosen = await insertPlayer(t, ids.sportId, "Jacob Wilson", [{ teamId: athletics, fromYear: 2025 }]);

    const result = await commit(t, ids, [
      makeCard({
        cardNumber: "1",
        players: ["Bob Allen"],
        teams: [TWO_ERA_NAME],
        playerIdByName: [{ name: "Bob Allen", playerId: chosen }],
      }),
    ]);

    expect(result.unreviewedNameCount).toBe(0);
    const [card] = await cardsOf(t, ids.leafId);
    expect(card.playerIds).toEqual([chosen]);
    expect(card.teamOnCardIds).toEqual([athletics]);
  });

  test("an ordinary card with the same name still reads the namesake's career (Oakland's, which the year does not back: not linked)", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedSet(t, "Baseball", "2025");
    const { oakland } = await seedTwoEraTeams(t, ids.sportId);
    await insertPlayer(t, ids.sportId, "Bob Allen", [{ teamId: oakland, fromYear: 1979, toYear: 1984 }]);

    const result = await commit(t, ids, [
      makeCard({ cardNumber: "1", players: ["Bob Allen"], teams: [TWO_ERA_NAME] }),
    ]);

    expect(result.unreviewedNameCount).toBe(1);
    const [card] = await cardsOf(t, ids.leafId);
    expect(card.teamOnCardIds ?? []).toEqual([]);
  });

  test("an override to a player deleted since is dropped from the evidence: the name's own resolution decides", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedSet(t, "Baseball", "2025");
    const { athletics } = await seedTwoEraTeams(t, ids.sportId);
    await insertPlayer(t, ids.sportId, "Bob Allen", [{ teamId: athletics, fromYear: 2025 }]);
    const gone = await insertPlayer(t, ids.sportId, "Jacob Wilson");
    await t.run((ctx) => ctx.db.delete(gone));

    const result = await commit(t, ids, [
      makeCard({
        cardNumber: "1",
        players: ["Bob Allen"],
        teams: [TWO_ERA_NAME],
        playerIdByName: [{ name: "Bob Allen", playerId: gone }],
      }),
    ]);

    expect(result.unreviewedNameCount).toBe(0);
    const [card] = await cardsOf(t, ids.leafId);
    expect(card.teamOnCardIds).toEqual([athletics]);
  });
});

describe("the prelude's rule 6b reads the shared coverage rule through the commit", () => {
  test("the franchise leg links the namesake who played for another row of the card's franchise", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedSet(t, "Baseball", "1999");
    const franchiseId = await t.run((ctx) =>
      ctx.db.insert("franchises", {
        name: "Titans / Oilers",
        nameNormalized: "oilers titans",
        sportId: ids.sportId,
        lastUpdated: Date.now(),
      }),
    );
    const oilers = await insertTeam(t, ids.sportId, "Houston", "Oilers", franchiseId);
    await insertTeam(t, ids.sportId, "Tennessee", "Titans", franchiseId);
    const cubs = await insertTeam(t, ids.sportId, "Chicago", "Cubs");
    const oiler = await insertPlayer(t, ids.sportId, "Bob Allen", [{ teamId: oilers, fromYear: 1930, toYear: 1937 }]);
    await insertPlayer(t, ids.sportId, "Bob Allen", [{ teamId: cubs, fromYear: 1930, toYear: 1937 }]);

    await commit(t, ids, [makeCard({ players: ["Bob Allen"], teams: ["Tennessee Titans"] })]);

    const [card] = await cardsOf(t, ids.leafId);
    expect(card.playerIds).toEqual([oiler]);
  });
});

describe("players.appendCareerStints", () => {
  test("skips a team from a sport the player does not play and respects the career cap", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedSet(t);
    const football = await seedSet(t, "Football");
    const padres = await insertTeam(t, ids.sportId, "San Diego", "Padres");
    const packers = await insertTeam(t, football.sportId, "Green Bay", "Packers");
    const gwynn = await insertPlayer(t, ids.sportId, "Tony Gwynn");

    const out = await t.mutation(internal.players.appendCareerStints, {
      stints: [
        { playerId: gwynn, teamId: padres, fromYear: 1982 },
        { playerId: gwynn, teamId: packers, fromYear: 1983 },
      ],
    });
    expect(out).toEqual({ added: 1, existing: 0, skipped: 1 });

    // Fill to the cap: the 65th is skipped, not written.
    const filler = await insertPlayer(
      t,
      ids.sportId,
      "Full Career",
      Array.from({ length: MAX_PLAYER_TEAM_YEARS }, (_, i) => ({ teamId: padres, fromYear: 1900 + i })),
    );
    const over = await t.mutation(internal.players.appendCareerStints, {
      stints: [{ playerId: filler, teamId: padres, fromYear: 1999 }],
    });
    expect(over).toEqual({ added: 0, existing: 0, skipped: 1 });
    expect(await teamYearsOf(t, filler)).toHaveLength(MAX_PLAYER_TEAM_YEARS);
  });

  test("never edits or removes an existing stint, and refuses years outside the bounds", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedSet(t);
    const padres = await insertTeam(t, ids.sportId, "San Diego", "Padres");
    const undated = await insertPlayer(t, ids.sportId, "Undated Guy", [{ teamId: padres }]);

    await t.mutation(internal.players.appendCareerStints, {
      stints: [{ playerId: undated, teamId: padres, fromYear: 1990, toYear: 1991 }],
    });
    // The undated stint stays, after the dated one (the one canonical order).
    expect(await teamYearsOf(t, undated)).toEqual([
      { teamId: padres, fromYear: 1990, toYear: 1991 },
      { teamId: padres },
    ]);
    await expect(
      t.mutation(internal.players.appendCareerStints, {
        stints: [{ playerId: undated, teamId: padres, fromYear: 1200 }],
      }),
    ).rejects.toThrow(/fromYear/);
  });
});

describe("players.appendCareerStints adversarial", () => {
  test("the same stint twice in one call is added once and counted existing once", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedSet(t);
    const padres = await insertTeam(t, ids.sportId, "San Diego", "Padres");
    const gwynn = await insertPlayer(t, ids.sportId, "Tony Gwynn");
    const out = await t.mutation(internal.players.appendCareerStints, {
      stints: [
        { playerId: gwynn, teamId: padres, fromYear: 1982 },
        { playerId: gwynn, teamId: padres, fromYear: 1982, toYear: 1990 },
      ],
    });
    expect(out).toEqual({ added: 1, existing: 1, skipped: 0 });
    expect(await teamYearsOf(t, gwynn)).toEqual([{ teamId: padres, fromYear: 1982 }]);
  });

  test("an existing (team, year) with a different end year is left exactly as it was", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedSet(t);
    const padres = await insertTeam(t, ids.sportId, "San Diego", "Padres");
    const gwynn = await insertPlayer(t, ids.sportId, "Tony Gwynn", [{ teamId: padres, fromYear: 1982, toYear: 1985 }]);
    const out = await t.mutation(internal.players.appendCareerStints, {
      stints: [{ playerId: gwynn, teamId: padres, fromYear: 1982, toYear: 2001 }],
    });
    expect(out).toEqual({ added: 0, existing: 1, skipped: 0 });
    expect(await teamYearsOf(t, gwynn)).toEqual([{ teamId: padres, fromYear: 1982, toYear: 1985 }]);
  });

  test("a deleted team is skipped and counted, never written", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedSet(t);
    const ghost = await insertTeam(t, ids.sportId, "Gone", "Ghosts");
    await t.run((ctx) => ctx.db.delete(ghost));
    const gwynn = await insertPlayer(t, ids.sportId, "Tony Gwynn");
    const out = await t.mutation(internal.players.appendCareerStints, {
      stints: [{ playerId: gwynn, teamId: ghost, fromYear: 1982 }],
    });
    expect(out).toEqual({ added: 0, existing: 0, skipped: 1 });
    expect(await teamYearsOf(t, gwynn)).toEqual([]);
  });

  test("toYear before fromYear is refused and nothing is written for the other stints either", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedSet(t);
    const padres = await insertTeam(t, ids.sportId, "San Diego", "Padres");
    const gwynn = await insertPlayer(t, ids.sportId, "Tony Gwynn");
    await expect(
      t.mutation(internal.players.appendCareerStints, {
        stints: [
          { playerId: gwynn, teamId: padres, fromYear: 1982 },
          { playerId: gwynn, teamId: padres, fromYear: 1990, toYear: 1985 },
        ],
      }),
    ).rejects.toThrow(/toYear/);
    expect(await teamYearsOf(t, gwynn)).toEqual([]);
  });

  test("exactly the stint limit is accepted; one more is refused", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedSet(t);
    const padres = await insertTeam(t, ids.sportId, "San Diego", "Padres");
    const gwynn = await insertPlayer(t, ids.sportId, "Tony Gwynn");
    const mk = (n: number) =>
      Array.from({ length: n }, () => ({ playerId: gwynn, teamId: padres, fromYear: 1982 }));
    const ok = await t.mutation(internal.players.appendCareerStints, { stints: mk(MAX_CAREER_STINT_APPENDS) });
    expect(ok.added + ok.existing + ok.skipped).toBe(MAX_CAREER_STINT_APPENDS);
    await expect(
      t.mutation(internal.players.appendCareerStints, { stints: mk(MAX_CAREER_STINT_APPENDS + 1) }),
    ).rejects.toThrow(/limit/);
  });
});
