/**
 * NEO-645 — `tidyCards.pickSourceValue`: "the sources disagree, use this one".
 *
 * Until a value is chosen the disagreeing field holds NOTHING. Choosing resolves
 * each name the way the commit does: an existing answer applies; otherwise
 * EXACTLY ONE NB match links (a primary-name match: an alias-only or tied match
 * is a question, never an adoption); anything else becomes a pending name plus a
 * name row, its lookup enqueued after the write.
 *
 * "Apply to the cards with the same disagreement" is checked card by card on the
 * server: a card whose values differ (or that has already been settled) is
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
import { cancelScheduled, drainScheduled } from "../lib/testing/drain-scheduled";
import { normalizeEntityName } from "../lib/entities/normalize-name";
import {
  addPlayer,
  nameRow,
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

const playersEntry = (a = [JUDGE], b = [SOTO], chosen?: Entry["chosen"]): Entry => ({
  field: "players",
  values: [
    { value: a, sources: ["bsc"] },
    { value: b, sources: ["sportlots"] },
  ],
  ...(chosen ? { chosen } : {}),
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

const card = (t: T, id: Id<"cardChecklist">) => t.run((ctx) => ctx.db.get(id));
const pick = (
  t: T,
  cardId: Id<"cardChecklist">,
  value: string[],
  extra: { typed?: true; cardIds?: Array<Id<"cardChecklist">>; field?: "players" | "teams" } = {},
) =>
  t.withIdentity(ADMIN).mutation(api.tidyCards.pickSourceValue, {
    cardId,
    field: extra.field ?? "players",
    value,
    ...(extra.typed ? { typed: true as const } : {}),
    ...(extra.cardIds ? { cardIds: extra.cardIds } : {}),
  });
const nameRows = (t: T) => t.run((ctx) => ctx.db.query("tidyNames").collect());
const printedRows = (t: T, id: Id<"cardChecklist">) =>
  t.run((ctx) =>
    ctx.db
      .query("cardPrintedNames")
      .withIndex("by_card", (q) => q.eq("cardChecklistId", id))
      .collect(),
  );

describe("pickSourceValue — each name resolves the way the commit does", () => {
  test("an exact single NB match links; no name row, no printed row", async () => {
    const t = newT();
    const { judge, open } = await setup(t);
    const out = await pick(t, open, [JUDGE]);
    expect(out).toEqual({ applied: 1, scheduled: 0, refused: 0 });
    const c = (await card(t, open))!;
    expect(c.playerIds).toEqual([judge]);
    expect(c.playerLinks).toEqual([{ playerId: judge, nameOnCard: JUDGE }]);
    expect(c.pendingPlayerNames).toBeUndefined();
    expect(await nameRows(t)).toEqual([]);
    expect(await printedRows(t, open)).toEqual([]);
  });

  test("no NB match: a pending name, a name row born pending, and a printed row", async () => {
    const t = newT();
    const { w, open } = await setup(t);
    await pick(t, open, [SOTO]);
    const c = (await card(t, open))!;
    expect(c.playerIds).toBeUndefined();
    expect(c.pendingPlayerNames).toEqual([SOTO]);
    const rows = await nameRows(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      scopeId: w.base,
      kind: "player",
      nameNormalized: normalizeEntityName(SOTO),
      status: "pending",
      lookupGen: 0,
    });
    expect((await printedRows(t, open)).map((r) => [r.kind, r.printed, r.order])).toEqual([["player", SOTO, 0]]);
  });

  test("the lookup of a pending name is enqueued AFTER the write, for the leaf", async () => {
    const t = newT();
    const { open } = await setup(t);
    await pick(t, open, [SOTO]);
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled.some((s) => s.name.includes("enqueuePendingLookups"))).toBe(true);
  });

  test("a value that links everything schedules no lookup", async () => {
    const t = newT();
    const { open } = await setup(t);
    await pick(t, open, [JUDGE]);
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled.some((s) => s.name.includes("enqueuePendingLookups"))).toBe(false);
  });

  test("two namesakes are a question, never an adoption: pending, with the same-name choice on its row", async () => {
    const t = newT();
    const { w, open } = await setup(t);
    await t.run(async (ctx) => {
      await addPlayer(ctx, w, SOTO, undefined, { birthYear: 1998 });
      await addPlayer(ctx, w, SOTO, undefined, { birthYear: 1965 });
    });
    await pick(t, open, [SOTO]);
    expect((await card(t, open))!.playerIds).toBeUndefined();
    expect((await card(t, open))!.pendingPlayerNames).toEqual([SOTO]);
    const row = (await nameRows(t))[0];
    expect(row.status).toBe("ready");
    expect(row.enrichment?.existingCandidates).toHaveLength(2);
  });

  test("a player known only by an ALIAS is not adopted by name", async () => {
    const t = newT();
    const { w, open } = await setup(t);
    await t.run(async (ctx) => {
      await addPlayer(ctx, w, "Juan Carlos Soto", undefined, { aliases: [SOTO] });
    });
    await pick(t, open, [SOTO]);
    expect((await card(t, open))!.playerIds).toBeUndefined();
    expect((await card(t, open))!.pendingPlayerNames).toEqual([SOTO]);
  });

  test("an answer already on the name's row applies: a link", async () => {
    const t = newT();
    const { w, open } = await setup(t);
    const soto = await t.run(async (ctx) => {
      const soto = await addPlayer(ctx, w, "Juan Soto Jr");
      await nameRow(ctx, {
        scopeId: w.base,
        sportId: w.sport,
        kind: "player",
        name: SOTO,
        over: { answer: { kind: "linkPlayer", playerId: soto, by: "operator" }, answerGen: 1 },
      });
      return soto;
    });
    await pick(t, open, [SOTO]);
    expect((await card(t, open))!.playerIds).toEqual([soto]);
    expect((await card(t, open))!.pendingPlayerNames).toBeUndefined();
    // The card printed it, so it is indexed even though nothing is pending.
    expect((await printedRows(t, open)).map((r) => r.printed)).toEqual([SOTO]);
  });

  test("an answer already on the name's row applies: not a player leaves it off the card", async () => {
    const t = newT();
    const { w, open } = await setup(t);
    await t.run((ctx) =>
      nameRow(ctx, {
        scopeId: w.base,
        sportId: w.sport,
        kind: "player",
        name: SOTO,
        over: { answer: { kind: "notEntity", by: "operator" }, answerGen: 1 },
      }),
    );
    await pick(t, open, [SOTO]);
    const c = (await card(t, open))!;
    expect(c.playerIds).toBeUndefined();
    expect(c.pendingPlayerNames).toBeUndefined();
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
    const printed = await printedRows(t, open);
    expect(printed.map((r) => [r.printed, r.order])).toEqual([[SOTO, 1]]);
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
    await pick(t, open, ["Mystery Club"], { field: "teams" });
    const c = (await card(t, open))!;
    expect(c.teamOnCardIds).toBeUndefined();
    expect(c.pendingTeamNames).toEqual(["Mystery Club"]);
  });

  test("Change: re-picking replaces what the first pick wrote", async () => {
    const t = newT();
    const { judge, open } = await setup(t);
    await pick(t, open, [JUDGE]);
    expect((await card(t, open))!.playerIds).toEqual([judge]);
    await pick(t, open, [SOTO]);
    const c = (await card(t, open))!;
    expect(c.playerIds).toBeUndefined();
    expect(c.playerLinks).toBeUndefined();
    expect(c.pendingPlayerNames).toEqual([SOTO]);
    expect(c.sourceDisagreements?.[0].chosen).toEqual({ value: [SOTO], by: "operator" });
  });

  test("stamps chosen as the operator's, and a typed value says so", async () => {
    const t = newT();
    const { open } = await setup(t);
    await pick(t, open, ["Somebody Typed"], { typed: true });
    expect((await card(t, open))!.sourceDisagreements?.[0].chosen).toEqual({
      value: ["Somebody Typed"],
      by: "operator",
      typed: true,
    });
  });
});

describe("pickSourceValue — titles and lastUpdated", () => {
  test("a generated title is regenerated, a hand-typed one is left alone", async () => {
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
    expect((await card(t, typed))!.listingTitle).toBe("My own title");
    expect((await card(t, generated))!.playerIds).toEqual([judge]);
  });

  test("a link bumps lastUpdated (content changed under an open review)", async () => {
    const t = newT();
    const { open } = await setup(t);
    await pick(t, open, [JUDGE]);
    expect((await card(t, open))!.lastUpdated).toBeGreaterThan(WORLD_NOW);
  });

  test("the chosen stamp ALONE does not bump lastUpdated (the NEO-203 baseVersion)", async () => {
    const t = newT();
    const { w } = await setup(t);
    // One source named nobody (the checklist's "No team"): choosing it changes no field.
    const open = await t.run((ctx) =>
      printCard(ctx, w, { number: "9", extra: { sourceDisagreements: [teamsEntry(["San Diego Padres"], [])] } }),
    );
    await pick(t, open, [], { field: "teams" });
    const c = (await card(t, open))!;
    expect(c.sourceDisagreements?.[0].chosen).toEqual({ value: [], by: "operator" });
    expect(c.lastUpdated).toBe(WORLD_NOW);
  });
});

describe("pickSourceValue — what it refuses", () => {
  test("a value the sources never gave is refused (unless it is typed)", async () => {
    const t = newT();
    const { open } = await setup(t);
    await expect(pick(t, open, ["Nobody Offered"])).rejects.toThrow(/isn't one of the values/);
    expect((await card(t, open))!.sourceDisagreements?.[0].chosen).toBeUndefined();
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

  test("a typed value that would not fit the 4096-byte cap on the card is refused, and nothing is written", async () => {
    const t = newT();
    const { w } = await setup(t);
    const fat = Array.from({ length: 20 }, (_, i) => `${"A".repeat(100)}${i}`);
    const open = await t.run((ctx) =>
      printCard(ctx, w, { number: "11", extra: { sourceDisagreements: [playersEntry(fat, [SOTO])] } }),
    );
    const typed = Array.from({ length: 20 }, (_, i) => `${"B".repeat(100)}${i}`);
    await expect(pick(t, open, typed, { typed: true })).rejects.toThrow(/too long to keep/);
    const c = (await card(t, open))!;
    expect(c.sourceDisagreements?.[0].chosen).toBeUndefined();
    expect(c.pendingPlayerNames).toBeUndefined();
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
    expect((await card(t, open))!.sourceDisagreements?.[0].chosen).toBeUndefined();
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
        settled: await mk("5", [playersEntry([JUDGE], [SOTO], { value: [SOTO], by: "operator" })]),
        none: await printCard(ctx, w, { number: "6" }),
      };
    });
    return { w, judge, open, ids };
  }

  test("the server checks each card: the same values are written, anything else is refused and counted", async () => {
    const t = newT();
    const { judge, open, ids } = await fiveCards(t);
    const out = await pick(t, open, [JUDGE], {
      cardIds: [ids.same, ids.sameReordered, ids.differs, ids.settled, ids.none],
    });
    expect(out).toEqual({ applied: 1, scheduled: 2, refused: 3 });
    await drainScheduled(t);
    expect((await card(t, ids.same))!.playerIds).toEqual([judge]);
    expect((await card(t, ids.sameReordered))!.playerIds).toEqual([judge]);
    // The card whose values differ is NOT written, however the client counted it.
    const differs = (await card(t, ids.differs))!;
    expect(differs.playerIds).toBeUndefined();
    expect(differs.sourceDisagreements?.[0].chosen).toBeUndefined();
    // A card the operator already settled keeps its own choice.
    expect((await card(t, ids.settled))!.sourceDisagreements?.[0].chosen?.value).toEqual([SOTO]);
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

  test("names pending on the applied cards are queued for lookup, and each card gets its own name rows", async () => {
    const t = newT();
    const { w, open, ids } = await fiveCards(t);
    await pick(t, open, [SOTO], { cardIds: [ids.same] });
    await drainScheduled(t);
    expect((await card(t, ids.same))!.pendingPlayerNames).toEqual([SOTO]);
    expect((await printedRows(t, ids.same)).map((r) => r.printed)).toEqual([SOTO]);
    expect((await nameRows(t)).filter((r) => r.scopeId === w.base)).toHaveLength(1);
  });

  test("a card is re-checked when its scheduled page runs: one settled in between is left alone", async () => {
    const t = newT();
    const { open, ids } = await fiveCards(t);
    await pick(t, open, [JUDGE], { cardIds: [ids.same] });
    // Between the call and the page, the operator settled the other card by hand.
    await t.run((ctx) =>
      ctx.db.patch(ids.same, { sourceDisagreements: [playersEntry([JUDGE], [SOTO], { value: [SOTO], by: "operator" })] }),
    );
    await drainScheduled(t);
    const c = (await card(t, ids.same))!;
    expect(c.sourceDisagreements?.[0].chosen?.value).toEqual([SOTO]);
    expect(c.playerIds).toBeUndefined();
  });

  test("pickSourceValuePage counts what it refused", async () => {
    const t = newT();
    const { w, judge, open, ids } = await fiveCards(t);
    const out = await t.mutation(internal.tidyCards.pickSourceValuePage, {
      field: "players",
      value: [JUDGE],
      cardIds: [ids.same, ids.settled],
      userId: "op",
      leafId: w.base,
    });
    expect(out).toEqual({ applied: 1, refused: 1 });
    expect((await card(t, ids.same))!.playerIds).toEqual([judge]);
    expect(open).toBeTruthy();
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
    expect((await card(t, open))!.sourceDisagreements?.[0].chosen).toBeUndefined();
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
