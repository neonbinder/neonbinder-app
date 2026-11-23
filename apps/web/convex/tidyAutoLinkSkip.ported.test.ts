/**
 * NEO-645 — ported from entityReviewQueue.autoLink (clearDecision on an
 * auto-link, D6), .skipStaging (a skipped name stages nothing), .context
 * (the display context) and .switchRowSport (refusals).
 *
 * On the walk's storage: an auto-link is an answer with `by: "auto"` that the
 * commit applies; "Change" is `answerName {clear}` and keeps the old pick as
 * the preselect; "Skip" is a `notEntity` answer; the Sport chip is
 * `setNameSport`. Neighbouring suites (tidyNames.lookup, tidyNames.answerName,
 * tidyCards) hold the unit-level cases; these run through the commit.
 */

import { convexTest } from "convex-test";
import { afterEach, describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
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
  seedUnansweredName,
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

/** The gate's auto answer, written the way upsertFromGatePage leaves it. */
function autoLinkRow(t: T, w: Awaited<ReturnType<typeof world>>, origin: "setHistory" | "hallOfFame" | "careerTeam") {
  return t.mutation(internal.tidyNames.upsertFromGatePage, {
    scopeId: w.variantTypeId,
    items: [{ kind: "player", name: BO, sportId: w.football, auto: { playerId: w.bo, origin } }] as never,
  });
}

describe("an auto-link is applied by the commit and explained by cardContext (was: startBatch's decided rows)", () => {
  test.each(["setHistory", "hallOfFame", "careerTeam"] as const)(
    "%s: the card links to the player with no operator, and 'Linked for you' carries the origin",
    async (origin) => {
      const t = newT();
      const w = await world(t);
      await autoLinkRow(t, w, origin);
      const result = await commit(t, w, [makeCard({ players: [BO] })]);

      expect(result.unreviewedNameCount).toBe(0);
      const [card] = await readCards(t, w.variantTypeId);
      expect(card.playerIds).toEqual([w.bo]);
      expect(card.pendingPlayerNames).toBeUndefined();
      expect(await allOf(t, "players")).toHaveLength(1);

      const ctxView = await asAdmin(t).query(api.tidyCards.cardContext, { cardId: card._id });
      expect(ctxView!.linkedFor).toEqual([{ kind: "player", playerId: w.bo, reason: origin }]);
    },
  );
});

describe("Change on an auto-link (D6): answerName clear", () => {
  async function linked(t: T, origin: "setHistory" | "hallOfFame" | "careerTeam" = "setHistory") {
    const w = await world(t);
    await autoLinkRow(t, w, origin);
    await commit(t, w, [makeCard({ cardNumber: "1", players: [BO] }), makeCard({ cardNumber: "2", players: [BO] })]);
    const cards = await readCards(t, w.variantTypeId);
    return { w, cards };
  }
  const clear = (t: T, cardId: Id<"cardChecklist">) =>
    asAdmin(t).mutation(api.tidyNames.answerName, { cardId, kind: "player", name: BO, answer: { kind: "clear" } });

  test.each(["setHistory", "hallOfFame", "careerTeam"] as const)(
    "%s: the card is unlinked and the old pick comes back as the preselect with that reason, and no lookup is enqueued",
    async (origin) => {
      const t = newT();
      const { w, cards } = await linked(t, origin);
      await clear(t, cards[0]._id);
      await drainScheduled(t);

      const [row] = await allOf(t, "tidyNames");
      expect(row.answer).toBeUndefined();
      expect(row.enrichment?.preselect).toMatchObject({ playerId: w.bo, reason: origin, sportId: w.football, sportValue: "Football" });
      expect(row.status).toBe("ready");
      for (const c of await readCards(t, w.variantTypeId)) {
        expect(c.playerIds ?? []).toEqual([]);
        expect(c.pendingPlayerNames).toEqual([BO]);
      }
    },
  );

  test("Change, then pick the history player again: an OPERATOR answer, accepted across sports (the preselect is an offer)", async () => {
    const t = newT();
    const { w, cards } = await linked(t);
    // The set is baseball; the history player is a footballer.
    await clear(t, cards[0]._id);
    await asAdmin(t).mutation(api.tidyNames.answerName, {
      cardId: cards[0]._id,
      kind: "player",
      name: BO,
      answer: { kind: "linkPlayer", playerId: w.bo },
    });
    const [row] = await allOf(t, "tidyNames");
    expect(row.answer).toEqual({ kind: "linkPlayer", playerId: w.bo, by: "operator" });
    expect(row.sportId).toBe(w.football);
  });

  test("Change, then Add as new anyway: createPlayer mints a second player and the first stays untouched", async () => {
    const t = newT();
    const { w, cards } = await linked(t);
    await clear(t, cards[0]._id);
    const { playerId } = await asAdmin(t).mutation(api.tidyNames.createPlayer, { cardId: cards[0]._id, name: BO });
    await drainScheduled(t);
    expect(playerId).not.toBe(w.bo);
    expect(await allOf(t, "players")).toHaveLength(2);
  });

  test("a gate re-fetch after the operator's own answer never re-asserts the auto link", async () => {
    const t = newT();
    const { w, cards } = await linked(t);
    await clear(t, cards[0]._id);
    await asAdmin(t).mutation(api.tidyNames.answerName, { cardId: cards[0]._id, kind: "player", name: BO, answer: { kind: "notEntity" } });
    await autoLinkRow(t, w, "setHistory");
    expect((await allOf(t, "tidyNames"))[0].answer).toEqual({ kind: "notEntity", by: "operator" });
  });

  test("an operator's own link is cleared the ordinary way: no preselect is invented", async () => {
    const t = newT();
    const w = await world(t);
    await seedUnansweredName(t, { scopeId: w.variantTypeId, sportId: w.football, kind: "player", name: BO });
    await commit(t, w, [makeCard({ players: [BO] })]);
    const [card] = await readCards(t, w.variantTypeId);
    await asAdmin(t).mutation(api.tidyNames.answerName, { cardId: card._id, kind: "player", name: BO, answer: { kind: "linkPlayer", playerId: w.bo } });
    await clear(t, card._id);
    const [row] = await allOf(t, "tidyNames");
    expect(row.answer).toBeUndefined();
    expect(row.enrichment?.preselect).toBeUndefined();
    expect(row.sportId).toBe(w.football);
  });
});

describe("a skipped name stages nothing (was: NEO-330 skipStaging, bulk skip)", () => {
  async function skipped(t: T) {
    const w = await world(t);
    await seedUnansweredName(t, { scopeId: w.variantTypeId, sportId: w.football, kind: "player", name: BO });
    await commit(t, w, [makeCard({ cardNumber: "1", players: [BO] }), makeCard({ cardNumber: "2", players: [BO] })]);
    const cards = await readCards(t, w.variantTypeId);
    await asAdmin(t).mutation(api.tidyNames.answerName, { cardId: cards[0]._id, kind: "player", name: BO, answer: { kind: "notEntity" } });
    await drainScheduled(t);
    return { w, cards };
  }

  test("every card that printed the name is released, and no player, team or stint is made", async () => {
    const t = newT();
    const { w } = await skipped(t);
    for (const c of await readCards(t, w.variantTypeId)) {
      expect(c.pendingPlayerNames).toBeUndefined();
      expect(c.playerIds ?? []).toEqual([]);
    }
    expect(await allOf(t, "players")).toHaveLength(1);
    expect(await allOf(t, "teams")).toHaveLength(0);
  });

  test("a lookup landing after the skip is dropped: the row keeps its answer and stores no career", async () => {
    const t = newT();
    const { w } = await skipped(t);
    const [row] = await allOf(t, "tidyNames");
    const before = row.lookupGen ?? 0;
    await t.mutation(internal.tidyNames.applyLookupResult, {
      id: row._id,
      gen: before,
      status: "ready",
      sportId: row.sportId,
      enrichment: { wikidataId: "Q1", careerTeams: [{ name: "Los Angeles Raiders", fromYear: 1987 }] },
    } as never);
    const [after] = await allOf(t, "tidyNames");
    expect(after.answer).toEqual({ kind: "notEntity", by: "operator" });
    expect(after.enrichment?.careerTeams).toBeUndefined();
    expect(await allOf(t, "teams")).toHaveLength(0);
    void w;
  });

  test("Add as new player on a skipped name is refused until the skip is changed, and then works", async () => {
    const t = newT();
    const { cards } = await skipped(t);
    await expect(
      asAdmin(t).mutation(api.tidyNames.createPlayer, { cardId: cards[0]._id, name: BO }),
    ).rejects.toThrow();
    await asAdmin(t).mutation(api.tidyNames.answerName, { cardId: cards[0]._id, kind: "player", name: BO, answer: { kind: "clear" } });
    const made = await asAdmin(t).mutation(api.tidyNames.createPlayer, { cardId: cards[0]._id, name: BO });
    expect(made.playerId).toBeTruthy();
  });

  test("a pick-step row (ready, offered candidates, unanswered) is skippable like any row", async () => {
    const t = newT();
    const w = await world(t);
    await seedUnansweredName(t, {
      scopeId: w.variantTypeId,
      sportId: w.football,
      kind: "player",
      name: BO,
      enrichment: { existingCandidates: [{ playerId: w.bo, name: BO, careerSummary: "", sportValue: "Football" }] },
    });
    await commit(t, w, [makeCard({ players: [BO] })]);
    const [card] = await readCards(t, w.variantTypeId);
    await asAdmin(t).mutation(api.tidyNames.answerName, { cardId: card._id, kind: "player", name: BO, answer: { kind: "notEntity" } });
    expect((await allOf(t, "tidyNames"))[0].answer?.kind).toBe("notEntity");
  });
});

describe("the Sport chip refusals (was: switchRowSport)", () => {
  test("an answered row is refused, a non-sport id is refused, and a signed-in non-admin is refused; nothing is written", async () => {
    const t = newT();
    const w = await world(t);
    await seedUnansweredName(t, { scopeId: w.variantTypeId, sportId: w.sportId, kind: "player", name: BO });
    await commit(t, w, [makeCard({ players: [BO] })]);
    const [card] = await readCards(t, w.variantTypeId);
    const args = { cardId: card._id, kind: "player" as const, name: BO };

    await expect(asAdmin(t).mutation(api.tidyNames.setNameSport, { ...args, sportId: w.variantTypeId })).rejects.toThrow(/Pick a sport/);
    await expect(
      t.withIdentity({ ...ADMIN, role: "member", subject: "u2", tokenIdentifier: "clerk|u2" }).mutation(api.tidyNames.setNameSport, { ...args, sportId: w.football }),
    ).rejects.toThrow();
    const before = (await allOf(t, "tidyNames"))[0];
    expect(before.sportId).toBe(w.sportId);

    await asAdmin(t).mutation(api.tidyNames.answerName, { ...args, answer: { kind: "notEntity" } });
    await expect(asAdmin(t).mutation(api.tidyNames.setNameSport, { ...args, sportId: w.football })).rejects.toThrow(/Change this answer/);
    expect((await allOf(t, "tidyNames"))[0].sportId).toBe(w.sportId);
  });

  test("switching to a sport where the name is a same-name choice settles the row with that sport's candidates and no lookup", async () => {
    const t = newT();
    const w = await world(t);
    const second = await t.run((ctx) =>
      ctx.db.insert("players", { name: BO, nameNormalized: normalizePlayerName(BO), sportId: w.football, lastUpdated: Date.now() }),
    );
    await seedUnansweredName(t, { scopeId: w.variantTypeId, sportId: w.sportId, kind: "player", name: BO, status: "pending" });
    await commit(t, w, [makeCard({ players: [BO] })]);
    const [card] = await readCards(t, w.variantTypeId);
    await asAdmin(t).mutation(api.tidyNames.setNameSport, { cardId: card._id, kind: "player", name: BO, sportId: w.football });
    const [row] = await allOf(t, "tidyNames");
    expect(row.status).toBe("ready");
    expect(row.sportId).toBe(w.football);
    expect(row.enrichment?.existingCandidates?.map((c) => c.playerId).sort()).toEqual([w.bo, second].sort());
    expect(normalizeEntityName(row.name)).toBe(row.nameNormalized);
  });
});
