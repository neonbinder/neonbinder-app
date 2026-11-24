/**
 * NEO-645 — `players.addStint`, "Add to career" on the Career tile.
 *
 * Additive and idempotent over `appendCareerStints`: it never removes or
 * shortens a stint, a (team, fromYear) the player already has is `existing`, a
 * stint it cannot write is `skipped`. Nothing is rechecked or scheduled
 * (NEO-656): a card's career gap is read live (`careerCoverage.careerGaps`,
 * today's rule: a stint that STARTED by the card year), so it leaves every card
 * of the player the moment the stint exists.
 */

import { convexTest } from "convex-test";
import { afterEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { MAX_PLAYER_TEAM_YEARS } from "./players";
import { cancelScheduled } from "../lib/testing/drain-scheduled";
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
    const mk = (n: string, leaf = w.base, extra: Record<string, unknown> = {}) =>
      printCard(ctx, w, {
        leaf,
        number: n,
        extra: {
          playerIds: [merrill],
          playerLinks: [{ playerId: merrill, nameOnCard: "Jackson Merrill" }],
          teamOnCardIds: [w.padres],
          ...extra,
        },
      });
    return { w, merrill, open: await mk("1"), sibling: await mk("2"), elsewhere: await mk("3", w.insert) };
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

describe("addStint — the career gap is read live (NEO-656)", () => {
  const gapsOf = (t: T, s: World, leaf = s.w.base) =>
    t.withIdentity(ADMIN).query(api.careerCoverage.careerGaps, {
      pairs: [{ selectorOptionId: leaf, playerId: s.merrill, teamId: s.w.padres }],
    });

  test("a stint that STARTED by the card year covers the team: the gap is gone on every leaf, nothing written to the card", async () => {
    const t = newT();
    const s = await setup(t);
    expect(await gapsOf(t, s)).toHaveLength(1);
    expect(await gapsOf(t, s, s.w.insert)).toHaveLength(1);
    const before = (await card(t, s.open))!;
    await add(t, s, { fromYear: 2024 });
    expect(await gapsOf(t, s)).toEqual([]);
    expect(await gapsOf(t, s, s.w.insert)).toEqual([]);
    // Nothing is rechecked or stored: the card is exactly as it was.
    expect(await card(t, s.open)).toEqual(before);
  });

  test("a stint that starts AFTER the card year does not cover it (today's rule, not a window)", async () => {
    const t = newT();
    const s = await setup(t);
    await add(t, s, { fromYear: 2025 });
    expect(await gapsOf(t, s)).toHaveLength(1);
  });

  test("a stint for some OTHER team leaves the gap", async () => {
    const t = newT();
    const s = await setup(t);
    await add(t, s, { teamId: s.w.mets, fromYear: 2018, toYear: 2019 });
    expect(await gapsOf(t, s)).toHaveLength(1);
  });

  test("an `existing` stint changes nothing and schedules nothing", async () => {
    const t = newT();
    const s = await setup(t);
    await add(t, s, { fromYear: 2024 });
    expect(await add(t, s, { fromYear: 2024 })).toEqual({ added: 0, existing: 1, skipped: 0 });
    expect(await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).toEqual([]);
  });

  test("the legacy `cardId` argument is accepted and ignored", async () => {
    const t = newT();
    const s = await setup(t);
    const args = { playerId: s.merrill, teamId: s.w.padres, fromYear: 2024 };
    await t.withIdentity(ADMIN).mutation(api.players.addStint, args);
    expect(await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).toEqual([]);
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
