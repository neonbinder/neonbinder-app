/**
 * NEO-645 — the real reads and writes of `tidyCards.ts` (`cardContext`,
 * `markReviewed`), the strict `getCardChecklist` returns for the four new card
 * fields, and the gate on every function of the Tidy Up surface.
 */

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { insertTestCard } from "../lib/testing/card-row";
import { normalizeEntityName } from "../lib/entities/normalize-name";
import { syncCardPrintedNames } from "./cardPrintedNames";
import {
  tidyReviewedKeyCareer,
  tidyReviewedKeyCut,
  tidyReviewedKeyVariation,
} from "./features/cardAttention";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const NOW = 1_700_000_000_000;
const ADMIN = { subject: "user_admin", role: "admin" };
const MEMBER = { subject: "user_member" };
type T = ReturnType<typeof convexTest>;

// Seeds run inside one `t.run` and hand back plain ids (closures over a closed
// ctx would not survive the run).
type Ctx = Parameters<Parameters<T["run"]>[0]>[0];
async function seedBase(ctx: Ctx) {
  const sport = await ctx.db.insert("selectorOptions", {
    level: "sport",
    value: "Baseball",
    platformData: {},
    children: [],
    lastUpdated: NOW,
  });
  const year = await ctx.db.insert("selectorOptions", {
    level: "year",
    value: "2024",
    parentId: sport,
    platformData: {},
    children: [],
    lastUpdated: NOW,
  });
  const brand = await ctx.db.insert("selectorOptions", {
    level: "manufacturer",
    value: "Topps",
    parentId: year,
    platformData: {},
    children: [],
    lastUpdated: NOW,
  });
  const set = await ctx.db.insert("selectorOptions", {
    level: "setName",
    value: "Chrome",
    parentId: brand,
    platformData: {},
    children: [],
    lastUpdated: NOW,
  });
  const base = await ctx.db.insert("selectorOptions", {
    level: "variantType",
    value: "Base",
    parentId: set,
    platformData: {},
    children: [],
    lastUpdated: NOW,
  });
  const leagueId = await ctx.db.insert("leagues", {
    level: "major",
    name: "Major League Baseball",
    nameNormalized: "baseball league major",
    sportId: sport,
    lastUpdated: NOW,
  });
  const team = (location: string, name: string) =>
    ctx.db.insert("teams", {
      name,
      location,
      nameNormalized: normalizeEntityName(`${location} ${name}`),
      sportId: sport,
      leagueId,
      lastUpdated: NOW,
    });
  const padres = await team("San Diego", "Padres");
  const mets = await team("New York", "Mets");
  const player = (name: string, teamYears?: Array<{ teamId: Id<"teams">; fromYear?: number; toYear?: number }>) =>
    ctx.db.insert("players", {
      name,
      nameNormalized: normalizeEntityName(name),
      sportId: sport,
      ...(teamYears ? { teamYears } : {}),
      lastUpdated: NOW,
    });
  const merrill = await player("Jackson Merrill", [
    { teamId: padres, fromYear: 2024 },
    { teamId: mets, fromYear: 2020, toYear: 2023 },
  ]);
  const card = (cardNumber: string, extra: Record<string, unknown> = {}) =>
    insertTestCard(ctx, {
      selectorOptionId: base,
      cardNumber,
      cardName: `Card ${cardNumber}`,
      platformData: {},
      sortOrder: Number(cardNumber) || 0,
      lastUpdated: NOW,
      ...extra,
    });
  return { sport, base, padres, mets, merrill, card };
}

describe("tidyCards.cardContext — reads", () => {
  test("is null for a card that is gone", async () => {
    const t = convexTest(schema, modules);
    const id = await t.run(async (ctx) => {
      const { card } = await seedBase(ctx);
      const c = await card("1");
      await ctx.db.delete(c);
      return c;
    });
    expect(await t.withIdentity(ADMIN).query(api.tidyCards.cardContext, { cardId: id })).toBeNull();
  });

  test("a linked player comes back with his stints; the exact-name link is 'Linked for you'", async () => {
    const t = convexTest(schema, modules);
    const { id, merrill, padres, mets } = await t.run(async (ctx) => {
      const s = await seedBase(ctx);
      const id = await s.card("1", {
        playerIds: [s.merrill],
        playerLinks: [{ playerId: s.merrill, nameOnCard: "Jackson Merrill" }],
        teamOnCardIds: [s.padres],
      });
      return { id, merrill: s.merrill, padres: s.padres, mets: s.mets };
    });
    const ctxView = await t.withIdentity(ADMIN).query(api.tidyCards.cardContext, { cardId: id });
    expect(ctxView).not.toBeNull();
    expect(ctxView!.names).toEqual([]);
    expect(ctxView!.players).toEqual([
      {
        playerId: merrill,
        name: "Jackson Merrill",
        sportId: expect.any(String),
        stints: [
          { teamId: padres, teamName: "San Diego Padres", fromYear: 2024 },
          { teamId: mets, teamName: "New York Mets", fromYear: 2020, toYear: 2023 },
        ],
        stintsMore: false,
      },
    ]);
    expect(ctxView!.playersMore).toBe(false);
    expect(ctxView!.linkedFor).toEqual([{ kind: "player", playerId: merrill, reason: "exact" }]);
    expect(ctxView!.teams).toEqual([
      { teamId: padres, name: "San Diego Padres", onCard: true, candidate: false },
    ]);
  });

  test("an auto-linked name reports its reason and shows the answered name row", async () => {
    const t = convexTest(schema, modules);
    const { auto, merrill } = await t.run(async (ctx) => {
      const s = await seedBase(ctx);
      const base = s.base;
      const mk = async (cardNumber: string, by: "auto" | "operator") => {
        const id = await s.card(cardNumber, {
          playerIds: [s.merrill],
          playerLinks: [{ playerId: s.merrill, nameOnCard: "Jackson Merril" }],
        });
        await ctx.db.insert("tidyNames", {
          scopeId: base,
          kind: "player",
          nameNormalized: normalizeEntityName("Jackson Merril"),
          name: "Jackson Merril",
          sportId: s.sport,
          status: "ready",
          answer:
            by === "auto"
              ? { kind: "linkPlayer", playerId: s.merrill, by: "auto", autoReason: "setHistory" }
              : { kind: "linkPlayer", playerId: s.merrill, by: "operator" },
        });
        await syncCardPrintedNames(ctx, { _id: id }, [
          {
            kind: "player",
            scopeId: base,
            nameNormalized: normalizeEntityName("Jackson Merril"),
            printed: "Jackson Merril",
            order: 0,
          },
        ]);
        return id;
      };
      const auto = await mk("1", "auto");
      return { auto, merrill: s.merrill };
    });
    const view = await t.withIdentity(ADMIN).query(api.tidyCards.cardContext, { cardId: auto });
    expect(view!.linkedFor).toEqual([{ kind: "player", playerId: merrill, reason: "setHistory" }]);
    expect(view!.names).toHaveLength(1);
    expect(view!.names[0]).toMatchObject({
      kind: "player",
      printed: "Jackson Merril",
      cardOverride: false,
      printedOn: null, // answered
      row: { status: "ready", answer: { kind: "linkPlayer", by: "auto", autoReason: "setHistory" } },
    });
  });

  test("an operator answer is not 'for you'", async () => {
    const t = convexTest(schema, modules);
    const id = await t.run(async (ctx) => {
      const s = await seedBase(ctx);
      const id = await s.card("1", {
        playerIds: [s.merrill],
        playerLinks: [{ playerId: s.merrill, nameOnCard: "Jackson Merril" }],
      });
      await ctx.db.insert("tidyNames", {
        scopeId: s.base,
        kind: "player",
        nameNormalized: normalizeEntityName("Jackson Merril"),
        name: "Jackson Merril",
        sportId: s.sport,
        status: "ready",
        answer: { kind: "linkPlayer", playerId: s.merrill, by: "operator" },
      });
      await syncCardPrintedNames(ctx, { _id: id }, [
        {
          kind: "player",
          scopeId: s.base,
          nameNormalized: normalizeEntityName("Jackson Merril"),
          printed: "Jackson Merril",
          order: 0,
        },
      ]);
      return id;
    });
    const view = await t.withIdentity(ADMIN).query(api.tidyCards.cardContext, { cardId: id });
    expect(view!.linkedFor).toEqual([]);
  });

  test("an unanswered name shows who else printed it, up to the shown cap, counted", async () => {
    const t = convexTest(schema, modules);
    const id = await t.run(async (ctx) => {
      const s = await seedBase(ctx);
      const key = normalizeEntityName("Doc Gooden");
      await ctx.db.insert("tidyNames", {
        scopeId: s.base,
        kind: "player",
        nameNormalized: key,
        name: "Doc Gooden",
        sportId: s.sport,
        status: "pending",
      });
      let first: Id<"cardChecklist"> | undefined;
      for (let i = 1; i <= 11; i++) {
        const c = await s.card(String(i), { pendingPlayerNames: ["Doc Gooden"] });
        first ??= c;
        await syncCardPrintedNames(ctx, { _id: c }, [
          { kind: "player", scopeId: s.base, nameNormalized: key, printed: "Doc Gooden", order: 0 },
        ]);
      }
      return first!;
    });
    const view = await t.withIdentity(ADMIN).query(api.tidyCards.cardContext, { cardId: id });
    expect(view!.names).toHaveLength(1);
    const printedOn = view!.names[0].printedOn!;
    expect(printedOn.count).toBe(11);
    expect(printedOn.more).toBe(false);
    expect(printedOn.cardNumbers).toHaveLength(8);
    expect(view!.names[0].row).toMatchObject({ status: "pending" });
  });

  test("a printed name whose scope leaf is gone is read in the card's own leaf (Q3)", async () => {
    const t = convexTest(schema, modules);
    const { id, base } = await t.run(async (ctx) => {
      const s = await seedBase(ctx);
      const sourceLeaf = await ctx.db.insert("selectorOptions", {
        level: "variantType",
        value: "Insert",
        platformData: {},
        children: [],
        lastUpdated: NOW,
      });
      const key = normalizeEntityName("Doc Gooden");
      // The name row exists in the card's OWN leaf; the printed row points at a gone leaf.
      await ctx.db.insert("tidyNames", {
        scopeId: s.base,
        kind: "player",
        nameNormalized: key,
        name: "Doc Gooden",
        sportId: s.sport,
        status: "ready",
      });
      const c = await s.card("1", { pendingPlayerNames: ["Doc Gooden"] });
      await syncCardPrintedNames(ctx, { _id: c }, [
        { kind: "player", scopeId: sourceLeaf, nameNormalized: key, printed: "Doc Gooden", order: 0 },
      ]);
      await ctx.db.delete(sourceLeaf);
      return { id: c, base: s.base };
    });
    const view = await t.withIdentity(ADMIN).query(api.tidyCards.cardContext, { cardId: id });
    expect(view!.names[0].scopeId).toBe(base);
    expect(view!.names[0].row).toMatchObject({ name: "Doc Gooden", status: "ready" });
  });

  test("a team name row offers its candidates; the card's team is flagged onCard", async () => {
    const t = convexTest(schema, modules);
    const { id, padres, mets } = await t.run(async (ctx) => {
      const s = await seedBase(ctx);
      const key = normalizeEntityName("NY");
      await ctx.db.insert("tidyNames", {
        scopeId: s.base,
        kind: "team",
        nameNormalized: key,
        name: "NY",
        sportId: s.sport,
        status: "ready",
        candidateTeamIds: [s.mets, s.padres],
      });
      const c = await s.card("1", { teamOnCardIds: [s.padres], pendingTeamNames: ["NY"] });
      await syncCardPrintedNames(ctx, { _id: c }, [
        { kind: "team", scopeId: s.base, nameNormalized: key, printed: "NY", order: 0 },
      ]);
      return { id: c, padres: s.padres, mets: s.mets };
    });
    const view = await t.withIdentity(ADMIN).query(api.tidyCards.cardContext, { cardId: id });
    expect(view!.teams.map((x) => [x.teamId, x.onCard, x.candidate]).sort()).toEqual(
      [
        [padres, true, true],
        [mets, false, true],
      ].sort(),
    );
  });

  test("a name row says whether anyone ever asked Wikidata about it (neverLooked)", async () => {
    const t = convexTest(schema, modules);
    const id = await t.run(async (ctx) => {
      const s = await seedBase(ctx);
      const rows: Array<[string, Record<string, unknown>]> = [
        // Born (or migrated) ready and bare: nobody has asked.
        ["Born Ready", {}],
        // A lookup ran and found nothing: ready and bare, but it left a generation.
        ["Finished Miss", { lookupGen: 2 }],
        // Asked once, the generation since cleared: the request time still says so.
        ["Asked Once", { lookupRequestedAt: NOW }],
        // Not ready, or already answered or enriched: never "new" either.
        ["Still Pending", { status: "pending" }],
        ["Answered", { answer: { kind: "notEntity", by: "operator" } }],
      ];
      const c = await s.card("1", { pendingPlayerNames: rows.map(([n]) => n) });
      const printed = [];
      for (const [i, [name, extra]] of rows.entries()) {
        const key = normalizeEntityName(name);
        await ctx.db.insert("tidyNames", {
          scopeId: s.base,
          kind: "player",
          nameNormalized: key,
          name,
          sportId: s.sport,
          status: "ready",
          ...extra,
        } as never);
        printed.push({ kind: "player" as const, scopeId: s.base, nameNormalized: key, printed: name, order: i });
      }
      await syncCardPrintedNames(ctx, { _id: c }, printed);
      return c;
    });
    const view = await t.withIdentity(ADMIN).query(api.tidyCards.cardContext, { cardId: id });
    const byName = Object.fromEntries(view!.names.map((n) => [n.printed, n.row!.neverLooked]));
    expect(byName).toEqual({
      "Born Ready": true,
      "Finished Miss": false,
      "Asked Once": false,
      "Still Pending": false,
      Answered: false,
    });
  });

  test("refuses a signed-out caller and a non-admin", async () => {
    const t = convexTest(schema, modules);
    const id = await t.run(async (ctx) => {
      const { card } = await seedBase(ctx);
      return card("1");
    });
    await expect(t.query(api.tidyCards.cardContext, { cardId: id })).rejects.toThrow();
    await expect(
      t.withIdentity(MEMBER).query(api.tidyCards.cardContext, { cardId: id }),
    ).rejects.toThrow(/admin access required/i);
  });
});

describe("tidyCards.markReviewed", () => {
  const CUT = { listingTitle: "2024 Topps Chrome #1 Mike Trout", listingTitleTruncated: true };

  test("stores the keys the operator saw that are still current, without touching lastUpdated", async () => {
    const t = convexTest(schema, modules);
    const id = await t.run(async (ctx) => {
      const s = await seedBase(ctx);
      return s.card("1", {
        ...CUT,
        playerIds: [s.merrill],
        teamOnCardIds: [s.padres],
        cardVariation: "v".repeat(70),
      });
    });
    const cut = tidyReviewedKeyCut(CUT.listingTitle);
    const variation = tidyReviewedKeyVariation("v".repeat(70));
    const res = await t
      .withIdentity(ADMIN)
      .mutation(api.tidyCards.markReviewed, { cardId: id, keys: [cut, "stale:key", cut] });
    // The variation key was never shown to the operator, so it is not marked seen.
    expect(res.keys).toEqual([cut]);
    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row!.tidyReviewed!.keys).toEqual([cut]);
    expect(row!.lastUpdated).toBe(NOW);
    // Sending the other key too clears the card.
    await t.withIdentity(ADMIN).mutation(api.tidyCards.markReviewed, { cardId: id, keys: [cut, variation] });
    expect((await t.run(async (ctx) => ctx.db.get(id)))!.tidyReviewed!.keys.sort()).toEqual(
      [cut, variation].sort(),
    );
  });

  test("replaces the previous list, so a changed value drops its old key", async () => {
    const t = convexTest(schema, modules);
    const old = tidyReviewedKeyCut("an older title");
    const id = await t.run(async (ctx) => {
      const s = await seedBase(ctx);
      return s.card("1", {
        ...CUT,
        playerIds: [s.merrill],
        teamOnCardIds: [s.padres],
        tidyReviewed: { at: 1, keys: [old] },
      });
    });
    const cut = tidyReviewedKeyCut(CUT.listingTitle);
    const res = await t.withIdentity(ADMIN).mutation(api.tidyCards.markReviewed, { cardId: id, keys: [old, cut] });
    expect(res.keys).toEqual([cut]);
  });

  test("is refused while anything is pink, and writes nothing", async () => {
    const t = convexTest(schema, modules);
    const id = await t.run(async (ctx) => {
      const s = await seedBase(ctx);
      return s.card("1", { ...CUT, pendingPlayerNames: ["Doc Gooden"], teamOnCardIds: [s.padres] });
    });
    await expect(
      t
        .withIdentity(ADMIN)
        .mutation(api.tidyCards.markReviewed, { cardId: id, keys: [tidyReviewedKeyCut(CUT.listingTitle)] }),
    ).rejects.toThrow(/Fix the pink items first/);
    expect((await t.run(async (ctx) => ctx.db.get(id)))!.tidyReviewed).toBeUndefined();
  });

  test("a new player's career key is accepted for the player who is on the card", async () => {
    const t = convexTest(schema, modules);
    const { id, merrill } = await t.run(async (ctx) => {
      const s = await seedBase(ctx);
      const id = await s.card("1", {
        playerIds: [s.merrill],
        teamOnCardIds: [s.padres],
        tidyChecks: [{ kind: "newPlayerCareer", playerId: s.merrill }],
      });
      return { id, merrill: s.merrill };
    });
    const res = await t
      .withIdentity(ADMIN)
      .mutation(api.tidyCards.markReviewed, { cardId: id, keys: [tidyReviewedKeyCareer(merrill)] });
    expect(res.keys).toEqual([tidyReviewedKeyCareer(merrill)]);
  });

  test("caps the keys and refuses a signed-out caller and a non-admin", async () => {
    const t = convexTest(schema, modules);
    const id = await t.run(async (ctx) => {
      const s = await seedBase(ctx);
      return s.card("1", { playerIds: [s.merrill], teamOnCardIds: [s.padres] });
    });
    const keys = Array.from({ length: 17 }, (_, i) => `k${i}`);
    await expect(
      t.withIdentity(ADMIN).mutation(api.tidyCards.markReviewed, { cardId: id, keys }),
    ).rejects.toThrow(/At most 16/);
    await expect(
      t.withIdentity(ADMIN).mutation(api.tidyCards.markReviewed, { cardId: id, keys: ["x".repeat(65)] }),
    ).rejects.toThrow(/at most 64/);
    await expect(t.mutation(api.tidyCards.markReviewed, { cardId: id, keys: [] })).rejects.toThrow();
    await expect(
      t.withIdentity(MEMBER).mutation(api.tidyCards.markReviewed, { cardId: id, keys: [] }),
    ).rejects.toThrow(/admin access required/i);
  });
});

describe("getCardChecklist — the strict returns carry the four Tidy Up fields (NEO-645)", () => {
  test("a card written with all four round-trips through the validator", async () => {
    const t = convexTest(schema, modules);
    const { base, merrill, padres } = await t.run(async (ctx) => {
      const s = await seedBase(ctx);
      await s.card("1", {
        playerIds: [s.merrill],
        teamOnCardIds: [s.padres],
        sourceDisagreements: [
          {
            field: "players",
            values: [
              { value: ["Jackson Merril"], sources: ["bsc", "sportlots"] },
              { value: ["Jackson Merrill"], sources: ["checklist"] },
            ],
            chosen: { value: ["Jackson Merrill"], by: "nb" },
          },
          {
            field: "teams",
            values: [
              { value: ["Padres"], sources: ["bsc"] },
              { value: ["Mets"], sources: ["checklist"] },
            ],
            chosen: { value: ["Mets"], by: "operator", typed: true },
          },
        ],
        sourceNumbers: { bsc: "OV-ANFI", checklist: "NNO" },
        tidyChecks: [
          { kind: "careerGap", playerId: s.merrill, teamId: s.padres },
          { kind: "newPlayerCareer", playerId: s.merrill },
          { kind: "teamFill", teamIds: [s.padres], reason: "career" },
        ],
        tidyReviewed: { at: NOW, keys: ["cut:abc", "career:xyz"] },
      });
      return { base: s.base, merrill: s.merrill, padres: s.padres };
    });
    const rows = await t
      .withIdentity(ADMIN)
      .query(api.selectorOptions.getCardChecklist, { selectorOptionId: base });
    expect(rows).toHaveLength(1);
    expect(rows[0].sourceDisagreements).toHaveLength(2);
    expect(rows[0].sourceDisagreements![1].chosen).toEqual({
      value: ["Mets"],
      by: "operator",
      typed: true,
    });
    expect(rows[0].sourceNumbers).toEqual({ bsc: "OV-ANFI", checklist: "NNO" });
    expect(rows[0].tidyChecks).toEqual([
      { kind: "careerGap", playerId: merrill, teamId: padres },
      { kind: "newPlayerCareer", playerId: merrill },
      { kind: "teamFill", teamIds: [padres], reason: "career" },
    ]);
    expect(rows[0].tidyReviewed).toEqual({ at: NOW, keys: ["cut:abc", "career:xyz"] });
  });
});
