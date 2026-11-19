/**
 * NEO-426 — the BSC team lookup answers, and a teamless sport's default
 * applies (`applyBscTeamResolution` → `noTeamDefaultStamp`).
 *
 * A card born with its BSC lookup outstanding is NOT stamped at birth (product
 * invariant 8: the data might name a team). When the answer lands:
 *
 *  - BSC names no team, or its whole claim was ruled "not a team" for the set
 *    (the two no-team sites in the function) → a card whose every player has a
 *    flagged HOME sport is stamped, credited to the SPORT's setter (there is
 *    no operator in a background write);
 *  - BSC names a team NB holds → linked, never replaced by No team; one NB
 *    cannot place → the hint is kept, no stamp (rule 8);
 *  - a pending player name, a pending team name, no player, or a player of a
 *    sport with teams → no stamp;
 *  - the set's own No Team still vouches first (NEO-556), and an operator's
 *    ruling is kept as it is.
 */

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import { teamRowFields } from "./lib/teamRow";
import { normalizeEntityName } from "../lib/entities/normalize-name";
import { insertTestCard } from "../lib/testing/card-row";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

type T = ReturnType<typeof convexTest>;
type Sel = Id<"selectorOptions">;

const SPORT_SETTER = "setter_neo426_sport";
const LEAF_SETTER = "setter_neo426_leaf";
const NOW = 1_700_000_000_000;

let harnesses: T[] = [];
beforeEach(() => {
  harnesses = [];
  vi.stubGlobal("fetch", (async (url: string | URL) => {
    throw new Error(`NEO-426: test must not reach the network: ${String(url)}`);
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
  vi.unstubAllGlobals();
});

async function seed(opts: { flagged?: boolean; leafNoTeam?: boolean } = {}) {
  const t = convexTest(schema, modules);
  harnesses.push(t);
  const fx = await t.run(async (ctx) => {
    const row = (level: Doc<"selectorOptions">["level"], value: string, parentId?: Sel, extra = {}) =>
      ctx.db.insert("selectorOptions", {
        level,
        value,
        ...(parentId ? { parentId } : {}),
        platformData: {},
        children: [],
        lastUpdated: NOW,
        ...extra,
      });
    const golf = await row("sport", "Golf", undefined, {
      ...(opts.flagged === false ? {} : { teamlessSport: { setAt: NOW, setByUserId: SPORT_SETTER } }),
    });
    const baseball = await row("sport", "Baseball");
    const set = await row("setName", "Greens", golf);
    const leaf = await row("variantType", "Base", set, {
      ...(opts.leafNoTeam ? { noTeamDefault: { setAt: NOW, setByUserId: LEAF_SETTER } } : {}),
    });
    const player = (name: string, sportId: Sel) =>
      ctx.db.insert("players", { name, nameNormalized: name.toLowerCase(), sportId, lastUpdated: NOW });
    return {
      golf,
      leaf,
      tiger: await player("Tiger Woods", golf),
      rory: await player("Rory McIlroy", golf),
      mookie: await player("Mookie Betts", baseball),
    };
  });
  return { t, fx };
}
type Fx = Awaited<ReturnType<typeof seed>>["fx"];

const seedCard = (t: T, fx: Fx, extra: Partial<Doc<"cardChecklist">> = {}) =>
  t.run(async (ctx) =>
    insertTestCard(ctx, {
      selectorOptionId: fx.leaf,
      cardNumber: "1",
      cardName: "Card 1",
      platformData: { bsc: { ref: "bsc-1", src: "b0" } },
      sortOrder: 1,
      lastUpdated: NOW,
      ...extra,
    }),
  );
const getCard = (t: T, id: Id<"cardChecklist">) => t.run(async (ctx) => ctx.db.get(id));
const apply = (t: T, id: Id<"cardChecklist">, rawTeamName: string, teamNames: string[]) =>
  t.mutation(internal.cardChecklist.applyBscTeamResolution, { cardChecklistId: id, rawTeamName, teamNames });

describe("applyBscTeamResolution for a teamless sport (NEO-426)", () => {
  test("BSC names no team: stamped, credited to the sport's setter, lookup recorded", async () => {
    const { t, fx } = await seed();
    const id = await seedCard(t, fx, { playerIds: [fx.tiger] });
    const before = Date.now();
    expect(await apply(t, id, "", [])).toEqual({ applied: false, unmatched: false });
    const card = (await getCard(t, id))!;
    expect(card.teamNoneConfirmedAt).toBeGreaterThanOrEqual(before);
    expect(card.teamNoneConfirmedByUserId).toBe(SPORT_SETTER);
    expect(card.teamCheckDoneAt).toBe(card.teamNoneConfirmedAt);
    expect(card.teamCheckOutcome).toBe("answered");
    expect(card.teamOnCardIds ?? []).toEqual([]);
  });

  test("BSC's whole claim ruled not a team for the set: stamped the same", async () => {
    const { t, fx } = await seed();
    const id = await seedCard(t, fx, { playerIds: [fx.tiger] });
    await t.run(async (ctx) =>
      ctx.db.insert("entityReviewSkips", {
        selectorOptionId: fx.leaf,
        kind: "team",
        nameNormalized: normalizeEntityName("League Leaders"),
        name: "League Leaders",
        skippedAt: 1,
        skippedByUserId: "user-skipper",
      }),
    );
    await apply(t, id, "League Leaders", ["League Leaders"]);
    const card = (await getCard(t, id))!;
    expect(card.bscTeamName).toBeUndefined();
    expect(card.teamNoneConfirmedByUserId).toBe(SPORT_SETTER);
  });

  test("every part of a split claim ruled not a team: stamped", async () => {
    const { t, fx } = await seed();
    const id = await seedCard(t, fx, { playerIds: [fx.tiger, fx.rory] });
    await t.run(async (ctx) => {
      for (const name of ["Alpha", "Beta"]) {
        await ctx.db.insert("entityReviewSkips", {
          selectorOptionId: fx.leaf,
          kind: "team",
          nameNormalized: normalizeEntityName(name),
          name,
          skippedAt: 1,
          skippedByUserId: "user-skipper",
        });
      }
    });
    await apply(t, id, "Alpha, Beta", ["Alpha", "Beta"]);
    expect((await getCard(t, id))!.teamNoneConfirmedByUserId).toBe(SPORT_SETTER);
  });

  test("only SOME parts ruled out: the live part is a team claim, so nothing is stamped (rule 8)", async () => {
    const { t, fx } = await seed();
    const id = await seedCard(t, fx, { playerIds: [fx.tiger] });
    await t.run(async (ctx) =>
      ctx.db.insert("entityReviewSkips", {
        selectorOptionId: fx.leaf,
        kind: "team",
        nameNormalized: normalizeEntityName("Alpha"),
        name: "Alpha",
        skippedAt: 1,
        skippedByUserId: "user-skipper",
      }),
    );
    await apply(t, id, "Alpha, Gotham Knights", ["Alpha", "Gotham Knights"]);
    const card = (await getCard(t, id))!;
    expect(card.teamNoneConfirmedAt).toBeUndefined();
    expect(card.bscTeamName).toBe("Gotham Knights");
  });

  test("BSC names a team NB holds: linked, never replaced by No team", async () => {
    const { t, fx } = await seed();
    const team = await t.run(async (ctx) =>
      ctx.db.insert("teams", { ...teamRowFields({ location: "Augusta", name: "Nationals" }), sportId: fx.golf, lastUpdated: NOW }),
    );
    const id = await seedCard(t, fx, { playerIds: [fx.tiger] });
    expect(await apply(t, id, "Augusta Nationals", ["Augusta Nationals"])).toEqual({ applied: true, unmatched: false });
    const card = (await getCard(t, id))!;
    expect(card.teamOnCardIds).toEqual([team]);
    expect(card.teamNoneConfirmedAt).toBeUndefined();
  });

  test("BSC names a team NB cannot place: the name stays as a hint, never turned into No team", async () => {
    const { t, fx } = await seed();
    const id = await seedCard(t, fx, { playerIds: [fx.tiger] });
    expect(await apply(t, id, "Gotham Knights", ["Gotham Knights"])).toEqual({ applied: false, unmatched: true });
    const card = (await getCard(t, id))!;
    expect(card.bscTeamName).toBe("Gotham Knights");
    expect(card.teamNoneConfirmedAt).toBeUndefined();
  });

  test.each([
    ["a player name waiting on review", { pendingPlayerNames: ["Unknown Golfer"] }],
    ["a team name waiting on review", { pendingTeamNames: ["Gotham Knights"] }],
    ["no player", {}],
  ])("%s: the lookup is recorded, nothing is stamped", async (_label, extra) => {
    const { t, fx } = await seed();
    const id = await seedCard(t, fx, {
      ...(_label === "no player" ? {} : { playerIds: [fx.tiger] }),
      ...extra,
    } as Partial<Doc<"cardChecklist">>);
    await apply(t, id, "", []);
    const card = (await getCard(t, id))!;
    expect(card.teamCheckDoneAt).toEqual(expect.any(Number));
    expect(card.teamNoneConfirmedAt).toBeUndefined();
  });

  test("a card whose players come from two sports is not stamped", async () => {
    const { t, fx } = await seed();
    const id = await seedCard(t, fx, { playerIds: [fx.tiger, fx.mookie] });
    await apply(t, id, "", []);
    expect((await getCard(t, id))!.teamNoneConfirmedAt).toBeUndefined();
  });

  test("a ballplayer who also plays the flagged sport (playerSports) is not stamped: home sport only", async () => {
    const { t, fx } = await seed();
    await t.run(async (ctx) =>
      ctx.db.insert("playerSports", { playerId: fx.mookie, sportId: fx.golf, nameNormalized: "mookie betts" }),
    );
    const id = await seedCard(t, fx, { playerIds: [fx.mookie] });
    await apply(t, id, "", []);
    expect((await getCard(t, id))!.teamNoneConfirmedAt).toBeUndefined();
  });

  test("the sport is not flagged: BSC's empty answer records the lookup only", async () => {
    const { t, fx } = await seed({ flagged: false });
    const id = await seedCard(t, fx, { playerIds: [fx.tiger] });
    await apply(t, id, "", []);
    const card = (await getCard(t, id))!;
    expect(card.teamCheckDoneAt).toEqual(expect.any(Number));
    expect(card.teamNoneConfirmedAt).toBeUndefined();
  });

  test("the set's own No Team vouches first (credited to its setter), even with no player", async () => {
    const { t, fx } = await seed({ leafNoTeam: true });
    const withGolfer = await seedCard(t, fx, { playerIds: [fx.tiger] });
    const noPlayer = await seedCard(t, fx, { cardNumber: "2" });
    await apply(t, withGolfer, "", []);
    await apply(t, noPlayer, "", []);
    expect((await getCard(t, withGolfer))!.teamNoneConfirmedByUserId).toBe(LEAF_SETTER);
    expect((await getCard(t, noPlayer))!.teamNoneConfirmedByUserId).toBe(LEAF_SETTER);
  });

  test("a card an operator already ruled keeps its own ruling", async () => {
    const { t, fx } = await seed();
    const id = await seedCard(t, fx, {
      playerIds: [fx.tiger],
      teamNoneConfirmedAt: 5,
      teamNoneConfirmedByUserId: "user_operator",
    });
    await apply(t, id, "", []);
    const card = (await getCard(t, id))!;
    expect(card.teamNoneConfirmedAt).toBe(5);
    expect(card.teamNoneConfirmedByUserId).toBe("user_operator");
  });
});
