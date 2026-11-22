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
import { cancelScheduled, drainScheduled } from "../lib/testing/drain-scheduled";
import { addPlayer, addTeam, seedTidyWorld } from "../lib/testing/tidy-world";
import { newCareerVerdictCache } from "./lib/careerVerdict";
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

async function commitOne(opts: { year: string; stints: Stint[] }) {
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
          { stints: new Map(), years: new Map(), verdict: newCareerVerdictCache() },
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
