/**
 * NEO-556 — "No Team" as a set-level attribute (`selectorOptions.noTeamDefault`)
 * and as a card answer, through the backend writers:
 *
 *  - `setSelectorOptionTeams({ noTeam: true })`: stored server-stamped, the
 *    other state removed, descendant NODES follow by the three-state
 *    equal-to-previous rule, existing CARDS never move; No Team → team X
 *    leaves stamped cards No Team (Q4); a clear removes it and cascades
 *    nothing; the in-flight guard is shared; the preview counts the same.
 *  - copy-down at node creation (`addCustomSelectorOption`).
 *  - card birth: `addCustomCard` (leaf default + explicit `teamNone`), and
 *    `commitCardChecklist`'s insert branch, which holds the stamp back for a
 *    listing that names a team or a BSC lookup still to run (rule 8), and
 *    lets a set team X beat a checklist's "No team" (Q3).
 *  - `updateCard({ teamNone: true })`: server-stamped, clears teams, links
 *    and pending names, regenerates generated text only, refuses beside a team.
 *
 * Fixture style follows selectorOptions.setSelectorOptionTeams.test.ts and
 * commitCardChecklist.teamAnswers.test.ts. Nothing here may reach the network.
 */

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { Doc, Id } from "./_generated/dataModel";
import { teamRowFields } from "./lib/teamRow";
import { insertTestCard } from "../lib/testing/card-row";
import { deriveCardAttention } from "./features/cardAttention";
import { cancelScheduled, drainScheduled } from "../lib/testing/drain-scheduled";
import {
  CARD_NO_TEAM_WITH_TEAMS_REFUSAL,
  NO_TEAM_WITH_TEAMS_REFUSAL,
} from "./selectorOptions";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    (async (url: string | URL) => {
      throw new Error(`NEO-556: this test file must not reach the network: ${String(url)}`);
    }) as unknown as typeof fetch,
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const ADMIN_IDENTITY = {
  subject: "admin_no_team_001",
  issuer: "https://clerk.example.com",
  tokenIdentifier: "clerk|admin_no_team_001",
  name: "Admin User",
  role: "admin",
};
const ADMIN_ID = ADMIN_IDENTITY.subject;

type T = ReturnType<typeof convexTest>;
type Default =
  | { teamIds: Array<Id<"teams">> }
  | { noTeamDefault: { setAt: number; setByUserId: string } };

const EARLIER_NO_TEAM = { setAt: 1_600_000_000_000, setByUserId: "admin_earlier" };

async function seedSport(t: T): Promise<Id<"selectorOptions">> {
  return t.run(async (ctx) =>
    ctx.db.insert("selectorOptions", {
      level: "sport",
      value: "Baseball",
      sportConfig: { skuCode: "BB", league: "MLB" },
      platformData: {},
      children: [],
      lastUpdated: Date.now(),
    }),
  );
}

/** sport → setName → variantType (Base) → insert → parallel. */
async function seedTree(
  t: T,
  sportId: Id<"selectorOptions">,
  defaults: {
    setName?: Default;
    variantType?: Default;
    insert?: Default;
    parallel?: Default;
  } = {},
) {
  return t.run(async (ctx) => {
    const setNameId = await ctx.db.insert("selectorOptions", {
      level: "setName",
      value: "2024 Topps",
      platformData: {},
      features: { season: "2024", manufacturer: "Topps" },
      parentId: sportId,
      children: [],
      ...(defaults.setName ?? {}),
      lastUpdated: Date.now(),
    });
    await ctx.db.patch(sportId, { children: [setNameId] });
    const variantTypeId = await ctx.db.insert("selectorOptions", {
      level: "variantType",
      value: "Base",
      platformData: {},
      features: { season: "2024", manufacturer: "Topps" },
      parentId: setNameId,
      children: [],
      ...(defaults.variantType ?? {}),
      lastUpdated: Date.now(),
    });
    await ctx.db.patch(setNameId, { children: [variantTypeId] });
    const insertId = await ctx.db.insert("selectorOptions", {
      level: "insert",
      value: "Stars",
      platformData: {},
      parentId: variantTypeId,
      children: [],
      ...(defaults.insert ?? {}),
      lastUpdated: Date.now(),
    });
    await ctx.db.patch(variantTypeId, { children: [insertId] });
    const parallelId = await ctx.db.insert("selectorOptions", {
      level: "parallel",
      value: "Gold",
      platformData: {},
      parentId: insertId,
      children: [],
      ...(defaults.parallel ?? {}),
      lastUpdated: Date.now(),
    });
    await ctx.db.patch(insertId, { children: [parallelId] });
    return { setNameId, variantTypeId, insertId, parallelId };
  });
}

async function seedTeam(
  t: T,
  sportId: Id<"selectorOptions">,
  parts: { name: string; location?: string },
): Promise<Id<"teams">> {
  return t.run(async (ctx) =>
    ctx.db.insert("teams", { ...teamRowFields(parts), sportId, lastUpdated: Date.now() }),
  );
}

async function seedCard(
  t: T,
  selectorOptionId: Id<"selectorOptions">,
  cardNumber: string,
  extra: Partial<Doc<"cardChecklist">> = {},
): Promise<Id<"cardChecklist">> {
  return t.run(async (ctx) =>
    insertTestCard(ctx, {
      selectorOptionId,
      cardNumber,
      cardName: `Card ${cardNumber}`,
      platformData: {},
      sortOrder: Number(cardNumber),
      lastUpdated: 1_700_000_000_000,
      ...extra,
    }),
  );
}

const getCard = (t: T, id: Id<"cardChecklist">) => t.run(async (ctx) => ctx.db.get(id));
const getNode = (t: T, id: Id<"selectorOptions">) => t.run(async (ctx) => ctx.db.get(id));

async function teamLinkIds(t: T, cardId: Id<"cardChecklist">): Promise<string[]> {
  return t.run(async (ctx) =>
    (
      await ctx.db
        .query("cardTeamLinks")
        .withIndex("by_card", (q) => q.eq("cardChecklistId", cardId))
        .collect()
    ).map((r) => r.teamId as string),
  );
}

/** Drain the cascade chain (and anything else scheduled), then cancel the rest. */
async function settle(t: T): Promise<void> {
  await drainScheduled(t);
  await cancelScheduled(t);
}

// ===========================================================================
// setSelectorOptionTeams({ noTeam })
// ===========================================================================

describe("NEO-556 setSelectorOptionTeams — No Team", () => {
  test("stores No Team server-stamped, removes the team, nodes follow, cards never move", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const sportId = await seedSport(t);
    const bulls = await seedTeam(t, sportId, { location: "Durham", name: "Bulls" });
    const reds = await seedTeam(t, sportId, { location: "Cincinnati", name: "Reds" });
    const tree = await seedTree(t, sportId, {
      setName: { teamIds: [bulls] },
      variantType: { teamIds: [bulls] }, // inheriting → follows
      insert: { teamIds: [reds] }, // override → stays
      // parallel unset → follows
    });
    const carrying = await seedCard(t, tree.variantTypeId, "1", { teamOnCardIds: [bulls] });
    const empty = await seedCard(t, tree.variantTypeId, "2");

    const before = Date.now();
    await asAdmin.mutation(api.selectorOptions.setSelectorOptionTeams, {
      selectorOptionId: tree.setNameId,
      teamIds: [],
      noTeam: true,
    });
    const root = await getNode(t, tree.setNameId);
    expect(root!.teamIds).toBeUndefined();
    expect(root!.noTeamDefault?.setByUserId).toBe(ADMIN_ID);
    expect(root!.noTeamDefault!.setAt).toBeGreaterThanOrEqual(before);
    expect(root!.teamCascadeStartedAt).toEqual(expect.any(Number));

    await settle(t);
    const vt = await getNode(t, tree.variantTypeId);
    expect(vt!.teamIds).toBeUndefined();
    // The same decision, same stamp, copied down.
    expect(vt!.noTeamDefault).toEqual(root!.noTeamDefault);
    expect((await getNode(t, tree.insertId))!.teamIds).toEqual([reds]);
    expect((await getNode(t, tree.insertId))!.noTeamDefault).toBeUndefined();
    // The parallel sits under the Reds override, but was UNSET, so it follows the root.
    expect((await getNode(t, tree.parallelId))!.noTeamDefault).toEqual(root!.noTeamDefault);
    // Cards: untouched either way.
    expect((await getCard(t, carrying))!.teamOnCardIds).toEqual([bulls]);
    const emptyCard = await getCard(t, empty);
    expect(emptyCard!.teamOnCardIds ?? []).toEqual([]);
    expect(emptyCard!.teamNoneConfirmedAt).toBeUndefined();
    // The final chunk handed the row back.
    expect((await getNode(t, tree.setNameId))!.teamCascadeStartedAt).toBeUndefined();
  });

  test("No Team with a team is refused, and nothing is written", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const sportId = await seedSport(t);
    const bulls = await seedTeam(t, sportId, { location: "Durham", name: "Bulls" });
    const tree = await seedTree(t, sportId);

    await expect(
      asAdmin.mutation(api.selectorOptions.setSelectorOptionTeams, {
        selectorOptionId: tree.setNameId,
        teamIds: [bulls],
        noTeam: true,
      }),
    ).rejects.toThrow(NO_TEAM_WITH_TEAMS_REFUSAL);
    const root = await getNode(t, tree.setNameId);
    expect(root!.teamIds).toBeUndefined();
    expect(root!.noTeamDefault).toBeUndefined();
  });

  test("re-saving No Team keeps the original stamp", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const sportId = await seedSport(t);
    const tree = await seedTree(t, sportId, { setName: { noTeamDefault: EARLIER_NO_TEAM } });

    await asAdmin.mutation(api.selectorOptions.setSelectorOptionTeams, {
      selectorOptionId: tree.setNameId,
      teamIds: [],
      noTeam: true,
    });
    await settle(t);
    expect((await getNode(t, tree.setNameId))!.noTeamDefault).toEqual(EARLIER_NO_TEAM);
  });

  test("No Team → team X: No Team nodes follow, empty cards take X, stamped cards stay No Team (Q4)", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const sportId = await seedSport(t);
    const bulls = await seedTeam(t, sportId, { location: "Durham", name: "Bulls" });
    const tree = await seedTree(t, sportId, {
      setName: { noTeamDefault: EARLIER_NO_TEAM },
      variantType: { noTeamDefault: EARLIER_NO_TEAM },
    });
    const stamped = await seedCard(t, tree.variantTypeId, "1", {
      teamNoneConfirmedAt: 1,
      teamNoneConfirmedByUserId: "admin_earlier",
    });
    const empty = await seedCard(t, tree.variantTypeId, "2");

    await asAdmin.mutation(api.selectorOptions.setSelectorOptionTeams, {
      selectorOptionId: tree.setNameId,
      teamIds: [bulls],
    });
    await settle(t);

    const root = await getNode(t, tree.setNameId);
    expect(root!.teamIds).toEqual([bulls]);
    expect(root!.noTeamDefault).toBeUndefined();
    const vt = await getNode(t, tree.variantTypeId);
    expect(vt!.teamIds).toEqual([bulls]);
    expect(vt!.noTeamDefault).toBeUndefined();
    const stampedCard = await getCard(t, stamped);
    expect(stampedCard!.teamOnCardIds ?? []).toEqual([]);
    expect(stampedCard!.teamNoneConfirmedAt).toBe(1);
    expect((await getCard(t, empty))!.teamOnCardIds).toEqual([bulls]);
  });

  test("a clear removes No Team on the row and touches nothing below it", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const sportId = await seedSport(t);
    const tree = await seedTree(t, sportId, {
      setName: { noTeamDefault: EARLIER_NO_TEAM },
      variantType: { noTeamDefault: EARLIER_NO_TEAM },
    });

    await asAdmin.mutation(api.selectorOptions.setSelectorOptionTeams, {
      selectorOptionId: tree.setNameId,
      teamIds: [],
    });
    const root = await getNode(t, tree.setNameId);
    expect(root!.noTeamDefault).toBeUndefined();
    expect(root!.teamCascadeStartedAt).toBeUndefined();
    await settle(t);
    expect((await getNode(t, tree.variantTypeId))!.noTeamDefault).toEqual(EARLIER_NO_TEAM);
  });

  test("No Team is refused while the last edit's cascade is still running", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const sportId = await seedSport(t);
    const tree = await seedTree(t, sportId);
    await t.run(async (ctx) => ctx.db.patch(tree.setNameId, { teamCascadeStartedAt: Date.now() }));

    await expect(
      asAdmin.mutation(api.selectorOptions.setSelectorOptionTeams, {
        selectorOptionId: tree.setNameId,
        teamIds: [],
        noTeam: true,
      }),
    ).rejects.toThrow("Still applying the last team change");
    expect((await getNode(t, tree.setNameId))!.noTeamDefault).toBeUndefined();
  });

  test("preview: rows following are counted, no card follows, cards keeping the team are counted", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const sportId = await seedSport(t);
    const bulls = await seedTeam(t, sportId, { location: "Durham", name: "Bulls" });
    const reds = await seedTeam(t, sportId, { location: "Cincinnati", name: "Reds" });
    const tree = await seedTree(t, sportId, {
      setName: { teamIds: [bulls] },
      variantType: { teamIds: [bulls] },
      insert: { teamIds: [reds] },
    });
    await seedCard(t, tree.variantTypeId, "1", { teamOnCardIds: [bulls] });
    await seedCard(t, tree.variantTypeId, "2");

    const preview = await asAdmin.query(api.selectorOptions.getSelectorOptionTeamCascadePreview, {
      selectorOptionId: tree.setNameId,
      teamIds: [],
      noTeam: true,
    });
    // variantType (inheriting) + parallel (unset); the Reds insert stays.
    expect(preview.nodesFollowing).toBe(2);
    expect(preview.cardsFollowing).toBe(0);
    expect(preview.cardsStaying).toBe(0);
    expect(preview.cardsCarryingCurrent).toBe(1);

    // And the write does what the preview said.
    await asAdmin.mutation(api.selectorOptions.setSelectorOptionTeams, {
      selectorOptionId: tree.setNameId,
      teamIds: [],
      noTeam: true,
    });
    await settle(t);
    let followed = 0;
    for (const id of [tree.variantTypeId, tree.insertId, tree.parallelId]) {
      if ((await getNode(t, id))!.noTeamDefault) followed += 1;
    }
    expect(followed).toBe(preview.nodesFollowing);
  });

  test("preview refuses No Team with a team, with the mutation's sentence", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const sportId = await seedSport(t);
    const bulls = await seedTeam(t, sportId, { location: "Durham", name: "Bulls" });
    const tree = await seedTree(t, sportId);
    await expect(
      asAdmin.query(api.selectorOptions.getSelectorOptionTeamCascadePreview, {
        selectorOptionId: tree.setNameId,
        teamIds: [bulls],
        noTeam: true,
      }),
    ).rejects.toThrow(NO_TEAM_WITH_TEAMS_REFUSAL);
  });

  test("preview No Team → team: a No Team node follows", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const sportId = await seedSport(t);
    const bulls = await seedTeam(t, sportId, { location: "Durham", name: "Bulls" });
    const tree = await seedTree(t, sportId, {
      setName: { noTeamDefault: EARLIER_NO_TEAM },
      variantType: { noTeamDefault: EARLIER_NO_TEAM },
    });
    await seedCard(t, tree.variantTypeId, "1", { teamNoneConfirmedAt: 1 });
    await seedCard(t, tree.variantTypeId, "2");
    const preview = await asAdmin.query(api.selectorOptions.getSelectorOptionTeamCascadePreview, {
      selectorOptionId: tree.setNameId,
      teamIds: [bulls],
    });
    // variantType (No Team = previous), insert and parallel (unset).
    expect(preview.nodesFollowing).toBe(3);
    expect(preview.cardsFollowing).toBe(1);
    expect(preview.cardsTeamless).toBe(1);
  });
});

// ===========================================================================
// Copy-down at node creation
// ===========================================================================

describe("NEO-556 copy-down at node creation", () => {
  test("addCustomSelectorOption carries the parent's No Team with its stamp, and no teamIds", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const sportId = await seedSport(t);
    const tree = await seedTree(t, sportId, { setName: { noTeamDefault: EARLIER_NO_TEAM } });

    const childId = await asAdmin.mutation(api.selectorOptions.addCustomSelectorOption, {
      level: "variantType",
      value: "Chrome",
      parentId: tree.setNameId,
    });
    const child = await getNode(t, childId);
    expect(child!.noTeamDefault).toEqual(EARLIER_NO_TEAM);
    expect("teamIds" in child!).toBe(false);
  });
});

describe("NEO-556 getAncestorChain", () => {
  test("carries each row's No Team beside its teams, as a flag", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const sportId = await seedSport(t);
    const tree = await seedTree(t, sportId, { variantType: { noTeamDefault: EARLIER_NO_TEAM } });
    const chain = await asAdmin.query(api.selectorOptions.getAncestorChain, { id: tree.variantTypeId });
    const leaf = chain[chain.length - 1];
    expect(leaf._id).toBe(tree.variantTypeId);
    expect(leaf.noTeam).toBe(true);
    expect(chain.slice(0, -1).map((r) => r.noTeam)).toEqual(chain.slice(0, -1).map(() => false));
    // Who set it, and when, stay on the server.
    for (const row of chain) {
      expect(row).not.toHaveProperty("noTeamDefault");
      expect(JSON.stringify(row)).not.toContain(EARLIER_NO_TEAM.setByUserId);
    }
  });
});

// ===========================================================================
// addCustomCard
// ===========================================================================

describe("NEO-556 addCustomCard", () => {
  test("under a No Team leaf, a card with no team is born stamped as this admin", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const sportId = await seedSport(t);
    const tree = await seedTree(t, sportId, { variantType: { noTeamDefault: EARLIER_NO_TEAM } });

    const id = await asAdmin.mutation(api.selectorOptions.addCustomCard, {
      selectorOptionId: tree.variantTypeId,
      cardNumber: "1",
      cardName: "Card 1",
    });
    const card = await getCard(t, id);
    expect(card!.teamNoneConfirmedAt).toEqual(expect.any(Number));
    expect(card!.teamNoneConfirmedByUserId).toBe(ADMIN_ID);
    expect(card!.teamOnCardIds).toBeUndefined();
  });

  test("under a No Team leaf, a picked team or a typed name is the card's answer: not stamped", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const sportId = await seedSport(t);
    const bulls = await seedTeam(t, sportId, { location: "Durham", name: "Bulls" });
    const tree = await seedTree(t, sportId, { variantType: { noTeamDefault: EARLIER_NO_TEAM } });

    const picked = await asAdmin.mutation(api.selectorOptions.addCustomCard, {
      selectorOptionId: tree.variantTypeId,
      cardNumber: "1",
      cardName: "Card 1",
      teamOnCardIds: [bulls],
    });
    const typed = await asAdmin.mutation(api.selectorOptions.addCustomCard, {
      selectorOptionId: tree.variantTypeId,
      cardNumber: "2",
      cardName: "Card 2",
      teams: ["Somewhere Else"],
    });
    expect((await getCard(t, picked))!.teamNoneConfirmedAt).toBeUndefined();
    expect((await getCard(t, picked))!.teamOnCardIds).toEqual([bulls]);
    expect((await getCard(t, typed))!.teamNoneConfirmedAt).toBeUndefined();
    expect((await getCard(t, typed))!.pendingTeamNames).toEqual(["Somewhere Else"]);
  });

  test("teamNone false under a No Team leaf: the card is born teamless and unstamped", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const sportId = await seedSport(t);
    const tree = await seedTree(t, sportId, { variantType: { noTeamDefault: EARLIER_NO_TEAM } });

    const id = await asAdmin.mutation(api.selectorOptions.addCustomCard, {
      selectorOptionId: tree.variantTypeId,
      cardNumber: "1",
      cardName: "Card 1",
      teamNone: false,
    });
    const card = await getCard(t, id);
    expect(card!.teamNoneConfirmedAt).toBeUndefined();
    expect(card!.teamNoneConfirmedByUserId).toBeUndefined();
    expect(card!.teamOnCardIds ?? []).toEqual([]);
    expect(deriveCardAttention(card!).map((i) => i.kind)).toContain("missingTeam");
  });

  test("teamNone false never turns off a set-level TEAM: under a team leaf the card still takes it", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const sportId = await seedSport(t);
    const bulls = await seedTeam(t, sportId, { location: "Durham", name: "Bulls" });
    const tree = await seedTree(t, sportId, { variantType: { teamIds: [bulls] } });

    const id = await asAdmin.mutation(api.selectorOptions.addCustomCard, {
      selectorOptionId: tree.variantTypeId,
      cardNumber: "1",
      cardName: "Card 1",
      teamNone: false,
    });
    const card = await getCard(t, id);
    expect(card!.teamOnCardIds).toEqual([bulls]);
    expect(card!.teamNoneConfirmedAt).toBeUndefined();
  });

  test("an explicit teamNone beats the leaf's set team and is stamped", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const sportId = await seedSport(t);
    const bulls = await seedTeam(t, sportId, { location: "Durham", name: "Bulls" });
    const tree = await seedTree(t, sportId, { variantType: { teamIds: [bulls] } });

    const id = await asAdmin.mutation(api.selectorOptions.addCustomCard, {
      selectorOptionId: tree.variantTypeId,
      cardNumber: "1",
      cardName: "Card 1",
      teamNone: true,
    });
    const card = await getCard(t, id);
    expect(card!.teamOnCardIds).toBeUndefined();
    expect(card!.teamNoneConfirmedByUserId).toBe(ADMIN_ID);
    expect(card!.listingTitle).not.toContain("Bulls");
    expect(await teamLinkIds(t, id)).toEqual([]);
  });

  test("teamNone beside a picked team or a typed name is refused, and no card is written", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const sportId = await seedSport(t);
    const bulls = await seedTeam(t, sportId, { location: "Durham", name: "Bulls" });
    const tree = await seedTree(t, sportId);

    await expect(
      asAdmin.mutation(api.selectorOptions.addCustomCard, {
        selectorOptionId: tree.variantTypeId,
        cardNumber: "1",
        cardName: "Card 1",
        teamOnCardIds: [bulls],
        teamNone: true,
      }),
    ).rejects.toThrow(CARD_NO_TEAM_WITH_TEAMS_REFUSAL);
    await expect(
      asAdmin.mutation(api.selectorOptions.addCustomCard, {
        selectorOptionId: tree.variantTypeId,
        cardNumber: "2",
        cardName: "Card 2",
        teams: ["Bulls"],
        teamNone: true,
      }),
    ).rejects.toThrow(CARD_NO_TEAM_WITH_TEAMS_REFUSAL);
    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("cardChecklist")
        .withIndex("by_selector_option", (q) => q.eq("selectorOptionId", tree.variantTypeId))
        .collect(),
    );
    expect(rows).toEqual([]);
  });

  test("a leaf with no default: a teamless card is NOT stamped (as before)", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const sportId = await seedSport(t);
    const tree = await seedTree(t, sportId);
    const id = await asAdmin.mutation(api.selectorOptions.addCustomCard, {
      selectorOptionId: tree.variantTypeId,
      cardNumber: "1",
      cardName: "Card 1",
    });
    expect((await getCard(t, id))!.teamNoneConfirmedAt).toBeUndefined();
  });
});

// ===========================================================================
// updateCard({ teamNone })
// ===========================================================================

describe("NEO-556 updateCard teamNone", () => {
  /** A card added by hand with Bulls picked, so its title is the generator's. */
  async function addBullsCard(t: T, leaf: Id<"selectorOptions">, bulls: Id<"teams">) {
    return t.withIdentity(ADMIN_IDENTITY).mutation(api.selectorOptions.addCustomCard, {
      selectorOptionId: leaf,
      cardNumber: "7",
      cardName: "Card 7",
      teamOnCardIds: [bulls],
    });
  }

  test("stamps server-side, clears teams, links and pending names, regenerates generated text", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const sportId = await seedSport(t);
    const bulls = await seedTeam(t, sportId, { location: "Durham", name: "Bulls" });
    const tree = await seedTree(t, sportId);
    const id = await addBullsCard(t, tree.variantTypeId, bulls);
    const before = await getCard(t, id);
    expect(before!.listingTitle).toContain("Bulls");
    expect(await teamLinkIds(t, id)).toEqual([bulls]);

    await asAdmin.mutation(api.selectorOptions.updateCard, { id, teamNone: true });

    const after = await getCard(t, id);
    expect(after!.teamOnCardIds ?? []).toEqual([]);
    expect(after!.pendingTeamNames).toBeUndefined();
    expect(after!.teamNoneConfirmedAt).toEqual(expect.any(Number));
    expect(after!.teamNoneConfirmedByUserId).toBe(ADMIN_ID);
    expect(await teamLinkIds(t, id)).toEqual([]);
    expect(after!.listingTitle).not.toContain("Bulls");
    expect(after!.listingDescription ?? "").not.toContain("Bulls");
  });

  test("a title rebuilt without the team queues the card for eBay, as an edit does (NEO-535)", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const sportId = await seedSport(t);
    const bulls = await seedTeam(t, sportId, { location: "Durham", name: "Bulls" });
    const tree = await seedTree(t, sportId);
    const id = await addBullsCard(t, tree.variantTypeId, bulls);
    const seller = "collector_no_team_retitle";
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("marketplaceListingStates", {
        ownerId: seller,
        platform: "ebay",
        listingStartedAt: now,
        lastUpdated: now,
      });
      const homeId = await ctx.db.insert("collectionContainers", {
        ownerId: seller,
        kind: "box",
        name: "Box 1",
        lastUpdated: now,
      });
      await ctx.db.insert("collectionCopies", {
        ownerId: seller,
        cardId: id,
        variantId: tree.variantTypeId,
        setId: tree.setNameId,
        homeId,
        quantity: 1,
        lastUpdated: now,
      });
    });

    await asAdmin.mutation(api.selectorOptions.updateCard, { id, teamNone: true });

    expect((await getCard(t, id))!.listingTitle).not.toContain("Bulls");
    const outbox = await t.run(async (ctx) => await ctx.db.query("listingOutbox").collect());
    expect(outbox.map((r) => ({ ownerId: r.ownerId, platform: r.platform, cardId: r.cardId }))).toEqual([
      { ownerId: seller, platform: "ebay", cardId: id },
    ]);
  });

  test("a typed title is kept; the panel re-sending the stored title still regenerates it", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const sportId = await seedSport(t);
    const bulls = await seedTeam(t, sportId, { location: "Durham", name: "Bulls" });
    const tree = await seedTree(t, sportId);

    const typed = await addBullsCard(t, tree.variantTypeId, bulls);
    await asAdmin.mutation(api.selectorOptions.updateCard, {
      id: typed,
      listingTitle: "My own Bulls title",
    });
    await asAdmin.mutation(api.selectorOptions.updateCard, { id: typed, teamNone: true });
    expect((await getCard(t, typed))!.listingTitle).toBe("My own Bulls title");

    const resent = await addBullsCard(t, tree.variantTypeId, bulls);
    const stored = (await getCard(t, resent))!.listingTitle!;
    await asAdmin.mutation(api.selectorOptions.updateCard, {
      id: resent,
      teamNone: true,
      listingTitle: stored,
    });
    expect((await getCard(t, resent))!.listingTitle).not.toContain("Bulls");
  });

  test("a typed description is kept; a generated one loses the team", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const sportId = await seedSport(t);
    const bulls = await seedTeam(t, sportId, { location: "Durham", name: "Bulls" });
    const tree = await seedTree(t, sportId);

    const typed = await addBullsCard(t, tree.variantTypeId, bulls);
    await asAdmin.mutation(api.selectorOptions.updateCard, {
      id: typed,
      listingDescription: "Written by hand. Durham Bulls.",
    });
    await asAdmin.mutation(api.selectorOptions.updateCard, { id: typed, teamNone: true });
    const kept = await getCard(t, typed);
    expect(kept!.listingDescription).toBe("Written by hand. Durham Bulls.");
    // The title was still the generator's, so it is rebuilt either way.
    expect(kept!.listingTitle).not.toContain("Bulls");

    const generated = await addBullsCard(t, tree.variantTypeId, bulls);
    expect((await getCard(t, generated))!.listingDescription).toContain("Bulls");
    await asAdmin.mutation(api.selectorOptions.updateCard, { id: generated, teamNone: true });
    expect((await getCard(t, generated))!.listingDescription).not.toContain("Bulls");
  });

  test("a pending team name is cleared too", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const sportId = await seedSport(t);
    const tree = await seedTree(t, sportId);
    const id = await seedCard(t, tree.variantTypeId, "1", { pendingTeamNames: ["Bulls"] });
    await asAdmin.mutation(api.selectorOptions.updateCard, { id, teamNone: true });
    const card = await getCard(t, id);
    expect(card!.pendingTeamNames).toBeUndefined();
    expect(card!.teamNoneConfirmedByUserId).toBe(ADMIN_ID);
  });

  test("refused beside a team or a typed name; nothing written", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const sportId = await seedSport(t);
    const bulls = await seedTeam(t, sportId, { location: "Durham", name: "Bulls" });
    const tree = await seedTree(t, sportId);
    const id = await seedCard(t, tree.variantTypeId, "1");

    await expect(
      asAdmin.mutation(api.selectorOptions.updateCard, { id, teamNone: true, teamOnCardIds: [bulls] }),
    ).rejects.toThrow(CARD_NO_TEAM_WITH_TEAMS_REFUSAL);
    await expect(
      asAdmin.mutation(api.selectorOptions.updateCard, { id, teamNone: true, pendingTeamNames: ["Bulls"] }),
    ).rejects.toThrow(CARD_NO_TEAM_WITH_TEAMS_REFUSAL);
    expect((await getCard(t, id))!.teamNoneConfirmedAt).toBeUndefined();
  });

  test("an existing confirmation keeps its stamp; a team given later retires it", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const sportId = await seedSport(t);
    const bulls = await seedTeam(t, sportId, { location: "Durham", name: "Bulls" });
    const tree = await seedTree(t, sportId);
    const id = await seedCard(t, tree.variantTypeId, "1", {
      teamNoneConfirmedAt: 5,
      teamNoneConfirmedByUserId: "admin_earlier",
    });

    await asAdmin.mutation(api.selectorOptions.updateCard, { id, teamNone: true });
    const kept = await getCard(t, id);
    expect(kept!.teamNoneConfirmedAt).toBe(5);
    expect(kept!.teamNoneConfirmedByUserId).toBe("admin_earlier");

    await asAdmin.mutation(api.selectorOptions.updateCard, { id, teamOnCardIds: [bulls] });
    const teamed = await getCard(t, id);
    expect(teamed!.teamOnCardIds).toEqual([bulls]);
    expect(teamed!.teamNoneConfirmedAt).toBeUndefined();
  });

  test("teamNone false takes No Team back: both stamp fields cleared, the card teamless and asked again", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const sportId = await seedSport(t);
    const tree = await seedTree(t, sportId);
    const id = await seedCard(t, tree.variantTypeId, "1");
    await asAdmin.mutation(api.selectorOptions.updateCard, { id, teamNone: true });
    const stamped = await getCard(t, id);
    expect(stamped!.teamNoneConfirmedByUserId).toBe(ADMIN_ID);

    await asAdmin.mutation(api.selectorOptions.updateCard, { id, teamNone: false });
    const undone = await getCard(t, id);
    expect(undone!.teamNoneConfirmedAt).toBeUndefined();
    expect(undone!.teamNoneConfirmedByUserId).toBeUndefined();
    expect(undone!.teamOnCardIds ?? []).toEqual([]);
    expect(undone!.pendingTeamNames).toBeUndefined();
    // Nothing else moved: the listing text never named "No Team".
    expect(undone!.listingTitle).toBe(stamped!.listingTitle);
    expect(undone!.listingDescription).toBe(stamped!.listingDescription);
    expect(deriveCardAttention(undone!).map((i) => i.kind)).toContain("missingTeam");
  });

  test("teamNone false on a card that is not stamped writes nothing; absent leaves a stamp alone", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const sportId = await seedSport(t);
    const tree = await seedTree(t, sportId);
    const plain = await seedCard(t, tree.variantTypeId, "1");
    const before = await getCard(t, plain);
    await asAdmin.mutation(api.selectorOptions.updateCard, { id: plain, teamNone: false });
    expect(await getCard(t, plain)).toEqual(before);

    const stamped = await seedCard(t, tree.variantTypeId, "2", {
      teamNoneConfirmedAt: 5,
      teamNoneConfirmedByUserId: "admin_earlier",
    });
    await asAdmin.mutation(api.selectorOptions.updateCard, { id: stamped, cardName: "Renamed" });
    const kept = await getCard(t, stamped);
    expect(kept!.teamNoneConfirmedAt).toBe(5);
    expect(kept!.teamNoneConfirmedByUserId).toBe("admin_earlier");
  });

  test("teamNone false beside a team is accepted: the team lands and the stamp goes", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const sportId = await seedSport(t);
    const bulls = await seedTeam(t, sportId, { location: "Durham", name: "Bulls" });
    const tree = await seedTree(t, sportId);
    const id = await seedCard(t, tree.variantTypeId, "1", {
      teamNoneConfirmedAt: 5,
      teamNoneConfirmedByUserId: "admin_earlier",
    });
    await asAdmin.mutation(api.selectorOptions.updateCard, {
      id,
      teamNone: false,
      teamOnCardIds: [bulls],
    });
    const card = await getCard(t, id);
    expect(card!.teamOnCardIds).toEqual([bulls]);
    expect(card!.teamNoneConfirmedAt).toBeUndefined();
    expect(card!.teamNoneConfirmedByUserId).toBeUndefined();
    expect(await teamLinkIds(t, id)).toEqual([bulls]);
  });
});

// ===========================================================================
// commitCardChecklist — card birth under a No Team leaf
// ===========================================================================

/** One preview card as the commit wire carries it. */
function wireCard(opts: {
  cardNumber: string;
  bscRef?: string;
  teams?: string[];
  teamLookup?: "answered" | "failed";
  rawTeamName?: string;
  teamNone?: true;
}) {
  return {
    cardNumber: opts.cardNumber,
    cardName: `Card ${opts.cardNumber}`,
    teams: opts.teams ?? [],
    players: [],
    platformData: opts.bscRef !== undefined ? { bsc: { ref: opts.bscRef } } : {},
    ...(opts.teamLookup ? { teamLookup: opts.teamLookup } : {}),
    ...(opts.rawTeamName !== undefined ? { rawTeamName: opts.rawTeamName } : {}),
    ...(opts.teamNone ? { teamNone: opts.teamNone } : {}),
  };
}

/** Every card id the commit handed to the background BSC team lookup. */
async function enqueuedIds(t: T): Promise<Set<string>> {
  const rows = await t.run(async (ctx) =>
    (
      ctx as unknown as {
        db: {
          system: {
            query: (n: string) => {
              collect: () => Promise<Array<{ name: string; args: unknown[] }>>;
            };
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

async function rowsByNumber(
  t: T,
  leafId: Id<"selectorOptions">,
): Promise<Map<string, Doc<"cardChecklist">>> {
  const rows = await t.run(async (ctx) =>
    ctx.db
      .query("cardChecklist")
      .withIndex("by_selector_option", (q) => q.eq("selectorOptionId", leafId))
      .collect(),
  );
  return new Map(rows.map((r) => [r.cardNumber, r]));
}

describe("NEO-556 commitCardChecklist birth under a No Team leaf", () => {
  test("stamps a card with nothing to wait on; holds back a listing that names a team or an outstanding lookup", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const tree = await seedTree(t, sportId, { variantType: { noTeamDefault: EARLIER_NO_TEAM } });

    await t.withIdentity(ADMIN_IDENTITY).action(api.selectorOptions.commitCardChecklist, {
      selectorOptionId: tree.variantTypeId,
      sportId,
      cards: [
        wireCard({ cardNumber: "1" }), // no ref: stamp
        wireCard({ cardNumber: "2", bscRef: "B2", teamLookup: "answered" }), // BSC said none: stamp
        wireCard({ cardNumber: "3", bscRef: "B3" }), // lookup outstanding: wait
        wireCard({ cardNumber: "4", bscRef: "B4", teamLookup: "failed" }), // failed: wait
        wireCard({
          cardNumber: "5",
          bscRef: "B5",
          teamLookup: "answered",
          rawTeamName: "Nowhere Nomads",
        }), // the listing names a team: keep
      ],
    });

    const rows = await rowsByNumber(t, tree.variantTypeId);
    const queued = await enqueuedIds(t);
    expect(rows.get("1")!.teamNoneConfirmedAt).toEqual(expect.any(Number));
    // The committing admin, not whoever set the No Team.
    expect(rows.get("1")!.teamNoneConfirmedByUserId).toBe(ADMIN_ID);
    expect(rows.get("2")!.teamNoneConfirmedByUserId).toBe(ADMIN_ID);
    expect(queued.has(rows.get("2")!._id)).toBe(false);

    expect(rows.get("3")!.teamNoneConfirmedAt).toBeUndefined();
    expect(queued.has(rows.get("3")!._id)).toBe(true);
    expect(rows.get("4")!.teamNoneConfirmedAt).toBeUndefined();
    expect(queued.has(rows.get("4")!._id)).toBe(true);

    expect(rows.get("5")!.bscTeamName).toBe("Nowhere Nomads");
    expect(rows.get("5")!.teamNoneConfirmedAt).toBeUndefined();
    await settle(t);
  });

  test("Q3: a set team X still beats a checklist's 'No team'", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const bulls = await seedTeam(t, sportId, { location: "Durham", name: "Bulls" });
    const tree = await seedTree(t, sportId, { variantType: { teamIds: [bulls] } });

    await t.withIdentity(ADMIN_IDENTITY).action(api.selectorOptions.commitCardChecklist, {
      selectorOptionId: tree.variantTypeId,
      sportId,
      cards: [wireCard({ cardNumber: "1", teamNone: true })],
    });
    const row = (await rowsByNumber(t, tree.variantTypeId)).get("1")!;
    expect(row.teamOnCardIds).toEqual([bulls]);
    expect(row.teamNoneConfirmedAt).toBeUndefined();
    await settle(t);
  });

  test("a leaf with no default stamps nothing (unchanged)", async () => {
    const t = convexTest(schema, modules);
    const sportId = await seedSport(t);
    const tree = await seedTree(t, sportId);
    await t.withIdentity(ADMIN_IDENTITY).action(api.selectorOptions.commitCardChecklist, {
      selectorOptionId: tree.variantTypeId,
      sportId,
      cards: [wireCard({ cardNumber: "1" })],
    });
    expect((await rowsByNumber(t, tree.variantTypeId)).get("1")!.teamNoneConfirmedAt).toBeUndefined();
    await settle(t);
  });
});
