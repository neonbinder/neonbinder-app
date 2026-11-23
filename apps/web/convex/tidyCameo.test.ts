/**
 * NEO-645 T3 — "“It Takes Two CPC”, Lindor as a cameo" on the Sources disagree
 * tile: when it is offered (`cardContext.cameoOffer`) and the one mutation that
 * settles the card (`tidyCameo.pickSourceAsCameo`).
 */

import { convexTest } from "convex-test";
import { afterEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import { deriveCardAttention } from "./features/cardAttention";
import { cancelScheduled, drainScheduled } from "../lib/testing/drain-scheduled";
import { normalizeEntityName } from "../lib/entities/normalize-name";
import { addPlayer, nameRow, printCard, seedTidyWorld } from "../lib/testing/tidy-world";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const ADMIN = { subject: "user_tidy_cameo_admin", role: "admin" };
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

const CPC = "It Takes Two CPC";
const LINDOR = "Francisco Lindor";

const entry = (a: string[], b: string[], chosen?: Entry["chosen"]): Entry => ({
  field: "players",
  values: [
    { value: a, sources: ["bsc"] },
    { value: b, sources: ["checklist"] },
  ],
  ...(chosen ? { chosen } : {}),
});

async function setup(t: T, values: Entry = entry([CPC], [LINDOR]), extra: Record<string, unknown> = {}) {
  return t.run(async (ctx) => {
    const w = await seedTidyWorld(ctx);
    const lindor = await addPlayer(ctx, w, LINDOR);
    const card = await printCard(ctx, w, {
      number: "7",
      pendingPlayerNames: [],
      extra: { cardName: LINDOR, teamOnCardIds: [w.mets], sourceDisagreements: [values], ...extra },
    });
    return { w, lindor, card };
  });
}

const offer = async (t: T, cardId: Id<"cardChecklist">) =>
  (await t.withIdentity(ADMIN).query(api.tidyCards.cardContext, { cardId }))!.cameoOffer;
const get = (t: T, id: Id<"cardChecklist">) => t.run((ctx) => ctx.db.get(id));

describe("when the shortcut is offered", () => {
  test("one side is exactly one NB player and the other is not: the name, the surname", async () => {
    const t = newT();
    const { card, lindor } = await setup(t);
    expect(await offer(t, card)).toEqual({ playerId: lindor, surname: "Lindor", name: CPC });
  });

  test("whichever source says which", async () => {
    const t = newT();
    const { card, lindor } = await setup(t, entry([LINDOR], [CPC]));
    expect(await offer(t, card)).toEqual({ playerId: lindor, surname: "Lindor", name: CPC });
  });

  test("the surname drops a generational suffix and keeps accents; one word is whole", async () => {
    const t = newT();
    const acuna = await t.run(async (ctx) => {
      const w = await seedTidyWorld(ctx);
      const p = await addPlayer(ctx, w, "Ronald Acuña Jr.");
      const pele = await addPlayer(ctx, w, "Pelé");
      const mk = (name: string, other: string) =>
        printCard(ctx, w, {
          number: name === "Pelé" ? "2" : "1",
          pendingPlayerNames: [],
          extra: { sourceDisagreements: [entry([other], [name])] },
        });
      return { p, pele, a: await mk("Ronald Acuña Jr.", "Hopping to It CPC"), b: await mk("Pelé", CPC) };
    });
    expect(await offer(t, acuna.a)).toEqual({
      playerId: acuna.p,
      surname: "Acuña",
      name: "Hopping to It CPC",
    });
    expect(await offer(t, acuna.b)).toMatchObject({ playerId: acuna.pele, surname: "Pelé" });
  });

  test("a name ruled out as not a player counts as not a player, even when one answers to it", async () => {
    const t = newT();
    const { card, w, lindor } = await setup(t);
    await t.run(async (ctx) => {
      await addPlayer(ctx, w, CPC);
      await nameRow(ctx, {
        scopeId: w.base,
        sportId: w.sport,
        kind: "player",
        name: CPC,
        over: { answer: { kind: "notEntity", by: "operator" } as never, answerGen: 1 },
      });
    });
    expect(await offer(t, card)).toMatchObject({ playerId: lindor, name: CPC });
  });
});

describe("when there is no button", () => {
  test("both sides are players", async () => {
    const t = newT();
    const { card, w } = await setup(t);
    await t.run((ctx) => addPlayer(ctx, w, CPC));
    expect(await offer(t, card)).toBeUndefined();
  });

  test("neither side is a player", async () => {
    const t = newT();
    const { card } = await setup(t, entry([CPC], ["Hopping to It CPC"]));
    expect(await offer(t, card)).toBeUndefined();
  });

  test("a player's name is shared by two players: not exactly one", async () => {
    const t = newT();
    const { card, w } = await setup(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("players", {
        name: LINDOR,
        nameNormalized: normalizeEntityName(LINDOR),
        sportId: w.sport,
        lastUpdated: 1,
      });
    });
    expect(await offer(t, card)).toBeUndefined();
  });

  test("a name only an alias answers to is a question, not a player", async () => {
    const t = newT();
    const { card, lindor, w } = await setup(t, entry([CPC], ["Paco Lindor"]));
    await t.run((ctx) =>
      ctx.db.insert("playerAliases", {
        playerId: lindor,
        sportId: w.sport,
        aliasNormalized: normalizeEntityName("Paco Lindor"),
      }),
    );
    expect(await offer(t, card)).toBeUndefined();
  });

  test("the other side is answered as a player", async () => {
    const t = newT();
    const { card, w, lindor } = await setup(t);
    await t.run((ctx) =>
      nameRow(ctx, {
        scopeId: w.base,
        sportId: w.sport,
        kind: "player",
        name: CPC,
        over: { answer: { kind: "linkPlayer", playerId: lindor, by: "operator" } as never, answerGen: 1 },
      }),
    );
    expect(await offer(t, card)).toBeUndefined();
  });

  test("a near spelling of the player's own name is the same person, not a title", async () => {
    const t = newT();
    const { card } = await setup(t, entry(["Francisco Lindorr"], [LINDOR]));
    expect(await offer(t, card)).toBeUndefined();
    const merrill = await t.run(async (ctx) => {
      const w = await seedTidyWorld(ctx);
      await addPlayer(ctx, w, "Jackson Merrill");
      return printCard(ctx, w, {
        number: "1",
        pendingPlayerNames: [],
        extra: { sourceDisagreements: [entry(["Jackson Merril"], ["Jackson Merrill"])] },
      });
    });
    expect(await offer(t, merrill)).toBeUndefined();
  });

  test("a value of several names, or three values", async () => {
    const t = newT();
    const several = await setup(t, entry([CPC, "Someone Else"], [LINDOR]));
    expect(await offer(t, several.card)).toBeUndefined();
    const three = await setup(t, {
      field: "players",
      values: [
        { value: [CPC], sources: ["bsc"] },
        { value: [LINDOR], sources: ["checklist"] },
        { value: ["Other CPC"], sources: ["sportlots"] },
      ],
    });
    expect(await offer(t, three.card)).toBeUndefined();
  });

  test("the player is already on the card, as its player or a cameo", async () => {
    const t = newT();
    const { card, lindor } = await setup(t);
    await t.run((ctx) => ctx.db.patch(card, { secondaryPlayerIds: [lindor] }));
    expect(await offer(t, card)).toBeUndefined();
    await t.run((ctx) =>
      ctx.db.patch(card, {
        secondaryPlayerIds: undefined,
        playerIds: [lindor],
        playerLinks: [{ playerId: lindor, nameOnCard: LINDOR }],
      }),
    );
    expect(await offer(t, card)).toBeUndefined();
  });

  test("a teams disagreement offers nothing", async () => {
    const t = newT();
    const { card } = await setup(t, {
      field: "teams",
      values: [
        { value: ["Mets"], sources: ["bsc"] },
        { value: ["Padres"], sources: ["checklist"] },
      ],
    });
    expect(await offer(t, card)).toBeUndefined();
  });
});

describe("pickSourceAsCameo", () => {
  test("names the card for the other side, adds the player as a cameo, settles it, leaves the player empty, rebuilds the text", async () => {
    const t = newT();
    const { card, lindor } = await setup(t, entry([CPC], [LINDOR]), { listingTitle: "Typed by hand" });
    const out = await t.withIdentity(ADMIN).mutation(api.tidyCameo.pickSourceAsCameo, { cardId: card });
    expect(out).toEqual({ playerId: lindor, name: CPC });

    const c = (await get(t, card))!;
    // 1. the card's name follows the pick, as "Use “It Takes Two CPC”" does.
    expect(c.cardName).toBe(CPC);
    // 2. the player is a cameo, in the field and its index.
    expect(c.secondaryPlayerIds).toEqual([lindor]);
    const links = await t.run((ctx) =>
      ctx.db
        .query("cardSecondaryPlayerLinks")
        .withIndex("by_card", (q) => q.eq("cardChecklistId", card))
        .collect(),
    );
    expect(links.map((l) => l.playerId)).toEqual([lindor]);
    // 3. the disagreement is settled.
    expect(c.sourceDisagreements![0].chosen).toEqual({ value: [CPC], by: "operator" });
    // 4. the card's own player stays empty, and the picked name is answered
    //    "not a player" in the same call: nothing is left pending.
    expect(c.playerIds).toBeUndefined();
    expect(c.pendingPlayerNames).toBeUndefined();
    const rows = await t.run((ctx) => ctx.db.query("tidyNames").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      nameNormalized: normalizeEntityName(CPC),
      answer: { kind: "notEntity", by: "operator" },
    });
    // 5. the title and description are rebuilt, with the cameo in them and
    //    without the ruled-out name.
    expect(c.listingTitle).not.toBe("Typed by hand");
    expect(c.listingTitle).toContain("Lindor");
    expect(c.listingTitle).not.toContain(CPC);
    expect(c.listingDescription).toContain(LINDOR);
  });

  test("keeps the cameos the card already had", async () => {
    const t = newT();
    const { card, lindor, w } = await setup(t);
    const soto = await t.run((ctx) => addPlayer(ctx, w, "Juan Soto"));
    await t.run((ctx) => ctx.db.patch(card, { secondaryPlayerIds: [soto] }));
    await t.withIdentity(ADMIN).mutation(api.tidyCameo.pickSourceAsCameo, { cardId: card });
    expect((await get(t, card))!.secondaryPlayerIds).toEqual([soto, lindor]);
  });

  test("one click finishes the card: the cameo, no main player, and nothing to stop on", async () => {
    const t = newT();
    const { card, lindor } = await setup(t);
    await t.withIdentity(ADMIN).mutation(api.tidyCameo.pickSourceAsCameo, { cardId: card });
    const c = (await get(t, card))!;
    expect(c.playerIds).toBeUndefined();
    expect(c.secondaryPlayerIds).toEqual([lindor]);
    expect(deriveCardAttention(c).items).toEqual([]);
  });

  test("the not-a-player answer fans out to the other cards that print that exact name", async () => {
    const t = newT();
    const { card, w } = await setup(t);
    const other = await t.run((ctx) =>
      printCard(ctx, w, {
        number: "8",
        printed: [{ kind: "player", name: CPC }],
        extra: { cardName: CPC },
      }),
    );
    await t.withIdentity(ADMIN).mutation(api.tidyCameo.pickSourceAsCameo, { cardId: card });
    await drainScheduled(t);
    const o = (await get(t, other))!;
    expect(o.pendingPlayerNames).toBeUndefined();
    expect(o.playerIds).toBeUndefined();
  });

  test("answering the pending name 'not a player' leaves a card with no player and nothing to stop on", async () => {
    const t = newT();
    const { card } = await setup(t);
    await t.withIdentity(ADMIN).mutation(api.tidyCameo.pickSourceAsCameo, { cardId: card });
    await t.withIdentity(ADMIN).mutation(api.tidyNames.answerName, {
      cardId: card,
      kind: "player",
      name: CPC,
      answer: { kind: "notEntity" },
    });
    const c = (await get(t, card))!;
    expect(c.playerIds).toBeUndefined();
    expect(c.pendingPlayerNames).toBeUndefined();
    expect(c.secondaryPlayerIds).toHaveLength(1);
    expect(deriveCardAttention(c).items).toEqual([]);
    // The title still names the cameo, and no longer the ruled-out name.
    expect(c.listingTitle).toContain("Lindor");
    expect(c.listingTitle).not.toContain(CPC);
  });

  test("refused when the server would not offer it; nothing is written", async () => {
    const t = newT();
    const { card } = await setup(t, entry([CPC], ["Hopping to It CPC"]));
    await expect(
      t.withIdentity(ADMIN).mutation(api.tidyCameo.pickSourceAsCameo, { cardId: card }),
    ).rejects.toThrow(/no cameo to offer/);
    const c = (await get(t, card))!;
    expect(c.sourceDisagreements![0].chosen).toBeUndefined();
    expect(c.secondaryPlayerIds).toBeUndefined();
  });

  test("a full cameo list refuses the whole write: the pick is not half done", async () => {
    const t = newT();
    const { card, w } = await setup(t);
    const ids = await t.run(async (ctx) => {
      const out: Id<"players">[] = [];
      for (let i = 0; i < 20; i++) out.push(await addPlayer(ctx, w, `Cameo Person${String.fromCharCode(97 + i)}`));
      return out;
    });
    await t.run((ctx) => ctx.db.patch(card, { secondaryPlayerIds: ids }));
    await expect(
      t.withIdentity(ADMIN).mutation(api.tidyCameo.pickSourceAsCameo, { cardId: card }),
    ).rejects.toThrow();
    const c = (await get(t, card))!;
    expect(c.sourceDisagreements![0].chosen).toBeUndefined();
    expect(c.cardName).toBe(LINDOR);
  });
});

// NEO-645 — a player a walk write makes the card's own is taken out of its cameos
// in the same write; the title and description are built without the cameo.
describe("a cameo who becomes the card's player stops being a cameo", () => {
  const TYPED = "Typed by hand, out of date";

  /** A card with the player as a cameo (field and index row) and a typed title. */
  async function withCameo(t: T, values: Entry = entry([CPC], [LINDOR]), extra: Record<string, unknown> = {}) {
    const s = await setup(t, values, { listingTitle: TYPED, ...extra });
    await t.run(async (ctx) => {
      await ctx.db.patch(s.card, { secondaryPlayerIds: [s.lindor] });
      await ctx.db.insert("cardSecondaryPlayerLinks", {
        cardChecklistId: s.card,
        playerId: s.lindor,
        sportId: s.w.sport,
      });
    });
    return s;
  }

  const cameoRows = (t: T, cardId: Id<"cardChecklist">) =>
    t.run((ctx) =>
      ctx.db
        .query("cardSecondaryPlayerLinks")
        .withIndex("by_card", (q) => q.eq("cardChecklistId", cardId))
        .collect(),
    );

  /** The title as the generator builds it for the card as stored now. */
  async function expectRebuilt(t: T, cardId: Id<"cardChecklist">, lindor: Id<"players">) {
    const c = (await get(t, cardId))!;
    expect(c.playerIds).toEqual([lindor]);
    expect(c.secondaryPlayerIds).toBeUndefined();
    expect(await cameoRows(t, cardId)).toEqual([]);
    expect(c.listingTitle).not.toBe(TYPED);
    expect(c.listingTitle).toContain("Lindor");
    // Named once, as the card's player; the description has no cameo line.
    expect(c.listingTitle!.match(/Lindor/g)).toHaveLength(1);
    expect(c.listingDescription).toContain(LINDOR);
    expect(c.listingDescription).not.toContain("Cameo");
    return c;
  }

  test("pickSourceValue taking the cameo's own name as the player", async () => {
    const t = newT();
    const { card, lindor } = await withCameo(t);
    await t
      .withIdentity(ADMIN)
      .mutation(api.tidyCards.pickSourceValue, { cardId: card, field: "players", value: [LINDOR] });
    await expectRebuilt(t, card, lindor);
  });

  test("answerName linking the card's printed name to the cameo", async () => {
    const t = newT();
    const { lindor, w } = await withCameo(t);
    const card = await t.run(async (ctx) => {
      await nameRow(ctx, {
        scopeId: w.base,
        sportId: w.sport,
        kind: "player",
        name: CPC,
        over: { answerGen: 0 },
      });
      const id = await printCard(ctx, w, {
        number: "9",
        printed: [{ kind: "player", name: CPC }],
        extra: { teamOnCardIds: [w.mets], listingTitle: TYPED, secondaryPlayerIds: [lindor] },
      });
      await ctx.db.insert("cardSecondaryPlayerLinks", {
        cardChecklistId: id,
        playerId: lindor,
        sportId: w.sport,
      });
      return id;
    });
    await t.withIdentity(ADMIN).mutation(api.tidyNames.answerName, {
      cardId: card,
      kind: "player",
      name: CPC,
      answer: { kind: "linkPlayer", playerId: lindor },
    });
    await drainScheduled(t);
    await expectRebuilt(t, card, lindor);
  });

  test("updateCard with playerIds and the walk's flag", async () => {
    const t = newT();
    const { card, lindor } = await withCameo(t);
    await t.withIdentity(ADMIN).mutation(api.selectorOptions.updateCard, {
      id: card,
      playerIds: [lindor],
      regenerateListing: true,
    });
    await expectRebuilt(t, card, lindor);
    // The player-links index follows the write (unchanged by the cameo drop).
    const own = await t.run((ctx) =>
      ctx.db
        .query("cardPlayerLinks")
        .withIndex("by_card", (q) => q.eq("cardChecklistId", card))
        .collect(),
    );
    expect(own.map((r) => r.playerId)).toEqual([lindor]);
  });

  test("a cameo who is NOT the new player is kept", async () => {
    const t = newT();
    const { card, lindor, w } = await withCameo(t);
    const soto = await t.run((ctx) => addPlayer(ctx, w, "Juan Soto"));
    await t.withIdentity(ADMIN).mutation(api.selectorOptions.updateCard, {
      id: card,
      playerIds: [soto],
      regenerateListing: true,
    });
    const c = (await get(t, card))!;
    expect(c.playerIds).toEqual([soto]);
    expect(c.secondaryPlayerIds).toEqual([lindor]);
    expect((await cameoRows(t, card)).map((r) => r.playerId)).toEqual([lindor]);
  });
});
