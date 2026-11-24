/**
 * NEO-656 — the armed clear of stored Tidy Up review state: `tidyReviewed`,
 * `tidyChecks` and the `sourceDisagreements` entries that carry `chosen`.
 *
 * Pinned: a dry run writes nothing and reports the counts; an unarmed
 * deployment REFUSES an armed call (reported, not thrown); an armed run clears
 * exactly those fields, never touches `lastUpdated` or any other field, keeps an
 * unpicked entry byte for byte, and a second run patches nothing.
 */

import { convexTest } from "convex-test";
import { afterEach, describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import { insertTestCard } from "../lib/testing/card-row";
import { planClear } from "./clearTidyReviewState";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

type T = ReturnType<typeof convexTest>;

const FLAG = "ALLOW_CLEAR_TIDY_REVIEW_STATE";

afterEach(() => {
  delete process.env[FLAG];
});

async function seedLeaf(t: T) {
  return t.run(async (ctx) => {
    const sportId = await ctx.db.insert("selectorOptions", {
      level: "sport",
      value: "Baseball",
      sportConfig: { skuCode: "BB", league: "MLB" },
      platformData: {},
      children: [],
      lastUpdated: Date.now(),
    });
    const leafId = await ctx.db.insert("selectorOptions", {
      level: "variantType",
      value: "Base",
      platformData: {},
      parentId: sportId,
      children: [],
      lastUpdated: Date.now(),
    });
    await ctx.db.patch(sportId, { children: [leafId] });
    return { sportId, leafId };
  });
}

const PICKED = {
  field: "players" as const,
  values: [
    { value: ["Rhett Lowder"], sources: ["bsc" as const] },
    { value: ["Rhett Loder"], sources: ["checklist" as const] },
  ],
  chosen: { value: ["Rhett Lowder"], by: "operator" as const },
};
const OPEN = {
  field: "teams" as const,
  values: [
    { value: ["Reds"], sources: ["bsc" as const] },
    { value: ["Cincinnati"], sources: ["checklist" as const] },
  ],
};

async function seedCard(
  t: T,
  leafId: Id<"selectorOptions">,
  n: number,
  extra: Partial<Doc<"cardChecklist">>,
) {
  return t.run((ctx) =>
    insertTestCard(ctx, {
      selectorOptionId: leafId,
      cardNumber: String(n),
      cardName: `Card ${n}`,
      platformData: {},
      sortOrder: n,
      lastUpdated: 1_000 + n,
      ...extra,
    }),
  );
}

async function seedAll(t: T) {
  const { sportId, leafId } = await seedLeaf(t);
  const playerId = await t.run((ctx) =>
    ctx.db.insert("players", {
      name: "Rhett Lowder",
      nameNormalized: "rhett lowder",
      sportId,
      lastUpdated: 1,
    }),
  );
  const teamId = await t.run((ctx) =>
    ctx.db.insert("teams", {
      name: "Reds",
      location: "Cincinnati",
      nameNormalized: "cincinnati reds",
      sportId,
      lastUpdated: 1,
    }),
  );
  const seen = await seedCard(t, leafId, 1, { tidyReviewed: { at: 5, keys: ["cut:abc"] } });
  const checks = await seedCard(t, leafId, 2, {
    tidyChecks: [{ kind: "careerGap", playerId, teamId }],
  });
  const picked = await seedCard(t, leafId, 3, { sourceDisagreements: [PICKED] });
  const both = await seedCard(t, leafId, 4, { sourceDisagreements: [PICKED, OPEN] });
  const clean = await seedCard(t, leafId, 5, { sourceDisagreements: [OPEN] });
  const plain = await seedCard(t, leafId, 6, {});
  return { seen, checks, picked, both, clean, plain };
}

const read = (t: T, id: Id<"cardChecklist">) => t.run((ctx) => ctx.db.get(id));
const snapshot = (t: T) => t.run((ctx) => ctx.db.query("cardChecklist").collect());

describe("planClear", () => {
  test("a clean card has nothing to clear", () => {
    expect(planClear({})).toBeNull();
    expect(planClear({ sourceDisagreements: [OPEN] })).toBeNull();
  });

  test("a picked entry goes whole, an unpicked one stays, an emptied field is unset", () => {
    expect(planClear({ sourceDisagreements: [PICKED, OPEN] })?.patch).toEqual({
      sourceDisagreements: [OPEN],
    });
    const only = planClear({ sourceDisagreements: [PICKED] });
    expect(only?.patch).toEqual({ sourceDisagreements: undefined });
    expect("sourceDisagreements" in (only?.patch ?? {})).toBe(true);
    expect(only?.chosenEntries).toBe(1);
  });
});

describe("clearTidyReviewState.run", () => {
  test("a dry run reports the counts and writes nothing", async () => {
    const t = convexTest(schema, modules);
    await seedAll(t);
    const before = await snapshot(t);

    const result = await t.action(internal.clearTidyReviewState.run, {});
    expect(result).toMatchObject({
      armed: false,
      complete: true,
      scanned: 6,
      tidyReviewed: 1,
      tidyChecks: 1,
      chosenEntries: 2,
      rowsPatched: 4,
    });
    expect(await snapshot(t)).toEqual(before);
  });

  test("refuses to apply on an unarmed deployment even with the confirm token", async () => {
    const t = convexTest(schema, modules);
    await seedAll(t);
    const before = await snapshot(t);

    const result = await t.action(internal.clearTidyReviewState.run, { confirm: "CLEAR" });
    expect(result.armed).toBe(false);
    expect(result.message).toMatch(/not armed/);
    expect(result.rowsPatched).toBe(4);
    expect(await snapshot(t)).toEqual(before);
  });

  test("an armed run without the confirm token is a dry run", async () => {
    const t = convexTest(schema, modules);
    await seedAll(t);
    const before = await snapshot(t);
    process.env[FLAG] = "1";
    const result = await t.action(internal.clearTidyReviewState.run, {});
    expect(result.armed).toBe(false);
    expect(await snapshot(t)).toEqual(before);
  });

  test("an armed run clears only those fields, never bumps lastUpdated, and is idempotent", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedAll(t);
    const before = new Map((await snapshot(t)).map((c) => [c._id, c]));
    process.env[FLAG] = "1";

    const first = await t.action(internal.clearTidyReviewState.run, { confirm: "CLEAR" });
    expect(first).toMatchObject({
      armed: true,
      complete: true,
      tidyReviewed: 1,
      tidyChecks: 1,
      chosenEntries: 2,
      rowsPatched: 4,
    });

    // Each doc minus the three fields is exactly what it was.
    const strip = (c: Doc<"cardChecklist">) => {
      const { tidyReviewed: _r, tidyChecks: _c, sourceDisagreements: _s, ...rest } = c;
      return rest;
    };
    for (const card of await snapshot(t)) {
      expect(strip(card)).toEqual(strip(before.get(card._id)!));
    }
    expect((await read(t, ids.seen))?.tidyReviewed).toBeUndefined();
    expect((await read(t, ids.checks))?.tidyChecks).toBeUndefined();
    expect((await read(t, ids.picked))?.sourceDisagreements).toBeUndefined();
    expect((await read(t, ids.both))?.sourceDisagreements).toEqual([OPEN]);
    // An entry nobody picked is untouched.
    expect((await read(t, ids.clean))?.sourceDisagreements).toEqual([OPEN]);
    expect((await read(t, ids.plain))?.lastUpdated).toBe(1_006);

    const second = await t.action(internal.clearTidyReviewState.run, { confirm: "CLEAR" });
    expect(second).toMatchObject({
      tidyReviewed: 0,
      tidyChecks: 0,
      chosenEntries: 0,
      rowsPatched: 0,
    });
  });
});
