/**
 * NEO-645 — `tidyNames.createPlayer` ("Add as new player").
 *
 *   - NEO-463: a one-word name that is part of a fuller-named player is refused
 *     unless the operator said it is a one-name player, and NOTHING is written
 *     on a refusal;
 *   - the created player is then answered exactly as a link would be (the open
 *     card now, the rest through the fan-out);
 *   - `newPlayerCareer` is recorded on THIS card only, never on the fan-out's;
 *   - career teams are MATCHED, never created (NEO-236), and the lookup's birth
 *     year is deliberately not written (NEO-254);
 *   - the teamless-sport default is re-asked of the card.
 */

import { convexTest } from "convex-test";
import { afterEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { PLAYER_NAME_FRAGMENT } from "./players";
import { cancelScheduled, drainScheduled } from "../lib/testing/drain-scheduled";
import { normalizeEntityName } from "../lib/entities/normalize-name";
import {
  addPlayer,
  nameRow,
  printCard,
  seedTidyWorld,
  type TidyWorld,
} from "../lib/testing/tidy-world";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const ADMIN = { subject: "user_tidy_create_admin", role: "admin" };
const MEMBER = { subject: "user_tidy_create_member" };
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

const card = (t: T, id: Id<"cardChecklist">) => t.run((ctx) => ctx.db.get(id));
const create = (
  t: T,
  cardId: Id<"cardChecklist">,
  name: string,
  extra: { oneNamePlayer?: true; addSetSport?: true } = {},
) => t.withIdentity(ADMIN).mutation(api.tidyNames.createPlayer, { cardId, name, ...extra });
const players = (t: T) => t.run((ctx) => ctx.db.query("players").collect());

async function setup(t: T, name: string, over: Record<string, unknown> = {}) {
  return t.run(async (ctx) => {
    const w = await seedTidyWorld(ctx);
    await nameRow(ctx, { scopeId: w.base, sportId: w.sport, kind: "player", name, over: over as never });
    const open = await printCard(ctx, w, { number: "1", printed: [{ kind: "player", name }] });
    const other = await printCard(ctx, w, { number: "2", printed: [{ kind: "player", name }] });
    return { w: w as TidyWorld, open, other };
  });
}

describe("createPlayer — the answer and the fan-out", () => {
  test("creates the player in the row's sport and answers as the operator", async () => {
    const t = newT();
    const { w, open } = await setup(t, "Rookie Newguy");
    const out = await create(t, open, "Rookie Newguy");
    const made = (await players(t)).find((p) => p.name === "Rookie Newguy")!;
    expect(out.playerId).toBe(made._id);
    expect(made.sportId).toBe(w.sport);
    expect(made.nameNormalized).toBe(normalizeEntityName("Rookie Newguy"));
    expect(made.createdByUserId).toBeTruthy();
    const row = (await t.run((ctx) =>
      ctx.db
        .query("tidyNames")
        .withIndex("by_scope_kind_name", (q) =>
          q.eq("scopeId", w.base).eq("kind", "player").eq("nameNormalized", normalizeEntityName("Rookie Newguy")),
        )
        .first(),
    ))!;
    expect(row.answer).toEqual({ kind: "linkPlayer", playerId: made._id, by: "operator" });
    expect(out.answerGen).toBe(row.answerGen);
    expect((await card(t, open))!.playerIds).toEqual([made._id]);
    expect((await card(t, open))!.pendingPlayerNames).toBeUndefined();
  });

  test("the other cards that print the name take the new player through the fan-out", async () => {
    const t = newT();
    const { open, other } = await setup(t, "Rookie Newguy");
    const out = await create(t, open, "Rookie Newguy");
    expect((await card(t, other))!.playerIds).toBeUndefined();
    await drainScheduled(t);
    expect((await card(t, other))!.playerIds).toEqual([out.playerId]);
  });

  test("a second create for the same name is refused: the name already has an answer", async () => {
    const t = newT();
    const { open } = await setup(t, "Rookie Newguy");
    await create(t, open, "Rookie Newguy");
    await expect(create(t, open, "Rookie Newguy")).rejects.toThrow(/already has an answer/);
    expect((await players(t)).filter((p) => p.name === "Rookie Newguy")).toHaveLength(1);
  });
});

describe("createPlayer — NEO-463 one-word name fragments", () => {
  async function jordan(t: T) {
    return t.run(async (ctx) => {
      const w = await seedTidyWorld(ctx);
      await addPlayer(ctx, w, "Michael Jordan");
      await nameRow(ctx, { scopeId: w.base, sportId: w.sport, kind: "player", name: "Jordan" });
      const open = await printCard(ctx, w, { number: "1", printed: [{ kind: "player", name: "Jordan" }] });
      return { w, open };
    });
  }

  test("is refused without oneNamePlayer, with the structured code, and writes nothing", async () => {
    const t = newT();
    const { open } = await jordan(t);
    const before = (await players(t)).length;
    const err = (await create(t, open, "Jordan").catch((e) => e)) as { data?: { code?: string; matches?: Array<{ name: string }> } };
    expect(err.data?.code).toBe(PLAYER_NAME_FRAGMENT);
    expect(err.data?.matches?.map((m) => m.name)).toContain("Michael Jordan");
    expect((await players(t)).length).toBe(before);
    expect((await card(t, open))!.pendingPlayerNames).toEqual(["Jordan"]);
    expect((await card(t, open))!.tidyChecks).toBeUndefined();
  });

  test("oneNamePlayer: true creates the one-name player", async () => {
    const t = newT();
    const { open } = await jordan(t);
    const out = await create(t, open, "Jordan", { oneNamePlayer: true });
    expect((await players(t)).find((p) => p._id === out.playerId)!.name).toBe("Jordan");
    expect((await card(t, open))!.playerIds).toEqual([out.playerId]);
  });

  test("a one-word name with no fuller namesake needs no confirmation", async () => {
    const t = newT();
    const { open } = await t.run(async (ctx) => {
      const w = await seedTidyWorld(ctx);
      await nameRow(ctx, { scopeId: w.base, sportId: w.sport, kind: "player", name: "Pele" });
      return { open: await printCard(ctx, w, { number: "1", printed: [{ kind: "player", name: "Pele" }] }) };
    });
    await expect(create(t, open, "Pele")).resolves.toMatchObject({ answerGen: 1 });
  });

  test("a multi-word name is never a fragment", async () => {
    const t = newT();
    const { open } = await t.run(async (ctx) => {
      const w = await seedTidyWorld(ctx);
      await addPlayer(ctx, w, "Michael Jordan");
      await nameRow(ctx, { scopeId: w.base, sportId: w.sport, kind: "player", name: "Mike Jordan" });
      return { open: await printCard(ctx, w, { number: "1", printed: [{ kind: "player", name: "Mike Jordan" }] }) };
    });
    await expect(create(t, open, "Mike Jordan")).resolves.toBeTruthy();
  });
});

describe("createPlayer — what the lookup gives the new player", () => {
  test("career teams that match an NB team are written; one nobody reviewed is dropped, never created", async () => {
    const t = newT();
    const { w, open } = await setup(t, "Rookie Newguy", {
      status: "ready",
      enrichment: {
        wikidataId: "Q1",
        isHallOfFame: true,
        birthYear: 1990,
        careerTeams: [
          { name: "San Diego Padres", fromYear: 2020, toYear: 2022 },
          { name: "Atlantis Krakens", fromYear: 2018 },
        ],
      },
    });
    const teamsBefore = (await t.run((ctx) => ctx.db.query("teams").collect())).length;
    const out = await create(t, open, "Rookie Newguy");
    const made = (await players(t)).find((p) => p._id === out.playerId)!;
    expect(made.teamYears).toEqual([{ teamId: w.padres, fromYear: 2020, toYear: 2022 }]);
    expect(made.isHallOfFame).toBe(true);
    expect(made.externalIds?.wikidataId).toBe("Q1");
    // NEO-254: the lookup's birth year is what tells two namesakes apart; not written.
    expect(made.birthYear).toBeUndefined();
    expect((await t.run((ctx) => ctx.db.query("teams").collect())).length).toBe(teamsBefore);
  });

  test("a player with no lookup yet is created with no career", async () => {
    const t = newT();
    const { open } = await setup(t, "Rookie Newguy");
    const out = await create(t, open, "Rookie Newguy");
    expect((await players(t)).find((p) => p._id === out.playerId)!.teamYears).toBeUndefined();
  });
});

describe("createPlayer — newPlayerCareer lands on THIS card only", () => {
  test("the open card carries the check; the fan-out's cards do not", async () => {
    const t = newT();
    const { open, other } = await setup(t, "Rookie Newguy");
    const out = await create(t, open, "Rookie Newguy");
    await drainScheduled(t);
    expect((await card(t, open))!.tidyChecks).toEqual([{ kind: "newPlayerCareer", playerId: out.playerId }]);
    expect((await card(t, other))!.playerIds).toEqual([out.playerId]);
    expect((await card(t, other))!.tidyChecks).toBeUndefined();
  });

  test("never lists the same check twice", async () => {
    const t = newT();
    const { open } = await setup(t, "Rookie Newguy");
    const out = await create(t, open, "Rookie Newguy");
    // Change back and answer the same player again: still one check.
    await t.withIdentity(ADMIN).mutation(api.tidyNames.answerName, {
      cardId: open,
      kind: "player",
      name: "Rookie Newguy",
      answer: { kind: "clear" },
    });
    await t.withIdentity(ADMIN).mutation(api.tidyNames.answerName, {
      cardId: open,
      kind: "player",
      name: "Rookie Newguy",
      answer: { kind: "linkPlayer", playerId: out.playerId },
    });
    const checks = (await card(t, open))!.tidyChecks ?? [];
    expect(checks.filter((c) => c.kind === "newPlayerCareer")).toHaveLength(1);
  });
});

describe("createPlayer — the teamless-sport default and addSetSport", () => {
  test("a golfer created on a teamless sport's card is born No team", async () => {
    const t = newT();
    const { open } = await t.run(async (ctx) => {
      const w = await seedTidyWorld(ctx, { sportValue: "Golf" });
      await ctx.db.patch(w.sport, { teamlessSport: { setAt: 1, setByUserId: "setter" } });
      await nameRow(ctx, { scopeId: w.base, sportId: w.sport, kind: "player", name: "Rookie Golfer" });
      return { open: await printCard(ctx, w, { number: "1", printed: [{ kind: "player", name: "Rookie Golfer" }] }) };
    });
    expect((await card(t, open))!.teamNoneConfirmedAt).toBeUndefined();
    await create(t, open, "Rookie Golfer");
    expect((await card(t, open))!.teamNoneConfirmedAt).toBeGreaterThan(0);
  });

  test("addSetSport makes the player also play the set's sport, and the answer records it", async () => {
    const t = newT();
    const { w, open } = await t.run(async (ctx) => {
      const w = await seedTidyWorld(ctx);
      const hoops = await ctx.db.insert("selectorOptions", {
        level: "sport",
        value: "Basketball",
        platformData: {},
        children: [],
        lastUpdated: 1,
      });
      // The Sport chip moved the question to basketball on a baseball set.
      await nameRow(ctx, { scopeId: w.base, sportId: hoops, kind: "player", name: "Two Sport Star" });
      const open = await printCard(ctx, w, { number: "1", printed: [{ kind: "player", name: "Two Sport Star" }] });
      return { w, hoops, open };
    });
    const out = await create(t, open, "Two Sport Star", { addSetSport: true });
    const extra = await t.run((ctx) =>
      ctx.db
        .query("playerSports")
        .withIndex("by_player_id", (q) => q.eq("playerId", out.playerId))
        .collect(),
    );
    expect(extra.map((r) => r.sportId)).toEqual([w.sport]);
  });
});

describe("createPlayer — bounds and the gate", () => {
  test("a name over the player cap is refused naming the limit, never the value", async () => {
    const t = newT();
    const long = "Q".repeat(200);
    const { open } = await setup(t, "Rookie Newguy");
    const err = (await create(t, open, long).catch((e) => e)) as Error;
    expect(String(err.message)).toMatch(/limit is/);
    expect(String(err.message)).not.toContain(long);
  });

  test("a signed-out caller and a non-admin are refused", async () => {
    const t = newT();
    const { open } = await setup(t, "Rookie Newguy");
    await expect(t.mutation(api.tidyNames.createPlayer, { cardId: open, name: "Rookie Newguy" })).rejects.toThrow(
      /Not authenticated/,
    );
    await expect(
      t.withIdentity(MEMBER).mutation(api.tidyNames.createPlayer, { cardId: open, name: "Rookie Newguy" }),
    ).rejects.toThrow(/Admin access required/);
    expect(await players(t)).toEqual([]);
  });

  test("a name that is not on the card is refused and creates nobody", async () => {
    const t = newT();
    const { open } = await setup(t, "Rookie Newguy");
    await expect(create(t, open, "Somebody Else")).rejects.toThrow(/isn't on this card/);
    expect(await players(t)).toEqual([]);
  });
});
