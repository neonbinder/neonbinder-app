/**
 * NEO-645 / NEO-656 — `tidyNames.answerName`, the one door for a name's answer.
 *
 * An answer writes to THIS card only (the card is the record; nothing is
 * stored about the answer). Other cards are reached only by
 * `tidyNames.applyNameToAll`, tested in `tidyNames.applyToAll.test.ts`. What is
 * pinned here:
 *
 *   - the open card is linked, and no other card moves;
 *   - an answer twice writes nothing the second time;
 *   - "Not a player" takes the name out of pending AND the generated title,
 *     and clear/Change brings it back;
 *   - a multi-player card keeps `playerIds` equal to `playerLinks`;
 *   - `saveAsAlias` (NEO-284) and `addSetSport` (NEO-313) are written;
 *   - the teamless-sport default (NEO-426) is re-asked of a card that just lost
 *     its last pending player name;
 *   - the sport rule, and the lookup's offered link (which may cross sports);
 *   - `requireAdmin`.
 */

import { convexTest } from "convex-test";
import { afterEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { cancelScheduled } from "../lib/testing/drain-scheduled";
import { normalizeEntityName } from "../lib/entities/normalize-name";
import {
  addPlayer,
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

type World = TidyWorld & { bo: Id<"players">; other: Id<"players"> };

/** The chain, Bo Jackson and a namesake. */
async function world(t: T): Promise<World> {
  return t.run(async (ctx) => {
    const w = await seedTidyWorld(ctx);
    const bo = await addPlayer(ctx, w, BO);
    const other = await addPlayer(ctx, w, "Vincent Jackson");
    return { ...w, bo, other } as World;
  });
}

const card = (t: T, id: Id<"cardChecklist">) => t.run((ctx) => ctx.db.get(id));
const answerPlayer = (
  t: T,
  w: World,
  cardId: Id<"cardChecklist">,
  playerId: Id<"players">,
  name = BO,
  extra: { addSetSport?: true } = {},
) =>
  t.withIdentity(ADMIN).mutation(api.tidyNames.answerName, {
    cardId,
    kind: "player",
    name,
    sportId: w.sport,
    answer: { kind: "linkPlayer", playerId, ...extra },
  });
const answerTeam = (
  t: T,
  w: World,
  cardId: Id<"cardChecklist">,
  name: string,
  answer: { kind: "linkTeam"; teamId: Id<"teams">; saveAsAlias?: true },
) =>
  t.withIdentity(ADMIN).mutation(api.tidyNames.answerName, {
    cardId,
    kind: "team",
    name,
    sportId: w.sport,
    answer,
  });

describe("answerName — this card, and only this card", () => {
  test("the open card is linked and loses the pending name; a card printing the same name is not touched", async () => {
    const t = newT();
    const w = await world(t);
    const [open, other] = await t.run(async (ctx) => [
      await printCard(ctx, w, { number: "1", printed: [{ kind: "player", name: BO }] }),
      await printCard(ctx, w, { number: "2", printed: [{ kind: "player", name: BO }] }),
    ]);

    const out = await answerPlayer(t, w, open, w.bo);
    expect(out).toBeNull();

    const openCard = (await card(t, open))!;
    expect(openCard.playerIds).toEqual([w.bo]);
    expect(openCard.playerLinks).toEqual([{ playerId: w.bo, nameOnCard: BO }]);
    expect(openCard.pendingPlayerNames).toBeUndefined();
    // Nothing is scheduled to reach the rest: only Apply to all does that.
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled.filter((s) => s.name.includes("tidyNames"))).toEqual([]);
    expect((await card(t, other))!.playerIds).toBeUndefined();
    expect((await card(t, other))!.pendingPlayerNames).toEqual([BO]);
  });

  test("answering with the same answer again writes nothing", async () => {
    const t = newT();
    const w = await world(t);
    const open = await t.run((ctx) =>
      printCard(ctx, w, { number: "1", printed: [{ kind: "player", name: BO }] }),
    );
    await answerPlayer(t, w, open, w.bo);
    const once = (await card(t, open))!;
    await answerPlayer(t, w, open, w.bo);
    expect(await card(t, open)).toEqual(once);
  });

  test("Change replaces the link on this card; the card keeps its own spelling of the name", async () => {
    const t = newT();
    const w = await world(t);
    const open = await t.run((ctx) =>
      printCard(ctx, w, { number: "1", printed: [{ kind: "player", name: BO }] }),
    );
    await answerPlayer(t, w, open, w.bo);
    await answerPlayer(t, w, open, w.other);
    const c = (await card(t, open))!;
    expect(c.playerIds).toEqual([w.other]);
    expect(c.playerLinks).toEqual([{ playerId: w.other, nameOnCard: BO }]);
  });

  test("a card's own spelling (an accent variant) is kept on the link", async () => {
    const t = newT();
    const w = await world(t);
    const acuna = await t.run((ctx) => addPlayer(ctx, w, "Ronald Acuna Jr."));
    const open = await t.run((ctx) =>
      printCard(ctx, w, { number: "2", printed: [{ kind: "player", name: "Ronald Acuna Jr." }] }),
    );
    // The operator answers under the accented spelling; the card printed the other.
    await answerPlayer(t, w, open, acuna, "Ronald Acuña Jr.");
    expect((await card(t, open))!.playerLinks).toEqual([
      { playerId: acuna, nameOnCard: "Ronald Acuna Jr." },
    ]);
    expect((await card(t, open))!.pendingPlayerNames).toBeUndefined();
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
  const ask = (
    t: T,
    w: World,
    cardId: Id<"cardChecklist">,
    answer: { kind: "notEntity" } | { kind: "clear" },
  ) =>
    t.withIdentity(ADMIN).mutation(api.tidyNames.answerName, {
      cardId,
      kind: "player",
      name: BO,
      sportId: w.sport,
      answer,
    });

  test("pending name and generated title both lose it on the open card; the other card keeps both", async () => {
    const t = newT();
    const { w, ids } = await twoCards(t);
    expect((await card(t, ids[0]))!.listingTitle).toContain(BO);
    await ask(t, w, ids[0], { kind: "notEntity" });
    const open = (await card(t, ids[0]))!;
    expect(open.pendingPlayerNames).toBeUndefined();
    expect(open.playerIds).toBeUndefined();
    expect(open.listingTitle).not.toContain("Jackson");
    const other = (await card(t, ids[1]))!;
    expect(other.pendingPlayerNames).toEqual([BO]);
    expect(other.listingTitle).toContain(BO);
  });

  test("clear (Change) puts the name back as pending, in the title again", async () => {
    const t = newT();
    const { w, ids } = await twoCards(t);
    await ask(t, w, ids[0], { kind: "notEntity" });
    await ask(t, w, ids[0], { kind: "clear" });
    const c = (await card(t, ids[0]))!;
    expect(c.pendingPlayerNames).toEqual([BO]);
    expect(c.listingTitle).toContain(BO);
  });

  test("clear after a link takes the link off and the name waits again", async () => {
    const t = newT();
    const { w, ids } = await twoCards(t);
    await answerPlayer(t, w, ids[0], w.bo);
    await ask(t, w, ids[0], { kind: "clear" });
    const c = (await card(t, ids[0]))!;
    expect(c.playerIds).toBeUndefined();
    expect(c.playerLinks).toBeUndefined();
    expect(c.pendingPlayerNames).toEqual([BO]);
  });

  test("a hand-typed title is rebuilt when the name leaves the card (T4: always overwrite)", async () => {
    const t = newT();
    const w = await world(t);
    const id = await t.run((ctx) =>
      printCard(ctx, w, {
        number: "1",
        printed: [{ kind: "player", name: BO }],
        extra: { listingTitle: "My own title for card one" },
      }),
    );
    await ask(t, w, id, { kind: "notEntity" });
    expect((await card(t, id))!.listingTitle).toBe("Chrome Base #1 Baseball");
  });
});

describe("answerName — a multi-player card keeps playerIds equal to playerLinks", () => {
  const twoNames = async (t: T) => {
    const w = await world(t);
    const [judge, soto] = await t.run(async (ctx) => [
      await addPlayer(ctx, w, "Aaron Judge"),
      await addPlayer(ctx, w, "Juan Soto"),
    ]);
    const id = await t.run((ctx) =>
      printCard(ctx, w, {
        number: "1",
        printed: [
          { kind: "player", name: "Aaron Judge" },
          { kind: "player", name: "Juan Soto" },
        ],
      }),
    );
    return { w, judge, soto, id };
  };

  test("a card with one name linked still carries the other as pending", async () => {
    const t = newT();
    const { w, judge, id } = await twoNames(t);
    await answerPlayer(t, w, id, judge, "Aaron Judge");
    expect((await card(t, id))!.pendingPlayerNames).toEqual(["Juan Soto"]);
  });

  test("a newly linked name goes after the players already linked (Jason, J2), ids and links in step", async () => {
    // Was: linking the SECOND printed player first and then the first ended in
    // printed order. The card no longer records how linked and pending names
    // interleave, so the new link lands last (NEO-656, J2: "a newly linked name
    // goes after the players already linked").
    const t = newT();
    const { w, judge, soto, id } = await twoNames(t);
    await answerPlayer(t, w, id, soto, "Juan Soto");
    expect((await card(t, id))!.playerIds).toEqual([soto]);
    expect((await card(t, id))!.pendingPlayerNames).toEqual(["Aaron Judge"]);
    await answerPlayer(t, w, id, judge, "Aaron Judge");
    const c = (await card(t, id))!;
    expect(c.playerIds).toEqual([soto, judge]);
    expect(c.playerLinks).toEqual([
      { playerId: soto, nameOnCard: "Juan Soto" },
      { playerId: judge, nameOnCard: "Aaron Judge" },
    ]);
    expect(c.pendingPlayerNames).toBeUndefined();
  });

  test("linking a MIDDLE pending name keeps playerIds equal to playerLinks, and the others stay pending in order", async () => {
    const t = newT();
    const w = await world(t);
    const [a, b, c] = await t.run(async (ctx) => [
      await addPlayer(ctx, w, "Aaron Judge"),
      await addPlayer(ctx, w, "Juan Soto"),
      await addPlayer(ctx, w, "Mookie Betts"),
    ]);
    const id = await t.run((ctx) =>
      printCard(ctx, w, {
        number: "1",
        printed: [
          { kind: "player", name: "Aaron Judge" },
          { kind: "player", name: "Juan Soto" },
          { kind: "player", name: "Mookie Betts" },
        ],
      }),
    );
    await answerPlayer(t, w, id, b, "Juan Soto");
    let row = (await card(t, id))!;
    expect(row.pendingPlayerNames).toEqual(["Aaron Judge", "Mookie Betts"]);
    expect(row.playerIds).toEqual(row.playerLinks!.map((l) => l.playerId));
    expect(row.playerIds).toEqual([b]);

    await answerPlayer(t, w, id, c, "Mookie Betts");
    await answerPlayer(t, w, id, a, "Aaron Judge");
    row = (await card(t, id))!;
    expect(row.playerIds).toEqual(row.playerLinks!.map((l) => l.playerId));
    expect(row.playerIds).toEqual([b, c, a]);
    expect(row.pendingPlayerNames).toBeUndefined();
  });
});

describe("answerName — NEO-284 saveAsAlias and NEO-313 addSetSport", () => {
  test("saveAsAlias writes the PRINTED spelling onto the team and links it", async () => {
    const t = newT();
    const w = await world(t);
    const open = await t.run((ctx) =>
      printCard(ctx, w, { number: "1", printed: [{ kind: "team", name: "Pads" }] }),
    );
    await answerTeam(t, w, open, "Pads", { kind: "linkTeam", teamId: w.padres, saveAsAlias: true });
    const team = (await t.run((ctx) => ctx.db.get(w.padres)))!;
    expect(team.aliases).toContain("Pads");
    expect((await card(t, open))!.teamOnCardIds).toEqual([w.padres]);
    expect((await card(t, open))!.pendingTeamNames).toBeUndefined();
  });

  test("without saveAsAlias no alias is written", async () => {
    const t = newT();
    const w = await world(t);
    const open = await t.run((ctx) =>
      printCard(ctx, w, { number: "1", printed: [{ kind: "team", name: "Pads" }] }),
    );
    await answerTeam(t, w, open, "Pads", { kind: "linkTeam", teamId: w.padres });
    expect((await t.run((ctx) => ctx.db.get(w.padres)))!.aliases ?? []).toEqual([]);
  });

  test("a team that is not in the question's sport is refused", async () => {
    const t = newT();
    const w = await world(t);
    const hoops = await t.run((ctx) =>
      ctx.db.insert("selectorOptions", {
        level: "sport",
        value: "Basketball",
        platformData: {},
        children: [],
        lastUpdated: 1,
      }),
    );
    const open = await t.run((ctx) =>
      printCard(ctx, w, { number: "1", printed: [{ kind: "team", name: "Pads" }] }),
    );
    await expect(
      t.withIdentity(ADMIN).mutation(api.tidyNames.answerName, {
        cardId: open,
        kind: "team",
        name: "Pads",
        sportId: hoops,
        answer: { kind: "linkTeam", teamId: w.padres },
      }),
    ).rejects.toThrow(/isn't in this sport/);
    expect((await card(t, open))!.pendingTeamNames).toEqual(["Pads"]);
  });

  test("Change never removes an alias already saved", async () => {
    const t = newT();
    const w = await world(t);
    // A linked team has no name on its card (a Change goes through the Team
    // tile), so the second answer is on another card still waiting on "Pads".
    const [open, later] = await t.run(async (ctx) => [
      await printCard(ctx, w, { number: "1", printed: [{ kind: "team", name: "Pads" }] }),
      await printCard(ctx, w, { number: "2", printed: [{ kind: "team", name: "Pads" }] }),
    ]);
    await answerTeam(t, w, open, "Pads", { kind: "linkTeam", teamId: w.padres, saveAsAlias: true });
    await answerTeam(t, w, later, "Pads", { kind: "linkTeam", teamId: w.mets });
    expect((await t.run((ctx) => ctx.db.get(w.padres)))!.aliases).toContain("Pads");
    expect((await card(t, later))!.teamOnCardIds).toContain(w.mets);
  });

  test("addSetSport adds the SET's sport to a player of another sport", async () => {
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
      return { hoops, guard };
    });
    const open = await t.run((ctx) =>
      printCard(ctx, w, { number: "1", printed: [{ kind: "player", name: "Deion Sanders" }] }),
    );
    // The question is asked in basketball (the Sport chip), on a baseball set.
    await t.withIdentity(ADMIN).mutation(api.tidyNames.answerName, {
      cardId: open,
      kind: "player",
      name: "Deion Sanders",
      sportId: hoops,
      answer: { kind: "linkPlayer", playerId: guard, addSetSport: true },
    });
    const extra = await t.run((ctx) =>
      ctx.db
        .query("playerSports")
        .withIndex("by_player_id", (q) => q.eq("playerId", guard))
        .collect(),
    );
    expect(extra.map((r) => r.sportId)).toEqual([w.sport]);
    expect(hoops).not.toBe(w.sport);
    expect((await card(t, open))!.playerIds).toEqual([guard]);
  });
});

describe("answerName — the teamless-sport default (NEO-426) is re-stamped", () => {
  async function golf(t: T) {
    return t.run(async (ctx) => {
      const w = await seedTidyWorld(ctx, { sportValue: "Golf" });
      await ctx.db.patch(w.sport, { teamlessSport: { setAt: 1, setByUserId: "setter" } });
      const tiger = await addPlayer(ctx, w, "Tiger Woods");
      const mk = (n: string) =>
        printCard(ctx, w, { number: n, printed: [{ kind: "player", name: "Tiger Woods" }] });
      return { w: w as World, tiger, open: await mk("1"), other: await mk("2") };
    });
  }

  test("born with a pending name it holds back; the answer stamps No team on the open card only", async () => {
    const t = newT();
    const { w, tiger, open, other } = await golf(t);
    expect((await card(t, open))!.teamNoneConfirmedAt).toBeUndefined();
    await answerPlayer(t, w, open, tiger, "Tiger Woods");
    expect((await card(t, open))!.teamNoneConfirmedAt).toBeGreaterThan(0);
    expect((await card(t, other))!.teamNoneConfirmedAt).toBeUndefined();
  });

  test("a card that names a team is not stamped (rule 8: a data claim holds back a guess)", async () => {
    const t = newT();
    const { w, tiger, open } = await golf(t);
    await t.run((ctx) => ctx.db.patch(open, { bscTeamName: "Some Team" }));
    await answerPlayer(t, w, open, tiger, "Tiger Woods");
    expect((await card(t, open))!.teamNoneConfirmedAt).toBeUndefined();
  });

  test("a sport that is not flagged is never stamped", async () => {
    const t = newT();
    const w = await world(t);
    const open = await t.run((ctx) =>
      printCard(ctx, w, { number: "1", printed: [{ kind: "player", name: BO }] }),
    );
    await answerPlayer(t, w, open, w.bo);
    expect((await card(t, open))!.teamNoneConfirmedAt).toBeUndefined();
  });
});

describe("answerName — validation and the gate", () => {
  test("a team answer on a player name, and a player answer on a team name, are refused", async () => {
    const t = newT();
    const w = await world(t);
    const open = await t.run((ctx) =>
      printCard(ctx, w, {
        number: "1",
        printed: [
          { kind: "player", name: BO },
          { kind: "team", name: "Pads" },
        ],
      }),
    );
    await expect(
      t.withIdentity(ADMIN).mutation(api.tidyNames.answerName, {
        cardId: open,
        kind: "player",
        name: BO,
        sportId: w.sport,
        answer: { kind: "linkTeam", teamId: w.padres },
      }),
    ).rejects.toThrow(/team name/);
    await expect(
      t.withIdentity(ADMIN).mutation(api.tidyNames.answerName, {
        cardId: open,
        kind: "team",
        name: "Pads",
        sportId: w.sport,
        answer: { kind: "linkPlayer", playerId: w.bo },
      }),
    ).rejects.toThrow(/player name/);
  });

  const stranger = (t: T) =>
    t.run(async (ctx) => {
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
        aliases: ["Mike Jordan"],
        sportId: hoops,
        lastUpdated: 1,
      });
      return { hoops, mj };
    });

  test("a player of another sport is refused, and nothing is written", async () => {
    const t = newT();
    const w = await world(t);
    const { mj } = await stranger(t);
    const open = await t.run((ctx) =>
      printCard(ctx, w, { number: "1", printed: [{ kind: "player", name: BO }] }),
    );
    await expect(answerPlayer(t, w, open, mj)).rejects.toThrow(/isn't in this sport/);
    expect((await card(t, open))!.pendingPlayerNames).toEqual([BO]);
    expect((await card(t, open))!.playerIds).toBeUndefined();
  });

  test("a link to a player the lookup OFFERED in another sport is allowed (offered: true)", async () => {
    const t = newT();
    const w = await world(t);
    const { mj } = await stranger(t);
    const open = await t.run((ctx) =>
      printCard(ctx, w, { number: "1", printed: [{ kind: "player", name: "Mike Jordan" }] }),
    );
    await t.withIdentity(ADMIN).mutation(api.tidyNames.answerName, {
      cardId: open,
      kind: "player",
      name: "Mike Jordan",
      sportId: w.sport,
      answer: { kind: "linkPlayer", playerId: mj },
      offered: true,
    });
    expect((await card(t, open))!.playerIds).toEqual([mj]);
    expect((await card(t, open))!.playerLinks).toEqual([{ playerId: mj, nameOnCard: "Mike Jordan" }]);
  });

  test("offered: true does not carry a player of another sport whose name or alias is not this name (S1)", async () => {
    const t = newT();
    const w = await world(t);
    const { mj } = await stranger(t);
    const open = await t.run((ctx) =>
      printCard(ctx, w, { number: "1", printed: [{ kind: "player", name: BO }] }),
    );
    await expect(
      t.withIdentity(ADMIN).mutation(api.tidyNames.answerName, {
        cardId: open,
        kind: "player",
        name: BO,
        sportId: w.sport,
        answer: { kind: "linkPlayer", playerId: mj },
        offered: true,
      }),
    ).rejects.toThrow(/isn't in this sport/);
    expect((await card(t, open))!.playerIds).toBeUndefined();
    expect((await card(t, open))!.pendingPlayerNames).toEqual([BO]);
  });

  // NEO-656 (N1): main took any id in the row's own preselect / candidates, so a
  // history pick or the prior-year pick offered under ANOTHER spelling than the
  // card's was accepted. `offered` is a client flag, so the server re-derives
  // those two picks itself (the gate's own scan) rather than trusting it.
  describe("offered: a pick the server itself derives for this name (N1)", () => {
    /** A Basketball player known to the set's cards as "Magic Johnson" only: no alias says so. */
    const nicknamed = (t: T) =>
      t.run(async (ctx) => {
        const hoops = await ctx.db.insert("selectorOptions", {
          level: "sport",
          value: "Basketball",
          platformData: {},
          children: [],
          lastUpdated: 1,
        });
        const earvin = await ctx.db.insert("players", {
          name: "Earvin Johnson",
          nameNormalized: normalizeEntityName("Earvin Johnson"),
          sportId: hoops,
          lastUpdated: 1,
        });
        return earvin;
      });
    const printedLink = (
      leaf: Id<"selectorOptions">,
      playerId: Id<"players">,
      nameOnCard: string,
    ) => ({
      selectorOptionId: leaf,
      cardNumber: "H1",
      cardName: "Earlier commit",
      playerIds: [playerId],
      playerLinks: [{ playerId, nameOnCard }],
      platformData: {},
      sortOrder: 0,
      lastUpdated: 1,
    });
    const offeredLink = (t: T, w: World, cardId: Id<"cardChecklist">, playerId: Id<"players">) =>
      t.withIdentity(ADMIN).mutation(api.tidyNames.answerName, {
        cardId,
        kind: "player",
        name: "Magic Johnson",
        sportId: w.sport,
        answer: { kind: "linkPlayer", playerId },
        offered: true,
      });

    test("a set-history pick spelled differently from the card is accepted", async () => {
      const t = newT();
      const w = await world(t);
      const earvin = await nicknamed(t);
      const open = await t.run(async (ctx) => {
        await ctx.db.insert("cardChecklist", {
          ...printedLink(w.insert, earvin, "Magic Johnson"),
          listingTitle: "#H1",
          sportId: w.sport,
        });
        return printCard(ctx, w, { number: "1", printed: [{ kind: "player", name: "Magic Johnson" }] });
      });

      await offeredLink(t, w, open, earvin);

      expect((await card(t, open))!.playerIds).toEqual([earvin]);
      expect((await card(t, open))!.playerLinks).toEqual([
        { playerId: earvin, nameOnCard: "Magic Johnson" },
      ]);
    });

    test("the prior-year product's pick (rule E1) spelled differently from the card is accepted", async () => {
      const t = newT();
      const w = await world(t);
      const earvin = await nicknamed(t);
      const open = await t.run(async (ctx) => {
        const node = (
          level: "year" | "manufacturer" | "setName" | "variantType",
          value: string,
          parentId: Id<"selectorOptions">,
        ) =>
          ctx.db.insert("selectorOptions", {
            level,
            value,
            parentId,
            platformData: {},
            children: [],
            lastUpdated: 1,
          });
        const year = await node("year", "2023", w.sport);
        const brand = await node("manufacturer", "Topps", year);
        const set = await node("setName", "Chrome", brand);
        const base = await node("variantType", "Base", set);
        await ctx.db.insert("cardChecklist", {
          ...printedLink(base, earvin, "Magic Johnson"),
          listingTitle: "#H1",
          sportId: w.sport,
        });
        return printCard(ctx, w, { number: "1", printed: [{ kind: "player", name: "Magic Johnson" }] });
      });

      await offeredLink(t, w, open, earvin);

      expect((await card(t, open))!.playerIds).toEqual([earvin]);
    });

    test("a player of another sport nothing offers for this name is still refused, history or no history", async () => {
      const t = newT();
      const w = await world(t);
      const earvin = await nicknamed(t);
      const { mj } = await stranger(t);
      const open = await t.run(async (ctx) => {
        // The set's history links "Magic Johnson" to Earvin, not to the stranger.
        await ctx.db.insert("cardChecklist", {
          ...printedLink(w.insert, earvin, "Magic Johnson"),
          listingTitle: "#H1",
          sportId: w.sport,
        });
        return printCard(ctx, w, { number: "1", printed: [{ kind: "player", name: "Magic Johnson" }] });
      });

      await expect(offeredLink(t, w, open, mj)).rejects.toThrow(/isn't in this sport/);
      expect((await card(t, open))!.playerIds).toBeUndefined();
      expect((await card(t, open))!.pendingPlayerNames).toEqual(["Magic Johnson"]);
    });

    test("without offered: true a history pick of another sport is refused like any other", async () => {
      const t = newT();
      const w = await world(t);
      const earvin = await nicknamed(t);
      const open = await t.run(async (ctx) => {
        await ctx.db.insert("cardChecklist", {
          ...printedLink(w.insert, earvin, "Magic Johnson"),
          listingTitle: "#H1",
          sportId: w.sport,
        });
        return printCard(ctx, w, { number: "1", printed: [{ kind: "player", name: "Magic Johnson" }] });
      });

      await expect(
        t.withIdentity(ADMIN).mutation(api.tidyNames.answerName, {
          cardId: open,
          kind: "player",
          name: "Magic Johnson",
          sportId: w.sport,
          answer: { kind: "linkPlayer", playerId: earvin },
        }),
      ).rejects.toThrow(/isn't in this sport/);
    });
  });

  test("an offered id that is gone since the lookup is refused, and nothing is written", async () => {
    const t = newT();
    const w = await world(t);
    const { mj } = await stranger(t);
    await t.run((ctx) => ctx.db.delete(mj));
    const open = await t.run((ctx) =>
      printCard(ctx, w, { number: "1", printed: [{ kind: "player", name: "Mike Jordan" }] }),
    );
    await expect(
      t.withIdentity(ADMIN).mutation(api.tidyNames.answerName, {
        cardId: open,
        kind: "player",
        name: "Mike Jordan",
        sportId: w.sport,
        answer: { kind: "linkPlayer", playerId: mj },
        offered: true,
      }),
    ).rejects.toThrow(/player is gone/);
    expect((await card(t, open))!.playerIds).toBeUndefined();
    expect((await card(t, open))!.pendingPlayerNames).toEqual(["Mike Jordan"]);
  });

  test("a name the card does not hold is refused for a link, Not a player and a team link; only clear may name it (main's guard)", async () => {
    const t = newT();
    const w = await world(t);
    const open = await t.run((ctx) =>
      printCard(ctx, w, { number: "1", printed: [{ kind: "player", name: BO }] }),
    );
    await expect(answerPlayer(t, w, open, w.bo, "Somebody Else")).rejects.toThrow(
      /isn't on this card/,
    );
    await expect(
      t.withIdentity(ADMIN).mutation(api.tidyNames.answerName, {
        cardId: open,
        kind: "player",
        name: "Somebody Else",
        sportId: w.sport,
        answer: { kind: "notEntity" },
      }),
    ).rejects.toThrow(/isn't on this card/);
    await expect(
      answerTeam(t, w, open, "Some Team", { kind: "linkTeam", teamId: w.padres }),
    ).rejects.toThrow(/isn't on this card/);
    const after = (await card(t, open))!;
    expect(after.pendingPlayerNames).toEqual([BO]);
    expect(after.playerIds).toBeUndefined();
    // `clear` is the one answer that may name a name the card no longer holds
    // (the walk re-asks after Not a player).
    await t.withIdentity(ADMIN).mutation(api.tidyNames.answerName, {
      cardId: open,
      kind: "player",
      name: "Somebody Else",
      sportId: w.sport,
      answer: { kind: "clear" },
    });
    expect((await card(t, open))!.pendingPlayerNames).toContain("Somebody Else");
  });

  test("a card that is gone is refused", async () => {
    const t = newT();
    const w = await world(t);
    const open = await t.run((ctx) =>
      printCard(ctx, w, { number: "1", printed: [{ kind: "player", name: BO }] }),
    );
    await t.run((ctx) => ctx.db.delete(open));
    await expect(answerPlayer(t, w, open, w.bo)).rejects.toThrow(/card is gone/);
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
      sportId: w.sport,
      answer: { kind: "linkPlayer" as const, playerId: w.bo },
    };
    await expect(t.mutation(api.tidyNames.answerName, args)).rejects.toThrow(/Not authenticated/);
    await expect(t.withIdentity(MEMBER).mutation(api.tidyNames.answerName, args)).rejects.toThrow(
      /Admin access required/,
    );
    expect((await card(t, open))!.pendingPlayerNames).toEqual([BO]);
  });

  test("a name over the cap is refused naming the limit, never the value", async () => {
    const t = newT();
    const w = await world(t);
    const open = await t.run((ctx) =>
      printCard(ctx, w, { number: "1", printed: [{ kind: "player", name: BO }] }),
    );
    const long = "Z".repeat(121);
    const err = await answerPlayer(t, w, open, w.bo, long).catch((e: Error) => e);
    expect(String((err as Error).message)).toMatch(/limit is 120/);
    expect(String((err as Error).message)).not.toContain(long);
  });
});
