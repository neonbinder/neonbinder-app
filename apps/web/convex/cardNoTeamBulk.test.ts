/**
 * NEO-556 — the operator's "Mark the teamless cards No Team" run
 * (`cardNoTeamBulk`): the target list and counts the confirm dialog reads,
 * and the paged run that stamps.
 *
 *   Baseball › 2024 › Topps (setName, No Team)
 *     › Base (variantType, No Team) › Chrome (insert, No Team) › Chrome Gold (parallel, No Team)
 *     › Insert (variantType, given the Yankees: left out)
 *     › Empty (variantType, No Team, cardCount 0: nothing to walk)
 */

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import { teamRowFields } from "./lib/teamRow";
import { insertTestCard } from "../lib/testing/card-row";
import {
  MAX_NO_TEAM_WALK,
  NO_TEAM_CHECKLIST_CHANGED,
  NO_TEAM_COUNT_CAP,
  NO_TEAM_NOT_SET,
  NO_TEAM_PAGE,
  NO_TEAM_SETTLING,
  NO_TEAM_WRONG_LEVEL,
  type NoTeamPage,
} from "./cardNoTeamBulk";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

type T = ReturnType<typeof convexTest>;
type RowId = Id<"selectorOptions">;

const ADMIN = { subject: "admin_neo556_run", role: "admin" };
const SETTER = "user_neo556_setter";
const NOW = 1_700_000_000_000;
const NO_TEAM = { setAt: NOW, setByUserId: SETTER };
/** A lookup that has been and gone (BSC answered with no team). */
const ANSWERED = { teamCheckDoneAt: NOW, teamCheckOutcome: "answered" as const };

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

async function seed(t: T) {
  return t.run(async (ctx) => {
    const mk = async (
      level: Doc<"selectorOptions">["level"],
      value: string,
      parentId: RowId | undefined,
      extra: Partial<Doc<"selectorOptions">> = {},
    ) => {
      const id = await ctx.db.insert("selectorOptions", {
        level,
        value,
        ...(parentId ? { parentId } : {}),
        platformData: {},
        children: [],
        lastUpdated: NOW,
        ...extra,
      });
      if (parentId) {
        const parent = await ctx.db.get(parentId);
        await ctx.db.patch(parentId, { children: [...(parent!.children ?? []), id] });
      }
      return id;
    };
    const sport = await mk("sport", "Baseball", undefined);
    const year = await mk("year", "2024", sport);
    const setName = await mk("setName", "Topps", year, { noTeamDefault: NO_TEAM });
    const base = await mk("variantType", "Base", setName, { noTeamDefault: NO_TEAM });
    const insert = await mk("insert", "Chrome", base, { noTeamDefault: NO_TEAM });
    const parallel = await mk("parallel", "Chrome Gold", insert, { noTeamDefault: NO_TEAM });
    const yankees = await ctx.db.insert("teams", {
      ...teamRowFields({ location: "New York", name: "Yankees" }),
      sportId: sport,
      lastUpdated: NOW,
    });
    const teamed = await mk("variantType", "Insert", setName, { teamIds: [yankees] });
    const empty = await mk("variantType", "Empty", setName, { noTeamDefault: NO_TEAM, cardCount: 0 });
    return { sport, year, setName, base, insert, parallel, teamed, empty, yankees };
  });
}
type Fx = Awaited<ReturnType<typeof seed>>;

let cardSeq = 0;
async function card(t: T, selectorOptionId: RowId, extra: Partial<Doc<"cardChecklist">> = {}) {
  cardSeq++;
  return t.run((ctx) =>
    insertTestCard(ctx, {
      selectorOptionId,
      cardNumber: String(cardSeq),
      cardName: `Card ${cardSeq}`,
      platformData: {},
      sortOrder: cardSeq,
      lastUpdated: NOW,
      ...extra,
    }),
  );
}

/** One card per verdict on Base, a stampable one on the insert and parallel, one on the teamed type. */
async function seedCards(t: T, fx: Fx) {
  return {
    teamless: await card(t, fx.base),
    teamed: await card(t, fx.base, { teamOnCardIds: [fx.yankees] }),
    pending: await card(t, fx.base, { pendingTeamNames: ["Gotham Knights"] }),
    listing: await card(t, fx.base, {
      ...ANSWERED,
      bscTeamName: "Gotham Knights",
      platformData: { bsc: { ref: "bsc-listing", src: "b0" } },
    }),
    awaiting: await card(t, fx.base, { platformData: { bsc: { ref: "bsc-awaiting", src: "b0" } } }),
    answered: await card(t, fx.base, {
      ...ANSWERED,
      platformData: { bsc: { ref: "bsc-answered", src: "b0" } },
    }),
    gaveUp: await card(t, fx.base, {
      teamCheckDoneAt: NOW,
      teamCheckOutcome: "gaveUp",
      platformData: { bsc: { ref: "bsc-gaveup", src: "b0" } },
    }),
    already: await card(t, fx.base, { teamNoneConfirmedAt: 5, teamNoneConfirmedByUserId: "user_operator" }),
    onInsert: await card(t, fx.insert),
    onParallel: await card(t, fx.parallel),
    onTeamed: await card(t, fx.teamed),
  };
}

const getCard = (t: T, id: Id<"cardChecklist">) => t.run(async (ctx) => ctx.db.get(id));

async function runAll(t: T, rootId: RowId): Promise<NoTeamPage[]> {
  const pages: NoTeamPage[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 50; i++) {
    const page: NoTeamPage = await t
      .withIdentity(ADMIN)
      .mutation(api.cardNoTeamBulk.applyNoTeamPage, { selectorOptionId: rootId, cursor });
    pages.push(page);
    cursor = page.cursor;
    if (cursor === null) return pages;
  }
  throw new Error("run did not finish");
}

describe("noTeamTargets (NEO-556)", () => {
  test("lists the No Team rows in walk order and counts every card by verdict", async () => {
    const t = harness();
    const fx = await seed(t);
    await seedCards(t, fx);
    const got = await t.withIdentity(ADMIN).query(api.cardNoTeamBulk.noTeamTargets, {
      selectorOptionId: fx.setName,
    });
    expect(got.targets.map((r) => [r._id, r.name, r.level, r.toStamp])).toEqual([
      [fx.base, "Base", "variantType", 2],
      [fx.insert, "Chrome", "insert", 1],
      [fx.parallel, "Chrome Gold", "parallel", 1],
    ]);
    expect(got.toStamp).toBe(4);
    expect(got.kept).toEqual({
      alreadyNoTeam: 1,
      hasTeam: 1,
      pendingName: 1,
      listingNamesTeam: 1,
      awaitingLookup: 1,
      lookupGaveUp: 1,
    });
    // The teamed variant type is left out; the empty one has nothing to walk.
    expect(got.rowsWithOtherDefault).toBe(1);
    expect(got.walkTruncated).toBe(false);
    expect(got.countTruncated).toBe(false);
  });

  test("walkTruncated: rows past the walk cap are neither counted nor visited by the run", async () => {
    const t = harness();
    const fx = await seed(t);
    // A No Team row with MAX_NO_TEAM_WALK empty children, then one holding a
    // stampable card: the walk reads exactly the cap and stops before it.
    const { holder, ids } = await t.run(async (ctx) => {
      const holder = await ctx.db.insert("selectorOptions", {
        level: "variantType",
        value: "Wide",
        parentId: fx.setName,
        platformData: {},
        children: [],
        lastUpdated: NOW,
        noTeamDefault: NO_TEAM,
      });
      const ids: RowId[] = [];
      for (let i = 0; i <= MAX_NO_TEAM_WALK; i++) {
        ids.push(
          await ctx.db.insert("selectorOptions", {
            level: "insert",
            value: `Wide ${i}`,
            parentId: holder,
            platformData: {},
            children: [],
            lastUpdated: NOW,
            noTeamDefault: NO_TEAM,
            ...(i < MAX_NO_TEAM_WALK ? { cardCount: 0 } : {}),
          }),
        );
      }
      await ctx.db.patch(holder, { children: ids });
      return { holder, ids };
    });
    const pastCap = await card(t, ids[MAX_NO_TEAM_WALK]);
    const got = await t.withIdentity(ADMIN).query(api.cardNoTeamBulk.noTeamTargets, {
      selectorOptionId: holder,
    });
    expect(got.walkTruncated).toBe(true);
    expect(got.countTruncated).toBe(false);
    expect(got.toStamp).toBe(0);
    await runAll(t, holder);
    expect((await getCard(t, pastCap))!.teamNoneConfirmedAt).toBeUndefined();

    // Exactly at the cap is not past it.
    await t.run(async (ctx) => ctx.db.patch(holder, { children: ids.slice(0, MAX_NO_TEAM_WALK) }));
    const atCap = await t.withIdentity(ADMIN).query(api.cardNoTeamBulk.noTeamTargets, {
      selectorOptionId: holder,
    });
    expect(atCap.walkTruncated).toBe(false);
  });

  test("countTruncated: past the count cap the numbers are a floor, and the run still stamps every card", async () => {
    const t = harness();
    const fx = await seed(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < NO_TEAM_COUNT_CAP; i++) {
        await insertTestCard(ctx, {
          selectorOptionId: fx.base,
          cardNumber: `C${i}`,
          cardName: `Count ${i}`,
          platformData: {},
          sortOrder: i,
          lastUpdated: NOW,
        });
      }
    });
    const ask = () =>
      t.withIdentity(ADMIN).query(api.cardNoTeamBulk.noTeamTargets, { selectorOptionId: fx.base });
    // Exactly at the cap: every card counted, not a floor.
    const atCap = await ask();
    expect(atCap.countTruncated).toBe(false);
    expect(atCap.walkTruncated).toBe(false);
    expect(atCap.toStamp).toBe(NO_TEAM_COUNT_CAP);

    // One past it, on a row the count never reaches.
    const extra = await card(t, fx.insert);
    const over = await ask();
    expect(over.countTruncated).toBe(true);
    expect(over.walkTruncated).toBe(false);
    expect(over.toStamp).toBe(NO_TEAM_COUNT_CAP);
    expect(over.targets.map((r) => [r._id, r.toStamp])).toEqual([
      [fx.base, NO_TEAM_COUNT_CAP],
      [fx.insert, 0],
      [fx.parallel, 0],
    ]);

    // The run pages, so it is not bound by the count cap.
    const pages: NoTeamPage[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 100; i++) {
      const page: NoTeamPage = await t
        .withIdentity(ADMIN)
        .mutation(api.cardNoTeamBulk.applyNoTeamPage, { selectorOptionId: fx.base, cursor });
      pages.push(page);
      cursor = page.cursor;
      if (cursor === null) break;
    }
    expect(cursor).toBeNull();
    expect(pages.reduce((n, p) => n + p.stamped, 0)).toBe(NO_TEAM_COUNT_CAP + 1);
    expect((await getCard(t, extra))!.teamNoneConfirmedAt).toBeDefined();
  }, 60_000);

  test("a run from a row below the set covers that row and what sits beneath it", async () => {
    const t = harness();
    const fx = await seed(t);
    await seedCards(t, fx);
    const got = await t.withIdentity(ADMIN).query(api.cardNoTeamBulk.noTeamTargets, {
      selectorOptionId: fx.insert,
    });
    expect(got.targets.map((r) => r._id)).toEqual([fx.insert, fx.parallel]);
    expect(got.toStamp).toBe(2);
    expect(got.rowsWithOtherDefault).toBe(0);
  });

  test("refuses a row that is not No Team, a row above a set, and a row mid-cascade", async () => {
    const t = harness();
    const fx = await seed(t);
    const ask = (id: RowId) =>
      t.withIdentity(ADMIN).query(api.cardNoTeamBulk.noTeamTargets, { selectorOptionId: id });
    await expect(ask(fx.teamed)).rejects.toThrow(NO_TEAM_NOT_SET);
    await expect(ask(fx.year)).rejects.toThrow(NO_TEAM_WRONG_LEVEL);
    await t.run(async (ctx) => ctx.db.patch(fx.setName, { teamCascadeStartedAt: Date.now() }));
    await expect(ask(fx.setName)).rejects.toThrow(NO_TEAM_SETTLING);
    // A stamp past the stale window is a cascade that died; it no longer blocks.
    await t.run(async (ctx) =>
      ctx.db.patch(fx.setName, { teamCascadeStartedAt: Date.now() - 11 * 60 * 1000 }),
    );
    await expect(ask(fx.setName)).resolves.toBeDefined();
  });
});

describe("applyNoTeamPage (NEO-556)", () => {
  test("stamps exactly the cards the verdict says, with the calling admin, and leaves the rest", async () => {
    const t = harness();
    const fx = await seed(t);
    const cards = await seedCards(t, fx);
    const before = Date.now();
    const pages = await runAll(t, fx.setName);
    expect(pages.map((p) => [p.targetId, p.targetIndex, p.targetCount])).toEqual([
      [fx.base, 0, 3],
      [fx.insert, 1, 3],
      [fx.parallel, 2, 3],
    ]);
    expect(pages.reduce((n, p) => n + p.stamped, 0)).toBe(4);
    expect(pages[0].kept).toEqual({
      alreadyNoTeam: 1,
      hasTeam: 1,
      pendingName: 1,
      listingNamesTeam: 1,
      awaitingLookup: 1,
      lookupGaveUp: 1,
    });

    for (const id of [cards.teamless, cards.answered, cards.onInsert, cards.onParallel]) {
      const c = await getCard(t, id);
      expect(c!.teamNoneConfirmedAt, id).toBeGreaterThanOrEqual(before);
      expect(c!.teamNoneConfirmedByUserId, id).toBe(ADMIN.subject);
    }
    // Rule 8: the listing's team holds the stamp back; the hint stays.
    const listing = await getCard(t, cards.listing);
    expect(listing!.teamNoneConfirmedAt).toBeUndefined();
    expect(listing!.bscTeamName).toBe("Gotham Knights");
    // A team is never cleared; a pending name never dropped.
    expect((await getCard(t, cards.teamed))!.teamOnCardIds).toEqual([fx.yankees]);
    expect((await getCard(t, cards.teamed))!.teamNoneConfirmedAt).toBeUndefined();
    expect((await getCard(t, cards.pending))!.pendingTeamNames).toEqual(["Gotham Knights"]);
    expect((await getCard(t, cards.gaveUp))!.teamNoneConfirmedAt).toBeUndefined();
    // An operator's own ruling is kept as it was.
    const already = await getCard(t, cards.already);
    expect(already!.teamNoneConfirmedAt).toBe(5);
    expect(already!.teamNoneConfirmedByUserId).toBe("user_operator");
    // The row given a team is not walked.
    expect((await getCard(t, cards.onTeamed))!.teamNoneConfirmedAt).toBeUndefined();
  });

  test("a card awaiting its BSC lookup is skipped, then stamped by the lookup's empty answer", async () => {
    const t = harness();
    const fx = await seed(t);
    const cards = await seedCards(t, fx);
    await runAll(t, fx.setName);
    expect((await getCard(t, cards.awaiting))!.teamNoneConfirmedAt).toBeUndefined();

    await t.mutation(internal.cardChecklist.applyBscTeamResolution, {
      cardChecklistId: cards.awaiting,
      rawTeamName: "",
      teamNames: [],
    });
    const after = await getCard(t, cards.awaiting);
    expect(after!.teamNoneConfirmedAt).toBeTypeOf("number");
    // The background path credits whoever set the No Team, not the run's admin.
    expect(after!.teamNoneConfirmedByUserId).toBe(SETTER);
  });

  test("a row with more cards than a page resumes from the cursor and stamps every card", async () => {
    const t = harness();
    const fx = await seed(t);
    const COUNT = NO_TEAM_PAGE + 5;
    await t.run(async (ctx) => {
      for (let i = 0; i < COUNT; i++) {
        await insertTestCard(ctx, {
          selectorOptionId: fx.parallel,
          cardNumber: `P${i}`,
          cardName: `Card P${i}`,
          platformData: {},
          sortOrder: i,
          lastUpdated: NOW,
        });
      }
    });
    const first = await t
      .withIdentity(ADMIN)
      .mutation(api.cardNoTeamBulk.applyNoTeamPage, { selectorOptionId: fx.parallel, cursor: null });
    expect(first).toMatchObject({ targetId: fx.parallel, targetCount: 1, scanned: NO_TEAM_PAGE, stamped: NO_TEAM_PAGE });
    expect(first.cursor).not.toBeNull();
    const second = await t
      .withIdentity(ADMIN)
      .mutation(api.cardNoTeamBulk.applyNoTeamPage, { selectorOptionId: fx.parallel, cursor: first.cursor });
    expect(second).toMatchObject({ targetId: fx.parallel, scanned: 5, stamped: 5, cursor: null });
    expect(second.kept.alreadyNoTeam).toBe(0);
    const unstamped = await t.run(async (ctx) =>
      (
        await ctx.db
          .query("cardChecklist")
          .withIndex("by_selector_option", (q) => q.eq("selectorOptionId", fx.parallel))
          .collect()
      ).filter((c) => c.teamNoneConfirmedAt === undefined),
    );
    expect(unstamped).toEqual([]);
  });

  test("a rerun is harmless: nothing is rewritten, every earlier stamp counts as already No Team", async () => {
    const t = harness();
    const fx = await seed(t);
    const cards = await seedCards(t, fx);
    await runAll(t, fx.setName);
    const firstStamp = (await getCard(t, cards.teamless))!.teamNoneConfirmedAt;
    const again = await runAll(t, fx.setName);
    expect(again.reduce((n, p) => n + p.stamped, 0)).toBe(0);
    expect(again.reduce((n, p) => n + p.kept.alreadyNoTeam, 0)).toBe(5);
    expect((await getCard(t, cards.teamless))!.teamNoneConfirmedAt).toBe(firstStamp);
  });

  test("a run with nothing to walk answers one empty page", async () => {
    const t = harness();
    const fx = await seed(t);
    const page = await t
      .withIdentity(ADMIN)
      .mutation(api.cardNoTeamBulk.applyNoTeamPage, { selectorOptionId: fx.empty, cursor: null });
    expect(page).toMatchObject({ targetId: null, targetCount: 0, scanned: 0, stamped: 0, cursor: null });
  });

  test("refuses a row no longer No Team, a cursor from another run, and a checklist that changed mid-way", async () => {
    const t = harness();
    const fx = await seed(t);
    await seedCards(t, fx);
    const page = (id: RowId, cursor: string | null) =>
      t.withIdentity(ADMIN).mutation(api.cardNoTeamBulk.applyNoTeamPage, { selectorOptionId: id, cursor });

    await expect(page(fx.teamed, null)).rejects.toThrow(NO_TEAM_NOT_SET);

    const first = await page(fx.setName, null);
    expect(first.cursor).not.toBeNull();
    // Another run's cursor (bound to the set) on the insert's run.
    await expect(page(fx.insert, first.cursor)).rejects.toThrow(NO_TEAM_CHECKLIST_CHANGED);
    await expect(page(fx.setName, "not a cursor")).rejects.toThrow(NO_TEAM_CHECKLIST_CHANGED);

    // The insert is given a team between pages: the list the cursor indexes moved.
    await t.run(async (ctx) => ctx.db.patch(fx.insert, { noTeamDefault: undefined, teamIds: [fx.yankees] }));
    await expect(page(fx.setName, first.cursor)).rejects.toThrow(NO_TEAM_CHECKLIST_CHANGED);

    // The set itself moved off No Team: refused, nothing stamped.
    await t.run(async (ctx) => ctx.db.patch(fx.setName, { noTeamDefault: undefined }));
    await expect(page(fx.setName, null)).rejects.toThrow(NO_TEAM_NOT_SET);
  });

  test("refuses while the set's last team change is still cascading, and stamps nothing", async () => {
    const t = harness();
    const fx = await seed(t);
    const cards = await seedCards(t, fx);
    await t.run(async (ctx) => ctx.db.patch(fx.setName, { teamCascadeStartedAt: Date.now() }));
    await expect(
      t.withIdentity(ADMIN).mutation(api.cardNoTeamBulk.applyNoTeamPage, { selectorOptionId: fx.setName, cursor: null }),
    ).rejects.toThrow(NO_TEAM_SETTLING);
    expect((await getCard(t, cards.teamless))!.teamNoneConfirmedAt).toBeUndefined();
  });
});
