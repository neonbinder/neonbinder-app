/**
 * NEO-645 (Q1 = A, S4) / NEO-656 — a card whose player name was still pending at
 * the commit gets the commit's team fill when the name is ANSWERED, with the
 * same verdict (`careerTeamVerdict`, every player answering) and the same rule
 * 8. The open card is filled in the answer's own transaction; the other cards
 * are filled only when the operator presses Apply to all
 * (`tidyNames.applyNameToAll`). No fill note is stored.
 */

import { convexTest } from "convex-test";
import { afterEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { syncCardPlayerLinks } from "./cardPlayerLinks";
import { cancelScheduled } from "../lib/testing/drain-scheduled";
import {
  addPlayer,
  addTeam,
  printCard,
  seedTidyWorld,
  type TidyWorld,
} from "../lib/testing/tidy-world";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const ADMIN = { subject: "user_tidy_fill_answer_admin", role: "admin" };
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

const NAME = "Shohei Ohtani";

async function world(
  t: T,
  stints: (w: TidyWorld, dodgers: Id<"teams">, angels: Id<"teams">) => Array<{ teamId: Id<"teams">; fromYear?: number; toYear?: number }>,
) {
  return t.run(async (ctx) => {
    const w = await seedTidyWorld(ctx, { year: "2024" });
    const dodgers = await addTeam(ctx, w, "Los Angeles", "Dodgers");
    const angels = await addTeam(ctx, w, "Los Angeles", "Angels");
    const player = await addPlayer(ctx, w, NAME, stints(w, dodgers, angels));
    return { w, dodgers, angels, player };
  });
}
const answer = async (t: T, cardId: Id<"cardChecklist">, playerId: Id<"players">) =>
  t.withIdentity(ADMIN).mutation(api.tidyNames.answerName, {
    cardId,
    kind: "player",
    name: NAME,
    sportId: (await t.run((ctx) => ctx.db.get(cardId)))!.sportId!,
    answer: { kind: "linkPlayer", playerId },
  });
const applyAll = (t: T, cardId: Id<"cardChecklist">, playerId: Id<"players">) =>
  t.withIdentity(ADMIN).action(api.tidyNames.applyNameToAll, {
    cardId,
    kind: "player",
    name: NAME,
    answer: { kind: "linkPlayer", playerId },
  });
const get = (t: T, id: Id<"cardChecklist">) => t.run((ctx) => ctx.db.get(id));

describe("linking a pending player name fills the team the career gives", () => {
  test("one team in the window: the open card gets it; the other card only after Apply to all", async () => {
    const t = newT();
    const { w, dodgers, player } = await world(t, (_w, d) => [{ teamId: d, fromYear: 2024 }]);
    const [open, other] = await t.run(async (ctx) => [
      await printCard(ctx, w, { number: "1", printed: [{ kind: "player", name: NAME }] }),
      await printCard(ctx, w, { number: "2", printed: [{ kind: "player", name: NAME }] }),
    ]);

    await answer(t, open, player);
    const first = await get(t, open);
    expect(first?.playerIds).toEqual([player]);
    expect(first?.teamOnCardIds).toEqual([dodgers]);
    expect((await get(t, other))?.teamOnCardIds).toBeUndefined();

    await applyAll(t, open, player);
    const second = await get(t, other);
    expect(second?.playerIds).toEqual([player]);
    expect(second?.teamOnCardIds).toEqual([dodgers]);
  });

  test("a tie in the window (Angels through 2023, Dodgers from 2024) fills nothing", async () => {
    const t = newT();
    const { w, player } = await world(t, (_w, d, a) => [
      { teamId: a, fromYear: 2018, toYear: 2023 },
      { teamId: d, fromYear: 2024 },
    ]);
    const open = await t.run((ctx) =>
      printCard(ctx, w, { number: "1", printed: [{ kind: "player", name: NAME }] }),
    );
    await answer(t, open, player);
    const card = await get(t, open);
    expect(card?.playerIds).toEqual([player]);
    expect(card?.teamOnCardIds).toBeUndefined();
  });

  test("rule 8: a team the listing named, a pending team name, a No-team stamp or a disputed teams field holds the fill back", async () => {
    const t = newT();
    const { w, player } = await world(t, (_w, d) => [{ teamId: d, fromYear: 2020 }]);
    const [listing, pendingTeam, stamped, disputed] = await t.run(async (ctx) => {
      const mk = (number: string, extra: Record<string, unknown>) =>
        printCard(ctx, w, { number, printed: [{ kind: "player", name: NAME }], extra });
      return [
        await mk("1", { bscTeamName: "Mystery Club" }),
        await mk("2", { pendingTeamNames: ["Mystery Club"] }),
        await mk("3", { teamNoneConfirmedAt: 1, teamNoneConfirmedByUserId: "u" }),
        await mk("4", {
          sourceDisagreements: [
            { field: "teams", values: [{ value: ["A"], sources: ["bsc"] }, { value: ["B"], sources: ["checklist"] }] },
          ],
        }),
      ];
    });
    for (const id of [listing, pendingTeam, stamped, disputed]) {
      await answer(t, id, player);
      const card = await get(t, id);
      expect(card?.playerIds).toEqual([player]);
      expect(card?.teamOnCardIds).toBeUndefined();
    }
  });

  test("a lookup that never answered is not a claim: a card whose team check gave up is filled", async () => {
    const t = newT();
    const { w, dodgers, player } = await world(t, (_w, d) => [{ teamId: d, fromYear: 2024 }]);
    const id = await t.run((ctx) =>
      printCard(ctx, w, {
        number: "1",
        printed: [{ kind: "player", name: NAME }],
        extra: { teamCheckDoneAt: 1, teamCheckOutcome: "gaveUp" },
      }),
    );
    await answer(t, id, player);
    const card = await get(t, id);
    expect(card?.teamOnCardIds).toEqual([dodgers]);
  });

  test("rule 8: a card the publisher checklist answered (teamCheckOutcome checklist) is held back", async () => {
    const t = newT();
    const { w, player } = await world(t, (_w, d) => [{ teamId: d, fromYear: 2024 }]);
    const id = await t.run((ctx) =>
      printCard(ctx, w, {
        number: "1",
        printed: [{ kind: "player", name: NAME }],
        extra: { teamCheckDoneAt: 1, teamCheckOutcome: "checklist" },
      }),
    );
    await answer(t, id, player);
    const card = await get(t, id);
    expect(card?.playerIds).toEqual([player]);
    expect(card?.teamOnCardIds).toBeUndefined();
  });

  test("NEO-639 (decision A): under the set's own No Team the career fills nothing, on the open card or the one Apply to all reaches", async () => {
    const t = newT();
    const { w, dodgers, player } = await world(t, (_w, d) => [{ teamId: d, fromYear: 2024 }]);
    await t.run((ctx) => ctx.db.patch(w.base, { noTeamDefault: { setAt: 1, setByUserId: "op" } }));
    const [open, other] = await t.run(async (ctx) => [
      await printCard(ctx, w, { number: "1", printed: [{ kind: "player", name: NAME }] }),
      await printCard(ctx, w, { number: "2", printed: [{ kind: "player", name: NAME }] }),
    ]);
    await answer(t, open, player);
    await applyAll(t, open, player);
    for (const id of [open, other]) {
      const card = await get(t, id);
      expect(card?.playerIds).toEqual([player]);
      expect(card?.teamOnCardIds).toBeUndefined();
    }
    // Control: the same answer under a set with no team default fills.
    await t.run((ctx) => ctx.db.patch(w.base, { noTeamDefault: undefined }));
    const control = await t.run((ctx) =>
      printCard(ctx, w, { number: "3", printed: [{ kind: "player", name: NAME }] }),
    );
    await answer(t, control, player);
    expect((await get(t, control))?.teamOnCardIds).toEqual([dodgers]);
  });

  test("a card that already has a team keeps it", async () => {
    const t = newT();
    const { w, angels, player } = await world(t, (_w, d) => [{ teamId: d, fromYear: 2020 }]);
    const id = await t.run((ctx) =>
      printCard(ctx, w, {
        number: "1",
        printed: [{ kind: "player", name: NAME }],
        extra: { teamOnCardIds: [angels] },
      }),
    );
    await answer(t, id, player);
    expect((await get(t, id))?.teamOnCardIds).toEqual([angels]);
  });
});

/**
 * NEO-645 (A12, main's Tidy Up wizard): the answer-time fill reads the wizard's
 * tiers, not the career alone: the checklist's other cards of the same player
 * set (batch), then per player his stored cards, then his career window.
 */
describe("the tiers, first answer wins (batch, stored, career)", () => {
  const OTHER = "Mike Trout";

  /** A teamed card, with its player links, like one a sync wrote. */
  async function teamedCard(
    t: T,
    w: TidyWorld,
    number: string,
    playerIds: Array<Id<"players">>,
    teamIds: Array<Id<"teams">>,
    leaf?: Id<"selectorOptions">,
  ) {
    return t.run(async (ctx) => {
      const id = await printCard(ctx, w, {
        leaf,
        number,
        extra: {
          playerIds,
          playerLinks: playerIds.map((playerId) => ({ playerId, nameOnCard: "x" })),
          teamOnCardIds: teamIds,
        },
      });
      await syncCardPlayerLinks(ctx as never, id, playerIds, w.sport, { fresh: true });
      return id;
    });
  }
  const pending = (t: T, w: TidyWorld, number: string, leaf?: Id<"selectorOptions">) =>
    t.run((ctx) => printCard(ctx, w, { leaf, number, printed: [{ kind: "player", name: NAME }] }));

  test("batch: another card of the same player in this checklist wins over the career", async () => {
    const t = newT();
    const { w, angels, player } = await world(t, (_w, d) => [{ teamId: d, fromYear: 2024 }]);
    await teamedCard(t, w, "10", [player], [angels]);
    const open = await pending(t, w, "1");
    await answer(t, open, player);
    const card = await get(t, open);
    expect(card?.teamOnCardIds).toEqual([angels]);
  });

  test("batch: the checklist disagreeing with itself STOPS the search, the career does not speak", async () => {
    const t = newT();
    const { w, dodgers, angels, player } = await world(t, (_w, d) => [{ teamId: d, fromYear: 2024 }]);
    await teamedCard(t, w, "10", [player], [angels]);
    await teamedCard(t, w, "11", [player], [dodgers]);
    const open = await pending(t, w, "1");
    await answer(t, open, player);
    const card = await get(t, open);
    expect(card?.playerIds).toEqual([player]);
    expect(card?.teamOnCardIds).toBeUndefined();
  });

  test("a card of another checklist is not batch evidence", async () => {
    const t = newT();
    const { w, dodgers, angels, player } = await world(t, (_w, d) => [{ teamId: d, fromYear: 2024 }]);
    await teamedCard(t, w, "10", [player], [angels], w.insert);
    const open = await pending(t, w, "1");
    await answer(t, open, player);
    expect((await get(t, open))?.teamOnCardIds).toEqual([dodgers]);
  });

  test("stored: his card under the set's base checklist answers for a card in an insert", async () => {
    const t = newT();
    const { w, angels, player } = await world(t, (_w, d) => [{ teamId: d, fromYear: 2024 }]);
    await t.run((ctx) => ctx.db.patch(w.set, { children: [w.base, w.insert, w.parallel] }));
    await teamedCard(t, w, "10", [player], [angels], w.base);
    const open = await pending(t, w, "1", w.insert);
    await answer(t, open, player);
    expect((await get(t, open))?.teamOnCardIds).toEqual([angels]);
  });

  test("stored: two disagreeing base cards STOP the search for the player; his career does not outvote them", async () => {
    const t = newT();
    const { w, dodgers, angels, player } = await world(t, (_w, d) => [{ teamId: d, fromYear: 2024 }]);
    await t.run((ctx) => ctx.db.patch(w.set, { children: [w.base, w.insert, w.parallel] }));
    await teamedCard(t, w, "10", [player], [angels], w.base);
    await teamedCard(t, w, "11", [player], [dodgers], w.base);
    const open = await pending(t, w, "1", w.insert);
    await answer(t, open, player);
    expect((await get(t, open))?.teamOnCardIds).toBeUndefined();
  });

  test("multi-player: every player must answer; the union of his stored teams and the other's career is the fill", async () => {
    const t = newT();
    const { w, dodgers, angels, player } = await world(t, (_w, d) => [{ teamId: d, fromYear: 2024 }]);
    const trout = await t.run((ctx) => addPlayer(ctx, w, OTHER, [{ teamId: angels, fromYear: 2024 }]));
    await t.run((ctx) => ctx.db.patch(w.set, { children: [w.base, w.insert, w.parallel] }));
    const open = await t.run((ctx) =>
      printCard(ctx, w, {
        leaf: w.insert,
        number: "1",
        printed: [{ kind: "player", name: NAME }],
        extra: { playerIds: [trout], playerLinks: [{ playerId: trout, nameOnCard: OTHER }] },
      }),
    );
    await t.run((ctx) => ctx.db.patch(open, { pendingPlayerNames: [NAME] }));
    await answer(t, open, player);
    const card = await get(t, open);
    expect(new Set(card?.teamOnCardIds)).toEqual(new Set([dodgers, angels]));

  });
});
