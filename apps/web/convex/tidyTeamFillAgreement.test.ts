/**
 * NEO-645 (S4, collector item 7) — the Team tile and the commit use ONE career
 * verdict. For a teamless card, the team `commitCardChecklist` writes at save is
 * exactly the team `cardChecklist.suggestedTeamsForCard` preselects, and a card
 * the commit left teamless opens with nothing preselected (a tie in the window
 * is offered whole, every chip with its years).
 *
 * Shapes (the set is 2024 unless noted; the window is the set year and the one
 * before):
 *  - Ohtani: Angels 2018-2023, Dodgers 2024-  -> two teams in the window: no fill;
 *  - A 2020-2024 plus B 2025- on a 2025 set   -> two in the window: no fill, and
 *    the tile offers BOTH (it used to offer and preselect only the 2025 chip);
 *  - both stints cover the set year           -> no fill, none preselected;
 *  - one stint covering the set year          -> filled, preselected;
 *  - one stint that ended the year before     -> filled, preselected;
 *  - a stint that ended two years before      -> nothing in the window: no fill,
 *    the whole career offered, nothing preselected.
 */

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { cancelScheduled, drainScheduled } from "../lib/testing/drain-scheduled";
import { addPlayer, addTeam, seedTidyWorld } from "../lib/testing/tidy-world";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const ADMIN = { subject: "admin_tidy_team_fill_agreement", role: "admin" };
type T = ReturnType<typeof convexTest>;

beforeEach(() => {
  vi.stubGlobal("fetch", (async (url: string | URL) => {
    throw new Error(`this test file must not reach the network: ${String(url)}`);
  }) as unknown as typeof fetch);
});
const live: T[] = [];
afterEach(async () => {
  for (const t of live.splice(0)) {
    await drainScheduled(t);
    await cancelScheduled(t);
  }
  vi.unstubAllGlobals();
});

type Stint = { team: "A" | "B"; fromYear?: number; toYear?: number };

async function commitOne(opts: { year: string; stints: Stint[] }) {
  const t = convexTest(schema, modules);
  live.push(t);
  const world = await t.run(async (ctx) => {
    const w = await seedTidyWorld(ctx, { year: opts.year });
    const a = await addTeam(ctx, w, "Los Angeles", "Angels");
    const b = await addTeam(ctx, w, "Los Angeles", "Dodgers");
    const player = await addPlayer(
      ctx,
      w,
      "Shohei Ohtani",
      opts.stints.map((s) => ({
        teamId: s.team === "A" ? a : b,
        ...(s.fromYear !== undefined ? { fromYear: s.fromYear } : {}),
        ...(s.toYear !== undefined ? { toYear: s.toYear } : {}),
      })),
    );
    return { w, a, b, player };
  });
  await t.withIdentity(ADMIN).action(api.selectorOptions.commitCardChecklist, {
    selectorOptionId: world.w.base,
    sportId: world.w.sport,
    cards: [
      {
        cardNumber: "1",
        cardName: "Shohei Ohtani",
        team: undefined,
        teams: [],
        players: ["Shohei Ohtani"],
        attributes: [],
        isRookie: false,
        isRelic: false,
        printRun: undefined,
        autographType: undefined,
        cardVariation: undefined,
        platformData: { bsc: { ref: "ref-1" } },
        unmatched: undefined,
      },
    ] as never,
  });
  const card = await t.run((ctx) =>
    ctx.db
      .query("cardChecklist")
      .withIndex("by_selector_option", (q) => q.eq("selectorOptionId", world.w.base))
      .first(),
  );
  const tile = await t
    .withIdentity(ADMIN)
    .query(api.cardChecklist.suggestedTeamsForCard, { cardId: card!._id });
  return { world, card: card!, tile };
}

const preselected = (tile: Array<{ teamId: Id<"teams">; inSetYear: boolean }>) =>
  tile.filter((s) => s.inSetYear).map((s) => s.teamId);

describe("the tile preselects exactly what the commit writes", () => {
  test("Angels 2018-2023 and Dodgers 2024-: a tie in the 2023-2024 window, nothing written, both offered, none preselected", async () => {
    const { world, card, tile } = await commitOne({
      year: "2024",
      stints: [
        { team: "A", fromYear: 2018, toYear: 2023 },
        { team: "B", fromYear: 2024 },
      ],
    });
    expect(card.teamOnCardIds ?? []).toEqual([]);
    expect(card.tidyChecks?.some((c) => c.kind === "teamFill") ?? false).toBe(false);
    expect(tile.map((s) => s.teamId).sort()).toEqual([world.a, world.b].sort());
    expect(preselected(tile)).toEqual([]);
  });

  test("2020-2024 plus 2025- on a 2025 set: both teams are in the window, so both are offered and neither preselected", async () => {
    const { world, card, tile } = await commitOne({
      year: "2025",
      stints: [
        { team: "A", fromYear: 2020, toYear: 2024 },
        { team: "B", fromYear: 2025 },
      ],
    });
    expect(card.teamOnCardIds ?? []).toEqual([]);
    expect(tile.map((s) => s.teamId).sort()).toEqual([world.a, world.b].sort());
    expect(preselected(tile)).toEqual([]);
  });

  test("both stints cover the set year: nothing written, none preselected", async () => {
    const { card, tile } = await commitOne({
      year: "2025",
      stints: [
        { team: "A", fromYear: 2020, toYear: 2025 },
        { team: "B", fromYear: 2025 },
      ],
    });
    expect(card.teamOnCardIds ?? []).toEqual([]);
    expect(tile).toHaveLength(2);
    expect(preselected(tile)).toEqual([]);
  });

  test("one stint covering the set year: the commit writes it with the note, and the tile preselects the same team", async () => {
    const { world, card, tile } = await commitOne({
      year: "2024",
      stints: [{ team: "B", fromYear: 2020 }],
    });
    expect(card.teamOnCardIds).toEqual([world.b]);
    expect(card.tidyChecks).toContainEqual({ kind: "teamFill", teamIds: [world.b], reason: "career" });
    expect(preselected(tile)).toEqual([world.b]);
  });

  test("one stint that ended the year before the set: the window holds it, so it is written and preselected", async () => {
    const { world, card, tile } = await commitOne({
      year: "2024",
      stints: [{ team: "A", fromYear: 2018, toYear: 2023 }],
    });
    expect(card.teamOnCardIds).toEqual([world.a]);
    expect(preselected(tile)).toEqual([world.a]);
  });

  test("a stint that ended two years before: nothing in the window, nothing written, the career offered whole and unselected", async () => {
    const { world, card, tile } = await commitOne({
      year: "2024",
      stints: [{ team: "A", fromYear: 2010, toYear: 2022 }],
    });
    expect(card.teamOnCardIds ?? []).toEqual([]);
    expect(tile.map((s) => s.teamId)).toEqual([world.a]);
    expect(tile[0].uncoveredSetYear).toBe(2024);
    expect(preselected(tile)).toEqual([]);
  });
});
