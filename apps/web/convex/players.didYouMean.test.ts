/**
 * NEO-645 (S2) — "Did you mean": a near spelling of a printed name is offered,
 * ranked for the card, and nothing is ever linked by the offer. And the picker's
 * search ranks the card's team and year first.
 */
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { normalizePlayerName } from "./players";
import { normalizeTeamName } from "./teams";
import { insertTestCard } from "../lib/testing/card-row";
import { cancelScheduled } from "../lib/testing/drain-scheduled";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const ADMIN = { subject: "admin_dym", role: "admin" };

type T = ReturnType<typeof convexTest>;
type Sel = Id<"selectorOptions">;
const live: T[] = [];
const newT = () => {
  const t = convexTest(schema, modules);
  live.push(t);
  return t;
};
afterEach(async () => {
  for (const t of live.splice(0)) await cancelScheduled(t);
});

async function node(t: T, f: { level: string; value: string; parentId?: Sel }): Promise<Sel> {
  return t.run(async (ctx) => {
    const id = await ctx.db.insert("selectorOptions", {
      ...f,
      platformData: {},
      children: [],
      lastUpdated: Date.now(),
    });
    if (f.parentId) {
      const parent = await ctx.db.get(f.parentId);
      await ctx.db.patch(f.parentId, { children: [...(parent?.children ?? []), id] });
    }
    return id;
  });
}

async function setup(t: T, year = "2025") {
  const sportId = await node(t, { level: "sport", value: "Baseball" });
  const y = await node(t, { level: "year", value: year, parentId: sportId });
  const brand = await node(t, { level: "manufacturer", value: "Topps", parentId: y });
  const set = await node(t, { level: "setName", value: "Chrome", parentId: brand });
  const leaf = await node(t, { level: "variantType", value: "Base", parentId: set });
  const team = (location: string, name: string) =>
    t.run((ctx) =>
      ctx.db.insert("teams", {
        location,
        name,
        nameNormalized: normalizeTeamName(`${location} ${name}`),
        sportId,
        yearsActive: { from: 1900 },
        lastUpdated: Date.now(),
      }),
    );
  const orioles = await team("Baltimore", "Orioles");
  const yankees = await team("New York", "Yankees");
  return { sportId, leaf, orioles, yankees };
}

const player = (
  t: T,
  sportId: Sel,
  name: string,
  teamYears: Array<{ teamId: Id<"teams">; fromYear: number; toYear?: number }> = [],
) =>
  t.run((ctx) =>
    ctx.db.insert("players", {
      name,
      nameNormalized: normalizePlayerName(name),
      sportId,
      ...(teamYears.length ? { teamYears } : {}),
      lastUpdated: Date.now(),
    }),
  );

const card = (t: T, s: { leaf: Sel }, teamOnCardIds: Id<"teams">[] = []) =>
  t.run((ctx) =>
    insertTestCard(ctx, {
      selectorOptionId: s.leaf,
      cardNumber: "FS-3",
      cardName: "Jackson Holiday",
      sortOrder: 0,
      platformData: {},
      lastUpdated: 1,
      pendingPlayerNames: ["Jackson Holiday"],
      ...(teamOnCardIds.length ? { teamOnCardIds } : {}),
    }),
  );

describe("players.didYouMean", () => {
  test("offers a one-edit misspelling with the team and years that cover the card", async () => {
    const t = newT();
    const s = await setup(t);
    const holliday = await player(t, s.sportId, "Jackson Holliday", [
      { teamId: s.orioles, fromYear: 2024 },
    ]);
    const cardId = await card(t, s, [s.orioles]);
    const out = await t
      .withIdentity(ADMIN)
      .query(api.players.didYouMean, { cardId, name: "Jackson Holiday", sportId: s.sportId });
    expect(out).toEqual([
      { _id: holliday, name: "Jackson Holliday", distance: 1, teamName: "Baltimore Orioles", fromYear: 2024 },
    ]);
  });

  test("never links: the card and its names are untouched by the question", async () => {
    const t = newT();
    const s = await setup(t);
    await player(t, s.sportId, "Jackson Holliday");
    const cardId = await card(t, s);
    await t
      .withIdentity(ADMIN)
      .query(api.players.didYouMean, { cardId, name: "Jackson Holiday", sportId: s.sportId });
    const after = await t.run((ctx) => ctx.db.get(cardId));
    expect(after?.playerIds ?? []).toEqual([]);
    expect(after?.pendingPlayerNames).toEqual(["Jackson Holiday"]);
    expect(await t.run((ctx) => ctx.db.query("tidyNames").collect())).toEqual([]);
  });

  test("does not offer a name three edits away, a different sport, or the exact name", async () => {
    const t = newT();
    const s = await setup(t);
    await player(t, s.sportId, "Jackson Hallaway"); // 3 edits
    const hockey = await node(t, { level: "sport", value: "Hockey" });
    await player(t, hockey, "Jackson Holliday"); // another sport
    await player(t, s.sportId, "Jackson Holiday"); // the exact name: not "near"
    const cardId = await card(t, s);
    const out = await t
      .withIdentity(ADMIN)
      .query(api.players.didYouMean, { cardId, name: "Jackson Holiday", sportId: s.sportId });
    expect(out).toEqual([]);
  });

  test("ranks the player who covers the card's year ahead, and offers at most three", async () => {
    const t = newT();
    const s = await setup(t);
    await player(t, s.sportId, "Jackson Holliday", [{ teamId: s.yankees, fromYear: 1990, toYear: 1995 }]);
    await player(t, s.sportId, "Jackson Hollidey", [{ teamId: s.yankees, fromYear: 2024 }]);
    await player(t, s.sportId, "Jackson Holaday", []);
    await player(t, s.sportId, "Jackson Hollday", []);
    const cardId = await card(t, s, [s.orioles]);
    const out = await t
      .withIdentity(ADMIN)
      .query(api.players.didYouMean, { cardId, name: "Jackson Holiday", sportId: s.sportId });
    expect(out).toHaveLength(3);
    // Only the 2024 Yankee covers the card's year, so he leads the others,
    // which are then in edit-distance order.
    expect(out[0].name).toBe("Jackson Hollidey");
    expect(out[0]).toMatchObject({ teamName: "New York Yankees", fromYear: 2024 });
  });

  test("is admin-only and answers nothing for a blank name", async () => {
    const t = newT();
    const s = await setup(t);
    const cardId = await card(t, s);
    await expect(
      t.query(api.players.didYouMean, { cardId, name: "Jackson Holiday", sportId: s.sportId }),
    ).rejects.toThrow();
    expect(
      await t.withIdentity(ADMIN).query(api.players.didYouMean, { cardId, name: "  ", sportId: s.sportId }),
    ).toEqual([]);
  });
});

describe("players.search with a context card", () => {
  test("ranks a stint on the card's team covering its year ahead of the other namesakes", async () => {
    const t = newT();
    const s = await setup(t);
    await player(t, s.sportId, "Jackson Aaa", [{ teamId: s.yankees, fromYear: 1990, toYear: 1995 }]);
    await player(t, s.sportId, "Jackson Bbb", []);
    const target = await player(t, s.sportId, "Jackson Zzz", [{ teamId: s.orioles, fromYear: 2024 }]);
    const cardId = await card(t, s, [s.orioles]);
    const plain = await t.withIdentity(ADMIN).query(api.players.search, { query: "Jackson", sportId: s.sportId });
    const ranked = await t
      .withIdentity(ADMIN)
      .query(api.players.search, { query: "Jackson", sportId: s.sportId, contextCardId: cardId });
    expect(ranked).toHaveLength(plain.length);
    expect(ranked[0]._id).toBe(target);
  });
});
