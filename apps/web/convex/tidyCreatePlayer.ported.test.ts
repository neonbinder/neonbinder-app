/**
 * NEO-645 — ported from the retired `create` decision of the batch wizard
 * (commitCardChecklist.entityReview / careerCheck / careerNewPlayer /
 * crossSportOverride / playerNameFragment tests).
 *
 * A player is created when the operator presses "Add as new player"
 * (`tidyNames.createPlayer`), never at commit. Its career is the lookup's
 * careerTeams that MATCH a team we hold (NEO-236: a stint at a team nobody
 * reviewed is dropped, not invented); a stint the operator types goes in
 * through `players.addStint`; a team the operator makes goes through
 * `teams.findOrCreate` first.
 *
 * Every test drives the real chain: a commit leaves the name unanswered
 * (stamped on the card, printed row written), then the tile's own mutation acts
 * on the open card.
 */

import { convexTest } from "convex-test";
import { afterEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { cancelScheduled } from "../lib/testing/drain-scheduled";
import { normalizeEntityName } from "../lib/entities/normalize-name";
import {
  ADMIN,
  allOf,
  commit,
  makeCard,
  readCards,
  seedLeaf,
  seedTeam,
  seedUnansweredName,
  type T,
} from "../lib/testing/tidy-ported";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const live: T[] = [];
function newT(): T {
  const t = convexTest(schema, modules);
  live.push(t);
  return t;
}
afterEach(async () => {
  for (const t of live.splice(0)) await cancelScheduled(t);
});

/** One leaf, an unanswered `ready` name row, one card printing the name. */
async function openCard(t: T, name: string, enrichment?: Record<string, unknown>) {
  const s = await seedLeaf(t);
  await seedUnansweredName(t, {
    scopeId: s.variantTypeId,
    sportId: s.sportId,
    kind: "player",
    name,
    enrichment,
  });
  await commit(t, s, [makeCard({ cardNumber: "1", cardName: name, players: [name] })]);
  const [card] = await readCards(t, s.variantTypeId);
  return { ...s, card };
}

const create = (t: T, cardId: Id<"cardChecklist">, name: string, extra: Record<string, unknown> = {}) =>
  t.withIdentity(ADMIN).mutation(api.tidyNames.createPlayer, { cardId, name, ...extra });

const addStint = (
  t: T,
  s: {
    cardId: Id<"cardChecklist">;
    playerId: Id<"players">;
    teamId: Id<"teams">;
    fromYear: number;
    toYear?: number;
  },
) => t.withIdentity(ADMIN).mutation(api.players.addStint, s);

const playerRow = (t: T, id: Id<"players">) => t.run((ctx) => ctx.db.get(id));

describe("tidyNames.createPlayer — what the lookup's career becomes (was: a player 'create' decision)", () => {
  test("a Hall of Famer with a Wikidata id and two held teams is created with chronological teamYears, mints no team, and links the card", async () => {
    const t = newT();
    const s = await openCard(t, "Mike Trout", {
      wikidataId: "Q123456",
      isHallOfFame: true,
      // Latest first on purpose: the assertion is about the sort, not the input.
      careerTeams: [
        { name: "Los Angeles Angels", fromYear: 2011 },
        { name: "Los Angeles Angels of Anaheim", fromYear: 2005, toYear: 2010 },
      ],
    });
    const angels = await seedTeam(t, s.sportId, { name: "Los Angeles Angels" });
    const anaheim = await seedTeam(t, s.sportId, { name: "Los Angeles Angels of Anaheim" });

    const { playerId } = await create(t, s.card._id, "Mike Trout");

    const player = (await playerRow(t, playerId))!;
    expect(player.isHallOfFame).toBe(true);
    expect(player.externalIds?.wikidataId).toBe("Q123456");
    expect(player.teamYears).toEqual([
      { teamId: anaheim, fromYear: 2005, toYear: 2010 },
      { teamId: angels, fromYear: 2011 },
    ]);
    // Matched, never created (NEO-236).
    expect(await allOf(t, "teams")).toHaveLength(2);
    const [card] = await readCards(t, s.variantTypeId);
    expect(card.playerIds).toEqual([playerId]);
    expect(card.pendingPlayerNames ?? []).toEqual([]);
  });

  test("a career team that matches no held team is dropped and never minted; the held one stays (was: excludedCareerTeamNames' mint half)", async () => {
    const t = newT();
    const s = await openCard(t, "Mike Trout", {
      careerTeams: [
        { name: "Los Angeles Angels", fromYear: 2011 },
        { name: "Wrong Team FC", fromYear: 1999, toYear: 2001 },
      ],
    });
    const angels = await seedTeam(t, s.sportId, { name: "Los Angeles Angels" });

    const { playerId } = await create(t, s.card._id, "Mike Trout");

    expect((await playerRow(t, playerId))!.teamYears).toEqual([{ teamId: angels, fromYear: 2011 }]);
    expect((await allOf(t, "teams")).map((x) => x.name)).toEqual(["Los Angeles Angels"]);
  });

  test("a career team the operator unticked is left off the player (NEO-212 excludedCareerTeamNames)", async () => {
    const t = newT();
    const s = await openCard(t, "Mike Trout", {
      careerTeams: [
        { name: "Los Angeles Angels", fromYear: 2011 },
        { name: "Salt Lake Bees", fromYear: 2010, toYear: 2010 },
      ],
    });
    const angels = await seedTeam(t, s.sportId, { name: "Los Angeles Angels" });
    await seedTeam(t, s.sportId, { name: "Salt Lake Bees" });

    const { playerId } = await create(t, s.card._id, "Mike Trout", {
      // Case, spacing and an accent do not matter: the shared name matcher decides.
      excludedCareerTeamNames: ["  salt lake  BEES "],
    });

    expect((await playerRow(t, playerId))!.teamYears).toEqual([{ teamId: angels, fromYear: 2011 }]);
    // The unticked team still exists; it is only off THIS player.
    expect(await allOf(t, "teams")).toHaveLength(2);
  });

  test("unticking every career team creates a player with no teamYears", async () => {
    const t = newT();
    const s = await openCard(t, "Mike Trout", {
      careerTeams: [{ name: "Los Angeles Angels", fromYear: 2011 }],
    });
    await seedTeam(t, s.sportId, { name: "Los Angeles Angels" });
    const { playerId } = await create(t, s.card._id, "Mike Trout", {
      excludedCareerTeamNames: ["Los Angeles Angels"],
    });
    expect((await playerRow(t, playerId))!.teamYears).toBeUndefined();
  });

  test("an unticked name that matches nothing is harmless; the career is untouched", async () => {
    const t = newT();
    const s = await openCard(t, "Mike Trout", {
      careerTeams: [{ name: "Los Angeles Angels", fromYear: 2011 }],
    });
    const angels = await seedTeam(t, s.sportId, { name: "Los Angeles Angels" });
    const { playerId } = await create(t, s.card._id, "Mike Trout", {
      excludedCareerTeamNames: ["Somebody Else FC"],
    });
    expect((await playerRow(t, playerId))!.teamYears).toEqual([{ teamId: angels, fromYear: 2011 }]);
  });

  test("the unticked list is bounded and validated, and a refusal writes no player", async () => {
    const t = newT();
    const s = await openCard(t, "Mike Trout", {
      careerTeams: [{ name: "Los Angeles Angels", fromYear: 2011 }],
    });
    await expect(
      create(t, s.card._id, "Mike Trout", {
        excludedCareerTeamNames: Array.from({ length: 65 }, (_, i) => `Team ${i}`),
      }),
    ).rejects.toThrow(/the limit is 64/);
    await expect(
      create(t, s.card._id, "Mike Trout", { excludedCareerTeamNames: ["   "] }),
    ).rejects.toThrow(/has no name/);
    // The refusal carries the length, never the name.
    const long = "X".repeat(121);
    const err = (await create(t, s.card._id, "Mike Trout", { excludedCareerTeamNames: [long] }).catch(
      (e) => e,
    )) as Error;
    expect(String(err.message)).toMatch(/121 characters; the limit is 120/);
    expect(String(err.message)).not.toContain(long);
    expect(await allOf(t, "players")).toHaveLength(0);
  });

  test("a career team matching a held SPLIT row (location + nickname) links to it and creates nothing", async () => {
    const t = newT();
    const s = await openCard(t, "Mike Trout", {
      careerTeams: [{ name: "Los Angeles Angels", fromYear: 2011 }],
    });
    const angels = await seedTeam(t, s.sportId, { location: "Los Angeles", name: "Angels" });

    const { playerId } = await create(t, s.card._id, "Mike Trout");

    expect((await playerRow(t, playerId))!.teamYears).toEqual([{ teamId: angels, fromYear: 2011 }]);
    expect(await allOf(t, "teams")).toHaveLength(1);
  });

  test("two stints at ONE held team are both stored, earliest first, on one team row", async () => {
    const t = newT();
    const s = await openCard(t, "Returning Player", {
      careerTeams: [
        { name: "Los Angeles Angels", fromYear: 2016, toYear: 2019 },
        { name: "Los Angeles Angels", fromYear: 2011, toYear: 2013 },
      ],
    });
    const angels = await seedTeam(t, s.sportId, { name: "Los Angeles Angels" });

    const { playerId } = await create(t, s.card._id, "Returning Player");

    expect((await playerRow(t, playerId))!.teamYears).toEqual([
      { teamId: angels, fromYear: 2011, toYear: 2013 },
      { teamId: angels, fromYear: 2016, toYear: 2019 },
    ]);
    expect(await allOf(t, "teams")).toHaveLength(1);
  });

  test("the lookup's birth year is not written to the new player (NEO-254: it is what tells namesakes apart)", async () => {
    const t = newT();
    const s = await openCard(t, "Mike Trout", { wikidataId: "Q1", birthYear: 1991 });
    const { playerId } = await create(t, s.card._id, "Mike Trout");
    expect((await playerRow(t, playerId))!.birthYear).toBeUndefined();
  });

  test("a lead the lookup could not date (undatedCareerTeams) persists nothing on the player", async () => {
    // was: "a dated lead becomes a stint; one left undated persists nothing".
    const t = newT();
    const s = await openCard(t, "Mike Trout", { undatedCareerTeams: ["Los Angeles Angels"] });
    await seedTeam(t, s.sportId, { name: "Los Angeles Angels" });
    const { playerId } = await create(t, s.card._id, "Mike Trout");
    expect((await playerRow(t, playerId))!.teamYears ?? []).toEqual([]);
  });

  test("the created player's name reaches the generated listing title", async () => {
    const t = newT();
    const s = await openCard(t, "Mike Trout");
    await create(t, s.card._id, "Mike Trout");
    expect((await readCards(t, s.variantTypeId))[0].listingTitle).toContain("Mike Trout");
  });

  test("refuses a name that is not printed on the card, and writes no player", async () => {
    const t = newT();
    const s = await openCard(t, "Mike Trout");
    await expect(create(t, s.card._id, "Somebody Else")).rejects.toThrow(/isn't on this card/);
    expect(await allOf(t, "players")).toHaveLength(0);
  });

  test("refuses a name that already has an answer: Change it first", async () => {
    const t = newT();
    const s = await openCard(t, "Mike Trout");
    await create(t, s.card._id, "Mike Trout");
    await expect(create(t, s.card._id, "Mike Trout")).rejects.toThrow(/already has an answer/);
    expect(await allOf(t, "players")).toHaveLength(1);
  });
});

describe("players.addStint — the operator's own stints (was: decision.manualCareerTeams / careerStints)", () => {
  test("a typed stint at another held team lands AFTER the lookup's, in chronological order", async () => {
    const t = newT();
    const s = await openCard(t, "Daulton Varsho", {
      careerTeams: [{ name: "Arizona Diamondbacks", fromYear: 2020, toYear: 2022 }],
    });
    const dbacks = await seedTeam(t, s.sportId, { name: "Arizona Diamondbacks" });
    const jays = await seedTeam(t, s.sportId, { name: "Toronto Blue Jays" });
    const { playerId } = await create(t, s.card._id, "Daulton Varsho");

    const out = await addStint(t, { cardId: s.card._id, playerId, teamId: jays, fromYear: 2023 });

    expect(out).toEqual({ added: 1, existing: 0, skipped: 0 });
    expect((await playerRow(t, playerId))!.teamYears).toEqual([
      { teamId: dbacks, fromYear: 2020, toYear: 2022 },
      { teamId: jays, fromYear: 2023 },
    ]);
  });

  test("with no lookup at all (no Wikidata match) the career is exactly what the operator typed", async () => {
    const t = newT();
    const s = await openCard(t, "Daulton Varsho");
    const dbacks = await seedTeam(t, s.sportId, { name: "Arizona Diamondbacks" });
    const jays = await seedTeam(t, s.sportId, { name: "Toronto Blue Jays" });
    const { playerId } = await create(t, s.card._id, "Daulton Varsho");
    expect((await playerRow(t, playerId))!.teamYears ?? []).toEqual([]);

    await addStint(t, { cardId: s.card._id, playerId, teamId: jays, fromYear: 2023 });
    await addStint(t, { cardId: s.card._id, playerId, teamId: dbacks, fromYear: 2020, toYear: 2022 });

    expect((await playerRow(t, playerId))!.teamYears).toEqual([
      { teamId: dbacks, fromYear: 2020, toYear: 2022 },
      { teamId: jays, fromYear: 2023 },
    ]);
  });

  test("a stint with a DIFFERENT fromYear at a team the lookup already gave APPENDS instead of replacing", async () => {
    const t = newT();
    const s = await openCard(t, "Returning Player", {
      careerTeams: [{ name: "Los Angeles Angels", fromYear: 2011, toYear: 2013 }],
    });
    const angels = await seedTeam(t, s.sportId, { name: "Los Angeles Angels" });
    const { playerId } = await create(t, s.card._id, "Returning Player");

    await addStint(t, { cardId: s.card._id, playerId, teamId: angels, fromYear: 2016, toYear: 2019 });

    expect((await playerRow(t, playerId))!.teamYears).toEqual([
      { teamId: angels, fromYear: 2011, toYear: 2013 },
      { teamId: angels, fromYear: 2016, toYear: 2019 },
    ]);
  });

  test("the same (team, fromYear) typed again is counted as existing and left as it was: one entry, no duplicate team", async () => {
    // was: "dedupes by resolved teamId, the MANUAL correction wins". The entry
    // is keyed (team, fromYear); a second answer for it never silently
    // overwrites the stored years (NEO-203: no silent rewrite of NB data).
    const t = newT();
    const s = await openCard(t, "Mike Trout", {
      careerTeams: [{ name: "Los Angeles Angels", fromYear: 2011, toYear: 2018 }],
    });
    const angels = await seedTeam(t, s.sportId, { name: "Los Angeles Angels" });
    const { playerId } = await create(t, s.card._id, "Mike Trout");

    const out = await addStint(t, {
      cardId: s.card._id,
      playerId,
      teamId: angels,
      fromYear: 2011,
      toYear: 2019,
    });

    expect(out).toEqual({ added: 0, existing: 1, skipped: 0 });
    expect((await playerRow(t, playerId))!.teamYears).toEqual([
      { teamId: angels, fromYear: 2011, toYear: 2018 },
    ]);
    expect(await allOf(t, "teams")).toHaveLength(1);
  });

  test("several stints for one player all land: a held team, a team made in the New Team form, one team twice, and a repeat counted as existing", async () => {
    // was: careerStints "saved teams by id, a new team by name, one team twice".
    const t = newT();
    const s = await openCard(t, "Tony Gwynn");
    const padres = await seedTeam(t, s.sportId, { location: "San Diego", name: "Padres" });
    const cubs = await seedTeam(t, s.sportId, { location: "Chicago", name: "Cubs" });
    const { playerId } = await create(t, s.card._id, "Tony Gwynn");
    await addStint(t, { cardId: s.card._id, playerId, teamId: cubs, fromYear: 1985, toYear: 1986 });
    // The inline New Team form, then the stint against the team it returned.
    const club = await t
      .withIdentity(ADMIN)
      .mutation(api.teams.findOrCreate, { name: "New Club", location: "Brand", sportId: s.sportId });

    const results = [
      await addStint(t, { cardId: s.card._id, playerId, teamId: padres, fromYear: 1982, toYear: 1984 }),
      await addStint(t, { cardId: s.card._id, playerId, teamId: club, fromYear: 1988 }),
      await addStint(t, { cardId: s.card._id, playerId, teamId: padres, fromYear: 1990, toYear: 1991 }),
      await addStint(t, { cardId: s.card._id, playerId, teamId: cubs, fromYear: 1985, toYear: 1986 }),
    ];

    expect(results.map((r) => [r.added, r.existing, r.skipped])).toEqual([
      [1, 0, 0],
      [1, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
    ]);
    expect((await playerRow(t, playerId))!.teamYears).toEqual([
      { teamId: padres, fromYear: 1982, toYear: 1984 },
      { teamId: cubs, fromYear: 1985, toYear: 1986 },
      { teamId: club, fromYear: 1988 },
      { teamId: padres, fromYear: 1990, toYear: 1991 },
    ]);
  });

  test("a stint lands on the NEW player and never on a same-name player already on file", async () => {
    // was: careerNewPlayers "stints land on the new player ... the namesake
    // never gains any of them".
    const t = newT();
    const s = await seedLeaf(t);
    const cubs = await seedTeam(t, s.sportId, { location: "Chicago", name: "Cubs" });
    const padres = await seedTeam(t, s.sportId, { location: "San Diego", name: "Padres" });
    const namesake = await t.run((ctx) =>
      ctx.db.insert("players", {
        name: "Bob Allen",
        nameNormalized: normalizeEntityName("Bob Allen"),
        sportId: s.sportId,
        teamYears: [{ teamId: cubs, fromYear: 1985, toYear: 1986 }],
        lastUpdated: Date.now(),
      }),
    );
    await seedUnansweredName(t, {
      scopeId: s.variantTypeId,
      sportId: s.sportId,
      kind: "player",
      name: "Bob Allen",
      enrichment: { existingCandidates: [{ playerId: namesake, name: "Bob Allen", careerSummary: "" }] },
    });
    await commit(t, s, [makeCard({ cardNumber: "1", players: ["Bob Allen"] })]);
    const [card] = await readCards(t, s.variantTypeId);

    const { playerId } = await create(t, card._id, "Bob Allen");
    expect(playerId).not.toBe(namesake);
    await addStint(t, { cardId: card._id, playerId, teamId: cubs, fromYear: 1990 });
    await addStint(t, { cardId: card._id, playerId, teamId: padres, fromYear: 1982, toYear: 1984 });

    expect((await playerRow(t, playerId))!.teamYears).toEqual([
      { teamId: padres, fromYear: 1982, toYear: 1984 },
      { teamId: cubs, fromYear: 1990 },
    ]);
    expect((await playerRow(t, namesake))!.teamYears).toEqual([
      { teamId: cubs, fromYear: 1985, toYear: 1986 },
    ]);
  });
});

describe("tidyNames.createPlayer — the same-name and exact-match rules at the create (was: create beside an existing row)", () => {
  test("an ambiguous name (two rows on file) can still be answered with a THIRD, on purpose, and the namesakes stay untouched", async () => {
    // was: "a CREATE decision on an ambiguous name mints a third row on purpose".
    const t = newT();
    const s = await seedLeaf(t);
    const mk = (b: number) =>
      t.run((ctx) =>
        ctx.db.insert("players", {
          name: "Luis Castillo",
          nameNormalized: normalizeEntityName("Luis Castillo"),
          sportId: s.sportId,
          birthYear: b,
          lastUpdated: Date.now(),
        }),
      );
    const a = await mk(1975);
    const b = await mk(1992);
    await seedUnansweredName(t, {
      scopeId: s.variantTypeId,
      sportId: s.sportId,
      kind: "player",
      name: "Luis Castillo",
      enrichment: {
        existingCandidates: [
          { playerId: a, name: "Luis Castillo", birthYear: 1975, careerSummary: "" },
          { playerId: b, name: "Luis Castillo", birthYear: 1992, careerSummary: "" },
        ],
      },
    });
    await commit(t, s, [makeCard({ players: ["Luis Castillo"] })]);
    const [card] = await readCards(t, s.variantTypeId);
    expect(card.playerIds ?? []).toEqual([]);

    const { playerId } = await create(t, card._id, "Luis Castillo");

    expect(await allOf(t, "players")).toHaveLength(3);
    expect([a, b]).not.toContain(playerId);
    expect((await readCards(t, s.variantTypeId))[0].playerIds).toEqual([playerId]);
  });

  test("Add as new after Change: the operator undoes the auto-link to the one match they were shown, and the new player is written", async () => {
    // was: "a create after Change is honoured when the single match was a candidate the operator saw".
    const t = newT();
    const s = await seedLeaf(t);
    const bo = await t.run((ctx) =>
      ctx.db.insert("players", {
        name: "Bo Jackson",
        nameNormalized: normalizeEntityName("Bo Jackson"),
        sportId: s.sportId,
        lastUpdated: Date.now(),
      }),
    );
    await seedUnansweredName(t, {
      scopeId: s.variantTypeId,
      sportId: s.sportId,
      kind: "player",
      name: "Bo Jackson",
      enrichment: {
        wikidataId: "Q999",
        existingCandidates: [{ playerId: bo, name: "Bo Jackson", careerSummary: "" }],
      },
    });
    // The gate had auto-linked him from the set's history.
    await t.run(async (ctx) => {
      const row = (await ctx.db.query("tidyNames").collect())[0];
      await ctx.db.patch(row._id, {
        answer: { kind: "linkPlayer", playerId: bo, by: "auto", autoReason: "setHistory" },
        answerGen: 1,
      });
    });
    await commit(t, s, [makeCard({ players: ["Bo Jackson"] })]);
    expect((await readCards(t, s.variantTypeId))[0].playerIds).toEqual([bo]);

    const [card] = await readCards(t, s.variantTypeId);
    await t
      .withIdentity(ADMIN)
      .mutation(api.tidyNames.answerName, {
        cardId: card._id,
        kind: "player",
        name: "Bo Jackson",
        answer: { kind: "clear" },
      });
    const { playerId } = await create(t, card._id, "Bo Jackson");

    const players = await allOf(t, "players");
    expect(players).toHaveLength(2);
    expect((await playerRow(t, playerId))!.externalIds?.wikidataId).toBe("Q999");
    expect((await readCards(t, s.variantTypeId))[0].playerIds).toEqual([playerId]);
  });

  test("a name with exactly one match nobody was shown is adopted at the commit: nothing is left to 'Add as new', and no duplicate exists", async () => {
    // was: "a create is NOT honoured when the single match was never shown".
    const t = newT();
    const s = await seedLeaf(t);
    const bo = await t.run((ctx) =>
      ctx.db.insert("players", {
        name: "Bo Jackson",
        nameNormalized: normalizeEntityName("Bo Jackson"),
        sportId: s.sportId,
        lastUpdated: Date.now(),
      }),
    );
    await commit(t, s, [makeCard({ players: ["Bo Jackson"] })]);
    const [card] = await readCards(t, s.variantTypeId);
    expect(card.playerIds).toEqual([bo]);

    await expect(create(t, card._id, "Bo Jackson")).rejects.toThrow(/isn't on this card/);
    expect(await allOf(t, "players")).toHaveLength(1);
  });
});

describe("tidyNames.createPlayer — NEO-463: a one-word name that is part of a fuller player is held back", () => {
  async function walkerCard(t: T) {
    const s = await seedLeaf(t);
    await t.run((ctx) =>
      ctx.db.insert("players", {
        name: "Larry Walker",
        nameNormalized: normalizeEntityName("Larry Walker"),
        sportId: s.sportId,
        lastUpdated: Date.now(),
      }),
    );
    await seedUnansweredName(t, {
      scopeId: s.variantTypeId,
      sportId: s.sportId,
      kind: "player",
      name: "Walker",
    });
    await commit(t, s, [makeCard({ cardNumber: "1", players: ["Walker"] }), makeCard({ cardNumber: "2" })]);
    const cards = await readCards(t, s.variantTypeId);
    return { ...s, card: cards.find((c) => c.cardNumber === "1")! };
  }

  test("a plain create on a fragment is refused with PLAYER_NAME_FRAGMENT, writes no player, and the card keeps the name pending", async () => {
    const t = newT();
    const s = await walkerCard(t);

    await expect(create(t, s.card._id, "Walker")).rejects.toMatchObject({
      data: expect.objectContaining({ code: "PLAYER_NAME_FRAGMENT" }),
    });

    expect((await allOf(t, "players")).map((p) => p.name)).toEqual(["Larry Walker"]);
    const one = (await readCards(t, s.variantTypeId)).find((c) => c.cardNumber === "1")!;
    expect(one.pendingPlayerNames).toEqual(["Walker"]);
    expect(one.playerIds ?? []).toEqual([]);
  });

  test("a confirmed one-name player (oneNamePlayer: true) is written and linked", async () => {
    const t = newT();
    const s = await walkerCard(t);

    const { playerId } = await create(t, s.card._id, "Walker", { oneNamePlayer: true });

    expect((await playerRow(t, playerId))!.name).toBe("Walker");
    const one = (await readCards(t, s.variantTypeId)).find((c) => c.cardNumber === "1")!;
    expect(one.playerIds).toEqual([playerId]);
    expect(one.pendingPlayerNames ?? []).toEqual([]);
  });
});

describe("tidyNames.createPlayer — NEO-313: the player is created under the row's sport", () => {
  test("a row switched to another sport creates its NEW player under that sport", async () => {
    // was: "a player-review row switched to another sport creates its NEW player under that sport".
    const t = newT();
    const s = await openCard(t, "Earl Campbell");
    const football = await t.run((ctx) =>
      ctx.db.insert("selectorOptions", {
        level: "sport",
        value: "Football",
        platformData: {},
        children: [],
        lastUpdated: Date.now(),
      }),
    );
    await t
      .withIdentity(ADMIN)
      .mutation(api.tidyNames.setNameSport, {
        cardId: s.card._id,
        kind: "player",
        name: "Earl Campbell",
        sportId: football,
      });
    await cancelScheduled(t);

    const { playerId } = await create(t, s.card._id, "Earl Campbell");

    expect((await playerRow(t, playerId))!.sportId).toBe(football);
  });

  test("addSetSport: the new player is created in the row's sport AND plays the set's sport", async () => {
    const t = newT();
    const s = await openCard(t, "Earl Campbell");
    const football = await t.run((ctx) =>
      ctx.db.insert("selectorOptions", {
        level: "sport",
        value: "Football",
        platformData: {},
        children: [],
        lastUpdated: Date.now(),
      }),
    );
    await t
      .withIdentity(ADMIN)
      .mutation(api.tidyNames.setNameSport, {
        cardId: s.card._id,
        kind: "player",
        name: "Earl Campbell",
        sportId: football,
      });
    await cancelScheduled(t);

    const { playerId } = await create(t, s.card._id, "Earl Campbell", { addSetSport: true });

    const player = (await playerRow(t, playerId))!;
    expect(player.sportId).toBe(football);
    expect(player.alsoSportIds).toEqual([s.sportId]);
  });
});

describe("tidyNames.createPlayer cleanses the name it stores (NEO-643, was career-check's cleanNewPlayerName)", () => {
  test("a backslash, soft hyphen, zero-width or stray space never reaches the player's name", async () => {
    const t = newT();
    const s = await openCard(t, "Wilmer Rios");
    const { playerId } = await create(t, s.card._id, "Wilmer R\\ios");
    const player = (await playerRow(t, playerId))!;
    expect(player.name).toBe("Wilmer Rios");
    expect(player.nameNormalized).toBe(normalizeEntityName("Wilmer Rios"));

    const t2 = newT();
    const s2 = await openCard(t2, "Luis Rodriguez");
    const { playerId: id2 } = await create(t2, s2.card._id, "Lu­is ‎  Rodriguez");
    expect((await playerRow(t2, id2))!.name).toBe("Luis Rodriguez");
  });
});
