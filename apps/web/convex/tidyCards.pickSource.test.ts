/**
 * NEO-645 / NEO-656 — `tidyCards.pickSourceValue`: "the sources disagree, use
 * this one".
 *
 * Until a value is chosen the disagreeing field holds NOTHING. Choosing resolves
 * each name the way the commit does: EXACTLY ONE NB match links (the one player
 * who answers to the name, by his own name or an alias, NEO-680; a tied match is
 * a question, never an adoption); anything else stays a pending name on the card. Nothing is stored about the pick
 * (NEO-656: "once you pick a source, the card keeps only the result"): the
 * disagreement's entry is REMOVED from the card, and a Change while the card is
 * open works from the `offered` values the walk kept.
 *
 * "Apply to the cards with the same disagreement" is checked card by card on the
 * server: a card whose values differ (or that has already been picked) is
 * refused and counted, never written; at most `MAX_APPLY_CARDS` cards.
 *
 * (That "Judge / Soto" and "Judge | Soto", Acuña and Acuna, Jr. and Jr store no
 * disagreement at all is pinned where the entries are built:
 * `features/sourceDisagreements.test.ts`.)
 */

import { convexTest } from "convex-test";
import { afterEach, describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import { MAX_APPLY_CARDS, MAX_PICK_NAMES } from "./tidyCards";
import { syncPlayerAliases } from "./players";
import { deriveCardAttention } from "./features/cardAttention";
import { cancelScheduled, drainScheduled } from "../lib/testing/drain-scheduled";
import {
  addPlayer,
  printCard,
  seedTidyWorld,
  stampGeneratedTitle,
  WORLD_NOW,
} from "../lib/testing/tidy-world";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const ADMIN = { subject: "user_tidy_pick_admin", role: "admin" };
const MEMBER = { subject: "user_tidy_pick_member" };
type T = ReturnType<typeof convexTest>;
type Entry = NonNullable<Doc<"cardChecklist">["sourceDisagreements"]>[number];

const live: T[] = [];
const newT = () => {
  const t = convexTest(schema, modules);
  live.push(t);
  return t;
};
afterEach(async () => {
  for (const t of live.splice(0)) await cancelScheduled(t);
});

const JUDGE = "Aaron Judge";
const SOTO = "Juan Soto";

const playersEntry = (a = [JUDGE], b = [SOTO]): Entry => ({
  field: "players",
  values: [
    { value: a, sources: ["bsc"] },
    { value: b, sources: ["sportlots"] },
  ],
});
const teamsEntry = (a: string[], b: string[]): Entry => ({
  field: "teams",
  values: [
    { value: a, sources: ["bsc"] },
    { value: b, sources: ["checklist"] },
  ],
});

async function setup(t: T) {
  return t.run(async (ctx) => {
    const w = await seedTidyWorld(ctx);
    const judge = await addPlayer(ctx, w, JUDGE);
    const card = (n: string, entries: Entry[], extra: Record<string, unknown> = {}) =>
      printCard(ctx, w, { number: n, extra: { sourceDisagreements: entries, ...extra } });
    return { w, judge, open: await card("1", [playersEntry()]) };
  });
}

/** A player who answers to `aliases` as well as his own name (the alias index rows included). */
async function addAliased(
  ctx: Parameters<Parameters<T["run"]>[0]>[0],
  w: Parameters<typeof addPlayer>[1],
  name: string,
  aliases: string[],
) {
  const id = await addPlayer(ctx, w, name, undefined, { aliases });
  await syncPlayerAliases(ctx, { playerId: id });
  return id;
}

const card = (t: T, id: Id<"cardChecklist">) => t.run((ctx) => ctx.db.get(id));
const pick = (
  t: T,
  cardId: Id<"cardChecklist">,
  value: string[],
  extra: {
    typed?: true;
    cardIds?: Array<Id<"cardChecklist">>;
    field?: "players" | "teams";
    offered?: string[][];
  } = {},
) =>
  t.withIdentity(ADMIN).mutation(api.tidyCards.pickSourceValue, {
    cardId,
    field: extra.field ?? "players",
    value,
    ...(extra.typed ? { typed: true as const } : {}),
    ...(extra.cardIds ? { cardIds: extra.cardIds } : {}),
    ...(extra.offered ? { offered: extra.offered } : {}),
  });
const scheduledNames = async (t: T) =>
  (await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).map((s) => s.name);

describe("pickSourceValue — each name resolves the way the commit does", () => {
  test("an exact single NB match links, takes the entry off the card, and stores nothing else", async () => {
    const t = newT();
    const { judge, open } = await setup(t);
    const out = await pick(t, open, [JUDGE]);
    expect(out).toEqual({ applied: 1, scheduled: 0, refused: 0 });
    const c = (await card(t, open))!;
    expect(c.playerIds).toEqual([judge]);
    expect(c.playerLinks).toEqual([{ playerId: judge, nameOnCard: JUDGE }]);
    expect(c.pendingPlayerNames).toBeUndefined();
    // "Once you pick a source, the card keeps only the result."
    expect(c.sourceDisagreements).toBeUndefined();
    expect(await scheduledNames(t)).toEqual([]);
  });

  test("no NB match: the name is pending on the card, and nothing else is written or scheduled", async () => {
    const t = newT();
    const { open } = await setup(t);
    await pick(t, open, [SOTO]);
    const c = (await card(t, open))!;
    expect(c.playerIds).toBeUndefined();
    expect(c.pendingPlayerNames).toEqual([SOTO]);
    expect(c.sourceDisagreements).toBeUndefined();
    expect(await scheduledNames(t)).toEqual([]);
  });

  test("two namesakes are a question, never an adoption: the name stays pending", async () => {
    const t = newT();
    const { w, open } = await setup(t);
    await t.run(async (ctx) => {
      await addPlayer(ctx, w, SOTO, undefined, { birthYear: 1998 });
      await addPlayer(ctx, w, SOTO, undefined, { birthYear: 1965 });
    });
    await pick(t, open, [SOTO]);
    expect((await card(t, open))!.playerIds).toBeUndefined();
    expect((await card(t, open))!.pendingPlayerNames).toEqual([SOTO]);
  });

  test("a player known only by an ALIAS links when he is the only one who answers to it (NEO-680)", async () => {
    const t = newT();
    const { w, open } = await setup(t);
    const soto = await t.run((ctx) => addAliased(ctx, w, "Juan Carlos Soto", [SOTO]));
    await pick(t, open, [SOTO]);
    const c = (await card(t, open))!;
    expect(c.playerIds).toEqual([soto]);
    // The card keeps the name it printed; the alias is not rewritten into it.
    expect(c.playerLinks).toEqual([{ playerId: soto, nameOnCard: SOTO }]);
    expect(c.pendingPlayerNames).toBeUndefined();
  });

  test("two players who answer to the same alias are a question: the name stays pending (NEO-680)", async () => {
    const t = newT();
    const { w, open } = await setup(t);
    await t.run(async (ctx) => {
      await addAliased(ctx, w, "Juan Carlos Soto", [SOTO]);
      await addAliased(ctx, w, "Juan Soto Sr", [SOTO]);
    });
    await pick(t, open, [SOTO]);
    const c = (await card(t, open))!;
    expect(c.playerIds).toBeUndefined();
    expect(c.pendingPlayerNames).toEqual([SOTO]);
  });

  test("a lone alias and a lone own name both link on one card, and no player name is left to ask (the #PDPA-KP shape)", async () => {
    const t = newT();
    const { w, judge } = await setup(t);
    const soto = await t.run((ctx) => addAliased(ctx, w, "Juan Carlos Soto", [SOTO]));
    const open = await t.run((ctx) =>
      printCard(ctx, w, {
        number: "9",
        extra: {
          sourceDisagreements: [playersEntry([JUDGE, SOTO], [SOTO])],
          teamOnCardIds: [w.padres],
        },
      }),
    );
    await pick(t, open, [JUDGE, SOTO]);
    const c = (await card(t, open))!;
    expect(c.playerIds).toEqual([judge, soto]);
    expect(c.playerLinks).toEqual([
      { playerId: judge, nameOnCard: JUDGE },
      { playerId: soto, nameOnCard: SOTO },
    ]);
    expect(c.pendingPlayerNames).toBeUndefined();
    const attention = deriveCardAttention(c);
    expect(attention.items.some((i) => i.kind === "playerName")).toBe(false);
    expect(attention.level).toBe("none");
  });

  test("a name once ruled out is matched like any other: one exact match links (nothing remembers the ruling, B10)", async () => {
    const t = newT();
    const { w, open } = await setup(t);
    const soto = await t.run((ctx) => addPlayer(ctx, w, SOTO));
    await pick(t, open, [SOTO]);
    expect((await card(t, open))!.playerIds).toEqual([soto]);
    expect((await card(t, open))!.pendingPlayerNames).toBeUndefined();
  });

  test("a multi-name value keeps its printed order and mixes links with pending", async () => {
    const t = newT();
    const { w, judge } = await setup(t);
    const open = await t.run((ctx) =>
      printCard(ctx, w, { number: "12", extra: { sourceDisagreements: [playersEntry([JUDGE, SOTO], [SOTO])] } }),
    );
    await pick(t, open, [JUDGE, SOTO]);
    const c = (await card(t, open))!;
    expect(c.playerIds).toEqual([judge]);
    expect(c.pendingPlayerNames).toEqual([SOTO]);
    expect(c.playerLinks).toEqual([{ playerId: judge, nameOnCard: JUDGE }]);
  });

  test("a team value: one NB team links, an unknown name stays pending", async () => {
    const t = newT();
    const { w } = await setup(t);
    const open = await t.run((ctx) =>
      printCard(ctx, w, {
        number: "7",
        extra: { sourceDisagreements: [teamsEntry(["San Diego Padres"], ["Mystery Club"])] },
      }),
    );
    await pick(t, open, ["San Diego Padres"], { field: "teams" });
    expect((await card(t, open))!.teamOnCardIds).toEqual([w.padres]);
    await pick(t, open, ["Mystery Club"], {
      field: "teams",
      offered: [["San Diego Padres"], ["Mystery Club"]],
    });
    const c = (await card(t, open))!;
    expect(c.teamOnCardIds).toBeUndefined();
    expect(c.pendingTeamNames).toEqual(["Mystery Club"]);
  });

  test("Change: re-picking replaces what the first pick wrote", async () => {
    const t = newT();
    const { judge, open } = await setup(t);
    await pick(t, open, [JUDGE]);
    expect((await card(t, open))!.playerIds).toEqual([judge]);
    // The entry is gone, so a Change works from the values the walk kept.
    await expect(pick(t, open, [SOTO])).rejects.toThrow(/nothing to pick/);
    await pick(t, open, [SOTO], { offered: [[JUDGE], [SOTO]] });
    const c = (await card(t, open))!;
    expect(c.playerIds).toBeUndefined();
    expect(c.playerLinks).toBeUndefined();
    expect(c.pendingPlayerNames).toEqual([SOTO]);
    expect(c.sourceDisagreements).toBeUndefined();
  });

  test("Change with offered values that do not include the pick is refused", async () => {
    const t = newT();
    const { open } = await setup(t);
    await pick(t, open, [JUDGE]);
    await expect(pick(t, open, ["Nobody Offered"], { offered: [[JUDGE], [SOTO]] })).rejects.toThrow(
      /isn't one of the values/,
    );
  });

  test("Change's offered values are bounded: more than 3 values, and a value over the byte cap, are refused", async () => {
    const t = newT();
    const { judge, open } = await setup(t);
    await pick(t, open, [JUDGE]);
    await expect(pick(t, open, [JUDGE], { offered: [[JUDGE], [SOTO], ["A B"], ["C D"]] })).rejects.toThrow(
      /at most 3 values/,
    );
    const fat = Array.from({ length: 20 }, (_, i) => `${"A".repeat(100)}${i}`);
    await expect(pick(t, open, [JUDGE], { offered: [fat, fat, [JUDGE]] })).rejects.toThrow(
      /too long to pick from/,
    );
    // Nothing was written by the refusals.
    expect((await card(t, open))!.playerIds).toEqual([judge]);
  });

  test("a typed value is used as given (it needs no offer) and the entry leaves the card", async () => {
    const t = newT();
    const { open } = await setup(t);
    await pick(t, open, ["Somebody Typed"], { typed: true });
    const c = (await card(t, open))!;
    expect(c.pendingPlayerNames).toEqual(["Somebody Typed"]);
    expect(c.sourceDisagreements).toBeUndefined();
  });
});

describe("pickSourceValue — titles and lastUpdated", () => {
  test("a generated title is regenerated, and a hand-typed one too (T4: always overwrite)", async () => {
    const t = newT();
    const { w, judge } = await setup(t);
    const [generated, typed] = await t.run(async (ctx) => {
      const mk = async (n: string, extra: Record<string, unknown>) =>
        printCard(ctx, w, { number: n, extra: { sourceDisagreements: [playersEntry()], ...extra } });
      const g = await mk("2", {});
      await stampGeneratedTitle(ctx, g);
      const h = await mk("3", { listingTitle: "My own title" });
      return [g, h] as const;
    });
    await pick(t, generated, [JUDGE]);
    await pick(t, typed, [JUDGE]);
    expect((await card(t, generated))!.listingTitle).toContain("Judge");
    expect((await card(t, typed))!.listingTitle).toContain("Judge");
    expect((await card(t, typed))!.listingTitle).not.toBe("My own title");
    expect((await card(t, generated))!.playerIds).toEqual([judge]);
  });

  test("a link bumps lastUpdated (content changed under an open review)", async () => {
    const t = newT();
    const { open } = await setup(t);
    await pick(t, open, [JUDGE]);
    expect((await card(t, open))!.lastUpdated).toBeGreaterThan(WORLD_NOW);
  });

  test("taking the entry off the card ALONE does not bump lastUpdated (the NEO-203 baseVersion)", async () => {
    const t = newT();
    const { w } = await setup(t);
    // One source named nobody (the checklist's "No team"): choosing it changes no field.
    const open = await t.run((ctx) =>
      printCard(ctx, w, { number: "9", extra: { sourceDisagreements: [teamsEntry(["San Diego Padres"], [])] } }),
    );
    await pick(t, open, [], { field: "teams" });
    const c = (await card(t, open))!;
    expect(c.sourceDisagreements).toBeUndefined();
    expect(c.lastUpdated).toBe(WORLD_NOW);
  });
});

describe("pickSourceValue — an empty teams value is the No-team answer", () => {
  const noTeamEntry = () => teamsEntry(["San Diego Padres"], []);

  test("taking the source that names nobody stamps No team on the card (it is not left asking for a team)", async () => {
    const t = newT();
    const { w } = await setup(t);
    const open = await t.run((ctx) =>
      printCard(ctx, w, { number: "9", extra: { sourceDisagreements: [noTeamEntry()] } }),
    );
    await pick(t, open, [], { field: "teams" });
    const c = (await card(t, open))!;
    expect(c.teamNoneConfirmedAt).toBeTypeOf("number");
    expect(c.teamNoneConfirmedByUserId).toBeTruthy();
    expect(c.teamOnCardIds).toBeUndefined();
    expect(c.pendingTeamNames).toBeUndefined();
    // The stamp is what "no team on this card yet" reads: the card is not pink for it.
    expect(deriveCardAttention(c).items.some((i) => i.kind === "noTeam")).toBe(false);
    // And still no bump of the baseVersion for the stamp alone.
    expect(c.lastUpdated).toBe(WORLD_NOW);
  });

  test("Apply to the cards with the same disagreement stamps each of them (the scheduled pages)", async () => {
    const t = newT();
    const { w } = await setup(t);
    const [open, other] = await t.run(async (ctx) => [
      await printCard(ctx, w, { number: "9", extra: { sourceDisagreements: [noTeamEntry()] } }),
      await printCard(ctx, w, { number: "10", extra: { sourceDisagreements: [noTeamEntry()] } }),
    ]);
    await pick(t, open, [], { field: "teams", cardIds: [other] });
    await drainScheduled(t);
    expect((await card(t, other))!.teamNoneConfirmedAt).toBeTypeOf("number");
    expect((await card(t, open))!.teamNoneConfirmedAt).toBeTypeOf("number");
  });

  test("taking a value that names a team retires a No-team stamp an earlier pick left", async () => {
    const t = newT();
    const { w } = await setup(t);
    const open = await t.run((ctx) =>
      printCard(ctx, w, { number: "9", extra: { sourceDisagreements: [noTeamEntry()] } }),
    );
    await pick(t, open, [], { field: "teams" });
    expect((await card(t, open))!.teamNoneConfirmedAt).toBeTypeOf("number");
    await pick(t, open, ["San Diego Padres"], { field: "teams", offered: [["San Diego Padres"], []] });
    const c = (await card(t, open))!;
    expect(c.teamNoneConfirmedAt).toBeUndefined();
    expect(c.teamOnCardIds?.length).toBe(1);
  });
});

describe("pickSourceValue — what it refuses", () => {
  test("a value the sources never gave is refused (unless it is typed)", async () => {
    const t = newT();
    const { open } = await setup(t);
    await expect(pick(t, open, ["Nobody Offered"])).rejects.toThrow(/isn't one of the values/);
    // Refused: the entry is still on the card, so the operator can pick again.
    expect((await card(t, open))!.sourceDisagreements).toEqual([playersEntry()]);
  });

  test("an offered value matches by the shared name key, not by exact text", async () => {
    const t = newT();
    const { judge, open } = await setup(t);
    await pick(t, open, ["aaron  JUDGE"]);
    expect((await card(t, open))!.playerIds).toEqual([judge]);
  });

  test("a card with no entry for the field has nothing to pick", async () => {
    const t = newT();
    const { w } = await setup(t);
    const bare = await t.run((ctx) => printCard(ctx, w, { number: "5" }));
    await expect(pick(t, bare, [JUDGE])).rejects.toThrow(/nothing to pick/);
  });

  test("a typed value with no name is refused", async () => {
    const t = newT();
    const { open } = await setup(t);
    await expect(pick(t, open, ["   "], { typed: true })).rejects.toThrow(/Type a name/);
  });

  test("more names than a card can hold, and a name over the cap, are refused naming the limit", async () => {
    const t = newT();
    const { open } = await setup(t);
    const many = Array.from({ length: MAX_PICK_NAMES + 1 }, (_, i) => `Player Number${i}`);
    await expect(pick(t, open, many, { typed: true })).rejects.toThrow(/at most 20/);
    const long = "L".repeat(121);
    const err = (await pick(t, open, [long], { typed: true }).catch((e) => e)) as Error;
    expect(err.message).toMatch(/limit is 120/);
    expect(err.message).not.toContain(long);
  });

  test("a card that is gone is refused", async () => {
    const t = newT();
    const { open } = await setup(t);
    await t.run((ctx) => ctx.db.delete(open));
    await expect(pick(t, open, [JUDGE])).rejects.toThrow(/gone/);
  });

  test("refuses a signed-out caller and a non-admin", async () => {
    const t = newT();
    const { open } = await setup(t);
    const args = { cardId: open, field: "players" as const, value: [JUDGE] };
    await expect(t.mutation(api.tidyCards.pickSourceValue, args)).rejects.toThrow(/Not authenticated/);
    await expect(t.withIdentity(MEMBER).mutation(api.tidyCards.pickSourceValue, args)).rejects.toThrow(
      /Admin access required/,
    );
    expect((await card(t, open))!.sourceDisagreements).toEqual([playersEntry()]);
  });
});

describe("pickSourceValue — Apply to the cards with the same disagreement", () => {
  async function fiveCards(t: T) {
    const { w, judge, open } = await setup(t);
    const ids = await t.run(async (ctx) => {
      const mk = (n: string, entries: Entry[], extra: Record<string, unknown> = {}) =>
        printCard(ctx, w, { number: n, extra: { sourceDisagreements: entries, ...extra } });
      return {
        same: await mk("2", [playersEntry()]),
        sameReordered: await mk("3", [
          { field: "players", values: [{ value: [SOTO], sources: ["sportlots"] }, { value: [JUDGE], sources: ["bsc"] }] },
        ]),
        differs: await mk("4", [playersEntry([JUDGE], ["Mookie Betts"])]),
        none: await printCard(ctx, w, { number: "6" }),
      };
    });
    return { w, judge, open, ids };
  }

  test("the server checks each card: the same values are written, anything else is refused and counted", async () => {
    const t = newT();
    const { judge, open, ids } = await fiveCards(t);
    const out = await pick(t, open, [JUDGE], {
      cardIds: [ids.same, ids.sameReordered, ids.differs, ids.none],
    });
    expect(out).toEqual({ applied: 1, scheduled: 2, refused: 2 });
    await drainScheduled(t);
    expect((await card(t, ids.same))!.playerIds).toEqual([judge]);
    expect((await card(t, ids.sameReordered))!.playerIds).toEqual([judge]);
    // The card whose values differ is NOT written, however the client counted it.
    const differs = (await card(t, ids.differs))!;
    expect(differs.playerIds).toBeUndefined();
    expect(differs.sourceDisagreements).toEqual([playersEntry([JUDGE], ["Mookie Betts"])]);
    // A card that was picked and has no entry any more is refused too.
    expect((await card(t, ids.same))!.sourceDisagreements).toBeUndefined();
    expect((await card(t, ids.none))!.sourceDisagreements).toBeUndefined();
  });

  test("a disagreement on the OTHER field does not count as the same", async () => {
    const t = newT();
    const { w, open } = await setup(t);
    const teams = await t.run((ctx) =>
      printCard(ctx, w, { number: "8", extra: { sourceDisagreements: [teamsEntry([JUDGE], [SOTO])] } }),
    );
    const out = await pick(t, open, [JUDGE], { cardIds: [teams] });
    expect(out).toMatchObject({ scheduled: 0, refused: 1 });
  });

  test("the open card in cardIds is written once and not counted again", async () => {
    const t = newT();
    const { open, ids } = await fiveCards(t);
    const out = await pick(t, open, [JUDGE], { cardIds: [open, open, ids.same, ids.same] });
    expect(out).toEqual({ applied: 1, scheduled: 1, refused: 0 });
  });

  test("names left pending on the applied cards stay pending on each card; nothing else is written or scheduled", async () => {
    const t = newT();
    const { open, ids } = await fiveCards(t);
    await pick(t, open, [SOTO], { cardIds: [ids.same] });
    await drainScheduled(t);
    expect((await card(t, ids.same))!.pendingPlayerNames).toEqual([SOTO]);
    expect((await card(t, ids.same))!.sourceDisagreements).toBeUndefined();
    expect(await scheduledNames(t)).toEqual(
      (await scheduledNames(t)).filter((n) => n.includes("pickSourceValuePage")),
    );
  });

  test("a card is re-checked when its scheduled page runs: one settled in between is left alone", async () => {
    const t = newT();
    const { open, ids } = await fiveCards(t);
    await pick(t, open, [JUDGE], { cardIds: [ids.same] });
    // Between the call and the page, the operator picked the other card by hand
    // (a pick takes the entry off the card).
    await t.run((ctx) =>
      ctx.db.patch(ids.same, { sourceDisagreements: undefined, pendingPlayerNames: [SOTO] }),
    );
    await drainScheduled(t);
    const c = (await card(t, ids.same))!;
    expect(c.sourceDisagreements).toBeUndefined();
    expect(c.pendingPlayerNames).toEqual([SOTO]);
    expect(c.playerIds).toBeUndefined();
  });

  test("pickSourceValuePage counts what it refused", async () => {
    const t = newT();
    const { judge, open, ids } = await fiveCards(t);
    const out = await t.mutation(internal.tidyCards.pickSourceValuePage, {
      field: "players",
      value: [JUDGE],
      offered: [[JUDGE], [SOTO]],
      cardIds: [ids.same, ids.none],
      userId: "op",
    });
    expect(out).toEqual({ applied: 1, refused: 1 });
    expect((await card(t, ids.same))!.playerIds).toEqual([judge]);
    expect(open).toBeTruthy();
  });

  test("a page re-checks the disagreement itself: a card whose values changed since the call is refused", async () => {
    const t = newT();
    const { open, ids } = await fiveCards(t);
    await pick(t, open, [JUDGE], { cardIds: [ids.same, ids.sameReordered] });
    // Between the call and the page, a re-sync gave one card a different disagreement,
    // and (the other) dropped the picked value from its own offers.
    await t.run(async (ctx) => {
      await ctx.db.patch(ids.same, { sourceDisagreements: [playersEntry([JUDGE], ["Mookie Betts"])] });
      await ctx.db.patch(ids.sameReordered, { sourceDisagreements: [playersEntry([SOTO, "Extra"], [SOTO])] });
    });
    await drainScheduled(t);
    for (const id of [ids.same, ids.sameReordered]) {
      const c = (await card(t, id))!;
      expect(c.playerIds).toBeUndefined();
      // Refused: the card keeps the disagreement it now carries.
      expect(c.sourceDisagreements).toHaveLength(1);
    }
  });

  test("a page refuses a picked value its card no longer offers, even when the value sets still match in size", async () => {
    const t = newT();
    const { ids } = await fiveCards(t);
    const out = await t.mutation(internal.tidyCards.pickSourceValuePage, {
      field: "players",
      value: ["Somebody Else"],
      offered: [[JUDGE], [SOTO]],
      cardIds: [ids.same],
      userId: "op",
    });
    expect(out).toEqual({ applied: 0, refused: 1 });
    expect((await card(t, ids.same))!.playerIds).toBeUndefined();
  });

  test("a typed value needs no offer on the page, only the same disagreement", async () => {
    const t = newT();
    const { open, ids } = await fiveCards(t);
    await pick(t, open, ["Somebody Else"], { typed: true, cardIds: [ids.same, ids.differs] });
    await drainScheduled(t);
    expect((await card(t, ids.same))!.pendingPlayerNames).toEqual(["Somebody Else"]);
    expect((await card(t, ids.same))!.sourceDisagreements).toBeUndefined();
    expect((await card(t, ids.differs))!.pendingPlayerNames).toBeUndefined();
    expect((await card(t, ids.differs))!.sourceDisagreements).toHaveLength(1);
  });

  test("at most 100 OTHER cards: 101 is refused, and nothing at all is written, the open card included", async () => {
    const t = newT();
    const { w, open } = await setup(t);
    const ids = await t.run(async (ctx) => {
      const out: Array<Id<"cardChecklist">> = [];
      for (let i = 0; i < MAX_APPLY_CARDS + 1; i++) {
        out.push(await printCard(ctx, w, { number: `${100 + i}`, extra: { sourceDisagreements: [playersEntry()] } }));
      }
      return out;
    });
    await expect(pick(t, open, [JUDGE], { cardIds: ids })).rejects.toThrow(/At most 100/);
    expect((await card(t, open))!.sourceDisagreements).toEqual([playersEntry()]);
    expect((await card(t, open))!.playerIds).toBeUndefined();
  });

  test("exactly 100 other cards is allowed and pages in 50s", async () => {
    const t = newT();
    const { judge, w, open } = await setup(t);
    const ids = await t.run(async (ctx) => {
      const out: Array<Id<"cardChecklist">> = [];
      for (let i = 0; i < MAX_APPLY_CARDS; i++) {
        out.push(await printCard(ctx, w, { number: `${100 + i}`, extra: { sourceDisagreements: [playersEntry()] } }));
      }
      return out;
    });
    const out = await pick(t, open, [JUDGE], { cardIds: ids });
    expect(out).toEqual({ applied: 1, scheduled: 100, refused: 0 });
    const pages = (await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).filter((s) =>
      s.name.includes("pickSourceValuePage"),
    );
    expect(pages).toHaveLength(2);
    await drainScheduled(t);
    expect((await card(t, ids[99]))!.playerIds).toEqual([judge]);
  });
});

describe("pickSourceValue — cards on other leaves", () => {
  test("a name left pending on cards in two leaves is pending on each, with no lookup queued", async () => {
    const t = newT();
    const { w, open } = await setup(t);
    const other = await t.run((ctx) =>
      printCard(ctx, w, {
        leaf: w.insert,
        number: "9",
        extra: { sourceDisagreements: [playersEntry()] },
      }),
    );
    const out = await pick(t, open, [SOTO], { cardIds: [other] });
    expect(out).toEqual({ applied: 1, scheduled: 1, refused: 0 });
    await drainScheduled(t);
    expect((await card(t, open))!.pendingPlayerNames).toEqual([SOTO]);
    expect((await card(t, other))!.pendingPlayerNames).toEqual([SOTO]);
    const names = await scheduledNames(t);
    expect(names.filter((n) => !n.includes("pickSourceValuePage"))).toEqual([]);
  });
});

describe("pickSourceValue — the card's own name follows the pick (decision 23)", () => {
  const CARL_A = "Carl Boudreau";
  const CARL_B = "Carl Bodureau";
  const named = (t: T, w: Awaited<ReturnType<typeof setup>>["w"], n: string, cardName: string, entry: Entry) =>
    t.run((ctx) =>
      printCard(ctx, w, { number: n, extra: { cardName, sourceDisagreements: [entry] } }),
    );

  test("a card named for the losing source's spelling takes the picked spelling", async () => {
    const t = newT();
    const { w } = await setup(t);
    // Match Cards preselected the first spelling for the name; the operator picks the other.
    const id = await named(t, w, "20", CARL_A, playersEntry([CARL_A], [CARL_B]));
    await pick(t, id, [CARL_B]);
    expect((await card(t, id))!.cardName).toBe(CARL_B);
  });

  test("a card named for the picked spelling already keeps it", async () => {
    const t = newT();
    const { w } = await setup(t);
    const id = await named(t, w, "21", CARL_B, playersEntry([CARL_A], [CARL_B]));
    await pick(t, id, [CARL_B]);
    const c = (await card(t, id))!;
    expect(c.cardName).toBe(CARL_B);
  });

  test("a card name that matches no source value was typed by hand and is left alone", async () => {
    const t = newT();
    const { w } = await setup(t);
    const id = await named(t, w, "22", "Carl B. (rookie)", playersEntry([CARL_A], [CARL_B]));
    await pick(t, id, [CARL_B]);
    expect((await card(t, id))!.cardName).toBe("Carl B. (rookie)");
  });

  test("a rename bumps lastUpdated (the name is content under an open review)", async () => {
    const t = newT();
    const { w } = await setup(t);
    const id = await named(t, w, "23", CARL_A, playersEntry([CARL_A], [CARL_B]));
    await pick(t, id, [CARL_B]);
    expect((await card(t, id))!.lastUpdated).toBeGreaterThan(WORLD_NOW);
  });

  test("a typed value replaces a card name that was either source's spelling", async () => {
    const t = newT();
    const { w } = await setup(t);
    const id = await named(t, w, "24", CARL_B, playersEntry([CARL_A], [CARL_B]));
    await pick(t, id, ["Carl Boudreaux"], { typed: true });
    expect((await card(t, id))!.cardName).toBe("Carl Boudreaux");
  });

  test("a side holding several names never renames the card (each side must hold exactly one)", async () => {
    const t = newT();
    const { w } = await setup(t);
    const id = await named(t, w, "25", `${JUDGE} / ${SOTO}`, playersEntry([JUDGE, SOTO], [JUDGE]));
    await pick(t, id, [JUDGE]);
    expect((await card(t, id))!.cardName).toBe(`${JUDGE} / ${SOTO}`);
  });

  test("a picked value holding several names never renames the card", async () => {
    const t = newT();
    const { w } = await setup(t);
    const id = await named(t, w, "26", JUDGE, playersEntry([JUDGE], [JUDGE, SOTO]));
    await pick(t, id, [JUDGE, SOTO]);
    expect((await card(t, id))!.cardName).toBe(JUDGE);
  });

  test("the card name matches the losing side by case and edge space only", async () => {
    const t = newT();
    const { w } = await setup(t);
    const id = await named(t, w, "27", ` ${CARL_A.toUpperCase()} `, playersEntry([CARL_A], [CARL_B]));
    await pick(t, id, [CARL_B]);
    expect((await card(t, id))!.cardName).toBe(CARL_B);
    // An accent or a "|" is not the same name here: the card keeps what it has.
    const other = await named(t, w, "28", "Carl Boudreaú", playersEntry([CARL_A], [CARL_B]));
    await pick(t, other, [CARL_B]);
    expect((await card(t, other))!.cardName).toBe("Carl Boudreaú");
  });

  test("Apply to the same disagreement renames each card by the same rule", async () => {
    const t = newT();
    const { w } = await setup(t);
    const entry = playersEntry([CARL_A], [CARL_B]);
    const open = await named(t, w, "30", CARL_A, entry);
    const follows = await named(t, w, "31", CARL_A, entry);
    const typed = await named(t, w, "32", "Carl B. (rookie)", entry);
    await pick(t, open, [CARL_B], { cardIds: [follows, typed] });
    await drainScheduled(t);
    expect((await card(t, open))!.cardName).toBe(CARL_B);
    expect((await card(t, follows))!.cardName).toBe(CARL_B);
    expect((await card(t, typed))!.cardName).toBe("Carl B. (rookie)");
  });

  test("a teams pick never renames the card (main's teams branch leaves the name alone)", async () => {
    const t = newT();
    const { w, open } = await setup(t);
    const teamCard = await named(t, w, "40", "Padres", teamsEntry(["Padres"], ["San Diego Padres"]));
    await pick(t, teamCard, ["San Diego Padres"], { field: "teams" });
    expect((await card(t, teamCard))!.cardName).toBe("Padres");
    expect((await card(t, open))!.cardName).toBe("Card #1");
  });
});
