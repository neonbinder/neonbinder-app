/**
 * NEO-591 — what `commitCardChecklist` does with a checklist's Prospect claim.
 *
 *  - `isProspect` is born as `features.isProspect = "true"` on a NEW card only
 *    (isRookie's route); a card that already exists is never touched by it.
 *  - A held "Prospect (X)" (`prospectTeam`, teams empty, teamLookup
 *    "checklist") is NOT a No Team claim: the card is stamped outcome
 *    "checklist", keeps X only as the "Listed as:" hint (`bscTeamName`), writes
 *    no team and no No Team stamp, and is never queued for BSC.
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
  prospectTeam?: string;
  prospectTeams?: string[];
  rawTeamName?: string;
  teamNone?: true;
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
    ...(opts.prospectTeam !== undefined ? { prospectTeam: opts.prospectTeam } : {}),
    ...(opts.prospectTeams ? { prospectTeams: opts.prospectTeams } : {}),
    ...(opts.rawTeamName !== undefined ? { rawTeamName: opts.rawTeamName } : {}),
    ...(opts.teamNone ? { teamNone: opts.teamNone } : {}),
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

describe("commitCardChecklist — a held Prospect (X)", () => {
  const held = (extra: Partial<Parameters<typeof card>[0]> = {}) =>
    card({
      cardNumber: "1",
      bscRef: "B1",
      isProspect: true,
      teamLookup: "checklist",
      prospectTeam: "Oklahoma",
      rawTeamName: "Oklahoma",
      ...extra,
    });

  test("is answered by the checklist, keeps X only as the Listed-as hint, and writes no team", async () => {
    const t = convexTest(schema, modules);
    const { sportId, leafId } = await seedTree(t);

    await commit(t, sportId, leafId, [held()]);

    const row = (await rowsByNumber(t, leafId)).get("1")!;
    expect(row.teamCheckOutcome).toBe("checklist");
    expect(row.teamCheckDoneAt).toEqual(expect.any(Number));
    expect(row.bscTeamName).toBe("Oklahoma");
    expect(row.teamOnCardIds).toBeUndefined();
    expect(row.features?.isProspect).toBe("true");
    await settle(t);
  });

  test("is not stamped as a No Team claim: no confirmed-no-team stamp", async () => {
    const t = convexTest(schema, modules);
    const { sportId, leafId } = await seedTree(t);

    await commit(t, sportId, leafId, [held()]);

    const row = (await rowsByNumber(t, leafId)).get("1")!;
    expect(row.teamNoneConfirmedAt).toBeUndefined();
    expect(row.teamNoneConfirmedByUserId).toBeUndefined();
    await settle(t);
  });

  test("is not queued for the BSC team lane", async () => {
    const t = convexTest(schema, modules);
    const { sportId, leafId } = await seedTree(t);

    await commit(t, sportId, leafId, [held()]);

    const row = (await rowsByNumber(t, leafId)).get("1")!;
    expect((await settle(t)).has(row._id)).toBe(false);
  });

  test("a checklist-only card (no BSC ref) with a held X keeps the hint too, and no stamp of any kind", async () => {
    const t = convexTest(schema, modules);
    const { sportId, leafId } = await seedTree(t);

    await commit(t, sportId, leafId, [held({ bscRef: undefined })]);

    const row = (await rowsByNumber(t, leafId)).get("1")!;
    expect(row.bscTeamName).toBe("Oklahoma");
    expect(row.teamNoneConfirmedAt).toBeUndefined();
    expect(row.teamOnCardIds).toBeUndefined();
    expect((await settle(t)).has(row._id)).toBe(false);
  });

  test("the hint falls back to X when the card carries no raw value", async () => {
    const t = convexTest(schema, modules);
    const { sportId, leafId } = await seedTree(t);

    await commit(t, sportId, leafId, [
      card({ cardNumber: "1", bscRef: "B1", isProspect: true, teamLookup: "checklist", prospectTeam: "Dallas Baptist" }),
    ]);

    expect((await rowsByNumber(t, leafId)).get("1")!.bscTeamName).toBe("Dallas Baptist");
    await settle(t);
  });

  test("several held X reach the hint as the one joined text", async () => {
    const t = convexTest(schema, modules);
    const { sportId, leafId } = await seedTree(t);

    await commit(t, sportId, leafId, [held({ prospectTeam: "Oklahoma / Arizona", rawTeamName: "Oklahoma / Arizona" })]);

    expect((await rowsByNumber(t, leafId)).get("1")!.bscTeamName).toBe("Oklahoma / Arizona");
    await settle(t);
  });

  test("a checklist card with no team and no held X is still the No Team claim (the contrast)", async () => {
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

  test("a held X on a card that is not a checklist answer keeps no hint (only a checklist answer carries one)", async () => {
    const t = convexTest(schema, modules);
    const { sportId, leafId } = await seedTree(t);

    await commit(t, sportId, leafId, [
      card({ cardNumber: "1", bscRef: "B1", isProspect: true, prospectTeam: "Oklahoma" }),
    ]);

    const row = (await rowsByNumber(t, leafId)).get("1")!;
    expect(row.bscTeamName).toBeUndefined();
    expect(row.teamNoneConfirmedAt).toBeUndefined();
    await settle(t);
  });

  test("an operator's own No team on a held card wins and is stamped as theirs, with no checklist outcome", async () => {
    const t = convexTest(schema, modules);
    const { sportId, leafId } = await seedTree(t);

    await commit(t, sportId, leafId, [held({ teamNone: true })]);

    const row = (await rowsByNumber(t, leafId)).get("1")!;
    expect(row.teamNoneConfirmedAt).toEqual(expect.any(Number));
    expect(row.teamNoneConfirmedByUserId).toBe(ADMIN_IDENTITY.subject);
    await settle(t);
  });

  test("a name the operator ruled \"not a team\" is dropped from the hint", async () => {
    const t = convexTest(schema, modules);
    const { sportId, leafId } = await seedTree(t);
    await t.run(async (ctx) =>
      ctx.db.insert("entityReviewQueue", {
        selectorOptionId: leafId,
        batchId: "batch-1",
        createdByUserId: ADMIN_IDENTITY.subject,
        kind: "team",
        name: "Oklahoma",
        sportId,
        status: "ready",
        decision: { action: "skip" },
      }),
    );

    await commit(t, sportId, leafId, [held()], { batchId: "batch-1" });

    const row = (await rowsByNumber(t, leafId)).get("1")!;
    expect(row.bscTeamName).toBeUndefined();
    expect(row.teamCheckOutcome).toBe("checklist");
    await settle(t);
  });

  test("the exact held list is accepted and never becomes a team", async () => {
    const t = convexTest(schema, modules);
    const { sportId, leafId } = await seedTree(t);

    await commit(t, sportId, leafId, [
      held({ prospectTeam: "Oklahoma / Arizona", prospectTeams: ["Oklahoma", "Arizona"], rawTeamName: "Oklahoma / Arizona" }),
    ]);

    const row = (await rowsByNumber(t, leafId)).get("1")!;
    expect(row.teamOnCardIds).toBeUndefined();
    expect(row.bscTeamName).toBe("Oklahoma / Arizona");
    await settle(t);
  });

  test("more held X than a card's team cap, or an X over a name's length, is refused and nothing is written", async () => {
    const t = convexTest(schema, modules);
    const { sportId, leafId } = await seedTree(t);

    await expect(
      commit(t, sportId, leafId, [held({ prospectTeams: Array.from({ length: 9 }, (_, i) => `School ${i}`) })]),
    ).rejects.toThrow(/9 held prospect teams; the limit is 8/);
    await expect(commit(t, sportId, leafId, [held({ prospectTeams: ["x".repeat(500)] })])).rejects.toThrow(
      /held prospect team of 500 characters/,
    );

    expect((await rowsByNumber(t, leafId)).size).toBe(0);
    await settle(t);
  });

  test("a held X over the name's length is refused and nothing is written", async () => {
    const t = convexTest(schema, modules);
    const { sportId, leafId } = await seedTree(t);

    await expect(
      commit(t, sportId, leafId, [held({ prospectTeam: "x".repeat(500), rawTeamName: "Oklahoma" })]),
    ).rejects.toThrow(/held prospect team/);

    expect((await rowsByNumber(t, leafId)).size).toBe(0);
    await settle(t);
  });
});
