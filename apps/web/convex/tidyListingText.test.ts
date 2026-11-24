/**
 * NEO-645 T4 — `rebuildListingText` and `regenerateListingNow` called directly
 * (tidyListing.regen.test.ts reaches them through the walk's mutations).
 */
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test } from "vitest";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import { newStoredCardReadCache } from "./storedCardTitle";
import { regenerateListingNow, rebuildListingText } from "./tidyListingText";
import { cancelScheduled } from "../lib/testing/drain-scheduled";
import { addPlayer, printCard, seedTidyWorld } from "../lib/testing/tidy-world";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

type T = ReturnType<typeof convexTest>;
const live: T[] = [];
const newT = () => {
  const t = convexTest(schema, modules);
  live.push(t);
  return t;
};
afterEach(async () => {
  for (const t of live.splice(0)) await cancelScheduled(t);
});

const get = (t: T, id: Id<"cardChecklist">) => t.run((ctx) => ctx.db.get(id));

describe("regenerateListingNow", () => {
  test("overwrites a typed title with the generated one and reports it changed", async () => {
    const t = newT();
    const id = await t.run(async (ctx) => {
      const w = await seedTidyWorld(ctx);
      const soto = await addPlayer(ctx, w, "Juan Soto");
      return printCard(ctx, w, {
        number: "52",
        pendingPlayerNames: [],
        extra: {
          playerIds: [soto],
          playerLinks: [{ playerId: soto, nameOnCard: "Juan Soto" }],
          listingTitle: "Typed by hand",
        },
      });
    });
    const res = await t.run((ctx) => regenerateListingNow(ctx, id));
    expect(res).toEqual({ titleChanged: true });
    const after = (await get(t, id))!;
    expect(after.listingTitle).toContain("Juan Soto");
    expect(after.listingTitle).not.toBe("Typed by hand");
  });

  test("a second call changes nothing: no patch, titleChanged false", async () => {
    const t = newT();
    const id = await t.run(async (ctx) => {
      const w = await seedTidyWorld(ctx);
      const soto = await addPlayer(ctx, w, "Juan Soto");
      return printCard(ctx, w, {
        number: "52",
        pendingPlayerNames: [],
        extra: { playerIds: [soto], playerLinks: [{ playerId: soto, nameOnCard: "Juan Soto" }] },
      });
    });
    await t.run((ctx) => regenerateListingNow(ctx, id));
    const first = (await get(t, id))!;
    const res = await t.run((ctx) => regenerateListingNow(ctx, id));
    expect(res).toEqual({ titleChanged: false });
    expect(await get(t, id)).toEqual(first);
  });

  test("a card that no longer exists is a no-op", async () => {
    const t = newT();
    const id = await t.run(async (ctx) => {
      const w = await seedTidyWorld(ctx);
      const c = await printCard(ctx, w, { number: "1" });
      await ctx.db.delete(c);
      return c;
    });
    expect(await t.run((ctx) => regenerateListingNow(ctx, id))).toEqual({ titleChanged: false });
  });

  test("a card with no player and a cameo is titled with its name, then the cameo", async () => {
    const t = newT();
    const id = await t.run(async (ctx) => {
      const w = await seedTidyWorld(ctx);
      const lindor = await addPlayer(ctx, w, "Francisco Lindor");
      return printCard(ctx, w, {
        number: "7",
        pendingPlayerNames: [],
        extra: { cardName: "Checklist", secondaryPlayerIds: [lindor] },
      });
    });
    await t.run((ctx) => regenerateListingNow(ctx, id));
    const title = (await get(t, id))!.listingTitle!;
    expect(title).toContain("Checklist");
    expect(title).toContain("Francisco Lindor");
    expect(title.indexOf("Checklist")).toBeLessThan(title.indexOf("Francisco Lindor"));
  });

  test("over 80 characters the cameo is cut before the core and the cut flag stays unset", async () => {
    const t = newT();
    const id = await t.run(async (ctx) => {
      const w = await seedTidyWorld(ctx);
      const soto = await addPlayer(ctx, w, "Juan Soto");
      const cameo = await addPlayer(ctx, w, "Bartholomew Wolfeschlegelsteinhausenbergerdorff Montgomery Featherstonehaugh");
      return printCard(ctx, w, {
        number: "52",
        pendingPlayerNames: [],
        extra: {
          playerIds: [soto],
          playerLinks: [{ playerId: soto, nameOnCard: "Juan Soto" }],
          secondaryPlayerIds: [cameo],
        },
      });
    });
    await t.run((ctx) => regenerateListingNow(ctx, id));
    const after = (await get(t, id))!;
    expect(after.listingTitle!.length).toBeLessThanOrEqual(80);
    expect(after.listingTitle).toContain("Juan Soto");
    expect(after.listingTitle).not.toContain("Wolfeschlegelstein");
    expect(after.listingTitleTruncated).toBeUndefined();
  });

  test("a dangling player id leaves the stored description alone", async () => {
    const t = newT();
    const id = await t.run(async (ctx) => {
      const w = await seedTidyWorld(ctx);
      const gone = await addPlayer(ctx, w, "Gone Player");
      const c = await printCard(ctx, w, {
        number: "9",
        pendingPlayerNames: [],
        extra: { playerIds: [gone], listingDescription: "Stored text" },
      });
      await ctx.db.delete(gone);
      return c;
    });
    await t.run((ctx) => regenerateListingNow(ctx, id));
    expect((await get(t, id))!.listingDescription).toBe("Stored text");
  });
});

describe("rebuildListingText", () => {
  test("adds title and description to the patch without writing the card", async () => {
    const t = newT();
    const { id, card } = await t.run(async (ctx) => {
      const w = await seedTidyWorld(ctx);
      const soto = await addPlayer(ctx, w, "Juan Soto");
      const c = await printCard(ctx, w, {
        number: "52",
        pendingPlayerNames: [],
        extra: { playerIds: [soto], listingTitle: "Typed" },
      });
      return { id: c, card: (await ctx.db.get(c))! };
    });
    const patch: Partial<Doc<"cardChecklist">> = {};
    const res = await t.run((ctx) =>
      rebuildListingText(ctx, card, patch, newStoredCardReadCache()),
    );
    expect(res.titleChanged).toBe(true);
    expect(patch.listingTitle).toContain("Juan Soto");
    expect(patch.listingDescription).toBeTruthy();
    expect((await get(t, id))!.listingTitle).toBe("Typed");
  });
});
