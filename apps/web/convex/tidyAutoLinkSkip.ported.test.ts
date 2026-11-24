/**
 * NEO-645 / NEO-656 — ported from entityReviewQueue.autoLink (an auto-link is
 * applied by the commit, D6), .skipStaging (a skipped name stages nothing) and
 * .switchRowSport (refusals).
 *
 * On the card-only model: an auto-link is a gate link (`gateLinks`) the commit
 * applies, and nothing is stored about its origin or the operator's answer;
 * "Change" is `answerName {clear}` on THIS card (the name waits again); "Not a
 * player" is a `notEntity` answer on this card. The Sport chip is not saved: the
 * walk sends the question's sport with each answer. Neighbouring suites
 * (tidyNames.answerName, tidyNames.applyToAll, tidyCards) hold the unit-level
 * cases; these run through the commit.
 */

import { convexTest } from "convex-test";
import { afterEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { normalizePlayerName } from "./players";
import { cancelScheduled } from "../lib/testing/drain-scheduled";
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

const BO = "Bo Jackson";
const asAdmin = (t: T) => t.withIdentity(ADMIN);

async function world(t: T) {
  const s = await seedLeaf(t);
  const football = await t.run((ctx) =>
    ctx.db.insert("selectorOptions", { level: "sport", value: "Football", platformData: {}, children: [], lastUpdated: Date.now() }),
  );
  const bo = await t.run((ctx) =>
    ctx.db.insert("players", { name: BO, nameNormalized: normalizePlayerName(BO), sportId: football, lastUpdated: Date.now() }),
  );
  return { ...s, football, bo };
}

type World = Awaited<ReturnType<typeof world>>;

/** The commit, handed the gate's auto link the way the client hands it back. */
function commitLinked(
  t: T,
  w: World,
  origin: "setHistory" | "hallOfFame" | "careerTeam",
  cards: ReturnType<typeof makeCard>[],
) {
  return asAdmin(t).action(api.selectorOptions.commitCardChecklist, {
    selectorOptionId: w.variantTypeId,
    sportId: w.sportId,
    cards,
    gateLinks: [{ kind: "player", name: BO, playerId: w.bo, origin }],
  });
}

describe("an auto-link is applied by the commit (was: startBatch's decided rows)", () => {
  test("setHistory: the card links to the player with no operator, even across sports", async () => {
    const t = newT();
    const w = await world(t);
    const result = await commitLinked(t, w, "setHistory", [makeCard({ players: [BO] })]);

    expect(result.unreviewedNameCount).toBe(0);
    const [card] = await readCards(t, w.variantTypeId);
    expect(card.playerIds).toEqual([w.bo]);
    expect(card.playerLinks).toEqual([{ playerId: w.bo, nameOnCard: BO }]);
    expect(card.pendingPlayerNames).toBeUndefined();
    expect(await allOf(t, "players")).toHaveLength(1);
  });

  // S2: only the set's own history may cross sports; the other origins name an
  // in-sport tie-break, so a foreign player is dropped and the name waits.
  test.each(["hallOfFame", "careerTeam"] as const)(
    "%s: a player of ANOTHER sport is refused at the commit and the name waits for the operator",
    async (origin) => {
      const t = newT();
      const w = await world(t);
      const result = await commitLinked(t, w, origin, [makeCard({ players: [BO] })]);

      expect(result.unreviewedNameCount).toBe(1);
      const [card] = await readCards(t, w.variantTypeId);
      expect(card.playerIds ?? []).toEqual([]);
      expect(card.pendingPlayerNames).toEqual([BO]);
    },
  );

  test.each(["hallOfFame", "careerTeam"] as const)(
    "%s: a player of the set's own sport links with no operator",
    async (origin) => {
      const t = newT();
      const w = await world(t);
      const inSport = await t.run((ctx) =>
        ctx.db.insert("players", { name: BO, nameNormalized: normalizePlayerName(BO), sportId: w.sportId, lastUpdated: Date.now() }),
      );
      const result = await asAdmin(t).action(api.selectorOptions.commitCardChecklist, {
        selectorOptionId: w.variantTypeId,
        sportId: w.sportId,
        cards: [makeCard({ players: [BO] })],
        gateLinks: [{ kind: "player", name: BO, playerId: inSport, origin }],
      });
      expect(result.unreviewedNameCount).toBe(0);
      const [card] = await readCards(t, w.variantTypeId);
      expect(card.playerIds).toEqual([inSport]);
    },
  );

  test("without the gate's link the same card keeps the name pending (the football namesake is not in this sport)", async () => {
    const t = newT();
    const w = await world(t);
    await commit(t, w, [makeCard({ players: [BO] })]);
    const [card] = await readCards(t, w.variantTypeId);
    expect(card.playerIds ?? []).toEqual([]);
    expect(card.pendingPlayerNames).toEqual([BO]);
  });
});

describe("Change on an auto-link (D6): answerName clear, on this card", () => {
  async function linked(t: T) {
    const w = await world(t);
    await commitLinked(t, w, "setHistory", [
      makeCard({ cardNumber: "1", players: [BO] }),
      makeCard({ cardNumber: "2", players: [BO] }),
    ]);
    const cards = await readCards(t, w.variantTypeId);
    return { w, cards };
  }
  const ask = (
    t: T,
    w: World,
    cardId: Id<"cardChecklist">,
    answer: Record<string, unknown>,
    extra: { offered?: true } = {},
  ) =>
    asAdmin(t).mutation(api.tidyNames.answerName, {
      cardId,
      kind: "player",
      name: BO,
      sportId: w.football,
      answer: answer as never,
      ...extra,
    });

  // Nothing stores the link's origin, so Change is the same `clear` whichever rule made the link.
  test("this card is unlinked and its name waits again; the other card keeps the link", async () => {
    const t = newT();
    const { w, cards } = await linked(t);
    await ask(t, w, cards[0]._id, { kind: "clear" });

    const after = await readCards(t, w.variantTypeId);
    const first = after.find((c) => c._id === cards[0]._id)!;
    const second = after.find((c) => c._id === cards[1]._id)!;
    expect(first.playerIds ?? []).toEqual([]);
    expect(first.pendingPlayerNames).toEqual([BO]);
    expect(second.playerIds).toEqual([w.bo]);
    expect(second.pendingPlayerNames).toBeUndefined();
  });

  test("Change, then pick the history player again: accepted across sports when the lookup offered it", async () => {
    const t = newT();
    const { w, cards } = await linked(t);
    // The set is baseball; the history player is a footballer.
    await ask(t, w, cards[0]._id, { kind: "clear" });
    await ask(t, w, cards[0]._id, { kind: "linkPlayer", playerId: w.bo }, { offered: true });
    const card = (await readCards(t, w.variantTypeId)).find((c) => c._id === cards[0]._id)!;
    expect(card.playerIds).toEqual([w.bo]);
    expect(card.playerLinks).toEqual([{ playerId: w.bo, nameOnCard: BO }]);
  });

  test("Change, then Add as new anyway: createPlayer mints a second player and the first stays untouched", async () => {
    const t = newT();
    const { w, cards } = await linked(t);
    await ask(t, w, cards[0]._id, { kind: "clear" });
    const { playerId } = await asAdmin(t).mutation(api.tidyNames.createPlayer, {
      cardId: cards[0]._id,
      name: BO,
      sportId: w.sportId,
    });
    expect(playerId).not.toBe(w.bo);
    expect(await allOf(t, "players")).toHaveLength(2);
    const card = (await readCards(t, w.variantTypeId)).find((c) => c._id === cards[0]._id)!;
    expect(card.playerIds).toEqual([playerId]);
  });

  test("an operator's own link is cleared the ordinary way", async () => {
    const t = newT();
    const w = await world(t);
    await commit(t, w, [makeCard({ players: [BO] })]);
    const [card] = await readCards(t, w.variantTypeId);
    await ask(t, w, card._id, { kind: "linkPlayer", playerId: w.bo }, { offered: true });
    await ask(t, w, card._id, { kind: "clear" });
    const [after] = await readCards(t, w.variantTypeId);
    expect(after.playerIds ?? []).toEqual([]);
    expect(after.pendingPlayerNames).toEqual([BO]);
  });
});

describe("a skipped name stages nothing (was: NEO-330 skipStaging, bulk skip)", () => {
  async function skipped(t: T) {
    const w = await world(t);
    await commit(t, w, [makeCard({ cardNumber: "1", players: [BO] }), makeCard({ cardNumber: "2", players: [BO] })]);
    const cards = await readCards(t, w.variantTypeId);
    await asAdmin(t).mutation(api.tidyNames.answerName, {
      cardId: cards[0]._id,
      kind: "player",
      name: BO,
      sportId: w.sportId,
      answer: { kind: "notEntity" },
    });
    return { w, cards };
  }

  test("this card is released and no player, team or stint is made; the other card still waits", async () => {
    const t = newT();
    const { w, cards } = await skipped(t);
    const after = await readCards(t, w.variantTypeId);
    const first = after.find((c) => c._id === cards[0]._id)!;
    const second = after.find((c) => c._id === cards[1]._id)!;
    expect(first.pendingPlayerNames).toBeUndefined();
    expect(first.playerIds ?? []).toEqual([]);
    expect(second.pendingPlayerNames).toEqual([BO]);
    expect(await allOf(t, "players")).toHaveLength(1);
    expect(await allOf(t, "teams")).toHaveLength(0);
  });

  test("Apply to all releases every card still waiting on the name", async () => {
    const t = newT();
    const { w, cards } = await skipped(t);
    const out = await asAdmin(t).action(api.tidyNames.applyNameToAll, {
      cardId: cards[0]._id,
      kind: "player",
      name: BO,
      answer: { kind: "notEntity" },
    });
    expect(out).toEqual({ linked: 1, skipped: 0 });
    for (const c of await readCards(t, w.variantTypeId)) {
      expect(c.pendingPlayerNames).toBeUndefined();
      expect(c.playerIds ?? []).toEqual([]);
    }
  });
});

describe("the question's sport refusals (was: switchRowSport)", () => {
  test("a non-sport id and a non-admin are refused, and nothing is written", async () => {
    const t = newT();
    const w = await world(t);
    await commit(t, w, [makeCard({ players: [BO] })]);
    const [card] = await readCards(t, w.variantTypeId);
    const args = {
      cardId: card._id,
      kind: "player" as const,
      name: BO,
      answer: { kind: "linkPlayer" as const, playerId: w.bo },
    };

    await expect(
      asAdmin(t).mutation(api.tidyNames.answerName, { ...args, sportId: w.variantTypeId }),
    ).rejects.toThrow(/Pick a sport/);
    await expect(
      t
        .withIdentity({ ...ADMIN, role: "member", subject: "u2", tokenIdentifier: "clerk|u2" })
        .mutation(api.tidyNames.answerName, { ...args, sportId: w.football }),
    ).rejects.toThrow();
    const [after] = await readCards(t, w.variantTypeId);
    expect(after.playerIds ?? []).toEqual([]);
    expect(after.pendingPlayerNames).toEqual([BO]);
  });

  test("a footballer is refused for a question asked in baseball, unless the lookup offered him", async () => {
    const t = newT();
    const w = await world(t);
    await commit(t, w, [makeCard({ players: [BO] })]);
    const [card] = await readCards(t, w.variantTypeId);
    const args = {
      cardId: card._id,
      kind: "player" as const,
      name: BO,
      sportId: w.sportId,
      answer: { kind: "linkPlayer" as const, playerId: w.bo },
    };
    await expect(asAdmin(t).mutation(api.tidyNames.answerName, args)).rejects.toThrow(/isn't in this sport/);
    await asAdmin(t).mutation(api.tidyNames.answerName, { ...args, offered: true });
    expect((await readCards(t, w.variantTypeId))[0].playerIds).toEqual([w.bo]);
  });
});
