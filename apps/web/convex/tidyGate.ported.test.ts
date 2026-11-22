/**
 * NEO-645 — ported from entityReviewQueue.autoLink / sameNameLookup tests and
 * the gate's enqueue tests of commitCardChecklist.entityReview.
 *
 * `startBatch`'s decided rows are `tidyNames.upsertFromGatePage` rows now: an
 * auto-link is a `linkPlayer` / `linkTeam` answer with `by: "auto"` and its
 * origin; a history choice, a preselect and a same-name choice are `ready` rows
 * with NO answer and NO lookup; every other name is born `pending` and its
 * lookup is enqueued AFTER the commit (`enqueuePendingLookups`). "Change" on an
 * auto-link is `answerName {clear}`.
 *
 * The audit log lines of `startBatch` (`entity_review_auto_linked`,
 * `..._malformed_facts`) have no counterpart: see the retired list in the
 * ticket report.
 */

import { convexTest } from "convex-test";
import { afterEach, describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import { GATE_UPSERT_OPS } from "./tidyNames";
import { normalizePlayerName } from "./players";
import { cancelScheduled } from "../lib/testing/drain-scheduled";
import { normalizeEntityName } from "../lib/entities/normalize-name";
import { ADMIN, commit, makeCard, readCards, type T } from "../lib/testing/tidy-ported";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

type Sel = Id<"selectorOptions">;
const ENQUEUE_FN = "wikidataPool:enqueueTidyNameLookups";

const live: T[] = [];
function newT(): T {
  const t = convexTest(schema, modules);
  live.push(t);
  return t;
}
afterEach(async () => {
  for (const t of live.splice(0)) await cancelScheduled(t);
});

async function node(t: T, level: string, value: string, parentId?: Sel): Promise<Sel> {
  return t.run(async (ctx) => {
    const id = await ctx.db.insert("selectorOptions", {
      level,
      value,
      ...(parentId ? { parentId } : {}),
      platformData: {},
      children: [],
      lastUpdated: Date.now(),
    });
    if (parentId) {
      const parent = await ctx.db.get(parentId);
      await ctx.db.patch(parentId, { children: [...(parent?.children ?? []), id] });
    }
    return id;
  });
}

const player = (t: T, sportId: Sel, name: string, extra: Partial<Doc<"players">> = {}) =>
  t.run((ctx) =>
    ctx.db.insert("players", {
      name,
      nameNormalized: normalizePlayerName(name),
      sportId,
      lastUpdated: Date.now(),
      ...extra,
    }),
  );

/** Baseball › 2024 › Topps › Series 1 › Base, a Football sport, and two Bo Jacksons. */
async function seed(t: T) {
  const baseball = await node(t, "sport", "Baseball");
  const football = await node(t, "sport", "Football");
  const year = await node(t, "year", "2024", baseball);
  const brand = await node(t, "manufacturer", "Topps", year);
  const set = await node(t, "setName", "Series 1", brand);
  const base = await node(t, "variantType", "Base", set);
  const bo = await player(t, football, "Bo Jackson");
  const otherBo = await player(t, baseball, "Bo Jackson");
  return { baseball, football, base, bo, otherBo };
}
type World = Awaited<ReturnType<typeof seed>>;

type Item = {
  kind: "player" | "team";
  name: string;
  sportId: Sel;
  noExistingMatch?: true;
  auto?: {
    playerId?: Id<"players">;
    teamId?: Id<"teams">;
    origin: "setHistory" | "hallOfFame" | "careerTeam";
    candidatePlayerIds?: Id<"players">[];
  };
  historyPlayerIds?: Id<"players">[];
  preselect?: {
    playerId: Id<"players">;
    sportId: Sel;
    sportValue: string;
    reason: "priorYearProduct" | "onlyNamesake";
  };
};

function upsert(t: T, w: World, items: Item[]) {
  return t.mutation(internal.tidyNames.upsertFromGatePage, { scopeId: w.base, items: items as never });
}
const rows = (t: T) => t.run((ctx) => ctx.db.query("tidyNames").collect());
const byName = (list: Doc<"tidyNames">[], name: string) => list.find((r) => r.name === name)!;
const getRow = (t: T, id: Id<"tidyNames">) => t.run((ctx) => ctx.db.get(id));

async function enqueuedIds(t: T): Promise<string[]> {
  const fns = await t.run(async (ctx) =>
    (
      await (ctx as unknown as {
        db: { system: { query: (n: string) => { collect: () => Promise<Array<{ name: string; args: unknown[] }>> } } };
      }).db.system.query("_scheduled_functions").collect()
    ),
  );
  return fns
    .filter((r) => r.name === ENQUEUE_FN)
    .flatMap((r) => (r.args[0] as { items: Array<{ rowId: string }> }).items.map((i) => i.rowId));
}

const bo = (w: World): Item => ({
  kind: "player",
  name: "Bo Jackson",
  sportId: w.football,
  auto: { playerId: w.bo, origin: "setHistory" },
});

describe("upsertFromGatePage: auto-links are born answered, ready and never looked up", () => {
  test("a set-history player link is one answered row in the linked player's home sport, with no candidates for a lone link", async () => {
    const t = newT();
    const w = await seed(t);
    await upsert(t, w, [bo(w)]);
    const [row] = await rows(t);
    expect(row).toMatchObject({
      kind: "player",
      name: "Bo Jackson",
      sportId: w.football,
      status: "ready",
      answer: { kind: "linkPlayer", playerId: w.bo, by: "auto", autoReason: "setHistory" },
    });
    // A guest link: nothing for the commit to add to the player's sports.
    expect(row.answer).not.toHaveProperty("addSetSport");
    expect(row.enrichment).toBeUndefined();
    expect(await enqueuedIds(t)).toEqual([]);
    expect(row.lookupGen).toBeUndefined();
  });

  test("with rivals it stores the candidates, history player first, each labelled with its sport, the linked id once", async () => {
    const t = newT();
    const w = await seed(t);
    await upsert(t, w, [
      { ...bo(w), auto: { playerId: w.bo, origin: "setHistory", candidatePlayerIds: [w.bo, w.otherBo, w.bo] } },
    ]);
    const [row] = await rows(t);
    expect(row.enrichment?.existingCandidates?.map((c) => [c.playerId, c.sportValue])).toEqual([
      [w.bo, "Football"],
      [w.otherBo, "Baseball"],
    ]);
  });

  test("a Hall of Fame link and a career-team link carry their own origin (NEO-490)", async () => {
    const t = newT();
    const w = await seed(t);
    await upsert(t, w, [
      { kind: "player", name: "Hof Guy", sportId: w.baseball, auto: { playerId: w.otherBo, origin: "hallOfFame" } },
      { kind: "player", name: "Career Guy", sportId: w.baseball, auto: { playerId: w.otherBo, origin: "careerTeam" } },
    ]);
    const list = await rows(t);
    expect(byName(list, "Hof Guy").answer).toMatchObject({ playerId: w.otherBo, by: "auto", autoReason: "hallOfFame" });
    expect(byName(list, "Career Guy").answer).toMatchObject({ playerId: w.otherBo, by: "auto", autoReason: "careerTeam" });
  });

  test("a career-team TEAM link is accepted and its origin is the answer's autoReason (NEO-490)", async () => {
    const t = newT();
    const w = await seed(t);
    const browns = await t.run((ctx) =>
      ctx.db.insert("teams", {
        location: "St. Louis",
        name: "Browns",
        nameNormalized: normalizeEntityName("St. Louis Browns"),
        sportId: w.baseball,
        lastUpdated: Date.now(),
      }),
    );
    await upsert(t, w, [
      { kind: "team", name: "St. Louis Browns", sportId: w.baseball, auto: { teamId: browns, origin: "careerTeam" } },
    ]);
    const [row] = await rows(t);
    expect(row).toMatchObject({
      kind: "team",
      status: "ready",
      answer: { kind: "linkTeam", teamId: browns, by: "auto", autoReason: "careerTeam" },
    });
  });

  test("a Hall of Fame TEAM link is still refused as malformed: the name becomes an ordinary unanswered row (NEO-490)", async () => {
    const t = newT();
    const w = await seed(t);
    const team = await t.run((ctx) =>
      ctx.db.insert("teams", {
        name: "Some Team",
        nameNormalized: normalizeEntityName("Some Team"),
        sportId: w.baseball,
        lastUpdated: Date.now(),
      }),
    );
    await upsert(t, w, [
      { kind: "player", name: "Travis Bazzana", sportId: w.baseball, noExistingMatch: true },
      { kind: "team", name: "Some Team", sportId: w.baseball, auto: { teamId: team, origin: "hallOfFame" } },
    ]);
    const list = await rows(t);
    expect(list.map((r) => r.name).sort()).toEqual(["Some Team", "Travis Bazzana"]);
    expect(byName(list, "Some Team").answer).toBeUndefined();
  });

  test("a team link is answered in the team's sport; only ordinary names are looked up, and only after the commit", async () => {
    const t = newT();
    const w = await seed(t);
    const raiders = await t.run((ctx) =>
      ctx.db.insert("teams", {
        location: "Oakland",
        name: "Raiders",
        nameNormalized: normalizeEntityName("Oakland Raiders"),
        sportId: w.football,
        lastUpdated: Date.now(),
      }),
    );
    await upsert(t, w, [
      { kind: "player", name: "Travis Bazzana", sportId: w.baseball, noExistingMatch: true },
      { kind: "team", name: "Oakland Raiders", sportId: w.football, auto: { teamId: raiders, origin: "setHistory" } },
    ]);
    const list = await rows(t);
    expect(byName(list, "Oakland Raiders")).toMatchObject({
      kind: "team",
      sportId: w.football,
      status: "ready",
      answer: { kind: "linkTeam", teamId: raiders, by: "auto", autoReason: "setHistory" },
    });
    // Born pending, NOT yet enqueued: the pool must not patch rows the prelude reads.
    expect(byName(list, "Travis Bazzana")).toMatchObject({ status: "pending", lookupGen: 0 });
    expect(await enqueuedIds(t)).toEqual([]);

    await t.mutation(internal.tidyNames.enqueuePendingLookups, { scopeId: w.base });
    expect(await enqueuedIds(t)).toEqual([byName(list, "Travis Bazzana")._id]);
  });

  test("the same name as a plain name and as an auto-link, in two spellings, is ONE row", async () => {
    const t = newT();
    const w = await seed(t);
    await upsert(t, w, [
      { kind: "player", name: "Jackson, Bo", sportId: w.baseball },
      bo(w),
    ]);
    const list = await rows(t);
    expect(list).toHaveLength(1);
    expect(list[0].answer?.kind).toBe("linkPlayer");
    expect(await enqueuedIds(t)).toEqual([]);
  });

  test("an auto-link beats a history choice and a preselect for the same name", async () => {
    const t = newT();
    const w = await seed(t);
    await upsert(t, w, [
      {
        ...bo(w),
        historyPlayerIds: [w.bo, w.otherBo],
        preselect: { playerId: w.otherBo, sportId: w.baseball, sportValue: "Baseball", reason: "onlyNamesake" },
      },
    ]);
    const list = await rows(t);
    expect(list).toHaveLength(1);
    expect(list[0].answer).toMatchObject({ playerId: w.bo, by: "auto" });
    expect(list[0].enrichment?.preselect).toBeUndefined();
  });

  test("a malformed fact (a player link with no player) costs its one name an answer, never the rest: it is an ordinary row and its neighbours are written", async () => {
    const t = newT();
    const w = await seed(t);
    await upsert(t, w, [
      { kind: "player", name: "Travis Bazzana", sportId: w.baseball, noExistingMatch: true },
      { kind: "player", name: "No Player", sportId: w.baseball, noExistingMatch: true, auto: { origin: "setHistory" } },
    ]);
    const list = await rows(t);
    expect(list.map((r) => r.name).sort()).toEqual(["No Player", "Travis Bazzana"]);
    expect(byName(list, "No Player").answer).toBeUndefined();
  });
});

describe("upsertFromGatePage: history choices and preselects wait for the operator", () => {
  test("a history choice is ready in the set's sport with cross-sport candidates, no answer, and is never looked up", async () => {
    const t = newT();
    const w = await seed(t);
    await upsert(t, w, [{ kind: "player", name: "Bo Jackson", sportId: w.baseball, historyPlayerIds: [w.bo, w.otherBo] }]);
    const [row] = await rows(t);
    expect(row).toMatchObject({ status: "ready", sportId: w.baseball });
    expect(row.answer).toBeUndefined();
    expect(row.enrichment?.existingCandidates?.map((c) => [c.playerId, c.sportValue])).toEqual([
      [w.bo, "Football"],
      [w.otherBo, "Baseball"],
    ]);
    await t.mutation(internal.tidyNames.enqueuePendingLookups, { scopeId: w.base });
    expect(await enqueuedIds(t)).toEqual([]);
  });

  test("a history choice whose players are all gone falls back to an ordinary pending row", async () => {
    const t = newT();
    const w = await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.delete(w.bo);
      await ctx.db.delete(w.otherBo);
    });
    await upsert(t, w, [{ kind: "player", name: "Bo Jackson", sportId: w.baseball, historyPlayerIds: [w.bo, w.otherBo] }]);
    const [row] = await rows(t);
    expect(row.status).toBe("pending");
    expect(row.enrichment).toBeUndefined();
    await t.mutation(internal.tidyNames.enqueuePendingLookups, { scopeId: w.base });
    expect(await enqueuedIds(t)).toEqual([row._id]);
  });

  test("a preselected name is ready with the suggestion and NO lookup; its neighbours are looked up", async () => {
    const t = newT();
    const w = await seed(t);
    await t.run((ctx) => ctx.db.delete(w.otherBo));
    await upsert(t, w, [
      {
        kind: "player",
        name: "Bo Jackson",
        sportId: w.baseball,
        noExistingMatch: true,
        preselect: { playerId: w.bo, sportId: w.football, sportValue: "Football", reason: "priorYearProduct" },
      },
      { kind: "player", name: "Travis Bazzana", sportId: w.baseball, noExistingMatch: true },
    ]);
    const list = await rows(t);
    const row = byName(list, "Bo Jackson");
    expect(row.status).toBe("ready");
    expect(row.answer).toBeUndefined();
    expect(row.enrichment?.preselect).toEqual({
      playerId: w.bo,
      name: "Bo Jackson",
      sportId: w.football,
      sportValue: "Football",
      reason: "priorYearProduct",
    });
    expect(row.enrichment?.wikidataId).toBeUndefined();
    await t.mutation(internal.tidyNames.enqueuePendingLookups, { scopeId: w.base });
    expect(await enqueuedIds(t)).toEqual([byName(list, "Travis Bazzana")._id]);
  });

  test("a gate of ONLY preselected names schedules no pool enqueue at all", async () => {
    const t = newT();
    const w = await seed(t);
    await t.run((ctx) => ctx.db.delete(w.otherBo));
    await upsert(t, w, [
      {
        kind: "player",
        name: "Bo Jackson",
        sportId: w.baseball,
        noExistingMatch: true,
        preselect: { playerId: w.bo, sportId: w.football, sportValue: "Football", reason: "onlyNamesake" },
      },
    ]);
    expect(await t.mutation(internal.tidyNames.enqueuePendingLookups, { scopeId: w.base })).toBe(0);
    expect(await enqueuedIds(t)).toEqual([]);
  });

  test("a preselect rides on a history choice's row", async () => {
    const t = newT();
    const w = await seed(t);
    await upsert(t, w, [
      {
        kind: "player",
        name: "Bo Jackson",
        sportId: w.baseball,
        historyPlayerIds: [w.bo, w.otherBo],
        preselect: { playerId: w.bo, sportId: w.football, sportValue: "Football", reason: "priorYearProduct" },
      },
    ]);
    const [row] = await rows(t);
    expect(row.enrichment?.existingCandidates).toHaveLength(2);
    expect(row.enrichment?.preselect?.playerId).toBe(w.bo);
  });
});

describe("upsertFromGatePage: a re-fetch converges on the same rows (was: resume and continuation)", () => {
  test("a repeat with the same facts writes no second row", async () => {
    const t = newT();
    const w = await seed(t);
    await upsert(t, w, [bo(w)]);
    await upsert(t, w, [bo(w)]);
    expect(await rows(t)).toHaveLength(1);
  });

  test("a repeat never re-answers a row the operator has since taken over: an operator answer is untouched", async () => {
    const t = newT();
    const w = await seed(t);
    await upsert(t, w, [bo(w)]);
    const [row] = await rows(t);
    await t.run((ctx) =>
      ctx.db.patch(row._id, { answer: { kind: "linkPlayer", playerId: w.otherBo, by: "operator" }, answerGen: 2 }),
    );
    await upsert(t, w, [bo(w)]);
    expect((await getRow(t, row._id))!.answer).toEqual({ kind: "linkPlayer", playerId: w.otherBo, by: "operator" });
  });

  test("a repeat after the operator CHANGED an auto answer (cleared it) re-asserts the gate's fact only because the gate still states it; a gate that no longer states it clears the stale auto answer", async () => {
    const t = newT();
    const w = await seed(t);
    await upsert(t, w, [bo(w)]);
    const [row] = await rows(t);
    // The gate no longer has the fact (e.g. the history link was removed).
    await upsert(t, w, [{ kind: "player", name: "Bo Jackson", sportId: w.baseball, noExistingMatch: true }]);
    const after = (await getRow(t, row._id))!;
    expect(after.answer).toBeUndefined();
    expect(after.answerGen).toBe(2);
  });

  test("a repeat adds a fact that arrived with the re-fetch and keeps the old row", async () => {
    const t = newT();
    const w = await seed(t);
    await upsert(t, w, [{ kind: "player", name: "Travis Bazzana", sportId: w.baseball, noExistingMatch: true }]);
    await upsert(t, w, [{ kind: "player", name: "Travis Bazzana", sportId: w.baseball, noExistingMatch: true }, bo(w)]);
    const list = await rows(t);
    expect(list.map((r) => r.name).sort()).toEqual(["Bo Jackson", "Travis Bazzana"]);
    expect(byName(list, "Bo Jackson").answer?.kind).toBe("linkPlayer");
  });

  test("a fact the first page cannot afford is carried by the next page and lands once", async () => {
    const t = newT();
    const w = await seed(t);
    const plain: Item[] = Array.from({ length: Math.ceil(GATE_UPSERT_OPS / 2) + 25 }, (_, i) => ({
      kind: "player" as const,
      name: `Rookie Number${i}`,
      sportId: w.baseball,
      noExistingMatch: true as const,
    }));
    const items = [...plain, bo(w)];

    const first = await upsert(t, w, items);
    expect(first.processed).toBeLessThan(items.length);
    expect((await rows(t)).some((r) => r.name === "Bo Jackson")).toBe(false);

    let from = first.processed;
    let guard = 0;
    while (from < items.length) {
      const next = await upsert(t, w, items.slice(from));
      from += next.processed;
      if (++guard > 20) throw new Error("did not converge");
    }
    const list = await rows(t);
    expect(list).toHaveLength(plain.length + 1);
    expect(list.filter((r) => r.name === "Bo Jackson")).toHaveLength(1);
    expect(byName(list, "Bo Jackson").answer).toMatchObject({ by: "auto", autoReason: "setHistory" });
  });
});

describe("answerName: a link to a player the row offered may cross sports (D7)", () => {
  /** A gate-written row on a committed card, in the set's sport, offering both Bo Jacksons. */
  async function offered(
    t: T,
    w: World,
    mk: Record<string, unknown> | undefined | ((other: Id<"players">) => Record<string, unknown> | undefined),
  ) {
    // Two baseball Bo Jacksons, so the commit cannot silently link the card.
    await t.run((ctx) => ctx.db.delete(w.otherBo));
    const other = await player(t, w.baseball, "Bo Jackson");
    await player(t, w.baseball, "Bo Jackson");
    const enrichment = typeof mk === "function" ? mk(other) : mk;
    await t.run((ctx) =>
      ctx.db.insert("tidyNames", {
        scopeId: w.base,
        kind: "player",
        nameNormalized: normalizeEntityName("Bo Jackson"),
        name: "Bo Jackson",
        sportId: w.baseball,
        status: "ready",
        ...(enrichment ? { enrichment: enrichment as never } : {}),
      }),
    );
    await commit(t, { variantTypeId: w.base, sportId: w.baseball }, [makeCard({ players: ["Bo Jackson"] })]);
    const [card] = await readCards(t, w.base);
    return { card, other };
  }
  const candidate = (playerId: Id<"players">, sportValue: string) => ({
    playerId,
    name: "Bo Jackson",
    careerSummary: "",
    sportValue,
  });
  const link = (t: T, cardId: Id<"cardChecklist">, playerId: Id<"players">, extra = {}) =>
    t.withIdentity(ADMIN).mutation(api.tidyNames.answerName, {
      cardId,
      kind: "player",
      name: "Bo Jackson",
      answer: { kind: "linkPlayer", playerId, ...extra },
    });

  test("a listed candidate in another sport is accepted and re-points the row to his home sport", async () => {
    const t = newT();
    const w = await seed(t);
    const { card } = await offered(t, w, {
      existingCandidates: [candidate(w.bo, "Football")],
    });
    await link(t, card._id, w.bo);
    const [row] = await rows(t);
    expect(row.sportId).toBe(w.football);
    expect(row.answer).toMatchObject({ kind: "linkPlayer", playerId: w.bo, by: "operator" });
    expect((await readCards(t, w.base))[0].playerIds).toEqual([w.bo]);
  });

  test("the preselected player is accepted across sports too", async () => {
    const t = newT();
    const w = await seed(t);
    const { card } = await offered(t, w, {
      preselect: { playerId: w.bo, name: "Bo Jackson", sportId: w.football, sportValue: "Football", reason: "onlyNamesake" },
    });
    await link(t, card._id, w.bo);
    expect((await rows(t))[0].sportId).toBe(w.football);
  });

  test("an unlisted player in another sport is still refused, and nothing is written", async () => {
    const t = newT();
    const w = await seed(t);
    const { card } = await offered(t, w, { existingCandidates: [candidate(w.bo, "Football")] });
    const stranger = await player(t, w.football, "Bo Jackson");
    await expect(link(t, card._id, stranger)).rejects.toThrow(/isn't in this sport/);
    const [row] = await rows(t);
    expect(row.answer).toBeUndefined();
    expect(row.sportId).toBe(w.baseball);
  });

  test("a row with no offer refuses a cross-sport link: the operator's own search stays sport-checked", async () => {
    const t = newT();
    const w = await seed(t);
    const { card } = await offered(t, w, undefined);
    await expect(link(t, card._id, w.bo)).rejects.toThrow(/isn't in this sport/);
  });

  test("a listed candidate in the row's own sport changes nothing about the row's sport", async () => {
    const t = newT();
    const w = await seed(t);
    const { card, other } = await offered(t, w, (o) => ({
      existingCandidates: [candidate(w.bo, "Football"), candidate(o, "Baseball")],
    }));
    await link(t, card._id, other);
    const [row] = await rows(t);
    expect(row.sportId).toBe(w.baseball);
    expect(row.answer).toMatchObject({ playerId: other });
  });

  test("addSetSport survives a cross-sport pick (the player ends up playing the set's sport), and is a no-op for the set's own sport", async () => {
    const t = newT();
    const w = await seed(t);
    const { card } = await offered(t, w, (o) => ({
      existingCandidates: [candidate(w.bo, "Football"), candidate(o, "Baseball")],
    }));
    await link(t, card._id, w.bo, { addSetSport: true });
    expect((await rows(t))[0].answer).toMatchObject({ playerId: w.bo, addSetSport: true });
    expect((await t.run((ctx) => ctx.db.get(w.bo)))!.alsoSportIds).toEqual([w.baseball]);
  });

  test("a stale offered id (the player was deleted) is refused", async () => {
    const t = newT();
    const w = await seed(t);
    const { card } = await offered(t, w, { existingCandidates: [candidate(w.bo, "Football")] });
    await t.run((ctx) => ctx.db.delete(w.bo));
    await expect(link(t, card._id, w.bo)).rejects.toThrow(/gone/);
  });
});

describe("resolveChecklistEntities: unknown vs ambiguous names (NEO-254), now name rows with no batch", () => {
  const resolve = (t: T, w: World, names: string[]) =>
    t.withIdentity(ADMIN).action(api.selectorOptions.resolveChecklistEntities, {
      selectorOptionId: w.base,
      sportId: w.baseball,
      cards: names.map((n, i) => ({ cardNumber: String(i + 1), cardName: "Card", players: [n], teams: [], platformData: {} })),
    });
  const bare = (t: T, w: World, name: string, extra: Partial<Doc<"players">> = {}) =>
    player(t, w.baseball, name, extra);

  test("two same-name rows, un-narrowed: unknown AND ambiguous, ONE unanswered row carrying both candidates, no batch id", async () => {
    const t = newT();
    const w = await seed(t);
    await bare(t, w, "Bob Allen", { birthYear: 1867 });
    await bare(t, w, "Bob Allen", { birthYear: 1937 });
    const resolved = await resolve(t, w, ["Bob Allen"]);
    expect(resolved.unknownPlayers).toEqual(["Bob Allen"]);
    expect(resolved.ambiguousPlayers).toEqual(["Bob Allen"]);
    expect((resolved as { batchId?: string }).batchId).toBeUndefined();
    const list = await rows(t);
    expect(list.map((r) => r.name)).toEqual(["Bob Allen"]);
    expect(list[0].answer).toBeUndefined();
    expect(list[0].enrichment?.existingCandidates?.map((c) => c.birthYear).sort()).toEqual([1867, 1937]);
  });

  test("a brand-new name is unknown but not ambiguous, and its row is pending with no candidates", async () => {
    const t = newT();
    const w = await seed(t);
    const resolved = await resolve(t, w, ["Daulton Varsho"]);
    expect(resolved.unknownPlayers).toEqual(["Daulton Varsho"]);
    expect(resolved.ambiguousPlayers).toEqual([]);
    const [row] = await rows(t);
    expect(row.status).toBe("pending");
    expect(row.enrichment?.existingCandidates).toBeUndefined();
  });

  test("exactly one existing row is neither unknown nor ambiguous, and writes no name row (D6: an exact single match is linked live)", async () => {
    const t = newT();
    const w = await seed(t);
    await bare(t, w, "Tony Gwynn");
    const resolved = await resolve(t, w, ["Tony Gwynn"]);
    expect(resolved.unknownPlayers).toEqual([]);
    expect(resolved.ambiguousPlayers).toEqual([]);
    expect(await rows(t)).toHaveLength(0);
  });

  test("only the ambiguous name is listed when a card carries an ambiguous and a new one", async () => {
    const t = newT();
    const w = await seed(t);
    await bare(t, w, "Bob Allen");
    await bare(t, w, "Bob Allen");
    const resolved = await resolve(t, w, ["Bob Allen", "Daulton Varsho"]);
    expect(resolved.ambiguousPlayers).toEqual(["Bob Allen"]);
    expect([...resolved.unknownPlayers].sort()).toEqual(["Bob Allen", "Daulton Varsho"]);
  });
});
