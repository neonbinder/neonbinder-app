/**
 * NEO-645 — `tidyNames.answerName`, the one door for a name's answer.
 *
 * The open card is patched in the SAME transaction; the rest of the scope is
 * written by the scheduled fan-out (parallel copies included: they keep their
 * source leaf's scope). What is pinned here, per the build contract:
 *
 *   - `cardOverride` is never overwritten;
 *   - compare-and-set: a card whose state is not what the previous answer left
 *     is skipped; a newer answer (`answerGen`) stops the older job's pages;
 *   - accent variants are ONE row, and each card keeps its own spelling;
 *   - "Not a player" takes the name out of pending AND the generated title,
 *     and clear/Change brings it back;
 *   - a multi-player card keeps its printed order;
 *   - `saveAsAlias` (NEO-284) and `addSetSport` (NEO-313) are written;
 *   - the teamless-sport default (NEO-426) is re-asked of a card that just lost
 *     its last pending player name;
 *   - `requireAdmin`.
 *
 * Page-level mechanics of the fan-out (the page size, cost) are in
 * `tidyNames.fanOut.test.ts`.
 */

import { convexTest } from "convex-test";
import { afterEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { cancelScheduled, drainScheduled } from "../lib/testing/drain-scheduled";
import { normalizeEntityName } from "../lib/entities/normalize-name";
import {
  addPlayer,
  nameRow,
  printCard,
  seedTidyWorld,
  stampGeneratedTitle,
  type TidyWorld,
} from "../lib/testing/tidy-world";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const ADMIN = { subject: "user_tidy_answer_admin", role: "admin" };
const MEMBER = { subject: "user_tidy_answer_member" };
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

const BO = "Bo Jackson";
const KEY = normalizeEntityName(BO);

type World = TidyWorld & { bo: Id<"players">; other: Id<"players"> };

/** The chain, Bo Jackson and a namesake, and a settled unanswered row for "Bo Jackson". */
async function world(t: T): Promise<World> {
  return t.run(async (ctx) => {
    const w = await seedTidyWorld(ctx);
    const bo = await addPlayer(ctx, w, BO);
    const other = await addPlayer(ctx, w, "Vincent Jackson");
    await nameRow(ctx, { scopeId: w.base, sportId: w.sport, kind: "player", name: BO });
    return { ...w, bo, other } as World;
  });
}

const card = (t: T, id: Id<"cardChecklist">) => t.run((ctx) => ctx.db.get(id));
const rowOf = (t: T, scopeId: Id<"selectorOptions">, kind: "player" | "team", name: string) =>
  t.run((ctx) =>
    ctx.db
      .query("tidyNames")
      .withIndex("by_scope_kind_name", (q) =>
        q.eq("scopeId", scopeId).eq("kind", kind).eq("nameNormalized", normalizeEntityName(name)),
      )
      .first(),
  );
const answerPlayer = (
  t: T,
  cardId: Id<"cardChecklist">,
  playerId: Id<"players">,
  name = BO,
  extra: { addSetSport?: true } = {},
) =>
  t.withIdentity(ADMIN).mutation(api.tidyNames.answerName, {
    cardId,
    kind: "player",
    name,
    answer: { kind: "linkPlayer", playerId, ...extra },
  });

describe("answerName — the open card and the fan-out", () => {
  test("the open card is patched in the same transaction; the rest waits for the fan-out", async () => {
    const t = newT();
    const w = await world(t);
    const [open, other] = await t.run(async (ctx) => [
      await printCard(ctx, w, { number: "1", printed: [{ kind: "player", name: BO }] }),
      await printCard(ctx, w, { number: "2", printed: [{ kind: "player", name: BO }] }),
    ]);

    const out = await answerPlayer(t, open, w.bo);
    expect(out).toEqual({ answerGen: 1, fanOutScheduled: true });

    // Before the scheduled job runs: the open card is done, the other is not.
    const openCard = (await card(t, open))!;
    expect(openCard.playerIds).toEqual([w.bo]);
    expect(openCard.playerLinks).toEqual([{ playerId: w.bo, nameOnCard: BO }]);
    expect(openCard.pendingPlayerNames).toBeUndefined();
    expect((await card(t, other))!.playerIds).toBeUndefined();
    expect((await card(t, other))!.pendingPlayerNames).toEqual([BO]);

    await drainScheduled(t);
    expect((await card(t, other))!.playerIds).toEqual([w.bo]);
    expect((await card(t, other))!.pendingPlayerNames).toBeUndefined();
  });

  test("records the answer as the operator's, with who and when", async () => {
    const t = newT();
    const w = await world(t);
    const open = await t.run((ctx) =>
      printCard(ctx, w, { number: "1", printed: [{ kind: "player", name: BO }] }),
    );
    await answerPlayer(t, open, w.bo);
    const row = (await rowOf(t, w.base, "player", BO))!;
    expect(row.answer).toEqual({ kind: "linkPlayer", playerId: w.bo, by: "operator" });
    expect(row.answerGen).toBe(1);
    expect(row.answeredByUserId).toBeTruthy();
    expect(row.answeredAt).toBeGreaterThan(0);
  });

  test("a parallel copy keeps its SOURCE leaf's scope, so the same answer reaches it", async () => {
    const t = newT();
    const w = await world(t);
    const [open, copy] = await t.run(async (ctx) => [
      await printCard(ctx, w, { number: "1", printed: [{ kind: "player", name: BO }] }),
      // The copy lives on the parallel leaf; its printed row is scoped to the base leaf.
      await printCard(ctx, w, {
        leaf: w.parallel,
        number: "1",
        printed: [{ kind: "player", name: BO, scopeId: w.base }],
      }),
    ]);
    await answerPlayer(t, open, w.bo);
    await drainScheduled(t);
    expect((await card(t, copy))!.playerIds).toEqual([w.bo]);
    // And no name row was born on the copy's own leaf.
    expect(await rowOf(t, w.parallel, "player", BO)).toBeNull();
  });

  test("a card in ANOTHER scope that prints the same name is not touched", async () => {
    const t = newT();
    const w = await world(t);
    const [open, elsewhere] = await t.run(async (ctx) => {
      await nameRow(ctx, { scopeId: w.insert, sportId: w.sport, kind: "player", name: BO });
      return [
        await printCard(ctx, w, { number: "1", printed: [{ kind: "player", name: BO }] }),
        await printCard(ctx, w, { leaf: w.insert, number: "1", printed: [{ kind: "player", name: BO }] }),
      ];
    });
    await answerPlayer(t, open, w.bo);
    await drainScheduled(t);
    expect((await card(t, elsewhere))!.playerIds).toBeUndefined();
    expect((await card(t, elsewhere))!.pendingPlayerNames).toEqual([BO]);
  });

  test("a card the operator edited by hand (cardOverride) is never overwritten", async () => {
    const t = newT();
    const w = await world(t);
    const [open, edited] = await t.run(async (ctx) => [
      await printCard(ctx, w, { number: "1", printed: [{ kind: "player", name: BO }] }),
      await printCard(ctx, w, {
        number: "2",
        printed: [{ kind: "player", name: BO, cardOverride: true }],
      }),
    ]);
    await answerPlayer(t, open, w.bo);
    await drainScheduled(t);
    const after = (await card(t, edited))!;
    expect(after.playerIds).toBeUndefined();
    expect(after.pendingPlayerNames).toEqual([BO]);
  });

  test("answering with the same answer again writes nothing and schedules nothing", async () => {
    const t = newT();
    const w = await world(t);
    const [open] = await t.run(async (ctx) => [
      await printCard(ctx, w, { number: "1", printed: [{ kind: "player", name: BO }] }),
      await printCard(ctx, w, { number: "2", printed: [{ kind: "player", name: BO }] }),
    ]);
    await answerPlayer(t, open, w.bo);
    await drainScheduled(t);
    const again = await answerPlayer(t, open, w.bo);
    expect(again).toEqual({ answerGen: 1, fanOutScheduled: false });
  });

  test("no fan-out is scheduled when the open card is the only printer", async () => {
    const t = newT();
    const w = await world(t);
    const open = await t.run((ctx) =>
      printCard(ctx, w, { number: "1", printed: [{ kind: "player", name: BO }] }),
    );
    expect((await answerPlayer(t, open, w.bo)).fanOutScheduled).toBe(false);
  });
});

describe("answerName — compare-and-set and the generation", () => {
  test("Change: a card the operator linked to someone else by hand is skipped, not overwritten", async () => {
    const t = newT();
    const w = await world(t);
    const [open, handLinked, followed] = await t.run(async (ctx) => [
      await printCard(ctx, w, { number: "1", printed: [{ kind: "player", name: BO }] }),
      await printCard(ctx, w, { number: "2", printed: [{ kind: "player", name: BO }] }),
      await printCard(ctx, w, { number: "3", printed: [{ kind: "player", name: BO }] }),
    ]);
    await answerPlayer(t, open, w.bo);
    await drainScheduled(t);
    // The operator relinks card 2 by hand to the namesake (no cardOverride mark).
    await t.run((ctx) =>
      ctx.db.patch(handLinked, {
        playerIds: [w.other],
        playerLinks: [{ playerId: w.other, nameOnCard: BO }],
      }),
    );
    await answerPlayer(t, open, w.other); // Change the answer
    await drainScheduled(t);
    expect((await card(t, followed))!.playerIds).toEqual([w.other]);
    // Card 2 was already on the namesake and not in the state the first answer left.
    expect((await card(t, handLinked))!.playerIds).toEqual([w.other]);
    expect((await card(t, handLinked))!.playerLinks).toEqual([{ playerId: w.other, nameOnCard: BO }]);
  });

  test("Change: a card that no longer shows what the previous answer produced is left alone", async () => {
    const t = newT();
    const w = await world(t);
    const [open, drifted] = await t.run(async (ctx) => [
      await printCard(ctx, w, { number: "1", printed: [{ kind: "player", name: BO }] }),
      await printCard(ctx, w, { number: "2", printed: [{ kind: "player", name: BO }] }),
    ]);
    await answerPlayer(t, open, w.bo);
    await drainScheduled(t);
    // A sync (or the operator) took Bo's link off card 2 and left it blank.
    await t.run((ctx) =>
      ctx.db.patch(drifted, {
        playerIds: undefined,
        playerLinks: undefined,
        pendingPlayerNames: undefined,
      }),
    );
    await answerPlayer(t, open, w.other);
    await drainScheduled(t);
    const after = (await card(t, drifted))!;
    expect(after.playerIds).toBeUndefined();
    expect(after.pendingPlayerNames).toBeUndefined();
  });

  // An answer given while the previous answer's fan-out has not reached every
  // card: job 1 stops (stale), and job 2 takes a card in ANY state an earlier
  // unfinished answer may have left (`tidyNames.fanOutFrom`), so nobody is
  // stranded on the older answer or still pending.
  test("a newer answer stops the older job: every card ends on the LAST answer", async () => {
    const t = newT();
    const w = await world(t);
    const ids = await t.run(async (ctx) => {
      const out: Array<Id<"cardChecklist">> = [];
      for (let i = 1; i <= 5; i++) {
        out.push(await printCard(ctx, w, { number: String(i), printed: [{ kind: "player", name: BO }] }));
      }
      return out;
    });
    // Two answers before either job runs: job 1 is stale by the time it starts.
    const first = await answerPlayer(t, ids[0], w.bo);
    const second = await answerPlayer(t, ids[0], w.other);
    expect(second.answerGen).toBe(first.answerGen + 1);
    await drainScheduled(t);
    for (const id of ids) {
      const c = (await card(t, id))!;
      expect(c.playerIds, `card ${c.cardNumber}`).toEqual([w.other]);
    }
  });
});

describe("answerName — one row per name, however it is spelled", () => {
  test("accent variants are ONE name row, and each card keeps its own spelling", async () => {
    const t = newT();
    const w = await world(t);
    const acuna = await t.run((ctx) => addPlayer(ctx, w, "Ronald Acuna Jr."));
    const [open, accented] = await t.run(async (ctx) => {
      await nameRow(ctx, { scopeId: w.base, sportId: w.sport, kind: "player", name: "Ronald Acuña Jr." });
      return [
        await printCard(ctx, w, { number: "1", printed: [{ kind: "player", name: "Ronald Acuña Jr." }] }),
        await printCard(ctx, w, { number: "2", printed: [{ kind: "player", name: "Ronald Acuna Jr." }] }),
      ];
    });
    const rows = await t.run((ctx) =>
      ctx.db
        .query("tidyNames")
        .withIndex("by_scope_kind_name", (q) => q.eq("scopeId", w.base))
        .collect(),
    );
    expect(rows.filter((r) => r.nameNormalized === normalizeEntityName("Ronald Acuña Jr."))).toHaveLength(1);
    await answerPlayer(t, open, acuna, "Ronald Acuña Jr.");
    await drainScheduled(t);
    // The card printed the unaccented spelling: that is ITS fact, kept.
    expect((await card(t, accented))!.playerLinks).toEqual([
      { playerId: acuna, nameOnCard: "Ronald Acuna Jr." },
    ]);
  });

  test("a name that is not on the card, or has no row, has nothing to answer", async () => {
    const t = newT();
    const w = await world(t);
    const open = await t.run((ctx) =>
      printCard(ctx, w, { number: "1", printed: [{ kind: "player", name: BO }] }),
    );
    await expect(answerPlayer(t, open, w.bo, "Somebody Else")).rejects.toThrow(/isn't on this card/);
    const noRow = await t.run((ctx) =>
      printCard(ctx, w, { number: "2", printed: [{ kind: "player", name: "Rowless Rookie" }] }),
    );
    await expect(answerPlayer(t, noRow, w.bo, "Rowless Rookie")).rejects.toThrow(/nothing to answer/);
  });
});

describe("answerName — Not a player takes the name off the card AND out of its title", () => {
  async function twoCards(t: T) {
    const w = await world(t);
    const ids = await t.run(async (ctx) => {
      const mk = async (n: string) => {
        const id = await printCard(ctx, w, { number: n, printed: [{ kind: "player", name: BO }] });
        await stampGeneratedTitle(ctx, id);
        return id;
      };
      return [await mk("1"), await mk("2")] as const;
    });
    return { w, ids };
  }

  test("pending name and generated title both lose it, on the open card and the rest", async () => {
    const t = newT();
    const { w, ids } = await twoCards(t);
    expect((await card(t, ids[0]))!.listingTitle).toContain(BO);
    await t.withIdentity(ADMIN).mutation(api.tidyNames.answerName, {
      cardId: ids[0],
      kind: "player",
      name: BO,
      answer: { kind: "notEntity" },
    });
    await drainScheduled(t);
    for (const id of ids) {
      const c = (await card(t, id))!;
      expect(c.pendingPlayerNames).toBeUndefined();
      expect(c.playerIds).toBeUndefined();
      expect(c.listingTitle).not.toContain("Jackson");
    }
    expect((await rowOf(t, w.base, "player", BO))!.answer).toEqual({ kind: "notEntity", by: "operator" });
  });

  test("clear (Change) puts the name back as pending, in the title again", async () => {
    const t = newT();
    const { ids } = await twoCards(t);
    const ask = (answer: { kind: "notEntity" } | { kind: "clear" }) =>
      t.withIdentity(ADMIN).mutation(api.tidyNames.answerName, {
        cardId: ids[0],
        kind: "player",
        name: BO,
        answer,
      });
    await ask({ kind: "notEntity" });
    await drainScheduled(t);
    await ask({ kind: "clear" });
    await drainScheduled(t);
    for (const id of ids) {
      const c = (await card(t, id))!;
      expect(c.pendingPlayerNames).toEqual([BO]);
      expect(c.listingTitle).toContain(BO);
    }
  });

  test("a name NB ruled out itself (the card's own team) is changed like any answer (NEO-645 S3a)", async () => {
    const t = newT();
    const { w, ids } = await twoCards(t);
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("tidyNames")
        .withIndex("by_scope_kind_name", (q) =>
          q.eq("scopeId", w.base).eq("kind", "player").eq("nameNormalized", KEY),
        )
        .first();
      await ctx.db.patch(row!._id, {
        answer: { kind: "notEntity", by: "auto", autoReason: "sameAsTeam" },
        answerGen: 1,
      });
    });
    await t.withIdentity(ADMIN).mutation(api.tidyNames.answerName, {
      cardId: ids[0],
      kind: "player",
      name: BO,
      answer: { kind: "clear" },
    });
    await drainScheduled(t);
    expect((await rowOf(t, w.base, "player", BO))!.answer).toBeUndefined();
    expect((await card(t, ids[0]))!.pendingPlayerNames).toEqual([BO]);
  });

  test("a hand-typed title is kept when the name leaves the card", async () => {
    const t = newT();
    const w = await world(t);
    const id = await t.run((ctx) =>
      printCard(ctx, w, {
        number: "1",
        printed: [{ kind: "player", name: BO }],
        extra: { listingTitle: "My own title for card one" },
      }),
    );
    await t.withIdentity(ADMIN).mutation(api.tidyNames.answerName, {
      cardId: id,
      kind: "player",
      name: BO,
      answer: { kind: "notEntity" },
    });
    expect((await card(t, id))!.listingTitle).toBe("My own title for card one");
  });
});

describe("answerName — a multi-player card keeps its printed order", () => {
  test("linking the SECOND printed player first, then the first, ends in printed order", async () => {
    const t = newT();
    const w = await world(t);
    const [judge, soto] = await t.run(async (ctx) => [await addPlayer(ctx, w, "Aaron Judge"), await addPlayer(ctx, w, "Juan Soto")]);
    const id = await t.run(async (ctx) => {
      await nameRow(ctx, { scopeId: w.base, sportId: w.sport, kind: "player", name: "Aaron Judge" });
      await nameRow(ctx, { scopeId: w.base, sportId: w.sport, kind: "player", name: "Juan Soto" });
      return printCard(ctx, w, {
        number: "1",
        printed: [
          { kind: "player", name: "Aaron Judge" },
          { kind: "player", name: "Juan Soto" },
        ],
      });
    });
    await answerPlayer(t, id, soto, "Juan Soto");
    expect((await card(t, id))!.playerIds).toEqual([soto]);
    expect((await card(t, id))!.pendingPlayerNames).toEqual(["Aaron Judge"]);
    await answerPlayer(t, id, judge, "Aaron Judge");
    const c = (await card(t, id))!;
    expect(c.playerIds).toEqual([judge, soto]);
    expect(c.playerLinks?.map((l) => l.nameOnCard)).toEqual(["Aaron Judge", "Juan Soto"]);
    expect(c.pendingPlayerNames).toBeUndefined();
  });

  test("a card with one name linked still carries the other as pending", async () => {
    const t = newT();
    const w = await world(t);
    const judge = await t.run((ctx) => addPlayer(ctx, w, "Aaron Judge"));
    const id = await t.run(async (ctx) => {
      await nameRow(ctx, { scopeId: w.base, sportId: w.sport, kind: "player", name: "Aaron Judge" });
      await nameRow(ctx, { scopeId: w.base, sportId: w.sport, kind: "player", name: "Juan Soto" });
      return printCard(ctx, w, {
        number: "1",
        printed: [
          { kind: "player", name: "Aaron Judge" },
          { kind: "player", name: "Juan Soto" },
        ],
      });
    });
    await answerPlayer(t, id, judge, "Aaron Judge");
    expect((await card(t, id))!.pendingPlayerNames).toEqual(["Juan Soto"]);
  });
});

describe("answerName — NEO-284 saveAsAlias and NEO-313 addSetSport", () => {
  test("saveAsAlias writes the PRINTED spelling onto the team and records it on the answer", async () => {
    const t = newT();
    const w = await world(t);
    const open = await t.run(async (ctx) => {
      await nameRow(ctx, { scopeId: w.base, sportId: w.sport, kind: "team", name: "Pads" });
      return printCard(ctx, w, { number: "1", printed: [{ kind: "team", name: "Pads" }] });
    });
    await t.withIdentity(ADMIN).mutation(api.tidyNames.answerName, {
      cardId: open,
      kind: "team",
      name: "Pads",
      answer: { kind: "linkTeam", teamId: w.padres, saveAsAlias: true },
    });
    const team = (await t.run((ctx) => ctx.db.get(w.padres)))!;
    expect(team.aliases).toContain("Pads");
    expect((await rowOf(t, w.base, "team", "Pads"))!.answer).toEqual({
      kind: "linkTeam",
      teamId: w.padres,
      by: "operator",
      saveAsAlias: true,
    });
    expect((await card(t, open))!.teamOnCardIds).toEqual([w.padres]);
    expect((await card(t, open))!.pendingTeamNames).toBeUndefined();
  });

  test("without saveAsAlias no alias is written", async () => {
    const t = newT();
    const w = await world(t);
    const open = await t.run(async (ctx) => {
      await nameRow(ctx, { scopeId: w.base, sportId: w.sport, kind: "team", name: "Pads" });
      return printCard(ctx, w, { number: "1", printed: [{ kind: "team", name: "Pads" }] });
    });
    await t.withIdentity(ADMIN).mutation(api.tidyNames.answerName, {
      cardId: open,
      kind: "team",
      name: "Pads",
      answer: { kind: "linkTeam", teamId: w.padres },
    });
    expect((await t.run((ctx) => ctx.db.get(w.padres)))!.aliases ?? []).toEqual([]);
  });

  test("Change never removes an alias already saved", async () => {
    const t = newT();
    const w = await world(t);
    const open = await t.run(async (ctx) => {
      await nameRow(ctx, { scopeId: w.base, sportId: w.sport, kind: "team", name: "Pads" });
      return printCard(ctx, w, { number: "1", printed: [{ kind: "team", name: "Pads" }] });
    });
    const ask = (answer: never) =>
      t.withIdentity(ADMIN).mutation(api.tidyNames.answerName, {
        cardId: open,
        kind: "team",
        name: "Pads",
        answer,
      });
    await ask({ kind: "linkTeam", teamId: w.padres, saveAsAlias: true } as never);
    await ask({ kind: "linkTeam", teamId: w.mets } as never);
    expect((await t.run((ctx) => ctx.db.get(w.padres)))!.aliases).toContain("Pads");
    expect((await card(t, open))!.teamOnCardIds).toEqual([w.mets]);
  });

  test("addSetSport adds the SET's sport to a player of another sport, and records it", async () => {
    const t = newT();
    const w = await world(t);
    const { hoops, guard } = await t.run(async (ctx) => {
      const hoops = await ctx.db.insert("selectorOptions", {
        level: "sport",
        value: "Basketball",
        platformData: {},
        children: [],
        lastUpdated: 1,
      });
      const guard = await ctx.db.insert("players", {
        name: "Deion Sanders",
        nameNormalized: normalizeEntityName("Deion Sanders"),
        sportId: hoops,
        lastUpdated: 1,
      });
      // The question is asked in basketball (the Sport chip), on a baseball set.
      await ctx.db.insert("tidyNames", {
        scopeId: w.base,
        kind: "player",
        nameNormalized: normalizeEntityName("Deion Sanders"),
        name: "Deion Sanders",
        sportId: hoops,
        status: "ready",
      });
      return { hoops, guard };
    });
    const open = await t.run((ctx) =>
      printCard(ctx, w, { number: "1", printed: [{ kind: "player", name: "Deion Sanders" }] }),
    );
    await answerPlayer(t, open, guard, "Deion Sanders", { addSetSport: true });
    const extra = await t.run((ctx) =>
      ctx.db
        .query("playerSports")
        .withIndex("by_player_id", (q) => q.eq("playerId", guard))
        .collect(),
    );
    expect(extra.map((r) => r.sportId)).toEqual([w.sport]);
    expect(hoops).not.toBe(w.sport);
    expect((await rowOf(t, w.base, "player", "Deion Sanders"))!.answer).toMatchObject({
      kind: "linkPlayer",
      addSetSport: true,
    });
  });
});

describe("answerName — the teamless-sport default (NEO-426) is re-stamped", () => {
  async function golf(t: T) {
    return t.run(async (ctx) => {
      const w = await seedTidyWorld(ctx, { sportValue: "Golf" });
      await ctx.db.patch(w.sport, { teamlessSport: { setAt: 1, setByUserId: "setter" } });
      const tiger = await addPlayer(ctx, w, "Tiger Woods");
      await nameRow(ctx, { scopeId: w.base, sportId: w.sport, kind: "player", name: "Tiger Woods" });
      const mk = (n: string) =>
        printCard(ctx, w, { number: n, printed: [{ kind: "player", name: "Tiger Woods" }] });
      return { w, tiger, open: await mk("1"), other: await mk("2") };
    });
  }

  test("born with a pending name it holds back; the answer stamps No team on the open card and the fan-out", async () => {
    const t = newT();
    const { tiger, open, other } = await golf(t);
    expect((await card(t, open))!.teamNoneConfirmedAt).toBeUndefined();
    await answerPlayer(t, open, tiger, "Tiger Woods");
    expect((await card(t, open))!.teamNoneConfirmedAt).toBeGreaterThan(0);
    await drainScheduled(t);
    expect((await card(t, other))!.teamNoneConfirmedAt).toBeGreaterThan(0);
  });

  test("a card that names a team is not stamped (rule 8: a data claim holds back a guess)", async () => {
    const t = newT();
    const { w, tiger, open } = await golf(t);
    await t.run((ctx) => ctx.db.patch(open, { bscTeamName: "Some Team" }));
    await answerPlayer(t, open, tiger, "Tiger Woods");
    expect((await card(t, open))!.teamNoneConfirmedAt).toBeUndefined();
    expect(w.sport).toBeTruthy();
  });

  test("a sport that is not flagged is never stamped", async () => {
    const t = newT();
    const w = await world(t);
    const open = await t.run((ctx) =>
      printCard(ctx, w, { number: "1", printed: [{ kind: "player", name: BO }] }),
    );
    await answerPlayer(t, open, w.bo);
    expect((await card(t, open))!.teamNoneConfirmedAt).toBeUndefined();
  });
});

describe("answerName — validation and the gate", () => {
  test("a team answer on a player name, and a player answer on a team name, are refused", async () => {
    const t = newT();
    const w = await world(t);
    const open = await t.run(async (ctx) => {
      await nameRow(ctx, { scopeId: w.base, sportId: w.sport, kind: "team", name: "Pads" });
      return printCard(ctx, w, {
        number: "1",
        printed: [
          { kind: "player", name: BO },
          { kind: "team", name: "Pads" },
        ],
      });
    });
    await expect(
      t.withIdentity(ADMIN).mutation(api.tidyNames.answerName, {
        cardId: open,
        kind: "player",
        name: BO,
        answer: { kind: "linkTeam", teamId: w.padres },
      }),
    ).rejects.toThrow(/team name/);
    await expect(
      t.withIdentity(ADMIN).mutation(api.tidyNames.answerName, {
        cardId: open,
        kind: "team",
        name: "Pads",
        answer: { kind: "linkPlayer", playerId: w.bo },
      }),
    ).rejects.toThrow(/player name/);
  });

  test("a player of another sport is refused, and nothing is written", async () => {
    const t = newT();
    const w = await world(t);
    const stranger = await t.run(async (ctx) => {
      const hoops = await ctx.db.insert("selectorOptions", {
        level: "sport",
        value: "Basketball",
        platformData: {},
        children: [],
        lastUpdated: 1,
      });
      return ctx.db.insert("players", {
        name: "Michael Jordan",
        nameNormalized: normalizeEntityName("Michael Jordan"),
        sportId: hoops,
        lastUpdated: 1,
      });
    });
    const open = await t.run((ctx) =>
      printCard(ctx, w, { number: "1", printed: [{ kind: "player", name: BO }] }),
    );
    await expect(answerPlayer(t, open, stranger)).rejects.toThrow(/isn't in this sport/);
    expect((await rowOf(t, w.base, "player", BO))!.answer).toBeUndefined();
    expect((await card(t, open))!.pendingPlayerNames).toEqual([BO]);
  });

  test("a link to what the row itself OFFERED in another sport is allowed and re-points the row's sport (D7)", async () => {
    const t = newT();
    const w = await world(t);
    const { hoops, mj } = await t.run(async (ctx) => {
      const hoops = await ctx.db.insert("selectorOptions", {
        level: "sport",
        value: "Basketball",
        platformData: {},
        children: [],
        lastUpdated: 1,
      });
      const mj = await ctx.db.insert("players", {
        name: "Michael Jordan",
        nameNormalized: normalizeEntityName("Michael Jordan"),
        sportId: hoops,
        lastUpdated: 1,
      });
      await nameRow(ctx, {
        scopeId: w.base,
        sportId: w.sport,
        kind: "player",
        name: "Mike Jordan",
        over: {
          enrichment: {
            preselect: { playerId: mj, name: "Michael Jordan", sportId: hoops, sportValue: "Basketball", reason: "onlyNamesake" },
          },
        },
      });
      return { hoops, mj };
    });
    const open = await t.run((ctx) =>
      printCard(ctx, w, { number: "1", printed: [{ kind: "player", name: "Mike Jordan" }] }),
    );
    await answerPlayer(t, open, mj, "Mike Jordan");
    expect((await rowOf(t, w.base, "player", "Mike Jordan"))!.sportId).toBe(hoops);
    expect((await card(t, open))!.playerIds).toEqual([mj]);
  });

  test("Change on an auto answer keeps the old pick as the preselect", async () => {
    const t = newT();
    const w = await world(t);
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("tidyNames")
        .withIndex("by_scope_kind_name", (q) =>
          q.eq("scopeId", w.base).eq("kind", "player").eq("nameNormalized", KEY),
        )
        .first();
      await ctx.db.patch(row!._id, {
        answer: { kind: "linkPlayer", playerId: w.bo, by: "auto", autoReason: "setHistory" },
        answerGen: 1,
      });
    });
    const open = await t.run((ctx) =>
      printCard(ctx, w, {
        number: "1",
        printed: [{ kind: "player", name: BO }],
        pendingPlayerNames: [],
        extra: { playerIds: [w.bo], playerLinks: [{ playerId: w.bo, nameOnCard: BO }] },
      }),
    );
    await t.withIdentity(ADMIN).mutation(api.tidyNames.answerName, {
      cardId: open,
      kind: "player",
      name: BO,
      answer: { kind: "clear" },
    });
    const row = (await rowOf(t, w.base, "player", BO))!;
    expect(row.answer).toBeUndefined();
    expect(row.enrichment?.preselect).toMatchObject({ playerId: w.bo, reason: "setHistory" });
    expect((await card(t, open))!.pendingPlayerNames).toEqual([BO]);
  });

  test("a signed-out caller and a non-admin are refused before anything is read", async () => {
    const t = newT();
    const w = await world(t);
    const open = await t.run((ctx) =>
      printCard(ctx, w, { number: "1", printed: [{ kind: "player", name: BO }] }),
    );
    const args = {
      cardId: open,
      kind: "player" as const,
      name: BO,
      answer: { kind: "linkPlayer" as const, playerId: w.bo },
    };
    await expect(t.mutation(api.tidyNames.answerName, args)).rejects.toThrow(/Not authenticated/);
    await expect(t.withIdentity(MEMBER).mutation(api.tidyNames.answerName, args)).rejects.toThrow(
      /Admin access required/,
    );
    expect((await rowOf(t, w.base, "player", BO))!.answer).toBeUndefined();
  });

  test("a name over the cap is refused naming the limit, never the value", async () => {
    const t = newT();
    const w = await world(t);
    const open = await t.run((ctx) =>
      printCard(ctx, w, { number: "1", printed: [{ kind: "player", name: BO }] }),
    );
    const long = "Z".repeat(121);
    const err = await answerPlayer(t, open, w.bo, long).catch((e: Error) => e);
    expect(String((err as Error).message)).toMatch(/limit is 120/);
    expect(String((err as Error).message)).not.toContain(long);
  });
});
