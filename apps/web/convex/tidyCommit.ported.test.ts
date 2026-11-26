/**
 * NEO-645 / NEO-656 — ported from the batch wizard's commit-level tests
 * (commitCardChecklist.entityReview): two spellings of one name, settled
 * pending names, the prelude's page boundary, unreviewed-name stamps.
 *
 * What changed under them: a player is created when the operator presses
 * "Add as new player" (`tidyNames.createPlayer`) and the answer reaches the
 * other cards that print the name only through Apply to all
 * (`tidyNames.applyNameToAll`); the commit only LINKS (the gate's own links, or
 * an exact single match) and leaves every other name pending on the card. There
 * is no batch to open, reconcile or clean up, and no per-name row.
 */

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { PRELUDE_NAMES_PER_PAGE } from "./selectorOptions";
import { normalizePlayerName } from "./players";
import { cancelScheduled } from "../lib/testing/drain-scheduled";
import { insertTestCard } from "../lib/testing/card-row";
import { normalizeEntityName } from "../lib/entities/normalize-name";
import {
  ADMIN,
  allOf,
  commit,
  makeCard,
  readCards,
  seedLeaf,
  type T,
} from "../lib/testing/tidy-ported";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const live: T[] = [];
function newT(): T {
  const t = convexTest(schema, modules);
  live.push(t);
  return t;
}
afterEach(async () => {
  for (const t of live.splice(0)) await cancelScheduled(t);
});

const ACCENTED = "José Ramírez";
const PLAIN = "Jose Ramirez";

const player = (t: T, sportId: Id<"selectorOptions">, name: string) =>
  t.run((ctx) =>
    ctx.db.insert("players", {
      name,
      nameNormalized: normalizePlayerName(name),
      sportId,
      lastUpdated: Date.now(),
    }),
  );

describe("two spellings of one name end on ONE player row (NEO-296)", () => {
  test("the two spellings share one normalized key — the premise of the fold", () => {
    expect(normalizePlayerName(ACCENTED)).toBe(normalizePlayerName(PLAIN));
    expect(normalizeEntityName(ACCENTED)).toBe(normalizeEntityName(PLAIN));
    expect(ACCENTED).not.toBe(PLAIN);
  });

  async function twoCards(t: T, order: [string, string]) {
    const s = await seedLeaf(t);
    await commit(t, s, [
      makeCard({ cardNumber: "1", cardName: "Card One", players: [order[0]] }),
      makeCard({ cardNumber: "2", cardName: "Card Two", players: [order[1]] }),
    ]);
    return s;
  }

  test.each([
    ["accented first, then plain", [ACCENTED, PLAIN] as [string, string]],
    ["plain first, then accented", [PLAIN, ACCENTED] as [string, string]],
  ])("%s: one created player, and Apply to all points both cards at it", async (_label, order) => {
    const t = newT();
    const s = await twoCards(t, order);
    const cards = await readCards(t, s.variantTypeId);
    expect(cards.every((c) => (c.playerIds ?? []).length === 0)).toBe(true);

    const first = cards.find((c) => c.cardNumber === "1")!;
    const { playerId } = await t
      .withIdentity(ADMIN)
      .mutation(api.tidyNames.createPlayer, { cardId: first._id, name: order[0], sportId: s.sportId });
    // The answer is this card's only; the other spelling waits for Apply to all.
    const mid = await readCards(t, s.variantTypeId);
    expect(mid.find((c) => c.cardNumber === "2")!.pendingPlayerNames).toEqual([order[1]]);
    await t.withIdentity(ADMIN).action(api.tidyNames.applyNameToAll, {
      cardId: first._id,
      kind: "player",
      name: order[0],
      answer: { kind: "linkPlayer", playerId },
    });

    const players = await allOf(t, "players");
    expect(players).toHaveLength(1);
    expect(players[0]._id).toBe(playerId);
    const after = await readCards(t, s.variantTypeId);
    expect(after).toHaveLength(2);
    for (const card of after) {
      expect(card.playerIds).toEqual([playerId]);
      expect(card.pendingPlayerNames ?? []).toEqual([]);
    }
  });

  test("a SECOND commit of the other spelling still links to the created player rather than asking again", async () => {
    const t = newT();
    const s = await twoCards(t, [ACCENTED, ACCENTED]);
    const [one] = await readCards(t, s.variantTypeId);
    const { playerId } = await t
      .withIdentity(ADMIN)
      .mutation(api.tidyNames.createPlayer, { cardId: one._id, name: ACCENTED, sportId: s.sportId });

    const result = await commit(t, s, [makeCard({ cardNumber: "3", cardName: "Card Three", players: [PLAIN] })]);

    expect(result.unreviewedNameCount).toBe(0);
    expect(await allOf(t, "players")).toHaveLength(1);
    const three = (await readCards(t, s.variantTypeId)).find((c) => c.cardNumber === "3")!;
    expect(three.playerIds).toEqual([playerId]);
  });
});

describe("settled pending names retire when the commit settles them (NEO-296)", () => {
  beforeEach(() => {
    // A BSC-ref card committed without a team schedules team enrichment; a
    // throwing stub keeps the network out (the guard would fail the run).
    vi.stubGlobal("fetch", (async (url: string | URL) => {
      throw new Error(`NEO-296: this describe must not reach the network: ${String(url)}`);
    }) as unknown as typeof fetch);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const refCard = (cardNumber: string, players: string[]) => ({
    ...makeCard({ cardNumber, cardName: `Card ${cardNumber}`, players }),
    platformData: { bsc: { ref: `bsc-${cardNumber}` } },
  });

  test("a row that carries a marketplace ref: its differently-spelled pending name retires when an answer settles it", async () => {
    const t = newT();
    const s = await seedLeaf(t);
    const jose = await player(t, s.sportId, ACCENTED);
    await commit(t, s, [refCard("1", [])]);
    const [row] = await readCards(t, s.variantTypeId);
    // The backlog and the incoming payload disagree by an accent.
    await t.run((ctx) => ctx.db.patch(row._id, { pendingPlayerNames: [PLAIN] }));

    // The one exact match settles the name the commit now carries.
    expect(jose).toBeTruthy();
    await commit(t, s, [refCard("1", [ACCENTED])]);

    const after = await t.run((ctx) => ctx.db.get(row._id));
    expect(after!.pendingPlayerNames ?? []).toEqual([]);
    expect(await readCards(t, s.variantTypeId)).toHaveLength(1);
  });

  test("a row with no marketplace ref: its differently-spelled pending name retires as well (finalize owns that half)", async () => {
    const t = newT();
    const s = await seedLeaf(t);
    const jose = await player(t, s.sportId, ACCENTED);
    const handAdded = await t.run((ctx) =>
      insertTestCard(ctx, {
        selectorOptionId: s.variantTypeId,
        cardNumber: "C1",
        cardName: "Hand added",
        platformData: {},
        pendingPlayerNames: [PLAIN],
        sortOrder: 0,
        lastUpdated: Date.now(),
      }),
    );

    expect(jose).toBeTruthy();
    await commit(t, s, [refCard("2", [ACCENTED])]);

    expect((await t.run((ctx) => ctx.db.get(handAdded)))!.pendingPlayerNames ?? []).toEqual([]);
  });
});

describe("the prelude's phases keep the fold across a page boundary (NEO-296)", () => {
  async function world(t: T) {
    const s = await seedLeaf(t);
    const jose = await player(t, s.sportId, ACCENTED);
    return { ...s, jose };
  }

  function page(
    t: T,
    s: { variantTypeId: Id<"selectorOptions">; sportId: Id<"selectorOptions"> },
    names: string[],
    extra: Record<string, unknown>,
  ) {
    return t.withIdentity(ADMIN).mutation(internal.selectorOptions.commitCardChecklistPrelude, {
      selectorOptionId: s.variantTypeId,
      sportId: s.sportId,
      playerNames: names,
      teamNames: [],
      ...extra,
    });
  }

  test("a resolve page links both spellings to the one answered player and never makes a second row", async () => {
    // was: "a resolve page that creates a row for one spelling links the other spelling to it".
    const t = newT();
    const s = await world(t);
    const resolved = await page(t, s, [ACCENTED, PLAIN], { phase: "resolve" });
    expect(await allOf(t, "players")).toHaveLength(1);
    const byName = Object.fromEntries(resolved.playerIdByName.map(({ name, id }) => [name, id]));
    expect(byName[ACCENTED]).toBe(s.jose);
    expect(byName[PLAIN]).toBe(s.jose);
  });

  test("the two spellings land in DIFFERENT resolve pages and still share one row", async () => {
    const t = newT();
    const s = await world(t);
    const names = [ACCENTED, PLAIN];
    const first = await page(t, s, names, { phase: "resolve", resume: { offset: 0 }, namesPerPage: 1 });
    expect(first.hasMore).toBe(true);
    expect(first.resume).toEqual({ offset: 1 });
    const second = await page(t, s, names, { phase: "resolve", resume: first.resume!, namesPerPage: 1 });
    expect(second.hasMore).toBe(false);

    const mapped = [...first.playerIdByName, ...second.playerIdByName];
    expect(mapped.map((e) => e.name).sort()).toEqual([ACCENTED, PLAIN].sort());
    expect(new Set(mapped.map((e) => e.id))).toEqual(new Set([s.jose]));
    expect(await allOf(t, "players")).toHaveLength(1);
  });

  test("the creates phase makes nothing now (a player is made by the walk, not the commit), and the resolve phase writes nothing", async () => {
    // was: "the RESOLVE phase writes nothing - it is the property the order buys".
    const t = newT();
    const s = await seedLeaf(t);
    const before = await allOf(t, "players");
    const created = await page(t, s, [ACCENTED, PLAIN], { phase: "creates" });
    expect(created.createdPlayerIds).toEqual([]);
    await page(t, s, [ACCENTED, PLAIN], { phase: "resolve" });
    expect(await allOf(t, "players")).toHaveLength(before.length);
  });

  test("a checklist wider than one page commits through the ACTION: the folded pair links, every unanswered filler stays pending, no player is made", async () => {
    const t = newT();
    const s = await world(t);
    const filler = Array.from({ length: PRELUDE_NAMES_PER_PAGE + 25 }, (_, i) => `Filler${i}`);
    const cards = [
      ...filler.map((name, i) => makeCard({ cardNumber: String(i + 1), cardName: name, players: [name] })),
      makeCard({ cardNumber: "A", cardName: "Accented", players: [ACCENTED] }),
      makeCard({ cardNumber: "B", cardName: "Plain", players: [PLAIN] }),
    ];

    const result = await commit(t, s, cards);

    expect(result.success).toBe(true);
    expect(result.unreviewedNameCount).toBe(filler.length);
    expect(await allOf(t, "players")).toHaveLength(1);
    const stored = await readCards(t, s.variantTypeId);
    for (const cardNumber of ["A", "B"]) {
      expect(stored.find((c) => c.cardNumber === cardNumber)!.playerIds).toEqual([s.jose]);
    }
    const fillerCard = stored.find((c) => c.cardNumber === "1")!;
    expect(fillerCard.pendingPlayerNames).toEqual(["Filler0"]);
    expect(fillerCard.playerIds ?? []).toEqual([]);
  }, 30_000);
});

describe("unreviewed-name stamps follow the answer (was: a later commit that carries a decision clears the stamp)", () => {
  test("an unanswered name is stamped, then the walk's createPlayer clears the stamp and mints exactly one player", async () => {
    const t = newT();
    const s = await seedLeaf(t);
    const first = await commit(t, s, [makeCard({ cardNumber: "1", players: ["Elly De La Cruz"] })]);
    expect(first.unreviewedNameCount).toBe(1);
    const [card] = await readCards(t, s.variantTypeId);
    expect(card.pendingPlayerNames).toEqual(["Elly De La Cruz"]);

    await t.withIdentity(ADMIN).mutation(api.tidyNames.createPlayer, { cardId: card._id, name: "Elly De La Cruz", sportId: s.sportId });
    const second = await commit(t, s, [makeCard({ cardNumber: "1", players: ["Elly De La Cruz"] })]);

    expect(second.unreviewedNameCount).toBe(0);
    const cards = await readCards(t, s.variantTypeId);
    expect(cards).toHaveLength(1);
    expect(cards[0].pendingPlayerNames).toBeUndefined();
    expect(await allOf(t, "players")).toHaveLength(1);
  });

  test("a fully-answered commit writes neither pending field and reports zero", async () => {
    const t = newT();
    const s = await seedLeaf(t);
    const trout = await player(t, s.sportId, "Mike Trout");

    const result = await commit(t, s, [makeCard({ cardNumber: "1", players: ["Mike Trout"] })]);

    expect(result.unreviewedNameCount).toBe(0);
    const [card] = await readCards(t, s.variantTypeId);
    expect(card.pendingPlayerNames).toBeUndefined();
    expect(card.pendingTeamNames).toBeUndefined();
    expect(card.playerIds).toEqual([trout]);
  });
});

describe("there is no batch to reconcile (was: post-commit batch cleanup, an open batch reconciled)", () => {
  test("the gate with nothing unknown mints no batch id", async () => {
    const t = newT();
    const s = await seedLeaf(t);
    const resolved = await t.withIdentity(ADMIN).action(api.selectorOptions.resolveChecklistEntities, {
      selectorOptionId: s.variantTypeId,
      sportId: s.sportId,
      cards: [],
    });
    expect(resolved.unknownPlayers).toEqual([]);
    expect(resolved.unknownTeams).toEqual([]);
    expect((resolved as { batchId?: string }).batchId).toBeUndefined();
  });
});
