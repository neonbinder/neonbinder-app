/**
 * NEO-645 (Q1 = A) — the "stored cards of the set" tier of the commit's own
 * team fill. A card that would save teamless takes the team its players'
 * OTHER cards already carry under this node, the node it copies, or the set's
 * base checklist (`cardChecklist.storedTeamEvidence`), before the career tier.
 *
 *  - the read: one answer, a disagreement (which STOPS the search), nothing;
 *  - the commit: the stored tier outranks the career; a disagreement is not
 *    outvoted by a career; every player on the card must answer; rule 8
 *    (a source naming a team) holds the fill back.
 *
 * NEO-656: the fill no longer leaves a `teamFill` note naming its reason
 * (`tidyChecks` is gone; the card is the record), so only the teams the card
 * ends with are asserted.
 */

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { normalizeTeamName } from "./teams";
import { normalizePlayerName } from "./players";
import { STORED_TEAM_EVIDENCE_PLAYERS_PER_CALL } from "./cardChecklist";
import { insertTestCard } from "../lib/testing/card-row";
import { cancelScheduled } from "../lib/testing/drain-scheduled";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const ADMIN = {
  subject: "admin_stored_team_fill",
  issuer: "https://clerk.example.com",
  tokenIdentifier: "clerk|admin_stored_team_fill",
  role: "admin",
};

type T = ReturnType<typeof convexTest>;
type Sel = Id<"selectorOptions">;

const live: T[] = [];
beforeEach(() => {
  vi.stubGlobal("fetch", (async (url: string | URL) => {
    throw new Error(`this test file must not reach the network: ${String(url)}`);
  }) as unknown as typeof fetch);
});
afterEach(async () => {
  for (const t of live.splice(0)) await cancelScheduled(t);
  vi.unstubAllGlobals();
});

async function seed() {
  const t = convexTest(schema, modules);
  live.push(t);
  const s = await t.run(async (ctx) => {
    const now = Date.now();
    const node = (
      level: "sport" | "year" | "setName" | "variantType",
      value: string,
      parentId?: Sel,
      extra: object = {},
    ) =>
      ctx.db.insert("selectorOptions", {
        level,
        value,
        ...(parentId ? { parentId } : {}),
        platformData: {},
        children: [],
        lastUpdated: now,
        ...extra,
      });
    const sportId = await node("sport", "Baseball");
    const yearId = await node("year", "1985", sportId);
    const setId = await node("setName", "Test Set", yearId);
    const baseId = await node("variantType", "Base", setId);
    const insertId = await node("variantType", "Inserts", setId);
    await ctx.db.patch(setId, { children: [baseId, insertId] });
    const team = (name: string, extra: object = {}) =>
      ctx.db.insert("teams", {
        name,
        nameNormalized: normalizeTeamName(name),
        sportId,
        lastUpdated: now,
        ...extra,
      });
    return {
      sportId,
      baseId,
      insertId,
      reds: await team("Reds"),
      phillies: await team("Phillies"),
      yankees: await team("Yankees"),
    };
  });
  return { t, ...s };
}
type World = Awaited<ReturnType<typeof seed>>;

function player(
  w: World,
  name: string,
  teamYears: Array<{ teamId: Id<"teams">; fromYear?: number; toYear?: number }> = [],
) {
  return w.t.run((ctx) =>
    ctx.db.insert("players", {
      name,
      nameNormalized: normalizePlayerName(name),
      sportId: w.sportId,
      teamYears,
      lastUpdated: Date.now(),
    }),
  );
}

/** A stored card with its player link, the way every production writer leaves one. */
async function stored(
  w: World,
  at: Sel,
  n: string,
  playerIds: Array<Id<"players">>,
  teamOnCardIds: Array<Id<"teams">>,
) {
  await w.t.run(async (ctx) => {
    const cardId = await insertTestCard(ctx, {
      selectorOptionId: at,
      cardNumber: n,
      cardName: "Stored",
      platformData: {},
      sortOrder: 0,
      lastUpdated: Date.now(),
      playerIds,
      teamOnCardIds,
    });
    for (const playerId of new Set(playerIds)) {
      await ctx.db.insert("cardPlayerLinks", {
        cardChecklistId: cardId,
        playerId,
        sportId: w.sportId,
      });
    }
  });
}

const wire = (n: string, players: string[], teams: string[] = []) => ({
  cardNumber: n,
  cardName: `Card ${n}`,
  team: undefined,
  teams,
  players,
  attributes: [],
  platformData: {},
});

async function commit(w: World, cards: ReturnType<typeof wire>[]) {
  await w.t.withIdentity(ADMIN).action(api.selectorOptions.commitCardChecklist, {
    selectorOptionId: w.insertId,
    sportId: w.sportId,
    cards,
  });
  const rows = await w.t.run((ctx) =>
    ctx.db
      .query("cardChecklist")
      .withIndex("by_selector_option", (q) => q.eq("selectorOptionId", w.insertId))
      .collect(),
  );
  return new Map(rows.map((r) => [r.cardNumber, r]));
}

describe("storedTeamEvidence (the read)", () => {
  test("one agreeing team set answers; a disagreement stops; no cards is absent", async () => {
    const w = await seed();
    const agree = await player(w, "Agree Player");
    const split = await player(w, "Split Player");
    const none = await player(w, "None Player");
    await stored(w, w.baseId, "1", [agree], [w.reds]);
    await stored(w, w.baseId, "2", [agree], [w.reds]);
    await stored(w, w.baseId, "3", [split], [w.reds]);
    await stored(w, w.baseId, "4", [split], [w.phillies]);

    const out = await w.t.query(internal.cardChecklist.storedTeamEvidence, {
      selectorOptionId: w.insertId,
      askAbout: [agree, split, none],
    });
    expect(out).toEqual([
      { playerId: agree, status: "answer", teamIds: [w.reds] },
      { playerId: split, status: "disagree", teamIds: [] },
    ]);
  });

  test("refuses a slice past the per-call cap", async () => {
    const w = await seed();
    const ids = await Promise.all(
      Array.from({ length: STORED_TEAM_EVIDENCE_PLAYERS_PER_CALL + 1 }, (_, i) =>
        player(w, `Player ${i}`),
      ),
    );
    await expect(
      w.t.query(internal.cardChecklist.storedTeamEvidence, {
        selectorOptionId: w.insertId,
        askAbout: ids,
      }),
    ).rejects.toThrow(/Too many players/);
  });
});

describe("the commit's stored-cards tier", () => {
  test("a teamless card takes the team its player's stored cards agree on", async () => {
    const w = await seed();
    const bench = await player(w, "Johnny Bench");
    await stored(w, w.baseId, "1", [bench], [w.reds]);

    const rows = await commit(w, [wire("10", ["Johnny Bench"])]);

    const row = rows.get("10")!;
    expect(row.teamOnCardIds).toEqual([w.reds]);
  });

  test("the stored tier outranks the career: the card takes the stored team", async () => {
    const w = await seed();
    const rose = await player(w, "Pete Rose", [{ teamId: w.phillies, fromYear: 1984, toYear: 1986 }]);
    await stored(w, w.baseId, "1", [rose], [w.reds]);

    const rows = await commit(w, [wire("10", ["Pete Rose"])]);

    expect(rows.get("10")!.teamOnCardIds).toEqual([w.reds]);
  });

  test("stored cards that disagree stop the search: the career does not outvote them", async () => {
    const w = await seed();
    const rose = await player(w, "Pete Rose", [{ teamId: w.yankees, fromYear: 1984, toYear: 1986 }]);
    await stored(w, w.baseId, "1", [rose], [w.reds]);
    await stored(w, w.baseId, "2", [rose], [w.phillies]);

    const rows = await commit(w, [wire("10", ["Pete Rose"])]);

    expect(rows.get("10")!.teamOnCardIds ?? []).toEqual([]);
  });

  test("a player with no stored cards still falls through to his career", async () => {
    const w = await seed();
    await player(w, "Pete Rose", [{ teamId: w.phillies, fromYear: 1984, toYear: 1986 }]);

    const rows = await commit(w, [wire("10", ["Pete Rose"])]);

    expect(rows.get("10")!.teamOnCardIds).toEqual([w.phillies]);
  });

  test("a two-player card needs every player to answer; stored and career mix into one union", async () => {
    const w = await seed();
    const bench = await player(w, "Johnny Bench");
    await player(w, "Pete Rose", [{ teamId: w.phillies, fromYear: 1984, toYear: 1986 }]);
    await player(w, "Nobody Known");
    await stored(w, w.baseId, "1", [bench], [w.reds]);

    const rows = await commit(w, [
      wire("10", ["Johnny Bench", "Pete Rose"]),
      wire("11", ["Johnny Bench", "Nobody Known"]),
    ]);

    expect(rows.get("10")!.teamOnCardIds).toEqual([w.reds, w.phillies]);
    // Nobody Known has neither stored cards nor a career: nothing is guessed.
    expect(rows.get("11")!.teamOnCardIds ?? []).toEqual([]);
  });

  test("NEO-656: a player the gate linked (a gate link, not an exact name) takes the team his base card carries", async () => {
    const w = await seed();
    const bench = await player(w, "Johnny Bench");
    await stored(w, w.baseId, "1", [bench], [w.reds]);

    await w.t.withIdentity(ADMIN).action(api.selectorOptions.commitCardChecklist, {
      selectorOptionId: w.insertId,
      sportId: w.sportId,
      cards: [wire("10", ["J. Bench"])],
      gateLinks: [{ kind: "player" as const, name: "J. Bench", playerId: bench, origin: "setHistory" as const }],
    });
    const rows = await w.t.run((ctx) =>
      ctx.db
        .query("cardChecklist")
        .withIndex("by_selector_option", (q) => q.eq("selectorOptionId", w.insertId))
        .collect(),
    );

    expect(rows[0].playerIds).toEqual([bench]);
    expect(rows[0].teamOnCardIds).toEqual([w.reds]);
  });

  test("an earlier card of the same insert counts too: the node being saved is evidence", async () => {
    const w = await seed();
    const bench = await player(w, "Johnny Bench");
    await stored(w, w.insertId, "1", [bench], [w.reds]);

    const rows = await commit(w, [wire("10", ["Johnny Bench"])]);

    expect(rows.get("10")!.teamOnCardIds).toEqual([w.reds]);
  });

  test("tiers, first answer wins: the insert's own card outranks the base card (the base only speaks when the insert has none)", async () => {
    const w = await seed();
    const bench = await player(w, "Johnny Bench");
    await stored(w, w.baseId, "1", [bench], [w.reds]);
    await stored(w, w.insertId, "2", [bench], [w.phillies]);

    const rows = await commit(w, [wire("10", ["Johnny Bench"])]);

    expect(rows.get("10")!.teamOnCardIds).toEqual([w.phillies]);
  });

  test("main parity: a card of ANOTHER insert is not evidence (\"a team borrowed across inserts is a guess\"); the base card still is", async () => {
    const w = await seed();
    const bench = await player(w, "Johnny Bench");
    const otherInsertId = await w.t.run(async (ctx) => {
      const base = await ctx.db.get(w.baseId);
      return ctx.db.insert("selectorOptions", {
        level: "variantType",
        value: "Inserts",
        parentId: base!.parentId,
        platformData: {},
        children: [],
        lastUpdated: Date.now(),
      });
    });
    await stored(w, otherInsertId, "1", [bench], [w.phillies]);
    // Only another insert holds him: nothing to fill from (the career has no window here).
    expect((await commit(w, [wire("10", ["Johnny Bench"])])).get("10")!.teamOnCardIds ?? []).toEqual([]);

    await stored(w, w.baseId, "2", [bench], [w.reds]);
    // The base card answers, and the other insert's team does not vote against it.
    expect((await commit(w, [wire("11", ["Johnny Bench"])])).get("11")!.teamOnCardIds).toEqual([w.reds]);
  });

  test("a team the checklist names (one NB knows) is never replaced by the stored cards' team", async () => {
    const w = await seed();
    const bench = await player(w, "Johnny Bench");
    await stored(w, w.baseId, "1", [bench], [w.reds]);

    const rows = await commit(w, [wire("10", ["Johnny Bench"], ["Phillies"])]);

    expect(rows.get("10")!.teamOnCardIds).toEqual([w.phillies]);
  });

  test("rule 8: a card whose listing names a team is never filled", async () => {
    const w = await seed();
    const bench = await player(w, "Johnny Bench");
    await stored(w, w.baseId, "1", [bench], [w.reds]);

    const rows = await commit(w, [wire("10", ["Johnny Bench"], ["Some Unheard Of Club"])]);

    const row = rows.get("10")!;
    expect(row.teamOnCardIds ?? []).toEqual([]);
  });
});
