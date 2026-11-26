/**
 * NEO-645 / NEO-656 — the real reads and writes of `tidyCards.ts`
 * (`cardContext`, `saveCard`), the strict `getCardChecklist` returns, and the
 * gate on every function of the Tidy Up surface.
 *
 * The card is the only record of its names (NEO-656): `cardContext` reads them
 * off the card itself, and `saveCard` stores nothing about the card having been
 * seen.
 */

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { insertTestCard } from "../lib/testing/card-row";
import { normalizeEntityName } from "../lib/entities/normalize-name";
import { SAVE_CARD_MAX_GAPS } from "./tidyCards";

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
  return { sport, base, padres, mets, merrill, card, player };
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

  test("a linked player comes back with his stints and the name the card printed", async () => {
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
    const view = await t.withIdentity(ADMIN).query(api.tidyCards.cardContext, { cardId: id });
    expect(view).not.toBeNull();
    expect(view!.names).toEqual([
      {
        kind: "player",
        nameNormalized: normalizeEntityName("Jackson Merrill"),
        printed: "Jackson Merrill",
        order: 0,
        pending: false,
        playerId: merrill,
      },
    ]);
    expect(view!.players).toEqual([
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
    expect(view!.playersMore).toBe(false);
    expect(view!.cameos).toEqual([]);
    expect(view!.teams).toEqual([
      { teamId: padres, name: "San Diego Padres", onCard: true, candidate: false },
    ]);
  });

  test("a card with pending names and no other rows still lists its names, so the Player tile has something to ask (the reported bug)", async () => {
    const t = convexTest(schema, modules);
    const id = await t.run(async (ctx) => {
      const s = await seedBase(ctx);
      // No linked player, no team, no printed-name rows: only what the card itself waits on.
      return s.card("1", {
        pendingPlayerNames: ["Doc Gooden", "Darryl Strawberry"],
        pendingTeamNames: ["Mets"],
      });
    });
    const view = await t.withIdentity(ADMIN).query(api.tidyCards.cardContext, { cardId: id });
    expect(view!.names).toEqual([
      {
        kind: "player",
        nameNormalized: normalizeEntityName("Doc Gooden"),
        printed: "Doc Gooden",
        order: 0,
        pending: true,
      },
      {
        kind: "player",
        nameNormalized: normalizeEntityName("Darryl Strawberry"),
        printed: "Darryl Strawberry",
        order: 1,
        pending: true,
      },
      {
        kind: "team",
        nameNormalized: normalizeEntityName("Mets"),
        printed: "Mets",
        order: 0,
        pending: true,
      },
    ]);
    expect(view!.players).toEqual([]);
  });

  test("linked players come first in link order, waiting ones after them", async () => {
    const t = convexTest(schema, modules);
    const { id, merrill } = await t.run(async (ctx) => {
      const s = await seedBase(ctx);
      const id = await s.card("1", {
        playerIds: [s.merrill],
        playerLinks: [{ playerId: s.merrill, nameOnCard: "Jackson Merril" }],
        pendingPlayerNames: ["Doc Gooden"],
      });
      return { id, merrill: s.merrill };
    });
    const view = await t.withIdentity(ADMIN).query(api.tidyCards.cardContext, { cardId: id });
    expect(view!.names.map((n) => [n.printed, n.order, n.pending, n.playerId])).toEqual([
      ["Jackson Merril", 0, false, merrill],
      ["Doc Gooden", 1, true, undefined],
    ]);
    // The card's own spelling rides on the player when it differs from his name.
    expect(view!.players[0].nameOnCard).toBe("Jackson Merril");
  });

  test("an answer on the card shows at once: a name leaves the waiting list and joins the links", async () => {
    const t = convexTest(schema, modules);
    const { id, merrill, sport } = await t.run(async (ctx) => {
      const s = await seedBase(ctx);
      const id = await s.card("1", { pendingPlayerNames: ["Jackson Merrill"] });
      return { id, merrill: s.merrill, sport: s.sport };
    });
    await t.withIdentity(ADMIN).mutation(api.tidyNames.answerName, {
      cardId: id,
      kind: "player",
      name: "Jackson Merrill",
      sportId: sport,
      answer: { kind: "linkPlayer", playerId: merrill },
    });
    const view = await t.withIdentity(ADMIN).query(api.tidyCards.cardContext, { cardId: id });
    expect(view!.names).toMatchObject([{ printed: "Jackson Merrill", pending: false, playerId: merrill }]);
    expect(view!.players.map((p) => p.playerId)).toEqual([merrill]);
  });

  test("the card's cameos come back by name, in the card's order", async () => {
    const t = convexTest(schema, modules);
    const { id, lindor, soto } = await t.run(async (ctx) => {
      const s = await seedBase(ctx);
      const lindor = await s.player("Francisco Lindor");
      const soto = await s.player("Juan Soto");
      const id = await s.card("52", {
        playerIds: [s.merrill],
        secondaryPlayerIds: [lindor, soto],
      });
      return { id, lindor, soto };
    });
    const view = await t.withIdentity(ADMIN).query(api.tidyCards.cardContext, { cardId: id });
    expect(view!.cameos).toEqual([
      { playerId: lindor, name: "Francisco Lindor" },
      { playerId: soto, name: "Juan Soto" },
    ]);
  });

  test("the walk's candidate teams are named beside the card's own team, each flagged", async () => {
    const t = convexTest(schema, modules);
    const { id, padres, mets } = await t.run(async (ctx) => {
      const s = await seedBase(ctx);
      const c = await s.card("1", { teamOnCardIds: [s.padres], pendingTeamNames: ["NY"] });
      return { id: c, padres: s.padres, mets: s.mets };
    });
    const view = await t
      .withIdentity(ADMIN)
      .query(api.tidyCards.cardContext, { cardId: id, candidateTeamIds: [mets, padres] });
    expect(view!.teams.map((x) => [x.teamId, x.onCard, x.candidate]).sort()).toEqual(
      [
        [padres, true, true],
        [mets, false, true],
      ].sort(),
    );
    // Without candidates only the card's own team is named.
    const plain = await t.withIdentity(ADMIN).query(api.tidyCards.cardContext, { cardId: id });
    expect(plain!.teams.map((x) => [x.teamId, x.onCard, x.candidate])).toEqual([[padres, true, false]]);
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

describe("tidyCards.saveCard", () => {
  // Merrill has only a Padres stint; a Mets card in a 2024 set is a gap (a stint
  // counts once it has begun, so his old Mets years would cover it).
  async function gapCard(t: T, extra: Record<string, unknown> = {}) {
    return t.run(async (ctx) => {
      const s = await seedBase(ctx);
      await ctx.db.patch(s.merrill, { teamYears: [{ teamId: s.padres, fromYear: 2024 }] });
      const id = await s.card("1", { playerIds: [s.merrill], teamOnCardIds: [s.mets], ...extra });
      return { id, merrill: s.merrill, mets: s.mets, padres: s.padres };
    });
  }
  const playedFor2024 = async (t: T, playerId: Id<"players">, teamId: Id<"teams">) => {
    const p = await t.run((ctx) => ctx.db.get(playerId));
    return (p?.teamYears ?? []).some(
      (y: { teamId: Id<"teams">; fromYear?: number; toYear?: number }) =>
        y.teamId === teamId && (y.fromYear ?? 0) <= 2024 && (y.toYear ?? 9999) >= 2024,
    );
  };
  const save = (t: T, cardId: Id<"cardChecklist">, gaps: Array<{ playerId: Id<"players">; teamId: Id<"teams"> }>) =>
    t.withIdentity(ADMIN).mutation(api.tidyCards.saveCard, { cardId, gaps });

  test("a gap the operator was shown takes the default stint from the set's year, and the career covers it after", async () => {
    const t = convexTest(schema, modules);
    const { id, merrill, mets } = await gapCard(t);
    expect(await playedFor2024(t, merrill, mets)).toBe(false);
    await save(t, id, [{ playerId: merrill, teamId: mets }]);
    expect(await playedFor2024(t, merrill, mets)).toBe(true);
  });

  test("stores nothing on the card: no seen marker, no lastUpdated, no title", async () => {
    const t = convexTest(schema, modules);
    const { id, merrill, mets } = await gapCard(t);
    const before = (await t.run((ctx) => ctx.db.get(id)))!;
    await save(t, id, [{ playerId: merrill, teamId: mets }]);
    expect(await t.run((ctx) => ctx.db.get(id))).toEqual(before);
  });

  test("a gap the client never named is not written", async () => {
    const t = convexTest(schema, modules);
    const { id, merrill, mets } = await gapCard(t);
    await save(t, id, []);
    expect(await playedFor2024(t, merrill, mets)).toBe(false);
  });

  test("a gap the client named that is not on this card (a stale tab) is not written", async () => {
    const t = convexTest(schema, modules);
    const { id, merrill, mets, padres } = await gapCard(t);
    // Padres is not on the card, and the Mets gap was never named.
    await save(t, id, [{ playerId: merrill, teamId: padres }]);
    expect(await playedFor2024(t, merrill, mets)).toBe(false);
    const after = (await t.run((ctx) => ctx.db.get(merrill)))!.teamYears;
    expect(after).toEqual([{ teamId: padres, fromYear: 2024 }]);
  });

  test("a gap already covered since the client looked is not written again", async () => {
    const t = convexTest(schema, modules);
    const { id, merrill, mets } = await gapCard(t);
    await t.run((ctx) =>
      ctx.db.patch(merrill, {
        teamYears: [
          { teamId: mets, fromYear: 2020 },
        ],
      }),
    );
    await save(t, id, [{ playerId: merrill, teamId: mets }]);
    expect((await t.run((ctx) => ctx.db.get(merrill)))!.teamYears).toEqual([
      { teamId: mets, fromYear: 2020 },
    ]);
  });

  test("a set year the career will not hold leaves the gap in place and writes no stint", async () => {
    const t = convexTest(schema, modules);
    const { id, merrill, mets } = await gapCard(t);
    await t.run(async (ctx) => {
      const year = (await ctx.db.query("selectorOptions").collect()).find((o) => o.level === "year")!;
      await ctx.db.patch(year._id, { value: "1500" });
    });
    const before = (await t.run((ctx) => ctx.db.get(merrill)))!.teamYears;
    await expect(save(t, id, [{ playerId: merrill, teamId: mets }])).resolves.toBeNull();
    expect((await t.run((ctx) => ctx.db.get(merrill)))!.teamYears).toEqual(before);
  });

  test("a card with two players has no gap to write", async () => {
    const t = convexTest(schema, modules);
    const { id, merrill, mets } = await t.run(async (ctx) => {
      const s = await seedBase(ctx);
      const other = await s.player("Fernando Tatis");
      const id = await s.card("1", { playerIds: [s.merrill, other], teamOnCardIds: [s.mets] });
      return { id, merrill: s.merrill, mets: s.mets };
    });
    await save(t, id, [{ playerId: merrill, teamId: mets }]);
    expect(await playedFor2024(t, merrill, mets)).toBe(false);
  });

  test("is refused while anything is pink, and writes nothing", async () => {
    const t = convexTest(schema, modules);
    const { id, merrill, mets } = await gapCard(t, { pendingPlayerNames: ["Doc Gooden"] });
    await expect(save(t, id, [{ playerId: merrill, teamId: mets }])).rejects.toThrow(
      /Fix the pink items first/,
    );
    expect(await playedFor2024(t, merrill, mets)).toBe(false);
  });

  test("caps the gaps, and refuses a signed-out caller and a non-admin", async () => {
    const t = convexTest(schema, modules);
    const { id, merrill, mets } = await gapCard(t);
    const gaps = Array.from({ length: SAVE_CARD_MAX_GAPS + 1 }, () => ({ playerId: merrill, teamId: mets }));
    await expect(save(t, id, gaps)).rejects.toThrow(/At most/);
    await expect(t.mutation(api.tidyCards.saveCard, { cardId: id, gaps: [] })).rejects.toThrow();
    await expect(
      t.withIdentity(MEMBER).mutation(api.tidyCards.saveCard, { cardId: id, gaps: [] }),
    ).rejects.toThrow(/admin access required/i);
  });
});

describe("getCardChecklist — the strict returns after NEO-656", () => {
  test("a card carrying sourceDisagreements and sourceNumbers round-trips through the validator", async () => {
    const t = convexTest(schema, modules);
    const base = await t.run(async (ctx) => {
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
          },
        ],
        sourceNumbers: { bsc: "OV-ANFI", checklist: "NNO" },
      });
      return s.base;
    });
    const rows = await t
      .withIdentity(ADMIN)
      .query(api.selectorOptions.getCardChecklist, { selectorOptionId: base });
    expect(rows).toHaveLength(1);
    expect(rows[0].sourceDisagreements).toHaveLength(1);
    expect(rows[0].sourceNumbers).toEqual({ bsc: "OV-ANFI", checklist: "NNO" });
  });
});
