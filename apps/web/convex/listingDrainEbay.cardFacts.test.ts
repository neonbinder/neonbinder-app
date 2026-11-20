/**
 * NEO-619 — `ebayCardFacts` and the Insert Set aspect under "Parallels name
 * themselves". A parallel whose insert has the switch on names itself in its
 * title, so its facts carry no `insertName`; the parallel's own name stays.
 * Everything else (the insert's own cards, a switch that is off) keeps the
 * insert name, as before.
 *
 * Invented words: insert "Zorbo Special Purple", parallel "Zorbo Special Gold".
 */

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import { insertTestCard } from "../lib/testing/card-row";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const NOW = 1_700_000_000_000;
type T = ReturnType<typeof convexTest>;

async function seed(t: T, opts: { on?: boolean; typeTitle?: string } = {}) {
  return t.run(async (ctx) => {
    const row = (
      level: Doc<"selectorOptions">["level"],
      value: string,
      parentId?: Id<"selectorOptions">,
      metadata?: Doc<"selectorOptions">["metadata"],
    ) =>
      ctx.db.insert("selectorOptions", {
        level,
        value,
        ...(parentId ? { parentId } : {}),
        ...(metadata ? { metadata } : {}),
        platformData: {},
        children: [],
        lastUpdated: NOW,
      });
    const sport = await row("sport", "Baseball");
    const year = await row("year", "2026", sport);
    const brand = await row("manufacturer", "Leaf", year);
    const set = await row("setName", "Pulse", brand);
    const type = await row("variantType", opts.typeTitle ?? "Inserts", set);
    const insert = await row(
      "insert",
      "Zorbo Special Purple",
      type,
      opts.on ? { parallelsNameThemselves: true } : undefined,
    );
    const gold = await row("parallel", "Zorbo Special Gold", insert);
    const card = (selectorOptionId: Id<"selectorOptions">) =>
      insertTestCard(ctx, {
        selectorOptionId,
        cardNumber: "7",
        cardName: "Card 7",
        platformData: {},
        sortOrder: 0,
        lastUpdated: NOW,
      });
    return { onInsert: await card(insert), onGold: await card(gold) };
  });
}

const factsOf = async (t: T, cardId: Id<"cardChecklist">) => {
  const [one] = await t.query(internal.listingDrainEbay.ebayCardFacts, { cardIds: [cardId] });
  return one.facts;
};

describe("ebayCardFacts — insertName under Parallels name themselves (NEO-619)", () => {
  test("the switch on: a parallel's card has no insertName but keeps its parallel name", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t, { on: true });
    const facts = await factsOf(t, s.onGold);
    expect(facts.insertName).toBeUndefined();
    expect(facts.parallelName).toBe("Zorbo Special Gold");
  });

  test("the switch on: the insert's own card still has its insertName", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t, { on: true });
    expect((await factsOf(t, s.onInsert)).insertName).toBe("Zorbo Special Purple");
  });

  test("the switch off: a parallel's card has the insertName, as before", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t, { on: false });
    const facts = await factsOf(t, s.onGold);
    expect(facts.insertName).toBe("Zorbo Special Purple");
    expect(facts.parallelName).toBe("Zorbo Special Gold");
  });

  test("the switch on under a type with no insert kind: nothing was an insertName, nothing changes", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t, { on: true, typeTitle: "Promo" });
    expect((await factsOf(t, s.onGold)).insertName).toBeUndefined();
    expect((await factsOf(t, s.onInsert)).insertName).toBeUndefined();
  });
});
