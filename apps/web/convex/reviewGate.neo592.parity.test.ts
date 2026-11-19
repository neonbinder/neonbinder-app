/**
 * NEO-592 — the review gate's helpers read concurrently and batch their hops,
 * and had to change NOTHING they answer. Each block here pins one helper's
 * answer (values taken from origin/main's behaviour) and, where the point of
 * the change was HOW it reads, a probe on `ctx.db` pins that too
 * (`lib/testing/db-probe.ts`: peak reads in flight, index reads per table).
 *
 * The end-to-end gate, round trips and log line are in
 * `reviewGate.neo592.golden.test.ts`.
 */

import { convexTest } from "convex-test";
import { getFunctionName } from "convex/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import { normalizePlayerName, resolveNamesForReview, sameNamePlayers } from "./players";
import { normalizeTeamName } from "./teams";
import {
  FIND_MANY_TEAMS_BY_NAME_MAX,
  findManyByNameAndSport,
} from "./teams";
import {
  historyPlayersByIds,
  historyTeamsByIds,
  findOnlyNamesakes,
} from "./setHistory";
import { reviewGatePrelude } from "./selectorOptions";
import { playerNamesByIds, buildTitleContext, TITLE_CONTEXT_PLAYER_PAGE } from "./listingTitleContext";
import { readManyByIds, GET_MANY_BY_IDS_MAX } from "./lib/batchIdReads";
import { collectSubtreeNodes } from "./lib/selectorAncestry";
import { cancelScheduled } from "../lib/testing/drain-scheduled";
import { probeDb } from "../lib/testing/db-probe";
import {
  aliasRow,
  committedCard,
  crossList,
  node,
  playerRow,
  product,
  seedGateWorld,
  skipRow,
  teamRow,
} from "../lib/testing/neo592-gate-fixture";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const ADMIN = {
  subject: "admin_neo592_parity_001",
  issuer: "https://clerk.example.com",
  tokenIdentifier: "clerk|admin_neo592_parity_001",
  name: "Admin User",
  role: "admin",
};

type T = ReturnType<typeof convexTest>;
type Sel = Id<"selectorOptions">;

const live: T[] = [];
function newT(): T {
  const t = convexTest(schema, modules);
  live.push(t);
  return t;
}
afterEach(async () => {
  for (const t of live.splice(0)) await cancelScheduled(t);
  vi.restoreAllMocks();
});

/** Run an internal query's handler with a probed `ctx.db`. */
async function probed<R>(
  t: T,
  fn: (ctx: any, probe: ReturnType<typeof probeDb>) => Promise<R>,
): Promise<{ out: R; probe: { stats: ReturnType<typeof probeDb>["stats"] } }> {
  return t.run(async (ctx) => {
    const probe = probeDb(ctx.db);
    const out = await fn({ ...ctx, db: probe.db }, probe);
    return { out, probe: { stats: { ...probe.stats } } };
  });
}

// ─── 1. teams.findManyByNameAndSport ────────────────────────────────────────

describe("teams.findManyByNameAndSport answers exactly what findByNameAndSport answers", () => {
  async function world(t: T) {
    const sportId = await node(t, { level: "sport", value: "Baseball" });
    const redSox = await teamRow(t, sportId, "Boston", "Red Sox", { aliases: ["Bosox"] });
    await t.run((ctx) =>
      ctx.db.insert("teamAliases", {
        teamId: redSox,
        sportId,
        aliasNormalized: normalizeTeamName("Bosox"),
      }),
    );
    const oldJets = await teamRow(t, sportId, "Winnipeg", "Jets", {
      yearsActive: { from: 1972, to: 1996 },
    });
    const newJets = await teamRow(t, sportId, "Winnipeg", "Jets", { yearsActive: { from: 2011 } });
    const earlyBrowns = await teamRow(t, sportId, "St. Louis", "Browns", {
      yearsActive: { from: 1902, to: 1953 },
    });
    const lateBrowns = await teamRow(t, sportId, "St. Louis", "Browns", {
      yearsActive: { from: 1961, to: 1965 },
    });
    const pilots = await teamRow(t, sportId, "Seattle", "Pilots", {
      yearsActive: { from: 1969, to: 1969 },
    });
    return { sportId, redSox, oldJets, newJets, earlyBrowns, lateBrowns, pilots };
  }
  const single = (t: T, sportId: Sel, name: string, setYear?: number) =>
    t.withIdentity(ADMIN).query(api.teams.findByNameAndSport, {
      name,
      sportId,
      ...(setYear !== undefined ? { setYear } : {}),
    });
  const many = (t: T, sportId: Sel, names: string[], setYear?: number) =>
    t.query(internal.teams.findManyByNameAndSport, {
      sportId,
      ...(setYear !== undefined ? { setYear } : {}),
      names,
    });

  test("a unique team resolves and a missing one is null, in input positions", async () => {
    const t = newT();
    const w = await world(t);
    const out = await many(t, w.sportId, ["Nobody Nowhere", "Boston Red Sox"], 2024);
    expect(out.map((row) => row?._id ?? null)).toEqual([null, w.redSox]);
  });

  test("a name two eras share is settled by the set year, and 1990 picks the era that covers it", async () => {
    const t = newT();
    const w = await world(t);
    expect((await many(t, w.sportId, ["Winnipeg Jets"], 2024))[0]?._id).toBe(w.newJets);
    expect((await many(t, w.sportId, ["Winnipeg Jets"], 1990))[0]?._id).toBe(w.oldJets);
  });

  test("a card may show a team's past: the only closed era answers a set year after it", async () => {
    const t = newT();
    const w = await world(t);
    expect((await many(t, w.sportId, ["Seattle Pilots"], 2024))[0]?._id).toBe(w.pilots);
  });

  test("two eras and no set year is null: a tie stays a tie", async () => {
    const t = newT();
    const w = await world(t);
    expect(await many(t, w.sportId, ["Winnipeg Jets", "St. Louis Browns"])).toEqual([null, null]);
  });

  test("two closed eras that both end before the set year stay null", async () => {
    const t = newT();
    const w = await world(t);
    expect(await many(t, w.sportId, ["St. Louis Browns"], 2024)).toEqual([null]);
    expect(w.earlyBrowns).not.toBe(w.lateBrowns);
  });

  test("an alias answers like the primary name", async () => {
    const t = newT();
    const w = await world(t);
    expect((await many(t, w.sportId, ["Bosox"], 2024))[0]?._id).toBe(w.redSox);
  });

  test("a name given twice is answered twice, identically, in both positions", async () => {
    const t = newT();
    const w = await world(t);
    const out = await many(
      t,
      w.sportId,
      ["Boston Red Sox", "Gone Fishing", "Boston Red Sox", "Gone Fishing"],
      2024,
    );
    expect(out[0]).not.toBeNull();
    expect(out[2]).toEqual(out[0]);
    expect(out[1]).toBeNull();
    expect(out[3]).toBeNull();
  });

  test("the answer follows the input order, whatever order the lookups finish in", async () => {
    const t = newT();
    const w = await world(t);
    const names = ["Seattle Pilots", "Winnipeg Jets", "Nope", "Boston Red Sox", "Bosox"];
    const forward = await many(t, w.sportId, names, 2024);
    const backward = await many(t, w.sportId, [...names].reverse(), 2024);
    expect(backward.map((r) => r?._id ?? null)).toEqual(
      forward.map((r) => r?._id ?? null).reverse(),
    );
    expect(forward.map((r) => r?._id ?? null)).toEqual([w.pilots, w.newJets, null, w.redSox, w.redSox]);
  });

  test("every element equals the single call for the same name and year", async () => {
    const t = newT();
    const w = await world(t);
    const names = [
      "Boston Red Sox",
      "Bosox",
      "Winnipeg Jets",
      "St. Louis Browns",
      "Seattle Pilots",
      "Missing Team",
      "",
    ];
    for (const setYear of [undefined, 1960, 1990, 2024]) {
      const batch = await many(t, w.sportId, names, setYear);
      for (let i = 0; i < names.length; i++) {
        expect(batch[i], `${names[i]} @ ${setYear}`).toEqual(
          await single(t, w.sportId, names[i], setYear),
        );
      }
    }
  });

  // `resolveTeamDocForSetYear` returns the winning row out of the candidates
  // `resolveTeamForSetYear` already holds, instead of reading it again. That row
  // must be the stored document, field for field: a candidate that was a trimmed
  // or re-shaped copy would leak straight into the public query and the gate.
  test("the document answered is the stored row of the id it resolved, for every name and year", async () => {
    const t = newT();
    const w = await world(t);
    const names = [
      "Boston Red Sox",
      "Bosox",
      "Winnipeg Jets",
      "St. Louis Browns",
      "Seattle Pilots",
      "Missing Team",
      "",
    ];
    let resolvedCount = 0;
    for (const setYear of [undefined, 1960, 1990, 2024]) {
      for (const name of names) {
        // Goes through convex-test's return validation: the public query's
        // answer must satisfy its `returns` (`teamDocValidator`) or this throws.
        const answered = await single(t, w.sportId, name, setYear);
        if (answered === null) continue;
        resolvedCount++;
        const stored = await t.run((ctx) => ctx.db.get(answered._id));
        expect(answered, `${name} @ ${setYear}`).toEqual(stored);
      }
    }
    // The loop must actually have compared rows, or it proves nothing.
    expect(resolvedCount).toBeGreaterThanOrEqual(8);
    // The batch hands back the same stored rows.
    const batch = await many(t, w.sportId, names, 2024);
    for (const row of batch) {
      if (row === null) continue;
      expect(row).toEqual(await t.run((ctx) => ctx.db.get(row._id)));
    }
  });

  test("an empty list is an empty answer", async () => {
    const t = newT();
    const w = await world(t);
    expect(await many(t, w.sportId, [], 2024)).toEqual([]);
  });

  test("50 names are answered; 51 are refused with too_many_names, never truncated", async () => {
    const t = newT();
    const w = await world(t);
    expect(FIND_MANY_TEAMS_BY_NAME_MAX).toBe(50);
    const fifty = Array.from({ length: 50 }, (_, i) => `Team Number ${i}`);
    expect(await many(t, w.sportId, fifty, 2024)).toHaveLength(50);
    await expect(many(t, w.sportId, [...fifty, "One More"], 2024)).rejects.toMatchObject({
      data: { code: "too_many_names" },
    });
  });

  test("the names are looked up together, not one after another", async () => {
    const t = newT();
    const w = await world(t);
    const { out, probe } = await probed(t, (ctx) =>
      (findManyByNameAndSport as any)._handler(ctx, {
        sportId: w.sportId,
        setYear: 2024,
        names: Array.from({ length: 12 }, () => "Boston Red Sox"),
      }),
    );
    expect(out).toHaveLength(12);
    expect(probe.stats.peak).toBeGreaterThan(1);
  });
});

// ─── 2/3. reviewGatePrelude ─────────────────────────────────────────────────

describe("reviewGatePrelude", () => {
  const prelude = (t: T, selectorOptionId: Sel, sportId: Sel) =>
    t.query(internal.selectorOptions.reviewGatePrelude, { selectorOptionId, sportId });

  test("skip keys are this set's own: both kinds, none from another set", async () => {
    const t = newT();
    const w = await seedGateWorld(t);
    const out = await prelude(t, w.selectorOptionId, w.sportId);
    expect([...(out.skippedKeys ?? [])].sort()).toEqual(
      [
        `player:${normalizePlayerName("Skipped Person")}`,
        `team:${normalizeTeamName("Skipped Team")}`,
        `player:${normalizePlayerName("Dual Name")}`,
      ].sort(),
    );
    const otherSet = await prelude(t, w.ids.other.insert, w.sportId);
    expect(otherSet.skippedKeys).toEqual([`player:${normalizePlayerName("Other Set Skip")}`]);
  });

  test("a set with exactly 300 skip rows lists them all; 301 is null (the prefix read is incomplete)", async () => {
    const t = newT();
    const sportId = await node(t, { level: "sport", value: "Baseball" });
    const p = await product(t, sportId, { year: "2024" });
    for (let i = 0; i < 300; i++) await skipRow(t, p.insert, "player", `Skip Person ${i}`);
    const at300 = await prelude(t, p.insert, sportId);
    expect(at300.skippedKeys).toHaveLength(300);
    await skipRow(t, p.insert, "team", "One Over");
    expect((await prelude(t, p.insert, sportId)).skippedKeys).toBeNull();
  });

  test("the skip rows are one index read whatever the candidate count", async () => {
    const t = newT();
    const sportId = await node(t, { level: "sport", value: "Baseball" });
    const p = await product(t, sportId, { year: "2024" });
    for (let i = 0; i < 40; i++) await skipRow(t, p.insert, "player", `Skip Person ${i}`);
    const { out, probe } = await probed(t, (ctx) =>
      (reviewGatePrelude as any)._handler(ctx, { selectorOptionId: p.insert, sportId }),
    );
    expect(out.skippedKeys).toHaveLength(40);
    expect(probe.stats.byTable.entityReviewSkips).toBe(1);
  });

  test("pending names: home plus guest cards, in compareCardNumbers order, equal to getCardChecklist's", async () => {
    const t = newT();
    const w = await seedGateWorld(t);
    const out = await prelude(t, w.selectorOptionId, w.sportId);
    // Numeric, not lexicographic ("2" before "10"); a home card beats a guest
    // card on the same number ("5"); a name pending on two cards is listed once
    // at its first sight (Amy Early: card 2, not card 10).
    expect(out.pendingPlayerNames).toEqual([
      "Amy Early",
      "Guest Mid",
      "Tie Home",
      "Tie Guest",
      "Zed Late",
    ]);
    expect(out.pendingTeamNames).toEqual([
      "Pending Team A",
      "Pending Team Guest",
      "Pending Team Tie Home",
      "Pending Team Z",
    ]);
    const rows = await t
      .withIdentity(ADMIN)
      .query(api.selectorOptions.getCardChecklist, { selectorOptionId: w.selectorOptionId });
    const viaOldRead = (pick: (r: Doc<"cardChecklist">) => string[] | undefined) => {
      const seen = new Set<string>();
      for (const r of rows) for (const n of pick(r) ?? []) seen.add(n);
      return [...seen];
    };
    expect(out.pendingPlayerNames).toEqual(viaOldRead((r) => r.pendingPlayerNames));
    expect(out.pendingTeamNames).toEqual(viaOldRead((r) => r.pendingTeamNames));
  });

  test("a cross-listing whose home card is gone adds nothing, as before", async () => {
    const t = newT();
    const w = await seedGateWorld(t);
    const gone = await committedCard(t, w.ids.other.insert, "4", {
      pendingPlayerNames: ["Ghost Guest"],
    });
    await crossList(t, gone, w.selectorOptionId);
    await t.run((ctx) => ctx.db.delete(gone));
    const out = await prelude(t, w.selectorOptionId, w.sportId);
    expect(out.pendingPlayerNames).not.toContain("Ghost Guest");
    const rows = await t
      .withIdentity(ADMIN)
      .query(api.selectorOptions.getCardChecklist, { selectorOptionId: w.selectorOptionId });
    expect(out.pendingPlayerNames).toEqual([...new Set(rows.flatMap((r) => r.pendingPlayerNames ?? []))]);
  });

  test("the year, the prior-year product and the label are the shared walks' own answers", async () => {
    const t = newT();
    const w = await seedGateWorld(t);
    const out = await prelude(t, w.selectorOptionId, w.sportId);
    expect(out.setYear).toBe(2024);
    expect(out.setYear).toBe(
      await t.query(internal.selectorOptions.findSetYearForSelectorOptionQuery, {
        selectorOptionId: w.selectorOptionId,
      }),
    );
    expect(out.priorYearProductId).not.toBeNull();
    expect(out.priorYearProductId).toBe(
      await t.query(internal.setHistory.findPriorYearProduct, {
        selectorOptionId: w.selectorOptionId,
      }),
    );
    expect(out.sportLabel).toBe("Baseball");
  });

  test("a set with no year row reports setYear null and no prior product", async () => {
    const t = newT();
    const sportId = await node(t, { level: "sport", value: "Baseball" });
    const set = await node(t, { level: "setName", value: "Orphan", parentId: sportId });
    const out = await prelude(t, set, sportId);
    expect(out.setYear).toBeNull();
    expect(out.priorYearProductId).toBeNull();
    expect(out.sportMatches).toBe(true);
  });

  // ── S2: the sport the browser sent is re-validated ──
  test("the right sport matches and a wrong one does not", async () => {
    const t = newT();
    const w = await seedGateWorld(t);
    expect((await prelude(t, w.selectorOptionId, w.sportId)).sportMatches).toBe(true);
    expect((await prelude(t, w.selectorOptionId, w.ids.football)).sportMatches).toBe(false);
    // A non-sport row is not the sport ancestor either.
    expect((await prelude(t, w.selectorOptionId, w.ids.now.set)).sportMatches).toBe(false);
  });

  test("with nested sport rows the TOPMOST one is the answer, as getAncestorChain's first sport was", async () => {
    const t = newT();
    const outer = await node(t, { level: "sport", value: "Outer" });
    const inner = await node(t, { level: "sport", value: "Inner", parentId: outer });
    const year = await node(t, { level: "year", value: "2024", parentId: inner });
    const chain = await t.withIdentity(ADMIN).query(api.selectorOptions.getAncestorChain, { id: year });
    expect(chain.find((a) => a.level === "sport")?._id).toBe(outer);
    expect((await prelude(t, year, outer)).sportMatches).toBe(true);
    expect((await prelude(t, year, inner)).sportMatches).toBe(false);
  });

  test("a chain with no sport row matches nothing (fails closed)", async () => {
    const t = newT();
    const sportId = await node(t, { level: "sport", value: "Baseball" });
    const orphanRoot = await node(t, { level: "year", value: "2024" });
    const leaf = await node(t, { level: "setName", value: "Orphan", parentId: orphanRoot });
    expect((await prelude(t, leaf, sportId)).sportMatches).toBe(false);
    expect((await prelude(t, leaf, orphanRoot)).sportMatches).toBe(false);
    expect((await prelude(t, leaf, leaf)).sportMatches).toBe(false);
  });
});

// ─── 4. resolveNamesForReview ───────────────────────────────────────────────

describe("resolveNamesForReview: one answer per name, equal to the single-name call", () => {
  test("a mixed slice (unique, ambiguous, alias, unknown, noise, narrowed) answers each name as alone", async () => {
    const t = newT();
    const w = await seedGateWorld(t);
    const { baseball } = w.ids;
    // A name two players share that the card year + team settle.
    const t1 = await teamRow(t, baseball, "Chicago", "Cubs");
    const t2 = await teamRow(t, baseball, "Detroit", "Tigers");
    const young = await playerRow(t, baseball, "Sam Pair", {
      teamYears: [{ teamId: t1, fromYear: 2020, toYear: 2030 }],
    });
    await playerRow(t, baseball, "Sam Pair", {
      teamYears: [{ teamId: t2, fromYear: 2020, toYear: 2030 }],
    });
    const names: Array<{ name: string; cardTeamNames?: string[] }> = [
      { name: "Mike Trout" },
      { name: "Bob Allen" },
      { name: "Ricky Alias" },
      { name: "Nobody Atall" },
      { name: "..." },
      { name: "Sam Pair", cardTeamNames: ["Chicago Cubs"] },
      { name: "Mike Trout" },
    ];
    const batch = await t.query(internal.players.resolveNamesForReview, {
      sportId: baseball,
      cardYear: 2024,
      names,
    });
    expect(batch).toHaveLength(names.length);
    for (let i = 0; i < names.length; i++) {
      const alone = await t.query(internal.players.resolveNameForReview, {
        sportId: baseball,
        cardYear: 2024,
        name: names[i].name,
        ...(names[i].cardTeamNames ? { cardTeamNames: names[i].cardTeamNames } : {}),
      });
      expect(batch[i], names[i].name).toEqual(alone);
    }
    expect(batch[0]).toEqual({ matchCount: 1, playerId: w.ids.trout });
    expect(batch[1]).toMatchObject({ matchCount: 2 });
    expect(batch[1]).not.toHaveProperty("playerId");
    expect(batch[2]).toEqual({ matchCount: 1, playerId: w.ids.vincent });
    expect(batch[3]).toEqual({ matchCount: 0 });
    expect(batch[4]).toEqual({ matchCount: 0 });
    expect(batch[5]).toMatchObject({ matchCount: 2, playerId: young, narrowedByCardYear: true });
    expect(batch[6]).toEqual(batch[0]);
  });

  test("more than 25 names is refused, not cut", async () => {
    const t = newT();
    const w = await seedGateWorld(t);
    await expect(
      t.query(internal.players.resolveNamesForReview, {
        sportId: w.ids.baseball,
        names: Array.from({ length: 26 }, (_, i) => ({ name: `Name ${i}` })),
      }),
    ).rejects.toBeTruthy();
  });

  test("no team cache is shared across names: the 25th name is answered as the first is", async () => {
    // Each name has two same-name players, both covering the card year, and the
    // printed team sits on a PAST stint of one of them, so it takes rule 6b to
    // settle: 16 distinct team reads a name. A cache shared by the slice would
    // hit its 240-read ceiling after 15 names and hand the rest back deferred
    // (no playerId). Fresh per name, all 25 are settled.
    const t = newT();
    const sportId = await node(t, { level: "sport", value: "Baseball" });
    const letters = "abcdefghijklmnopqrstuvwxy";
    const expectedWinner: Record<string, Id<"players">> = {};
    const names: Array<{ name: string; cardTeamNames: string[] }> = [];
    for (let i = 0; i < 25; i++) {
      const tag = letters[i];
      const mk = async (side: string, n: number, from: number, to: number) => {
        const stints = [];
        for (let k = 0; k < n; k++) {
          const teamId = await teamRow(t, sportId, `City ${tag}${side}${from}`, `Team${k}x`);
          stints.push({ teamId, fromYear: from, toYear: to });
        }
        return stints;
      };
      const aStints = [...(await mk("a", 4, 2020, 2030)), ...(await mk("a", 4, 1990, 1995))];
      const bStints = [...(await mk("b", 4, 2020, 2030)), ...(await mk("b", 4, 1990, 1995))];
      const name = `Probe Namer ${tag.repeat(3)}`;
      await playerRow(t, sportId, name, { teamYears: aStints });
      const b = await playerRow(t, sportId, name, { teamYears: bStints });
      const lastTeam = (await t.run((ctx) => ctx.db.get(bStints[7].teamId)))!;
      expectedWinner[name] = b;
      names.push({ name, cardTeamNames: [`${lastTeam.location} ${lastTeam.name}`] });
    }
    const batch = await t.query(internal.players.resolveNamesForReview, {
      sportId,
      cardYear: 2024,
      names,
    });
    for (let i = 0; i < names.length; i++) {
      const alone = await t.query(internal.players.resolveNameForReview, {
        sportId,
        cardYear: 2024,
        name: names[i].name,
        cardTeamNames: names[i].cardTeamNames,
      });
      expect(alone, `alone ${i}`).toMatchObject({
        playerId: expectedWinner[names[i].name],
        narrowedBy: "careerTeam",
      });
      expect(batch[i], `batch ${i}`).toEqual(alone);
    }
  });

  test("the slice's names are read together", async () => {
    const t = newT();
    const w = await seedGateWorld(t);
    const { out, probe } = await probed(t, (ctx) =>
      (resolveNamesForReview as any)._handler(ctx, {
        sportId: w.ids.baseball,
        names: [
          { name: "Mike Trout" },
          { name: "Bob Allen" },
          { name: "Ricky Alias" },
          { name: "Nobody Atall" },
        ],
      }),
    );
    expect(out).toHaveLength(4);
    expect(probe.stats.peak).toBeGreaterThan(3);
  });
});

// ─── 5. sameNamePlayers ─────────────────────────────────────────────────────

describe("sameNamePlayers: byName, then members, then aliases, each deduped", () => {
  test("the merged order is unchanged with the same player on several legs", async () => {
    const t = newT();
    const baseball = await node(t, { level: "sport", value: "Baseball" });
    const football = await node(t, { level: "sport", value: "Football" });
    const name = "Casey Merge";
    const norm = normalizePlayerName(name);
    const byName1 = await playerRow(t, baseball, name);
    const byName2 = await playerRow(t, baseball, name);
    const member = await playerRow(t, football, name);
    const aliased = await playerRow(t, football, "Someone Else Entirely");
    // Duplicates across legs: byName1 is also a member and an alias; member is
    // also an alias; the alias row of `aliased` is the only new one.
    await t.run(async (ctx) => {
      for (const p of [byName1, member]) {
        await ctx.db.insert("playerSports", { playerId: p, sportId: baseball, nameNormalized: norm });
      }
    });
    await aliasRow(t, byName1, baseball, name);
    await aliasRow(t, byName2, baseball, name);
    await aliasRow(t, member, baseball, name);
    await aliasRow(t, aliased, baseball, name);

    const { out, probe } = await probed(t, (ctx) => sameNamePlayers(ctx, norm, baseball));
    expect(out.map((p) => p._id)).toEqual([byName1, byName2, member, aliased]);
    // The three index reads go out together (a fourth+ are the gets).
    expect(probe.stats.peak).toBeGreaterThanOrEqual(3);
  });

  test("a stale member row (player gone or renamed) and a stale alias row add nothing", async () => {
    const t = newT();
    const baseball = await node(t, { level: "sport", value: "Baseball" });
    const name = "Casey Stale";
    const norm = normalizePlayerName(name);
    const real = await playerRow(t, baseball, name);
    const gone = await playerRow(t, baseball, "Temp Gone");
    const drifted = await playerRow(t, baseball, "Drifted Name");
    await t.run(async (ctx) => {
      await ctx.db.insert("playerSports", { playerId: gone, sportId: baseball, nameNormalized: norm });
      await ctx.db.insert("playerSports", { playerId: drifted, sportId: baseball, nameNormalized: norm });
    });
    await aliasRow(t, gone, baseball, name);
    await t.run((ctx) => ctx.db.delete(gone));
    const out = await t.run((ctx) => sameNamePlayers(ctx, norm, baseball));
    expect(out.map((p) => p._id)).toEqual([real]);
  });
});

// ─── 6. setHistory readers ──────────────────────────────────────────────────

describe("setHistory readers keep order, dedupe and drop dangling ids", () => {
  test("historyPlayersByIds: distinct ids in first-seen order, one sport read per sport", async () => {
    const t = newT();
    const baseball = await node(t, { level: "sport", value: "Baseball" });
    const football = await node(t, { level: "sport", value: "Football" });
    const hockey = await node(t, { level: "sport", value: "Hockey" });
    const a = await playerRow(t, football, "Pa One", { aliases: ["Alias Pa"] });
    const b = await playerRow(t, baseball, "Pb Two");
    const c = await playerRow(t, football, "Pc Three");
    const d = await playerRow(t, hockey, "Pd Four");
    const e = await playerRow(t, baseball, "Pe Five");
    const gone = await playerRow(t, baseball, "Pf Gone");
    await t.run((ctx) => ctx.db.delete(gone));
    const ids = [c, a, gone, b, a, d, c, e];
    const { out, probe } = await probed(t, (ctx) =>
      (historyPlayersByIds as any)._handler(ctx, { playerIds: ids }),
    );
    expect(out.map((r: any) => r.playerId)).toEqual([c, a, b, d, e]);
    expect(out.map((r: any) => r.sportValue)).toEqual([
      "Football",
      "Football",
      "Baseball",
      "Hockey",
      "Baseball",
    ]);
    expect(out[1].nameNormalized).toBe(normalizePlayerName("Pa One"));
    // 6 distinct players read (the dangling one included) + 3 sports, once each
    // even though the reads run side by side.
    expect(probe.stats.gets).toBe(6 + 3);
    expect(probe.stats.peak).toBeGreaterThan(1);
  });

  test("historyTeamsByIds: distinct ids in first-seen order, dangling ids left out", async () => {
    const t = newT();
    const sportId = await node(t, { level: "sport", value: "Baseball" });
    const x = await teamRow(t, sportId, "Boston", "Red Sox", { aliases: ["Bosox"] });
    const y = await teamRow(t, sportId, "Chicago", "Cubs");
    const z = await teamRow(t, sportId, "Gone", "Away");
    await t.run((ctx) => ctx.db.delete(z));
    const out = await t.query(internal.setHistory.historyTeamsByIds, {
      teamIds: [y, x, z, y, x],
    });
    expect(out.map((r) => r.teamId)).toEqual([y, x]);
    expect(out[1].fullName).toBe("Boston Red Sox");
    expect([...out[1].keys].sort()).toEqual(
      [...new Set(["boston red sox", "red sox", "bosox"].map((k) => normalizeTeamName(k)))].sort(),
    );
    const { probe } = await probed(t, (ctx) =>
      (historyTeamsByIds as any)._handler(ctx, { teamIds: [y, x, y, x] }),
    );
    expect(probe.stats.gets).toBe(2);
  });

  test("findOnlyNamesakes: distinct names in order; none, several and an unlabelled sport are left out", async () => {
    const t = newT();
    const baseball = await node(t, { level: "sport", value: "Baseball" });
    const football = await node(t, { level: "sport", value: "Football" });
    const hockey = await node(t, { level: "sport", value: "Hockey" });
    const unlabelled = await node(t, { level: "sport", value: "" });
    const lone1 = await playerRow(t, football, "Lone Gridder");
    const lone2 = await playerRow(t, football, "Other Gridder");
    await playerRow(t, football, "Twin Name");
    await playerRow(t, hockey, "Twin Name");
    await playerRow(t, unlabelled, "No Label Guy");
    const lone3 = await playerRow(t, hockey, "Puck Solo");
    const names = [
      normalizePlayerName("Other Gridder"),
      normalizePlayerName("Twin Name"),
      normalizePlayerName("Lone Gridder"),
      normalizePlayerName("Nobody Here"),
      normalizePlayerName("No Label Guy"),
      normalizePlayerName("Lone Gridder"),
      normalizePlayerName("Puck Solo"),
    ];
    const out = await t.query(internal.setHistory.findOnlyNamesakes, { names });
    expect(out.map((r) => [r.nameNormalized, r.playerId, r.sportValue])).toEqual([
      [normalizePlayerName("Other Gridder"), lone2, "Football"],
      [normalizePlayerName("Lone Gridder"), lone1, "Football"],
      [normalizePlayerName("Puck Solo"), lone3, "Hockey"],
    ]);
    expect(baseball).toBeTruthy();
    const { probe } = await probed(t, (ctx) =>
      (findOnlyNamesakes as any)._handler(ctx, { names: names.slice(0, 3) }),
    );
    expect(probe.stats.peak).toBeGreaterThan(1);
  });
});

// ─── 7. title-context reads, readManyByIds, collectSubtreeNodes ─────────────

describe("playerNamesByIds, buildTitleContext, readManyByIds, collectSubtreeNodes", () => {
  async function manyPlayers(t: T, n: number, prefix: string) {
    const sportId = await node(t, { level: "sport", value: "Baseball" });
    const ids: Id<"players">[] = [];
    await t.run(async (ctx) => {
      for (let i = 0; i < n; i++) {
        ids.push(
          await ctx.db.insert("players", {
            name: `${prefix} ${i}`,
            nameNormalized: normalizePlayerName(`${prefix} ${i}`),
            sportId,
            lastUpdated: 1,
          }),
        );
      }
    });
    return { sportId, ids };
  }

  test("playerNamesByIds keeps input order, drops dangling ids, reads in parallel (<=16)", async () => {
    const t = newT();
    const { ids } = await manyPlayers(t, 40, "Name Row");
    await t.run((ctx) => ctx.db.delete(ids[3]));
    const asked = [ids[5], ids[3], ids[0], ids[39], ids[1]];
    const { out, probe } = await probed(t, (ctx) =>
      (playerNamesByIds as any)._handler(ctx, { ids: asked }),
    );
    expect(out).toEqual([
      { id: ids[5], name: "Name Row 5" },
      { id: ids[0], name: "Name Row 0" },
      { id: ids[39], name: "Name Row 39" },
      { id: ids[1], name: "Name Row 1" },
    ]);
    const big = await probed(t, (ctx) =>
      (playerNamesByIds as any)._handler(ctx, { ids: ids.filter((_, i) => i !== 3) }),
    );
    expect(big.out).toHaveLength(39);
    expect(big.probe.stats.peak).toBeGreaterThan(1);
    expect(big.probe.stats.peak).toBeLessThanOrEqual(16);
    expect(probe.stats.gets).toBe(5);
  });

  test("playerNamesByIds takes a full page of 200 and refuses 201", async () => {
    const t = newT();
    const { ids } = await manyPlayers(t, 201, "Page Row");
    expect(TITLE_CONTEXT_PLAYER_PAGE).toBe(200);
    expect(
      await t.query(internal.listingTitleContext.playerNamesByIds, { ids: ids.slice(0, 200) }),
    ).toHaveLength(200);
    await expect(
      t.query(internal.listingTitleContext.playerNamesByIds, { ids }),
    ).rejects.toThrow(/exceeds/);
  });

  test("buildTitleContext pages 450 players in 200s and merges every page in order", async () => {
    const t = newT();
    const w = await seedGateWorld(t);
    const { ids } = await manyPlayers(t, 450, "Title Person");
    const resolved = { playerIdByNorm: new Map<string, Id<"players">>(), teamNameByNorm: new Map<string, string>(), teamIdByNorm: new Map<string, Id<"teams">>() };
    const cards: Array<{ players: string[]; teams: string[] }> = [];
    for (let i = 0; i < 450; i++) {
      const printed = `Title Person ${i}`;
      resolved.playerIdByNorm.set(normalizePlayerName(printed), ids[i]);
      cards.push({ players: [printed], teams: i % 100 === 0 ? ["Boston Red Sox"] : [] });
    }
    // A printed spelling the gate resolved to a player that no longer exists,
    // and a team spelling it never resolved: both are simply absent.
    const ghost = await t.run(async (ctx) => {
      const id = await ctx.db.insert("players", {
        name: "Ghost Person",
        nameNormalized: normalizePlayerName("Ghost Person"),
        sportId: w.sportId,
        lastUpdated: 1,
      });
      await ctx.db.delete(id);
      return id;
    });
    resolved.playerIdByNorm.set(normalizePlayerName("Ghost Person"), ghost);
    resolved.teamNameByNorm.set(normalizeTeamName("Boston Red Sox"), "Boston Red Sox");
    cards.push({ players: ["Ghost Person", "Title Person 7"], teams: ["Unresolved Team"] });

    const calls: string[] = [];
    const ctx = {
      runQuery: (ref: any, args: any) => {
        calls.push(getFunctionName(ref));
        return t.query(ref, args);
      },
    };
    const out = await buildTitleContext(ctx as any, {
      selectorOptionId: w.selectorOptionId,
      sportId: w.sportId,
      cards,
      resolved,
    });
    expect(calls).toHaveLength(1 + 3);
    expect(out.players).toHaveLength(450);
    expect(out.players[0]).toEqual({ printed: "Title Person 0", name: "Title Person 0" });
    expect(out.players[449]).toEqual({ printed: "Title Person 449", name: "Title Person 449" });
    expect(out.players.map((p) => p.printed)).toEqual(
      Array.from({ length: 450 }, (_, i) => `Title Person ${i}`),
    );
    expect(out.teams).toEqual([{ printed: "Boston Red Sox", name: "Boston Red Sox" }]);
    expect(out.sportValue).toBe("Baseball");
  });

  describe("buildTitleContext when one of its reads fails", () => {
    /** 450 resolved players = pages of 200, 200 and 50; no database needed. */
    const ids = Array.from({ length: 450 }, (_, i) => `player-${i}` as unknown as Id<"players">);
    const resolved = {
      playerIdByNorm: new Map<string, Id<"players">>(
        ids.map((id, i) => [normalizePlayerName(`Title Person ${i}`), id]),
      ),
      teamNameByNorm: new Map<string, string>(),
      teamIdByNorm: new Map<string, Id<"teams">>(),
    };
    const cards = ids.map((_, i) => ({ players: [`Title Person ${i}`], teams: [] as string[] }));

    /**
     * A runQuery double that answers the two title reads and fails chosen ones.
     * `pageFault` is the 1-based page that fails, `factsFault` the set facts.
     * Each failing call rejects after its delay; `settled` lists who finished.
     */
    function fakeCtx(opts: {
      pageFault?: { page: number; delayMs: number };
      factsFault?: { delayMs: number };
    }) {
      const started: string[] = [];
      const settled: string[] = [];
      let pageCalls = 0;
      const later = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      const runQuery = async (ref: any, args: any) => {
        const name = getFunctionName(ref);
        if (name.endsWith("titleSetFacts")) {
          started.push("facts");
          if (opts.factsFault) {
            await later(opts.factsFault.delayMs);
            settled.push("facts");
            throw new Error("facts failed");
          }
          settled.push("facts");
          return { sportValue: "Baseball", setTeamNames: [] };
        }
        const page = ++pageCalls;
        started.push(`page${page}`);
        await later(page === opts.pageFault?.page ? opts.pageFault.delayMs : 5);
        settled.push(`page${page}`);
        if (page === opts.pageFault?.page) throw new Error(`page ${page} failed`);
        return (args.ids as string[]).map((id) => ({ id, name: `named ${id}` }));
      };
      return { ctx: { runQuery } as any, started, settled };
    }

    const ask = (ctx: any) =>
      buildTitleContext(ctx, {
        selectorOptionId: "set" as unknown as Sel,
        sportId: "sport" as unknown as Sel,
        cards,
        resolved,
      });

    function watchUnhandled() {
      const seen: unknown[] = [];
      const onReject = (reason: unknown) => seen.push(reason);
      process.on("unhandledRejection", onReject);
      return { seen, stop: () => process.off("unhandledRejection", onReject) };
    }

    test("a failing middle page rejects with that page's error after the other reads have settled", async () => {
      const { ctx, started, settled } = fakeCtx({ pageFault: { page: 2, delayMs: 1 } });
      const watch = watchUnhandled();
      try {
        await expect(ask(ctx)).rejects.toThrow("page 2 failed");
        // The facts read and all three pages were in flight together; the
        // slower siblings finished before the caller saw the error.
        expect(started.sort()).toEqual(["facts", "page1", "page2", "page3"]);
        expect(settled.sort()).toEqual(["facts", "page1", "page2", "page3"]);
        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(watch.seen).toEqual([]);
      } finally {
        watch.stop();
      }
    });

    test("a failing set-facts read rejects with its error and a failing page is not left unhandled", async () => {
      const { ctx, settled } = fakeCtx({
        factsFault: { delayMs: 1 },
        pageFault: { page: 3, delayMs: 25 },
      });
      const watch = watchUnhandled();
      try {
        // Facts is the first argument, so its error wins although the page's
        // would have been thrown later in time; the slow page settled first.
        await expect(ask(ctx)).rejects.toThrow("facts failed");
        expect(settled).toContain("page3");
        await new Promise((resolve) => setTimeout(resolve, 40));
        expect(watch.seen).toEqual([]);
      } finally {
        watch.stop();
      }
    });

    test("no read failing gives the context the fakes describe (control for the two above)", async () => {
      const { ctx } = fakeCtx({});
      const out = await ask(ctx);
      expect(out.players).toHaveLength(450);
      expect(out.players[449]).toEqual({ printed: "Title Person 449", name: "named player-449" });
    });
  });

  test("readManyByIds: distinct, input-ordered, dangling dropped, cut at 768 with a count-only warning", async () => {
    const t = newT();
    const { ids } = await manyPlayers(t, 800, "Bulk Row");
    await t.run((ctx) => ctx.db.delete(ids[10]));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const asked = [ids[3], ids[1], ids[3], ids[10], ...ids.slice(11)];
    const { out, probe } = await probed(t, (ctx) => readManyByIds(ctx, "probe", asked as any));
    // distinct = 2 + 1 dangling + 759 ... window is the first 768 DISTINCT ids
    const distinct = [...new Set(asked)];
    const expectedWindow = distinct.slice(0, GET_MANY_BY_IDS_MAX).filter((id) => id !== ids[10]);
    expect(out.map((r: any) => r._id)).toEqual(expectedWindow);
    expect(distinct.length).toBeGreaterThan(GET_MANY_BY_IDS_MAX);
    expect(probe.stats.gets).toBe(GET_MANY_BY_IDS_MAX);
    expect(probe.stats.peak).toBeGreaterThan(1);
    expect(probe.stats.peak).toBeLessThanOrEqual(16);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0][0]);
    expect(line).toContain(`asked for ${distinct.length} distinct ids`);
    for (const id of ids.slice(0, 5)) expect(line).not.toContain(id);
  });

  describe("collectSubtreeNodes (pinned for the S1 follow-up: node list, order, truncation)", () => {
    /** The FIFO walk it replaced, over a plain JS tree. */
    function reference(
      rows: Array<{ _id: string; level: string; parentId?: string }>,
      rootId: string,
      maxNodes: number,
    ) {
      const root = rows.find((r) => r._id === rootId)!;
      const nodes = [{ _id: root._id, level: root.level }];
      const seen = new Set([rootId]);
      const frontier = [nodes[0]];
      while (frontier.length > 0) {
        const parent = frontier.shift()!;
        if (parent.level === "parallel") continue;
        const children = rows.filter((r) => r.parentId === parent._id).slice(0, maxNodes + 1);
        for (const child of children) {
          if (seen.has(child._id)) continue;
          seen.add(child._id);
          if (nodes.length >= maxNodes) return { nodes, truncated: true };
          const n = { _id: child._id, level: child.level };
          nodes.push(n);
          frontier.push(n);
        }
      }
      return { nodes, truncated: false };
    }

    async function tree(t: T) {
      const sportId = await node(t, { level: "sport", value: "Baseball" });
      const set = await node(t, { level: "setName", value: "Deep Set", parentId: sportId });
      const rows: Array<{ _id: string; level: string; parentId?: string }> = [];
      await t.run(async (ctx) => {
        const add = async (level: string, value: string, parentId: Sel) => {
          const id = await ctx.db.insert("selectorOptions", {
            level,
            value,
            parentId,
            platformData: {},
            children: [],
            lastUpdated: 1,
          });
          rows.push({ _id: id, level, parentId });
          return id;
        };
        // 4 variant types x 4 inserts x 3 parallels, and the parallels carry
        // children of their own (never expanded).
        for (let v = 0; v < 4; v++) {
          const vt = await add("variantType", `Type ${v}`, set);
          for (let i = 0; i < 4; i++) {
            const ins = await add("variantType", `Insert ${v}.${i}`, vt);
            for (let p = 0; p < 3; p++) {
              const par = await add("parallel", `Parallel ${v}.${i}.${p}`, ins);
              await add("parallel", `Below ${v}.${i}.${p}`, par);
            }
          }
        }
      });
      const all = await t.run(async (ctx) =>
        (await ctx.db.query("selectorOptions").collect()).map((r) => ({
          _id: r._id as string,
          level: r.level ?? "",
          parentId: r.parentId as string | undefined,
        })),
      );
      return { set, all, rows };
    }

    test("the whole subtree comes back breadth-first, parallels listed but never expanded", async () => {
      const t = newT();
      const { set, all } = await tree(t);
      const got = await t.run((ctx) => collectSubtreeNodes(ctx, set, 10_000));
      const expected = reference(all, set, 10_000);
      expect(got.truncated).toBe(false);
      expect(got.nodes).toEqual(expected.nodes);
      // 1 set + 4 types + 16 inserts + 48 parallels; the 48 "Below" rows hang
      // under parallels and are not reached.
      expect(got.nodes).toHaveLength(1 + 4 + 16 + 48);
      expect(got.nodes.slice(0, 5).map((n) => n.level)).toEqual([
        "setName",
        "variantType",
        "variantType",
        "variantType",
        "variantType",
      ]);
    });

    test("every cap from 1 to the subtree size truncates at the same node as the one-at-a-time walk", async () => {
      const t = newT();
      const { set, all } = await tree(t);
      const size = 1 + 4 + 16 + 48;
      for (let cap = 1; cap <= size + 1; cap++) {
        const got = await t.run((ctx) => collectSubtreeNodes(ctx, set, cap));
        const expected = reference(all, set, cap);
        expect(got, `cap ${cap}`).toEqual(expected);
        expect(got.truncated, `cap ${cap}`).toBe(cap < size);
        expect(got.nodes.length).toBeLessThanOrEqual(cap);
      }
    });

    /** A set with `types` variant types, each holding `perType` inserts. */
    async function wideTree(t: T, types: number, perType: number) {
      const sportId = await node(t, { level: "sport", value: "Baseball" });
      const set = await node(t, { level: "setName", value: "Wide Set", parentId: sportId });
      await t.run(async (ctx) => {
        for (let v = 0; v < types; v++) {
          const vt = await ctx.db.insert("selectorOptions", {
            level: "variantType",
            value: `Type ${v}`,
            parentId: set,
            platformData: {},
            children: [],
            lastUpdated: 1,
          });
          for (let i = 0; i < perType; i++) {
            await ctx.db.insert("selectorOptions", {
              level: "parallel",
              value: `Parallel ${v}.${i}`,
              parentId: vt,
              platformData: {},
              children: [],
              lastUpdated: 1,
            });
          }
        }
      });
      const all = await t.run(async (ctx) =>
        (await ctx.db.query("selectorOptions").collect()).map((r) => ({
          _id: r._id as string,
          level: r.level ?? "",
          parentId: r.parentId as string | undefined,
        })),
      );
      return { set, all };
    }

    test("a level far wider than the cap stops at the chunk that crosses it: reads stay near the cap, not width x cap", async () => {
      const t = newT();
      const types = 40;
      const perType = 30;
      const cap = 60;
      const { set, all } = await wideTree(t, types, perType);
      const { out, probe } = await probed(t, (ctx) => collectSubtreeNodes(ctx, set, cap));
      expect(out).toEqual(reference(all, set, cap));
      expect(out.truncated).toBe(true);
      expect(out.nodes).toHaveLength(cap);
      // The root, the 40 types, then ONE chunk of 16 types each read at the
      // room the cap had left (60 - 41 = 19, +1 to prove the overflow, +1 for
      // a cycle's root). The level-parallel walk before this fix read all 40
      // types at 61 rows each: 1 + 40 + 40 x 30 = 1241 documents.
      const remaining = cap - (1 + types);
      const bound = 1 + types + 16 * (remaining + 2);
      expect(probe.stats.docs).toBeLessThanOrEqual(bound);
      // 1 root get, 1 range for the set's types, then one chunk of 16.
      expect(probe.stats.byTable.selectorOptions).toBe(1 + 16);
      expect(probe.stats.gets).toBe(1);
    });

    test("a wide level gives the one-at-a-time node list and truncation point at every chunk edge", async () => {
      const t = newT();
      const types = 40;
      const perType = 30;
      const { set, all } = await wideTree(t, types, perType);
      const size = 1 + types + types * perType;
      const chunkEdge = 1 + types + 16 * perType;
      const caps = [
        1, 2, types, types + 1, types + 2, types + 31, types + 32,
        chunkEdge - 1, chunkEdge, chunkEdge + 1, chunkEdge + perType,
        2 * chunkEdge, size - 1, size, size + 1,
      ];
      for (const cap of caps) {
        const got = await t.run((ctx) => collectSubtreeNodes(ctx, set, cap));
        const expected = reference(all, set, cap);
        expect(got, `cap ${cap}`).toEqual(expected);
        expect(got.truncated, `cap ${cap}`).toBe(cap < size);
      }
    });

    // The wide fixture above is wide at its FIRST level only. Here the first level
    // is narrow and the SECOND holds 42 expandable nodes (more than one chunk of
    // 16, three chunks in all), each with two children, so the cap can land
    // inside a later chunk of a level that is not the root's.
    test("a wide SECOND level read in chunks truncates at the one-at-a-time walk's node at every cap", async () => {
      const t = newT();
      const sportId = await node(t, { level: "sport", value: "Baseball" });
      const set = await node(t, { level: "setName", value: "Nested Wide", parentId: sportId });
      await t.run(async (ctx) => {
        const add = (level: string, value: string, parentId: Sel) =>
          ctx.db.insert("selectorOptions", {
            level,
            value,
            parentId,
            platformData: {},
            children: [],
            lastUpdated: 1,
          });
        for (let v = 0; v < 3; v++) {
          const vt = await add("variantType", `Type ${v}`, set);
          for (let i = 0; i < 14; i++) {
            const ins = await add("variantType", `Insert ${v}.${i}`, vt);
            for (let p = 0; p < 2; p++) await add("parallel", `Parallel ${v}.${i}.${p}`, ins);
          }
        }
      });
      const all = await t.run(async (ctx) =>
        (await ctx.db.query("selectorOptions").collect()).map((r) => ({
          _id: r._id as string,
          level: r.level ?? "",
          parentId: r.parentId as string | undefined,
        })),
      );
      const size = 1 + 3 + 42 + 84;
      // Every cap from the root to the end, so each chunk edge (16, 32, 42
      // expandable inserts in) and every mid-chunk position is hit.
      for (let cap = 1; cap <= size + 1; cap++) {
        const got = await t.run((ctx) => collectSubtreeNodes(ctx, set, cap));
        expect(got, `cap ${cap}`).toEqual(reference(all, set, cap));
        expect(got.truncated, `cap ${cap}`).toBe(cap < size);
      }
    });

    test("a parentId cycle that hands the root back as a child is skipped, and the cap still counts only new rows", async () => {
      const t = newT();
      // set -> insert -> 3 parallels, and the set is re-pointed at the insert,
      // so the insert's range lists the (already seen) set FIRST, before its
      // three parallels. One read short of the room (`remaining + 1`) would
      // spend a slot on the set and never see the third parallel.
      const sportId = await node(t, { level: "sport", value: "Baseball" });
      const set = await node(t, { level: "setName", value: "Loop Set", parentId: sportId });
      const insert = await node(t, { level: "variantType", value: "Loop Insert", parentId: set });
      for (let i = 0; i < 3; i++) {
        await node(t, { level: "parallel", value: `Loop Parallel ${i}`, parentId: insert });
      }
      await t.run((ctx) => ctx.db.patch(set, { parentId: insert }));
      const all = await t.run(async (ctx) =>
        (await ctx.db.query("selectorOptions").collect()).map((r) => ({
          _id: r._id as string,
          level: r.level ?? "",
          parentId: r.parentId as string | undefined,
        })),
      );
      for (let cap = 1; cap <= 7; cap++) {
        const got = await t.run((ctx) => collectSubtreeNodes(ctx, set, cap));
        expect(got, `cap ${cap}`).toEqual(reference(all, set, cap));
        expect(got.truncated, `cap ${cap}`).toBe(cap < 5);
      }
    });

    test("a root that does not exist is an empty, untruncated answer", async () => {
      const t = newT();
      const { set } = await tree(t);
      await t.run((ctx) => ctx.db.delete(set));
      expect(await t.run((ctx) => collectSubtreeNodes(ctx, set, 10))).toEqual({
        nodes: [],
        truncated: false,
      });
    });
  });
});
