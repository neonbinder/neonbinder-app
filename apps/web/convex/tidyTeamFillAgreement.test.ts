/**
 * NEO-645 (S4, collector item 7) — the Team tile and the commit use ONE career
 * verdict. For a teamless card, the team `commitCardChecklist` writes at save is
 * exactly the team `cardChecklist.suggestedTeamsForCard` preselects, and a card
 * the commit left teamless opens with nothing preselected (a tie in the window
 * is offered whole, every chip with its years).
 *
 * Shapes (the set is 2024 unless noted; the window is the set year and the one
 * before):
 *  - Ohtani: Angels 2018-2023, Dodgers 2024-  -> two teams in the window: no fill;
 *  - A 2020-2024 plus B 2025- on a 2025 set   -> two in the window: no fill, and
 *    the tile offers BOTH (it used to offer and preselect only the 2025 chip);
 *  - both stints cover the set year           -> no fill, none preselected;
 *  - one stint covering the set year          -> filled, preselected;
 *  - one stint that ended the year before     -> filled, preselected;
 *  - a stint that ended two years before      -> nothing in the window: no fill,
 *    the whole career offered, nothing preselected.
 */

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { CARDS_PER_COMMIT_CHUNK, commitCardChecklistChunk } from "./selectorOptions";
import { cancelScheduled, drainScheduled } from "../lib/testing/drain-scheduled";
import { addPlayer, addTeam, printCard, seedTidyWorld } from "../lib/testing/tidy-world";
import { careerVerdictFor, newCareerVerdictCache } from "./lib/careerVerdict";
import { cardTakesTeamFill } from "./tidyCards";
import { newFillReadCache, planFillOnAnswer } from "./teamFillOnAnswer";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const ADMIN = { subject: "admin_tidy_team_fill_agreement", role: "admin" };
type T = ReturnType<typeof convexTest>;

beforeEach(() => {
  vi.stubGlobal("fetch", (async (url: string | URL) => {
    throw new Error(`this test file must not reach the network: ${String(url)}`);
  }) as unknown as typeof fetch);
});
const live: T[] = [];
afterEach(async () => {
  for (const t of live.splice(0)) {
    await drainScheduled(t);
    await cancelScheduled(t);
  }
  vi.unstubAllGlobals();
});

type Stint = { team: "A" | "B"; fromYear?: number; toYear?: number };

async function commitOne(opts: {
  year: string;
  stints: Stint[];
  /** NEO-639 (decision A): the set's own team default is "No Team". */
  setNoTeam?: boolean;
  /** How the fetch-time team lookup for the card ended (NEO-639: `failed` is missing data, not a claim). */
  teamLookup?: "failed";
}) {
  const t = convexTest(schema, modules);
  live.push(t);
  const world = await t.run(async (ctx) => {
    const w = await seedTidyWorld(ctx, { year: opts.year });
    const a = await addTeam(ctx, w, "Los Angeles", "Angels");
    const b = await addTeam(ctx, w, "Los Angeles", "Dodgers");
    const player = await addPlayer(
      ctx,
      w,
      "Shohei Ohtani",
      opts.stints.map((s) => ({
        teamId: s.team === "A" ? a : b,
        ...(s.fromYear !== undefined ? { fromYear: s.fromYear } : {}),
        ...(s.toYear !== undefined ? { toYear: s.toYear } : {}),
      })),
    );
    if (opts.setNoTeam) {
      await ctx.db.patch(w.base, { noTeamDefault: { setAt: 1, setByUserId: "op" } });
    }
    return { w, a, b, player };
  });
  await t.withIdentity(ADMIN).action(api.selectorOptions.commitCardChecklist, {
    selectorOptionId: world.w.base,
    sportId: world.w.sport,
    cards: [
      {
        cardNumber: "1",
        cardName: "Shohei Ohtani",
        team: undefined,
        teams: [],
        players: ["Shohei Ohtani"],
        attributes: [],
        isRookie: false,
        isRelic: false,
        printRun: undefined,
        autographType: undefined,
        cardVariation: undefined,
        platformData: { bsc: { ref: "ref-1" } },
        unmatched: undefined,
        ...(opts.teamLookup ? { teamLookup: opts.teamLookup } : {}),
      },
    ] as never,
  });
  const card = await t.run((ctx) =>
    ctx.db
      .query("cardChecklist")
      .withIndex("by_selector_option", (q) => q.eq("selectorOptionId", world.w.base))
      .first(),
  );
  const tile = await t
    .withIdentity(ADMIN)
    .query(api.cardChecklist.suggestedTeamsForCard, { cardId: card!._id });
  return { world, card: card!, tile };
}

const preselected = (tile: Array<{ teamId: Id<"teams">; inSetYear: boolean }>) =>
  tile.filter((s) => s.inSetYear).map((s) => s.teamId);

describe("NEO-639: a missing lookup is not a claim; the set's own No Team is", () => {
  const oneTeam: Stint[] = [{ team: "B", fromYear: 2024 }];

  test("a card whose team lookup failed is filled from the career like any other, and the tile preselects the same team", async () => {
    const { world, card, tile } = await commitOne({ year: "2024", stints: oneTeam, teamLookup: "failed" });
    expect(card.teamOnCardIds).toEqual([world.b]);
    expect(card.tidyChecks).toContainEqual({ kind: "teamFill", teamIds: [world.b], reason: "career" });
    expect(preselected(tile)).toEqual([world.b]);
  });

  test("under the set's own No Team the commit writes no team and no note, though the career gives exactly one", async () => {
    const { card } = await commitOne({ year: "2024", stints: oneTeam, setNoTeam: true });
    expect(card.teamOnCardIds ?? []).toEqual([]);
    expect(card.tidyChecks?.some((c) => c.kind === "teamFill") ?? false).toBe(false);
  });

  test("the control: the same card in a set with no team default is filled", async () => {
    const { world, card } = await commitOne({ year: "2024", stints: oneTeam });
    expect(card.teamOnCardIds).toEqual([world.b]);
  });

  test("under the set's own No Team a failed lookup still fills nothing (the set's answer is not overruled)", async () => {
    const { card } = await commitOne({ year: "2024", stints: oneTeam, setNoTeam: true, teamLookup: "failed" });
    expect(card.teamOnCardIds ?? []).toEqual([]);
  });
});

describe("the tile preselects exactly what the commit writes", () => {
  test("Angels 2018-2023 and Dodgers 2024-: a tie in the 2023-2024 window, nothing written, both offered, none preselected", async () => {
    const { world, card, tile } = await commitOne({
      year: "2024",
      stints: [
        { team: "A", fromYear: 2018, toYear: 2023 },
        { team: "B", fromYear: 2024 },
      ],
    });
    expect(card.teamOnCardIds ?? []).toEqual([]);
    expect(card.tidyChecks?.some((c) => c.kind === "teamFill") ?? false).toBe(false);
    expect(tile.map((s) => s.teamId).sort()).toEqual([world.a, world.b].sort());
    expect(preselected(tile)).toEqual([]);
  });

  test("2020-2024 plus 2025- on a 2025 set: both teams are in the window, so both are offered and neither preselected", async () => {
    const { world, card, tile } = await commitOne({
      year: "2025",
      stints: [
        { team: "A", fromYear: 2020, toYear: 2024 },
        { team: "B", fromYear: 2025 },
      ],
    });
    expect(card.teamOnCardIds ?? []).toEqual([]);
    expect(tile.map((s) => s.teamId).sort()).toEqual([world.a, world.b].sort());
    expect(preselected(tile)).toEqual([]);
  });

  test("both stints cover the set year: nothing written, none preselected", async () => {
    const { card, tile } = await commitOne({
      year: "2025",
      stints: [
        { team: "A", fromYear: 2020, toYear: 2025 },
        { team: "B", fromYear: 2025 },
      ],
    });
    expect(card.teamOnCardIds ?? []).toEqual([]);
    expect(tile).toHaveLength(2);
    expect(preselected(tile)).toEqual([]);
  });

  test("one stint covering the set year: the commit writes it with the note, and the tile preselects the same team", async () => {
    const { world, card, tile } = await commitOne({
      year: "2024",
      stints: [{ team: "B", fromYear: 2020 }],
    });
    expect(card.teamOnCardIds).toEqual([world.b]);
    expect(card.tidyChecks).toContainEqual({ kind: "teamFill", teamIds: [world.b], reason: "career" });
    expect(preselected(tile)).toEqual([world.b]);
  });

  test("one stint that ended the year before the set: the window holds it, so it is written and preselected", async () => {
    const { world, card, tile } = await commitOne({
      year: "2024",
      stints: [{ team: "A", fromYear: 2018, toYear: 2023 }],
    });
    expect(card.teamOnCardIds).toEqual([world.a]);
    expect(preselected(tile)).toEqual([world.a]);
  });

  test("a stint that ended two years before: nothing in the window, nothing written, the career offered whole and unselected", async () => {
    const { world, card, tile } = await commitOne({
      year: "2024",
      stints: [{ team: "A", fromYear: 2010, toYear: 2022 }],
    });
    expect(card.teamOnCardIds ?? []).toEqual([]);
    expect(tile.map((s) => s.teamId)).toEqual([world.a]);
    expect(tile[0].uncoveredSetYear).toBe(2024);
    expect(preselected(tile)).toEqual([]);
  });
});

/**
 * NEO-569 (restored in NEO-645): the set's own leagues break a tie between two
 * career teams in the window, for the tile, the commit's fill, the answer-time
 * fill and the guarded Apply-to-all alike.
 */
describe("the set's leagues break a window tie", () => {
  async function seedTie(opts: { setLeagues: "college" | "none" | "both" }) {
    const t = convexTest(schema, modules);
    live.push(t);
    const world = await t.run(async (ctx) => {
      const w = await seedTidyWorld(ctx, { year: "1995" });
      const ncaa = await ctx.db.insert("leagues", {
        level: "college",
        name: "NCAA Division I",
        nameNormalized: "ncaa division i",
        sportId: w.sport,
        lastUpdated: 1,
      });
      const echl = await ctx.db.insert("leagues", {
        level: "minor",
        name: "ECHL",
        nameNormalized: "echl",
        sportId: w.sport,
        lastUpdated: 1,
      });
      if (opts.setLeagues !== "none") {
        await ctx.db.patch(w.set, {
          leagueIds: opts.setLeagues === "both" ? [ncaa, echl] : [ncaa],
        });
      }
      const badgers = await addTeam(ctx, { sport: w.sport, league: ncaa }, "Wisconsin", "Badgers");
      const express = await addTeam(ctx, { sport: w.sport, league: echl }, "Roanoke", "Express");
      const player = await addPlayer(ctx, w, "Chris Pollack", [
        { teamId: badgers, fromYear: 1994, toYear: 1996 },
        { teamId: express, fromYear: 1995, toYear: 1996 },
      ]);
      return { w, badgers, express, player };
    });
    await t.withIdentity(ADMIN).action(api.selectorOptions.commitCardChecklist, {
      selectorOptionId: world.w.base,
      sportId: world.w.sport,
      cards: [
        {
          cardNumber: "1",
          cardName: "Chris Pollack",
          team: undefined,
          teams: [],
          players: ["Chris Pollack"],
          attributes: [],
          isRookie: false,
          isRelic: false,
          printRun: undefined,
          autographType: undefined,
          cardVariation: undefined,
          platformData: { bsc: { ref: "ref-1" } },
          unmatched: undefined,
        },
      ] as never,
    });
    const card = (await t.run((ctx) =>
      ctx.db
        .query("cardChecklist")
        .withIndex("by_selector_option", (q) => q.eq("selectorOptionId", world.w.base))
        .first(),
    ))!;
    const tile = await t
      .withIdentity(ADMIN)
      .query(api.cardChecklist.suggestedTeamsForCard, { cardId: card._id });
    return { t, world, card, tile };
  }

  test("a college set: the Badgers win the tie, the commit writes them, the tile preselects them first, both stay offered", async () => {
    const { world, card, tile } = await seedTie({ setLeagues: "college" });
    expect(card.teamOnCardIds).toEqual([world.badgers]);
    expect(preselected(tile)).toEqual([world.badgers]);
    expect(tile.map((s) => s.teamId)).toEqual([world.badgers, world.express]);
  });

  test("the answer-time fill and Apply-to-all read the same ranked verdict", async () => {
    const { t, world, card } = await seedTie({ setLeagues: "college" });
    const planned = await t.run(async (ctx) => {
      const bare = (await ctx.db.get(card._id))!;
      return planFillOnAnswer(ctx, bare, [world.player], newFillReadCache());
    });
    expect(planned).toEqual([world.badgers]);
    const takes = await t.run(async (ctx) => {
      const bare = (await ctx.db.get(card._id))!;
      const stripped = { ...bare, teamOnCardIds: [], teamNoneConfirmedAt: undefined };
      const read = async (teamId: Id<"teams">) =>
        cardTakesTeamFill(
          ctx,
          stripped,
          world.player,
          teamId,
          { noTeamLeaf: new Map(), stints: new Map(), years: new Map(), verdict: newCareerVerdictCache() },
        );
      return { badgers: await read(world.badgers), express: await read(world.express) };
    });
    expect(takes).toEqual({ badgers: true, express: false });
  });

  test("a set with no league: a tie stays a tie (nothing written, none preselected)", async () => {
    const { card, tile } = await seedTie({ setLeagues: "none" });
    expect(card.teamOnCardIds ?? []).toEqual([]);
    expect(preselected(tile)).toEqual([]);
    expect(tile).toHaveLength(2);
  });

  test("a set in both leagues: both rank best, so still a tie", async () => {
    const { card, tile } = await seedTie({ setLeagues: "both" });
    expect(card.teamOnCardIds ?? []).toEqual([]);
    expect(preselected(tile)).toEqual([]);
  });
});

describe("a team of another sport is not a team", () => {
  test("a two-sport player's stint in the other sport does not make the window a tie", async () => {
    const t = convexTest(schema, modules);
    live.push(t);
    const world = await t.run(async (ctx) => {
      const w = await seedTidyWorld(ctx, { year: "1995" });
      const football = await ctx.db.insert("selectorOptions", {
        level: "sport",
        value: "Football",
        platformData: {},
        children: [],
        lastUpdated: 1,
      });
      const baseTeam = await addTeam(ctx, w, "Kansas City", "Royals");
      const footTeam = await addTeam(ctx, { sport: football }, "Kansas City", "Chiefs");
      const player = await addPlayer(ctx, w, "Bo Jackson", [
        { teamId: baseTeam, fromYear: 1994, toYear: 1996 },
        { teamId: footTeam, fromYear: 1994, toYear: 1996 },
      ]);
      return { w, baseTeam, player };
    });
    await t.withIdentity(ADMIN).action(api.selectorOptions.commitCardChecklist, {
      selectorOptionId: world.w.base,
      sportId: world.w.sport,
      cards: [
        {
          cardNumber: "1",
          cardName: "Bo Jackson",
          team: undefined,
          teams: [],
          players: ["Bo Jackson"],
          attributes: [],
          isRookie: false,
          isRelic: false,
          printRun: undefined,
          autographType: undefined,
          cardVariation: undefined,
          platformData: { bsc: { ref: "ref-1" } },
          unmatched: undefined,
        },
      ] as never,
    });
    const card = (await t.run((ctx) =>
      ctx.db
        .query("cardChecklist")
        .withIndex("by_selector_option", (q) => q.eq("selectorOptionId", world.w.base))
        .first(),
    ))!;
    const tile = await t
      .withIdentity(ADMIN)
      .query(api.cardChecklist.suggestedTeamsForCard, { cardId: card._id });
    expect(card.teamOnCardIds).toEqual([world.baseTeam]);
    expect(preselected(tile)).toEqual([world.baseTeam]);
  });
});

describe("a career longer than the read cap offers only teams that passed the checks", () => {
  // A set year long after every stint: the window is empty, so the career is
  // offered whole, as choices. The verdict reads the first 24 teams
  // (`CAREER_TEAMS_READ`); a team past that was never checked for sport or
  // gone, so it must not reach the chip list at the lowest rank.
  async function longCareer(past: "otherSport" | "gone") {
    const t = convexTest(schema, modules);
    live.push(t);
    const world = await t.run(async (ctx) => {
      const w = await seedTidyWorld(ctx, { year: "2024" });
      const football = await ctx.db.insert("selectorOptions", {
        level: "sport",
        value: "Football",
        platformData: {},
        children: [],
        lastUpdated: 1,
      });
      const teams: Array<Id<"teams">> = [];
      for (let i = 0; i < 24; i++) teams.push(await addTeam(ctx, w, `Town ${i}`, `Club ${i}`));
      const twentyFifth =
        past === "otherSport"
          ? await addTeam(ctx, { sport: football }, "Kansas City", "Chiefs")
          : await addTeam(ctx, w, "Vanished", "Ghosts");
      if (past === "gone") await ctx.db.delete(twentyFifth);
      const player = await addPlayer(
        ctx,
        w,
        "Journeyman Joe",
        [...teams, twentyFifth].map((teamId, i) => ({ teamId, fromYear: 1990 + i, toYear: 1990 + i })),
      );
      const card = await printCard(ctx, w, { number: "1", extra: { playerIds: [player] } });
      return { w, teams, twentyFifth, card };
    });
    const tile = await t
      .withIdentity(ADMIN)
      .query(api.cardChecklist.suggestedTeamsForCard, { cardId: world.card });
    return { world, tile };
  }

  test("the 25th career team is another sport's: the first 24 are offered, the 25th is not", async () => {
    const { world, tile } = await longCareer("otherSport");
    expect(tile.map((s) => s.teamId).sort()).toEqual([...world.teams].sort());
    expect(tile.map((s) => s.teamId)).not.toContain(world.twentyFifth);
    expect(preselected(tile)).toEqual([]);
  });

  test("the 25th career team is gone: the first 24 are offered, nothing dangles", async () => {
    const { world, tile } = await longCareer("gone");
    expect(tile.map((s) => s.teamId).sort()).toEqual([...world.teams].sort());
  });

  // The same read serves a card whose set has no year: its career is offered whole.
  test("a set with no year offers the career's teams, never another sport's or a gone one", async () => {
    const t = convexTest(schema, modules);
    live.push(t);
    const world = await t.run(async (ctx) => {
      const w = await seedTidyWorld(ctx, { year: "Unknown" });
      const football = await ctx.db.insert("selectorOptions", {
        level: "sport",
        value: "Football",
        platformData: {},
        children: [],
        lastUpdated: 1,
      });
      const royals = await addTeam(ctx, w, "Kansas City", "Royals");
      const chiefs = await addTeam(ctx, { sport: football }, "Kansas City", "Chiefs");
      const ghosts = await addTeam(ctx, w, "Vanished", "Ghosts");
      await ctx.db.delete(ghosts);
      const player = await addPlayer(ctx, w, "Bo Jackson", [
        { teamId: royals, fromYear: 1986, toYear: 1990 },
        { teamId: chiefs, fromYear: 1987, toYear: 1990 },
        { teamId: ghosts, fromYear: 1991, toYear: 1991 },
      ]);
      const card = await printCard(ctx, w, { number: "1", extra: { playerIds: [player] } });
      return { royals, chiefs, ghosts, card };
    });
    const tile = await t
      .withIdentity(ADMIN)
      .query(api.cardChecklist.suggestedTeamsForCard, { cardId: world.card });
    expect(tile.map((s) => s.teamId)).toEqual([world.royals]);
    expect(preselected(tile)).toEqual([]);
  });

  test("careerVerdictFor leaves a team past the cap out of the stints and candidates", async () => {
    const t = convexTest(schema, modules);
    live.push(t);
    const out = await t.run(async (ctx) => {
      const w = await seedTidyWorld(ctx, { year: "2024" });
      const football = await ctx.db.insert("selectorOptions", {
        level: "sport",
        value: "Football",
        platformData: {},
        children: [],
        lastUpdated: 1,
      });
      const keys: string[] = [];
      for (let i = 0; i < 24; i++) keys.push(await addTeam(ctx, w, `Town ${i}`, `Club ${i}`));
      const other = await addTeam(ctx, { sport: football }, "Kansas City", "Chiefs");
      // The undated stint makes the whole career wanted, as an empty window does.
      const stints = [...keys, other].map((key) => ({ key: key as string }));
      const result = await careerVerdictFor(ctx, newCareerVerdictCache(), {
        stints,
        year: 2024,
        currentYear: 2026,
        selectorOptionId: w.base,
        sportId: w.sport,
      });
      return { result, keys, other };
    });
    expect(out.result.stints.map((s) => s.key)).not.toContain(out.other as string);
    expect(out.result.verdict.candidates).not.toContain(out.other as string);
    expect(out.result.verdict.answer).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// What the commit's career fill costs a chunk (the COMMIT_CHUNK_* budget)
// ───────────────────────────────────────────────────────────────────────────

/** `ctx.db` with every read counted (each get and query range) and every write. */
function counting(db: MutationCtx["db"]) {
  const stats = { reads: 0, writes: 0 };
  const wrapped = new Proxy(db, {
    get(target, prop) {
      const value = Reflect.get(target, prop) as unknown;
      if (typeof value !== "function") return value;
      const call = (counter: "reads" | "writes") => (...a: unknown[]) => {
        stats[counter]++;
        return (value as (...x: unknown[]) => unknown).apply(target, a);
      };
      if (prop === "get" || prop === "query") return call("reads");
      if (prop === "insert" || prop === "patch" || prop === "delete" || prop === "replace") {
        return call("writes");
      }
      return value.bind(target);
    },
  });
  return { db: wrapped as MutationCtx["db"], stats };
}

describe("the commit's career fill reads each player, team and league once per chunk", () => {
  const PLAYERS = 5;
  const CAREER = 8;

  /** One full chunk of one-player cards; every player shares the same `CAREER` teams, the window empty. */
  async function chunkCost(opts: { cards: number; withCareer: boolean; careerLength?: number }) {
    const t = convexTest(schema, modules);
    live.push(t);
    const careerLength = opts.careerLength ?? CAREER;
    const world = await t.run(async (ctx) => {
      const w = await seedTidyWorld(ctx, { year: "2024" });
      await ctx.db.patch(w.set, { leagueIds: [w.league] });
      const teams: Array<Id<"teams">> = [];
      for (let i = 0; i < careerLength; i++) {
        teams.push(await addTeam(ctx, { sport: w.sport, league: w.league }, `Town ${i}`, `Club ${i}`));
      }
      const players: Array<Id<"players">> = [];
      for (let p = 0; p < PLAYERS; p++) {
        players.push(
          await addPlayer(
            ctx,
            w,
            `Player ${p}`,
            opts.withCareer
              ? teams.map((teamId, i) => ({ teamId, fromYear: 1950 + i, toYear: 1950 + i }))
              : undefined,
          ),
        );
      }
      return { w, teams, players };
    });
    const handler = (commitCardChecklistChunk as unknown as {
      _handler: (ctx: MutationCtx, args: unknown) => Promise<{ storedIds: unknown[] }>;
    })._handler;
    const cards = Array.from({ length: opts.cards }, (_, i) => ({
      cardNumber: String(i + 1),
      cardName: `Card ${i + 1}`,
      platformData: {},
      sortOrder: i + 1,
      playerNames: [`Player ${i % PLAYERS}`],
      teamNames: [],
      playerIds: [world.players[i % PLAYERS]],
    }));
    return t.run(async (ctx) => {
      const { db, stats } = counting(ctx.db);
      const result = await handler(
        { ...ctx, db } as MutationCtx,
        { selectorOptionId: world.w.base, sportValue: "Baseball", setNameValue: "Chrome", cards },
      );
      const filled = (
        await Promise.all(result.storedIds.map((id) => ctx.db.get(id as Id<"cardChecklist">)))
      ).filter((card) => (card?.teamOnCardIds ?? []).length > 0).length;
      return { stored: result.storedIds.length, filled, ...stats };
    });
  }

  test("a full chunk's extra reads are the shared career's teams once, not once per card", async () => {
    const without = await chunkCost({ cards: CARDS_PER_COMMIT_CHUNK, withCareer: false });
    const small = await chunkCost({ cards: 15, withCareer: true });
    const full = await chunkCost({ cards: CARDS_PER_COMMIT_CHUNK, withCareer: true });
    const smallBase = await chunkCost({ cards: 15, withCareer: false });
    expect(full.stored).toBe(CARDS_PER_COMMIT_CHUNK);
    // The window is empty and no year covers it: the career is offered, never written.
    expect(full.filled).toBe(0);
    const extraFull = full.reads - without.reads;
    const extraSmall = small.reads - smallBase.reads;
    // Measured: 8 extra reads on a 150-card chunk (33 -> 41), one per career
    // team (their league is already read for the card's own league, so it is
    // shared, and a player's row is read for the card either way). The cache
    // reads each team once, however many cards repeat the career.
    expect(extraFull).toBe(CAREER);
    expect(extraFull).toBe(extraSmall);
    // And a long career is bounded by the read cap, not by its length.
    const long = await chunkCost({ cards: 15, withCareer: true, careerLength: 40 });
    const longBase = await chunkCost({ cards: 15, withCareer: false, careerLength: 40 });
    // Measured: 24 extra (33 -> 57), the verdict's read cap.
    expect(long.reads - longBase.reads).toBe(24);
  });
});
