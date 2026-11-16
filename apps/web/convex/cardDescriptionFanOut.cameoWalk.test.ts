/**
 * NEO-528 + NEO-535 — a renamed player's cameo walk across several pages and
 * across a sport boundary. The cameo index is `[playerId, sportId]`, so the
 * cursor is `(sportId, creationTime)`: the page that crosses from one sport to
 * the next must neither skip nor repeat a card, no run may rebuild more than
 * one page of cards, and the chain must end. (The shared per-run budget is
 * `cardDescriptionFanOut.cameoBudget.test.ts`; this is the multi-page walk.)
 */

import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import { generateListingDescription } from "./features/generateListing";
import { listingInputsForStoredCard } from "./storedCardTitle";
import {
  RENAME_DESCRIPTION_PAGE,
  refreshDescriptionsAfterRename,
  type RenameTarget,
} from "./cardDescriptionFanOut";
import { cardSecondaryPlayerLinkPageAfter } from "./cardSecondaryPlayers";
import { seedCollectionCatalog } from "../lib/testing/collection-fixture";

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/*.*s");

const NEW_NAME = "Darryl Eugene Strawberry";
const IN_BASEBALL = 130;
const IN_FOOTBALL = 120;

type T = ReturnType<typeof convexTest>;
type CardId = Id<"cardChecklist">;

afterEach(() => {
  vi.useRealTimers();
});

/** Strawberry pictured as a cameo on cards in two sports, every description the builder's. */
async function seed() {
  const t = convexTest(schema, modules);
  const fx = await seedCollectionCatalog(t);
  const { footballId, cameoIds } = await t.run(async (ctx) => {
    const footballId = await ctx.db.insert("selectorOptions", {
      level: "sport",
      value: "Football",
      platformData: {},
      children: [],
      lastUpdated: 0,
    } as never);
    const cameoIds: CardId[] = [];
    const insertCard = async (i: number, sportId: Id<"selectorOptions">) => {
      const id = (await ctx.db.insert("cardChecklist", {
        selectorOptionId: fx.baseId,
        cardNumber: `C-${i}`,
        cardName: "Bulk card",
        playerIds: [fx.goodenId],
        playerLinks: [{ playerId: fx.goodenId, nameOnCard: "Bulk card" }],
        secondaryPlayerIds: [fx.strawberryId],
        listingTitle: `Bulk card ${i}`,
        sportId,
        platformData: {},
        sortOrder: 100 + i,
        lastUpdated: 0,
      } as never)) as CardId;
      await ctx.db.insert("cardPlayerLinks", { cardChecklistId: id, playerId: fx.goodenId, sportId });
      await ctx.db.insert("cardSecondaryPlayerLinks", {
        cardChecklistId: id,
        playerId: fx.strawberryId,
        sportId,
      });
      const card = (await ctx.db.get(id))!;
      await ctx.db.patch(id, {
        listingDescription: generateListingDescription(
          (await listingInputsForStoredCard(ctx, card)).inputs,
        ),
      });
      cameoIds.push(id);
    };
    for (let i = 0; i < IN_BASEBALL; i++) await insertCard(i, fx.sportId);
    for (let i = 0; i < IN_FOOTBALL; i++) await insertCard(1000 + i, footballId);
    return { footballId, cameoIds };
  });
  return { t, fx, footballId, cameoIds };
}

const renamed = (t: T, ids: CardId[]) =>
  t.run(async (ctx) => {
    let n = 0;
    for (const id of ids) {
      if ((await ctx.db.get(id))?.listingDescription?.includes(NEW_NAME)) n += 1;
    }
    return n;
  });

const jobs = (t: T) =>
  t.run(async (ctx) =>
    (await ctx.db.system.query("_scheduled_functions").collect()).filter((job) =>
      job.name.includes("refreshRenamedCardDescriptions"),
    ),
  );

describe("a renamed player's cameo walk over several pages and two sports", () => {
  test("the index cursor visits every cameo card exactly once across the sport boundary", async () => {
    const { t, fx, cameoIds } = await seed();
    const visited = await t.run(async (ctx) => {
      const ids: string[] = [];
      const cursors: Array<{ sportId: Id<"selectorOptions">; creationTime: number } | null> = [];
      let after: { sportId: Id<"selectorOptions">; creationTime: number } | null = null;
      for (let guard = 0; guard < 10; guard++) {
        const rows: Doc<"cardSecondaryPlayerLinks">[] = await cardSecondaryPlayerLinkPageAfter(
          ctx,
          fx.strawberryId,
          after,
          RENAME_DESCRIPTION_PAGE,
        );
        for (const row of rows) ids.push(row.cardChecklistId);
        if (rows.length < RENAME_DESCRIPTION_PAGE) break;
        const last = rows[rows.length - 1];
        after = { sportId: last.sportId, creationTime: last._creationTime };
        cursors.push(after);
      }
      return { ids, cursors };
    });
    expect(visited.ids).toHaveLength(cameoIds.length);
    expect(new Set(visited.ids).size).toBe(cameoIds.length);
    expect(new Set(visited.ids)).toEqual(new Set(cameoIds));
    // The walk really crossed a sport: the page cursors name both.
    expect(new Set(visited.cursors.map((c) => c?.sportId)).size).toBe(2);
  });

  test("the chain rebuilds each card once, no run over one page, and ends", async () => {
    vi.useFakeTimers();
    const { t, fx, footballId, cameoIds } = await seed();
    const target: RenameTarget = {
      kind: "player",
      playerId: fx.strawberryId,
      before: { name: "Darryl Strawberry" },
    };
    const inline = await t.run(async (ctx) => {
      await ctx.db.patch(fx.strawberryId, { name: NEW_NAME });
      return refreshDescriptionsAfterRename(ctx, target, { inline: true });
    });
    const perRun = [inline];
    const cursorSports = new Set<string>();
    const seen = new Set<string>();
    let finished = false;
    for (let guard = 0; guard < 10 && !finished; guard++) {
      const job = (await jobs(t)).find((j) => !seen.has(j._id));
      if (!job) break;
      seen.add(job._id);
      const args = job.args[0] as {
        state: { kind: string; after?: { sportId: string } | null };
      };
      expect(args.state.kind).toBe("cameoLinks");
      if (args.state.after) cursorSports.add(args.state.after.sportId);
      const result = await t.mutation(
        internal.cardDescriptionFanOut.refreshRenamedCardDescriptions,
        args as never,
      );
      perRun.push(result.rewritten);
      finished = result.done;
    }

    expect(finished).toBe(true);
    for (const rewritten of perRun) expect(rewritten).toBeLessThanOrEqual(RENAME_DESCRIPTION_PAGE);
    // Every cameo card, each written by exactly one run.
    expect(perRun.reduce((a, b) => a + b, 0)).toBe(cameoIds.length);
    expect(await renamed(t, cameoIds)).toBe(cameoIds.length);
    // The cursors handed from page to page named both sports.
    expect(cursorSports).toEqual(new Set([fx.sportId as string, footballId as string]));
    // Nothing is left scheduled that has not already been run by hand.
    expect((await jobs(t)).filter((j) => j.state.kind === "pending" && !seen.has(j._id))).toEqual([]);
  });
});
