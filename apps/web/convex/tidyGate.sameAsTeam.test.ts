/**
 * NEO-645 (S3a) — a player name the same card prints as its team (a team card) is
 * answered "Not a player" by the gate itself: an auto `notEntity`, no lookup, no
 * question. The operator's own answer on the name wins, and it is changeable.
 */

import { convexTest } from "convex-test";
import { afterEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { normalizeEntityName } from "../lib/entities/normalize-name";
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

const playerRows = async (t: T) =>
  (await t.run((ctx) => ctx.db.query("tidyNames").collect())).filter((r) => r.kind === "player");

describe("a player name the card prints as its team", () => {
  test("is answered 'Not a player' by the gate: auto, no lookup, not asked", async () => {
    const t = newT();
    const s = await setup(t);
    const result = await gate(t, s, [
      card([TEAM], 1, [TEAM]),
      card(["Aaron Judge"], 2, [TEAM]),
    ]);
    expect(result.unknownPlayers).toEqual(["Aaron Judge"]);
    const rows = await playerRows(t);
    const teamCard = rows.find((r) => r.nameNormalized === normalizeEntityName(TEAM));
    expect(teamCard?.answer).toEqual({ kind: "notEntity", by: "auto", autoReason: "sameAsTeam" });
    expect(teamCard?.status).toBe("ready");
    // The real player still goes through the normal rules.
    const judge = rows.find((r) => r.nameNormalized === normalizeEntityName("Aaron Judge"));
    expect(judge?.answer).toBeUndefined();
  });

  test("is matched by the shared name matcher (accents, case, punctuation)", async () => {
    const t = newT();
    const s = await setup(t);
    await gate(t, s, [card(["new york  YANKEES."], 1, [TEAM])]);
    const [row] = await playerRows(t);
    expect(row.answer).toMatchObject({ kind: "notEntity", by: "auto", autoReason: "sameAsTeam" });
  });

  test("a card whose player is NOT its team's name is left to the normal rules", async () => {
    const t = newT();
    const s = await setup(t);
    await gate(t, s, [card(["Aaron Judge"], 1, [TEAM])]);
    const [row] = await playerRows(t);
    expect(row.answer).toBeUndefined();
  });

  test("an operator's answer on the name survives the next gate run", async () => {
    const t = newT();
    const s = await setup(t);
    await gate(t, s, [card([TEAM], 1, [TEAM])]);
    const [row] = await playerRows(t);
    await t.run((ctx) =>
      ctx.db.patch(row._id, {
        answer: { kind: "notEntity", by: "operator" },
        answerGen: (row.answerGen ?? 0) + 1,
      }),
    );
    await gate(t, s, [card([TEAM], 1, [TEAM])]);
    const [after] = await playerRows(t);
    expect(after.answer).toEqual({ kind: "notEntity", by: "operator" });
  });
});
