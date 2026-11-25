/**
 * NEO-645 / NEO-656 — a player name the same card prints as its team (a team
 * card) is an ordinary name, as it is on main's Tidy Up wizard: the gate lists
 * it as unknown and asks; it never links it or answers "Not a player" for the
 * operator. The gate stores nothing.
 */

import { convexTest } from "convex-test";
import { afterEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { normalizeTeamName } from "./teams";
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

const TEAM = "New York Yankees";

async function setup(t: T) {
  const sportId = await node(t, { level: "sport", value: "Baseball" });
  const year = await node(t, { level: "year", value: "2026", parentId: sportId });
  const brand = await node(t, { level: "manufacturer", value: "Topps", parentId: year });
  const set = await node(t, { level: "setName", value: "Chrome", parentId: brand });
  await node(t, { level: "variantType", value: "Base", parentId: set });
  const insert = await node(t, { level: "variantType", value: "Insert", parentId: set });
  await t.run((ctx) =>
    ctx.db.insert("teams", {
      location: "New York",
      name: "Yankees",
      nameNormalized: normalizeTeamName(TEAM),
      sportId,
      yearsActive: { from: 1903 },
      lastUpdated: Date.now(),
    }),
  );
  return { sportId, insert };
}

const card = (players: string[], n: number, teams: string[]) => ({
  cardNumber: `${n}`,
  cardName: "Card",
  players,
  teams,
  platformData: {},
});

async function gate(t: T, s: { sportId: Sel; insert: Sel }, cards: ReturnType<typeof card>[]) {
  return t.withIdentity(ADMIN).action(api.selectorOptions.resolveChecklistEntities, {
    selectorOptionId: s.insert,
    sportId: s.sportId,
    cards,
  });
}

describe("a player name the card prints as its team", () => {
  test("is an ordinary name: listed like any other, no automatic link", async () => {
    const t = newT();
    const s = await setup(t);
    const result = await gate(t, s, [
      card([TEAM], 1, [TEAM]),
      card(["Aaron Judge"], 2, [TEAM]),
    ]);
    expect(result.unknownPlayers.slice().sort()).toEqual([TEAM, "Aaron Judge"].sort());
    expect(result.gateLinks ?? []).toEqual([]);
  });

  test("the shared name matcher (accents, case, punctuation) changes nothing: still listed", async () => {
    const t = newT();
    const s = await setup(t);
    const result = await gate(t, s, [card(["new york  YANKEES."], 1, [TEAM])]);
    expect(result.unknownPlayers).toEqual(["new york  YANKEES."]);
    expect(result.gateLinks ?? []).toEqual([]);
  });

  test("a second gate run gives the same answer: nothing was remembered", async () => {
    const t = newT();
    const s = await setup(t);
    const first = await gate(t, s, [card([TEAM], 1, [TEAM])]);
    const second = await gate(t, s, [card([TEAM], 1, [TEAM])]);
    expect(second.unknownPlayers).toEqual(first.unknownPlayers);
  });
});
