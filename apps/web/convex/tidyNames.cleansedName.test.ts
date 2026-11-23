/**
 * NEO-645 (D2), carrying NEO-643's walk claim: a printed name with junk in it
 * (BSC's backslash for an accent, a soft hyphen, a zero-width space) or with an
 * accent its twin lacks is the SAME name. Answered once, on either card, the
 * answer reaches the twin through the `tidyNames` fan-out, and the twin keeps
 * its own spelling as the name on the card.
 *
 * The E2E spec `checklist-junk-and-accent-names-pair-as-the-same-player` proves
 * the Match Cards half (the pair at 100%, the checklist-only row read under its
 * clean name) and leaves by Cancel, because a walk would commit its shared
 * read-only set. This file is the walk half: one name row, one answer, every
 * card that prints any spelling of it.
 *
 * The commit keys a card's printed names with `normalizeEntityName`
 * (`printedRowsOf` in `selectorOptions.ts`); `printCard` does the same.
 */

import { convexTest } from "convex-test";
import { afterEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { cancelScheduled, drainScheduled } from "../lib/testing/drain-scheduled";
import { normalizeEntityName } from "../lib/entities/normalize-name";
import { addPlayer, nameRow, printCard, seedTidyWorld } from "../lib/testing/tidy-world";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const ADMIN = { subject: "user_tidy_cleansed_admin", role: "admin" };
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

/** [the spelling answered, its twin, the player's name in NB] */
const PAIRS: Array<{ why: string; answered: string; twin: string; player: string }> = [
  { why: "BSC's backslash for an accent", answered: "Mark DeR\\osa", twin: "Mark DeRosa", player: "Mark DeRosa" },
  { why: "an accent the twin lacks", answered: "Harold Reynólds", twin: "Harold Reynolds", player: "Harold Reynolds" },
  { why: "a soft hyphen and a zero-width space", answered: "Sho­hei Oh​tani", twin: "Shohei Ohtani", player: "Shohei Ohtani" },
  // The other way round: the clean card answered, the junk card is the twin.
  { why: "the clean spelling answered, the backslash twin", answered: "Shohei Ohtani", twin: "Sh\\ohei Ohtani", player: "Shohei Ohtani" },
];

describe("answerName — a junk or accented name reaches its cleansed twin", () => {
  test("every spelling really differs from its twin (a lost escape would make this file vacuous)", () => {
    for (const p of PAIRS) {
      expect(p.answered, p.why).not.toBe(p.twin);
      expect(normalizeEntityName(p.answered), p.why).toBe(normalizeEntityName(p.twin));
    }
  });

  for (const pair of PAIRS) {
    test(`${pair.why}: one name row, one answer, both cards linked`, async () => {
      const t = newT();
      const { w, player, open, twin } = await t.run(async (ctx) => {
        const w = await seedTidyWorld(ctx);
        const player = await addPlayer(ctx, w, pair.player);
        await nameRow(ctx, { scopeId: w.base, sportId: w.sport, kind: "player", name: pair.answered });
        const open = await printCard(ctx, w, { number: "1", printed: [{ kind: "player", name: pair.answered }] });
        const twin = await printCard(ctx, w, { number: "2", printed: [{ kind: "player", name: pair.twin }] });
        return { w, player, open, twin };
      });

      // ONE row holds both spellings: the walk asks the name once.
      const rows = await t.run((ctx) =>
        ctx.db
          .query("tidyNames")
          .withIndex("by_scope_kind_name", (q) => q.eq("scopeId", w.base).eq("kind", "player"))
          .collect(),
      );
      expect(rows).toHaveLength(1);

      const out = await t.withIdentity(ADMIN).mutation(api.tidyNames.answerName, {
        cardId: open,
        kind: "player",
        name: pair.answered,
        answer: { kind: "linkPlayer", playerId: player },
      });
      expect(out.fanOutScheduled).toBe(true);
      // Before the fan-out the twin still waits on its name (the positive half of the proof below).
      expect((await t.run((ctx) => ctx.db.get(twin)))!.pendingPlayerNames).toEqual([pair.twin]);

      await drainScheduled(t);
      const openCard = (await t.run((ctx) => ctx.db.get(open)))!;
      const twinCard = (await t.run((ctx) => ctx.db.get(twin)))!;
      expect(openCard.playerIds).toEqual([player]);
      expect(twinCard.playerIds, "the answer reached the twin").toEqual([player]);
      expect(twinCard.pendingPlayerNames, "the twin no longer waits on the name").toBeUndefined();
      // The twin's printed spelling is ITS fact, kept as the name on the card.
      expect(twinCard.playerLinks).toEqual([{ playerId: player, nameOnCard: pair.twin }]);
    });
  }
});
