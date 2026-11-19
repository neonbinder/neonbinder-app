/**
 * NEO-426 — a teamless sport defaults a card to "No team" (the sport row's
 * `teamlessSport` stamp), at every place a card is BORN:
 * `commitCardChecklistChunk`'s insert branch and `addCustomCard`.
 * (`applyBscTeamResolution`, the lookup-answer path, is in
 * cardChecklist.bscTeamlessSport.test.ts.) A re-synced (existing) row is never
 * stamped: existing cards are the operator's to mark (NEO-556's bulk action),
 * and a stamp there would fire when an incoming team was named but not
 * accepted, against product invariant 8.
 *
 * The default is ONE more reason to stamp, decided by `noTeamCardVerdict` on
 * the card as it will be born, so everything that holds back the set's No Team
 * holds this back too (product invariant 8): a listing team, a pending team
 * name, a lookup owed or given up. On top of that it needs >=1 player, no
 * player name waiting on review, and every player's HOME sport flagged.
 *
 * The chunk is called directly (`commitCardChecklistChunk`), the way
 * cardPlayerDefaults.creation.test.ts does, so the cards carry resolved
 * `playerIds` as the action would hand them over.
 */

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import { teamRowFields } from "./lib/teamRow";
import { insertTestCard } from "../lib/testing/card-row";
import { cancelScheduled } from "../lib/testing/drain-scheduled";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const ADMIN = { subject: "admin_neo426_commit", role: "admin" };
const OPERATOR = "operator_neo426";
const SPORT_SETTER = "setter_neo426_sport";
const LEAF_SETTER = "setter_neo426_leaf";
const NOW = 1_700_000_000_000;
const SPORT_STAMP = { setAt: NOW, setByUserId: SPORT_SETTER };
const LEAF_NO_TEAM = { setAt: NOW, setByUserId: LEAF_SETTER };

// The schema-typed harness (a bare `ReturnType<typeof convexTest>` loses the
// schema, so `t.run` cannot see tables or indexes).
const makeT = () => convexTest(schema, modules);
type T = ReturnType<typeof makeT>;
type Sel = Id<"selectorOptions">;

let live: T[] = [];
beforeEach(() => {
  live = [];
  vi.stubGlobal("fetch", (async (url: string | URL) => {
    throw new Error(`NEO-426: this test file must not reach the network: ${String(url)}`);
  }) as unknown as typeof fetch);
});
afterEach(async () => {
  for (const t of live) await cancelScheduled(t as unknown as Parameters<typeof cancelScheduled>[0]);
  vi.unstubAllGlobals();
});

type Opts = { golfFlagged?: boolean; leaf?: Partial<Doc<"selectorOptions">> };

/** Golf (flagged unless told otherwise) › set › leaf, plus Baseball. */
async function seed(opts: Opts = {}) {
  const t = makeT();
  live.push(t);
  const fx = await t.run(async (ctx) => {
    const row = (level: Doc<"selectorOptions">["level"], value: string, parentId?: Sel, extra = {}) =>
      ctx.db.insert("selectorOptions", {
        level,
        value,
        ...(parentId ? { parentId } : {}),
        platformData: {},
        children: [],
        lastUpdated: NOW,
        ...extra,
      });
    const golf = await row("sport", "Golf", undefined, {
      ...(opts.golfFlagged === false ? {} : { teamlessSport: SPORT_STAMP }),
    });
    const baseball = await row("sport", "Baseball");
    const set = await row("setName", "Greens", golf, { features: { manufacturer: "Topps", season: "2024" } });
    const leaf = await row("variantType", "Base", set, {
      features: { manufacturer: "Topps", season: "2024" },
      ...opts.leaf,
    });
    const player = (name: string, sportId: Sel) =>
      ctx.db.insert("players", { name, nameNormalized: name.toLowerCase(), sportId, lastUpdated: NOW });
    return {
      golf,
      baseball,
      set,
      leaf,
      tiger: await player("Tiger Woods", golf),
      rory: await player("Rory McIlroy", golf),
      mookie: await player("Mookie Betts", baseball),
    };
  });
  return { t, fx };
}
type Fx = Awaited<ReturnType<typeof seed>>["fx"];

type ChunkCard = {
  cardNumber: string;
  cardName: string;
  platformData: Record<string, unknown>;
  sortOrder: number;
  playerNames: string[];
  teamNames: string[];
  playerIds?: Array<Id<"players">>;
  pendingPlayerNames?: string[];
  pendingTeamNames?: string[];
  teamLookup?: "answered" | "failed" | "checklist";
  bscTeamHint?: string;
  teamNone?: true;
  existingId?: Id<"cardChecklist">;
  applyFields?: string[];
  baseVersion?: number;
};

const wire = (n: string, extra: Partial<ChunkCard> = {}): ChunkCard => ({
  cardNumber: n,
  cardName: `Card ${n}`,
  platformData: {},
  sortOrder: Number.parseInt(n, 10) || 0,
  playerNames: [],
  teamNames: [],
  ...extra,
});

const bsc = (ref = "B1") => ({ bsc: { ref } });

function commit(
  t: T,
  fx: Fx,
  cards: ChunkCard[],
  extra: { operatorUserId?: string; resolvedPlayerNames?: string[] } = {},
) {
  return t.mutation(internal.selectorOptions.commitCardChecklistChunk, {
    selectorOptionId: fx.leaf,
    sportValue: "Golf",
    setNameValue: "Greens",
    cards: cards as never,
    ...extra,
  });
}

async function cardsOn(t: T, leaf: Sel) {
  const rows = await t.run(async (ctx) =>
    ctx.db
      .query("cardChecklist")
      .withIndex("by_selector_option", (q) => q.eq("selectorOptionId", leaf))
      .collect(),
  );
  return new Map(rows.map((r) => [r.cardNumber, r]));
}

/** Born through the chunk, then read back. */
async function born(t: T, fx: Fx, card: ChunkCard, extra: { operatorUserId?: string } = {}) {
  const out = await commit(t, fx, [card], extra);
  return { row: (await cardsOn(t, fx.leaf)).get(card.cardNumber)!, out };
}

const stamped = (row: Doc<"cardChecklist">) => row.teamNoneConfirmedAt !== undefined;

// ───────────────────────────────────────────────────────────────────────────
// The insert branch
// ───────────────────────────────────────────────────────────────────────────

describe("commitCardChecklistChunk insert — a teamless-sport card is born No team", () => {
  test("a golfer with no BSC ref is stamped, credited to the committing operator", async () => {
    const { t, fx } = await seed();
    const before = Date.now();
    const { row } = await born(t, fx, wire("1", { playerIds: [fx.tiger] }), { operatorUserId: OPERATOR });
    expect(row.teamNoneConfirmedAt).toBeGreaterThanOrEqual(before);
    expect(row.teamNoneConfirmedByUserId).toBe(OPERATOR);
    expect(row.teamOnCardIds ?? []).toEqual([]);
    expect(row.pendingTeamNames ?? []).toEqual([]);
    expect(row.bscTeamName).toBeUndefined();
  });

  test("with no operator on the call the stamp is credited to whoever flagged the sport", async () => {
    const { t, fx } = await seed();
    const { row } = await born(t, fx, wire("1", { playerIds: [fx.tiger] }));
    expect(row.teamNoneConfirmedByUserId).toBe(SPORT_SETTER);
  });

  test("the sport is not flagged: nothing is stamped", async () => {
    const { t, fx } = await seed({ golfFlagged: false });
    const { row } = await born(t, fx, wire("1", { playerIds: [fx.tiger] }), { operatorUserId: OPERATOR });
    expect(stamped(row)).toBe(false);
    expect(row.teamNoneConfirmedByUserId).toBeUndefined();
  });

  test.each(["answered", "checklist"] as const)(
    "a BSC ref whose lookup is %s (and names nothing) is stamped",
    async (teamLookup) => {
      const { t, fx } = await seed();
      const { row, out } = await born(
        t,
        fx,
        wire("1", { playerIds: [fx.tiger], platformData: bsc(), teamLookup }),
        { operatorUserId: OPERATOR },
      );
      expect(row.teamNoneConfirmedByUserId).toBe(OPERATOR);
      expect(row.teamCheckDoneAt).toEqual(expect.any(Number));
      expect(row.teamCheckOutcome).toBe(teamLookup);
      expect(out.bscTeamEnrichmentIds).toEqual([]);
    },
  );

  describe("holds: what names a team, or still waits on one, is never stamped over (rule 8)", () => {
    test("a BSC ref with no lookup recorded yet: held, and queued for the background lookup", async () => {
      const { t, fx } = await seed();
      const { row, out } = await born(t, fx, wire("1", { playerIds: [fx.tiger], platformData: bsc() }), {
        operatorUserId: OPERATOR,
      });
      expect(stamped(row)).toBe(false);
      expect(row.teamCheckDoneAt).toBeUndefined();
      expect(out.bscTeamEnrichmentIds).toEqual([row._id]);
    });

    test("a FAILED lookup: held, queued", async () => {
      const { t, fx } = await seed();
      const { row, out } = await born(
        t,
        fx,
        wire("1", { playerIds: [fx.tiger], platformData: bsc(), teamLookup: "failed" }),
        { operatorUserId: OPERATOR },
      );
      expect(stamped(row)).toBe(false);
      expect(out.bscTeamEnrichmentIds).toEqual([row._id]);
    });

    test("an answered lookup that named a team the card could not link (bscTeamName): kept as the hint, no stamp", async () => {
      const { t, fx } = await seed();
      const { row } = await born(
        t,
        fx,
        wire("1", {
          playerIds: [fx.tiger],
          platformData: bsc(),
          teamLookup: "answered",
          teamNames: ["Augusta Nationals"],
          bscTeamHint: "Augusta Nationals",
        }),
        { operatorUserId: OPERATOR },
      );
      expect(row.bscTeamName).toBe("Augusta Nationals");
      expect(stamped(row)).toBe(false);
      expect(row.teamOnCardIds ?? []).toEqual([]);
    });

    test("a malformed 'answered' listing team with no BSC ref is also held", async () => {
      const { t, fx } = await seed();
      const { row } = await born(
        t,
        fx,
        wire("1", { playerIds: [fx.tiger], teamLookup: "answered", bscTeamHint: "Augusta Nationals" }),
        { operatorUserId: OPERATOR },
      );
      expect(row.bscTeamName).toBe("Augusta Nationals");
      expect(stamped(row)).toBe(false);
    });

    test("a team name waiting on review: held", async () => {
      const { t, fx } = await seed();
      const { row } = await born(t, fx, wire("1", { playerIds: [fx.tiger], pendingTeamNames: ["Augusta Nationals"] }), {
        operatorUserId: OPERATOR,
      });
      expect(row.pendingTeamNames).toEqual(["Augusta Nationals"]);
      expect(stamped(row)).toBe(false);
    });

    test("a player name waiting on review: held, even beside a flagged player", async () => {
      const { t, fx } = await seed();
      const { row } = await born(
        t,
        fx,
        wire("1", { playerIds: [fx.tiger], pendingPlayerNames: ["Unknown Golfer"] }),
        { operatorUserId: OPERATOR },
      );
      expect(row.pendingPlayerNames).toEqual(["Unknown Golfer"]);
      expect(stamped(row)).toBe(false);
    });

    test("a card with no player at all: held", async () => {
      const { t, fx } = await seed();
      const { row } = await born(t, fx, wire("1"), { operatorUserId: OPERATOR });
      expect(stamped(row)).toBe(false);
    });

    test("a card whose players come from two sports: held", async () => {
      const { t, fx } = await seed();
      const { row } = await born(t, fx, wire("1", { playerIds: [fx.tiger, fx.mookie] }), {
        operatorUserId: OPERATOR,
      });
      expect(stamped(row)).toBe(false);
    });

    test("a ballplayer who ALSO plays the flagged sport (playerSports) is still a ballplayer: held", async () => {
      const { t, fx } = await seed();
      await t.run(async (ctx) =>
        ctx.db.insert("playerSports", { playerId: fx.mookie, sportId: fx.golf, nameNormalized: "mookie betts" }),
      );
      const { row } = await born(t, fx, wire("1", { playerIds: [fx.mookie] }), { operatorUserId: OPERATOR });
      expect(stamped(row)).toBe(false);
    });

    test("a golfer who ALSO plays an unflagged extra sport is still teamless (home sport only)", async () => {
      const { t, fx } = await seed();
      await t.run(async (ctx) =>
        ctx.db.insert("playerSports", { playerId: fx.tiger, sportId: fx.baseball, nameNormalized: "tiger woods" }),
      );
      const { row } = await born(t, fx, wire("1", { playerIds: [fx.tiger] }), { operatorUserId: OPERATOR });
      expect(stamped(row)).toBe(true);
    });
  });

  test("several golfers on one card are stamped once", async () => {
    const { t, fx } = await seed();
    const { row } = await born(t, fx, wire("1", { playerIds: [fx.tiger, fx.rory] }), { operatorUserId: OPERATOR });
    expect(row.teamNoneConfirmedByUserId).toBe(OPERATOR);
    expect(row.playerIds).toEqual([fx.tiger, fx.rory]);
  });

  test("a mixed chunk decides each card on its own", async () => {
    const { t, fx } = await seed();
    await commit(
      t,
      fx,
      [
        wire("1", { playerIds: [fx.tiger] }),
        wire("2", { playerIds: [fx.mookie] }),
        wire("3", { playerIds: [fx.rory], pendingTeamNames: ["Somewhere"] }),
        wire("4", { playerIds: [fx.rory] }),
      ],
      { operatorUserId: OPERATOR },
    );
    const rows = await cardsOn(t, fx.leaf);
    expect([...rows.values()].map((r) => [r.cardNumber, stamped(r)])).toEqual([
      ["1", true],
      ["2", false],
      ["3", false],
      ["4", true],
    ]);
  });

  test("a team from the card itself wins: the card keeps it and is never stamped", async () => {
    const { t, fx } = await seed();
    const team = await t.run(async (ctx) =>
      ctx.db.insert("teams", { ...teamRowFields({ location: "Augusta", name: "Nationals" }), sportId: fx.golf, lastUpdated: NOW }),
    );
    const { row } = await born(t, fx, wire("1", { playerIds: [fx.tiger], teamOnCardIds: [team] } as never), {
      operatorUserId: OPERATOR,
    });
    expect(row.teamOnCardIds).toEqual([team]);
    expect(stamped(row)).toBe(false);
  });

  test("the set's team X wins: the card is born with X, not No team", async () => {
    const { t, fx } = await seed();
    const team = await t.run(async (ctx) =>
      ctx.db.insert("teams", { ...teamRowFields({ location: "Augusta", name: "Nationals" }), sportId: fx.golf, lastUpdated: NOW }),
    );
    await t.run(async (ctx) => ctx.db.patch(fx.leaf, { teamIds: [team] }));
    const { row } = await born(t, fx, wire("1", { playerIds: [fx.tiger] }), { operatorUserId: OPERATOR });
    expect(row.teamOnCardIds).toEqual([team]);
    expect(stamped(row)).toBe(false);
  });

  test("the set's No Team AND the sport default: exactly one stamp, the operator's, and the leaf's setter when none", async () => {
    const { t, fx } = await seed({ leaf: { noTeamDefault: LEAF_NO_TEAM } });
    await commit(t, fx, [wire("1", { playerIds: [fx.tiger] })], { operatorUserId: OPERATOR });
    await commit(t, fx, [wire("2", { playerIds: [fx.tiger] })]);
    const rows = await cardsOn(t, fx.leaf);
    expect(rows.get("1")!.teamNoneConfirmedByUserId).toBe(OPERATOR);
    // The set's No Team is asked first and vouches; the sport's setter never overrides it.
    expect(rows.get("2")!.teamNoneConfirmedByUserId).toBe(LEAF_SETTER);
    for (const r of rows.values()) {
      expect(r.teamNoneConfirmedAt).toEqual(expect.any(Number));
      expect(r.teamOnCardIds ?? []).toEqual([]);
    }
  });

  test("an operator's own 'No team on this card' answer is a single stamp, not doubled by the sport default", async () => {
    const { t, fx } = await seed();
    const { row } = await born(t, fx, wire("1", { playerIds: [fx.tiger], teamNone: true }), {
      operatorUserId: OPERATOR,
    });
    expect(row.teamNoneConfirmedByUserId).toBe(OPERATOR);
    expect(row.teamNoneConfirmedAt).toEqual(expect.any(Number));
  });

  test("NEO-528: the leaf's default player counts, so a card born with it is stamped", async () => {
    const { t, fx } = await seed();
    await t.run(async (ctx) => ctx.db.patch(fx.set, { defaultPlayerIds: [fx.tiger] }));
    const { row } = await born(t, fx, wire("1"), { operatorUserId: OPERATOR });
    expect(row.playerIds).toEqual([fx.tiger]);
    expect(row.teamNoneConfirmedByUserId).toBe(OPERATOR);
  });

  test("NEO-528: a default player from a sport with teams (dropped by the sport check) leaves the card playerless and unstamped", async () => {
    const { t, fx } = await seed();
    await t.run(async (ctx) => ctx.db.patch(fx.set, { defaultPlayerIds: [fx.mookie] }));
    const { row } = await born(t, fx, wire("1"), { operatorUserId: OPERATOR });
    expect(row.playerIds ?? []).toEqual([]);
    expect(stamped(row)).toBe(false);
  });

  test("NEO-528: a pending player name blocks the default player AND the stamp", async () => {
    const { t, fx } = await seed();
    await t.run(async (ctx) => ctx.db.patch(fx.set, { defaultPlayerIds: [fx.tiger] }));
    const { row } = await born(t, fx, wire("1", { pendingPlayerNames: ["Unknown Golfer"] }), {
      operatorUserId: OPERATOR,
    });
    expect(row.playerIds ?? []).toEqual([]);
    expect(stamped(row)).toBe(false);
  });

  test("no flagged sport anywhere: a chunk of player cards writes no stamp and reads nothing extra (output equals the unflagged baseline)", async () => {
    const { t, fx } = await seed({ golfFlagged: false });
    await commit(t, fx, [wire("1", { playerIds: [fx.tiger] }), wire("2", { playerIds: [fx.rory, fx.mookie] })], {
      operatorUserId: OPERATOR,
    });
    for (const r of (await cardsOn(t, fx.leaf)).values()) {
      expect(r.teamNoneConfirmedAt).toBeUndefined();
      expect(r.teamNoneConfirmedByUserId).toBeUndefined();
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The existing-row (re-sync) branch
// ───────────────────────────────────────────────────────────────────────────

describe("commitCardChecklistChunk re-sync — an existing row is never given the sport default", () => {
  async function existing(t: T, fx: Fx, extra: Partial<Doc<"cardChecklist">> = {}) {
    return t.run(async (ctx) =>
      insertTestCard(ctx, {
        selectorOptionId: fx.leaf,
        cardNumber: "1",
        cardName: "Card 1",
        platformData: {},
        sortOrder: 1,
        lastUpdated: NOW,
        ...extra,
      }),
    );
  }
  const resync = (t: T, fx: Fx, id: Id<"cardChecklist">, extra: Partial<ChunkCard> = {}, operatorUserId = OPERATOR) =>
    commit(t, fx, [wire("1", { existingId: id, ...extra })], { operatorUserId });
  const read = (t: T, id: Id<"cardChecklist">) => t.run(async (ctx) => ctx.db.get(id));
  const teamRow = (t: T, fx: Fx) =>
    t.run(async (ctx) =>
      ctx.db.insert("teams", { ...teamRowFields({ location: "Augusta", name: "Nationals" }), sportId: fx.golf, lastUpdated: NOW }),
    );

  test("a teamless row of golfers is left unstamped, with or without an operator on the call", async () => {
    const { t, fx } = await seed();
    const id = await existing(t, fx, { playerIds: [fx.tiger] });
    await resync(t, fx, id);
    await commit(t, fx, [wire("1", { existingId: id })]);
    const row = (await read(t, id))!;
    expect(stamped(row)).toBe(false);
    expect(row.teamNoneConfirmedByUserId).toBeUndefined();
    expect(row.teamOnCardIds ?? []).toEqual([]);
  });

  // The auditor's cases (rule 8): a team the listing NAMED but the re-sync did
  // not accept must never be answered with "No team".
  test("a team arriving with no applyFields is not accepted, and the row is not stamped", async () => {
    const { t, fx } = await seed();
    const team = await teamRow(t, fx);
    const id = await existing(t, fx, { playerIds: [fx.tiger] });
    const out = await resync(t, fx, id, { teamOnCardIds: [team], teamNames: ["Augusta Nationals"] } as never);
    const row = (await read(t, id))!;
    expect(row.teamOnCardIds ?? []).toEqual([]);
    expect(stamped(row)).toBe(false);
    expect(out.staleDecisionIds).toEqual([]);
  });

  test("a team arriving with a stale baseVersion is not accepted, and the row is not stamped", async () => {
    const { t, fx } = await seed();
    const team = await teamRow(t, fx);
    const id = await existing(t, fx, { playerIds: [fx.tiger] });
    const out = await resync(t, fx, id, {
      teamOnCardIds: [team],
      teamNames: ["Augusta Nationals"],
      applyFields: ["teamOnCardIds"],
      baseVersion: NOW - 1,
    } as never);
    const row = (await read(t, id))!;
    expect(out.staleDecisionIds).toEqual([id]);
    expect(row.teamOnCardIds ?? []).toEqual([]);
    expect(stamped(row)).toBe(false);
  });

  test("a card an operator took out of No team (teamNone: false) stays unstamped through a re-sync", async () => {
    const { t, fx } = await seed();
    const id = await t.withIdentity(ADMIN).mutation(api.selectorOptions.addCustomCard, {
      selectorOptionId: fx.leaf,
      cardNumber: "1",
      cardName: "Card 1",
      playerIds: [fx.tiger],
      teamNone: false,
    });
    expect(stamped((await read(t, id))!)).toBe(false);
    await resync(t, fx, id);
    await resync(t, fx, id, { playerIds: [fx.tiger], applyFields: ["playerIds"], baseVersion: (await read(t, id))!.lastUpdated });
    expect(stamped((await read(t, id))!)).toBe(false);
  });

  test("an existing row matched by number (no ref on either side, then a ref attaching) is not stamped", async () => {
    const { t, fx } = await seed();
    // The action hands a number-matched row to the chunk as `existingId`
    // (`existingIdByNumberNoRef`), the same branch as every other match.
    const id = await existing(t, fx, { playerIds: [fx.tiger] });
    await resync(t, fx, id);
    expect(stamped((await read(t, id))!)).toBe(false);
    await resync(t, fx, id, { platformData: bsc("B9"), teamLookup: "answered" });
    const row = (await read(t, id))!;
    expect(row.platformData.bsc?.ref).toBe("B9");
    expect(stamped(row)).toBe(false);
  });

  test("a row with no player, a ballplayer, a pending name or a BSC lookup in any state: still unstamped", async () => {
    const { t, fx } = await seed();
    const none = await existing(t, fx, {});
    const ball = await existing(t, fx, { cardNumber: "2", playerIds: [fx.mookie] });
    const pending = await existing(t, fx, {
      cardNumber: "3",
      playerIds: [fx.tiger],
      pendingPlayerNames: ["Unknown Golfer"],
    });
    const answered = await existing(t, fx, {
      cardNumber: "4",
      playerIds: [fx.tiger],
      platformData: { bsc: { ref: "B4", src: "b0" } },
      teamCheckDoneAt: 7,
      teamCheckOutcome: "answered",
    });
    await commit(
      t,
      fx,
      [
        wire("1", { existingId: none }),
        wire("2", { existingId: ball }),
        wire("3", { existingId: pending }),
        wire("4", { existingId: answered }),
      ],
      { operatorUserId: OPERATOR, resolvedPlayerNames: ["Unknown Golfer"] },
    );
    for (const id of [none, ball, pending, answered]) expect(stamped((await read(t, id))!)).toBe(false);
  });

  test("an accepted playerIds change to a golfer does not stamp the row either", async () => {
    const { t, fx } = await seed();
    const id = await existing(t, fx, { playerIds: [fx.mookie] });
    await resync(t, fx, id, { playerIds: [fx.tiger], applyFields: ["playerIds"], baseVersion: NOW });
    const row = (await read(t, id))!;
    expect(row.playerIds).toEqual([fx.tiger]);
    expect(stamped(row)).toBe(false);
  });

  test("a row that has a team keeps it", async () => {
    const { t, fx } = await seed();
    const team = await teamRow(t, fx);
    const id = await existing(t, fx, { playerIds: [fx.tiger], teamOnCardIds: [team] });
    await resync(t, fx, id);
    const row = (await read(t, id))!;
    expect(row.teamOnCardIds).toEqual([team]);
    expect(stamped(row)).toBe(false);
  });

  test("a row an operator already ruled keeps its own ruling, byte for byte", async () => {
    const { t, fx } = await seed();
    const id = await existing(t, fx, {
      playerIds: [fx.tiger],
      teamNoneConfirmedAt: 5,
      teamNoneConfirmedByUserId: "operator_earlier",
    });
    await resync(t, fx, id);
    const row = (await read(t, id))!;
    expect(row.teamNoneConfirmedAt).toBe(5);
    expect(row.teamNoneConfirmedByUserId).toBe("operator_earlier");
  });

  test("an accepted team arriving with the sync wins: the row takes it and is not stamped", async () => {
    const { t, fx } = await seed();
    const team = await teamRow(t, fx);
    const id = await existing(t, fx, { playerIds: [fx.tiger] });
    await resync(t, fx, id, { teamOnCardIds: [team], applyFields: ["teamOnCardIds"], baseVersion: NOW } as never);
    const row = (await read(t, id))!;
    expect(row.teamOnCardIds).toEqual([team]);
    expect(stamped(row)).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// addCustomCard
// ───────────────────────────────────────────────────────────────────────────

describe("addCustomCard — a hand-added card of a teamless sport", () => {
  const add = (t: T, fx: Fx, extra: Record<string, unknown> = {}) =>
    t.withIdentity(ADMIN).mutation(api.selectorOptions.addCustomCard, {
      selectorOptionId: fx.leaf,
      cardNumber: "1",
      cardName: "Card 1",
      ...extra,
    });
  const read = (t: T, id: Id<"cardChecklist">) => t.run(async (ctx) => ctx.db.get(id));

  test("a golfer is stamped, credited to the adding admin", async () => {
    const { t, fx } = await seed();
    const row = (await read(t, await add(t, fx, { playerIds: [fx.tiger] })))!;
    expect(row.teamNoneConfirmedByUserId).toBe(ADMIN.subject);
    expect(row.teamNoneConfirmedAt).toEqual(expect.any(Number));
  });

  test("teamNone: false opts this card out", async () => {
    const { t, fx } = await seed();
    const row = (await read(t, await add(t, fx, { playerIds: [fx.tiger], teamNone: false })))!;
    expect(stamped(row)).toBe(false);
  });

  test("typed player names (nobody linked) block it", async () => {
    const { t, fx } = await seed();
    const row = (await read(t, await add(t, fx, { players: ["Unknown Golfer"] })))!;
    expect(row.pendingPlayerNames).toEqual(["Unknown Golfer"]);
    expect(stamped(row)).toBe(false);
  });

  test("no player at all, a ballplayer, and a mixed pair are not stamped", async () => {
    const { t, fx } = await seed();
    expect(stamped((await read(t, await add(t, fx, { cardNumber: "1" })))!)).toBe(false);
    expect(stamped((await read(t, await add(t, fx, { cardNumber: "2", playerIds: [fx.mookie] })))!)).toBe(false);
    expect(
      stamped((await read(t, await add(t, fx, { cardNumber: "3", playerIds: [fx.tiger, fx.mookie] })))!),
    ).toBe(false);
  });

  test("a typed team name, or a picked team, holds it back / wins", async () => {
    const { t, fx } = await seed();
    const team = await t.run(async (ctx) =>
      ctx.db.insert("teams", { ...teamRowFields({ location: "Augusta", name: "Nationals" }), sportId: fx.golf, lastUpdated: NOW }),
    );
    const typed = (await read(t, await add(t, fx, { cardNumber: "1", playerIds: [fx.tiger], teams: ["Augusta Nationals"] })))!;
    expect(typed.pendingTeamNames).toEqual(["Augusta Nationals"]);
    expect(stamped(typed)).toBe(false);
    const picked = (await read(t, await add(t, fx, { cardNumber: "2", playerIds: [fx.tiger], teamOnCardIds: [team] })))!;
    expect(picked.teamOnCardIds).toEqual([team]);
    expect(stamped(picked)).toBe(false);
  });

  test("the sport is not flagged: not stamped", async () => {
    const { t, fx } = await seed({ golfFlagged: false });
    expect(stamped((await read(t, await add(t, fx, { playerIds: [fx.tiger] })))!)).toBe(false);
  });

  test("the leaf's default player counts for a hand-added card", async () => {
    const { t, fx } = await seed();
    await t.run(async (ctx) => ctx.db.patch(fx.set, { defaultPlayerIds: [fx.tiger] }));
    const row = (await read(t, await add(t, fx)))!;
    expect(row.playerIds).toEqual([fx.tiger]);
    expect(stamped(row)).toBe(true);
  });
});
