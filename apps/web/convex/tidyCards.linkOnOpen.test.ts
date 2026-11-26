/**
 * NEO-680 — `tidyCards.linkOnOpen`: when the Tidy Up walk opens a card, each
 * player name still waiting on it that exactly ONE player answers to (his own
 * name or an alias) links by itself.
 *
 * Nothing is stored about it (CLAUDE.md invariant 9): the names to hold back
 * (`skip`, the ones the operator took back with Edit) arrive with the call and
 * only narrow what is linked; the card is re-read here.
 */

import { convexTest } from "convex-test";
import { afterEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { syncPlayerAliases } from "./players";
import { cancelScheduled } from "../lib/testing/drain-scheduled";
import { addPlayer, printCard, seedTidyWorld, WORLD_NOW } from "../lib/testing/tidy-world";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const ADMIN = { subject: "user_link_open_admin", role: "admin" };
const MEMBER = { subject: "user_link_open_member" };
type T = ReturnType<typeof convexTest>;
type Ctx = Parameters<Parameters<T["run"]>[0]>[0];

const live: T[] = [];
const newT = () => {
  const t = convexTest(schema, modules);
  live.push(t);
  return t;
};
afterEach(async () => {
  for (const t of live.splice(0)) await cancelScheduled(t);
});

const KIM = "Hye-Seong Kim";
const JUDGE = "Aaron Judge";
const SOTO = "Juan Soto";

async function addAliased(ctx: Ctx, w: Parameters<typeof addPlayer>[1], name: string, aliases: string[]) {
  const id = await addPlayer(ctx, w, name, undefined, { aliases });
  await syncPlayerAliases(ctx, { playerId: id });
  return id;
}

const card = (t: T, id: Id<"cardChecklist">) => t.run((ctx) => ctx.db.get(id));
const open = (t: T, cardId: Id<"cardChecklist">, skip?: string[]) =>
  t.withIdentity(ADMIN).mutation(api.tidyCards.linkOnOpen, { cardId, ...(skip ? { skip } : {}) });

describe("linkOnOpen", () => {
  test("a waiting name one player answers to by an alias links, keeping the name the card printed", async () => {
    const t = newT();
    const { id, kim } = await t.run(async (ctx) => {
      const w = await seedTidyWorld(ctx);
      const kim = await addAliased(ctx, w, "Kim Ha-Seong", [KIM]);
      return { id: await printCard(ctx, w, { number: "1", pendingPlayerNames: [KIM] }), kim };
    });
    await open(t, id);
    const c = (await card(t, id))!;
    expect(c.playerIds).toEqual([kim]);
    expect(c.playerLinks).toEqual([{ playerId: kim, nameOnCard: KIM }]);
    expect(c.pendingPlayerNames).toBeUndefined();
    expect(c.lastUpdated).toBeGreaterThan(WORLD_NOW);
  });

  test("a lone own-name match links too, in printed order beside the link the card already has", async () => {
    const t = newT();
    const { id, judge, kim, soto } = await t.run(async (ctx) => {
      const w = await seedTidyWorld(ctx);
      const judge = await addPlayer(ctx, w, JUDGE);
      const kim = await addAliased(ctx, w, "Kim Ha-Seong", [KIM]);
      const soto = await addPlayer(ctx, w, SOTO);
      const id = await printCard(ctx, w, {
        number: "2",
        pendingPlayerNames: [KIM, SOTO],
        extra: { playerIds: [judge], playerLinks: [{ playerId: judge, nameOnCard: JUDGE }] },
      });
      return { id, judge, kim, soto };
    });
    await open(t, id);
    const c = (await card(t, id))!;
    expect(c.playerIds).toEqual([judge, kim, soto]);
    expect(c.playerLinks?.map((l) => l.nameOnCard)).toEqual([JUDGE, KIM, SOTO]);
    expect(c.pendingPlayerNames).toBeUndefined();
  });

  test("two players who answer to the name, or none, leave it waiting and write nothing", async () => {
    const t = newT();
    const id = await t.run(async (ctx) => {
      const w = await seedTidyWorld(ctx);
      await addAliased(ctx, w, "Kim Ha-Seong", [KIM]);
      await addAliased(ctx, w, "Kim Ha Seong Sr", [KIM]);
      return printCard(ctx, w, { number: "3", pendingPlayerNames: [KIM, "Nobody Atall"] });
    });
    await open(t, id);
    const c = (await card(t, id))!;
    expect(c.playerIds).toBeUndefined();
    expect(c.pendingPlayerNames).toEqual([KIM, "Nobody Atall"]);
    expect(c.lastUpdated).toBe(WORLD_NOW);
  });

  test("a name the operator took back (skip) stays waiting, however it is spelled; the others still link", async () => {
    const t = newT();
    const { id, kim, soto } = await t.run(async (ctx) => {
      const w = await seedTidyWorld(ctx);
      const kim = await addAliased(ctx, w, "Kim Ha-Seong", [KIM]);
      const soto = await addPlayer(ctx, w, SOTO);
      return { id: await printCard(ctx, w, { number: "4", pendingPlayerNames: [KIM, SOTO] }), kim, soto };
    });
    await open(t, id, ["hye-seong KIM."]);
    const c = (await card(t, id))!;
    expect(c.pendingPlayerNames).toEqual([KIM]);
    expect(c.playerIds).toEqual([soto]);
    expect(c.playerIds).not.toContain(kim);
  });

  test("is idempotent: a second call finds nothing waiting and writes nothing", async () => {
    const t = newT();
    const id = await t.run(async (ctx) => {
      const w = await seedTidyWorld(ctx);
      await addAliased(ctx, w, "Kim Ha-Seong", [KIM]);
      return printCard(ctx, w, { number: "5", pendingPlayerNames: [KIM] });
    });
    await open(t, id);
    const once = (await card(t, id))!;
    await open(t, id);
    expect(await card(t, id)).toEqual(once);
  });

  test("a card with nothing waiting is not written, and a card that is gone is a no-op", async () => {
    const t = newT();
    const { plain, gone } = await t.run(async (ctx) => {
      const w = await seedTidyWorld(ctx);
      await addAliased(ctx, w, "Kim Ha-Seong", [KIM]);
      const plain = await printCard(ctx, w, { number: "6" });
      const gone = await printCard(ctx, w, { number: "7" });
      await ctx.db.delete(gone);
      return { plain, gone };
    });
    const before = await card(t, plain);
    expect(await open(t, plain)).toBeNull();
    expect(await card(t, plain)).toEqual(before);
    expect(await open(t, gone)).toBeNull();
  });

  test("a name waiting in another sport is not linked (the card's own sport answers)", async () => {
    const t = newT();
    const id = await t.run(async (ctx) => {
      const w = await seedTidyWorld(ctx);
      const hockey = await ctx.db.insert("selectorOptions", {
        level: "sport",
        value: "Hockey",
        platformData: {},
        children: [],
        lastUpdated: WORLD_NOW,
      });
      await addAliased(ctx, { sport: hockey }, "Kim Ha-Seong", [KIM]);
      return printCard(ctx, w, { number: "8", pendingPlayerNames: [KIM] });
    });
    await open(t, id);
    expect((await card(t, id))!.pendingPlayerNames).toEqual([KIM]);
  });

  test("refuses a signed-out caller and a non-admin, and caps what is held back", async () => {
    const t = newT();
    const id = await t.run(async (ctx) => {
      const w = await seedTidyWorld(ctx);
      await addAliased(ctx, w, "Kim Ha-Seong", [KIM]);
      return printCard(ctx, w, { number: "9", pendingPlayerNames: [KIM] });
    });
    await expect(t.mutation(api.tidyCards.linkOnOpen, { cardId: id })).rejects.toThrow(/Not authenticated/);
    await expect(t.withIdentity(MEMBER).mutation(api.tidyCards.linkOnOpen, { cardId: id })).rejects.toThrow(
      /Admin access required/,
    );
    await expect(open(t, id, Array.from({ length: 21 }, (_, i) => `Name ${i}`))).rejects.toThrow(/At most 20/);
    await expect(open(t, id, ["L".repeat(121)])).rejects.toThrow(/at most 120 characters/);
    expect((await card(t, id))!.pendingPlayerNames).toEqual([KIM]);
  });
});
