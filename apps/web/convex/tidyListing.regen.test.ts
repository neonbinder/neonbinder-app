/**
 * NEO-645 T4 — every write the Tidy Up walk makes to a card rebuilds that
 * card's listing title and description, ALWAYS (Jason, 2026-11-22: "yes always
 * overwrite we do not need to track if the user has typed in the field").
 *
 * The stale cards from testing: "…Juan Soto #52 New York Mets Baseball"
 * carrying "Left out to fit: Francisco Lindor" (a cameo added after the title
 * was written) and "#117" carrying "Left out to fit: San Francisco Giants" (a
 * team added after). "Left out to fit" is not stored: the tile reads it from the
 * stored title and the card's facts (`leftOutOfTitle`), so a rebuilt title is
 * the whole of recomputing it. The tests read it the way the tile does.
 *
 * A write that does NOT carry `regenerateListing` (the Set Builder card panel's
 * own saves) keeps a typed title: that is pinned too.
 */

import { convexTest } from "convex-test";
import { afterEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { listingInputsForStoredCard, newStoredCardReadCache } from "./storedCardTitle";
import { assessListingTitle, leftOutOfTitle } from "./features/generateListing";
import { cancelScheduled } from "../lib/testing/drain-scheduled";
import { addPlayer, addTeam, printCard, seedTidyWorld } from "../lib/testing/tidy-world";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const ADMIN = { subject: "user_tidy_regen_admin", role: "admin" };
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

const STALE = "Typed by hand, out of date";

async function setup(t: T) {
  return t.run(async (ctx) => {
    const w = await seedTidyWorld(ctx);
    const soto = await addPlayer(ctx, w, "Juan Soto");
    const lindor = await addPlayer(ctx, w, "Francisco Lindor");
    const giants = await addTeam(ctx, w, "San Francisco", "Giants", { leagueId: w.league });
    const card = await printCard(ctx, w, {
      number: "52",
      pendingPlayerNames: [],
      extra: {
        playerIds: [soto],
        playerLinks: [{ playerId: soto, nameOnCard: "Juan Soto" }],
        teamOnCardIds: [w.mets],
        listingTitle: STALE,
      },
    });
    return { w, soto, lindor, giants, card };
  });
}

const get = (t: T, id: Id<"cardChecklist">) => t.run((ctx) => ctx.db.get(id));

/** What the tile shows as "Left out to fit", from the stored title and facts. */
async function leftOut(t: T, id: Id<"cardChecklist">): Promise<string[]> {
  return t.run(async (ctx) => {
    const card = (await ctx.db.get(id))!;
    const { inputs } = await listingInputsForStoredCard(ctx, card, newStoredCardReadCache());
    return leftOutOfTitle(inputs, card.listingTitle ?? "");
  });
}

/** The generator's own title for the card as stored now. */
async function generated(t: T, id: Id<"cardChecklist">) {
  return t.run(async (ctx) => {
    const card = (await ctx.db.get(id))!;
    const { inputs } = await listingInputsForStoredCard(ctx, card, newStoredCardReadCache());
    return assessListingTitle(inputs);
  });
}

describe("T4: a change after the save rebuilds the title and its cut note", () => {
  test("a cameo added after the title was written: the title names him and the cut note clears", async () => {
    const t = newT();
    const { card, lindor } = await setup(t);
    // The state seen in testing: the cameo is on the card, the title is not
    // current, and the tile says the cameo was left out.
    await t.run((ctx) => ctx.db.patch(card, { secondaryPlayerIds: [lindor] }));
    await t.run((ctx) => ctx.db.patch(card, { listingTitle: "2024 Topps Chrome Base Juan Soto #52 New York Mets Baseball" }));
    expect(await leftOut(t, card)).toEqual(["Francisco Lindor"]);

    // Any walk write rebuilds it. Here: the cameo list is written again, by the walk.
    await t
      .withIdentity(ADMIN)
      .mutation(api.cardSecondaryPlayers.setSecondaryPlayers, {
        cardId: card,
        playerIds: [lindor],
        regenerateListing: true,
      });
    const after = (await get(t, card))!;
    expect(after.listingTitle).toContain("Francisco Lindor");
    expect(after.listingTitle).toBe((await generated(t, card)).title);
    expect(await leftOut(t, card)).toEqual([]);
    expect(after.listingTitleTruncated).toBeUndefined();
  });

  test("a team added after the title was written: the title names it and the cut note clears", async () => {
    const t = newT();
    const { card, w, giants } = await setup(t);
    await t.run((ctx) => ctx.db.patch(card, { teamOnCardIds: [w.mets, giants] }));
    await t.run((ctx) => ctx.db.patch(card, { listingTitle: "2024 Topps Chrome Base Juan Soto #52 New York Mets Baseball" }));
    expect(await leftOut(t, card)).toEqual(["San Francisco Giants"]);

    await t.withIdentity(ADMIN).mutation(api.selectorOptions.updateCard, {
      id: card,
      teamOnCardIds: [w.mets, giants],
      regenerateListing: true,
    });
    const after = (await get(t, card))!;
    expect(after.listingTitle).toContain("Giants");
    expect(after.listingTitle).toBe((await generated(t, card)).title);
    expect(await leftOut(t, card)).toEqual([]);
  });

  test("the stored cut flag follows the new assessment: set when the core was cut, cleared when it fits", async () => {
    const t = newT();
    const { card, lindor } = await setup(t);
    await t.run((ctx) => ctx.db.patch(card, { listingTitleTruncated: true }));
    await t
      .withIdentity(ADMIN)
      .mutation(api.cardSecondaryPlayers.setSecondaryPlayers, {
        cardId: card,
        playerIds: [lindor],
        regenerateListing: true,
      });
    const after = (await get(t, card))!;
    expect((await generated(t, card)).coreFits).toBe(true);
    expect(after.listingTitleTruncated).toBeUndefined();
  });

  test("the description is rebuilt with the title, a typed one included", async () => {
    const t = newT();
    const { card, lindor } = await setup(t);
    await t.run((ctx) => ctx.db.patch(card, { listingDescription: "Typed by hand" }));
    await t
      .withIdentity(ADMIN)
      .mutation(api.cardSecondaryPlayers.setSecondaryPlayers, {
        cardId: card,
        playerIds: [lindor],
        regenerateListing: true,
      });
    const after = (await get(t, card))!;
    expect(after.listingDescription).not.toBe("Typed by hand");
    expect(after.listingDescription).toContain("Francisco Lindor");
  });
});

describe("T4: every walk write rebuilds a typed title", () => {
  test("updateCard (a player linked)", async () => {
    const t = newT();
    const { card, lindor } = await setup(t);
    await t.withIdentity(ADMIN).mutation(api.selectorOptions.updateCard, {
      id: card,
      playerIds: [lindor],
      regenerateListing: true,
    });
    const after = (await get(t, card))!;
    expect(after.listingTitle).toContain("Lindor");
    expect(after.listingTitle).not.toBe(STALE);
  });

  test("updateCard (a team changed)", async () => {
    const t = newT();
    const { card, w } = await setup(t);
    await t.withIdentity(ADMIN).mutation(api.selectorOptions.updateCard, {
      id: card,
      teamOnCardIds: [w.padres],
      regenerateListing: true,
    });
    const after = (await get(t, card))!;
    expect(after.listingTitle).toContain("Padres");
    expect(after.listingTitle).not.toContain("Mets");
  });

  test("updateCard (a variation saved)", async () => {
    const t = newT();
    const { card } = await setup(t);
    await t.withIdentity(ADMIN).mutation(api.selectorOptions.updateCard, {
      id: card,
      cardVariation: "Photo Variation",
      regenerateListing: true,
    });
    expect((await get(t, card))!.listingTitle).toContain("Photo Variation");
  });

  test("updateCard: a title sent in the same call is the operator's words and is kept", async () => {
    const t = newT();
    const { card, lindor } = await setup(t);
    await t.withIdentity(ADMIN).mutation(api.selectorOptions.updateCard, {
      id: card,
      playerIds: [lindor],
      listingTitle: "My own words",
      regenerateListing: true,
    });
    expect((await get(t, card))!.listingTitle).toBe("My own words");
  });

  test("setCardFeature (autographed)", async () => {
    const t = newT();
    const { card } = await setup(t);
    await t.withIdentity(ADMIN).mutation(api.selectorOptions.setCardFeature, {
      cardChecklistId: card,
      key: "autographed",
      value: "Certified Autograph",
      regenerateListing: true,
    });
    const after = (await get(t, card))!;
    expect(after.listingTitle).not.toBe(STALE);
    expect(after.listingTitle).toBe((await generated(t, card)).title);
  });

  test("confirmCardNoTeam (No team on this card)", async () => {
    const t = newT();
    const { card } = await setup(t);
    await t.run((ctx) => ctx.db.patch(card, { teamOnCardIds: undefined }));
    const out = await t
      .withIdentity(ADMIN)
      .mutation(api.cardChecklist.confirmCardNoTeam, { cardId: card, regenerateListing: true });
    expect(out.confirmed).toBe(true);
    const after = (await get(t, card))!;
    expect(after.listingTitle).not.toBe(STALE);
    expect(after.listingTitle).toBe((await generated(t, card)).title);
  });

  test("pickSourceValue that moves no name (a teams pick of 'no team') still rebuilds", async () => {
    const t = newT();
    const { card } = await setup(t);
    await t.run((ctx) =>
      ctx.db.patch(card, {
        teamOnCardIds: undefined,
        sourceDisagreements: [
          {
            field: "teams" as const,
            values: [
              { value: [], sources: ["bsc"] },
              { value: ["Mets"], sources: ["checklist"] },
            ],
          },
        ],
      } as never),
    );
    await t
      .withIdentity(ADMIN)
      .mutation(api.tidyCards.pickSourceValue, { cardId: card, field: "teams", value: [] });
    const after = (await get(t, card))!;
    expect(after.listingTitle).not.toBe(STALE);
    expect(after.listingTitle).toBe((await generated(t, card)).title);
  });

  test("answerName rebuilds this card's title, a typed one included; Apply to all rebuilds the others", async () => {
    const t = newT();
    const { w, lindor } = await setup(t);
    const [one, two] = await t.run(async (ctx) => {
      const mk = (n: string) =>
        printCard(ctx, w, {
          number: n,
          printed: [{ kind: "player", name: "Francisco Lindor" }],
          extra: { listingTitle: STALE },
        });
      return [await mk("1"), await mk("2")] as const;
    });
    await t.withIdentity(ADMIN).mutation(api.tidyNames.answerName, {
      cardId: one,
      kind: "player",
      name: "Francisco Lindor",
      sportId: w.sport,
      answer: { kind: "linkPlayer", playerId: lindor },
    });
    const first = (await get(t, one))!;
    expect(first.playerIds).toEqual([lindor]);
    expect(first.listingTitle).toContain("Lindor");
    expect(first.listingTitle).not.toBe(STALE);
    // The other card is untouched until Apply to all.
    expect((await get(t, two))!.listingTitle).toBe(STALE);

    await t.withIdentity(ADMIN).action(api.tidyNames.applyNameToAll, {
      cardId: one,
      kind: "player",
      name: "Francisco Lindor",
      answer: { kind: "linkPlayer", playerId: lindor },
    });
    const c = (await get(t, two))!;
    expect(c.playerIds).toEqual([lindor]);
    expect(c.listingTitle).toContain("Lindor");
    expect(c.listingTitle).not.toBe(STALE);
  });
});

describe("T4: a save from the Set Builder panel does not carry the flag and keeps a typed title", () => {
  test("updateCard without regenerateListing", async () => {
    const t = newT();
    const { card, lindor } = await setup(t);
    await t.withIdentity(ADMIN).mutation(api.selectorOptions.updateCard, {
      id: card,
      playerIds: [lindor],
    });
    expect((await get(t, card))!.listingTitle).toBe(STALE);
  });

  test("setSecondaryPlayers without regenerateListing", async () => {
    const t = newT();
    const { card, lindor } = await setup(t);
    await t
      .withIdentity(ADMIN)
      .mutation(api.cardSecondaryPlayers.setSecondaryPlayers, { cardId: card, playerIds: [lindor] });
    expect((await get(t, card))!.listingTitle).toBe(STALE);
  });
});
