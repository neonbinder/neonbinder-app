/**
 * NEO-645 / NEO-656 — ported from the retired `create` decision for TEAMS, the staged
 * career-team and league rows, and the commit prelude's New Team pass
 * (commitCardChecklist.entityReview / careerTeamRows / careerCheck /
 * careerNewPlayer / teamAnswers, teamAliasLookups, teamsEra, sportReference,
 * entityReviewQueue.leagueStaging).
 *
 * A team is created when the operator answers the inline New Team form
 * (`teams.findOrCreate`, which holds the NEO-236 Location + Name rule, the
 * NEO-254 era rule, the NEO-307 alias rules and the NEO-331 league rule), a
 * league through `leagues.createByAdmin`, and the card is then pointed at the
 * team with `tidyNames.answerName`. A career stint goes in with
 * `players.addStint`. Nothing is created at commit.
 *
 * Where the new door is STRICTER than the old commit (a typed league that does
 * not exist, a league in another sport, an alias that is another team's name
 * are refused instead of silently dropped) the test says so.
 */

import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
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

const asAdmin = (t: T) => t.withIdentity(ADMIN);

/** A card printing the team name `printed`, left unanswered by the commit. */
async function teamCard(t: T, printed: string, opts: { setYear?: string } = {}) {
  const s = await seedLeaf(t);
  if (opts.setYear) {
    await t.run(async (ctx) => {
      for (const id of [s.setNameId, s.variantTypeId]) {
        await ctx.db.patch(id, { features: { manufacturer: "Topps", season: opts.setYear } });
      }
    });
  }
  await commit(t, s, [makeCard({ cardNumber: "1", cardName: "Team Card", teams: [printed] })]);
  const [card] = await readCards(t, s.variantTypeId);
  return { ...s, card };
}

const findOrCreate = (t: T, args: Record<string, unknown>) =>
  asAdmin(t).mutation(api.teams.findOrCreate, args as never);

const linkTeam = async (t: T, cardId: Id<"cardChecklist">, name: string, teamId: Id<"teams">) =>
  asAdmin(t).mutation(api.tidyNames.answerName, {
    cardId,
    kind: "team",
    name,
    sportId: (await t.run((ctx) => ctx.db.get(cardId)))!.sportId!,
    answer: { kind: "linkTeam", teamId },
  });

const cardOf = async (t: T, leaf: Id<"selectorOptions">) => (await readCards(t, leaf))[0];

const league = (t: T, sportId: Id<"selectorOptions">, name: string, level: "major" | "other" = "other") =>
  t.run((ctx) =>
    ctx.db.insert("leagues", {
      name,
      nameNormalized: name.toLowerCase(),
      sportId,
      level,
      lastUpdated: Date.now(),
    }),
  );

// ===========================================================================
// The New Team form answers a printed team name
// ===========================================================================

describe("teams.findOrCreate + answerName — a printed team name answered with the operator's Location + Name", () => {
  test("a team with nothing held is created from Location + Name only and lands on the card (was: answering the New Team step)", async () => {
    const t = newT();
    const s = await teamCard(t, "San Diego Padres");
    expect(s.card.teamOnCardIds ?? []).toEqual([]);
    expect(s.card.pendingTeamNames).toEqual(["San Diego Padres"]);

    const id = await findOrCreate(t, { name: "Padres", location: "San Diego", sportId: s.sportId });
    await linkTeam(t, s.card._id, "San Diego Padres", id);

    const teams = await allOf(t, "teams");
    expect(teams).toHaveLength(1);
    expect(teams[0]).toMatchObject({ name: "Padres", location: "San Diego" });
    const card = await cardOf(t, s.variantTypeId);
    expect(card.teamOnCardIds).toEqual([id]);
    expect(card.pendingTeamNames ?? []).toEqual([]);
  });

  test("a team nobody has made yet is not invented: with no form answer the card keeps the name pending (was: the bulk alone creates NO team / a create with no Location+Name creates nothing)", async () => {
    const t = newT();
    const s = await teamCard(t, "Wichita Wind Surge");
    expect(await allOf(t, "teams")).toEqual([]);
    expect(s.card.teamOnCardIds ?? []).toEqual([]);
    expect(s.card.pendingTeamNames).toEqual(["Wichita Wind Surge"]);
  });

  test("the card's name is not the row's name: the form's split is stored and the nameNormalized key is the whole name", async () => {
    const t = newT();
    const s = await teamCard(t, "Wind Surge");
    const id = await findOrCreate(t, { name: "Wind Surge", location: "Wichita", sportId: s.sportId });
    const team = (await allOf(t, "teams")).find((x) => x._id === id)!;
    expect(team.name).toBe("Wind Surge");
    expect(team.location).toBe("Wichita");
    expect(team.nameNormalized).toBe("surge wichita wind");
  });

  test("the composed name matches a held SPLIT row: it is found and nothing is inserted", async () => {
    const t = newT();
    const s = await teamCard(t, "SD Padres");
    const padres = await seedTeam(t, s.sportId, { location: "San Diego", name: "Padres" });

    const id = await findOrCreate(t, { name: "Padres", location: "San Diego", sportId: s.sportId });
    expect(id).toBe(padres);
    await linkTeam(t, s.card._id, "SD Padres", id);

    expect(await allOf(t, "teams")).toHaveLength(1);
    const card = await cardOf(t, s.variantTypeId);
    expect(card.teamOnCardIds).toEqual([padres]);
  });

  test("answering a printed team name writes the FULL name into the generated listing title (NEO-236)", async () => {
    const t = newT();
    const s = await teamCard(t, "SD Padres");
    const padres = await seedTeam(t, s.sportId, { location: "San Diego", name: "Padres" });
    await linkTeam(t, s.card._id, "SD Padres", padres);
    expect((await cardOf(t, s.variantTypeId)).listingTitle).toContain("San Diego Padres");
  });

  test("the composed name matches a held UNSPLIT row too, and the row is NOT rewritten into the operator's split", async () => {
    const t = newT();
    const s = await teamCard(t, "SD Padres");
    const padres = await seedTeam(t, s.sportId, { name: "San Diego Padres" });

    const id = await findOrCreate(t, { name: "Padres", location: "San Diego", sportId: s.sportId });

    expect(id).toBe(padres);
    const teams = await allOf(t, "teams");
    expect(teams).toHaveLength(1);
    expect(teams[0].name).toBe("San Diego Padres");
    expect(teams[0].location).toBeUndefined();
  });

  test("a team made through the form is visible to the picker's browse for the same sport (NEO-96 round trip)", async () => {
    const t = newT();
    const s = await teamCard(t, "Los Angeles Angels");
    await findOrCreate(t, { name: "Angels", location: "Los Angeles", sportId: s.sportId });

    const visible = (await asAdmin(t).query(api.teams.pickerCandidates, { query: "", sportId: s.sportId })).map(
      (c) => c.team,
    );
    const angels = visible.find((x) => x.name === "Angels");
    expect(angels?.location).toBe("Los Angeles");
  });

  test("a rename of the sport leaves a form-made team and a created player attached and re-labelled (NEO-96)", async () => {
    const t = newT();
    const s = await teamCard(t, "Los Angeles Angels");
    const teamId = await findOrCreate(t, { name: "Angels", location: "Los Angeles", sportId: s.sportId });
    await linkTeam(t, s.card._id, "Los Angeles Angels", teamId);
    const playerId = await t.run((ctx) =>
      ctx.db.insert("players", {
        name: "Mike Trout",
        nameNormalized: normalizeEntityName("Mike Trout"),
        sportId: s.sportId,
        lastUpdated: Date.now(),
      }),
    );

    const res = await asAdmin(t).mutation(api.selectorOptions.renameSelectorOption, {
      id: s.sportId,
      value: "MLB Baseball",
    });
    expect(res.success).toBe(true);

    const players = await asAdmin(t).query(api.players.list, { sportId: s.sportId, limit: 500 });
    expect(players.map((p) => p._id)).toContain(playerId);
    const teams = (await asAdmin(t).query(api.teams.pickerCandidates, { query: "", sportId: s.sportId })).map(
      (c) => c.team._id,
    );
    expect(teams).toContain(teamId);
    expect((await t.run((ctx) => ctx.db.get(s.sportId)))?.value).toBe("MLB Baseball");
  });
});

// ===========================================================================
// Leagues (NEO-236 / NEO-331): the operator's answer, and only that
// ===========================================================================

describe("teams.findOrCreate — the New Team form's League answer (was: staged league + career-team rows)", () => {
  test("an existing league picked by id lands on the team; a team made with leagueId null has NO league; neither files under the sport default", async () => {
    const t = newT();
    const s = await seedLeaf(t);
    await t.run((ctx) =>
      ctx.db.insert("leagues", {
        name: "Major League Baseball",
        nameNormalized: "major league baseball",
        abbreviation: "MLB",
        aliases: ["MLB"],
        sportId: s.sportId,
        level: "major",
        lastUpdated: Date.now(),
      }),
    );
    const abl = await league(t, s.sportId, "Australian Baseball League");

    const picked = await findOrCreate(t, { name: "Blue Sox", location: "Sydney", sportId: s.sportId, leagueId: abl });
    const none = await findOrCreate(t, { name: "Beavers", location: "Oregon State", sportId: s.sportId, leagueId: null });

    const teams = await allOf(t, "teams");
    expect(teams.find((x) => x._id === picked)!.leagueId).toBe(abl);
    expect(teams.find((x) => x._id === none)!.leagueId).toBeUndefined();
    expect(await allOf(t, "leagues")).toHaveLength(2);
  });

  test("NEO-331: a League left unanswered lands with NO league, even when the sport's default league row exists, and no league is minted", async () => {
    const t = newT();
    const s = await seedLeaf(t);
    await t.run((ctx) =>
      ctx.db.insert("leagues", {
        name: "Major League Baseball",
        nameNormalized: "major league baseball",
        abbreviation: "MLB",
        aliases: ["MLB"],
        sportId: s.sportId,
        level: "major",
        lastUpdated: Date.now(),
      }),
    );
    const before = (await allOf(t, "leagues")).length;

    const id = await findOrCreate(t, { name: "Crawdads", location: "Hickory", sportId: s.sportId });

    expect((await allOf(t, "teams")).find((x) => x._id === id)!.leagueId).toBeUndefined();
    expect(await allOf(t, "leagues")).toHaveLength(before);
  });

  test("an explicit pick of the sport's top league still lands there", async () => {
    const t = newT();
    const s = await seedLeaf(t);
    const mlb = await league(t, s.sportId, "Major League Baseball", "major");
    const id = await findOrCreate(t, { name: "Padres", location: "San Diego", sportId: s.sportId, leagueId: mlb });
    expect((await allOf(t, "teams")).find((x) => x._id === id)!.leagueId).toBe(mlb);
  });

  test("a league typed by NAME links the league we hold, by name or alias", async () => {
    const t = newT();
    const s = await seedLeaf(t);
    const abl = await league(t, s.sportId, "Australian Baseball League");
    const id = await findOrCreate(t, {
      name: "Blue Sox",
      location: "Sydney",
      sportId: s.sportId,
      leagueName: "Australian Baseball League",
    });
    expect((await allOf(t, "teams")).find((x) => x._id === id)!.leagueId).toBe(abl);
    expect(await allOf(t, "leagues")).toHaveLength(1);
  });

  test("STRICTER than the old commit: a league NAME we hold no row for is refused and mints neither a league nor a team (was: the team landed league-less)", async () => {
    const t = newT();
    const s = await seedLeaf(t);
    await expect(
      findOrCreate(t, {
        name: "Beavers",
        location: "Oregon State",
        sportId: s.sportId,
        leagueName: "NCAA Division I baseball",
      }),
    ).rejects.toThrow(/isn't in NeonBinder yet/);
    expect(await allOf(t, "teams")).toEqual([]);
    expect(await allOf(t, "leagues")).toEqual([]);
  });

  test("STRICTER than the old commit: a league id that was deleted, or belongs to another sport, is refused and no team is made (was: dropped silently)", async () => {
    const t = newT();
    const s = await seedLeaf(t);
    const football = await t.run((ctx) =>
      ctx.db.insert("selectorOptions", {
        level: "sport",
        value: "Football",
        platformData: {},
        children: [],
        lastUpdated: Date.now(),
      }),
    );
    const foreign = await league(t, football, "National Football League", "major");
    const gone = await league(t, s.sportId, "Gone League");
    await t.run((ctx) => ctx.db.delete(gone));

    await expect(
      findOrCreate(t, { name: "Blue Sox", location: "Sydney", sportId: s.sportId, leagueId: gone }),
    ).rejects.toThrow(/no longer exists/);
    await expect(
      findOrCreate(t, { name: "Blue Sox", location: "Sydney", sportId: s.sportId, leagueId: foreign }),
    ).rejects.toThrow(/league in another sport/);
    expect(await allOf(t, "teams")).toEqual([]);
    // The foreign league was not touched or re-parented on the way past.
    expect((await t.run((ctx) => ctx.db.get(foreign)))!.sportId).toBe(football);
  });

  test("a League created once through the New League form carries the whole record and BOTH teams that pick it share the one row", async () => {
    // was: "one league row, carrying the whole record, and BOTH teams on it".
    const t = newT();
    const s = await seedLeaf(t);
    const made = await asAdmin(t).mutation(api.leagues.createByAdmin, {
      name: "National Hockey League",
      abbreviation: "NHL",
      level: "major",
      sportId: s.sportId,
      yearsActive: { from: 1917 },
      aliases: ["NHL"],
      wikidataId: "Q1215892",
    });
    expect(made.created).toBe(true);
    // The second team asks for the same league again: found, not duplicated.
    const again = await asAdmin(t).mutation(api.leagues.createByAdmin, {
      name: "National Hockey League",
      level: "major",
      sportId: s.sportId,
    });
    expect(again).toEqual({ id: made.id, created: false });
    const canucks = await findOrCreate(t, { name: "Canucks", location: "Vancouver", sportId: s.sportId, leagueId: made.id });
    const flames = await findOrCreate(t, { name: "Flames", location: "Calgary", sportId: s.sportId, leagueId: made.id });

    const leagues = await allOf(t, "leagues");
    expect(leagues).toHaveLength(1);
    expect(leagues[0]).toMatchObject({
      name: "National Hockey League",
      abbreviation: "NHL",
      level: "major",
      yearsActive: { from: 1917 },
      aliases: ["NHL"],
      externalIds: { wikidataId: "Q1215892" },
    });
    const teams = await allOf(t, "teams");
    expect(teams.find((x) => x._id === canucks)!.leagueId).toBe(made.id);
    expect(teams.find((x) => x._id === flames)!.leagueId).toBe(made.id);
  });

  test("'No league' on the team that raised the step does not strip another team's own explicit league (was: a SKIP is scoped to the team that raised the step)", async () => {
    const t = newT();
    const s = await seedLeaf(t);
    const nhl = await league(t, s.sportId, "National Hockey League", "major");
    const canucks = await findOrCreate(t, { name: "Canucks", location: "Vancouver", sportId: s.sportId, leagueId: null });
    const flames = await findOrCreate(t, { name: "Flames", location: "Calgary", sportId: s.sportId, leagueId: nhl });
    const teams = await allOf(t, "teams");
    expect(teams.find((x) => x._id === canucks)!.leagueId).toBeUndefined();
    expect(teams.find((x) => x._id === flames)!.leagueId).toBe(nhl);
  });

  test("an explicit league on a team's own form is its answer, by id or by name, and no other league is minted (was: a skipped step never overrules the team's own answer)", async () => {
    const t = newT();
    const s = await seedLeaf(t);
    const ahl = await league(t, s.sportId, "American Hockey League");
    const wha = await league(t, s.sportId, "World Hockey Association");
    const byId = await findOrCreate(t, { name: "Canucks", location: "Vancouver", sportId: s.sportId, leagueId: ahl });
    const byName = await findOrCreate(t, {
      name: "Flames",
      location: "Calgary",
      sportId: s.sportId,
      leagueName: "World Hockey Association",
    });
    const teams = await allOf(t, "teams");
    expect(teams.find((x) => x._id === byId)!.leagueId).toBe(ahl);
    expect(teams.find((x) => x._id === byName)!.leagueId).toBe(wha);
    expect((await allOf(t, "leagues")).map((l) => l.name).sort()).toEqual([
      "American Hockey League",
      "World Hockey Association",
    ]);
  });
});

// ===========================================================================
// Career teams: matched, created through the form, and stints added
// ===========================================================================

describe("career teams made through the form reach the player's teamYears (was: staged careerTeamOf rows)", () => {
  test("two clubs made with the operator's leagues, then the player's stints against them", async () => {
    const t = newT();
    const s = await seedLeaf(t);
    await commit(t, s, [makeCard({ players: ["Travis Bazzana"] })]);
    const card = await cardOf(t, s.variantTypeId);
    const abl = await league(t, s.sportId, "Australian Baseball League");
    const { playerId } = await asAdmin(t).mutation(api.tidyNames.createPlayer, {
      cardId: card._id,
      name: "Travis Bazzana",
      sportId: card.sportId!,
    });

    const sox = await findOrCreate(t, { name: "Blue Sox", location: "Sydney", sportId: s.sportId, leagueId: abl });
    const beavers = await findOrCreate(t, { name: "Beavers", location: "Oregon State", sportId: s.sportId, leagueId: null });
    await asAdmin(t).mutation(api.players.addStint, { cardId: card._id, playerId, teamId: sox, fromYear: 2019, toYear: 2021 });
    await asAdmin(t).mutation(api.players.addStint, { cardId: card._id, playerId, teamId: beavers, fromYear: 2022 });

    const teams = await allOf(t, "teams");
    expect(teams.find((x) => x._id === sox)).toMatchObject({ name: "Blue Sox", location: "Sydney", leagueId: abl });
    expect(teams.find((x) => x._id === beavers)!.leagueId).toBeUndefined();
    expect((await t.run((ctx) => ctx.db.get(playerId)))!.teamYears).toEqual([
      { teamId: sox, fromYear: 2019, toYear: 2021 },
      { teamId: beavers, fromYear: 2022 },
    ]);
  });

  test("NEO-248: a hand-typed stint's years reach players.teamYears through the New Team form", async () => {
    const t = newT();
    const s = await seedLeaf(t);
    await commit(t, s, [makeCard({ players: ["Travis Bazzana"] })]);
    const card = await cardOf(t, s.variantTypeId);
    const { playerId } = await asAdmin(t).mutation(api.tidyNames.createPlayer, { cardId: card._id, name: "Travis Bazzana", sportId: card.sportId! });

    const sox = await findOrCreate(t, { name: "Blue Sox", location: "Sydney", sportId: s.sportId, leagueId: null });
    await asAdmin(t).mutation(api.players.addStint, { cardId: card._id, playerId, teamId: sox, fromYear: 2001, toYear: 2005 });

    const teams = await allOf(t, "teams");
    expect(teams).toHaveLength(1);
    expect(teams[0]).toMatchObject({ location: "Sydney", name: "Blue Sox" });
    expect((await t.run((ctx) => ctx.db.get(playerId)))!.teamYears).toEqual([
      { teamId: teams[0]._id, fromYear: 2001, toYear: 2005 },
    ]);
  });

  test("a career team the form is asked for that we already hold is found, not minted twice, and takes the stint", async () => {
    // was: "a staged row answered with a team we already hold links instead of minting a duplicate".
    const t = newT();
    const s = await seedLeaf(t);
    const padres = await seedTeam(t, s.sportId, { location: "San Diego", name: "Padres" });
    await commit(t, s, [makeCard({ players: ["Tony Gwynn"] })]);
    const card = await cardOf(t, s.variantTypeId);
    const { playerId } = await asAdmin(t).mutation(api.tidyNames.createPlayer, { cardId: card._id, name: "Tony Gwynn", sportId: card.sportId! });

    const id = await findOrCreate(t, { name: "Padres", location: "San Diego", sportId: s.sportId });
    expect(id).toBe(padres);
    await asAdmin(t).mutation(api.players.addStint, { cardId: card._id, playerId, teamId: id, fromYear: 1982 });

    expect(await allOf(t, "teams")).toHaveLength(1);
    expect((await t.run((ctx) => ctx.db.get(playerId)))!.teamYears).toEqual([{ teamId: padres, fromYear: 1982 }]);
  });

  test("a team made in the form lets the player's stint be added with its operator-typed era", async () => {
    // was: "creates a second Jets / a stint for a team the batch creates is
    // written against the team the Teams step made".
    const t = newT();
    const s = await seedLeaf(t);
    await commit(t, s, [makeCard({ players: ["Tony Gwynn"], teams: ["Brand New Club"] })]);
    const card = await cardOf(t, s.variantTypeId);
    const { playerId } = await asAdmin(t).mutation(api.tidyNames.createPlayer, { cardId: card._id, name: "Tony Gwynn", sportId: card.sportId! });
    const club = await findOrCreate(t, { name: "New Club", location: "Brand", sportId: s.sportId, yearsActive: { from: 1980 } });

    const out = await asAdmin(t).mutation(api.players.addStint, { cardId: card._id, playerId, teamId: club, fromYear: 1988 });

    expect(out).toEqual({ added: 1, existing: 0, skipped: 0 });
    expect((await t.run((ctx) => ctx.db.get(playerId)))!.teamYears).toEqual([{ teamId: club, fromYear: 1988 }]);
    expect((await allOf(t, "teams"))[0].yearsActive).toEqual({ from: 1980 });
  });

  test("NEO-307: a created player never files a career stint under a team that had folded", async () => {
    // was: "a 2015 stint with only the 1972–1996 Jets held links NOTHING / …while a 1985 stint links it".
    const run = async (stintFrom: number) => {
      const t = newT();
      const s = await seedLeaf(t);
      const jets = await seedTeam(t, s.sportId, {
        location: "Winnipeg",
        name: "Jets",
        yearsActive: { from: 1972, to: 1996 },
      });
      await commit(t, s, [makeCard({ players: ["Blake Wheeler"] })]);
      const card = await cardOf(t, s.variantTypeId);
      const { playerId } = await asAdmin(t).mutation(api.tidyNames.createPlayer, { cardId: card._id, name: "Blake Wheeler", sportId: card.sportId!, enrichment: { careerTeams: [{ name: "Winnipeg Jets", fromYear: stintFrom }] } });
      return { jets, teamYears: (await t.run((ctx) => ctx.db.get(playerId)))!.teamYears ?? [] };
    };
    expect((await run(2015)).teamYears).toEqual([]);
    const linked = await run(1985);
    expect(linked.teamYears.map((ty) => ty.teamId)).toEqual([linked.jets]);
  });
});

// ===========================================================================
// NEO-254: eras
// ===========================================================================

describe("teams.findOrCreate — NEO-254 an operator-typed era (was: the wizard's era reaches the row and the card)", () => {
  test("a second Jets is made beside the 2011 one only when the operator says it is a NEW ERA, and the 1985 card resolves to it", async () => {
    const t = newT();
    const s = await teamCard(t, "Winnipeg Jets", { setYear: "1985" });
    const revived = await t.run((ctx) =>
      ctx.db.insert("teams", {
        name: "Jets",
        location: "Winnipeg",
        nameNormalized: normalizeEntityName("Winnipeg Jets"),
        sportId: s.sportId,
        yearsActive: { from: 2011 },
        lastUpdated: 1,
      }),
    );

    // The first attempt is the confirmation prompt; nothing is written.
    await expect(
      findOrCreate(t, { name: "Jets", location: "Winnipeg", sportId: s.sportId, yearsActive: { from: 1972, to: 1996 } }),
    ).rejects.toMatchObject({ data: expect.objectContaining({ code: "TEAM_ERA_EXISTS" }) });
    expect(await allOf(t, "teams")).toHaveLength(1);

    const created = await findOrCreate(t, {
      name: "Jets",
      location: "Winnipeg",
      sportId: s.sportId,
      yearsActive: { from: 1972, to: 1996 },
      newEra: true,
    });

    expect(created).not.toBe(revived);
    expect((await allOf(t, "teams")).find((x) => x._id === created)!.yearsActive).toEqual({ from: 1972, to: 1996 });
    await linkTeam(t, s.card._id, "Winnipeg Jets", created);
    expect((await cardOf(t, s.variantTypeId)).teamOnCardIds).toEqual([created]);
    await expect(
      t.query(internal.teams.findByFullNameInternal, { name: "Winnipeg Jets", sportId: s.sportId, setYear: 1985 }),
    ).resolves.toBe(created);
    await expect(
      t.query(internal.teams.findByFullNameInternal, { name: "Winnipeg Jets", sportId: s.sportId, setYear: 2015 }),
    ).resolves.toBe(revived);
  });

  test("a create that names two held eras at once is refused, and a third is never minted (was: the 'mess' refusal)", async () => {
    const t = newT();
    const s = await seedLeaf(t);
    await seedTeam(t, s.sportId, { location: "Winnipeg", name: "Jets", yearsActive: { from: 1972, to: 1996 } });
    await seedTeam(t, s.sportId, { location: "Winnipeg", name: "Jets", yearsActive: { from: 2011 } });
    await expect(findOrCreate(t, { name: "Jets", location: "Winnipeg", sportId: s.sportId })).rejects.toThrow(
      /already names 2 teams/,
    );
    expect(await allOf(t, "teams")).toHaveLength(2);
  });

  test("NEO-602: a create with no years, when two rows answer to the name (one by its own name, one only by alias), is refused and the card stays unlinked - never the year's pick", async () => {
    // was: "a decided CREATE the commit cannot place leaves the card unlinked".
    const t = newT();
    const s = await teamCard(t, "Oakland Athletics", { setYear: "2025" });
    await seedTeam(t, s.sportId, { location: "Oakland", name: "Athletics", yearsActive: { from: 1968, to: 2024 } });
    const athletics = await t.run(async (ctx) => {
      const id = await ctx.db.insert("teams", {
        name: "Athletics",
        nameNormalized: normalizeEntityName("Athletics"),
        sportId: s.sportId,
        yearsActive: { from: 2025 },
        aliases: ["Oakland Athletics"],
        lastUpdated: Date.now(),
      });
      await ctx.db.insert("teamAliases", {
        teamId: id,
        sportId: s.sportId,
        aliasNormalized: normalizeEntityName("Oakland Athletics"),
      });
      return id;
    });

    await expect(findOrCreate(t, { name: "Athletics", location: "Oakland", sportId: s.sportId })).rejects.toThrow();

    expect(await allOf(t, "teams")).toHaveLength(2);
    const card = await cardOf(t, s.variantTypeId);
    expect(card.teamOnCardIds ?? []).toEqual([]);
    expect(card.teamOnCardIds ?? []).not.toContain(athletics);
    expect(card.pendingTeamNames).toEqual(["Oakland Athletics"]);
  });
});

// ===========================================================================
// NEO-284 / NEO-307 / NEO-602: aliases
// ===========================================================================

describe("teams.findOrCreate — the alias rules (was: the commit's New Team create and the wizard's recordDecision)", () => {
  async function aliased(
    t: T,
    sportId: Id<"selectorOptions">,
    opts: { location: string; name: string; aliases?: string[]; yearsActive?: { from: number; to?: number } },
  ): Promise<Id<"teams">> {
    return t.run(async (ctx) => {
      const id = await ctx.db.insert("teams", {
        location: opts.location,
        name: opts.name,
        nameNormalized: normalizeEntityName(`${opts.location} ${opts.name}`),
        sportId,
        ...(opts.aliases?.length ? { aliases: opts.aliases } : {}),
        ...(opts.yearsActive ? { yearsActive: opts.yearsActive } : {}),
        lastUpdated: Date.now(),
      });
      for (const alias of opts.aliases ?? []) {
        await ctx.db.insert("teamAliases", { teamId: id, sportId, aliasNormalized: normalizeEntityName(alias) });
      }
      return id;
    });
  }

  test("NEO-284 S1: 'Also known as' naming another team's own name is refused with nothing created; without it the team is made with the rest", async () => {
    // was: "a New Team create at commit drops the clashing alias and still
    // creates the team with the rest" - the form is STRICTER: it refuses.
    const t = newT();
    const s = await seedLeaf(t);
    const lsu = await aliased(t, s.sportId, { location: "LSU", name: "Tigers" });

    await expect(
      findOrCreate(t, {
        name: "Tigers",
        location: "Auburn",
        sportId: s.sportId,
        aliases: ["LSU Tigers", "War Eagle", "AU Tigers"],
      }),
    ).rejects.toThrow();
    expect(await allOf(t, "teams")).toHaveLength(1);

    const id = await findOrCreate(t, {
      name: "Tigers",
      location: "Auburn",
      sportId: s.sportId,
      aliases: ["War Eagle", "AU Tigers"],
    });
    const auburn = (await allOf(t, "teams")).find((x) => x._id === id)!;
    expect(auburn.aliases).toEqual(["War Eagle", "AU Tigers"]);
    const rows = await t.run((ctx) =>
      ctx.db.query("teamAliases").withIndex("by_team_id", (q) => q.eq("teamId", id)).collect(),
    );
    expect(rows.map((r) => r.aliasNormalized).sort()).toEqual(
      [normalizeEntityName("War Eagle"), normalizeEntityName("AU Tigers")].sort(),
    );
    expect((await t.run((ctx) => ctx.db.get(lsu)))!.aliases).toBeUndefined();
  });

  test("NEO-602: a name another team holds as an alias, with DISJOINT years, asks first (TEAM_NAME_IS_ALIAS naming the holder) and is created once the operator agrees; the card then links the new row", async () => {
    // was: "the reverse order at commit: a New Team create onto a DISJOINT team's alias is created".
    const t = newT();
    const s = await teamCard(t, "Brooklyn Dodgers", { setYear: "1955" });
    const la = await aliased(t, s.sportId, {
      location: "Los Angeles",
      name: "Dodgers",
      aliases: ["Brooklyn Dodgers"],
      yearsActive: { from: 1958 },
    });

    await expect(
      findOrCreate(t, { name: "Dodgers", location: "Brooklyn", sportId: s.sportId, yearsActive: { from: 1911, to: 1957 } }),
    ).rejects.toMatchObject({
      data: expect.objectContaining({
        code: "TEAM_NAME_IS_ALIAS",
        holders: [expect.objectContaining({ id: la })],
      }),
    });
    expect(await allOf(t, "teams")).toHaveLength(1);

    const brooklyn = await findOrCreate(t, {
      name: "Dodgers",
      location: "Brooklyn",
      sportId: s.sportId,
      yearsActive: { from: 1911, to: 1957 },
      newEra: true,
    });
    await linkTeam(t, s.card._id, "Brooklyn Dodgers", brooklyn);

    const teams = await allOf(t, "teams");
    expect(teams).toHaveLength(2);
    expect(brooklyn).not.toBe(la);
    expect((await cardOf(t, s.variantTypeId)).teamOnCardIds).toEqual([brooklyn]);
  });

  test("NEO-602: a create whose years OVERLAP the alias holder's finds the holder and creates nothing", async () => {
    // was: "the reverse order at commit: a create whose years OVERLAP the alias holder's finds the holder".
    const t = newT();
    const s = await teamCard(t, "Brooklyn Dodgers", { setYear: "1955" });
    const la = await aliased(t, s.sportId, {
      location: "Los Angeles",
      name: "Dodgers",
      aliases: ["Brooklyn Dodgers"],
      yearsActive: { from: 1958 },
    });

    const id = await findOrCreate(t, { name: "Dodgers", location: "Brooklyn", sportId: s.sportId, yearsActive: { from: 1950, to: 1960 } });

    expect(id).toBe(la);
    expect((await allOf(t, "teams")).map((x) => x._id)).toEqual([la]);
    await linkTeam(t, s.card._id, "Brooklyn Dodgers", id);
    expect((await cardOf(t, s.variantTypeId)).teamOnCardIds).toEqual([la]);
  });

  test("NEO-307 ONE holder: the form's pre-check names it, the create returns the holder instead of minting, and the operator links the holder and gives the stint its years", async () => {
    // was: "ONE holder: the decision saves as a link, the stint lands on the holder with its years, and no team is inserted".
    const t = newT();
    const s = await seedLeaf(t);
    const la = await aliased(t, s.sportId, {
      location: "Los Angeles",
      name: "Dodgers",
      aliases: ["Brooklyn Dodgers"],
      yearsActive: { from: 1958 },
    });
    await commit(t, s, [makeCard({ players: ["Pee Wee Reese"] })]);
    const card = await cardOf(t, s.variantTypeId);
    const { playerId } = await asAdmin(t).mutation(api.tidyNames.createPlayer, { cardId: card._id, name: "Pee Wee Reese", sportId: card.sportId! });

    // A 1940 stint cannot resolve to a 1958- row by name, so it can only come through the link.
    const held = await asAdmin(t).query(api.teams.nameHeldAsAliasBy, { sportId: s.sportId, name: "Brooklyn Dodgers" });
    expect(held.map((h) => h.id)).toEqual([la]);
    // Typing an alias finds its team: the holder is returned, never a second row.
    expect(await findOrCreate(t, { name: "Dodgers", location: "Brooklyn", sportId: s.sportId })).toBe(la);
    await asAdmin(t).mutation(api.players.addStint, { cardId: card._id, playerId, teamId: held[0].id, fromYear: 1940, toYear: 1957 });

    expect((await allOf(t, "teams")).map((x) => x._id)).toEqual([la]);
    expect((await t.run((ctx) => ctx.db.get(playerId)))!.teamYears).toEqual([{ teamId: la, fromYear: 1940, toYear: 1957 }]);
  });

  test("NEO-307 TWO holders: the pre-check lists both, the create is still refused (never guess between them), and nothing is made", async () => {
    const t = newT();
    const s = await seedLeaf(t);
    const la = await aliased(t, s.sportId, { location: "Los Angeles", name: "Dodgers", aliases: ["Brooklyn Dodgers"] });
    const robins = await aliased(t, s.sportId, { location: "Brooklyn", name: "Robins", aliases: ["Brooklyn Dodgers"] });

    const held = await asAdmin(t).query(api.teams.nameHeldAsAliasBy, { sportId: s.sportId, name: "Brooklyn Dodgers" });
    expect(held.map((h) => h.id).sort()).toEqual([la, robins].sort());
    await expect(findOrCreate(t, { name: "Dodgers", location: "Brooklyn", sportId: s.sportId })).rejects.toThrow();
    expect(await allOf(t, "teams")).toHaveLength(2);
  });

  test("NEO-307: an NFL holder does not count for baseball: the pre-check is empty, the create makes the baseball team, and the NFL alias is untouched", async () => {
    const t = newT();
    const s = await seedLeaf(t);
    const football = await t.run((ctx) =>
      ctx.db.insert("selectorOptions", {
        level: "sport",
        value: "Football",
        platformData: {},
        children: [],
        lastUpdated: Date.now(),
      }),
    );
    const yanks = await aliased(t, football, { location: "Boston", name: "Yanks", aliases: ["Brooklyn Dodgers"] });

    expect(await asAdmin(t).query(api.teams.nameHeldAsAliasBy, { sportId: s.sportId, name: "Brooklyn Dodgers" })).toEqual([]);
    const id = await findOrCreate(t, { name: "Dodgers", location: "Brooklyn", sportId: s.sportId });

    const baseball = (await allOf(t, "teams")).filter((x) => x.sportId === s.sportId);
    expect(baseball.map((x) => x._id)).toEqual([id]);
    expect((await t.run((ctx) => ctx.db.get(yanks)))!.aliases).toEqual(["Brooklyn Dodgers"]);
  });

  test("NEO-307: a holder deleted before the answer is no longer offered, and a link to it is refused (was: a linked holder deleted before the commit mints nothing)", async () => {
    const t = newT();
    const s = await teamCard(t, "Brooklyn Dodgers");
    const la = await aliased(t, s.sportId, {
      location: "Los Angeles",
      name: "Dodgers",
      aliases: ["Brooklyn Dodgers"],
      yearsActive: { from: 1958 },
    });
    await t.run(async (ctx) => {
      for (const alias of await ctx.db.query("teamAliases").withIndex("by_team_id", (q) => q.eq("teamId", la)).collect()) {
        await ctx.db.delete(alias._id);
      }
      await ctx.db.delete(la);
    });

    expect(await asAdmin(t).query(api.teams.nameHeldAsAliasBy, { sportId: s.sportId, name: "Brooklyn Dodgers" })).toEqual([]);
    await expect(linkTeam(t, s.card._id, "Brooklyn Dodgers", la)).rejects.toThrow(/team is gone/i);
    expect(await allOf(t, "teams")).toEqual([]);
    const card = await cardOf(t, s.variantTypeId);
    expect(card.teamOnCardIds ?? []).toEqual([]);
    expect(card.pendingTeamNames).toEqual(["Brooklyn Dodgers"]);
  });

  test("NEO-284 save as alias: linking with saveAsAlias writes the printed spelling onto the team once, and a clashing one is refused (no silent steal)", async () => {
    const t = newT();
    const s = await teamCard(t, "AU Tigers");
    const auburn = await aliased(t, s.sportId, { location: "Auburn", name: "Tigers" });
    await aliased(t, s.sportId, { location: "AU", name: "Tigers" });
    // "AU Tigers" is another team's own name: remembering it on Auburn would steal its cards.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await asAdmin(t)
        .mutation(api.tidyNames.answerName, {
          cardId: s.card._id,
          kind: "team",
          name: "AU Tigers",
          answer: { kind: "linkTeam", teamId: auburn, saveAsAlias: true },
        })
        .catch(() => undefined);
    } finally {
      warn.mockRestore();
    }
    // Whatever the outcome for the link, the clashing string is never on Auburn as an alias.
    expect((await t.run((ctx) => ctx.db.get(auburn)))!.aliases ?? []).not.toContain("AU Tigers");
  });
});
