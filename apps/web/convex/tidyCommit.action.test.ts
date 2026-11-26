/**
 * NEO-645 / NEO-656 — what `commitCardChecklist` stores for the Tidy Up walk,
 * through the real action (prelude, chunk, finalize):
 *
 *   - the names it leaves pending on the card, in printed order, and none for an
 *     exact single match (the card is the only record of its names);
 *   - `sourceDisagreements`: stored on a NEW row, the field holding nothing
 *     while unsettled, never re-derived on a re-sync (D4), and a payload over
 *     4096 bytes refuses the commit and names the card by NB's own number;
 *   - `sourceNumbers`, stored on a new row;
 *   - no stored career check: a career gap is read LIVE (`careerCoverage.careerGaps`)
 *     with today's rule (`careerCoversCardTeam`), never on a multi-player card;
 *   - the team fill: the batch tier (the player's team on other cards), blocked
 *     by a source-named team (rule 8), with no note stored.
 *
 * The chunk's own branches are in `tidyCommit.chunk.test.ts`.
 */

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import { cancelScheduled, drainScheduled } from "../lib/testing/drain-scheduled";
import { deriveCardAttention } from "./features/cardAttention";
import {
  addPlayer,
  seedTidyWorld,
  type TidyWorld,
} from "../lib/testing/tidy-world";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const ADMIN = { subject: "admin_tidy_commit_001", role: "admin" };
type T = ReturnType<typeof convexTest>;

beforeEach(() => {
  vi.stubGlobal("fetch", (async (url: string | URL) => {
    throw new Error(`this test file must not reach the network: ${String(url)}`);
  }) as unknown as typeof fetch);
});
const live: T[] = [];
const newT = () => {
  const t = convexTest(schema, modules);
  live.push(t);
  return t;
};
afterEach(async () => {
  for (const t of live.splice(0)) {
    await drainScheduled(t);
    await cancelScheduled(t);
  }
  vi.unstubAllGlobals();
});

const wire = (cardNumber: string, extra: Record<string, unknown> = {}) => ({
  cardNumber,
  cardName: `Card ${cardNumber}`,
  team: undefined,
  teams: [] as string[],
  players: [] as string[],
  attributes: [],
  isRookie: false,
  isRelic: false,
  printRun: undefined,
  autographType: undefined,
  cardVariation: undefined,
  platformData: { bsc: { ref: `ref-${cardNumber}` } } as Record<string, unknown>,
  unmatched: undefined,
  ...extra,
});

const commit = (t: T, w: TidyWorld, cards: Array<ReturnType<typeof wire>>) =>
  t.withIdentity(ADMIN).action(api.selectorOptions.commitCardChecklist, {
    selectorOptionId: w.base,
    sportId: w.sport,
    cards: cards as never,
  });

const rows = (t: T, leaf: Id<"selectorOptions">) =>
  t.run((ctx) =>
    ctx.db
      .query("cardChecklist")
      .withIndex("by_selector_option", (q) => q.eq("selectorOptionId", leaf))
      .collect(),
  );
const byNumber = async (t: T, leaf: Id<"selectorOptions">) =>
  new Map((await rows(t, leaf)).map((r) => [r.cardNumber, r]));
const JUDGE = "Aaron Judge";
const SOTO = "Juan Soto";
const NOBODY = "Zed Nobody";

async function world(t: T) {
  return t.run(async (ctx) => {
    const w = await seedTidyWorld(ctx);
    const judge = await addPlayer(ctx, w, JUDGE);
    const soto = await addPlayer(ctx, w, SOTO);
    return { w, judge, soto };
  });
}

describe("commit — the names the card keeps", () => {
  test("a name nobody matches is pending on the card in printed order; an exact single match links", async () => {
    const t = newT();
    const { w, judge } = await world(t);
    await commit(t, w, [
      // Printed order: NOBODY (0), JUDGE (1, an exact link), Quinn (2).
      wire("1", { players: [NOBODY, JUDGE, "Quinn Rookie"], teams: ["Mystery Club"] }),
    ]);
    const card = (await byNumber(t, w.base)).get("1")!;
    expect(card.playerIds).toEqual([judge]);
    expect(card.playerLinks).toEqual([{ playerId: judge, nameOnCard: JUDGE }]);
    expect(card.pendingPlayerNames).toEqual([NOBODY, "Quinn Rookie"]);
    expect(card.pendingTeamNames).toEqual(["Mystery Club"]);
  });

  test("nothing but the card itself is written: no per-name row, no lookup scheduled", async () => {
    const t = newT();
    const { w } = await world(t);
    await commit(t, w, [wire("1", { players: [NOBODY] })]);
    const card = (await byNumber(t, w.base)).get("1")!;
    expect(card.pendingPlayerNames).toEqual([NOBODY]);
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled.filter((s) => /tidyNames|entityReview|lookup/i.test(s.name))).toEqual([]);
  });
});

describe("commit — sourceNumbers", () => {
  test("are stored on a new row", async () => {
    const t = newT();
    const { w } = await world(t);
    await commit(t, w, [wire("1", { sourceNumbers: { bsc: "OV-ANFI", checklist: "NNO" } })]);
    expect((await byNumber(t, w.base)).get("1")!.sourceNumbers).toEqual({ bsc: "OV-ANFI", checklist: "NNO" });
  });

  test("a card with none stores none", async () => {
    const t = newT();
    const { w } = await world(t);
    await commit(t, w, [wire("1")]);
    expect((await byNumber(t, w.base)).get("1")!.sourceNumbers).toBeUndefined();
  });
});

describe("commit — sourceDisagreements", () => {
  const conflict = (a: string[], b: string[]) => ({ checklistConflict: { players: { marketplace: a, checklist: b } } });

  test("a real difference is stored unsettled and the field holds NOTHING (no link, no pending name)", async () => {
    const t = newT();
    const { w } = await world(t);
    await commit(t, w, [wire("7", conflict([NOBODY], ["Other Nobody"]))]);
    const card = (await byNumber(t, w.base)).get("7")!;
    expect(card.sourceDisagreements).toHaveLength(1);
    const entry = card.sourceDisagreements![0];
    expect(entry.values.map((v) => v.value.join("|")).sort()).toEqual([NOBODY, "Other Nobody"].sort());
    expect(entry.values.find((v) => v.value[0] === NOBODY)!.sources).toEqual(["bsc"]);
    expect(entry.values.find((v) => v.value[0] === "Other Nobody")!.sources).toEqual(["checklist"]);
    expect(card.playerIds).toBeUndefined();
    expect(card.pendingPlayerNames).toBeUndefined();
  });

  test("values that agree after the name matcher store nothing at all", async () => {
    const t = newT();
    const { w } = await world(t);
    await commit(t, w, [wire("7", conflict(["Ronald Acuña Jr."], ["ronald acuna jr"]))]);
    expect((await byNumber(t, w.base)).get("7")!.sourceDisagreements).toBeUndefined();
  });

  test("exactly one value made only of NB players is still a question for the operator: NB never picks", async () => {
    const t = newT();
    const { w } = await world(t);
    // The prelude resolves the names the card lists; the conflict still stays unsettled.
    await commit(t, w, [wire("7", { players: [JUDGE, NOBODY], ...conflict([JUDGE], [NOBODY]) })]);
    const card = (await byNumber(t, w.base)).get("7")!;
    expect(card.sourceDisagreements).toHaveLength(1);
    expect(card.playerIds).toBeUndefined();
    expect(card.pendingPlayerNames).toBeUndefined();
  });

  test("both values known to NB is a question for the operator", async () => {
    const t = newT();
    const { w } = await world(t);
    await commit(t, w, [wire("7", conflict([JUDGE], [SOTO]))]);
    const card = (await byNumber(t, w.base)).get("7")!;
    expect(card.sourceDisagreements).toHaveLength(1);
    expect(card.playerIds).toBeUndefined();
  });

  test("neither value known to NB is a question for the operator", async () => {
    const t = newT();
    const { w } = await world(t);
    await commit(t, w, [wire("7", conflict([NOBODY], ["Other Nobody"]))]);
    expect((await byNumber(t, w.base)).get("7")!.sourceDisagreements).toHaveLength(1);
  });

  test("a payload over 4096 bytes refuses the commit, names the card by its number, and writes no card", async () => {
    const t = newT();
    const { w } = await world(t);
    const names = (tag: string) => Array.from({ length: 20 }, (_, i) => `${tag}${i} ${"x".repeat(90)}`);
    let message = "";
    try {
      await commit(t, w, [
        wire("1"),
        wire("77", { playersConflict: { bsc: names("a"), sportlots: names("b") } }),
      ]);
    } catch (e) {
      message = String((e as { data?: string }).data ?? (e as Error).message);
    }
    expect(message).toContain("#77");
    expect(message).not.toContain("xxxxxxxx");
    expect(await rows(t, w.base)).toEqual([]);
  });

  test("a re-synced row is never re-derived: NB's data stays (D4)", async () => {
    const t = newT();
    const { w } = await world(t);
    await commit(t, w, [wire("7")]);
    const first = (await byNumber(t, w.base)).get("7")!;
    expect(first.sourceDisagreements).toBeUndefined();
    await commit(t, w, [wire("7", conflict([NOBODY], ["Other Nobody"]))]);
    const again = (await byNumber(t, w.base)).get("7")!;
    expect(again._id).toBe(first._id);
    expect(again.sourceDisagreements).toBeUndefined();
    expect(again.pendingPlayerNames).toBeUndefined();
  });
});

describe("commit — a career gap is read live (today's rule: a stint that started by the card year)", () => {
  async function career(t: T, stints: Array<{ team: "padres" | "mets"; fromYear: number; toYear?: number }>) {
    const { w } = await world(t);
    const merrill = await t.run((ctx) =>
      addPlayer(
        ctx,
        w,
        "Jackson Merrill",
        stints.map((s) => ({ teamId: s.team === "padres" ? w.padres : w.mets, fromYear: s.fromYear, ...(s.toYear ? { toYear: s.toYear } : {}) })),
      ),
    );
    return { w, merrill };
  }
  /** The gaps the live query reports for card `n`'s (player, team) pairs. */
  const gapsOf = async (t: T, w: TidyWorld, n: string) => {
    const card = (await byNumber(t, w.base)).get(n)!;
    const [playerId] = card.playerIds ?? [];
    const pairs = (card.teamOnCardIds ?? []).map((teamId) => ({
      selectorOptionId: card.selectorOptionId,
      playerId,
      teamId,
    }));
    return t.withIdentity(ADMIN).query(api.careerCoverage.careerGaps, { pairs });
  };

  test("a one-player card printing a team the career does not cover is a gap", async () => {
    const t = newT();
    const { w, merrill } = await career(t, [{ team: "mets", fromYear: 2020, toYear: 2023 }]);
    await commit(t, w, [wire("1", { players: ["Jackson Merrill"], teams: ["San Diego Padres"] })]);
    expect(await gapsOf(t, w, "1")).toEqual([
      { selectorOptionId: w.base, playerId: merrill, teamId: w.padres },
    ]);
  });

  test("a stint that started by the card year covers it: no gap", async () => {
    const t = newT();
    const { w } = await career(t, [{ team: "padres", fromYear: 2019 }]);
    await commit(t, w, [wire("1", { players: ["Jackson Merrill"], teams: ["San Diego Padres"] })]);
    expect(await gapsOf(t, w, "1")).toEqual([]);
  });

  test("a stint that began AFTER the card year does not: the rule is not a [Y-1, Y] window", async () => {
    const t = newT();
    const { w, merrill } = await career(t, [{ team: "padres", fromYear: 2025 }]);
    await commit(t, w, [wire("1", { players: ["Jackson Merrill"], teams: ["San Diego Padres"] })]);
    expect(await gapsOf(t, w, "1")).toEqual([
      { selectorOptionId: w.base, playerId: merrill, teamId: w.padres },
    ]);
  });

  test("a stint that ended before the card year still covers it (a former player of the club)", async () => {
    const t = newT();
    const { w } = await career(t, [{ team: "padres", fromYear: 2010, toYear: 2015 }]);
    await commit(t, w, [wire("1", { players: ["Jackson Merrill"], teams: ["San Diego Padres"] })]);
    expect(await gapsOf(t, w, "1")).toEqual([]);
  });

  test("a multi-player card raises no careerGap even when the live gaps name its pair", async () => {
    const t = newT();
    const { w, merrill } = await career(t, [{ team: "mets", fromYear: 2020, toYear: 2023 }]);
    await commit(t, w, [wire("1", { players: ["Jackson Merrill", JUDGE], teams: ["San Diego Padres"] })]);
    const card = (await byNumber(t, w.base)).get("1")!;
    expect(card.playerIds).toHaveLength(2);
    const attention = deriveCardAttention(card, {
      careerGaps: [{ playerId: merrill, teamId: w.padres }],
    });
    expect(attention.items.some((i) => i.kind === "careerGap")).toBe(false);
  });

  test("a card with no team printed has no pair to check", async () => {
    const t = newT();
    const { w } = await career(t, [{ team: "mets", fromYear: 2020, toYear: 2023 }]);
    await commit(t, w, [wire("1", { players: ["Jackson Merrill"] })]);
    expect(await gapsOf(t, w, "1")).toEqual([]);
  });

  test("the gap follows the career as it is NOW: a stint added after the commit covers it, with no recheck", async () => {
    const t = newT();
    const { w, merrill } = await career(t, [{ team: "mets", fromYear: 2020, toYear: 2023 }]);
    await commit(t, w, [wire("1", { players: ["Jackson Merrill"], teams: ["San Diego Padres"] })]);
    expect(await gapsOf(t, w, "1")).toHaveLength(1);
    await t.run((ctx) =>
      ctx.db.patch(merrill, {
        teamYears: [
          { teamId: w.mets, fromYear: 2020, toYear: 2023 },
          { teamId: w.padres, fromYear: 2024 },
        ],
      }),
    );
    expect(await gapsOf(t, w, "1")).toEqual([]);
  });
});

describe("commit — the team fill: the batch tier", () => {
  async function teamed(t: T) {
    const { w } = await world(t);
    const merrill = await t.run((ctx) => addPlayer(ctx, w, "Jackson Merrill"));
    return { w, merrill };
  }

  test("a teamless card takes the team the same player has on another card of the commit", async () => {
    const t = newT();
    const { w, merrill } = await teamed(t);
    await commit(t, w, [
      wire("1", { players: ["Jackson Merrill"], teams: ["San Diego Padres"] }),
      wire("2", { players: ["Jackson Merrill"] }),
    ]);
    const cards = await byNumber(t, w.base);
    expect(cards.get("1")!.teamOnCardIds).toEqual([w.padres]);
    expect(cards.get("2")!.teamOnCardIds).toEqual([w.padres]);
    expect(merrill).toBeTruthy();
  });

  test("rule 8: a card whose listing names a team nothing could match is never filled", async () => {
    const t = newT();
    const { w } = await teamed(t);
    await commit(t, w, [
      wire("1", { players: ["Jackson Merrill"], teams: ["San Diego Padres"] }),
      wire("2", { players: ["Jackson Merrill"], teams: ["Mystery Club"] }),
    ]);
    const two = (await byNumber(t, w.base)).get("2")!;
    expect(two.teamOnCardIds ?? []).not.toContain(w.padres);
  });

  test("rule 8: a card whose teams disagree between the sources is never filled", async () => {
    const t = newT();
    const { w } = await teamed(t);
    await commit(t, w, [
      wire("1", { players: ["Jackson Merrill"], teams: ["San Diego Padres"] }),
      wire("2", {
        players: ["Jackson Merrill"],
        checklistConflict: { teams: { marketplace: ["Mystery Club"], checklist: ["Other Club"] } },
      }),
    ]);
    const two = (await byNumber(t, w.base)).get("2")!;
    expect(two.teamOnCardIds).toBeUndefined();
    expect(two.sourceDisagreements?.[0].field).toBe("teams");
  });

  test("a traded player (two team sets in the commit) fills nothing", async () => {
    const t = newT();
    const { w } = await teamed(t);
    await commit(t, w, [
      wire("1", { players: ["Jackson Merrill"], teams: ["San Diego Padres"] }),
      wire("2", { players: ["Jackson Merrill"], teams: ["New York Mets"] }),
      wire("3", { players: ["Jackson Merrill"] }),
    ]);
    expect((await byNumber(t, w.base)).get("3")!.teamOnCardIds).toBeUndefined();
  });

  test("a card with a player name still pending is not filled", async () => {
    const t = newT();
    const { w } = await teamed(t);
    await commit(t, w, [
      wire("1", { players: ["Jackson Merrill"], teams: ["San Diego Padres"] }),
      wire("2", { players: ["Jackson Merrill", NOBODY] }),
    ]);
    expect((await byNumber(t, w.base)).get("2")!.teamOnCardIds).toBeUndefined();
  });
});

// Keep a type used so the import stays honest.
export type _Row = Doc<"cardChecklist">;
