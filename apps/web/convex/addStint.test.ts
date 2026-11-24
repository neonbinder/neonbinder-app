/**
 * NEO-645 — `players.addStint`, "Add to career" on the Career tile.
 *
 * Additive and idempotent over `appendCareerStints`: it never removes or
 * shortens a stint, a (team, fromYear) the player already has is `existing`, a
 * stint it cannot write is `skipped`. After a write (or an `existing` hit, which
 * can still be what the card was waiting on) it re-checks the open card's
 * `careerGap` with today's rule (`careerCoversCardTeam`: a stint that STARTED by
 * the card year), then the leaf's other cards for that player by a scheduled
 * page. `tidyChecks` writes never bump `lastUpdated` (the NEO-203 baseVersion).
 */

import { convexTest } from "convex-test";
import { afterEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { MAX_PLAYER_TEAM_YEARS } from "./players";
import { cancelScheduled, drainScheduled } from "../lib/testing/drain-scheduled";
import { addPlayer, addTeam, printCard, seedTidyWorld, WORLD_NOW } from "../lib/testing/tidy-world";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const ADMIN = { subject: "user_add_stint_admin", role: "admin" };
const MEMBER = { subject: "user_add_stint_member" };
type T = ReturnType<typeof convexTest>;

const live: T[] = [];
const newT = () => {
  const t = convexTest(schema, modules);
  live.push(t);
  return t;
};
afterEach(async () => {
  for (const t of live.splice(0)) await cancelScheduled(t);
});

/** Set year 2024. Merrill has only a Mets stint; his card prints the Padres: a careerGap. */
async function setup(t: T) {
  return t.run(async (ctx) => {
    const w = await seedTidyWorld(ctx);
    const merrill = await addPlayer(ctx, w, "Jackson Merrill", [{ teamId: w.mets, fromYear: 2020, toYear: 2023 }]);
    const gap = [{ kind: "careerGap" as const, playerId: merrill, teamId: w.padres }];
    const mk = (n: string, leaf = w.base, extra: Record<string, unknown> = {}) =>
      printCard(ctx, w, {
        leaf,
        number: n,
        extra: {
          playerIds: [merrill],
          playerLinks: [{ playerId: merrill, nameOnCard: "Jackson Merrill" }],
          teamOnCardIds: [w.padres],
          tidyChecks: gap,
          ...extra,
        },
      });
    return { w, merrill, gap, open: await mk("1"), sibling: await mk("2"), elsewhere: await mk("3", w.insert) };
  });
}
type World = Awaited<ReturnType<typeof setup>>;

const card = (t: T, id: Id<"cardChecklist">) => t.run((ctx) => ctx.db.get(id));
const player = (t: T, id: Id<"players">) => t.run((ctx) => ctx.db.get(id));
const add = (
  t: T,
  s: World,
  stint: { teamId?: Id<"teams">; fromYear: number; toYear?: number; playerId?: Id<"players"> },
  cardId = s.open,
) =>
  t.withIdentity(ADMIN).mutation(api.players.addStint, {
    playerId: stint.playerId ?? s.merrill,
    teamId: stint.teamId ?? s.w.padres,
    fromYear: stint.fromYear,
    ...(stint.toYear !== undefined ? { toYear: stint.toYear } : {}),
    cardId,
  });

describe("addStint — additive", () => {
  test("adds the stint, keeps every existing one as it was, and stores them in the canonical order", async () => {
    const t = newT();
    const s = await setup(t);
    const out = await add(t, s, { fromYear: 2024 });
    expect(out).toEqual({ added: 1, existing: 0, skipped: 0 });
    const p = (await player(t, s.merrill))!;
    expect(p.teamYears).toEqual([
      { teamId: s.w.mets, fromYear: 2020, toYear: 2023 },
      { teamId: s.w.padres, fromYear: 2024 },
    ]);
  });

  test("a (team, fromYear) the player already has is `existing`: nothing is written, nothing shortened or widened", async () => {
    const t = newT();
    const s = await setup(t);
    const before = (await player(t, s.merrill))!;
    // Same team and start year, a different end year: the stored stint wins.
    const out = await add(t, s, { teamId: s.w.mets, fromYear: 2020, toYear: 2021 });
    expect(out).toEqual({ added: 0, existing: 1, skipped: 0 });
    const after = (await player(t, s.merrill))!;
    expect(after.teamYears).toEqual(before.teamYears);
    expect(after.lastUpdated).toBe(before.lastUpdated);
  });

  test("never removes: adding a stint for a second team keeps the first", async () => {
    const t = newT();
    const s = await setup(t);
    await add(t, s, { fromYear: 2024 });
    await add(t, s, { fromYear: 2018, toYear: 2019 });
    const teams = (await player(t, s.merrill))!.teamYears!.map((y) => `${y.teamId}|${y.fromYear}`);
    expect(teams).toHaveLength(3);
    expect(teams).toContain(`${s.w.mets}|2020`);
  });

  test("a team of another sport is skipped and counted, never written", async () => {
    const t = newT();
    const s = await setup(t);
    const foreign = await t.run(async (ctx) => {
      const hoops = await ctx.db.insert("selectorOptions", {
        level: "sport",
        value: "Basketball",
        platformData: {},
        children: [],
        lastUpdated: 1,
      });
      return addTeam(ctx, { sport: hoops }, "Boston", "Celtics");
    });
    const out = await add(t, s, { teamId: foreign, fromYear: 2024 });
    expect(out).toEqual({ added: 0, existing: 0, skipped: 1 });
    expect((await player(t, s.merrill))!.teamYears).toHaveLength(1);
  });

  test("a career at the cap skips the new stint", async () => {
    const t = newT();
    const s = await setup(t);
    await t.run((ctx) =>
      ctx.db.patch(s.merrill, {
        teamYears: Array.from({ length: MAX_PLAYER_TEAM_YEARS }, (_, i) => ({ teamId: s.w.mets, fromYear: 1950 + i })),
      }),
    );
    expect(await add(t, s, { fromYear: 2024 })).toEqual({ added: 0, existing: 0, skipped: 1 });
  });

  test("a player who is gone is skipped", async () => {
    const t = newT();
    const s = await setup(t);
    await t.run((ctx) => ctx.db.delete(s.merrill));
    expect(await add(t, s, { fromYear: 2024 })).toEqual({ added: 0, existing: 0, skipped: 1 });
  });

  test("years are held to the bounds every other writer holds", async () => {
    const t = newT();
    const s = await setup(t);
    await expect(add(t, s, { fromYear: 2024, toYear: 2020 })).rejects.toThrow();
    await expect(add(t, s, { fromYear: 1200 })).rejects.toThrow();
    await expect(add(t, s, { fromYear: 9999 })).rejects.toThrow();
    expect((await player(t, s.merrill))!.teamYears).toHaveLength(1);
  });
});

describe("addStint — re-checks careerGap on the open card, then the leaf", () => {
  test("a stint that STARTED by the card year covers the team: the open card's check is dropped", async () => {
    const t = newT();
    const s = await setup(t);
    await add(t, s, { fromYear: 2019 }); // started before 2024
    const open = (await card(t, s.open))!;
    expect(open.tidyChecks).toBeUndefined();
    // tidyChecks writes never bump the baseVersion.
    expect(open.lastUpdated).toBe(WORLD_NOW);
  });

  test("a stint that starts AFTER the card year does not cover it (today's rule, not a window): the check stays", async () => {
    const t = newT();
    const s = await setup(t);
    const out = await add(t, s, { fromYear: 2025 });
    expect(out.added).toBe(1);
    await drainScheduled(t);
    expect((await card(t, s.open))!.tidyChecks).toEqual(s.gap);
    expect((await card(t, s.sibling))!.tidyChecks).toEqual(s.gap);
  });

  test("a stint for some OTHER team leaves the check", async () => {
    const t = newT();
    const s = await setup(t);
    const braves = await t.run((ctx) => addTeam(ctx, { sport: s.w.sport, league: s.w.league }, "Atlanta", "Braves"));
    await add(t, s, { teamId: braves, fromYear: 2010 });
    await drainScheduled(t);
    expect((await card(t, s.open))!.tidyChecks).toEqual(s.gap);
  });

  test("the leaf's other cards of the player are re-checked by a scheduled page; other leaves are not", async () => {
    const t = newT();
    const s = await setup(t);
    await add(t, s, { fromYear: 2019 });
    // Before the page runs the sibling still carries the check.
    expect((await card(t, s.sibling))!.tidyChecks).toEqual(s.gap);
    await drainScheduled(t);
    expect((await card(t, s.sibling))!.tidyChecks).toBeUndefined();
    expect((await card(t, s.sibling))!.lastUpdated).toBe(WORLD_NOW);
    expect((await card(t, s.elsewhere))!.tidyChecks).toEqual(s.gap);
  });

  test("only that player's checks go: another player's gap on the same card stays", async () => {
    const t = newT();
    const s = await setup(t);
    const other = await t.run((ctx) => addPlayer(ctx, s.w, "Somebody Else"));
    const both = [...s.gap, { kind: "careerGap" as const, playerId: other, teamId: s.w.padres }];
    await t.run((ctx) => ctx.db.patch(s.open, { tidyChecks: both }));
    await add(t, s, { fromYear: 2019 });
    expect((await card(t, s.open))!.tidyChecks).toEqual([both[1]]);
  });

  test("a non-gap check on the card is never touched", async () => {
    const t = newT();
    const s = await setup(t);
    const keep = { kind: "newPlayerCareer" as const, playerId: s.merrill };
    await t.run((ctx) => ctx.db.patch(s.open, { tidyChecks: [...s.gap, keep] }));
    await add(t, s, { fromYear: 2019 });
    expect((await card(t, s.open))!.tidyChecks).toEqual([keep]);
  });

  test("an `existing` stint is still re-checked: it may be exactly what the card was waiting on", async () => {
    const t = newT();
    const s = await setup(t);
    // The stint is already on file (added elsewhere), but the card's check is stale.
    await t.run((ctx) =>
      ctx.db.patch(s.merrill, {
        teamYears: [
          { teamId: s.w.mets, fromYear: 2020, toYear: 2023 },
          { teamId: s.w.padres, fromYear: 2019 },
        ],
      }),
    );
    const out = await add(t, s, { fromYear: 2019 });
    expect(out).toEqual({ added: 0, existing: 1, skipped: 0 });
    expect((await card(t, s.open))!.tidyChecks).toBeUndefined();
  });

  test("a skipped stint re-checks nothing", async () => {
    const t = newT();
    const s = await setup(t);
    const foreign = await t.run(async (ctx) => {
      const hoops = await ctx.db.insert("selectorOptions", {
        level: "sport",
        value: "Basketball",
        platformData: {},
        children: [],
        lastUpdated: 1,
      });
      return addTeam(ctx, { sport: hoops }, "Boston", "Celtics");
    });
    await add(t, s, { teamId: foreign, fromYear: 2019 });
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled.filter((f) => f.name.includes("recheckCareerGapPage"))).toEqual([]);
    expect((await card(t, s.open))!.tidyChecks).toEqual(s.gap);
  });

  test("a card that is gone does not fail the write", async () => {
    const t = newT();
    const s = await setup(t);
    await t.run((ctx) => ctx.db.delete(s.open));
    await expect(add(t, s, { fromYear: 2019 })).resolves.toEqual({ added: 1, existing: 0, skipped: 0 });
  });

  test("a stale gap on a multi-player card is dropped too: coverage is by player and team", async () => {
    const t = newT();
    const s = await setup(t);
    const two = await t.run(async (ctx) => {
      const other = await addPlayer(ctx, s.w, "Somebody Else");
      return printCard(ctx, s.w, {
        number: "9",
        extra: {
          playerIds: [s.merrill, other],
          playerLinks: [
            { playerId: s.merrill, nameOnCard: "Jackson Merrill" },
            { playerId: other, nameOnCard: "Somebody Else" },
          ],
          teamOnCardIds: [s.w.padres],
          tidyChecks: s.gap,
        },
      });
    });
    await add(t, s, { fromYear: 2019 });
    await drainScheduled(t);
    // Coverage is by (player, team) and does not look at how many players the card has:
    // the check on a two-player card would be dropped too, never added.
    expect((await card(t, two))!.tidyChecks).toBeUndefined();
  });
});

describe("addStint — the gate", () => {
  test("refuses a signed-out caller and a non-admin, and writes nothing", async () => {
    const t = newT();
    const s = await setup(t);
    const args = { playerId: s.merrill, teamId: s.w.padres, fromYear: 2019, cardId: s.open };
    await expect(t.mutation(api.players.addStint, args)).rejects.toThrow(/Not authenticated/);
    await expect(t.withIdentity(MEMBER).mutation(api.players.addStint, args)).rejects.toThrow(
      /Admin access required/,
    );
    expect((await player(t, s.merrill))!.teamYears).toHaveLength(1);
  });
});
