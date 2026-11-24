/**
 * NEO-556 — the BSC team lookup answers, and the leaf's "No Team" applies.
 *
 * A card born under a No Team leaf with its BSC lookup still outstanding is
 * NOT stamped at birth (`noTeamCardVerdict` → `awaitingLookup`, product
 * invariant 8): the data might name a team. `applyBscTeamResolution` is
 * where the answer lands, so:
 *
 *  - BSC names no team → the card is stamped "No Team", credited to whoever
 *    set the leaf's No Team;
 *  - BSC's whole claim was ruled "not a team" for the set → stamped the same;
 *  - BSC names a team NB holds → that team is linked, never replaced by the
 *    No Team (rule 8); one NB cannot place → the hint is kept, no stamp;
 *  - a leaf with no No Team, or a card holding a pending team name → no stamp;
 *  - a card an operator already ruled → its ruling is kept as it is.
 */

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import { teamRowFields } from "./lib/teamRow";
import { insertTestCard } from "../lib/testing/card-row";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

type T = ReturnType<typeof convexTest>;

const SETTER = "user_neo556_no_team_setter";
const NO_TEAM = { setAt: 1_700_000_000_000, setByUserId: SETTER };

let harnesses: T[] = [];
function harness(): T {
  const t = convexTest(schema, modules);
  harnesses.push(t);
  return t;
}

beforeEach(() => {
  harnesses = [];
  vi.stubGlobal("fetch", (async (url: string | URL) => {
    throw new Error(`NEO-556: test must not reach the network: ${String(url)}`);
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

async function seedSet(
  t: T,
  opts: { noTeam: boolean },
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
      ...(opts.noTeam ? { noTeamDefault: NO_TEAM } : {}),
    });
    const leafId = await ctx.db.insert("selectorOptions", {
      level: "variantType",
      value: "Insert",
      platformData: {},
      parentId: setNameId,
      children: [],
      lastUpdated: 1,
      // Copied down at the leaf's creation, as `inheritedTeamDefault` does.
      ...(opts.noTeam ? { noTeamDefault: NO_TEAM } : {}),
    });
    return { sportId, leafId };
  });
}

async function seedCard(
  t: T,
  leafId: Id<"selectorOptions">,
  extra: Partial<Doc<"cardChecklist">> = {},
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

const getCard = (t: T, id: Id<"cardChecklist">) => t.run(async (ctx) => ctx.db.get(id));

function apply(t: T, cardChecklistId: Id<"cardChecklist">, rawTeamName: string, teamNames: string[]) {
  return t.mutation(internal.cardChecklist.applyBscTeamResolution, {
    cardChecklistId,
    rawTeamName,
    teamNames,
  });
}

describe("applyBscTeamResolution under a No Team leaf (NEO-556)", () => {
  test("BSC names no team: the card is stamped No Team, credited to whoever set it", async () => {
    const t = harness();
    const { leafId } = await seedSet(t, { noTeam: true });
    const cardId = await seedCard(t, leafId);
    const before = Date.now();
    expect(await apply(t, cardId, "", [])).toEqual({ applied: false, unmatched: false });
    const card = await getCard(t, cardId);
    expect(card!.teamNoneConfirmedAt).toBeGreaterThanOrEqual(before);
    expect(card!.teamNoneConfirmedByUserId).toBe(SETTER);
    expect(card!.teamCheckDoneAt).toBe(card!.teamNoneConfirmedAt);
    expect(card!.teamCheckOutcome).toBe("answered");
    expect(card!.teamOnCardIds ?? []).toEqual([]);
  });

  test("BSC names a team NB holds: the team is linked, never replaced by No Team (rule 8)", async () => {
    const t = harness();
    const { sportId, leafId } = await seedSet(t, { noTeam: true });
    const yankees = await t.run(async (ctx) =>
      ctx.db.insert("teams", {
        ...teamRowFields({ location: "New York", name: "Yankees" }),
        sportId,
        lastUpdated: 1,
      }),
    );
    const cardId = await seedCard(t, leafId);
    expect(await apply(t, cardId, "New York Yankees", ["New York Yankees"])).toEqual({
      applied: true,
      unmatched: false,
    });
    const card = await getCard(t, cardId);
    expect(card!.teamOnCardIds).toEqual([yankees]);
    expect(card!.teamNoneConfirmedAt).toBeUndefined();
    expect(card!.teamNoneConfirmedByUserId).toBeUndefined();
  });

  test("BSC names a team NB cannot place: the hint is kept and the card is not stamped", async () => {
    const t = harness();
    const { leafId } = await seedSet(t, { noTeam: true });
    const cardId = await seedCard(t, leafId);
    expect(await apply(t, cardId, "Gotham Knights", ["Gotham Knights"])).toEqual({
      applied: false,
      unmatched: true,
    });
    const card = await getCard(t, cardId);
    expect(card!.bscTeamName).toBe("Gotham Knights");
    expect(card!.teamNoneConfirmedAt).toBeUndefined();
  });

  test("a leaf with no No Team: BSC's empty answer stamps the lookup only", async () => {
    const t = harness();
    const { leafId } = await seedSet(t, { noTeam: false });
    const cardId = await seedCard(t, leafId);
    await apply(t, cardId, "", []);
    const card = await getCard(t, cardId);
    expect(card!.teamCheckDoneAt).toBeTypeOf("number");
    expect(card!.teamNoneConfirmedAt).toBeUndefined();
  });

  test("a No Team set whose leaf was given a team: the leaf's own default is read, no stamp", async () => {
    const t = harness();
    const { sportId, leafId } = await seedSet(t, { noTeam: true });
    await t.run(async (ctx) => {
      const team = await ctx.db.insert("teams", {
        ...teamRowFields({ location: "Boston", name: "Red Sox" }),
        sportId,
        lastUpdated: 1,
      });
      await ctx.db.patch(leafId, { noTeamDefault: undefined, teamIds: [team] });
    });
    const cardId = await seedCard(t, leafId);
    await apply(t, cardId, "", []);
    expect((await getCard(t, cardId))!.teamNoneConfirmedAt).toBeUndefined();
  });

  test("a card holding a team name waiting for review is not stamped", async () => {
    const t = harness();
    const { leafId } = await seedSet(t, { noTeam: true });
    const cardId = await seedCard(t, leafId, { pendingTeamNames: ["Gotham Knights"] });
    await apply(t, cardId, "", []);
    const card = await getCard(t, cardId);
    expect(card!.teamNoneConfirmedAt).toBeUndefined();
    expect(card!.pendingTeamNames).toEqual(["Gotham Knights"]);
  });

  test("a card an operator already ruled keeps its own ruling", async () => {
    const t = harness();
    const { leafId } = await seedSet(t, { noTeam: true });
    const cardId = await seedCard(t, leafId, {
      teamNoneConfirmedAt: 5,
      teamNoneConfirmedByUserId: "user_operator",
    });
    await apply(t, cardId, "", []);
    const card = await getCard(t, cardId);
    expect(card!.teamNoneConfirmedAt).toBe(5);
    expect(card!.teamNoneConfirmedByUserId).toBe("user_operator");
  });
});
