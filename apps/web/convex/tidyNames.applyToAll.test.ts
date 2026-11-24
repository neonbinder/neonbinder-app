/**
 * NEO-656 — `tidyNames.applyNameToAll`, "Apply to all cards printing X".
 *
 * The operator answers the open card (`answerName`), then offers the same
 * answer to the cards of its printing level (the leaf and the parallels copied
 * from it) that are STILL WAITING on the name. Nothing about the answer is
 * stored: the scan reads the cards when the button is clicked. Pinned here:
 *
 *   - a leaf plus 2 parallels are all reached; a card on another leaf is not;
 *   - only cards still waiting on the name are written (a card linked to
 *     anyone, or one that dropped the name, is left alone and counted);
 *   - compare-and-set: a card changed between the scan and the write is skipped;
 *   - each card keeps its own spelling; `playerIds` stays equal to `playerLinks`;
 *   - the open card must already carry the answer; kind and role are checked;
 *   - what one card costs (a counting ctx), which sizes `APPLY_TO_ALL_PAGE_SIZE`.
 */

import { convexTest } from "convex-test";
import { afterEach, describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import {
  APPLY_TO_ALL_PAGE_SIZE,
  APPLY_TO_ALL_SCAN_PAGE,
  applyNameToCardsImpl,
} from "./tidyNames";
import { cancelScheduled } from "../lib/testing/drain-scheduled";
import { normalizeEntityName } from "../lib/entities/normalize-name";
import {
  addPlayer,
  printCard,
  seedTidyWorld,
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

const BO = "Bo Jackson";
const KEY = normalizeEntityName(BO);

type World = TidyWorld & {
  bo: Id<"players">;
  other: Id<"players">;
  /** An insert-level row and its two parallel-level copies. */
  insertRow: Id<"selectorOptions">;
  par1: Id<"selectorOptions">;
  par2: Id<"selectorOptions">;
};

async function world(t: T): Promise<World> {
  return t.run(async (ctx) => {
    const w = await seedTidyWorld(ctx);
    const bo = await addPlayer(ctx, w, BO);
    const other = await addPlayer(ctx, w, "Vincent Jackson");
    const row = (level: "insert" | "parallel", value: string, parentId: Id<"selectorOptions">) =>
      ctx.db.insert("selectorOptions", {
        level,
        value,
        parentId,
        platformData: {},
        children: [],
        lastUpdated: 1,
      });
    const insertRow = await row("insert", "Rookie Debut", w.insert);
    const par1 = await row("parallel", "Gold", insertRow);
    const par2 = await row("parallel", "Blue", insertRow);
    return { ...w, bo, other, insertRow, par1, par2 } as World;
  });
}

const card = (t: T, id: Id<"cardChecklist">) => t.run((ctx) => ctx.db.get(id));
const answer = (t: T, w: World, cardId: Id<"cardChecklist">, playerId = w.bo, name = BO) =>
  t.withIdentity(ADMIN).mutation(api.tidyNames.answerName, {
    cardId,
    kind: "player",
    name,
    sportId: w.sport,
    answer: { kind: "linkPlayer", playerId },
  });
const applyAll = (
  t: T,
  cardId: Id<"cardChecklist">,
  input: unknown,
  name = BO,
  kind: "player" | "team" = "player",
) =>
  t.withIdentity(ADMIN).action(api.tidyNames.applyNameToAll, {
    cardId,
    kind,
    name,
    answer: input as never,
  });
const printing = (n: string, name = BO) => ({ number: n, printed: [{ kind: "player" as const, name }] });

describe("applyNameToAll — the printing level", () => {
  test("a leaf plus 2 parallels: every card still waiting on the name is linked", async () => {
    const t = newT();
    const w = await world(t);
    const ids = await t.run(async (ctx) => ({
      open: await printCard(ctx, w, { ...printing("1"), leaf: w.insertRow }),
      sameLeaf: await printCard(ctx, w, { ...printing("2"), leaf: w.insertRow }),
      gold: await printCard(ctx, w, { ...printing("1"), leaf: w.par1 }),
      blue: await printCard(ctx, w, { ...printing("1"), leaf: w.par2 }),
    }));
    await answer(t, w, ids.open);

    const out = await applyAll(t, ids.open, { kind: "linkPlayer", playerId: w.bo });

    expect(out).toEqual({ linked: 3, skipped: 0 });
    for (const id of [ids.sameLeaf, ids.gold, ids.blue]) {
      const c = (await card(t, id))!;
      expect(c.playerIds).toEqual([w.bo]);
      expect(c.playerLinks).toEqual([{ playerId: w.bo, nameOnCard: BO }]);
      expect(c.pendingPlayerNames).toBeUndefined();
    }
  });

  test("opened from a parallel copy it reaches the insert and its other parallel too", async () => {
    const t = newT();
    const w = await world(t);
    const ids = await t.run(async (ctx) => ({
      gold: await printCard(ctx, w, { ...printing("1"), leaf: w.par1 }),
      source: await printCard(ctx, w, { ...printing("1"), leaf: w.insertRow }),
      blue: await printCard(ctx, w, { ...printing("1"), leaf: w.par2 }),
    }));
    await answer(t, w, ids.gold);
    const out = await applyAll(t, ids.gold, { kind: "linkPlayer", playerId: w.bo });
    expect(out.linked).toBe(2);
    expect((await card(t, ids.source))!.playerIds).toEqual([w.bo]);
    expect((await card(t, ids.blue))!.playerIds).toEqual([w.bo]);
  });

  test("a card on another printing (a different leaf) that prints the same name is not touched", async () => {
    const t = newT();
    const w = await world(t);
    const [open, elsewhere] = await t.run(async (ctx) => [
      await printCard(ctx, w, printing("1")),
      await printCard(ctx, w, { ...printing("1"), leaf: w.insertRow }),
    ]);
    await answer(t, w, open);
    const out = await applyAll(t, open, { kind: "linkPlayer", playerId: w.bo });
    expect(out).toEqual({ linked: 0, skipped: 0 });
    expect((await card(t, elsewhere))!.playerIds).toBeUndefined();
    expect((await card(t, elsewhere))!.pendingPlayerNames).toEqual([BO]);
  });

  test("a leaf longer than one scan page is read to the end", async () => {
    const t = newT();
    const w = await world(t);
    const count = APPLY_TO_ALL_SCAN_PAGE + 5;
    const ids = await t.run(async (ctx) => {
      const out: Array<Id<"cardChecklist">> = [];
      for (let i = 1; i <= count; i++) out.push(await printCard(ctx, w, printing(String(i))));
      return out;
    });
    await answer(t, w, ids[0]);
    const out = await applyAll(t, ids[0], { kind: "linkPlayer", playerId: w.bo });
    expect(out).toEqual({ linked: count - 1, skipped: 0 });
    expect((await card(t, ids[count - 1]))!.playerIds).toEqual([w.bo]);
  });
});

describe("applyNameToAll — only cards still waiting on the name", () => {
  test("a card already linked (to this player or another) and a card that dropped the name are left alone", async () => {
    const t = newT();
    const w = await world(t);
    const ids = await t.run(async (ctx) => ({
      open: await printCard(ctx, w, printing("1")),
      waiting: await printCard(ctx, w, printing("2")),
      onOther: await printCard(ctx, w, {
        number: "3",
        printed: [{ kind: "player", name: BO }],
        pendingPlayerNames: [],
        extra: {
          playerIds: [w.other],
          playerLinks: [{ playerId: w.other, nameOnCard: BO }],
        },
      }),
      onSame: await printCard(ctx, w, {
        number: "4",
        printed: [{ kind: "player", name: BO }],
        pendingPlayerNames: [],
        extra: { playerIds: [w.bo], playerLinks: [{ playerId: w.bo, nameOnCard: BO }] },
      }),
      blank: await printCard(ctx, w, { number: "5" }),
    }));
    await answer(t, w, ids.open);
    const before = {
      onOther: (await card(t, ids.onOther))!,
      onSame: (await card(t, ids.onSame))!,
      blank: (await card(t, ids.blank))!,
    };

    const out = await applyAll(t, ids.open, { kind: "linkPlayer", playerId: w.bo });

    expect(out).toEqual({ linked: 1, skipped: 0 });
    expect((await card(t, ids.waiting))!.playerIds).toEqual([w.bo]);
    expect(await card(t, ids.onOther)).toEqual(before.onOther);
    expect(await card(t, ids.onSame)).toEqual(before.onSame);
    expect(await card(t, ids.blank)).toEqual(before.blank);
  });

  test("after a Change, Apply to all reaches only cards still waiting, never the ones linked to the old answer (Jason, J3)", async () => {
    const t = newT();
    const w = await world(t);
    const [open, followed, waiting] = await t.run(async (ctx) => [
      await printCard(ctx, w, printing("1")),
      await printCard(ctx, w, printing("2")),
      await printCard(ctx, w, printing("3")),
    ]);
    await answer(t, w, open);
    // Card 2 is linked to Bo by an earlier Apply to all, then card 3 is added back to waiting.
    await t.run((ctx) =>
      ctx.db.patch(followed, {
        playerIds: [w.bo],
        playerLinks: [{ playerId: w.bo, nameOnCard: BO }],
        pendingPlayerNames: undefined,
      }),
    );
    await answer(t, w, open, w.other); // Change
    const out = await applyAll(t, open, { kind: "linkPlayer", playerId: w.other });
    expect(out.linked).toBe(1);
    expect((await card(t, waiting))!.playerIds).toEqual([w.other]);
    expect((await card(t, followed))!.playerIds).toEqual([w.bo]);
  });

  test("a second click writes nothing", async () => {
    const t = newT();
    const w = await world(t);
    const [open, other] = await t.run(async (ctx) => [
      await printCard(ctx, w, printing("1")),
      await printCard(ctx, w, printing("2")),
    ]);
    await answer(t, w, open);
    await applyAll(t, open, { kind: "linkPlayer", playerId: w.bo });
    const once = (await card(t, other))!;
    const again = await applyAll(t, open, { kind: "linkPlayer", playerId: w.bo });
    expect(again).toEqual({ linked: 0, skipped: 0 });
    expect(await card(t, other)).toEqual(once);
  });

  test("each card keeps its own spelling of the name", async () => {
    const t = newT();
    const w = await world(t);
    const acuna = await t.run((ctx) => addPlayer(ctx, w, "Ronald Acuna Jr."));
    const [open, plain] = await t.run(async (ctx) => [
      await printCard(ctx, w, printing("1", "Ronald Acuña Jr.")),
      await printCard(ctx, w, printing("2", "Ronald Acuna Jr.")),
    ]);
    await answer(t, w, open, acuna, "Ronald Acuña Jr.");
    await applyAll(t, open, { kind: "linkPlayer", playerId: acuna }, "Ronald Acuña Jr.");
    expect((await card(t, plain))!.playerLinks).toEqual([
      { playerId: acuna, nameOnCard: "Ronald Acuna Jr." },
    ]);
  });

  test("a card with a MIDDLE pending name keeps playerIds equal to playerLinks", async () => {
    const t = newT();
    const w = await world(t);
    const [judge, mookie] = await t.run(async (ctx) => [
      await addPlayer(ctx, w, "Aaron Judge"),
      await addPlayer(ctx, w, "Mookie Betts"),
    ]);
    const [open, multi] = await t.run(async (ctx) => [
      await printCard(ctx, w, printing("1")),
      await printCard(ctx, w, {
        number: "2",
        printed: [
          { kind: "player", name: "Aaron Judge" },
          { kind: "player", name: BO },
          { kind: "player", name: "Mookie Betts" },
        ],
      }),
    ]);
    await answer(t, w, open);
    await applyAll(t, open, { kind: "linkPlayer", playerId: w.bo });
    let row = (await card(t, multi))!;
    expect(row.pendingPlayerNames).toEqual(["Aaron Judge", "Mookie Betts"]);
    expect(row.playerIds).toEqual([w.bo]);
    expect(row.playerLinks).toEqual([{ playerId: w.bo, nameOnCard: BO }]);

    await answer(t, w, multi, judge, "Aaron Judge");
    await answer(t, w, multi, mookie, "Mookie Betts");
    row = (await card(t, multi))!;
    expect(row.playerIds).toEqual(row.playerLinks!.map((l) => l.playerId));
    expect(row.pendingPlayerNames).toBeUndefined();
  });
});

describe("applyNameToAll — compare-and-set", () => {
  test("a card changed between the scan and the write is skipped, counted and left as it is", async () => {
    const t = newT();
    const w = await world(t);
    const [a, b, c] = await t.run(async (ctx) => [
      await printCard(ctx, w, printing("1")),
      await printCard(ctx, w, printing("2")),
      await printCard(ctx, w, printing("3")),
    ]);
    // The scan saw all three waiting; before the page runs, card b is linked by hand.
    await t.run((ctx) =>
      ctx.db.patch(b, {
        playerIds: [w.other],
        playerLinks: [{ playerId: w.other, nameOnCard: BO }],
        pendingPlayerNames: undefined,
      }),
    );
    const before = (await card(t, b))!;
    const out = await t.mutation(internal.tidyNames.applyNameToCards, {
      cardIds: [a, b, c],
      kind: "player",
      key: KEY,
      answer: { kind: "linkPlayer", playerId: w.bo },
      userId: "op",
    });
    expect(out).toEqual({ linked: 2, skipped: 1 });
    expect(await card(t, b)).toEqual(before);
    expect((await card(t, a))!.playerIds).toEqual([w.bo]);
    expect((await card(t, c))!.playerIds).toEqual([w.bo]);
  });

  test("a card deleted since the scan is skipped", async () => {
    const t = newT();
    const w = await world(t);
    const [a, gone] = await t.run(async (ctx) => [
      await printCard(ctx, w, printing("1")),
      await printCard(ctx, w, printing("2")),
    ]);
    await t.run((ctx) => ctx.db.delete(gone));
    const out = await t.mutation(internal.tidyNames.applyNameToCards, {
      cardIds: [a, gone],
      kind: "player",
      key: KEY,
      answer: { kind: "linkPlayer", playerId: w.bo },
      userId: "op",
    });
    expect(out).toEqual({ linked: 1, skipped: 1 });
  });

  test("a skipped card keeps its lastUpdated stamp", async () => {
    const t = newT();
    const w = await world(t);
    const [open, linked] = await t.run(async (ctx) => [
      await printCard(ctx, w, printing("1")),
      await printCard(ctx, w, {
        number: "2",
        printed: [{ kind: "player", name: BO }],
        pendingPlayerNames: [],
        extra: { playerIds: [w.other], playerLinks: [{ playerId: w.other, nameOnCard: BO }] },
      }),
    ]);
    await answer(t, w, open);
    await applyAll(t, open, { kind: "linkPlayer", playerId: w.bo });
    expect((await card(t, linked))!.lastUpdated).toBe(1_700_000_000_000);
  });
});

describe("applyNameToAll — Not a player and teams", () => {
  test("Not a player takes the name off every waiting card and out of its generated title", async () => {
    const t = newT();
    const w = await world(t);
    const [open, other] = await t.run(async (ctx) => [
      await printCard(ctx, w, printing("1")),
      await printCard(ctx, w, printing("2")),
    ]);
    await t.withIdentity(ADMIN).mutation(api.tidyNames.answerName, {
      cardId: open,
      kind: "player",
      name: BO,
      sportId: w.sport,
      answer: { kind: "notEntity" },
    });
    const out = await applyAll(t, open, { kind: "notEntity" });
    expect(out.linked).toBe(1);
    const c = (await card(t, other))!;
    expect(c.pendingPlayerNames).toBeUndefined();
    expect(c.playerIds).toBeUndefined();
  });

  test("a team answer links the team on every card still waiting on the name", async () => {
    const t = newT();
    const w = await world(t);
    const [open, other] = await t.run(async (ctx) => [
      await printCard(ctx, w, { number: "1", printed: [{ kind: "team", name: "Pads" }] }),
      await printCard(ctx, w, { number: "2", printed: [{ kind: "team", name: "Pads" }] }),
    ]);
    await t.withIdentity(ADMIN).mutation(api.tidyNames.answerName, {
      cardId: open,
      kind: "team",
      name: "Pads",
      sportId: w.sport,
      answer: { kind: "linkTeam", teamId: w.padres },
    });
    const out = await applyAll(t, open, { kind: "linkTeam", teamId: w.padres }, "Pads", "team");
    expect(out).toEqual({ linked: 1, skipped: 0 });
    const c = (await card(t, other))!;
    expect(c.teamOnCardIds).toEqual([w.padres]);
    expect(c.pendingTeamNames).toBeUndefined();
  });
});

describe("applyNameToAll — what it refuses", () => {
  test("the open card must already carry the answer: an unanswered card refuses and nothing moves", async () => {
    const t = newT();
    const w = await world(t);
    const [open, other] = await t.run(async (ctx) => [
      await printCard(ctx, w, printing("1")),
      await printCard(ctx, w, printing("2")),
    ]);
    await expect(applyAll(t, open, { kind: "linkPlayer", playerId: w.bo })).rejects.toThrow(
      /Answer this card first/,
    );
    expect((await card(t, other))!.pendingPlayerNames).toEqual([BO]);
  });

  test("a different player than the open card holds is refused: the client cannot vouch for an id", async () => {
    const t = newT();
    const w = await world(t);
    const [open, other] = await t.run(async (ctx) => [
      await printCard(ctx, w, printing("1")),
      await printCard(ctx, w, printing("2")),
    ]);
    await answer(t, w, open);
    await expect(applyAll(t, open, { kind: "linkPlayer", playerId: w.other })).rejects.toThrow(
      /Answer this card first/,
    );
    expect((await card(t, other))!.playerIds).toBeUndefined();
  });

  test("Not a player is refused while the open card still holds the name", async () => {
    const t = newT();
    const w = await world(t);
    const open = await t.run((ctx) => printCard(ctx, w, printing("1")));
    await expect(applyAll(t, open, { kind: "notEntity" })).rejects.toThrow(/Answer this card first/);
  });

  test("a player answer on a team name, and a team answer on a player name, are refused", async () => {
    const t = newT();
    const w = await world(t);
    const open = await t.run((ctx) => printCard(ctx, w, printing("1")));
    await expect(
      applyAll(t, open, { kind: "linkPlayer", playerId: w.bo }, "Pads", "team"),
    ).rejects.toThrow(/player name/);
    await expect(
      applyAll(t, open, { kind: "linkTeam", teamId: w.padres }, BO, "player"),
    ).rejects.toThrow(/team name/);
  });

  test("a signed-out caller and a non-admin are refused", async () => {
    const t = newT();
    const w = await world(t);
    const open = await t.run((ctx) => printCard(ctx, w, printing("1")));
    await answer(t, w, open);
    const args = {
      cardId: open,
      kind: "player" as const,
      name: BO,
      answer: { kind: "linkPlayer" as const, playerId: w.bo },
    };
    await expect(t.action(api.tidyNames.applyNameToAll, args)).rejects.toThrow(/Not authenticated/);
    await expect(
      t.withIdentity(MEMBER).action(api.tidyNames.applyNameToAll, args),
    ).rejects.toThrow(/Admin access required/);
  });
});

/**
 * `ctx.db` with every database call counted: `calls` is one per get / insert /
 * patch / delete / query terminal, `reads` adds the documents a terminal returned.
 */
function counting(ctx: { db: unknown }) {
  const tally = { calls: 0, reads: 0, writes: 0 };
  const TERMINAL = new Set(["first", "unique", "take", "collect", "paginate"]);
  const wrap = (target: object): object =>
    new Proxy(target, {
      get(obj, prop) {
        const value = Reflect.get(obj, prop);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          const name = String(prop);
          const out = value.apply(obj, args);
          if (name === "get") {
            tally.calls += 1;
            tally.reads += 1;
            return out;
          }
          if (name === "insert" || name === "patch" || name === "replace" || name === "delete") {
            tally.calls += 1;
            tally.writes += 1;
            return out;
          }
          if (TERMINAL.has(name)) {
            tally.calls += 1;
            return Promise.resolve(out).then((rows) => {
              if (Array.isArray(rows)) tally.reads += rows.length;
              else if (rows && typeof rows === "object" && "page" in rows) {
                tally.reads += (rows as { page: unknown[] }).page.length;
              } else if (rows) tally.reads += 1;
              return rows;
            });
          }
          if (out && typeof out === "object" && !("then" in (out as object))) return wrap(out as object);
          return out;
        };
      },
    });
  return { db: wrap(ctx.db as object), tally };
}

describe("applyNameToAll — what one card costs (sizes APPLY_TO_ALL_PAGE_SIZE)", () => {
  test("a full page stays inside the transaction budget; the per-card numbers are in the doc comment", async () => {
    const t = newT();
    const w = await world(t);
    const ids = await t.run(async (ctx) => {
      const out: Array<Id<"cardChecklist">> = [];
      for (let i = 1; i <= APPLY_TO_ALL_PAGE_SIZE; i++) {
        out.push(await printCard(ctx, w, printing(String(i))));
      }
      return out;
    });
    const measured = await t.run(async (ctx) => {
      const probe = counting(ctx);
      const result = await applyNameToCardsImpl({ ...ctx, db: probe.db } as never, {
        cardIds: ids,
        kind: "player",
        key: KEY,
        answer: { kind: "linkPlayer", playerId: w.bo },
        userId: "op",
      });
      return { result, tally: probe.tally };
    });
    expect(measured.result).toEqual({ linked: APPLY_TO_ALL_PAGE_SIZE, skipped: 0 });
    // The numbers in the doc comment on APPLY_TO_ALL_PAGE_SIZE (tidyNames.ts): a
    // change that moves them past the band must update both.
    const per = measured.tally.calls / APPLY_TO_ALL_PAGE_SIZE;
    expect(per).toBeGreaterThan(3);
    expect(per).toBeLessThan(8);
    expect(measured.tally.writes).toBeLessThanOrEqual(3 * APPLY_TO_ALL_PAGE_SIZE);
    // calls + documents read + documents written, each once: far under ~900.
    expect(measured.tally.calls + measured.tally.reads + measured.tally.writes).toBeLessThan(900);
  });

  test("the cards it wrote hold exactly one link each", async () => {
    const t = newT();
    const w = await world(t);
    const id = await t.run((ctx) => printCard(ctx, w, printing("1")));
    await t.mutation(internal.tidyNames.applyNameToCards, {
      cardIds: [id],
      kind: "player",
      key: KEY,
      answer: { kind: "linkPlayer", playerId: w.bo },
      userId: "op",
    });
    const c = (await card(t, id)) as Doc<"cardChecklist">;
    expect(c.playerLinks).toHaveLength(1);
    expect(c.playerIds).toEqual(c.playerLinks!.map((l) => l.playerId));
  });
});
