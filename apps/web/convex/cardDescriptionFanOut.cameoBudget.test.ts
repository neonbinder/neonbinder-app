/**
 * NEO-535 — a player rename's cameo leg spends only what the player leg left
 * of the run's card budget.
 *
 * A renamed player's own cards come first (`cardPlayerLinks`), then the cards
 * picturing them as a cameo (`cardSecondaryPlayerLinks`). The cameo leg starts
 * in the same run once the player's page comes back short; it used to start
 * with a fresh `RENAME_DESCRIPTION_PAGE`, so one transaction (the operator's
 * inline rename among them) could rebuild nearly two pages of cards, each
 * reading its players and cameos, close to Convex's per-transaction read
 * ceiling. Pinned here: no run rebuilds more than one page of cards, the chain
 * takes the rest, every card is rebuilt exactly once, and a small rename still
 * finishes in its own transaction and schedules nothing.
 */

import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import { generateListingDescription } from "./features/generateListing";
import { listingInputsForStoredCard } from "./storedCardTitle";
import {
  RENAME_DESCRIPTION_PAGE,
  refreshDescriptionsAfterRename,
  type RenameTarget,
} from "./cardDescriptionFanOut";
import { seedCollectionCatalog } from "../lib/testing/collection-fixture";

const modules = (
  import.meta as unknown as {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("./**/*.*s");

const ADMIN_IDENTITY = {
  subject: "admin_user_001",
  issuer: "https://clerk.example.com",
  tokenIdentifier: "clerk|admin_user_001",
  name: "Admin User",
  role: "admin",
};

const OLD_NAME = "Darryl Strawberry";
const NEW_NAME = "Darryl Eugene Strawberry";

type T = ReturnType<typeof convexTest>;
type Fx = Awaited<ReturnType<typeof seedCollectionCatalog>>;
type CardId = Id<"cardChecklist">;

afterEach(() => {
  vi.useRealTimers();
});

async function builderDescription(
  ctx: Parameters<Parameters<T["run"]>[0]>[0],
  card: Doc<"cardChecklist">,
): Promise<string> {
  return generateListingDescription((await listingInputsForStoredCard(ctx, card)).inputs);
}

/**
 * Strawberry with `own` cards of his own (the fixture's #2 counts as one) and
 * `cameos` of Gooden's cards picturing him as a cameo, every description
 * exactly the builder's, so every card the walk visits is one it rewrites.
 */
async function seed(own: number, cameos: number) {
  const t = convexTest(schema, modules);
  const fx = await seedCollectionCatalog(t);
  const ownIds: CardId[] = [fx.strawberry2];
  const cameoIds: CardId[] = [];
  await t.run(async (ctx) => {
    const insertCard = async (
      i: number,
      playerId: Id<"players">,
      secondaryPlayerIds?: Array<Id<"players">>,
    ): Promise<CardId> => {
      const id = (await ctx.db.insert("cardChecklist", {
        selectorOptionId: fx.baseId,
        cardNumber: `B-${i}`,
        cardName: "Bulk card",
        playerIds: [playerId],
        playerLinks: [{ playerId, nameOnCard: "Bulk card" }],
        ...(secondaryPlayerIds ? { secondaryPlayerIds } : {}),
        teamOnCardIds: [fx.metsId],
        listingTitle: `Bulk card ${i}`,
        sportId: fx.sportId,
        platformData: {},
        sortOrder: 100 + i,
        lastUpdated: 0,
      } as never)) as CardId;
      await ctx.db.insert("cardPlayerLinks", {
        cardChecklistId: id,
        playerId,
        sportId: fx.sportId,
      });
      await ctx.db.insert("cardTeamLinks", { cardChecklistId: id, teamId: fx.metsId });
      for (const cameoId of secondaryPlayerIds ?? []) {
        await ctx.db.insert("cardSecondaryPlayerLinks", {
          cardChecklistId: id,
          playerId: cameoId,
          sportId: fx.sportId,
        });
      }
      return id;
    };
    for (let i = 1; i < own; i++) ownIds.push(await insertCard(i, fx.strawberryId));
    for (let i = 0; i < cameos; i++) {
      cameoIds.push(await insertCard(1000 + i, fx.goodenId, [fx.strawberryId]));
    }
    for (const id of [...ownIds, ...cameoIds]) {
      const card = (await ctx.db.get(id))!;
      await ctx.db.patch(id, { listingDescription: await builderDescription(ctx, card) });
    }
  });
  return { t, fx, ownIds, cameoIds };
}

async function fanOutJobs(t: T) {
  return t.run(async (ctx) =>
    (await ctx.db.system.query("_scheduled_functions").collect()).filter((job) =>
      job.name.includes("refreshRenamedCardDescriptions"),
    ),
  );
}

async function renamedCount(t: T, ids: CardId[]): Promise<number> {
  return t.run(async (ctx) => {
    let n = 0;
    for (const id of ids) {
      if ((await ctx.db.get(id))?.listingDescription?.includes(NEW_NAME)) n += 1;
    }
    return n;
  });
}

/** Ids among `ids` whose description is not the builder's for the card as stored now. */
async function staleIds(t: T, ids: CardId[]): Promise<CardId[]> {
  return t.run(async (ctx) => {
    const stale: CardId[] = [];
    for (const id of ids) {
      const card = (await ctx.db.get(id))!;
      if (card.listingDescription !== (await builderDescription(ctx, card))) stale.push(id);
    }
    return stale;
  });
}

describe("a player rename's cameo leg shares the run's card budget", () => {
  test("60 own + 60 cameo cards: one run rebuilds at most a page, the chain the rest, each card once", async () => {
    // The scheduler must not run the chain on its own: this test runs each
    // page by hand to read what it rewrote.
    vi.useFakeTimers();
    const { t, fx, ownIds, cameoIds } = await seed(60, 60);
    const all = [...ownIds, ...cameoIds];
    const target: RenameTarget = {
      kind: "player",
      playerId: fx.strawberryId,
      before: { name: OLD_NAME },
    };

    // The rename and its inline first page, as the operator's door runs them.
    const inline = await t.run(async (ctx) => {
      await ctx.db.patch(fx.strawberryId, { name: NEW_NAME });
      return refreshDescriptionsAfterRename(ctx, target, { inline: true });
    });
    expect(inline).toBe(RENAME_DESCRIPTION_PAGE);
    expect(await renamedCount(t, all)).toBe(RENAME_DESCRIPTION_PAGE);
    // The player leg finished inline; the chain carries on in the cameo leg.
    expect(await renamedCount(t, ownIds)).toBe(ownIds.length);

    const perRun = [inline];
    const seen = new Set<string>();
    for (let guard = 0; guard < 10; guard++) {
      const job = (await fanOutJobs(t)).find((j) => !seen.has(j._id));
      if (!job) break;
      seen.add(job._id);
      const args = job.args[0] as {
        target: RenameTarget;
        state: { kind: string };
        pagesLeft: number;
      };
      expect(args.state.kind).toBe("cameoLinks");
      const result = await t.mutation(
        internal.cardDescriptionFanOut.refreshRenamedCardDescriptions,
        args as never,
      );
      perRun.push(result.rewritten);
      if (result.done) break;
    }

    for (const rewritten of perRun) expect(rewritten).toBeLessThanOrEqual(RENAME_DESCRIPTION_PAGE);
    // Every card was rebuilt, and the runs together wrote each exactly once.
    expect(perRun.reduce((a, b) => a + b, 0)).toBe(all.length);
    expect(await renamedCount(t, all)).toBe(all.length);
    expect(await staleIds(t, all)).toEqual([]);
    expect(perRun).toEqual([RENAME_DESCRIPTION_PAGE, all.length - RENAME_DESCRIPTION_PAGE]);
  });

  test("through the operator's rename door: a page inline, one scheduled page finishes it", async () => {
    vi.useFakeTimers();
    const { t, fx, ownIds, cameoIds } = await seed(60, 60);
    const all = [...ownIds, ...cameoIds];

    await t.withIdentity(ADMIN_IDENTITY).mutation(api.players.savePlayerFields, {
      id: fx.strawberryId,
      name: NEW_NAME,
    });
    expect(await renamedCount(t, all)).toBe(RENAME_DESCRIPTION_PAGE);
    const pending = (await fanOutJobs(t)).filter((job) => job.state.kind === "pending");
    expect(pending).toHaveLength(1);
    expect((pending[0].args[0] as { state: unknown }).state).toMatchObject({
      kind: "cameoLinks",
      after: { sportId: fx.sportId, creationTime: expect.any(Number) },
    });

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await renamedCount(t, all)).toBe(all.length);
    expect(await staleIds(t, all)).toEqual([]);
  });

  test("a nearly full player page leaves the cameo leg a sliver, and the chain the rest", async () => {
    vi.useFakeTimers();
    const { t, fx, ownIds, cameoIds } = await seed(RENAME_DESCRIPTION_PAGE - 1, 5);

    await t.withIdentity(ADMIN_IDENTITY).mutation(api.players.savePlayerFields, {
      id: fx.strawberryId,
      name: NEW_NAME,
    });
    expect(await renamedCount(t, ownIds)).toBe(ownIds.length);
    expect(await renamedCount(t, cameoIds)).toBe(1);

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await renamedCount(t, cameoIds)).toBe(cameoIds.length);
    expect(await staleIds(t, [...ownIds, ...cameoIds])).toEqual([]);
  });

  test("a small rename (30 own + 30 cameo) finishes in its own transaction and schedules nothing", async () => {
    vi.useFakeTimers();
    const { t, fx, ownIds, cameoIds } = await seed(30, 30);
    const all = [...ownIds, ...cameoIds];

    await t.withIdentity(ADMIN_IDENTITY).mutation(api.players.savePlayerFields, {
      id: fx.strawberryId,
      name: NEW_NAME,
    });
    expect(await renamedCount(t, all)).toBe(all.length);
    expect(await fanOutJobs(t)).toHaveLength(0);
  });
});
