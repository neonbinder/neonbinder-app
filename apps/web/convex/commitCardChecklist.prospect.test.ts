/**
 * NEO-591 — what `commitCardChecklist` does with a checklist's Prospect claim.
 *
 *  - `isProspect` is born as `features.isProspect = "true"` on a NEW card only
 *    (isRookie's route); a card that already exists is never touched by it.
 *  - The X of "Prospect (X)" is the card's printed team (Jason, 2026-11-19):
 *    it arrives in `teams` and resolves at commit like any team string. The
 *    card is not a No Team claim and is never queued for BSC.
 *  - A bare Prospect IS the No Team claim and is stamped as before.
 *
 * Fixture conventions mirror `commitCardChecklist.checklistAnswer.test.ts`.
 */

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { Doc, Id } from "./_generated/dataModel";
import { cancelScheduled, drainScheduled } from "../lib/testing/drain-scheduled";
import { teamRowFields } from "./lib/teamRow";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    (async (url: string | URL) => {
      throw new Error(`this test file must not reach the network: ${String(url)}`);
    }) as unknown as typeof fetch,
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const ADMIN_IDENTITY = {
  subject: "admin_prospect_001",
  issuer: "https://clerk.example.com",
  tokenIdentifier: "clerk|admin_prospect_001",
  name: "Admin User",
  role: "admin",
};

type T = ReturnType<typeof convexTest>;

async function seedTree(t: T): Promise<{ sportId: Id<"selectorOptions">; leafId: Id<"selectorOptions"> }> {
  return t.run(async (ctx) => {
    const sportId = await ctx.db.insert("selectorOptions", {
      level: "sport",
      value: "Baseball",
      sportConfig: { skuCode: "BB", league: "MLB" },
      platformData: {},
      children: [],
      lastUpdated: Date.now(),
    });
    const setNameId = await ctx.db.insert("selectorOptions", {
      level: "setName",
      value: "Test Set",
      platformData: {},
      features: { manufacturer: "Topps", season: "2024" },
      parentId: sportId,
      children: [],
      lastUpdated: Date.now(),
    });
    const leafId = await ctx.db.insert("selectorOptions", {
      level: "variantType",
      value: "Base",
      platformData: {},
      features: { manufacturer: "Topps", season: "2024" },
      parentId: setNameId,
      children: [],
      lastUpdated: Date.now(),
    });
    return { sportId, leafId };
  });
}

function card(opts: {
  cardNumber: string;
  bscRef?: string;
  isProspect?: boolean;
  teamLookup?: "answered" | "failed" | "checklist";
  teams?: string[];
  rawTeamName?: string;
  teamNone?: true;
  teamIds?: Id<"teams">[];
  teamsAnswered?: true;
  applyFields?: string[];
  baseVersion?: number;
}) {
  return {
    cardNumber: opts.cardNumber,
    cardName: `Card ${opts.cardNumber}`,
    teams: opts.teams ?? [],
    players: [],
    platformData: opts.bscRef !== undefined ? { bsc: { ref: opts.bscRef } } : {},
    ...(opts.isProspect ? { isProspect: true } : {}),
    ...(opts.teamLookup ? { teamLookup: opts.teamLookup } : {}),
    ...(opts.rawTeamName !== undefined ? { rawTeamName: opts.rawTeamName } : {}),
    ...(opts.teamNone ? { teamNone: opts.teamNone } : {}),
    ...(opts.teamIds ? { teamIds: opts.teamIds } : {}),
    ...(opts.teamsAnswered ? { teamsAnswered: opts.teamsAnswered } : {}),
    ...(opts.applyFields ? { applyFields: opts.applyFields } : {}),
    ...(opts.baseVersion !== undefined ? { baseVersion: opts.baseVersion } : {}),
  };
}

const commit = (
  t: T,
  sportId: Id<"selectorOptions">,
  leafId: Id<"selectorOptions">,
  cards: ReturnType<typeof card>[],
  extra: { batchId?: string } = {},
) =>
  t.withIdentity(ADMIN_IDENTITY).action(api.selectorOptions.commitCardChecklist, {
    selectorOptionId: leafId,
    sportId,
    cards,
    ...extra,
  });

async function rowsByNumber(t: T, leafId: Id<"selectorOptions">): Promise<Map<string, Doc<"cardChecklist">>> {
  const rows = await t.run(async (ctx) =>
    ctx.db
      .query("cardChecklist")
      .withIndex("by_selector_option", (q) => q.eq("selectorOptionId", leafId))
      .collect(),
  );
  return new Map(rows.map((r) => [r.cardNumber, r]));
}

async function enqueuedIds(t: T): Promise<Set<string>> {
  const rows = await t.run(async (ctx) =>
    (
      ctx as unknown as {
        db: {
          system: {
            query: (n: string) => { collect: () => Promise<Array<{ name: string; args: unknown[] }>> };
          };
        };
      }
    ).db.system.query("_scheduled_functions").collect(),
  );
  const ids = new Set<string>();
  for (const r of rows) {
    if (!r.name.includes("enqueueBscTeamChecks")) continue;
    const a = r.args[0] as { cardChecklistIds?: string[] } | undefined;
    for (const id of a?.cardChecklistIds ?? []) ids.add(id);
  }
  return ids;
}

async function settle(t: T): Promise<Set<string>> {
  const ids = await enqueuedIds(t);
  await drainScheduled(t);
  await cancelScheduled(t);
  return ids;
}

describe("commitCardChecklist — the Prospect Card attribute", () => {
  test("a new card the checklist called a prospect is born with features.isProspect", async () => {
    const t = convexTest(schema, modules);
    const { sportId, leafId } = await seedTree(t);

    await commit(t, sportId, leafId, [
      card({ cardNumber: "1", isProspect: true }),
      card({ cardNumber: "2" }),
    ]);

    const rows = await rowsByNumber(t, leafId);
    expect(rows.get("1")!.features?.isProspect).toBe("true");
    expect(rows.get("2")!.features?.isProspect).toBeUndefined();
    await settle(t);
  });

  test("is a feature only: no typed column is written", async () => {
    const t = convexTest(schema, modules);
    const { sportId, leafId } = await seedTree(t);

    await commit(t, sportId, leafId, [card({ cardNumber: "1", isProspect: true })]);

    const row = (await rowsByNumber(t, leafId)).get("1")! as Record<string, unknown>;
    expect(row.isProspect).toBeUndefined();
    await settle(t);
  });

  test("an existing card is untouched by a later checklist's prospect claim, even when its fields are applied", async () => {
    const t = convexTest(schema, modules);
    const { sportId, leafId } = await seedTree(t);
    await commit(t, sportId, leafId, [card({ cardNumber: "1", bscRef: "B1" })]);
    const before = (await rowsByNumber(t, leafId)).get("1")!;
    expect(before.features?.isProspect).toBeUndefined();

    await commit(t, sportId, leafId, [
      card({ cardNumber: "1", bscRef: "B1", isProspect: true, applyFields: ["cardName"], baseVersion: before.lastUpdated }),
    ]);

    const after = (await rowsByNumber(t, leafId)).get("1")!;
    expect(after._id).toBe(before._id);
    expect(after.features?.isProspect).toBeUndefined();
    await settle(t);
  });

  test("an existing card an operator already marked a prospect keeps the mark when a re-sync says nothing", async () => {
    const t = convexTest(schema, modules);
    const { sportId, leafId } = await seedTree(t);
    await commit(t, sportId, leafId, [card({ cardNumber: "1", bscRef: "B1", isProspect: true })]);
    const before = (await rowsByNumber(t, leafId)).get("1")!;
    expect(before.features?.isProspect).toBe("true");

    await commit(t, sportId, leafId, [card({ cardNumber: "1", bscRef: "B1" })]);

    expect((await rowsByNumber(t, leafId)).get("1")!.features?.isProspect).toBe("true");
    await settle(t);
  });
});

describe("commitCardChecklist — a Prospect (X) whose X is the printed team", () => {
  async function seedSooners(t: T, sportId: Id<"selectorOptions">) {
    return t.run(async (ctx) =>
      ctx.db.insert("teams", {
        ...teamRowFields({ name: "Sooners", location: "Oklahoma" }),
        sportId,
        lastUpdated: Date.now(),
      }),
    );
  }

  test("X resolves to the existing team like any team string, and the card is a prospect", async () => {
    const t = convexTest(schema, modules);
    const { sportId, leafId } = await seedTree(t);
    const teamId = await seedSooners(t, sportId);

    await commit(t, sportId, leafId, [
      card({ cardNumber: "1", bscRef: "B1", isProspect: true, teamLookup: "checklist", teams: ["Oklahoma Sooners"] }),
    ]);

    const row = (await rowsByNumber(t, leafId)).get("1")!;
    expect(row.teamOnCardIds).toEqual([teamId]);
    expect(row.teamNoneConfirmedAt).toBeUndefined();
    expect(row.features?.isProspect).toBe("true");
    await settle(t);
  });

  test("a bare Prospect (no team, answered by the checklist) is still the No Team claim", async () => {
    const t = convexTest(schema, modules);
    const { sportId, leafId } = await seedTree(t);

    await commit(t, sportId, leafId, [
      card({ cardNumber: "1", bscRef: "B1", isProspect: true, teamLookup: "checklist" }),
    ]);

    const row = (await rowsByNumber(t, leafId)).get("1")!;
    expect(row.teamNoneConfirmedAt).toEqual(expect.any(Number));
    expect(row.teamCheckOutcome).toBe("checklist");
    expect(row.bscTeamName).toBeUndefined();
    expect(row.features?.isProspect).toBe("true");
    await settle(t);
  });
});
