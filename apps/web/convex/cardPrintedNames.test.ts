/**
 * NEO-645 — `syncCardPrintedNames`, the single writer of the printed-names
 * side table, and its readers. `cardPrintedNames.pin.test.ts` pins that no other
 * module writes.
 */

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import {
  MAX_PRINTED_NAMES_PER_CARD,
  deleteCardPrintedNames,
  listCardPrintedNames,
  listPrintersOfName,
  normalizeDesiredPrintedNames,
  pagePrintersOfName,
  planCardPrintedNames,
  resolveScopeLeaf,
  syncCardPrintedNames,
  type DesiredPrintedName,
} from "./cardPrintedNames";
import { insertTestCard } from "../lib/testing/card-row";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const NOW = 1_700_000_000_000;
type T = ReturnType<typeof convexTest>;

async function seed(t: T) {
  return t.run(async (ctx) => {
    const row = (
      level: "sport" | "year" | "manufacturer" | "setName" | "variantType",
      value: string,
      parentId?: Id<"selectorOptions">,
    ) =>
      ctx.db.insert("selectorOptions", {
        level,
        value,
        ...(parentId ? { parentId } : {}),
        platformData: {},
        children: [],
        lastUpdated: NOW,
      });
    const sport = await row("sport", "Baseball");
    const year = await row("year", "2024", sport);
    const brand = await row("manufacturer", "Topps", year);
    const set = await row("setName", "Chrome", brand);
    const base = await row("variantType", "Base", set);
    const other = await row("variantType", "Insert", set);
    const card = (selectorOptionId: Id<"selectorOptions">, cardNumber: string) =>
      insertTestCard(ctx, {
        selectorOptionId,
        cardNumber,
        cardName: `Card ${cardNumber}`,
        platformData: {},
        sortOrder: 0,
        lastUpdated: NOW,
      });
    return {
      base,
      other,
      one: await card(base, "1"),
      two: await card(base, "2"),
      guest: await card(other, "G1"),
    };
  });
}

const want = (
  scopeId: Id<"selectorOptions">,
  over: Partial<DesiredPrintedName> = {},
): DesiredPrintedName => ({
  kind: "player",
  scopeId,
  nameNormalized: "jackson merrill",
  printed: "Jackson Merrill",
  order: 0,
  ...over,
});

const rowsOf = (t: T, cardId: Id<"cardChecklist">) =>
  t.run(async (ctx) => listCardPrintedNames(ctx, cardId));

describe("planCardPrintedNames / normalizeDesiredPrintedNames (pure)", () => {
  const scope = "s1" as Id<"selectorOptions">;
  const stored = (over: Partial<Omit<Doc<"cardPrintedNames">, "_id">> & { _id: string }) =>
    ({
      kind: "player",
      scopeId: scope,
      nameNormalized: "jackson merrill",
      printed: "Jackson Merrill",
      order: 0,
      ...over,
      _id: over._id as Id<"cardPrintedNames">,
    }) satisfies Parameters<typeof planCardPrintedNames>[0][number];

  test("a list that matches the stored rows changes nothing", () => {
    expect(planCardPrintedNames([stored({ _id: "a" })], [want(scope)])).toEqual({
      toDelete: [],
      toInsert: [],
      toPatch: [],
    });
  });

  test("a name the card no longer prints is deleted; a new one is inserted", () => {
    const plan = planCardPrintedNames(
      [stored({ _id: "a" })],
      [want(scope, { nameNormalized: "mike trout", printed: "Mike Trout" })],
    );
    expect(plan.toDelete).toEqual(["a"]);
    expect(plan.toInsert.map((d) => d.nameNormalized)).toEqual(["mike trout"]);
    expect(plan.toPatch).toEqual([]);
  });

  test("a changed spelling, order, scope or override is a patch, not a replace", () => {
    const plan = planCardPrintedNames(
      [stored({ _id: "a" })],
      [
        want("s2" as Id<"selectorOptions">, {
          printed: "Jackson Merril",
          order: 1,
          cardOverride: true,
        }),
      ],
    );
    expect(plan.toDelete).toEqual([]);
    expect(plan.toInsert).toEqual([]);
    expect(plan.toPatch).toEqual([
      {
        id: "a",
        patch: { scopeId: "s2", printed: "Jackson Merril", order: 1, cardOverride: true },
      },
    ]);
  });

  test("dropping an override patches it to undefined (removes the field)", () => {
    const plan = planCardPrintedNames([stored({ _id: "a", cardOverride: true })], [want(scope)]);
    expect(plan.toPatch).toHaveLength(1);
    expect(plan.toPatch[0].patch).toEqual({ cardOverride: undefined });
    expect("cardOverride" in plan.toPatch[0].patch).toBe(true);
  });

  test("a stored duplicate is removed; the same name under another kind is a different row", () => {
    const plan = planCardPrintedNames(
      [stored({ _id: "a" }), stored({ _id: "b" }), stored({ _id: "c", kind: "team" })],
      [want(scope), want(scope, { kind: "team" })],
    );
    expect(plan.toDelete).toEqual(["b"]);
    expect(plan.toInsert).toEqual([]);
  });

  test("a name listed twice is kept once, at the lowest order; blanks are dropped; spellings are trimmed and cut", () => {
    const out = normalizeDesiredPrintedNames([
      want(scope, { order: 3, printed: "  Late  " }),
      want(scope, { order: 1, printed: "Early" }),
      want(scope, { nameNormalized: "", printed: "No key" }),
      want(scope, { nameNormalized: "blank", printed: "   " }),
      want(scope, { nameNormalized: "long", printed: "x".repeat(300) }),
    ]);
    expect(out.map((d) => [d.nameNormalized, d.printed.length, d.order])).toEqual([
      ["jackson merrill", 5, 1],
      ["long", 120, 0],
    ]);
    expect(out[0].printed).toBe("Early");
  });
});

describe("syncCardPrintedNames", () => {
  test("writes a card's rows, players before teams, each in printed order", async () => {
    const t = convexTest(schema, modules);
    const { base, one } = await seed(t);
    await t.run(async (ctx) => {
      const r = await syncCardPrintedNames(ctx, { _id: one }, [
        want(base, { kind: "team", nameNormalized: "sd padres", printed: "SD Padres" }),
        want(base, { nameNormalized: "second", printed: "Second", order: 1 }),
        want(base),
      ]);
      expect(r).toEqual({ inserted: 3, patched: 0, deleted: 0 });
    });
    expect((await rowsOf(t, one)).map((r) => [r.kind, r.printed, r.order])).toEqual([
      ["player", "Jackson Merrill", 0],
      ["player", "Second", 1],
      ["team", "SD Padres", 0],
    ]);
  });

  test("a second sync with the same list writes nothing", async () => {
    const t = convexTest(schema, modules);
    const { base, one } = await seed(t);
    const list = [want(base), want(base, { kind: "team", nameNormalized: "padres", printed: "Padres" })];
    await t.run(async (ctx) => syncCardPrintedNames(ctx, { _id: one }, list));
    const before = await rowsOf(t, one);
    const result = await t.run(async (ctx) => syncCardPrintedNames(ctx, { _id: one }, list));
    expect(result).toEqual({ inserted: 0, patched: 0, deleted: 0 });
    expect((await rowsOf(t, one)).map((r) => r._id).sort()).toEqual(
      before.map((r) => r._id).sort(),
    );
  });

  test("answering keeps the printed record: a patch keeps the row id", async () => {
    const t = convexTest(schema, modules);
    const { base, one } = await seed(t);
    await t.run(async (ctx) => syncCardPrintedNames(ctx, { _id: one }, [want(base)]));
    const [first] = await rowsOf(t, one);
    await t.run(async (ctx) =>
      syncCardPrintedNames(ctx, { _id: one }, [want(base, { cardOverride: true })]),
    );
    const [after] = await rowsOf(t, one);
    expect(after._id).toBe(first._id);
    expect(after.cardOverride).toBe(true);
    // and clearing it removes the field again
    await t.run(async (ctx) => syncCardPrintedNames(ctx, { _id: one }, [want(base)]));
    const [cleared] = await rowsOf(t, one);
    expect(cleared.cardOverride).toBeUndefined();
    expect("cardOverride" in cleared).toBe(false);
  });

  test("an empty list deletes every row the card had", async () => {
    const t = convexTest(schema, modules);
    const { base, one } = await seed(t);
    await t.run(async (ctx) => syncCardPrintedNames(ctx, { _id: one }, [want(base)]));
    const r = await t.run(async (ctx) => syncCardPrintedNames(ctx, { _id: one }, []));
    expect(r).toEqual({ inserted: 0, patched: 0, deleted: 1 });
    expect(await rowsOf(t, one)).toEqual([]);
  });

  test("fresh skips the read: a new card with nothing to print costs nothing", async () => {
    const t = convexTest(schema, modules);
    const { one } = await seed(t);
    const r = await t.run(async (ctx) =>
      syncCardPrintedNames(ctx, { _id: one }, [], { fresh: true }),
    );
    expect(r).toEqual({ inserted: 0, patched: 0, deleted: 0 });
  });

  test("refuses a list over the per-card bound", async () => {
    const t = convexTest(schema, modules);
    const { base, one } = await seed(t);
    const tooMany = Array.from({ length: MAX_PRINTED_NAMES_PER_CARD + 1 }, (_, i) =>
      want(base, { nameNormalized: `n${i}`, printed: `N ${i}`, order: i }),
    );
    await expect(
      t.run(async (ctx) => syncCardPrintedNames(ctx, { _id: one }, tooMany)),
    ).rejects.toThrow(/exceeds the 28-name limit/);
    expect(await rowsOf(t, one)).toEqual([]);
  });

  test("two cards in a scope that print one name are both found, and a guest keeps its source scope", async () => {
    const t = convexTest(schema, modules);
    const { base, other, one, two, guest } = await seed(t);
    await t.run(async (ctx) => {
      await syncCardPrintedNames(ctx, { _id: one }, [want(base)]);
      await syncCardPrintedNames(ctx, { _id: two }, [want(base, { printed: "Jackson Merril" })]);
      // A parallel copy lives on `other` but keeps the SOURCE leaf's scope.
      await syncCardPrintedNames(ctx, { _id: guest }, [want(base)]);
    });
    const key = { scopeId: base, kind: "player" as const, nameNormalized: "jackson merrill" };
    const found = await t.run(async (ctx) => listPrintersOfName(ctx, key, 51));
    expect(found.map((r) => r.cardChecklistId).sort()).toEqual([one, two, guest].sort());
    expect(await t.run(async (ctx) => listPrintersOfName(ctx, key, 2))).toHaveLength(2);
    // Nothing is filed under the copy's own leaf.
    expect(
      await t.run(async (ctx) =>
        listPrintersOfName(ctx, { ...key, scopeId: other }, 51),
      ),
    ).toEqual([]);
    // A spelling differs per card; the key is shared.
    expect(found.map((r) => r.printed).sort()).toEqual([
      "Jackson Merril",
      "Jackson Merrill",
      "Jackson Merrill",
    ]);
  });

  test("pagePrintersOfName pages by the name's scope key", async () => {
    const t = convexTest(schema, modules);
    const { base, one, two } = await seed(t);
    await t.run(async (ctx) => {
      await syncCardPrintedNames(ctx, { _id: one }, [want(base)]);
      await syncCardPrintedNames(ctx, { _id: two }, [want(base)]);
    });
    const key = { scopeId: base, kind: "player" as const, nameNormalized: "jackson merrill" };
    const first = await t.run(async (ctx) =>
      pagePrintersOfName(ctx, key, { numItems: 1, cursor: null }),
    );
    expect(first.page).toHaveLength(1);
    expect(first.isDone).toBe(false);
  });

  test("deleteCardPrintedNames takes the card's rows and nobody else's", async () => {
    const t = convexTest(schema, modules);
    const { base, one, two } = await seed(t);
    await t.run(async (ctx) => {
      await syncCardPrintedNames(ctx, { _id: one }, [want(base), want(base, { kind: "team", nameNormalized: "x", printed: "X" })]);
      await syncCardPrintedNames(ctx, { _id: two }, [want(base)]);
    });
    expect(await t.run(async (ctx) => deleteCardPrintedNames(ctx, one))).toBe(2);
    expect(await rowsOf(t, one)).toEqual([]);
    expect(await rowsOf(t, two)).toHaveLength(1);
  });
});

describe("resolveScopeLeaf (decision Q3)", () => {
  test("is the row's own scope while that leaf exists, the card's own leaf once it is gone", async () => {
    const t = convexTest(schema, modules);
    const { base, other, one } = await seed(t);
    await t.run(async (ctx) => syncCardPrintedNames(ctx, { _id: one }, [want(base)]));
    const [row] = await rowsOf(t, one);
    expect(await t.run(async (ctx) => resolveScopeLeaf(ctx, row, other))).toBe(base);
    await t.run(async (ctx) => {
      // Detach the cards first so the leaf can go (fixture only).
      await ctx.db.delete(base);
    });
    expect(await t.run(async (ctx) => resolveScopeLeaf(ctx, row, other))).toBe(other);
  });
});
