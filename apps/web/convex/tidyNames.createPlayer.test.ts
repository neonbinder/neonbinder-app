/**
 * NEO-645 / NEO-656 — `tidyNames.createPlayer` ("Add as new player").
 *
 *   - NEO-463: a one-word name that is part of a fuller-named player is refused
 *     unless the operator said it is a one-name player, and NOTHING is written
 *     on a refusal;
 *   - the created player is then answered exactly as a link would be, on THIS
 *     card only (other cards are reached by Apply to all);
 *   - career teams come from the `enrichment` the operator saw, are MATCHED,
 *     never created (NEO-236), and the lookup's birth year is deliberately not
 *     written (NEO-254); the client's enrichment is bounded and checked;
 *   - the teamless-sport default is re-asked of the card.
 */

import { convexTest } from "convex-test";
import { afterEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { PLAYER_NAME_FRAGMENT } from "./players";
import { cancelScheduled } from "../lib/testing/drain-scheduled";
import { normalizeEntityName } from "../lib/entities/normalize-name";
import {
  addPlayer,
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
type CreateExtra = {
  oneNamePlayer?: true;
  addSetSport?: true;
  enrichment?: {
    wikidataId?: string;
    isHallOfFame?: boolean;
    careerTeams?: Array<{ name: string; fromYear: number; toYear?: number }>;
  };
};
/** The sport is the question's (the Sport chip), read from the card's own set here. */
const create = async (
  t: T,
  cardId: Id<"cardChecklist">,
  name: string,
  extra: CreateExtra & { sportId?: Id<"selectorOptions"> } = {},
) => {
  const { sportId, ...rest } = extra;
  const sport =
    sportId ??
    (await t.run(async (ctx) => {
      const row = (await ctx.db.query("selectorOptions").collect()).find((r) => r.level === "sport");
      return row!._id;
    }));
  return t.withIdentity(ADMIN).mutation(api.tidyNames.createPlayer, { cardId, name, sportId: sport, ...rest });
};
const players = (t: T) => t.run((ctx) => ctx.db.query("players").collect());

async function setup(t: T, name: string) {
  return t.run(async (ctx) => {
    const w = await seedTidyWorld(ctx);
    const open = await printCard(ctx, w, { number: "1", printed: [{ kind: "player", name }] });
    const other = await printCard(ctx, w, { number: "2", printed: [{ kind: "player", name }] });
    return { w: w as TidyWorld, open, other };
  });
}

describe("createPlayer — the answer, on this card only", () => {
  test("creates the player in the question's sport and links this card", async () => {
    const t = newT();
    const { w, open } = await setup(t, "Rookie Newguy");
    const out = await create(t, open, "Rookie Newguy");
    const made = (await players(t)).find((p) => p.name === "Rookie Newguy")!;
    expect(out).toEqual({ playerId: made._id });
    expect(made.sportId).toBe(w.sport);
    expect(made.nameNormalized).toBe(normalizeEntityName("Rookie Newguy"));
    expect(made.createdByUserId).toBeTruthy();
    const c = (await card(t, open))!;
    expect(c.playerIds).toEqual([made._id]);
    expect(c.playerLinks).toEqual([{ playerId: made._id, nameOnCard: "Rookie Newguy" }]);
    expect(c.pendingPlayerNames).toBeUndefined();
  });

  test("another card printing the name is not linked: only Apply to all reaches it", async () => {
    const t = newT();
    const { open, other } = await setup(t, "Rookie Newguy");
    await create(t, open, "Rookie Newguy");
    expect((await card(t, other))!.playerIds).toBeUndefined();
    expect((await card(t, other))!.pendingPlayerNames).toEqual(["Rookie Newguy"]);
  });

  test("a name Not-a-player took off the card is placed again when the walk re-asks (the card holds no stored ruling)", async () => {
    const t = newT();
    const { w, open } = await setup(t, "Rookie Newguy");
    await t.withIdentity(ADMIN).mutation(api.tidyNames.answerName, {
      cardId: open,
      kind: "player",
      name: "Rookie Newguy",
      sportId: w.sport,
      answer: { kind: "notEntity" },
    });
    expect((await card(t, open))!.pendingPlayerNames).toBeUndefined();
    const out = await create(t, open, "Rookie Newguy");
    expect((await card(t, open))!.playerIds).toEqual([out.playerId]);
  });

  test("a second create for the same name is refused: the name already has an answer", async () => {
    const t = newT();
    const { open } = await setup(t, "Rookie Newguy");
    await create(t, open, "Rookie Newguy");
    await expect(create(t, open, "Rookie Newguy")).rejects.toThrow(/already has an answer/);
    expect((await players(t)).filter((p) => p.name === "Rookie Newguy")).toHaveLength(1);
  });

  test("a card that is gone is refused and creates nobody", async () => {
    const t = newT();
    const { open } = await setup(t, "Rookie Newguy");
    await t.run((ctx) => ctx.db.delete(open));
    await expect(create(t, open, "Rookie Newguy")).rejects.toThrow(/card is gone/);
    expect(await players(t)).toEqual([]);
  });
});

describe("createPlayer — NEO-463 one-word name fragments", () => {
  async function jordan(t: T) {
    return t.run(async (ctx) => {
      const w = await seedTidyWorld(ctx);
      await addPlayer(ctx, w, "Michael Jordan");
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
      return { open: await printCard(ctx, w, { number: "1", printed: [{ kind: "player", name: "Pele" }] }) };
    });
    await expect(create(t, open, "Pele")).resolves.toHaveProperty("playerId");
  });

  test("a multi-word name is never a fragment", async () => {
    const t = newT();
    const { open } = await t.run(async (ctx) => {
      const w = await seedTidyWorld(ctx);
      await addPlayer(ctx, w, "Michael Jordan");
      return { open: await printCard(ctx, w, { number: "1", printed: [{ kind: "player", name: "Mike Jordan" }] }) };
    });
    await expect(create(t, open, "Mike Jordan")).resolves.toBeTruthy();
  });
});

describe("createPlayer — what the lookup gives the new player", () => {
  test("career teams that match an NB team are written; one nobody reviewed is dropped, never created", async () => {
    const t = newT();
    const { w, open } = await setup(t, "Rookie Newguy");
    const teamsBefore = (await t.run((ctx) => ctx.db.query("teams").collect())).length;
    const out = await create(t, open, "Rookie Newguy", {
      enrichment: {
        wikidataId: "Q1",
        isHallOfFame: true,
        careerTeams: [
          { name: "San Diego Padres", fromYear: 2020, toYear: 2022 },
          { name: "Atlantis Krakens", fromYear: 2018 },
        ],
      },
    });
    const made = (await players(t)).find((p) => p._id === out.playerId)!;
    expect(made.teamYears).toEqual([{ teamId: w.padres, fromYear: 2020, toYear: 2022 }]);
    expect(made.isHallOfFame).toBe(true);
    expect(made.externalIds?.wikidataId).toBe("Q1");
    // NEO-254: the lookup's birth year is what tells two namesakes apart; never sent, never written.
    expect(made.birthYear).toBeUndefined();
    expect((await t.run((ctx) => ctx.db.query("teams").collect())).length).toBe(teamsBefore);
  });

  test("a player with no lookup is created with no career", async () => {
    const t = newT();
    const { open } = await setup(t, "Rookie Newguy");
    const out = await create(t, open, "Rookie Newguy");
    expect((await players(t)).find((p) => p._id === out.playerId)!.teamYears).toBeUndefined();
  });

  test("a stint the career will not hold (a future year) is dropped like an unmatched team", async () => {
    const t = newT();
    const { open } = await setup(t, "Rookie Newguy");
    const out = await create(t, open, "Rookie Newguy", {
      enrichment: { careerTeams: [{ name: "San Diego Padres", fromYear: 3000 }] },
    });
    expect((await players(t)).find((p) => p._id === out.playerId)!.teamYears).toBeUndefined();
  });

  test("an enrichment from the client is checked: a bad Wikidata id and an over-long career are refused, and nobody is written", async () => {
    const t = newT();
    const { open } = await setup(t, "Rookie Newguy");
    await expect(
      create(t, open, "Rookie Newguy", { enrichment: { wikidataId: "not-a-qid" } }),
    ).rejects.toThrow(/Wikidata id/);
    await expect(
      create(t, open, "Rookie Newguy", {
        enrichment: {
          careerTeams: Array.from({ length: 65 }, (_, i) => ({ name: `Team ${i}`, fromYear: 2000 })),
        },
      }),
    ).rejects.toThrow(/At most 64/);
    expect(await players(t)).toEqual([]);
    expect((await card(t, open))!.pendingPlayerNames).toEqual(["Rookie Newguy"]);
  });
});

describe("createPlayer — the teamless-sport default and addSetSport", () => {
  test("a golfer created on a teamless sport's card is born No team", async () => {
    const t = newT();
    const { open } = await t.run(async (ctx) => {
      const w = await seedTidyWorld(ctx, { sportValue: "Golf" });
      await ctx.db.patch(w.sport, { teamlessSport: { setAt: 1, setByUserId: "setter" } });
      return { open: await printCard(ctx, w, { number: "1", printed: [{ kind: "player", name: "Rookie Golfer" }] }) };
    });
    expect((await card(t, open))!.teamNoneConfirmedAt).toBeUndefined();
    await create(t, open, "Rookie Golfer");
    expect((await card(t, open))!.teamNoneConfirmedAt).toBeGreaterThan(0);
  });

  test("addSetSport makes the player also play the set's sport", async () => {
    const t = newT();
    const { w, hoops, open } = await t.run(async (ctx) => {
      const w = await seedTidyWorld(ctx);
      const hoops = await ctx.db.insert("selectorOptions", {
        level: "sport",
        value: "Basketball",
        platformData: {},
        children: [],
        lastUpdated: 1,
      });
      // The Sport chip moved the question to basketball on a baseball set.
      const open = await printCard(ctx, w, { number: "1", printed: [{ kind: "player", name: "Two Sport Star" }] });
      return { w, hoops, open };
    });
    const out = await create(t, open, "Two Sport Star", { addSetSport: true, sportId: hoops });
    expect((await players(t)).find((p) => p._id === out.playerId)!.sportId).toBe(hoops);
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
    const { w, open } = await setup(t, "Rookie Newguy");
    const args = { cardId: open, name: "Rookie Newguy", sportId: w.sport };
    await expect(t.mutation(api.tidyNames.createPlayer, args)).rejects.toThrow(
      /Not authenticated/,
    );
    await expect(
      t.withIdentity(MEMBER).mutation(api.tidyNames.createPlayer, args),
    ).rejects.toThrow(/Admin access required/);
    expect(await players(t)).toEqual([]);
  });
});
