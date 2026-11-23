/** NEO-645 — the `tidyNames` home of "this name is not a player / not a team". */
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { isTidyRuledOutName, tidyRuledOutKeys } from "./tidySkips";
import { nameRow, seedTidyWorld } from "../lib/testing/tidy-world";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const NOT = { answer: { kind: "notEntity" as const, by: "operator" as const } };

async function world(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const w = await seedTidyWorld(ctx);
    const args = { scopeId: w.base, sportId: w.sport };
    await nameRow(ctx, { ...args, kind: "player", name: "Checklist", over: NOT });
    await nameRow(ctx, { ...args, kind: "team", name: "Wax Box", over: NOT });
    await nameRow(ctx, { ...args, kind: "player", name: "Juan Soto" });
    return w;
  });
}

describe("isTidyRuledOutName", () => {
  test("a name answered notEntity is ruled out", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    expect(await t.run((ctx) => isTidyRuledOutName(ctx, w.base, "player", "checklist"))).toBe(true);
  });

  test("an unanswered name, an unknown name and the other kind are not", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    await t.run(async (ctx) => {
      expect(await isTidyRuledOutName(ctx, w.base, "player", "juan soto")).toBe(false);
      expect(await isTidyRuledOutName(ctx, w.base, "player", "nobody")).toBe(false);
      expect(await isTidyRuledOutName(ctx, w.base, "team", "checklist")).toBe(false);
      expect(await isTidyRuledOutName(ctx, w.set, "player", "checklist")).toBe(false);
    });
  });

  test("the key is the normalized name: an un-normalized spelling does not match", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    expect(await t.run((ctx) => isTidyRuledOutName(ctx, w.base, "player", "Checklist"))).toBe(false);
  });
});

describe("tidyRuledOutKeys", () => {
  test("lists only notEntity rows as kind:key", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    const keys = await t.run((ctx) => tidyRuledOutKeys(ctx, w.base, 10));
    expect([...keys!].sort()).toEqual(["player:checklist", "team:box wax"]);
  });

  test("an empty scope gives an empty list", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    expect(await t.run((ctx) => tidyRuledOutKeys(ctx, w.set, 10))).toEqual([]);
  });

  test("returns the list at the limit and null one row over it", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    expect(await t.run((ctx) => tidyRuledOutKeys(ctx, w.base, 3))).not.toBeNull();
    expect(await t.run((ctx) => tidyRuledOutKeys(ctx, w.base, 2))).toBeNull();
  });
});
