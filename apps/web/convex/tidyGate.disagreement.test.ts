/**
 * NEO-645 (schema doc 4) — the gate writes NO `tidyNames` row for a name that
 * sits only on the sides of a source disagreement nobody has settled (or only
 * on the side NB's own pick did not take). A name also printed on a settled
 * card keeps its row. The walk makes the row when the operator picks a side.
 */

import { convexTest } from "convex-test";
import { afterEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { normalizePlayerName } from "./players";
import { normalizeTeamName } from "./teams";
import { namesOnlyOnUnsettledSides } from "./features/sourceDisagreements";
import { cancelScheduled } from "../lib/testing/drain-scheduled";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const ADMIN = {
  subject: "admin_player_step_context_001",
  issuer: "https://clerk.example.com",
  tokenIdentifier: "clerk|admin_player_step_context_001",
  name: "Admin User",
  role: "admin",
};
const OTHER_ADMIN = {
  subject: "admin_player_step_context_002",
  issuer: "https://clerk.example.com",
  tokenIdentifier: "clerk|admin_player_step_context_002",
  name: "Other Admin",
  role: "admin",
};


const ONE = "Aaron Alpha";
const TWO = "Bruno Bravo";

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
});

async function node(
  t: T,
  fields: { level: string; value: string; parentId?: Sel },
): Promise<Sel> {
  return t.run(async (ctx) => {
    const id = await ctx.db.insert("selectorOptions", {
      ...fields,
      platformData: {},
      children: [],
      lastUpdated: Date.now(),
    });
    if (fields.parentId) {
      const parent = await ctx.db.get(fields.parentId);
      await ctx.db.patch(fields.parentId, { children: [...(parent?.children ?? []), id] });
    }
    return id;
  });
}

async function setup(t: T) {
  const sportId = await node(t, { level: "sport", value: "Baseball" });
  const year = await node(t, { level: "year", value: "2026", parentId: sportId });
  const brand = await node(t, { level: "manufacturer", value: "Topps", parentId: year });
  const set = await node(t, { level: "setName", value: "Chrome", parentId: brand });
  await node(t, { level: "variantType", value: "Base", parentId: set });
  const insert = await node(t, { level: "variantType", value: "Insert", parentId: set });
  return { sportId, insert };
}

function knownPlayer(t: T, sportId: Sel, name: string) {
  return t.run((ctx) =>
    ctx.db.insert("players", {
      name,
      nameNormalized: normalizePlayerName(name),
      sportId,
      lastUpdated: Date.now(),
    }),
  );
}

const plain = (players: string[], n: number) => ({
  cardNumber: `${n}`,
  cardName: "Card",
  players,
  platformData: {},
});

/** A card whose marketplace printed `marketplace` and whose checklist printed `checklist`. */
const disagreeing = (marketplace: string[], checklist: string[], n: number) => ({
  cardNumber: `${n}`,
  cardName: "Card",
  players: marketplace,
  platformData: {},
  checklistConflict: { players: { marketplace, checklist } },
});

async function gate(t: T, s: { sportId: Sel; insert: Sel }, cards: object[]) {
  return t.withIdentity(ADMIN).action(api.selectorOptions.resolveChecklistEntities, {
    selectorOptionId: s.insert,
    sportId: s.sportId,
    cards: cards as never,
  });
}

async function playerRowNames(t: T): Promise<string[]> {
  return (await t.run((ctx) => ctx.db.query("tidyNames").collect()))
    .filter((r) => r.kind === "player")
    .map((r) => r.name)
    .sort();
}

describe("the gate and a disagreement nobody has settled", () => {
  test("neither side is on file: no row for either side's names", async () => {
    const t = newT();
    const s = await setup(t);

    await gate(t, s, [disagreeing([ONE], [TWO], 1)]);

    expect(await playerRowNames(t)).toEqual([]);
  });

  test("a name also printed on a settled card keeps its row", async () => {
    const t = newT();
    const s = await setup(t);

    await gate(t, s, [disagreeing([ONE], [TWO], 1), plain([TWO], 2)]);

    expect(await playerRowNames(t)).toEqual([TWO]);
  });

  test("NB's own pick (one side wholly on file) leaves the losing side with no row", async () => {
    const t = newT();
    const s = await setup(t);
    await knownPlayer(t, s.sportId, ONE);

    await gate(t, s, [disagreeing([ONE], [TWO], 1)]);

    expect(await playerRowNames(t)).toEqual([]);
  });

  test("without a disagreement the same unknown name still gets its row", async () => {
    const t = newT();
    const s = await setup(t);

    await gate(t, s, [plain([TWO], 1)]);

    expect(await playerRowNames(t)).toEqual([TWO]);
  });
});

describe("namesOnlyOnUnsettledSides", () => {
  const entry = (a: string[], b: string[]) => ({
    field: "players" as const,
    values: [
      { value: a, sources: ["bsc" as const] },
      { value: b, sources: ["checklist" as const] },
    ],
  });
  const none = { players: new Set<string>(), teams: new Set<string>() };
  const knownNone = { players: () => false, teams: () => false };

  test("every side's names are skipped while nothing is known", () => {
    const out = namesOnlyOnUnsettledSides({
      entries: [entry(["A One"], ["B Two"])],
      heldElsewhere: none,
      isKnown: knownNone,
    });
    expect([...out.players].sort()).toEqual(["a one", "b two"]);
    expect(out.teams.size).toBe(0);
  });

  test("the side NB picks is kept; the losing side is skipped", () => {
    const out = namesOnlyOnUnsettledSides({
      entries: [entry(["A One"], ["B Two"])],
      heldElsewhere: none,
      isKnown: { players: (k) => k === "a one", teams: () => false },
    });
    expect([...out.players]).toEqual(["b two"]);
  });

  test("a name held on a settled place is never skipped", () => {
    const out = namesOnlyOnUnsettledSides({
      entries: [entry(["A One"], ["B Two"])],
      heldElsewhere: { players: new Set(["b two"]), teams: new Set() },
      isKnown: knownNone,
    });
    expect([...out.players]).toEqual(["a one"]);
  });
});
