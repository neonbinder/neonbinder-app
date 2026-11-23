/**
 * NEO-645 (Jason, 2026-11-23) — a card is asked for a name only when the commit
 * BORE it without one: `commitCardChecklist` stamps `{ kind: "needsName" }` in
 * `tidyChecks` on a new card with no player and no name of its own (blank, or
 * NB's "Card #N" placeholder). A card with a player, a player waiting to be
 * resolved, or a real name ("Team Card") carries no stamp.
 */

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { normalizeTeamName } from "./teams";
import { normalizePlayerName } from "./players";
import { STORED_TEAM_EVIDENCE_PLAYERS_PER_CALL } from "./cardChecklist";
import { insertTestCard } from "../lib/testing/card-row";
import { cancelScheduled } from "../lib/testing/drain-scheduled";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const ADMIN = {
  subject: "admin_needs_name",
  issuer: "https://clerk.example.com",
  tokenIdentifier: "clerk|admin_needs_name",
  role: "admin",
};

type T = ReturnType<typeof convexTest>;
type Sel = Id<"selectorOptions">;

const live: T[] = [];
beforeEach(() => {
  vi.stubGlobal("fetch", (async (url: string | URL) => {
    throw new Error(`this test file must not reach the network: ${String(url)}`);
  }) as unknown as typeof fetch);
});
afterEach(async () => {
  for (const t of live.splice(0)) await cancelScheduled(t);
  vi.unstubAllGlobals();
});

async function seed() {
  const t = convexTest(schema, modules);
  live.push(t);
  const s = await t.run(async (ctx) => {
    const now = Date.now();
    const node = (
      level: "sport" | "year" | "setName" | "variantType",
      value: string,
      parentId?: Sel,
      extra: object = {},
    ) =>
      ctx.db.insert("selectorOptions", {
        level,
        value,
        ...(parentId ? { parentId } : {}),
        platformData: {},
        children: [],
        lastUpdated: now,
        ...extra,
      });
    const sportId = await node("sport", "Baseball");
    const yearId = await node("year", "1985", sportId);
    const setId = await node("setName", "Test Set", yearId);
    const insertId = await node("variantType", "Inserts", setId);
    await ctx.db.patch(setId, { children: [insertId] });
    return { sportId, insertId };
  });
  return { t, ...s };
}

const wire = (n: string, cardName: string, players: string[] = []) => ({
  cardNumber: n,
  cardName,
  team: undefined,
  teams: [],
  players,
  attributes: [],
  platformData: {},
});

describe("the commit's needsName stamp", () => {
  test("only a new card with no player and no name of its own is stamped", async () => {
    const w = await seed();
    await w.t.withIdentity(ADMIN).action(api.selectorOptions.commitCardChecklist, {
      selectorOptionId: w.insertId,
      sportId: w.sportId,
      cards: [
        wire("1", "Card #1"),
        wire("2", "  "),
        wire("3", "Team Card"),
        wire("4", "Card #4", ["Johnny Bench"]),
      ],
    });
    const rows = await w.t.run((ctx) =>
      ctx.db
        .query("cardChecklist")
        .withIndex("by_selector_option", (q) => q.eq("selectorOptionId", w.insertId))
        .collect(),
    );
    const byNumber = new Map(rows.map((r) => [r.cardNumber, r]));
    expect(byNumber.get("1")!.tidyChecks).toEqual([{ kind: "needsName" }]);
    expect(byNumber.get("2")!.tidyChecks).toEqual([{ kind: "needsName" }]);
    expect(byNumber.get("3")!.tidyChecks ?? []).toEqual([]);
    expect(byNumber.get("4")!.tidyChecks ?? []).toEqual([]);
  });
});
