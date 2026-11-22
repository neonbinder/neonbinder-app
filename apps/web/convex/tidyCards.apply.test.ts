/**
 * NEO-645 — the bulk writers of `tidyCards.ts`:
 *
 *   - `applyTeamToPlayerCards`: the guarded "Apply to all" on the Team tile. A
 *     card takes the team only when NOTHING on it names or rules out a team
 *     (rule 8: a data claim holds back a guess) AND `careerTeamVerdict` gives
 *     exactly that one team for the card's year;
 *   - `applyVariation`: compare-and-set on `cardVariation === from`;
 *   - `applySetNameToTitles`: the NEO-637 rules, server-side.
 */

import { convexTest } from "convex-test";
import { afterEach, describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import {
  APPLY_PAGE_SIZE,
  MAX_APPLY_CARDS,
  MAX_VARIATION_LENGTH,
} from "./tidyCards";
import { newStoredCardReadCache, listingInputsForStoredCard } from "./storedCardTitle";
import { assessListingTitle, titleDescription } from "./features/generateListing";
import { cancelScheduled, drainScheduled } from "../lib/testing/drain-scheduled";
import {
  addPlayer,
  printCard,
  seedTidyWorld,
  stampGeneratedTitle,
  WORLD_NOW,
  type TidyWorld,
} from "../lib/testing/tidy-world";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const ADMIN = { subject: "user_tidy_apply_admin", role: "admin" };
const MEMBER = { subject: "user_tidy_apply_member" };
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
const card = (t: T, id: Id<"cardChecklist">) => t.run((ctx) => ctx.db.get(id));

// ───────────────────────────────────────────────────────────────────────────
// applyTeamToPlayerCards
// ───────────────────────────────────────────────────────────────────────────

type TeamWorld = {
  w: TidyWorld;
  merrill: Id<"players">;
  trader: Id<"players">;
  other: Id<"players">;
  source: Id<"cardChecklist">;
  /** A leaf of the set year 2022, when Merrill was a Met. */
  leaf2022: Id<"selectorOptions">;
};

async function teamWorld(t: T): Promise<TeamWorld> {
  return t.run(async (ctx) => {
    const w = await seedTidyWorld(ctx); // set year 2024
    const merrill = await addPlayer(ctx, w, "Jackson Merrill", [
      { teamId: w.padres, fromYear: 2024 },
      { teamId: w.mets, fromYear: 2020, toYear: 2022 },
    ]);
    // Two teams in the same year: the career gives no ONE team.
    const trader = await addPlayer(ctx, w, "Trade Deadline", [
      { teamId: w.padres, fromYear: 2024 },
      { teamId: w.mets, fromYear: 2024 },
    ]);
    const other = await addPlayer(ctx, w, "Somebody Else", [{ teamId: w.padres, fromYear: 2024 }]);
    const node = (level: Doc<"selectorOptions">["level"], value: string, parentId: Id<"selectorOptions">) =>
      ctx.db.insert("selectorOptions", {
        level,
        value,
        parentId,
        platformData: {},
        children: [],
        lastUpdated: WORLD_NOW,
      });
    const y22 = await node("year", "2022", w.sport);
    const b22 = await node("manufacturer", "Topps", y22);
    const s22 = await node("setName", "Chrome", b22);
    const leaf2022 = await node("variantType", "Base", s22);
    const source = await printCard(ctx, w, {
      number: "1",
      extra: {
        playerIds: [merrill],
        playerLinks: [{ playerId: merrill, nameOnCard: "Jackson Merrill" }],
        teamOnCardIds: [w.padres],
      },
    });
    return { w, merrill, trader, other, source, leaf2022 };
  });
}

const merrillCard = (
  t: T,
  tw: TeamWorld,
  n: string,
  extra: Record<string, unknown> = {},
  leaf?: Id<"selectorOptions">,
) =>
  t.run((ctx) =>
    printCard(ctx, tw.w, {
      leaf,
      number: n,
      extra: {
        playerIds: [tw.merrill],
        playerLinks: [{ playerId: tw.merrill, nameOnCard: "Jackson Merrill" }],
        ...extra,
      },
    }),
  );

const applyTeam = (
  t: T,
  tw: TeamWorld,
  cardIds: Array<Id<"cardChecklist">>,
  over: { sourceCardId?: Id<"cardChecklist">; teamId?: Id<"teams"> } = {},
) =>
  t.withIdentity(ADMIN).mutation(api.tidyCards.applyTeamToPlayerCards, {
    sourceCardId: over.sourceCardId ?? tw.source,
    teamId: over.teamId ?? tw.w.padres,
    cardIds,
  });

describe("applyTeamToPlayerCards — a card takes the team only when nothing names a team and the career gives exactly it", () => {
  test("a teamless card of the same player, in a year the career gives that one team, is written", async () => {
    const t = newT();
    const tw = await teamWorld(t);
    const ok = await merrillCard(t, tw, "2");
    const out = await applyTeam(t, tw, [ok]);
    expect(out).toEqual({ applied: 1, skipped: 0 });
    const c = (await card(t, ok))!;
    expect(c.teamOnCardIds).toEqual([tw.w.padres]);
    expect(c.lastUpdated).toBeGreaterThan(WORLD_NOW);
    // The team -> cards index follows (the one writer).
    const links = await t.run((ctx) =>
      ctx.db
        .query("cardTeamLinks")
        .withIndex("by_card", (q) => q.eq("cardChecklistId", ok))
        .collect(),
    );
    expect(links.map((l) => l.teamId)).toEqual([tw.w.padres]);
  });

  test("a generated title takes the team; a hand-typed one is left alone", async () => {
    const t = newT();
    const tw = await teamWorld(t);
    const generated = await merrillCard(t, tw, "2");
    await t.run((ctx) => stampGeneratedTitle(ctx, generated));
    const typed = await merrillCard(t, tw, "3", { listingTitle: "Hand typed" });
    await applyTeam(t, tw, [generated, typed]);
    expect((await card(t, generated))!.listingTitle).toContain("Padres");
    expect((await card(t, typed))!.listingTitle).toBe("Hand typed");
  });

  test("a traded player (two teams in the card's year) is refused", async () => {
    const t = newT();
    const tw = await teamWorld(t);
    const traded = await t.run((ctx) =>
      printCard(ctx, tw.w, {
        number: "4",
        extra: { playerIds: [tw.trader], playerLinks: [{ playerId: tw.trader, nameOnCard: "Trade Deadline" }] },
      }),
    );
    // The source must be the same player for the guard to look at the card at all.
    const src = await t.run((ctx) =>
      printCard(ctx, tw.w, {
        number: "5",
        extra: {
          playerIds: [tw.trader],
          playerLinks: [{ playerId: tw.trader, nameOnCard: "Trade Deadline" }],
          teamOnCardIds: [tw.w.padres],
        },
      }),
    );
    const out = await applyTeam(t, tw, [traded], { sourceCardId: src });
    expect(out).toEqual({ applied: 0, skipped: 1 });
    expect((await card(t, traded))!.teamOnCardIds).toBeUndefined();
  });

  test("a card in a year the career gives ANOTHER team is refused (the fill rule, not the career-gap rule)", async () => {
    const t = newT();
    const tw = await teamWorld(t);
    const in2022 = await merrillCard(t, tw, "6", {}, tw.leaf2022);
    const out = await applyTeam(t, tw, [in2022]);
    expect(out).toEqual({ applied: 0, skipped: 1 });
    expect((await card(t, in2022))!.teamOnCardIds).toBeUndefined();
  });

  test("applying a team the career does not give for that year is refused, whatever the source card says", async () => {
    const t = newT();
    const tw = await teamWorld(t);
    const src = await t.run((ctx) =>
      ctx.db.patch(tw.source, { teamOnCardIds: [tw.w.mets] }),
    );
    expect(src).toBeNull();
    const ok = await merrillCard(t, tw, "2");
    // 2024: the career gives the Padres; the Mets is not what it gives.
    const out = await applyTeam(t, tw, [ok], { teamId: tw.w.mets });
    expect(out).toEqual({ applied: 0, skipped: 1 });
  });

  test("a different player on the card is refused", async () => {
    const t = newT();
    const tw = await teamWorld(t);
    const someoneElse = await t.run((ctx) =>
      printCard(ctx, tw.w, {
        number: "7",
        extra: { playerIds: [tw.other], playerLinks: [{ playerId: tw.other, nameOnCard: "Somebody Else" }] },
      }),
    );
    expect(await applyTeam(t, tw, [someoneElse])).toEqual({ applied: 0, skipped: 1 });
  });

  test("a multi-player card is refused", async () => {
    const t = newT();
    const tw = await teamWorld(t);
    const two = await merrillCard(t, tw, "8", {
      playerIds: [tw.merrill, tw.other],
      playerLinks: [
        { playerId: tw.merrill, nameOnCard: "Jackson Merrill" },
        { playerId: tw.other, nameOnCard: "Somebody Else" },
      ],
    });
    expect(await applyTeam(t, tw, [two])).toEqual({ applied: 0, skipped: 1 });
  });

  test("a card with a player name still pending is refused", async () => {
    const t = newT();
    const tw = await teamWorld(t);
    const pending = await merrillCard(t, tw, "9", { pendingPlayerNames: ["Jackson Merril"] });
    expect(await applyTeam(t, tw, [pending])).toEqual({ applied: 0, skipped: 1 });
  });

  test("rule 8: a card that already carries a team keeps it", async () => {
    const t = newT();
    const tw = await teamWorld(t);
    const hasTeam = await merrillCard(t, tw, "10", { teamOnCardIds: [tw.w.mets] });
    expect(await applyTeam(t, tw, [hasTeam])).toEqual({ applied: 0, skipped: 1 });
    expect((await card(t, hasTeam))!.teamOnCardIds).toEqual([tw.w.mets]);
  });

  test("rule 8: a team name pending on the card (the listing named one) is refused", async () => {
    const t = newT();
    const tw = await teamWorld(t);
    const pending = await merrillCard(t, tw, "11", { pendingTeamNames: ["Padrez"] });
    expect(await applyTeam(t, tw, [pending])).toEqual({ applied: 0, skipped: 1 });
    expect((await card(t, pending))!.teamOnCardIds).toBeUndefined();
  });

  test("rule 8: a source-named team that matched nothing (bscTeamName) is refused", async () => {
    const t = newT();
    const tw = await teamWorld(t);
    const named = await merrillCard(t, tw, "12", { bscTeamName: "Some Other Club" });
    expect(await applyTeam(t, tw, [named])).toEqual({ applied: 0, skipped: 1 });
    expect((await card(t, named))!.teamOnCardIds).toBeUndefined();
  });

  test("rule 8: a teams disagreement between the sources, settled or not, is refused", async () => {
    const t = newT();
    const tw = await teamWorld(t);
    const entry = {
      field: "teams" as const,
      values: [
        { value: ["Padres"], sources: ["bsc" as const] },
        { value: ["Mets"], sources: ["checklist" as const] },
      ],
    };
    const unsettled = await merrillCard(t, tw, "13", { sourceDisagreements: [entry] });
    const settled = await merrillCard(t, tw, "14", {
      sourceDisagreements: [{ ...entry, chosen: { value: ["Mets"], by: "operator" as const } }],
    });
    expect(await applyTeam(t, tw, [unsettled, settled])).toEqual({ applied: 0, skipped: 2 });
  });

  test("rule 8: a card the operator stamped No Team is refused", async () => {
    const t = newT();
    const tw = await teamWorld(t);
    const none = await merrillCard(t, tw, "15", {
      teamNoneConfirmedAt: WORLD_NOW,
      teamNoneConfirmedByUserId: "op",
    });
    expect(await applyTeam(t, tw, [none])).toEqual({ applied: 0, skipped: 1 });
    expect((await card(t, none))!.teamOnCardIds).toBeUndefined();
  });

  test("rule 8: a card the publisher checklist answered (teamCheckOutcome checklist) is refused", async () => {
    const t = newT();
    const tw = await teamWorld(t);
    const claimed = await merrillCard(t, tw, "16", {
      teamCheckDoneAt: WORLD_NOW,
      teamCheckOutcome: "checklist",
    });
    expect(await applyTeam(t, tw, [claimed])).toEqual({ applied: 0, skipped: 1 });
  });

  test("a lookup that never answered is not a claim: a card whose team check gave up is still written", async () => {
    const t = newT();
    const tw = await teamWorld(t);
    const gaveUp = await merrillCard(t, tw, "17", {
      teamCheckDoneAt: WORLD_NOW,
      teamCheckOutcome: "gaveUp",
    });
    expect(await applyTeam(t, tw, [gaveUp])).toEqual({ applied: 1, skipped: 0 });
    expect((await card(t, gaveUp))!.teamOnCardIds).toEqual([tw.w.padres]);
  });

  test("NEO-639 (decision A): no card of a set whose own team default is No Team takes the fill", async () => {
    const t = newT();
    const tw = await teamWorld(t);
    const teamless = await merrillCard(t, tw, "18");
    await t.run((ctx) =>
      ctx.db.patch(tw.w.base, { noTeamDefault: { setAt: WORLD_NOW, setByUserId: "op" } }),
    );
    expect(await applyTeam(t, tw, [teamless])).toEqual({ applied: 0, skipped: 1 });
    expect((await card(t, teamless))!.teamOnCardIds).toBeUndefined();
    // The same card, once the set no longer says No Team, is written.
    await t.run((ctx) => ctx.db.patch(tw.w.base, { noTeamDefault: undefined }));
    expect(await applyTeam(t, tw, [teamless])).toEqual({ applied: 1, skipped: 0 });
  });

  test("a mixed batch writes only the cards that pass, and counts the rest", async () => {
    const t = newT();
    const tw = await teamWorld(t);
    const good1 = await merrillCard(t, tw, "20");
    const good2 = await merrillCard(t, tw, "21");
    const named = await merrillCard(t, tw, "22", { bscTeamName: "Elsewhere" });
    const gone = await merrillCard(t, tw, "23");
    await t.run((ctx) => ctx.db.delete(gone));
    const out = await applyTeam(t, tw, [good1, good2, named, gone, tw.source, good1]);
    expect(out).toEqual({ applied: 2, skipped: 2 });
    expect((await card(t, good1))!.teamOnCardIds).toEqual([tw.w.padres]);
    expect((await card(t, named))!.teamOnCardIds).toBeUndefined();
  });

  test("the source card must carry the team (and be a one-player card) first", async () => {
    const t = newT();
    const tw = await teamWorld(t);
    const bare = await merrillCard(t, tw, "30");
    await expect(applyTeam(t, tw, [], { sourceCardId: bare })).rejects.toThrow(/team first/);
    await expect(applyTeam(t, tw, [], { teamId: tw.w.mets })).rejects.toThrow(/team first/);
  });

  test("more than 100 cards is refused and nothing is written", async () => {
    const t = newT();
    const tw = await teamWorld(t);
    const ids = await t.run(async (ctx) => {
      const out: Array<Id<"cardChecklist">> = [];
      for (let i = 0; i < MAX_APPLY_CARDS + 1; i++) {
        out.push(
          await printCard(ctx, tw.w, {
            number: `${100 + i}`,
            extra: { playerIds: [tw.merrill], playerLinks: [{ playerId: tw.merrill, nameOnCard: "Jackson Merrill" }] },
          }),
        );
      }
      return out;
    });
    await expect(applyTeam(t, tw, ids)).rejects.toThrow(/At most 100/);
    expect((await card(t, ids[0]))!.teamOnCardIds).toBeUndefined();
  });

  test("the first 50 are written in the call; the rest by scheduled pages that re-check each card", async () => {
    const t = newT();
    const tw = await teamWorld(t);
    const total = APPLY_PAGE_SIZE + 5;
    const ids = await t.run(async (ctx) => {
      const out: Array<Id<"cardChecklist">> = [];
      for (let i = 0; i < total; i++) {
        out.push(
          await printCard(ctx, tw.w, {
            number: `${100 + i}`,
            extra: { playerIds: [tw.merrill], playerLinks: [{ playerId: tw.merrill, nameOnCard: "Jackson Merrill" }] },
          }),
        );
      }
      return out;
    });
    const out = await applyTeam(t, tw, ids);
    expect(out).toEqual({ applied: total, skipped: 0 });
    expect((await card(t, ids[0]))!.teamOnCardIds).toEqual([tw.w.padres]);
    expect((await card(t, ids[total - 1]))!.teamOnCardIds).toBeUndefined();
    // Between the call and the page, a source named a team on the last card.
    await t.run((ctx) => ctx.db.patch(ids[total - 1], { bscTeamName: "Late Claim" }));
    await drainScheduled(t);
    expect((await card(t, ids[total - 2]))!.teamOnCardIds).toEqual([tw.w.padres]);
    expect((await card(t, ids[total - 1]))!.teamOnCardIds).toBeUndefined();
  });

  test("applyTeamPage counts what it skipped", async () => {
    const t = newT();
    const tw = await teamWorld(t);
    const ok = await merrillCard(t, tw, "40");
    const named = await merrillCard(t, tw, "41", { pendingTeamNames: ["X"] });
    const out = await t.mutation(internal.tidyCards.applyTeamPage, {
      playerId: tw.merrill,
      teamId: tw.w.padres,
      cardIds: [ok, named],
      userId: "op",
    });
    expect(out).toEqual({ applied: 1, skipped: 1 });
  });

  test("refuses a signed-out caller and a non-admin", async () => {
    const t = newT();
    const tw = await teamWorld(t);
    const args = { sourceCardId: tw.source, teamId: tw.w.padres, cardIds: [] };
    await expect(t.mutation(api.tidyCards.applyTeamToPlayerCards, args)).rejects.toThrow(/Not authenticated/);
    await expect(t.withIdentity(MEMBER).mutation(api.tidyCards.applyTeamToPlayerCards, args)).rejects.toThrow(
      /Admin access required/,
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
// applyVariation
// ───────────────────────────────────────────────────────────────────────────

describe("applyVariation — compare-and-set on cardVariation === from", () => {
  const FROM = "Image Variation";
  const TO = "Photo Variation";
  const setup = async (t: T) => {
    const base = await t.run(async (ctx) => {
      const w = await seedTidyWorld(ctx);
      const mk = (n: string, variation: string | undefined) =>
        printCard(ctx, w, { number: n, extra: variation !== undefined ? { cardVariation: variation } : {} });
      return {
        w,
        same: await mk("1", FROM),
        padded: await mk("2", `  ${FROM} `),
        edited: await mk("3", "Hand Edited Since"),
        none: await mk("4", undefined),
      };
    });
    const mk = (n: string, variation: string | undefined, extra: Record<string, unknown> = {}) =>
      t.run((ctx) =>
        printCard(ctx, base.w, { number: n, extra: { ...(variation !== undefined ? { cardVariation: variation } : {}), ...extra } }),
      );
    return { ...base, mk };
  };
  const apply = (t: T, cardIds: Array<Id<"cardChecklist">>, from = FROM, to = TO) =>
    t.withIdentity(ADMIN).mutation(api.tidyCards.applyVariation, { cardIds, from, to });

  test("writes cards whose variation (trimmed) equals from; every other card is skipped and counted", async () => {
    const t = newT();
    const s = await setup(t);
    const out = await apply(t, [s.same, s.padded, s.edited, s.none]);
    expect(out).toEqual({ applied: 2, skipped: 2 });
    expect((await card(t, s.same))!.cardVariation).toBe(TO);
    expect((await card(t, s.padded))!.cardVariation).toBe(TO);
    expect((await card(t, s.edited))!.cardVariation).toBe("Hand Edited Since");
    expect((await card(t, s.none))!.cardVariation).toBeUndefined();
    expect((await card(t, s.same))!.lastUpdated).toBeGreaterThan(WORLD_NOW);
  });

  test("a card edited since is skipped when its scheduled page runs", async () => {
    const t = newT();
    const s = await setup(t);
    const ids: Array<Id<"cardChecklist">> = [];
    for (let i = 0; i < APPLY_PAGE_SIZE + 2; i++) ids.push(await s.mk(`${100 + i}`, FROM));
    const out = await apply(t, ids);
    expect(out.applied).toBe(ids.length);
    await t.run((ctx) => ctx.db.patch(ids[ids.length - 1], { cardVariation: "Typed Meanwhile" }));
    await drainScheduled(t);
    expect((await card(t, ids[ids.length - 2]))!.cardVariation).toBe(TO);
    expect((await card(t, ids[ids.length - 1]))!.cardVariation).toBe("Typed Meanwhile");
  });

  test("a blank `to` clears the variation", async () => {
    const t = newT();
    const s = await setup(t);
    await apply(t, [s.same], FROM, "   ");
    expect((await card(t, s.same))!.cardVariation).toBeUndefined();
  });

  test("a generated title follows the new variation; a hand-typed one stays", async () => {
    const t = newT();
    const s = await setup(t);
    const typed = await s.mk("5", FROM, { listingTitle: "Typed title" });
    await t.run((ctx) => stampGeneratedTitle(ctx, s.same));
    expect((await card(t, s.same))!.listingTitle).toContain("Image");
    await apply(t, [s.same, typed]);
    expect((await card(t, s.same))!.listingTitle).toContain("Photo");
    expect((await card(t, s.same))!.listingTitle).not.toContain("Image");
    expect((await card(t, typed))!.listingTitle).toBe("Typed title");
  });

  test("a blank `from` has no variation to change; a `to` over the cap is refused naming the limit", async () => {
    const t = newT();
    const s = await setup(t);
    await expect(apply(t, [s.same], "  ", TO)).rejects.toThrow(/no variation/);
    const long = "V".repeat(MAX_VARIATION_LENGTH + 1);
    const err = (await apply(t, [s.same], FROM, long).catch((e) => e)) as Error;
    expect(err.message).toMatch(/limit is 200/);
    expect(err.message).not.toContain(long);
    expect((await card(t, s.same))!.cardVariation).toBe(FROM);
  });

  test("more than 100 cards is refused", async () => {
    const t = newT();
    const s = await setup(t);
    const real: Array<Id<"cardChecklist">> = [];
    for (let i = 0; i < MAX_APPLY_CARDS + 1; i++) real.push(await s.mk(`${200 + i}`, FROM));
    await expect(apply(t, real)).rejects.toThrow(/At most 100/);
  });

  test("the same card listed twice is one card", async () => {
    const t = newT();
    const s = await setup(t);
    expect(await apply(t, [s.same, s.same])).toEqual({ applied: 1, skipped: 0 });
  });

  test("refuses a signed-out caller and a non-admin", async () => {
    const t = newT();
    const s = await setup(t);
    const args = { cardIds: [s.same], from: FROM, to: TO };
    await expect(t.mutation(api.tidyCards.applyVariation, args)).rejects.toThrow(/Not authenticated/);
    await expect(t.withIdentity(MEMBER).mutation(api.tidyCards.applyVariation, args)).rejects.toThrow(
      /Admin access required/,
    );
    expect((await card(t, s.same))!.cardVariation).toBe(FROM);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// applySetNameToTitles
// ───────────────────────────────────────────────────────────────────────────

const LONG_SET = "Hologram Collection Extraordinaire Series Nineteen Ninety One Anniversary";
const SHORT = "Topps Holo";

describe("applySetNameToTitles — the three title cases", () => {
  async function setup(t: T) {
    return t.run(async (ctx) => {
      const w = await seedTidyWorld(ctx);
      await ctx.db.patch(w.set, { value: LONG_SET });
      const bo = await addPlayer(ctx, w, "Bo Jackson");
      const mk = (n: string, extra: Record<string, unknown> = {}) =>
        printCard(ctx, w, {
          number: n,
          extra: { playerIds: [bo], playerLinks: [{ playerId: bo, nameOnCard: "Bo Jackson" }], isRookie: true, ...extra },
        });
      const open = await mk("1");
      const generated = await mk("2");
      const leftOut = await mk("3");
      const otherEdit = await mk("4");
      await stampGeneratedTitle(ctx, open);
      await stampGeneratedTitle(ctx, generated);
      // Facts the hand edits are built from, under the OLD (no) short name.
      const stored = (await ctx.db.get(leftOut))!;
      const { inputs } = await listingInputsForStoredCard(ctx as never, stored, newStoredCardReadCache());
      const desc = titleDescription(inputs);
      const fullTitle = assessListingTitle(inputs).title;
      await ctx.db.patch(leftOut, { listingTitle: `${desc} Jackson #3` });
      await ctx.db.patch(otherEdit, { listingTitle: `${desc} Bo Jackson #4 RC MINT` });
      return { w, open, generated, leftOut, otherEdit, desc, fullTitle };
    });
  }
  const apply = (t: T, s: Awaited<ReturnType<typeof setup>>, listingShortName: string, cardId = s.open) =>
    t.withIdentity(ADMIN).mutation(api.tidyCards.applySetNameToTitles, {
      leafId: s.w.base,
      cardId,
      listingShortName,
    });

  test("writes the leaf's short name (trimmed), retitles the open card now and schedules the rest", async () => {
    const t = newT();
    const s = await setup(t);
    const before = (await card(t, s.open))!.listingTitle;
    const out = await apply(t, s, `  ${SHORT}  `);
    expect(out).toEqual({ openCardRetitled: true, scheduled: true });
    const leaf = (await t.run((ctx) => ctx.db.get(s.w.base)))!;
    expect(leaf.metadata?.listingShortName).toBe(SHORT);
    const after = (await card(t, s.open))!;
    expect(after.listingTitle).not.toBe(before);
    expect(after.listingTitle?.startsWith(SHORT)).toBe(true);
    // The other cards wait for the scheduled page.
    expect((await card(t, s.generated))!.listingTitle).toBe(before);
    await drainScheduled(t);
    expect((await card(t, s.generated))!.listingTitle?.startsWith(SHORT)).toBe(true);
  });

  test("a hand edit that shows 'Left out' gets the swap: the set name replaced, the rest of the words kept", async () => {
    const t = newT();
    const s = await setup(t);
    await apply(t, s, SHORT);
    await drainScheduled(t);
    expect((await card(t, s.leftOut))!.listingTitle).toBe(`${SHORT} Jackson #3`);
  });

  test("any OTHER hand edit is left exactly as typed", async () => {
    const t = newT();
    const s = await setup(t);
    const typed = (await card(t, s.otherEdit))!.listingTitle;
    await apply(t, s, SHORT);
    await drainScheduled(t);
    expect((await card(t, s.otherEdit))!.listingTitle).toBe(typed);
    expect((await card(t, s.otherEdit))!.lastUpdated).toBe(WORLD_NOW);
  });

  test("saved from the hand-edited card itself, its swapped title survives the scheduled pages", async () => {
    const t = newT();
    const s = await setup(t);
    // The operator is on the card they typed; the call swaps it and the pages
    // must not run the same old -> new pair over the title it already wrote.
    const out = await apply(t, s, SHORT, s.leftOut);
    expect(out).toEqual({ openCardRetitled: true, scheduled: true });
    expect((await card(t, s.leftOut))!.listingTitle).toBe(`${SHORT} Jackson #3`);
    await drainScheduled(t);
    expect((await card(t, s.leftOut))!.listingTitle).toBe(`${SHORT} Jackson #3`);
    // The pages still reach the others.
    expect((await card(t, s.generated))!.listingTitle?.startsWith(SHORT)).toBe(true);
  });

  test("a second set name swaps the first one out of a hand edit again", async () => {
    const t = newT();
    const s = await setup(t);
    await apply(t, s, SHORT);
    await drainScheduled(t);
    await apply(t, s, "Topps Holo 91", s.leftOut);
    await drainScheduled(t);
    expect((await card(t, s.leftOut))!.listingTitle).toBe("Topps Holo 91 Jackson #3");
  });

  test("a title the new set name rebuilds with nothing left out carries no 'cut short' flag", async () => {
    const t = newT();
    const s = await setup(t);
    await apply(t, s, SHORT);
    await drainScheduled(t);
    const rebuilt = (await card(t, s.generated))!;
    expect(rebuilt.listingTitle?.startsWith(SHORT)).toBe(true);
    expect(rebuilt.listingTitleTruncated).toBeUndefined();
  });

  test("setting the same name again writes nothing and schedules nothing", async () => {
    const t = newT();
    const s = await setup(t);
    await apply(t, s, SHORT);
    await drainScheduled(t);
    expect(await apply(t, s, ` ${SHORT} `)).toEqual({ openCardRetitled: false, scheduled: false });
  });

  test("clearing the short name removes it from the leaf and puts generated titles back", async () => {
    const t = newT();
    const s = await setup(t);
    await apply(t, s, SHORT);
    await drainScheduled(t);
    const out = await apply(t, s, "   ");
    expect(out.scheduled).toBe(true);
    await drainScheduled(t);
    const leaf = (await t.run((ctx) => ctx.db.get(s.w.base)))!;
    expect(leaf.metadata?.listingShortName).toBeUndefined();
    expect((await card(t, s.generated))!.listingTitle?.startsWith(SHORT)).toBe(false);
    expect((await card(t, s.generated))!.listingTitle).toContain("Hologram");
  });

  /** The retitle chains a save scheduled, oldest first. */
  const chains = async (t: T) =>
    (await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect()))
      .filter((f) => f.name.includes("retitleLeafPage"))
      .sort((a, b) => a._creationTime - b._creationTime)
      .map((f) => f.args[0] as Record<string, unknown> & { runId: number });

  test("each save stamps its chain with a run id on the leaf, and a later save moves it on", async () => {
    const t = newT();
    const s = await setup(t);
    await apply(t, s, SHORT);
    const first = (await t.run((ctx) => ctx.db.get(s.w.base)))!.metadata?.listingShortNameSavedAt;
    await apply(t, s, "Other Name");
    const second = (await t.run((ctx) => ctx.db.get(s.w.base)))!.metadata?.listingShortNameSavedAt;
    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(first!);
    const [a, b] = await chains(t);
    expect(a.runId).toBe(first);
    expect(b.runId).toBe(second);
  });

  test("two quick saves leave ONE live chain: the older one stops before it touches a title", async () => {
    const t = newT();
    const s = await setup(t);
    await apply(t, s, SHORT);
    await apply(t, s, "Other Name");
    const [older, newer] = await chains(t);
    const typed = (await card(t, s.leftOut))!.listingTitle;

    // The older chain would swap its own stale old -> new pair into the hand edit.
    const stale = await t.mutation(internal.tidyCards.retitleLeafPage, older as never);
    expect(stale).toEqual({ retitled: 0, done: true });
    expect((await card(t, s.leftOut))!.listingTitle).toBe(typed);
    expect((await card(t, s.generated))!.listingTitle?.startsWith(SHORT)).toBe(false);

    // The newer chain does the work, once, under the name now on the leaf.
    const live = await t.mutation(internal.tidyCards.retitleLeafPage, newer as never);
    expect(live.retitled).toBeGreaterThan(0);
    expect((await card(t, s.generated))!.listingTitle?.startsWith("Other Name")).toBe(true);
    expect((await card(t, s.leftOut))!.listingTitle).toBe("Other Name Jackson #3");
  });

  test("a chain also stops when another writer changed the box under it", async () => {
    const t = newT();
    const s = await setup(t);
    await apply(t, s, SHORT);
    const [chain] = await chains(t);
    // The attributes panel spreads `metadata`, so the run id stays and the box moves.
    await t.run(async (ctx) => {
      const leaf = (await ctx.db.get(s.w.base))!;
      await ctx.db.patch(s.w.base, { metadata: { ...leaf.metadata, listingShortName: "Panel Name" } });
    });
    const typed = (await card(t, s.leftOut))!.listingTitle;
    expect(await t.mutation(internal.tidyCards.retitleLeafPage, chain as never)).toEqual({
      retitled: 0,
      done: true,
    });
    expect((await card(t, s.leftOut))!.listingTitle).toBe(typed);
  });

  test("a card of another leaf, a leaf that cannot carry a short name and a gone leaf are refused", async () => {
    const t = newT();
    const s = await setup(t);
    const foreign = await t.run((ctx) => printCard(ctx, s.w, { leaf: s.w.insert, number: "9" }));
    await expect(apply(t, s, SHORT, foreign)).rejects.toThrow(/isn't in this checklist/);
    await expect(
      t.withIdentity(ADMIN).mutation(api.tidyCards.applySetNameToTitles, {
        leafId: s.w.sport,
        cardId: s.open,
        listingShortName: SHORT,
      }),
    ).rejects.toThrow(/set or a part of one/);
    expect(((await t.run((ctx) => ctx.db.get(s.w.base)))!).metadata?.listingShortName).toBeUndefined();
  });

  test("a short name with a line break is refused", async () => {
    const t = newT();
    const s = await setup(t);
    await expect(apply(t, s, "Two\nLines")).rejects.toThrow();
    expect(((await t.run((ctx) => ctx.db.get(s.w.base)))!).metadata?.listingShortName).toBeUndefined();
  });

  test("refuses a signed-out caller and a non-admin", async () => {
    const t = newT();
    const s = await setup(t);
    const args = { leafId: s.w.base, cardId: s.open, listingShortName: SHORT };
    await expect(t.mutation(api.tidyCards.applySetNameToTitles, args)).rejects.toThrow(/Not authenticated/);
    await expect(t.withIdentity(MEMBER).mutation(api.tidyCards.applySetNameToTitles, args)).rejects.toThrow(
      /Admin access required/,
    );
  });
});
