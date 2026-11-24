/**
 * NEO-330 on NEO-656's storage — what the post-commit BSC team check
 * (`cardChecklist.applyBscTeamResolution`) still does with BSC's string once
 * nothing remembers a ruled-out name (NEO-656: "should never be stored"). A
 * name the operator once threw out is asked again, by design, so the cases that
 * pinned a stored skip are gone; what stays is the answer's own handling.
 *
 * Covered:
 *  - a held team links; an unknown name lands unmatched with BSC's string as
 *    the hint, stamped done, and the backfill does not re-queue the card
 *  - the comma split (NEO-333): the whole string links the one team it names
 */

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { teamRowFields } from "./lib/teamRow";
import { insertTestCard } from "../lib/testing/card-row";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

type T = ReturnType<typeof convexTest>;

let harnesses: T[] = [];
function harness(): T {
  const t = convexTest(schema, modules);
  harnesses.push(t);
  return t;
}

beforeEach(() => {
  harnesses = [];
  // No test here may reach the network unless it installs its own stub.
  vi.stubGlobal("fetch", (async (url: string | URL) => {
    throw new Error(`NEO-330: test must not reach the network: ${String(url)}`);
  }) as unknown as typeof fetch);
});

afterEach(async () => {
  for (const t of harnesses) {
    await t.run(async (ctx) => {
      for (const job of await ctx.db.system.query("_scheduled_functions").collect()) {
        if (job.state.kind === "pending" || job.state.kind === "inProgress") {
          await ctx.scheduler.cancel(job._id);
        }
      }
    });
  }
  harnesses = [];
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function seedSet(
  t: T,
): Promise<{ sportId: Id<"selectorOptions">; leafId: Id<"selectorOptions"> }> {
  return t.run(async (ctx) => {
    const sportId = await ctx.db.insert("selectorOptions", {
      level: "sport",
      value: "Baseball",
      platformData: {},
      children: [],
      lastUpdated: 1,
    });
    const yearId = await ctx.db.insert("selectorOptions", {
      level: "year",
      value: "2024",
      platformData: {},
      parentId: sportId,
      children: [],
      lastUpdated: 1,
    });
    const setNameId = await ctx.db.insert("selectorOptions", {
      level: "setName",
      value: "Topps",
      platformData: {},
      parentId: yearId,
      children: [],
      lastUpdated: 1,
    });
    const leafId = await ctx.db.insert("selectorOptions", {
      level: "variantType",
      value: "Insert",
      platformData: {},
      parentId: setNameId,
      children: [],
      lastUpdated: 1,
    });
    return { sportId, leafId };
  });
}

async function seedTeam(
  t: T,
  sportId: Id<"selectorOptions">,
  parts: { name: string; location?: string },
): Promise<Id<"teams">> {
  return t.run(async (ctx) =>
    ctx.db.insert("teams", {
      ...teamRowFields(parts),
      sportId,
      lastUpdated: 1,
    }),
  );
}

async function seedCard(
  t: T,
  leafId: Id<"selectorOptions">,
  extra: { bscTeamName?: string } = {},
): Promise<Id<"cardChecklist">> {
  return t.run(async (ctx) =>
    insertTestCard(ctx, {
      selectorOptionId: leafId,
      cardNumber: "1",
      cardName: "Card 1",
      platformData: { bsc: { ref: "bsc-1", src: "b0" } },
      sortOrder: 1,
      lastUpdated: 1,
      ...extra,
    }),
  );
}

const getCard = (t: T, id: Id<"cardChecklist">) =>
  t.run(async (ctx) => ctx.db.get(id));

function apply(
  t: T,
  cardChecklistId: Id<"cardChecklist">,
  rawTeamName: string,
  teamNames: string[],
) {
  return t.mutation(internal.cardChecklist.applyBscTeamResolution, {
    cardChecklistId,
    rawTeamName,
    teamNames,
  });
}

// ===========================================================================
// A skipped name
// ===========================================================================

describe("applyBscTeamResolution: the backfill (NEO-330)", () => {
  test("the backfill never re-queues a card the check has stamped", async () => {
    const t = harness();
    const { leafId } = await seedSet(t);
    const cardId = await seedCard(t, leafId);

    // Before the check the card is exactly what the backfill looks for.
    const before = await t.mutation(internal.cardChecklist.enqueueBscTeamBackfill, {});
    expect(before.enqueued).toBe(1);
    await t.run(async (ctx) => {
      for (const job of await ctx.db.system.query("_scheduled_functions").collect()) {
        if (job.state.kind === "pending") await ctx.scheduler.cancel(job._id);
      }
    });

    await apply(t, cardId, "CHECKLIST", ["CHECKLIST"]);
    const after = await t.mutation(internal.cardChecklist.enqueueBscTeamBackfill, {});
    expect(after.enqueued).toBe(0);
  });
});

// ===========================================================================
// The skip landing while the lookup is in flight
// ===========================================================================

describe("resolveBscCardTeam: BSC answers a string no team holds (NEO-330)", () => {
  test("the answer leaves BSC's string as the hint and stamps the check done", async () => {
    const t = harness();
    const { leafId } = await seedSet(t);
    const cardId = await seedCard(t, leafId);
    vi.stubGlobal("fetch", (async () =>
      new Response(JSON.stringify({ teamName: "CHECKLIST" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch);

    await t.action(internal.adapters.buysportscards.resolveBscCardTeam, {
      cardChecklistId: cardId,
    });
    const card = await getCard(t, cardId);
    expect(card!.bscTeamName).toBe("CHECKLIST");
    expect(card!.teamCheckDoneAt).toBeTypeOf("number");
  });
});

// ===========================================================================
// A name that was not skipped
// ===========================================================================

describe("applyBscTeamResolution: a held team and an unknown name (NEO-330)", () => {
  test("a held team still links", async () => {
    const t = harness();
    const { sportId, leafId } = await seedSet(t);
    const cubs = await seedTeam(t, sportId, { location: "Chicago", name: "Cubs" });
    const cardId = await seedCard(t, leafId);

    await expect(
      apply(t, cardId, "Chicago Cubs", ["Chicago Cubs"]),
    ).resolves.toEqual({ applied: true, unmatched: false });
    const card = await getCard(t, cardId);
    expect(card!.teamOnCardIds).toEqual([cubs]);
    expect(card!.bscTeamName).toBeUndefined();
  });

  test("an unknown name still lands unmatched with BSC's string as the hint", async () => {
    const t = harness();
    const { leafId } = await seedSet(t);
    const cardId = await seedCard(t, leafId);

    await expect(
      apply(t, cardId, "Toledo Mud Hens", ["Toledo Mud Hens"]),
    ).resolves.toEqual({ applied: false, unmatched: true });
    const card = await getCard(t, cardId);
    expect(card!.teamOnCardIds ?? []).toEqual([]);
    expect(card!.bscTeamName).toBe("Toledo Mud Hens");
  });

});

// ===========================================================================
// The NEO-333 comma split
// ===========================================================================

describe("applyBscTeamResolution: a comma-joined value (NEO-330 x NEO-333)", () => {
  test("the whole string links the one team it names", async () => {
    const t = harness();
    const { sportId, leafId } = await seedSet(t);
    // "Korea, South" is one held team: the whole string names it.
    const korea = await seedTeam(t, sportId, { name: "Korea, South" });
    const cardId = await seedCard(t, leafId);

    await expect(
      apply(t, cardId, "Korea, South", ["Korea", "South"]),
    ).resolves.toEqual({ applied: true, unmatched: false });
    expect((await getCard(t, cardId))!.teamOnCardIds).toEqual([korea]);
  });
});
