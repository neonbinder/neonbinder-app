/**
 * NEO-645 (A17) — a fetch never re-applies an earlier answer.
 *
 * Jason: "it should refetch all card data and use whatever player/team data
 * exists now. We do not need to keep track of answers." On main a review row
 * lived for one batch and was deleted at the commit, so the next fetch matched
 * names against the players and teams that exist NOW (main's normal rules) and
 * asked again for anything unlinked. The rows here outlive the commit, so the
 * gate resets them first (`tidyNames.resetForRefetch`).
 *
 * Every test drives the real gate action (`resolveChecklistEntities`), the real
 * commit action and the tile's own mutation (`answerName`).
 */

import { convexTest } from "convex-test";
import { afterEach, describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import { normalizePlayerName } from "./players";
import { cancelScheduled, drainScheduled } from "../lib/testing/drain-scheduled";
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
const newT = (): T => {
  const t = convexTest(schema, modules);
  live.push(t);
  return t;
};
afterEach(async () => {
  for (const t of live.splice(0)) await cancelScheduled(t);
});

const asAdmin = (t: T) => t.withIdentity(ADMIN);
const PRINTED = "Daulton Varsho";
const OTHER = "Dalton Varsho";

type World = Awaited<ReturnType<typeof seedLeaf>>;

const addPlayer = (t: T, w: World, name: string) =>
  t.run((ctx) =>
    ctx.db.insert("players", {
      name,
      nameNormalized: normalizePlayerName(name),
      sportId: w.sportId,
      lastUpdated: Date.now(),
    }),
  );

/** One fetch of the set: the gate (the review step), then the commit. */
async function fetchSet(t: T, w: World, names: string[]) {
  const cards = names.map((name, i) => makeCard({ cardNumber: String(i + 1), players: [name] }));
  const resolved = await asAdmin(t).action(api.selectorOptions.resolveChecklistEntities, {
    selectorOptionId: w.variantTypeId,
    sportId: w.sportId,
    cards: cards as never,
  });
  await commit(t, w, cards);
  return resolved;
}

const rowOf = async (t: T, name: string): Promise<Doc<"tidyNames"> | undefined> =>
  (await allOf(t, "tidyNames")).find((r) => r.nameNormalized === normalizeEntityName(name));

const cardNumbered = async (t: T, w: World, number: string) =>
  (await readCards(t, w.variantTypeId)).find((c) => c.cardNumber === number)!;

/** The operator's walk: answer the name on its card. */
const answerLink = (t: T, cardId: Id<"cardChecklist">, name: string, playerId: Id<"players">) =>
  asAdmin(t).mutation(api.tidyNames.answerName, {
    cardId,
    kind: "player",
    name,
    answer: { kind: "linkPlayer", playerId },
  });

describe("a second fetch of the set never re-applies the first fetch's walk answers", () => {
  test("the operator's link is not carried: set history (main's rule A, a committed card's link) re-links it as an AUTO answer the operator can Change", async () => {
    const t = newT();
    const w = await seedLeaf(t);
    const dalton = await addPlayer(t, w, OTHER);

    const first = await fetchSet(t, w, [PRINTED, "Other Name"]);
    expect(first.unknownPlayers).toContain(PRINTED);
    await answerLink(t, (await cardNumbered(t, w, "1"))._id, PRINTED, dalton);
    await drainScheduled(t);
    expect((await rowOf(t, PRINTED))!.answer).toMatchObject({ kind: "linkPlayer", playerId: dalton, by: "operator" });

    const second = await fetchSet(t, w, [PRINTED, "Other Name"]);
    // Not asked: the card still carries the link, and main's rule A reads it.
    expect(second.unknownPlayers).not.toContain(PRINTED);
    const row = (await rowOf(t, PRINTED))!;
    expect(row.answer).toEqual({ kind: "linkPlayer", playerId: dalton, by: "auto", autoReason: "setHistory" });
    expect(row.answeredByUserId).toBeUndefined();
    expect((await cardNumbered(t, w, "1")).playerIds).toEqual([dalton]);
  });

  test("where set history cannot settle it (two cards linked to two players) the name is asked again and the earlier answer is nowhere", async () => {
    const t = newT();
    const w = await seedLeaf(t);
    const dalton = await addPlayer(t, w, OTHER);
    const other = await addPlayer(t, w, "Daulton Varsho Jr");

    const names = [PRINTED, PRINTED];
    await fetchSet(t, w, names.slice(0, 1));
    await answerLink(t, (await cardNumbered(t, w, "1"))._id, PRINTED, dalton);
    await drainScheduled(t);
    // A second card of the set is later linked to somebody else by hand.
    await fetchSet(t, w, names);
    const card2 = await cardNumbered(t, w, "2");
    await t.run((ctx) =>
      ctx.db.patch(card2._id, {
        playerIds: [other],
        playerLinks: [{ nameOnCard: PRINTED, playerId: other }],
        pendingPlayerNames: undefined,
      }),
    );

    const third = await fetchSet(t, w, names);
    expect(third.unknownPlayers).toContain(PRINTED);
    const row = (await rowOf(t, PRINTED))!;
    expect(row.answer).toBeUndefined();
    expect(row.answeredByUserId).toBeUndefined();
    // A choice between the two players history names, not a lookup.
    expect(row.status).toBe("ready");
    expect(row.enrichment?.existingCandidates?.map((c) => c.playerId).sort()).toEqual([dalton, other].sort());
  });

  test("a new card printing the name, once no card links it and one player now matches exactly, links to THAT player, never to the earlier answer", async () => {
    const t = newT();
    const w = await seedLeaf(t);
    const dalton = await addPlayer(t, w, OTHER);

    await fetchSet(t, w, [PRINTED]);
    const card = await cardNumbered(t, w, "1");
    await answerLink(t, card._id, PRINTED, dalton);
    await drainScheduled(t);
    // The card is unlinked by hand (set history has nothing to say), and the
    // player now exists under the printed spelling.
    await t.run((ctx) => ctx.db.patch(card._id, { playerIds: [], playerLinks: [] }));
    const exact = await addPlayer(t, w, PRINTED);

    // The re-fetch brings a new card printing the same name.
    const second = await fetchSet(t, w, [PRINTED, PRINTED]);
    expect(second.unknownPlayers).toEqual([]);
    expect((await cardNumbered(t, w, "2")).playerIds).toEqual([exact]);
    expect((await rowOf(t, PRINTED))?.answer?.by).not.toBe("operator");
  });

  test("an operator's 'not a player' ruling stays: main kept skips (NEO-212), so the name is not asked again", async () => {
    const t = newT();
    const w = await seedLeaf(t);

    await fetchSet(t, w, ["CHECKLIST"]);
    await asAdmin(t).mutation(api.tidyNames.answerName, {
      cardId: (await cardNumbered(t, w, "1"))._id,
      kind: "player",
      name: "CHECKLIST",
      answer: { kind: "notEntity" },
    });
    await drainScheduled(t);

    const second = await fetchSet(t, w, ["CHECKLIST"]);
    expect(second.unknownPlayers).toEqual([]);
    expect((await rowOf(t, "CHECKLIST"))!.answer).toEqual({ kind: "notEntity", by: "operator" });
  });

  test("an earlier fetch's team link is not carried either: rule F re-links it as an auto answer", async () => {
    const t = newT();
    const w = await seedLeaf(t);
    const padres = await t.run((ctx) =>
      ctx.db.insert("teams", {
        name: "Padres",
        location: "San Diego",
        nameNormalized: normalizeEntityName("San Diego Padres"),
        sportId: w.sportId,
        lastUpdated: Date.now(),
      } as never),
    );
    const teamCards = [makeCard({ cardNumber: "1", players: ["Some Player"], teams: ["Pads"] })];
    const gate = () =>
      asAdmin(t).action(api.selectorOptions.resolveChecklistEntities, {
        selectorOptionId: w.variantTypeId,
        sportId: w.sportId,
        cards: teamCards as never,
      });
    expect((await gate()).unknownTeams).toEqual(["Pads"]);
    await commit(t, w, teamCards);
    await asAdmin(t).mutation(api.tidyNames.answerName, {
      cardId: (await cardNumbered(t, w, "1"))._id,
      kind: "team",
      name: "Pads",
      answer: { kind: "linkTeam", teamId: padres },
    });
    await drainScheduled(t);
    expect((await rowOf(t, "Pads"))!.answer).toMatchObject({ kind: "linkTeam", by: "operator" });

    await gate();
    await commit(t, w, teamCards);
    const row = (await rowOf(t, "Pads"))!;
    expect(row.answer?.by).not.toBe("operator");
    expect(row.answeredByUserId).toBeUndefined();
  });
});

describe("a fetch forgets the Wikidata output of the last one (working state, never kept)", () => {
  test("the stored lookup, its generation and its status are gone, and the name is looked up afresh after the commit", async () => {
    const t = newT();
    const w = await seedLeaf(t);
    await fetchSet(t, w, [PRINTED]);
    const first = (await rowOf(t, PRINTED))!;
    // The first walk's lookup landed: a Wikidata match with a career.
    await t.run((ctx) =>
      ctx.db.patch(first._id, {
        status: "ready",
        lookupGen: 1,
        enrichment: { wikidataId: "Q123", description: "outfielder", birthYear: 1996 },
      }),
    );

    await fetchSet(t, w, [PRINTED]);
    const row = (await rowOf(t, PRINTED))!;
    expect(row.enrichment).toBeUndefined();
    expect(row.status).toBe("pending");
    // The reset bumped generation 1 to 2 and left the row unstamped: not asked yet.
    expect(row.lookupGen).toBe(2);
    expect(row.lookupRequestedAt).toBeUndefined();
    // The commit queued it: one lookup, under a newer generation than any before.
    const queued = await t.mutation(internal.tidyNames.enqueuePendingLookups, {
      scopeId: w.variantTypeId,
    });
    expect(queued).toBe(1);
    const asked = (await rowOf(t, PRINTED))!;
    expect(asked.lookupGen).toBe(3);
    expect(asked.lookupRequestedAt).toBeDefined();
    // A second walk queues none.
    expect(await t.mutation(internal.tidyNames.enqueuePendingLookups, { scopeId: w.variantTypeId })).toBe(0);
  });

  test("a Wikidata job still queued from before the reset is ignored, even after the row is asked again (no generation reuse)", async () => {
    const t = newT();
    const w = await seedLeaf(t);
    await fetchSet(t, w, [PRINTED]);
    const first = (await rowOf(t, PRINTED))!;
    // The first fetch's job (generation 1) is still queued in the pool.
    await t.run((ctx) => ctx.db.patch(first._id, { status: "pending", lookupGen: 1 }));

    await fetchSet(t, w, [PRINTED]);
    expect(await t.mutation(internal.tidyNames.enqueuePendingLookups, { scopeId: w.variantTypeId })).toBe(1);
    const asked = (await rowOf(t, PRINTED))!;
    // Asked again under a generation no earlier job carries (the old one cleared would have been 1 again).
    expect(asked.lookupGen).toBeGreaterThan(1);

    for (const gen of [1, 2]) {
      await t.mutation(internal.tidyNames.applyLookupResult, {
        id: first._id,
        gen,
        status: "ready",
        enrichment: { wikidataId: "Q_STALE", description: "from the old question" },
        sportId: asked.sportId,
      });
    }
    const still = (await rowOf(t, PRINTED))!;
    expect(still.status).toBe("pending");
    expect(still.enrichment).toBeUndefined();

    // The current generation's result lands.
    await t.mutation(internal.tidyNames.applyLookupResult, {
      id: first._id,
      gen: asked.lookupGen!,
      status: "ready",
      enrichment: { wikidataId: "Q_NOW", description: "fresh" },
      sportId: asked.sportId,
    });
    expect((await rowOf(t, PRINTED))!.enrichment).toMatchObject({ wikidataId: "Q_NOW" });
  });

  test("a finished miss from the first fetch (ready, nothing found) is asked again, not trusted", async () => {
    const t = newT();
    const w = await seedLeaf(t);
    await fetchSet(t, w, [PRINTED]);
    const first = (await rowOf(t, PRINTED))!;
    await t.run((ctx) => ctx.db.patch(first._id, { status: "error", lookupGen: 2 }));
    await fetchSet(t, w, [PRINTED]);
    const row = (await rowOf(t, PRINTED))!;
    expect(row.status).toBe("pending");
    expect(row.lookupGen).toBe(3);
  });

  test("a name the fetch no longer needs to ask about is left blank and is NOT looked up", async () => {
    const t = newT();
    const w = await seedLeaf(t);
    await fetchSet(t, w, [PRINTED]);
    const first = (await rowOf(t, PRINTED))!;
    await t.run((ctx) =>
      ctx.db.patch(first._id, { status: "ready", lookupGen: 1, enrichment: { wikidataId: "Q9" } }),
    );
    await addPlayer(t, w, PRINTED); // now an exact single match: the gate raises nothing
    await fetchSet(t, w, [PRINTED]);
    const row = (await rowOf(t, PRINTED))!;
    expect(row.enrichment).toBeUndefined();
    expect(row.status).toBe("ready");
    expect(await t.mutation(internal.tidyNames.enqueuePendingLookups, { scopeId: w.variantTypeId })).toBe(0);
  });
});

describe("resetForRefetch (the step itself)", () => {
  const seedRows = async (t: T, w: World, count: number) =>
    t.run(async (ctx) => {
      for (let i = 0; i < count; i++) {
        const name = `Name ${i}`;
        await ctx.db.insert("tidyNames", {
          scopeId: w.variantTypeId,
          kind: "player",
          nameNormalized: normalizeEntityName(name),
          name,
          sportId: w.sportId,
          status: "ready",
          lookupGen: 1,
          answer: { kind: "linkPlayer", playerId: (await ctx.db.query("players").first())!._id, by: "operator" },
          answerGen: 1,
          fanOutFrom: [null],
          enrichment: { wikidataId: "Q1" },
        });
      }
    });

  test("walks every page, stops a running fan-out (the generation moves on), and a second pass changes nothing", async () => {
    const t = newT();
    const w = await seedLeaf(t);
    await addPlayer(t, w, "Anchor Player");
    await seedRows(t, w, 7);
    // Tiny pages are not configurable; drive the cursor the way the gate does.
    let cursor: string | undefined;
    let total = 0;
    for (;;) {
      const done: { cursor: string | null; reset: number } = await t.mutation(internal.tidyNames.resetForRefetch, {
        scopeId: w.variantTypeId,
        sportId: w.sportId,
        ...(cursor ? { cursor } : {}),
      });
      total += done.reset;
      if (done.cursor === null) break;
      cursor = done.cursor;
    }
    expect(total).toBe(7);
    for (const row of await allOf(t, "tidyNames")) {
      expect(row.answer).toBeUndefined();
      expect(row.enrichment).toBeUndefined();
      expect(row.fanOutFrom).toBeUndefined();
      expect(row.lookupGen).toBe(2);
      expect(row.lookupRequestedAt).toBeUndefined();
      expect(row.status).toBe("ready");
      expect(row.answerGen).toBe(2);
    }
    const again = await t.mutation(internal.tidyNames.resetForRefetch, {
      scopeId: w.variantTypeId,
      sportId: w.sportId,
    });
    expect(again).toEqual({ cursor: null, reset: 0 });
  });

  test("only the scope's own rows are reset, and an operator's notEntity ruling is left whole", async () => {
    const t = newT();
    const w = await seedLeaf(t, { extraLeaf: "Insert" });
    await addPlayer(t, w, "Anchor Player");
    await seedRows(t, w, 1);
    await t.run(async (ctx) => {
      await ctx.db.insert("tidyNames", {
        scopeId: w.variantTypeId,
        kind: "player",
        nameNormalized: "junk",
        name: "JUNK",
        sportId: w.sportId,
        status: "ready",
        answer: { kind: "notEntity", by: "operator" },
        answerGen: 1,
      });
      await ctx.db.insert("tidyNames", {
        scopeId: w.otherLeafId!,
        kind: "player",
        nameNormalized: "elsewhere",
        name: "Elsewhere",
        sportId: w.sportId,
        status: "ready",
        enrichment: { wikidataId: "Q2" },
        answer: { kind: "notEntity", by: "auto" },
      });
    });
    await t.mutation(internal.tidyNames.resetForRefetch, { scopeId: w.variantTypeId, sportId: w.sportId });
    const rows = await allOf(t, "tidyNames");
    expect(rows.find((r) => r.name === "JUNK")!.answer).toEqual({ kind: "notEntity", by: "operator" });
    expect(rows.find((r) => r.name === "Name 0")!.answer).toBeUndefined();
    // Another leaf's row is another scope: untouched.
    expect(rows.find((r) => r.name === "Elsewhere")!.enrichment).toEqual({ wikidataId: "Q2" });
  });
});
