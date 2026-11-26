/**
 * NEO-645 / NEO-656 — the gate and a source disagreement nobody has settled.
 * The gate writes nothing (no per-name row exists any more); it returns FACTS.
 * A name on either side of an unsettled disagreement is still listed as unknown
 * (the operator may pick either side), and a side wholly on file is not.
 */

import { convexTest } from "convex-test";
import { afterEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { normalizePlayerName } from "./players";
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

const unknown = async (t: T, s: { sportId: Sel; insert: Sel }, cards: object[]) =>
  [...(await gate(t, s, cards)).unknownPlayers].sort();

describe("the gate and a disagreement nobody has settled", () => {
  test("neither side is on file: both sides' names are listed, and nothing is written", async () => {
    const t = newT();
    const s = await setup(t);
    expect(await unknown(t, s, [disagreeing([ONE], [TWO], 1)])).toEqual([ONE, TWO]);
    expect(await t.run((ctx) => ctx.db.query("players").collect())).toEqual([]);
  });

  test("a name also printed on a settled card is listed once", async () => {
    const t = newT();
    const s = await setup(t);
    expect(await unknown(t, s, [disagreeing([ONE], [TWO], 1), plain([TWO], 2)])).toEqual([ONE, TWO]);
  });

  test("a side wholly on file is not unknown; the other side still is", async () => {
    const t = newT();
    const s = await setup(t);
    await knownPlayer(t, s.sportId, ONE);
    expect(await unknown(t, s, [disagreeing([ONE], [TWO], 1)])).toEqual([TWO]);
  });

  test("without a disagreement the same unknown name is listed", async () => {
    const t = newT();
    const s = await setup(t);
    expect(await unknown(t, s, [plain([TWO], 1)])).toEqual([TWO]);
  });
});
