/**
 * NEO-569 — each card's own league and a set's leagues.
 *
 * The pure rules first (`deriveCardLeagueId`, the blank reason), then
 * the real writers: a card born with its league, a team change settling it
 * through `syncCardTeamLinks`, an admin's explicit pick, a set's leagues
 * cascading to its teamless cards (rule A), a team's own league change
 * re-settling the cards that followed it, and the read shapes the UI consumes
 * — including the strict return validators that must admit the new fields.
 */

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { cardLeagueBlankReason, deriveCardLeagueId } from "./cardLeague";
import { bornSetLeagueIds } from "./leagues";
import { normalizeEntityName } from "../lib/entities/normalize-name";
import { insertTestCard } from "../lib/testing/card-row";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const ADMIN = { subject: "user_admin", role: "admin" };
const NOW = 1_700_000_000_000;
type T = ReturnType<typeof convexTest>;
type SelId = Id<"selectorOptions">;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("deriveCardLeagueId — the card rule", () => {
  test("teams all in one league → that league, whatever the set says", () => {
    expect(deriveCardLeagueId({ teamLeagueIds: ["mlb", "mlb"], setLeagueIds: ["ncaa"] })).toBe("mlb");
  });
  test("teams in two leagues → none (the operator decides)", () => {
    expect(deriveCardLeagueId({ teamLeagueIds: ["mlb", "nl"], setLeagueIds: ["mlb"] })).toBeUndefined();
  });
  test("a team without a league → none, never the other team's", () => {
    expect(deriveCardLeagueId({ teamLeagueIds: ["mlb", null], setLeagueIds: ["mlb"] })).toBeUndefined();
  });
  test("no team and a one-league set → the set's league", () => {
    expect(deriveCardLeagueId({ teamLeagueIds: [], setLeagueIds: ["mlb"] })).toBe("mlb");
    expect(deriveCardLeagueId({ teamLeagueIds: [], setLeagueIds: ["mlb", "mlb"] })).toBe("mlb");
  });
  test("no team and a many-league or league-less set → none", () => {
    expect(deriveCardLeagueId({ teamLeagueIds: [], setLeagueIds: ["mlb", "ncaa"] })).toBeUndefined();
    expect(deriveCardLeagueId({ teamLeagueIds: [], setLeagueIds: [] })).toBeUndefined();
  });
});

describe("cardLeagueBlankReason", () => {
  test("names why the teams gave no league", () => {
    expect(cardLeagueBlankReason([])).toBe("noTeam");
    expect(cardLeagueBlankReason(["mlb", null])).toBe("teamWithoutLeague");
    expect(cardLeagueBlankReason(["mlb", "nl"])).toBe("teamsInDifferentLeagues");
    expect(cardLeagueBlankReason(["mlb", "mlb"])).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The writers
// ───────────────────────────────────────────────────────────────────────────

async function seed(t: T) {
  return t.run(async (ctx) => {
    const row = (
      level: "sport" | "year" | "manufacturer" | "setName" | "variantType" | "insert",
      value: string,
      parentId?: SelId,
    ) =>
      ctx.db.insert("selectorOptions", {
        level,
        value,
        ...(parentId ? { parentId } : {}),
        platformData: {},
        children: [],
        lastUpdated: NOW,
      });
    const sport = await row("sport", "Baseball");
    const otherSport = await row("sport", "Football");
    const year = await row("year", "2024", sport);
    const brand = await row("manufacturer", "Topps", year);
    const set = await row("setName", "Chrome", brand);
    const base = await row("variantType", "Base", set);
    const inserts = await row("variantType", "Inserts", set);
    const insert = await row("insert", "Future Stars", inserts);
    await ctx.db.patch(set, { children: [base, inserts] });
    await ctx.db.patch(inserts, { children: [insert] });
    const league = (name: string, sportId: SelId, level: "major" | "college" = "major") =>
      ctx.db.insert("leagues", {
        level,
        name,
        nameNormalized: name.toLowerCase(),
        sportId,
        lastUpdated: NOW,
      });
    const mlb = await league("Major League Baseball", sport);
    const nl = await league("Negro National League", sport);
    const ncaa = await league("NCAA Division I", sport, "college");
    const nfl = await league("National Football League", otherSport);
    await ctx.db.patch(set, { leagueIds: [mlb] });
    const team = (name: string, leagueId?: Id<"leagues">) =>
      ctx.db.insert("teams", {
        name,
        nameNormalized: normalizeEntityName(name),
        sportId: sport,
        ...(leagueId ? { leagueId } : {}),
        lastUpdated: NOW,
      });
    const padres = await team("San Diego Padres", mlb);
    const mets = await team("New York Mets", mlb);
    const crawfords = await team("Pittsburgh Crawfords", nl);
    const badgers = await team("Wisconsin Badgers", ncaa);
    const nowhere = await team("Nowhere Nine");
    return {
      sport, set, base, inserts, insert, mlb, nl, ncaa, nfl,
      padres, mets, crawfords, badgers, nowhere,
    };
  });
}

const cardLeague = (t: T, id: Id<"cardChecklist">) =>
  t.run(async (ctx) => (await ctx.db.get(id))?.leagueId ?? null);

async function addCard(t: T, selectorOptionId: SelId, teamOnCardIds?: Array<Id<"teams">>) {
  return t.withIdentity(ADMIN).mutation(api.selectorOptions.addCustomCard, {
    selectorOptionId,
    cardNumber: String(Math.random()).slice(2, 8),
    cardName: "Card",
    ...(teamOnCardIds ? { teamOnCardIds } : {}),
  });
}

describe("a new set's default league is linked, never created", () => {
  async function bareSport(t: T, value: string) {
    return t.run(async (ctx) => {
      const sport = await ctx.db.insert("selectorOptions", {
        level: "sport", value, platformData: {}, children: [], lastUpdated: NOW,
      });
      const year = await ctx.db.insert("selectorOptions", {
        level: "year", value: "2024", parentId: sport, platformData: {}, children: [], lastUpdated: NOW,
      });
      const brand = await ctx.db.insert("selectorOptions", {
        level: "manufacturer", value: "Topps", parentId: year, platformData: {}, children: [], lastUpdated: NOW,
      });
      return { sport, brand };
    });
  }
  const leagueRows = (t: T) => t.run((ctx) => ctx.db.query("leagues").collect());

  test("no row for the sport's major league: the set gets none and NO league row is made", async () => {
    const t = convexTest(schema, modules);
    const { brand } = await bareSport(t, "Baseball");
    expect(await t.run(async (ctx) => (await bornSetLeagueIds(ctx, brand)) ?? null)).toBeNull();
    const setId = await t.withIdentity(ADMIN).mutation(api.selectorOptions.addCustomSelectorOption, {
      level: "setName", value: "Chrome", parentId: brand,
    });
    expect((await t.run((ctx) => ctx.db.get(setId)))!.leagueIds).toBeUndefined();
    expect(await leagueRows(t)).toHaveLength(0);
    expect((await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect()))).toHaveLength(0);
  });

  test("links the existing row by full name, by the abbreviation as an alias, or by a unique abbreviation", async () => {
    for (const shape of [
      { name: "Major League Baseball" },
      { name: "The Bigs", aliases: ["MLB"] },
      { name: "The Bigs", abbreviation: "MLB" },
    ]) {
      const t = convexTest(schema, modules);
      const { sport, brand } = await bareSport(t, "Baseball");
      const id = await t.run((ctx) =>
        ctx.db.insert("leagues", {
          ...shape, nameNormalized: shape.name.toLowerCase(), sportId: sport, level: "major", lastUpdated: NOW,
        }),
      );
      expect(await t.run((ctx) => bornSetLeagueIds(ctx, brand))).toEqual([id]);
      expect(await leagueRows(t)).toHaveLength(1);
    }
  });

  test("two leagues sharing the abbreviation: no guess, no default", async () => {
    const t = convexTest(schema, modules);
    const { sport, brand } = await bareSport(t, "Baseball");
    await t.run(async (ctx) => {
      for (const name of ["Alpha", "Beta"]) {
        await ctx.db.insert("leagues", {
          name, nameNormalized: name.toLowerCase(), abbreviation: "MLB", sportId: sport, level: "major", lastUpdated: NOW,
        });
      }
    });
    expect(await t.run(async (ctx) => (await bornSetLeagueIds(ctx, brand)) ?? null)).toBeNull();
  });
});

describe("a card is born with its league", () => {
  test("from its teams, from a one-league set, or none", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    expect(await cardLeague(t, await addCard(t, s.base, [s.crawfords]))).toBe(s.nl);
    expect(await cardLeague(t, await addCard(t, s.base))).toBe(s.mlb);
    expect(await cardLeague(t, await addCard(t, s.base, [s.padres, s.crawfords]))).toBeNull();
    expect(await cardLeague(t, await addCard(t, s.base, [s.nowhere]))).toBeNull();
  });

  test("a card under an insert with its own leagues takes the nearest list", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await t.run((ctx) => ctx.db.patch(s.inserts, { leagueIds: [s.ncaa] }));
    expect(await cardLeague(t, await addCard(t, s.insert))).toBe(s.ncaa);
  });
});

describe("a team change settles the league (syncCardTeamLinks)", () => {
  test("every team change re-derives: a split goes blank whatever came first, and an admin's pick lasts only until the teams change", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const admin = t.withIdentity(ADMIN);
    const id = await addCard(t, s.base, [s.padres]);
    expect(await cardLeague(t, id)).toBe(s.mlb);

    await admin.mutation(api.selectorOptions.updateCard, { id, teamOnCardIds: [s.crawfords] });
    expect(await cardLeague(t, id)).toBe(s.nl);

    // Teams in two leagues: blank, never the league the card had first.
    await admin.mutation(api.selectorOptions.updateCard, { id, teamOnCardIds: [s.crawfords, s.padres] });
    expect(await cardLeague(t, id)).toBeNull();
    // Same split, the other order: still blank (order never decides).
    await admin.mutation(api.selectorOptions.updateCard, { id, teamOnCardIds: [s.padres] });
    expect(await cardLeague(t, id)).toBe(s.mlb);
    await admin.mutation(api.selectorOptions.updateCard, { id, teamOnCardIds: [s.padres, s.crawfords] });
    expect(await cardLeague(t, id)).toBeNull();

    // An admin's pick holds while the teams stand…
    await admin.mutation(api.selectorOptions.updateCard, { id, leagueId: s.mlb });
    expect(await cardLeague(t, id)).toBe(s.mlb);
    // …and is replaced by the derivation once they change.
    await admin.mutation(api.selectorOptions.updateCard, { id, teamOnCardIds: [s.mets, s.crawfords] });
    expect(await cardLeague(t, id)).toBeNull();
    // A pick sent WITH a team change in one save is the admin's last word.
    await admin.mutation(api.selectorOptions.updateCard, {
      id,
      teamOnCardIds: [s.padres, s.crawfords],
      leagueId: s.nl,
    });
    expect(await cardLeague(t, id)).toBe(s.nl);

    await admin.mutation(api.selectorOptions.updateCard, { id, teamOnCardIds: [s.badgers] });
    expect(await cardLeague(t, id)).toBe(s.ncaa);

    await admin.mutation(api.selectorOptions.updateCard, { id, teamOnCardIds: [] });
    expect(await cardLeague(t, id)).toBe(s.mlb); // teamless in a one-league set
  });

  test("an edit that does not touch teams leaves the league alone", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const id = await addCard(t, s.base, [s.padres, s.crawfords]);
    await t.withIdentity(ADMIN).mutation(api.selectorOptions.updateCard, { id, cardName: "Renamed" });
    expect(await cardLeague(t, id)).toBeNull();
  });
});

describe("updateCard.leagueId — an admin's explicit pick", () => {
  test("sets, clears, and refuses another sport's league or a gone one", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const admin = t.withIdentity(ADMIN);
    const id = await addCard(t, s.base, [s.padres, s.crawfords]);

    await admin.mutation(api.selectorOptions.updateCard, { id, leagueId: s.nl });
    expect(await cardLeague(t, id)).toBe(s.nl);
    await admin.mutation(api.selectorOptions.updateCard, { id, leagueId: null });
    expect(await cardLeague(t, id)).toBeNull();

    await expect(
      admin.mutation(api.selectorOptions.updateCard, { id, leagueId: s.nfl }),
    ).rejects.toThrow(/National Football League is a league in another sport\./);
    await t.run((ctx) => ctx.db.delete(s.ncaa));
    await expect(
      admin.mutation(api.selectorOptions.updateCard, { id, leagueId: s.ncaa }),
    ).rejects.toThrow(/That league no longer exists\./);
    expect(await cardLeague(t, id)).toBeNull();
  });
});

describe("setSelectorOptionLeagues — a set's leagues", () => {
  test("refuses a row above the set, another sport's league, and more than 12", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const admin = t.withIdentity(ADMIN);
    const brand = await t.run(async (ctx) => {
      const set = await ctx.db.get(s.set);
      return set!.parentId!;
    });
    await expect(
      admin.mutation(api.selectorOptions.setSelectorOptionLeagues, {
        selectorOptionId: brand,
        leagueIds: [s.mlb],
      }),
    ).rejects.toThrow(/Pick leagues on the set, not on the sport, year or brand\./);
    await expect(
      admin.mutation(api.selectorOptions.setSelectorOptionLeagues, {
        selectorOptionId: s.set,
        leagueIds: [s.mlb, s.nfl],
      }),
    ).rejects.toThrow(/National Football League is a league in another sport\./);
    const many = await t.run(async (ctx) => {
      const out: Array<Id<"leagues">> = [];
      for (let i = 0; i < 13; i++) {
        out.push(
          await ctx.db.insert("leagues", {
            level: "minor",
            name: `League ${i}`,
            nameNormalized: `league ${i}`,
            sportId: s.sport,
            lastUpdated: NOW,
          }),
        );
      }
      return out;
    });
    await expect(
      admin.mutation(api.selectorOptions.setSelectorOptionLeagues, {
        selectorOptionId: s.set,
        leagueIds: many,
      }),
    ).rejects.toThrow(/A set can carry up to 12 leagues\./);
    expect((await t.run((ctx) => ctx.db.get(s.set)))!.leagueIds).toEqual([s.mlb]);
  });

  test("one lock per set: an ancestor's and a descendant's cascades never overlap (security N1)", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const admin = t.withIdentity(ADMIN);
    const underInsert = await addCard(t, s.insert);
    const stamp = async () => (await t.run((ctx) => ctx.db.get(s.set)))!.leagueCascadeStartedAt;
    const insertStamp = async () =>
      (await t.run((ctx) => ctx.db.get(s.inserts)))!.leagueCascadeStartedAt;

    // A descendant's edit stamps the SET row, and then refuses the set's edit.
    await admin.mutation(api.selectorOptions.setSelectorOptionLeagues, {
      selectorOptionId: s.inserts,
      leagueIds: [s.ncaa],
    });
    expect(await stamp()).toBeDefined();
    expect(await insertStamp()).toBeUndefined();
    await expect(
      admin.mutation(api.selectorOptions.setSelectorOptionLeagues, {
        selectorOptionId: s.set,
        leagueIds: [s.nl],
      }),
    ).rejects.toThrow(/Still applying the last league change/);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await stamp()).toBeUndefined();
    expect(await cardLeague(t, underInsert)).toBe(s.ncaa);

    // And the other way: the set's cascade refuses a descendant's edit.
    await admin.mutation(api.selectorOptions.setSelectorOptionLeagues, {
      selectorOptionId: s.set,
      leagueIds: [s.nl],
    });
    await expect(
      admin.mutation(api.selectorOptions.setSelectorOptionLeagues, {
        selectorOptionId: s.insert,
        leagueIds: [s.mlb],
      }),
    ).rejects.toThrow(/Still applying the last league change/);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await stamp()).toBeUndefined();
    // The insert type kept its own list, so its card stays put.
    expect(await cardLeague(t, underInsert)).toBe(s.ncaa);
  });

  test("rule A: teamless cards follow; a card with teams or an admin's other pick stays", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const admin = t.withIdentity(ADMIN);
    const teamless = await addCard(t, s.base);
    const underInsert = await addCard(t, s.insert);
    const withTeam = await addCard(t, s.base, [s.padres]);
    const picked = await addCard(t, s.base);
    await admin.mutation(api.selectorOptions.updateCard, { id: picked, leagueId: s.nl });

    await admin.mutation(api.selectorOptions.setSelectorOptionLeagues, {
      selectorOptionId: s.set,
      leagueIds: [s.ncaa],
    });
    // The stamp holds a second edit off until the cascade reports back.
    expect((await t.run((ctx) => ctx.db.get(s.set)))!.leagueCascadeStartedAt).toBeDefined();
    await expect(
      admin.mutation(api.selectorOptions.setSelectorOptionLeagues, {
        selectorOptionId: s.set,
        leagueIds: [s.mlb],
      }),
    ).rejects.toThrow(/Still applying the last league change\. Try again in a moment\./);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(await cardLeague(t, teamless)).toBe(s.ncaa);
    expect(await cardLeague(t, underInsert)).toBe(s.ncaa);
    expect(await cardLeague(t, withTeam)).toBe(s.mlb);
    expect(await cardLeague(t, picked)).toBe(s.nl);
    expect((await t.run((ctx) => ctx.db.get(s.set)))!.leagueCascadeStartedAt).toBeUndefined();

    // Two leagues: a teamless card has no single answer, so it is cleared.
    await admin.mutation(api.selectorOptions.setSelectorOptionLeagues, {
      selectorOptionId: s.set,
      leagueIds: [s.ncaa, s.mlb, s.ncaa],
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await t.run((ctx) => ctx.db.get(s.set)))!.leagueIds).toEqual([s.ncaa, s.mlb]);
    expect(await cardLeague(t, teamless)).toBeNull();
    expect(await cardLeague(t, picked)).toBe(s.nl);
  });

  test("a child with its own leagues answers for its cards; an empty list inherits again", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const admin = t.withIdentity(ADMIN);
    await admin.mutation(api.selectorOptions.setSelectorOptionLeagues, {
      selectorOptionId: s.inserts,
      leagueIds: [s.ncaa],
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const underInsert = await addCard(t, s.insert);
    expect(await cardLeague(t, underInsert)).toBe(s.ncaa);

    await admin.mutation(api.selectorOptions.setSelectorOptionLeagues, {
      selectorOptionId: s.set,
      leagueIds: [s.nl],
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await cardLeague(t, underInsert)).toBe(s.ncaa); // pruned: nearest wins

    await admin.mutation(api.selectorOptions.setSelectorOptionLeagues, {
      selectorOptionId: s.inserts,
      leagueIds: [],
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await t.run((ctx) => ctx.db.get(s.inserts)))!.leagueIds).toBeUndefined();
    expect(await cardLeague(t, underInsert)).toBe(s.nl);
  });

  test("getSelectorOptionLeagues: own, effective, where it inherits from, and the sport's list", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const admin = t.withIdentity(ADMIN);
    const atSet = await admin.query(api.selectorOptions.getSelectorOptionLeagues, {
      selectorOptionId: s.set,
    });
    expect(atSet.own?.map((l) => l._id)).toEqual([s.mlb]);
    expect(atSet.effective.map((l) => l._id)).toEqual([s.mlb]);
    expect(atSet.inheritedFrom).toBeNull();
    // Major first, then A–Z; never another sport's.
    expect(atSet.sportLeagues.map((l) => l.name)).toEqual([
      "Major League Baseball",
      "Negro National League",
      "NCAA Division I",
    ]);

    const atInsert = await admin.query(api.selectorOptions.getSelectorOptionLeagues, {
      selectorOptionId: s.insert,
    });
    expect(atInsert.own).toBeNull();
    expect(atInsert.effective.map((l) => l._id)).toEqual([s.mlb]);
    expect(atInsert.inheritedFrom).toBe(s.set);
  });
});

describe("a team's own league change re-settles its cards", () => {
  test("cards that followed the old league follow the new one; an admin's other pick stays", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const admin = t.withIdentity(ADMIN);
    const follows = await addCard(t, s.base, [s.nowhere]);
    const picked = await addCard(t, s.base, [s.nowhere, s.padres]);
    await admin.mutation(api.selectorOptions.updateCard, { id: picked, leagueId: s.nl });
    expect(await cardLeague(t, follows)).toBeNull();

    await admin.mutation(api.teams.saveTeamFields, { id: s.nowhere, leagueId: s.ncaa });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await cardLeague(t, follows)).toBe(s.ncaa);
    expect(await cardLeague(t, picked)).toBe(s.nl);

    await admin.mutation(api.teams.saveTeamFields, { id: s.nowhere, leagueId: s.mlb });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await cardLeague(t, follows)).toBe(s.mlb);
  });

  test("a team on no card schedules nothing", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await t.withIdentity(ADMIN).mutation(api.teams.saveTeamFields, { id: s.nowhere, leagueId: s.ncaa });
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled.filter((f) => f.name.includes("recomputeTeamCards"))).toEqual([]);
  });

  test("recomputeTeamCards pages through every link", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const ids: Array<Id<"cardChecklist">> = [];
    for (let i = 0; i < 3; i++) ids.push(await addCard(t, s.base, [s.nowhere]));
    await t.run((ctx) => ctx.db.patch(s.nowhere, { leagueId: s.ncaa }));
    await t.mutation(internal.cardLeague.recomputeTeamCards, { teamId: s.nowhere });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    for (const id of ids) expect(await cardLeague(t, id)).toBe(s.ncaa);
  });
});

describe("the read shapes (strict validators admit the new fields)", () => {
  test("cardLeagueOptions: current, the set's, the sport's, and why it is blank", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const admin = t.withIdentity(ADMIN);
    const split = await addCard(t, s.base, [s.padres, s.crawfords]);
    const options = await admin.query(api.cardLeague.cardLeagueOptions, { cardId: split });
    expect(options.current).toBeNull();
    expect(options.blankReason).toBe("teamsInDifferentLeagues");
    expect(options.setLeagues.map((l) => l._id)).toEqual([s.mlb]);
    expect(options.sportLeagues.map((l) => l._id)).toContain(s.nl);

    const plain = await addCard(t, s.base);
    const set = await admin.query(api.cardLeague.cardLeagueOptions, { cardId: plain });
    expect(set.current?._id).toBe(s.mlb);
    expect(set.blankReason).toBeNull();

    await t.run((ctx) => ctx.db.delete(plain));
    expect(await admin.query(api.cardLeague.cardLeagueOptions, { cardId: plain })).toEqual({
      current: null,
      setLeagues: [],
      sportLeagues: [],
      blankReason: null,
    });
  });

  test("getCardChecklist, getSelectorOptions and getSelectorOptionById return leagueId / leagueIds", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const admin = t.withIdentity(ADMIN);
    const id = await addCard(t, s.base);
    const cards = await admin.query(api.selectorOptions.getCardChecklist, { selectorOptionId: s.base });
    expect(cards.find((c) => c._id === id)?.leagueId).toBe(s.mlb);

    await t.run((ctx) => ctx.db.patch(s.set, { leagueCascadeStartedAt: NOW }));
    const byId = await admin.query(api.selectorOptions.getSelectorOptionById, { id: s.set });
    expect(byId?.leagueIds).toEqual([s.mlb]);
    expect(byId?.leagueCascadeStartedAt).toBe(NOW);
    const brand = (await t.run((ctx) => ctx.db.get(s.set)))!.parentId!;
    const list = await admin.query(api.selectorOptions.getSelectorOptions, {
      level: "setName",
      parentId: brand,
    });
    expect(list.find((row) => row._id === s.set)?.leagueIds).toEqual([s.mlb]);
  });
});

describe("a card written straight into the table", () => {
  test("keeps whatever league it was given (fixtures are not re-derived)", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const id = await t.run((ctx) =>
      insertTestCard(ctx, {
        selectorOptionId: s.base,
        cardNumber: "9",
        cardName: "Fixture",
        sortOrder: 0,
        platformData: {},
        leagueId: s.nl,
        lastUpdated: NOW,
      }),
    );
    expect(await cardLeague(t, id)).toBe(s.nl);
  });
});
