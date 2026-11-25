/**
 * NEO-656 — the on-demand lookup's inputs (ported from the old lookup tests that
 * pinned "history candidates come first, are not repeated and carry the
 * preselect"). Nothing here is stored: `lookupContext` is a read, and
 * `mergeLookupEnrichment` is a pure fold of what the lookup returned with those
 * reads.
 */

import { convexTest } from "convex-test";
import { afterEach, describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { mergeLookupEnrichment } from "./tidyNames";
import { cancelScheduled } from "../lib/testing/drain-scheduled";
import { addPlayer, printCard, seedTidyWorld } from "../lib/testing/tidy-world";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

type T = ReturnType<typeof convexTest>;
const live: T[] = [];
const newT = () => {
  const t = convexTest(schema, modules);
  live.push(t);
  return t;
};
afterEach(async () => {
  for (const t of live.splice(0)) await cancelScheduled(t);
});

const id = (s: string) => s as unknown as Id<"players">;
const cand = (playerId: string, extra: Record<string, unknown> = {}) => ({
  playerId: id(playerId),
  name: "Luis Castillo",
  careerSummary: "",
  ...extra,
});

describe("mergeLookupEnrichment", () => {
  test("history candidates come first, and a live candidate already in history is not repeated", () => {
    const out = mergeLookupEnrichment({
      incoming: undefined,
      history: [cand("h1", { sportValue: "Baseball" }), cand("h2", { sportValue: "Football" })],
      live: [cand("l1"), cand("h2"), cand("l2")],
      preselect: undefined,
    });
    expect(out?.existingCandidates?.map((c) => c.playerId)).toEqual(["h1", "h2", "l1", "l2"]);
  });

  test("a history candidate with no sport label is dropped (it cannot be shown)", () => {
    const out = mergeLookupEnrichment({
      incoming: undefined,
      history: [cand("h1")],
      live: [cand("l1")],
      preselect: undefined,
    });
    expect(out?.existingCandidates?.map((c) => c.playerId)).toEqual(["l1"]);
  });

  test("the preselect rides along, with or without candidates and with or without an incoming lookup", () => {
    const preselect = {
      playerId: id("p1"),
      name: "Luis Castillo",
      sportId: "s1" as unknown as Id<"selectorOptions">,
      sportValue: "Baseball",
      reason: "priorYearProduct" as const,
    };
    expect(
      mergeLookupEnrichment({ incoming: undefined, history: [], live: [], preselect })?.preselect,
    ).toEqual(preselect);
    const withBoth = mergeLookupEnrichment({
      incoming: { wikidataId: "Q42" },
      history: [],
      live: [cand("l1")],
      preselect,
    });
    expect(withBoth).toMatchObject({ wikidataId: "Q42", preselect });
    expect(withBoth?.existingCandidates).toHaveLength(1);
  });

  test("the lookup's own fields survive the merge; with nothing to add it returns the lookup untouched", () => {
    const incoming = { wikidataId: "Q42", careerTeams: [{ name: "Mariners", fromYear: 2022 }] };
    expect(mergeLookupEnrichment({ incoming, history: [], live: [], preselect: undefined })).toEqual(incoming);
    expect(
      mergeLookupEnrichment({ incoming, history: [], live: [cand("l1")], preselect: undefined }),
    ).toMatchObject(incoming);
  });

  test("nothing at all merges to nothing", () => {
    expect(
      mergeLookupEnrichment({ incoming: undefined, history: [], live: [], preselect: undefined }),
    ).toBeUndefined();
  });
});

describe("tidyNames.lookupContext", () => {
  async function world(t: T) {
    return t.run(async (ctx) => {
      const w = await seedTidyWorld(ctx);
      const football = await ctx.db.insert("selectorOptions", {
        level: "sport",
        value: "Football",
        platformData: {},
        children: [],
        lastUpdated: 1,
      });
      const one = await addPlayer(ctx, w, "Luis Castillo");
      const two = await addPlayer(ctx, w, "Luis Castillo");
      const card = await printCard(ctx, w, { number: "1", printed: [{ kind: "player", name: "Luis Castillo" }] });
      return { w, football, one, two, card };
    });
  }

  test("every same-name player in the sport is a live candidate; no history means none", async () => {
    const t = newT();
    const { w, one, two, card } = await world(t);
    const out = await t.query(internal.tidyNames.lookupContext, {
      cardId: card,
      kind: "player",
      name: "Luis Castillo",
      sportId: w.sport,
    });
    expect(out.history).toEqual([]);
    expect(out.live.map((c) => c.playerId).sort()).toEqual([one, two].sort());
  });

  test("history ids come back in the order the gate gave them, ahead of the live list", async () => {
    const t = newT();
    const { w, one, two, card } = await world(t);
    const out = await t.query(internal.tidyNames.lookupContext, {
      cardId: card,
      kind: "player",
      name: "Luis Castillo",
      sportId: w.sport,
      historyPlayerIds: [two, one],
    });
    expect(out.history.map((c) => c.playerId)).toEqual([two, one]);
    const merged = mergeLookupEnrichment({
      incoming: undefined,
      history: out.history,
      live: out.live,
      preselect: undefined,
    });
    // Each player once, history order kept.
    expect(merged?.existingCandidates?.map((c) => c.playerId)).toEqual([two, one]);
  });

  test("a team name has no candidates", async () => {
    const t = newT();
    const { w, card } = await world(t);
    const out = await t.query(internal.tidyNames.lookupContext, {
      cardId: card,
      kind: "team",
      name: "San Diego Padres",
      sportId: w.sport,
    });
    expect(out).toEqual({ history: [], live: [] });
  });

  test("a card that is gone and a sport that is not a sport are refused", async () => {
    const t = newT();
    const { w, card } = await world(t);
    await expect(
      t.query(internal.tidyNames.lookupContext, {
        cardId: card,
        kind: "player",
        name: "Luis Castillo",
        sportId: w.base,
      }),
    ).rejects.toThrow(/Pick a sport/);
    await t.run((ctx) => ctx.db.delete(card));
    await expect(
      t.query(internal.tidyNames.lookupContext, {
        cardId: card,
        kind: "player",
        name: "Luis Castillo",
        sportId: w.sport,
      }),
    ).rejects.toThrow(/gone/);
  });
});
