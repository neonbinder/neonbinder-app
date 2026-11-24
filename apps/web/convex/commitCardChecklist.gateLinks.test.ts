/**
 * NEO-656 — the live sections of the retired `commitCardChecklist.entityReview`
 * suite, on the new inputs.
 *
 * The review wizard, its queue rows and its skips are gone. What the commit
 * still takes from the gate is `gateLinks` (rules A / D / 6b / F, re-checked at
 * commit by `checkGateLinks`) and `gateTeamNames` (the team names the gate
 * raised). Everything else a name can get is a fact the commit derives itself:
 * one same-name player links, two or none stay pending, an unresolved team is
 * never invented. Nothing here is stored as an answer.
 *
 * Removed with the wizard and not ported: create / skip decisions, batch
 * cleanup, skip slices (`findSkippedEntityNames`), "retired by a skip", and the
 * walk's own rulings (pinned in the `tidy*` suites).
 */

import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { MAX_CARD_PLAYERS, MAX_CARD_TEAMS } from "./features/cardAttention";
import { MAX_CARD_NUMBER_LENGTH } from "./selectorOptions";
import { normalizePlayerName } from "./players";
import { normalizeTeamName } from "./teams";
import { insertTestCard } from "../lib/testing/card-row";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

type T = ReturnType<typeof convexTest>;
type Sel = Id<"selectorOptions">;

const ADMIN_IDENTITY = {
  subject: "admin_gate_links_001",
  issuer: "https://clerk.example.com",
  tokenIdentifier: "clerk|admin_gate_links_001",
  name: "Admin User",
  role: "admin",
};
const OTHER_ADMIN = {
  ...ADMIN_IDENTITY,
  subject: "admin_gate_links_002",
  tokenIdentifier: "clerk|admin_gate_links_002",
};

async function seedVariantTypeUnderChromeSet(t: T) {
  return t.run(async (ctx) => {
    const sportId = await ctx.db.insert("selectorOptions", {
      level: "sport",
      value: "Baseball",
      platformData: {},
      children: [],
      lastUpdated: Date.now(),
    });
    const setNameId = await ctx.db.insert("selectorOptions", {
      level: "setName",
      value: "Chrome",
      platformData: {},
      features: { manufacturer: "Topps", season: "2024" },
      parentId: sportId,
      children: [],
      lastUpdated: Date.now(),
    });
    await ctx.db.patch(sportId, { children: [setNameId] });
    const variantTypeId = await ctx.db.insert("selectorOptions", {
      level: "variantType",
      value: "Base",
      platformData: {},
      features: { manufacturer: "Topps", season: "2024" },
      parentId: setNameId,
      children: [],
      lastUpdated: Date.now(),
    });
    await ctx.db.patch(setNameId, { children: [variantTypeId] });
    return { sportId, setNameId, variantTypeId };
  });
}

function makeCard(
  overrides: Partial<{
    cardNumber: string;
    cardName: string;
    players: string[];
    teams: string[];
  }> = {},
) {
  return {
    cardNumber: overrides.cardNumber ?? "1",
    cardName: overrides.cardName ?? "Card",
    team: undefined,
    teams: overrides.teams ?? [],
    players: overrides.players ?? [],
    attributes: [],
    isRookie: false,
    isRelic: false,
    printRun: undefined,
    autographType: undefined,
    cardVariation: undefined,
    platformData: {},
    unmatched: undefined,
  };
}

async function readCards(t: T, selectorOptionId: Sel) {
  return t.run((ctx) =>
    ctx.db
      .query("cardChecklist")
      .withIndex("by_selector_option", (q) => q.eq("selectorOptionId", selectorOptionId))
      .collect(),
  );
}

function insertPlayer(
  t: T,
  sportId: Sel,
  name: string,
  extra: { birthYear?: number } = {},
): Promise<Id<"players">> {
  return t.run((ctx) =>
    ctx.db.insert("players", {
      name,
      nameNormalized: normalizePlayerName(name),
      sportId,
      lastUpdated: Date.now(),
      ...extra,
    }),
  );
}

function insertSport(t: T, value: string): Promise<Sel> {
  return t.run((ctx) =>
    ctx.db.insert("selectorOptions", {
      level: "sport",
      value,
      platformData: {},
      children: [],
      lastUpdated: Date.now(),
    }),
  );
}

type Commit = {
  selectorOptionId: Sel;
  sportId: Sel;
  cards: ReturnType<typeof makeCard>[];
  gateLinks?: Array<
    | { kind: "player"; name: string; playerId: Id<"players">; origin: "setHistory" | "hallOfFame" | "careerTeam" }
    | { kind: "team"; name: string; teamId: Id<"teams">; origin: "setHistory" | "hallOfFame" | "careerTeam" }
  >;
  gateTeamNames?: string[];
};
const commitWith = (t: T, args: Commit) =>
  t.withIdentity(ADMIN_IDENTITY).action(api.selectorOptions.commitCardChecklist, args);

// ===========================================================================
// A gate link uses the linked id and creates no duplicate
// ===========================================================================

describe("commitCardChecklist: a gate link resolves to the existing row, no duplicate inserted", () => {
  test("a player link uses playerId directly — no new player row is created", async () => {
    const t = convexTest(schema, modules);
    const { variantTypeId, sportId } = await seedVariantTypeUnderChromeSet(t);
    const real = await t.run((ctx) =>
      ctx.db.insert("players", {
        name: "Ken Griffey Jr.",
        nameNormalized: "griffey jr ken",
        sportId,
        lastUpdated: Date.now(),
      }),
    );

    await commitWith(t, {
      selectorOptionId: variantTypeId,
      sportId,
      cards: [makeCard({ players: ["Ken Griffey Junior"] })],
      gateLinks: [
        { kind: "player", name: "Ken Griffey Junior", playerId: real, origin: "setHistory" },
      ],
    });

    const all = await t.run((ctx) => ctx.db.query("players").collect());
    expect(all.map((p) => p._id)).toEqual([real]);
    expect((await readCards(t, variantTypeId))[0].playerIds).toEqual([real]);
  });

  test("a team link uses teamId directly — no new team row is created", async () => {
    const t = convexTest(schema, modules);
    const { variantTypeId, sportId } = await seedVariantTypeUnderChromeSet(t);
    const real = await t.run((ctx) =>
      ctx.db.insert("teams", {
        name: "Los Angeles Angels",
        nameNormalized: "angeles angels los",
        sportId,
        lastUpdated: Date.now(),
      }),
    );

    await commitWith(t, {
      selectorOptionId: variantTypeId,
      sportId,
      cards: [makeCard({ teams: ["LA Angels of Anaheim"] })],
      gateLinks: [
        { kind: "team", name: "LA Angels of Anaheim", teamId: real, origin: "setHistory" },
      ],
    });

    const all = await t.run((ctx) => ctx.db.query("teams").collect());
    expect(all.map((x) => x._id)).toEqual([real]);
    expect((await readCards(t, variantTypeId))[0].teamOnCardIds).toEqual([real]);
  });
});

// ===========================================================================
// An unresolved team is reported, never invented
// ===========================================================================

describe("commitCardChecklist: an unresolvable team name is reported, never invented", () => {
  test("a team name nobody linked creates nothing, links nothing, and comes back in unresolvedTeamNames", async () => {
    const t = convexTest(schema, modules);
    const { variantTypeId, sportId } = await seedVariantTypeUnderChromeSet(t);

    const prelude = await t.withIdentity(ADMIN_IDENTITY).mutation(internal.selectorOptions.commitCardChecklistPrelude, {
      selectorOptionId: variantTypeId,
      sportId,
      playerNames: [],
      teamNames: ["Wichita Wind Surge"],
    });

    expect(prelude.teamIdByName).toEqual([]);
    expect(prelude.createdTeamIds).toEqual([]);
    expect(prelude.unresolvedTeamNames).toEqual(["Wichita Wind Surge"]);
    expect(prelude.unresolvedTeamCount).toBe(1);
    expect(await t.run((ctx) => ctx.db.query("teams").collect())).toEqual([]);
  });

  test("unresolvedTeamNames is capped at 200 while unresolvedTeamCount stays true", async () => {
    const t = convexTest(schema, modules);
    const { variantTypeId, sportId } = await seedVariantTypeUnderChromeSet(t);
    const teamNames = Array.from({ length: 260 }, (_, i) => `Unknown Ballclub ${i}`);

    const prelude = await t.withIdentity(ADMIN_IDENTITY).mutation(internal.selectorOptions.commitCardChecklistPrelude, {
      selectorOptionId: variantTypeId,
      sportId,
      playerNames: [],
      teamNames,
    });

    expect(prelude.unresolvedTeamCount).toBe(260);
    expect(prelude.unresolvedTeamNames).toHaveLength(200);
    expect(new Set(prelude.unresolvedTeamNames).size).toBe(200);
    expect(await t.run((ctx) => ctx.db.query("teams").collect())).toEqual([]);
  });

  test("an unresolved team leaves the CARD without a team id, and the name pending", async () => {
    const t = convexTest(schema, modules);
    const { variantTypeId, sportId } = await seedVariantTypeUnderChromeSet(t);

    await commitWith(t, {
      selectorOptionId: variantTypeId,
      sportId,
      cards: [makeCard({ teams: ["Wichita Wind Surge"] })],
    });

    const [card] = await readCards(t, variantTypeId);
    expect(card.teamOnCardIds ?? []).toEqual([]);
    expect(card.pendingTeamNames).toEqual(["Wichita Wind Surge"]);
    expect(await t.run((ctx) => ctx.db.query("teams").collect())).toEqual([]);
  });
});

// ===========================================================================
// Unreviewed names are stamped on the card and counted
// ===========================================================================

describe("commitCardChecklist: unreviewed names", () => {
  test("a player name nobody linked is stamped on the card and counted in the return", async () => {
    const t = convexTest(schema, modules);
    const { variantTypeId, sportId } = await seedVariantTypeUnderChromeSet(t);

    const result = await commitWith(t, {
      selectorOptionId: variantTypeId,
      sportId,
      cards: [
        makeCard({ cardNumber: "1", players: ["Never Reviewed"] }),
        makeCard({ cardNumber: "2", players: [] }),
      ],
    });

    expect(result.success).toBe(true);
    expect(result.count).toBe(2);
    expect(result.unreviewedNameCount).toBe(1);
    const cards = await readCards(t, variantTypeId);
    const one = cards.find((c) => c.cardNumber === "1")!;
    expect(one.pendingPlayerNames).toEqual(["Never Reviewed"]);
    expect(one.playerIds ?? []).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("players").collect())).toHaveLength(0);
    expect(cards.find((c) => c.cardNumber === "2")!.pendingPlayerNames).toBeUndefined();
  });

  test("a team name nobody linked is stamped the same way", async () => {
    const t = convexTest(schema, modules);
    const { variantTypeId, sportId } = await seedVariantTypeUnderChromeSet(t);

    const result = await commitWith(t, {
      selectorOptionId: variantTypeId,
      sportId,
      cards: [makeCard({ teams: ["Reno Aces"] })],
      gateTeamNames: ["Reno Aces"],
    });

    expect(result.unreviewedNameCount).toBe(1);
    const [card] = await readCards(t, variantTypeId);
    expect(card.pendingTeamNames).toEqual(["Reno Aces"]);
    expect(card.teamOnCardIds ?? []).toEqual([]);
  });

  test("a re-sync does NOT drop a name typed on the card that this commit said nothing about", async () => {
    const t = convexTest(schema, modules);
    const { variantTypeId, sportId } = await seedVariantTypeUnderChromeSet(t);
    const handAdded = await t.run((ctx) =>
      insertTestCard(ctx, {
        selectorOptionId: variantTypeId,
        cardNumber: "1",
        cardName: "Hand added",
        pendingPlayerNames: ["Operator Typed"],
        platformData: {},
        sortOrder: 0,
        lastUpdated: Date.now(),
      }),
    );

    await commitWith(t, {
      selectorOptionId: variantTypeId,
      sportId,
      cards: [makeCard({ cardNumber: "1", players: ["Never Reviewed"] })],
    });

    const row = await t.run((ctx) => ctx.db.get(handAdded));
    expect(row!.pendingPlayerNames).toEqual(["Operator Typed", "Never Reviewed"]);
  });

  test("the count is what was STAMPED, not every name the prelude could not resolve", async () => {
    const t = convexTest(schema, modules);
    const { variantTypeId, sportId } = await seedVariantTypeUnderChromeSet(t);
    await t.run((ctx) =>
      insertTestCard(ctx, {
        selectorOptionId: variantTypeId,
        cardNumber: "9001",
        cardName: "Hand added, not in this sync",
        pendingPlayerNames: ["Folded In From Another Card"],
        platformData: {},
        sortOrder: 0,
        lastUpdated: Date.now(),
      }),
    );

    const result = await commitWith(t, {
      selectorOptionId: variantTypeId,
      sportId,
      cards: [makeCard({ cardNumber: "1", players: ["On An Incoming Card"] })],
    });

    expect(result.unreviewedNameCount).toBe(1);
    const cards = await readCards(t, variantTypeId);
    expect(cards.find((c) => c.cardNumber === "1")!.pendingPlayerNames).toEqual([
      "On An Incoming Card",
    ]);
    expect(cards.find((c) => c.cardNumber === "9001")!.pendingPlayerNames).toEqual([
      "Folded In From Another Card",
    ]);
  });

  test("a re-sync that changes nothing writes nothing but the timestamp", async () => {
    const t = convexTest(schema, modules);
    const { variantTypeId, sportId } = await seedVariantTypeUnderChromeSet(t);
    const commit = () =>
      commitWith(t, {
        selectorOptionId: variantTypeId,
        sportId,
        cards: [makeCard({ players: ["Still Unreviewed"] })],
      });

    await commit();
    const before = (await readCards(t, variantTypeId))[0];
    expect(before.pendingPlayerNames).toEqual(["Still Unreviewed"]);
    await commit();

    const after = (await readCards(t, variantTypeId))[0];
    expect(after._id).toBe(before._id);
    expect({ ...after, lastUpdated: 0 }).toEqual({ ...before, lastUpdated: 0 });
  });
});

// ===========================================================================
// NEO-254 — an ambiguous name is never resolved by the index
// ===========================================================================

describe("NEO-254: an ambiguous player name is never resolved by the index", () => {
  test("exactly ONE existing row is adopted silently", async () => {
    const t = convexTest(schema, modules);
    const { variantTypeId, sportId } = await seedVariantTypeUnderChromeSet(t);
    const only = await insertPlayer(t, sportId, "Tony Gwynn");

    await commitWith(t, {
      selectorOptionId: variantTypeId,
      sportId,
      cards: [makeCard({ players: ["Tony Gwynn"] })],
    });

    expect((await readCards(t, variantTypeId))[0].playerIds).toEqual([only]);
    expect(await t.run((ctx) => ctx.db.query("players").collect())).toHaveLength(1);
  });

  test("TWO existing rows and no gate link links NOTHING and reports the name", async () => {
    const t = convexTest(schema, modules);
    const { variantTypeId, sportId } = await seedVariantTypeUnderChromeSet(t);
    await insertPlayer(t, sportId, "Bob Allen", { birthYear: 1867 });
    await insertPlayer(t, sportId, "Bob Allen", { birthYear: 1937 });

    const result = await commitWith(t, {
      selectorOptionId: variantTypeId,
      sportId,
      cards: [makeCard({ players: ["Bob Allen"] })],
    });

    expect(result.success).toBe(true);
    expect(result.unreviewedNameCount).toBe(1);
    const [card] = await readCards(t, variantTypeId);
    expect(card.playerIds ?? []).toEqual([]);
    expect(card.pendingPlayerNames).toEqual(["Bob Allen"]);
    expect(await t.run((ctx) => ctx.db.query("players").collect())).toHaveLength(2);
  });

  test("a gate link names which of the two, and that one is used", async () => {
    const t = convexTest(schema, modules);
    const { variantTypeId, sportId } = await seedVariantTypeUnderChromeSet(t);
    const older = await insertPlayer(t, sportId, "Bob Allen", { birthYear: 1867 });
    const younger = await insertPlayer(t, sportId, "Bob Allen", { birthYear: 1937 });

    await commitWith(t, {
      selectorOptionId: variantTypeId,
      sportId,
      cards: [makeCard({ players: ["Bob Allen"] })],
      gateLinks: [
        {
          kind: "player",
          name: "Bob Allen",
          playerId: younger,
          origin: "setHistory",
        },
      ],
    });

    const [card] = await readCards(t, variantTypeId);
    expect(card.playerIds).toEqual([younger]);
    expect(card.playerIds).not.toContain(older);
    expect(await t.run((ctx) => ctx.db.query("players").collect())).toHaveLength(2);
  });
});

describe("NEO-332: resolveChecklistEntities reports the names that are a pick, not a create", () => {
  const resolveFor = (t: T, selectorOptionId: Sel, sportId: Sel, names: string[]) =>
    t.withIdentity(ADMIN_IDENTITY).action(api.selectorOptions.resolveChecklistEntities, {
      selectorOptionId,
      sportId,
      cards: [makeCard({ players: names })],
    });

  test("a brand-new name is unknown but not ambiguous", async () => {
    const t = convexTest(schema, modules);
    const { variantTypeId, sportId } = await seedVariantTypeUnderChromeSet(t);

    const resolved = await resolveFor(t, variantTypeId, sportId, ["Daulton Varsho"]);

    expect(resolved.unknownPlayers).toEqual(["Daulton Varsho"]);
    expect(resolved.ambiguousPlayers).toEqual([]);
  });

  test("exactly one existing row is neither unknown nor ambiguous", async () => {
    const t = convexTest(schema, modules);
    const { variantTypeId, sportId } = await seedVariantTypeUnderChromeSet(t);
    await insertPlayer(t, sportId, "Tony Gwynn");

    const resolved = await resolveFor(t, variantTypeId, sportId, ["Tony Gwynn"]);

    expect(resolved.unknownPlayers).toEqual([]);
    expect(resolved.ambiguousPlayers).toEqual([]);
  });

  test("two rows narrowed to one by the card's year are resolved, so not ambiguous", async () => {
    const t = convexTest(schema, modules);
    const { variantTypeId, sportId } = await seedVariantTypeUnderChromeSet(t);
    const team = await t.run((ctx) =>
      ctx.db.insert("teams", {
        location: "Chicago",
        name: "Cubs",
        nameNormalized: "chicago cubs",
        sportId,
        lastUpdated: Date.now(),
      }),
    );
    await t.run(async (ctx) => {
      for (const [fromYear, toYear] of [
        [2020, 2026],
        [1890, 1894],
      ]) {
        await ctx.db.insert("players", {
          name: "Bob Allen",
          nameNormalized: "allen bob",
          sportId,
          teamYears: [{ teamId: team, fromYear, toYear }],
          lastUpdated: Date.now(),
        });
      }
    });

    const resolved = await resolveFor(t, variantTypeId, sportId, ["Bob Allen"]);

    expect(resolved.unknownPlayers).toEqual([]);
    expect(resolved.ambiguousPlayers).toEqual([]);
  });

  test("only the ambiguous name is listed when a card carries an ambiguous and a new one", async () => {
    const t = convexTest(schema, modules);
    const { variantTypeId, sportId } = await seedVariantTypeUnderChromeSet(t);
    await insertPlayer(t, sportId, "Bob Allen");
    await insertPlayer(t, sportId, "Bob Allen");

    const resolved = await resolveFor(t, variantTypeId, sportId, ["Bob Allen", "Daulton Varsho"]);

    expect([...resolved.unknownPlayers].sort()).toEqual(["Bob Allen", "Daulton Varsho"]);
    expect(resolved.ambiguousPlayers).toEqual(["Bob Allen"]);
  });
});

// ===========================================================================
// NEO-254 — a gate link is re-validated at commit
// ===========================================================================

describe("NEO-254: a gate link is re-validated at commit", () => {
  test("a linked player deleted since the gate leaves the card unlinked and reports the name", async () => {
    const t = convexTest(schema, modules);
    const { variantTypeId, sportId } = await seedVariantTypeUnderChromeSet(t);
    const doomed = await insertPlayer(t, sportId, "Bob Allen");
    await t.run((ctx) => ctx.db.delete(doomed));

    const result = await commitWith(t, {
      selectorOptionId: variantTypeId,
      sportId,
      cards: [makeCard({ players: ["Bob Allen"] })],
      gateLinks: [{ kind: "player", name: "Bob Allen", playerId: doomed, origin: "setHistory" }],
    });

    expect(result.success).toBe(true);
    expect(result.unreviewedNameCount).toBe(1);
    const [card] = await readCards(t, variantTypeId);
    expect(card.playerIds ?? []).toEqual([]);
    expect(card.pendingPlayerNames).toEqual(["Bob Allen"]);
  });

  test("a SET-HISTORY link to a player of ANOTHER sport is a guest link: kept, its sport read off the player's own document", async () => {
    // NEO-656: `checkGateLinks` takes the sport from the player's row, never
    // from the client. Only a set-history link may cross sports (the set's own
    // earlier commit vouches for it); any other origin must play the set's
    // sport (S2, pinned in "checkGateLinks refuses ...").
    const t = convexTest(schema, modules);
    const { variantTypeId, sportId } = await seedVariantTypeUnderChromeSet(t);
    const football = await insertSport(t, "Football");
    const guest = await insertPlayer(t, football, "Bob Allen");

    const result = await commitWith(t, {
      selectorOptionId: variantTypeId,
      sportId,
      cards: [makeCard({ players: ["Bob Allen"] })],
      gateLinks: [{ kind: "player", name: "Bob Allen", playerId: guest, origin: "setHistory" }],
    });

    expect(result.unreviewedNameCount).toBe(0);
    expect((await readCards(t, variantTypeId))[0].playerIds).toEqual([guest]);
  });

  test("a live linked player is still used", async () => {
    const t = convexTest(schema, modules);
    const { variantTypeId, sportId } = await seedVariantTypeUnderChromeSet(t);
    const live = await insertPlayer(t, sportId, "Bob Allen");

    const result = await commitWith(t, {
      selectorOptionId: variantTypeId,
      sportId,
      cards: [makeCard({ players: ["bob allen"] })],
      gateLinks: [{ kind: "player", name: "bob allen", playerId: live, origin: "setHistory" }],
    });

    expect(result.unreviewedNameCount).toBe(0);
    expect((await readCards(t, variantTypeId))[0].playerIds).toEqual([live]);
  });
});

// ===========================================================================
// NEO-246 / NEO-251 / NEO-602 — pending-name bounds
// ===========================================================================

describe("commitCardChecklist: pending-name bounds (NEO-246, NEO-251)", () => {
  test("a card carrying more players than the cap is REFUSED, and nothing is written", async () => {
    const t = convexTest(schema, modules);
    const { variantTypeId, sportId } = await seedVariantTypeUnderChromeSet(t);
    const names = Array.from(
      { length: MAX_CARD_PLAYERS + 5 },
      (_, i) => `Unknown Player ${String(i).padStart(2, "0")}`,
    );

    await expect(
      commitWith(t, {
        selectorOptionId: variantTypeId,
        sportId,
        cards: [makeCard({ players: names })],
      }),
    ).rejects.toThrow(
      new RegExp(
        `card #1 carries ${MAX_CARD_PLAYERS + 5} players, above the ${MAX_CARD_PLAYERS}-player limit`,
      ),
    );
    expect(await readCards(t, variantTypeId)).toHaveLength(0);
  });

  test("an over-long name is REFUSED, and the message does not echo it", async () => {
    const t = convexTest(schema, modules);
    const { variantTypeId, sportId } = await seedVariantTypeUnderChromeSet(t);
    const essay = "z".repeat(121);

    const err = await commitWith(t, {
      selectorOptionId: variantTypeId,
      sportId,
      cards: [makeCard({ players: ["Real Unknown", essay] })],
    }).then(
      () => {
        throw new Error("expected the commit to refuse the over-long name");
      },
      (e: unknown) => e as Error,
    );

    expect(err.message).toMatch(/carries a player name of 121 characters; the limit is 120\./);
    expect(err.message).not.toContain(essay);
    expect(await readCards(t, variantTypeId)).toHaveLength(0);
  });

  test("an over-long card NUMBER is REFUSED by position, and the message does not echo it (NEO-602)", async () => {
    const t = convexTest(schema, modules);
    const { variantTypeId, sportId } = await seedVariantTypeUnderChromeSet(t);
    const longNumber = "9".repeat(MAX_CARD_NUMBER_LENGTH + 1);

    const err = await commitWith(t, {
      selectorOptionId: variantTypeId,
      sportId,
      cards: [makeCard({ cardNumber: longNumber, players: ["Real Unknown"] })],
    }).then(
      () => {
        throw new Error("expected the commit to refuse the over-long number");
      },
      (e: unknown) => e as Error,
    );

    expect(err.message).toContain(
      `card at index 0 carries a card number of ${MAX_CARD_NUMBER_LENGTH + 1} characters; the limit is ${MAX_CARD_NUMBER_LENGTH}.`,
    );
    expect(err.message).not.toContain(longNumber);
    expect(await readCards(t, variantTypeId)).toHaveLength(0);

    await expect(
      commitWith(t, {
        selectorOptionId: variantTypeId,
        sportId,
        cards: [makeCard({ cardNumber: "9".repeat(MAX_CARD_NUMBER_LENGTH) })],
      }),
    ).resolves.not.toThrow();
  });

  test("the TEAM side is refused by its own, narrower cap", async () => {
    const t = convexTest(schema, modules);
    const { variantTypeId, sportId } = await seedVariantTypeUnderChromeSet(t);
    const teams = Array.from({ length: MAX_CARD_TEAMS + 3 }, (_, i) => `Unknown Team ${i}`);

    await expect(
      commitWith(t, { selectorOptionId: variantTypeId, sportId, cards: [makeCard({ teams })] }),
    ).rejects.toThrow(
      new RegExp(`card #1 carries ${MAX_CARD_TEAMS + 3} teams, above the ${MAX_CARD_TEAMS}-team limit`),
    );
    expect(await readCards(t, variantTypeId)).toHaveLength(0);
  });

  test("a full-cap card commits, and the stored list is one the walker's fixer can then save", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { variantTypeId, sportId } = await seedVariantTypeUnderChromeSet(t);
    const names = Array.from(
      { length: MAX_CARD_PLAYERS },
      (_, i) => `Unknown Player ${String(i).padStart(2, "0")}`,
    );

    const result = await commitWith(t, {
      selectorOptionId: variantTypeId,
      sportId,
      cards: [makeCard({ players: names })],
    });
    expect(result.success).toBe(true);
    expect(result.count).toBe(1);

    const [card] = await readCards(t, variantTypeId);
    const stored = card.pendingPlayerNames!;
    expect(stored).toEqual(names);
    expect(result.unreviewedNameCount).toBe(MAX_CARD_PLAYERS);
    expect(result.droppedPendingNameCount).toBe(0);

    await expect(
      asAdmin.mutation(api.selectorOptions.updateCard, {
        id: card._id,
        playerIds: [],
        teamOnCardIds: [],
        pendingPlayerNames: stored,
        pendingTeamNames: [],
      }),
    ).resolves.toBeNull();
    expect((await t.run((ctx) => ctx.db.get(card._id)))!.pendingPlayerNames).toEqual(stored);
  });

  test("a stored backlog plus a freshly stamped list that together exceed the cap is a DROP, not a refusal", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { variantTypeId, sportId } = await seedVariantTypeUnderChromeSet(t);
    const stored = Array.from({ length: 15 }, (_, i) => `Backlog ${String(i).padStart(2, "0")}`);
    const stamped = Array.from({ length: 10 }, (_, i) => `Freshly Found ${String(i).padStart(2, "0")}`);
    expect(stored.length + stamped.length).toBeGreaterThan(MAX_CARD_PLAYERS);

    await commitWith(t, {
      selectorOptionId: variantTypeId,
      sportId,
      cards: [makeCard({ players: stored })],
    });
    const result = await commitWith(t, {
      selectorOptionId: variantTypeId,
      sportId,
      cards: [makeCard({ players: stamped })],
    });

    expect(result.success).toBe(true);
    expect(result.unreviewedNameCount).toBe(5);
    expect(result.droppedPendingNameCount).toBe(5);
    expect(result.unreviewedNameCount + result.droppedPendingNameCount).toBe(stamped.length);

    const [merged] = await readCards(t, variantTypeId);
    expect(merged.pendingPlayerNames).toEqual([...stored, ...stamped].slice(0, MAX_CARD_PLAYERS));
    await expect(
      asAdmin.mutation(api.selectorOptions.updateCard, {
        id: merged._id,
        pendingPlayerNames: merged.pendingPlayerNames!,
      }),
    ).resolves.toBeNull();
  });

  test("a row stamped over the cap before this landed is REPAIRED by the next commit, keeping the names it already had", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { variantTypeId, sportId } = await seedVariantTypeUnderChromeSet(t);

    await commitWith(t, {
      selectorOptionId: variantTypeId,
      sportId,
      cards: [makeCard({ players: ["Seed Name"] })],
    });
    const legacyNames = Array.from(
      { length: MAX_CARD_PLAYERS + 5 },
      (_, i) => `Legacy ${String(i).padStart(2, "0")}`,
    );
    const [seeded] = await readCards(t, variantTypeId);
    await t.run((ctx) => ctx.db.patch(seeded._id, { pendingPlayerNames: legacyNames }));

    const repair = await commitWith(t, {
      selectorOptionId: variantTypeId,
      sportId,
      cards: [makeCard({ players: ["Freshly Found"] })],
    });

    expect(repair.droppedPendingNameCount).toBe(6);
    expect(repair.unreviewedNameCount).toBe(0);
    const [repaired] = await readCards(t, variantTypeId);
    expect(repaired.pendingPlayerNames).toEqual(legacyNames.slice(0, MAX_CARD_PLAYERS));
    expect(repaired.pendingPlayerNames).not.toContain("Freshly Found");
    await expect(
      asAdmin.mutation(api.selectorOptions.updateCard, {
        id: repaired._id,
        pendingPlayerNames: repaired.pendingPlayerNames!,
      }),
    ).resolves.toBeNull();
  });
});

// ===========================================================================
// NEO-296 — two spellings of one name commit to ONE player
// ===========================================================================

describe("two spellings of one name commit to ONE player row (NEO-296)", () => {
  const ACCENTED = "José Ramírez";
  const PLAIN = "Jose Ramirez";

  test("the two spellings share one normalized key — the premise of the fold", () => {
    expect(normalizePlayerName(ACCENTED)).toBe(normalizePlayerName(PLAIN));
    expect(ACCENTED).not.toBe(PLAIN);
  });

  test("cards printing either spelling link to the one existing player, and none is minted", async () => {
    const t = convexTest(schema, modules);
    const { variantTypeId, sportId } = await seedVariantTypeUnderChromeSet(t);
    const jose = await insertPlayer(t, sportId, ACCENTED);

    await commitWith(t, {
      selectorOptionId: variantTypeId,
      sportId,
      cards: [
        makeCard({ cardNumber: "1", cardName: "Card One", players: [ACCENTED] }),
        makeCard({ cardNumber: "2", cardName: "Card Two", players: [PLAIN] }),
      ],
    });

    const cards = await readCards(t, variantTypeId);
    expect(cards.map((c) => c.playerIds).sort()).toEqual([[jose], [jose]]);
    expect(await t.run((ctx) => ctx.db.query("players").collect())).toHaveLength(1);
  });
});

// ===========================================================================
// NEO-307 — a card can show a team's past, never its future
// ===========================================================================

async function seed2026Set(t: T) {
  const seeded = await seedVariantTypeUnderChromeSet(t);
  await t.run(async (ctx) => {
    for (const id of [seeded.setNameId, seeded.variantTypeId]) {
      await ctx.db.patch(id, { features: { manufacturer: "Donruss", season: "2026" } });
    }
  });
  return seeded;
}

async function insertDatedTeam(
  t: T,
  sportId: Sel,
  row: { location: string; name: string; from: number; to?: number },
): Promise<Id<"teams">> {
  return t.run((ctx) =>
    ctx.db.insert("teams", {
      location: row.location,
      name: row.name,
      nameNormalized: normalizeTeamName(`${row.location} ${row.name}`),
      sportId,
      yearsActive: { from: row.from, ...(row.to !== undefined ? { to: row.to } : {}) },
      lastUpdated: Date.now(),
    }),
  );
}

describe("NEO-307: the review gate lets a card show a team's past", () => {
  const resolveTeams = (t: T, selectorOptionId: Sel, sportId: Sel) =>
    t.withIdentity(ADMIN_IDENTITY).action(api.selectorOptions.resolveChecklistEntities, {
      selectorOptionId,
      sportId,
      cards: [makeCard({ teams: ["Brooklyn Dodgers"] })],
    });

  test("a 2026 set carrying the lone 1911–1957 Brooklyn Dodgers raises no unknown team", async () => {
    const t = convexTest(schema, modules);
    const { variantTypeId, sportId } = await seed2026Set(t);
    await insertDatedTeam(t, sportId, { location: "Brooklyn", name: "Dodgers", from: 1911, to: 1957 });

    const resolved = await resolveTeams(t, variantTypeId, sportId);

    expect(resolved.unknownTeams).toEqual([]);
    expect(resolved.batchId).toBeUndefined();
  });

  test("the NFL Brooklyn Dodgers (1930–1943) never answers for a baseball set — the baseball row does", async () => {
    const t = convexTest(schema, modules);
    const { variantTypeId, sportId } = await seed2026Set(t);
    const footballId = await insertSport(t, "Football");
    await insertDatedTeam(t, footballId, { location: "Brooklyn", name: "Dodgers", from: 1930, to: 1943 });
    const baseball = await insertDatedTeam(t, sportId, {
      location: "Brooklyn",
      name: "Dodgers",
      from: 1911,
      to: 1957,
    });

    expect((await resolveTeams(t, variantTypeId, sportId)).unknownTeams).toEqual([]);
    await commitWith(t, {
      selectorOptionId: variantTypeId,
      sportId,
      cards: [makeCard({ teams: ["Brooklyn Dodgers"] })],
    });

    expect((await readCards(t, variantTypeId))[0].teamOnCardIds).toEqual([baseball]);
  });

  test("with ONLY the NFL row held, a baseball set still reports the team unknown", async () => {
    const t = convexTest(schema, modules);
    const { variantTypeId, sportId } = await seed2026Set(t);
    const footballId = await insertSport(t, "Football");
    await insertDatedTeam(t, footballId, { location: "Brooklyn", name: "Dodgers", from: 1930, to: 1943 });

    const resolved = await resolveTeams(t, variantTypeId, sportId);

    expect(resolved.unknownTeams).toEqual(["Brooklyn Dodgers"]);
    expect(resolved.gateLinks ?? []).toEqual([]);
  });
});

describe("NEO-307: a commit links a retro card to the team's past era", () => {
  test("a 2026 Brooklyn Dodgers card lands on the 1911–1957 row, and says so in the log", async () => {
    const t = convexTest(schema, modules);
    const { variantTypeId, sportId } = await seed2026Set(t);
    const brooklyn = await insertDatedTeam(t, sportId, {
      location: "Brooklyn",
      name: "Dodgers",
      from: 1911,
      to: 1957,
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      const result = await commitWith(t, {
        selectorOptionId: variantTypeId,
        sportId,
        cards: [makeCard({ cardName: "Jackie Robinson", teams: ["Brooklyn Dodgers"] })],
      });
      expect(result.success).toBe(true);
      expect(result.unreviewedNameCount).toBe(0);

      const [card] = await readCards(t, variantTypeId);
      expect(card.teamOnCardIds).toEqual([brooklyn]);
      expect(card.pendingTeamNames ?? []).toEqual([]);
      expect(await t.run((ctx) => ctx.db.query("teams").collect())).toHaveLength(1);

      const pastEraLines = logSpy.mock.calls
        .map(([line]) => line)
        .filter((line): line is string => typeof line === "string" && line.includes("team_linked_past_era"))
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(pastEraLines[0]).toEqual({
        msg: "team_linked_past_era",
        sportId,
        teamId: brooklyn,
        setYear: 2026,
        eraFrom: 1911,
        eraTo: 1957,
      });
    } finally {
      logSpy.mockRestore();
    }
  });
});

// ===========================================================================
// NEO-602 (D5) — a team the gate raised controls its name at commit
// ===========================================================================

describe("NEO-602: a team the gate raised controls the commit prelude for its name", () => {
  const NAME = "Oakland Athletics";

  async function seedAthletics(t: T) {
    const seeded = await seedVariantTypeUnderChromeSet(t);
    await t.run(async (ctx) => {
      for (const id of [seeded.setNameId, seeded.variantTypeId]) {
        await ctx.db.patch(id, { features: { manufacturer: "Topps", season: "2025" } });
      }
    });
    const oakland = await insertDatedTeam(t, seeded.sportId, {
      location: "Oakland",
      name: "Athletics",
      from: 1968,
      to: 2024,
    });
    const athletics = await addAthleticsRow(t, seeded.sportId);
    return { ...seeded, oakland, athletics };
  }

  async function addAthleticsRow(t: T, sportId: Sel) {
    return t.run(async (ctx) => {
      const id = await ctx.db.insert("teams", {
        name: "Athletics",
        nameNormalized: normalizeTeamName("Athletics"),
        sportId,
        yearsActive: { from: 2025 },
        aliases: [NAME],
        lastUpdated: Date.now(),
      });
      await ctx.db.insert("teamAliases", {
        teamId: id,
        sportId,
        aliasNormalized: normalizeTeamName(NAME),
      });
      return id;
    });
  }

  const commit = (t: T, w: { variantTypeId: Sel; sportId: Sel }, extra: Partial<Commit> = {}) =>
    commitWith(t, {
      selectorOptionId: w.variantTypeId,
      sportId: w.sportId,
      cards: [makeCard({ teams: [NAME] })],
      ...extra,
    });

  test("with NO gate team and no player, the year's alias-only pick is NOT linked (S1)", async () => {
    const t = convexTest(schema, modules);
    const w = await seedAthletics(t);

    const result = await commit(t, w);

    expect(result.unreviewedNameCount).toBe(1);
    const [card] = await readCards(t, w.variantTypeId);
    expect(card.teamOnCardIds ?? []).toEqual([]);
    expect(card.pendingTeamNames).toEqual([NAME]);
  });

  test("the stale gate (S1): a single-row name linked silently, then an alias added on a disjoint-era team, is NOT linked to the year's pick", async () => {
    const t = convexTest(schema, modules);
    const seeded = await seedVariantTypeUnderChromeSet(t);
    await t.run(async (ctx) => {
      for (const id of [seeded.setNameId, seeded.variantTypeId]) {
        await ctx.db.patch(id, { features: { manufacturer: "Topps", season: "2025" } });
      }
    });
    const oakland = await insertDatedTeam(t, seeded.sportId, {
      location: "Oakland",
      name: "Athletics",
      from: 1968,
      to: 2024,
    });
    const first = await commit(t, seeded);
    expect(first.unreviewedNameCount).toBe(0);
    expect((await readCards(t, seeded.variantTypeId))[0].teamOnCardIds).toEqual([oakland]);

    const athletics = await addAthleticsRow(t, seeded.sportId);
    const second = await seedVariantTypeUnderChromeSet(t);
    await t.run(async (ctx) => {
      for (const id of [second.setNameId, second.variantTypeId]) {
        await ctx.db.patch(id, { features: { manufacturer: "Topps", season: "2025" } });
      }
    });
    const stale = await commitWith(t, {
      selectorOptionId: second.variantTypeId,
      sportId: seeded.sportId,
      cards: [makeCard({ teams: [NAME] })],
    });

    expect(stale.unreviewedNameCount).toBe(1);
    const [card] = await readCards(t, second.variantTypeId);
    expect(card.teamOnCardIds ?? []).not.toContain(athletics);
    expect(card.teamOnCardIds ?? []).toEqual([]);
  });

  test("a player with a stint on Oakland decides it, but the year would not: not linked silently", async () => {
    const t = convexTest(schema, modules);
    const w = await seedAthletics(t);
    await t.run((ctx) =>
      ctx.db.insert("players", {
        name: "Rickey Henderson",
        nameNormalized: normalizePlayerName("Rickey Henderson"),
        sportId: w.sportId,
        lastUpdated: Date.now(),
        teamYears: [{ teamId: w.oakland, fromYear: 1979, toYear: 1984 }],
      }),
    );

    const result = await commitWith(t, {
      selectorOptionId: w.variantTypeId,
      sportId: w.sportId,
      cards: [makeCard({ players: ["Rickey Henderson"], teams: [NAME] })],
    });

    expect(result.unreviewedNameCount).toBe(1);
    const [card] = await readCards(t, w.variantTypeId);
    expect(card.teamOnCardIds ?? []).toEqual([]);
    expect(card.pendingTeamNames).toEqual([NAME]);
  });

  test("a player with a stint on the Athletics agrees with the year: linked silently", async () => {
    const t = convexTest(schema, modules);
    const w = await seedAthletics(t);
    await t.run((ctx) =>
      ctx.db.insert("players", {
        name: "Jacob Wilson",
        nameNormalized: normalizePlayerName("Jacob Wilson"),
        sportId: w.sportId,
        lastUpdated: Date.now(),
        teamYears: [{ teamId: w.athletics, fromYear: 2025 }],
      }),
    );

    const result = await commitWith(t, {
      selectorOptionId: w.variantTypeId,
      sportId: w.sportId,
      cards: [makeCard({ players: ["Jacob Wilson"], teams: [NAME] })],
    });

    expect(result.unreviewedNameCount).toBe(0);
    expect((await readCards(t, w.variantTypeId))[0].teamOnCardIds).toEqual([w.athletics]);
  });

  test("a team name the gate raised with no link: reported unreviewed and NOT silently linked to the year's pick", async () => {
    const t = convexTest(schema, modules);
    const w = await seedAthletics(t);

    const result = await commit(t, w, { gateTeamNames: [NAME] });

    expect(result.unreviewedNameCount).toBe(1);
    const [card] = await readCards(t, w.variantTypeId);
    expect(card.teamOnCardIds ?? []).toEqual([]);
    expect(card.pendingTeamNames).toEqual([NAME]);
  });

  test("a gate link to Oakland beats the year's pick of the Athletics", async () => {
    const t = convexTest(schema, modules);
    const w = await seedAthletics(t);

    const result = await commit(t, w, {
      gateLinks: [{ kind: "team", name: NAME, teamId: w.oakland, origin: "careerTeam" }],
    });

    expect(result.unreviewedNameCount).toBe(0);
    expect((await readCards(t, w.variantTypeId))[0].teamOnCardIds).toEqual([w.oakland]);
  });
});

// ===========================================================================
// NEO-402 — the resolve phase's batched lookups, and the fetch's name answers
// ===========================================================================

describe("commitCardChecklist prelude: the resolve phase's batched lookups (NEO-402)", () => {
  test("one match links, an alias links, two matches and none stay unlinked, exactly as one unsplit call", async () => {
    const t = convexTest(schema, modules);
    const { variantTypeId, sportId } = await seedVariantTypeUnderChromeSet(t);
    const ids = await t.run(async (ctx) => {
      const player = (name: string) =>
        ctx.db.insert("players", {
          name,
          nameNormalized: normalizePlayerName(name),
          sportId,
          lastUpdated: Date.now(),
        });
      const solo = await player("Bob Allen");
      await player("Jim Smith");
      await player("Jim Smith");
      const artest = await player("Metta World Peace");
      await ctx.db.insert("playerAliases", {
        playerId: artest,
        sportId,
        aliasNormalized: normalizePlayerName("Ron Artest"),
      });
      return { solo, artest };
    });
    const filler = Array.from({ length: 60 }, (_, i) => `Nobody Known ${i}`);
    const base = {
      selectorOptionId: variantTypeId,
      sportId,
      playerNames: ["Bob Allen", "Jim Smith", "Ron Artest", ...filler, "bob  allen"],
      teamNames: [] as string[],
    };

    const unsplit = await t.withIdentity(ADMIN_IDENTITY).mutation(internal.selectorOptions.commitCardChecklistPrelude, base);
    await t.withIdentity(ADMIN_IDENTITY).mutation(internal.selectorOptions.commitCardChecklistPrelude, { ...base, phase: "creates" });
    const resolved = await t.withIdentity(ADMIN_IDENTITY).mutation(internal.selectorOptions.commitCardChecklistPrelude, {
      ...base,
      phase: "resolve",
    });

    const byName = (r: typeof resolved) =>
      Object.fromEntries(r.playerIdByName.map(({ name, id }) => [name, id]));
    expect(byName(resolved)).toEqual(byName(unsplit));
    expect(byName(resolved)).toEqual({
      "Bob Allen": ids.solo,
      "Ron Artest": ids.artest,
      "bob  allen": ids.solo,
    });
    expect([...resolved.unreviewedPlayerNames].sort()).toEqual([...unsplit.unreviewedPlayerNames].sort());
    expect(resolved.unreviewedPlayerNames).toContain("Jim Smith");
  });
});

describe("commitCardChecklist prelude: the fetch's stored name answers (NEO-402)", () => {
  async function seedPlayers(t: T, sportId: Sel) {
    const bob = await insertPlayer(t, sportId, "Bob Allen");
    await insertPlayer(t, sportId, "Jim Smith");
    await insertPlayer(t, sportId, "Jim Smith");
    return { bob };
  }

  const fetchCards = [
    makeCard({ cardNumber: "1", cardName: "Allen", players: ["Bob Allen"] }),
    makeCard({ cardNumber: "2", cardName: "Smith", players: ["Jim Smith"] }),
    makeCard({ cardNumber: "3", cardName: "Nobody", players: ["Nobody Known"] }),
  ];

  const fetchAs = (who: ReturnType<T["withIdentity"]>, selectorOptionId: Sel, sportId: Sel, cards = fetchCards) =>
    who.action(api.selectorOptions.resolveChecklistEntities, { selectorOptionId, sportId, cards });

  async function resolvePhase(who: ReturnType<T["withIdentity"]>, selectorOptionId: Sel, sportId: Sel) {
    const result = await who.mutation(internal.selectorOptions.commitCardChecklistPrelude, {
      selectorOptionId,
      sportId,
      playerNames: ["Bob Allen", "Jim Smith", "Nobody Known"],
      teamNames: [],
      phase: "resolve",
    });
    return {
      linked: Object.fromEntries(result.playerIdByName.map(({ name, id }) => [name, id])),
      unreviewed: [...result.unreviewedPlayerNames].sort(),
    };
  }

  const records = (t: T) => t.run((ctx) => ctx.db.query("checklistNameResolutions").collect());

  test("the fetch stores only the names that matched exactly one player", async () => {
    const t = convexTest(schema, modules);
    const { variantTypeId, sportId } = await seedVariantTypeUnderChromeSet(t);
    const { bob } = await seedPlayers(t, sportId);

    await fetchAs(t.withIdentity(ADMIN_IDENTITY), variantTypeId, sportId);

    const stored = await records(t);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      selectorOptionId: variantTypeId,
      createdByUserId: ADMIN_IDENTITY.subject,
      sportId,
      players: [{ nameNormalized: normalizePlayerName("Bob Allen"), playerId: bob }],
    });
  });

  test("the commit takes the fetch's answer: a second same-name player added since does not unlink the card", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { variantTypeId, sportId } = await seedVariantTypeUnderChromeSet(t);
    const { bob } = await seedPlayers(t, sportId);
    await fetchAs(asAdmin, variantTypeId, sportId);
    await insertPlayer(t, sportId, "Bob Allen");

    const result = await resolvePhase(asAdmin, variantTypeId, sportId);

    expect(result.linked).toEqual({ "Bob Allen": bob });
    expect(result.unreviewed).toEqual(["Jim Smith", "Nobody Known"]);
  });

  test("with no record of its own the commit looks the name up, as before", async () => {
    const t = convexTest(schema, modules);
    const { variantTypeId, sportId } = await seedVariantTypeUnderChromeSet(t);
    await seedPlayers(t, sportId);
    await fetchAs(t.withIdentity(ADMIN_IDENTITY), variantTypeId, sportId);
    await insertPlayer(t, sportId, "Bob Allen");

    const result = await resolvePhase(t.withIdentity(OTHER_ADMIN), variantTypeId, sportId);

    expect(result.linked).toEqual({});
    expect(result.unreviewed).toEqual(["Bob Allen", "Jim Smith", "Nobody Known"]);
  });

  test("a player deleted since the fetch is never linked; the name is looked up again", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { variantTypeId, sportId } = await seedVariantTypeUnderChromeSet(t);
    const { bob } = await seedPlayers(t, sportId);
    await fetchAs(asAdmin, variantTypeId, sportId);
    await t.run((ctx) => ctx.db.delete(bob));
    const newBob = await insertPlayer(t, sportId, "Bob Allen");

    const result = await resolvePhase(asAdmin, variantTypeId, sportId);

    expect(result.linked).toEqual({ "Bob Allen": newBob });
  });

  test("a player renamed since the fetch is not bound by the stored answer", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { variantTypeId, sportId } = await seedVariantTypeUnderChromeSet(t);
    const { bob } = await seedPlayers(t, sportId);
    await fetchAs(asAdmin, variantTypeId, sportId);
    await t.run((ctx) =>
      ctx.db.patch(bob, { name: "Robert Allen", nameNormalized: normalizePlayerName("Robert Allen") }),
    );

    const result = await resolvePhase(asAdmin, variantTypeId, sportId);

    expect(result.linked).toEqual({});
    expect(result.unreviewed).toContain("Bob Allen");
  });

  test("an alias cleared since the fetch no longer binds through the stored answer", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { variantTypeId, sportId } = await seedVariantTypeUnderChromeSet(t);
    const { metta, aliasRow } = await t.run(async (ctx) => {
      const metta = await ctx.db.insert("players", {
        name: "Metta World Peace",
        nameNormalized: normalizePlayerName("Metta World Peace"),
        aliases: ["Ron Artest"],
        sportId,
        lastUpdated: Date.now(),
      });
      const aliasRow = await ctx.db.insert("playerAliases", {
        playerId: metta,
        sportId,
        aliasNormalized: normalizePlayerName("Ron Artest"),
      });
      return { metta, aliasRow };
    });
    await fetchAs(asAdmin, variantTypeId, sportId, [makeCard({ players: ["Ron Artest"] })]);
    const resolveArtest = () =>
      asAdmin.mutation(internal.selectorOptions.commitCardChecklistPrelude, {
        selectorOptionId: variantTypeId,
        sportId,
        playerNames: ["Ron Artest"],
        teamNames: [],
        phase: "resolve",
      });
    expect((await resolveArtest()).playerIdByName).toEqual([{ name: "Ron Artest", id: metta }]);

    await t.run(async (ctx) => {
      await ctx.db.patch(metta, { aliases: [] });
      await ctx.db.delete(aliasRow);
    });

    const after = await resolveArtest();
    expect(after.playerIdByName).toEqual([]);
    expect(after.unreviewedPlayerNames).toEqual(["Ron Artest"]);
  });

  test("a player moved out of the sport since the fetch is not bound by the stored answer", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { variantTypeId, sportId } = await seedVariantTypeUnderChromeSet(t);
    const { bob } = await seedPlayers(t, sportId);
    await fetchAs(asAdmin, variantTypeId, sportId);
    const football = await insertSport(t, "Football");
    await t.run((ctx) => ctx.db.patch(bob, { sportId: football }));

    const result = await resolvePhase(asAdmin, variantTypeId, sportId);

    expect(result.linked).toEqual({});
  });

  test("a name the set's year narrows to one player is not stored: the commit narrows it itself", async () => {
    const t = convexTest(schema, modules);
    const { variantTypeId, sportId } = await seedVariantTypeUnderChromeSet(t);
    await t.run(async (ctx) => {
      const team = await ctx.db.insert("teams", {
        location: "Chicago",
        name: "Cubs",
        nameNormalized: "chicago cubs",
        sportId,
        lastUpdated: Date.now(),
      });
      for (const [fromYear, toYear] of [
        [2020, 2026],
        [1890, 1894],
      ]) {
        await ctx.db.insert("players", {
          name: "Bob Allen",
          nameNormalized: normalizePlayerName("Bob Allen"),
          sportId,
          teamYears: [{ teamId: team, fromYear, toYear }],
          lastUpdated: Date.now(),
        });
      }
    });

    const resolved = await fetchAs(t.withIdentity(ADMIN_IDENTITY), variantTypeId, sportId, [
      makeCard({ cardName: "Allen", players: ["Bob Allen"] }),
    ]);

    expect(resolved.unknownPlayers).toEqual([]);
    expect(await records(t)).toHaveLength(0);
  });

  test("a record written for another sport is not read", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { variantTypeId, sportId } = await seedVariantTypeUnderChromeSet(t);
    await seedPlayers(t, sportId);
    await fetchAs(asAdmin, variantTypeId, sportId);
    await insertPlayer(t, sportId, "Bob Allen");
    const football = await insertSport(t, "Football");
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query("checklistNameResolutions").collect()) {
        await ctx.db.patch(row._id, { sportId: football });
      }
    });

    const result = await resolvePhase(asAdmin, variantTypeId, sportId);

    expect(result.linked).toEqual({});
    expect(result.unreviewed).toContain("Bob Allen");
  });

  test("a re-fetch replaces the record whole", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { variantTypeId, sportId } = await seedVariantTypeUnderChromeSet(t);
    await seedPlayers(t, sportId);
    await fetchAs(asAdmin, variantTypeId, sportId);
    await insertPlayer(t, sportId, "Bob Allen");
    await fetchAs(asAdmin, variantTypeId, sportId);

    expect(await records(t)).toHaveLength(0);
    const result = await resolvePhase(asAdmin, variantTypeId, sportId);
    expect(result.linked).toEqual({});
    expect(result.unreviewed).toEqual(["Bob Allen", "Jim Smith", "Nobody Known"]);
  });

  test("confirm or cancel (discardCandidates) deletes only the caller's record", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { variantTypeId, sportId } = await seedVariantTypeUnderChromeSet(t);
    await seedPlayers(t, sportId);
    for (const who of [asAdmin, t.withIdentity(OTHER_ADMIN)]) await fetchAs(who, variantTypeId, sportId);
    expect(await records(t)).toHaveLength(2);

    await asAdmin.mutation(api.checklistCandidates.discardCandidates, { selectorOptionId: variantTypeId });

    expect((await records(t)).map((r) => r.createdByUserId)).toEqual([OTHER_ADMIN.subject]);
  });

  test("a day-old record is ignored by the commit and reaped by the sweep", async () => {
    const t = convexTest(schema, modules);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);
    const { variantTypeId, sportId } = await seedVariantTypeUnderChromeSet(t);
    await seedPlayers(t, sportId);
    await fetchAs(asAdmin, variantTypeId, sportId);
    await insertPlayer(t, sportId, "Bob Allen");
    const dayAndAMinute = 24 * 60 * 60 * 1000 + 60 * 1000;
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query("checklistNameResolutions").collect()) {
        await ctx.db.patch(row._id, { createdAt: Date.now() - dayAndAMinute });
      }
    });

    expect((await resolvePhase(asAdmin, variantTypeId, sportId)).linked).toEqual({});

    const swept = await t.mutation(internal.checklistNameResolutions.sweepStaleResolutions, {});
    expect(swept).toEqual({ deleted: 1, hasMore: false });
    expect(await records(t)).toHaveLength(0);
  });
});

// ===========================================================================
// NEO-424 — the commit honours what the gate decided from set history
// ===========================================================================

describe("NEO-424: commitCardChecklist honours a set-history gate link (D5)", () => {
  async function world(t: T) {
    const base = await seedVariantTypeUnderChromeSet(t);
    const football = await insertSport(t, "Football");
    const boFootball = await insertPlayer(t, football, "Bo Jackson");
    const boBaseball = await insertPlayer(t, base.sportId, "Bo Jackson");
    return { ...base, football, boFootball, boBaseball };
  }

  const commit = (t: T, w: { variantTypeId: Sel; sportId: Sel }, cards: ReturnType<typeof makeCard>[], extra: Partial<Commit> = {}) =>
    commitWith(t, { selectorOptionId: w.variantTypeId, sportId: w.sportId, cards, ...extra });

  test("a cross-sport link beats the exactly-one in-sport match and writes nothing to playerSports", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);

    const result = await commit(t, w, [makeCard({ players: ["Bo Jackson"] })], {
      gateLinks: [{ kind: "player", name: "Bo Jackson", playerId: w.boFootball, origin: "setHistory" }],
    });

    expect(result.unreviewedNameCount ?? 0).toBe(0);
    const [card] = await readCards(t, w.variantTypeId);
    expect(card.playerIds).toEqual([w.boFootball]);
    expect(card.playerLinks).toEqual([{ playerId: w.boFootball, nameOnCard: "Bo Jackson" }]);
    expect(await t.run((ctx) => ctx.db.query("playerSports").collect())).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("players").collect())).toHaveLength(2);
  });

  test("without a link the one in-sport match is still adopted silently (the fast path is intact)", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);

    await commit(t, w, [makeCard({ players: ["Bo Jackson"] })]);

    expect((await readCards(t, w.variantTypeId))[0].playerIds).toEqual([w.boBaseball]);
  });

  // Main held the name back with its decided review row. A dropped link must
  // not fall to the exactly-one in-sport rule and link the baseball Bo Jackson,
  // a man the gate's data (the set's own history) said was a different one
  // (invariant 8): `gatePlayerNames` holds the name back.
  test("a player deleted between the gate and the commit leaves the name unreviewed, never the baseball namesake", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    await t.run((ctx) => ctx.db.delete(w.boFootball));

    const result = await commit(t, w, [makeCard({ players: ["Bo Jackson"] })], {
      gateLinks: [{ kind: "player", name: "Bo Jackson", playerId: w.boFootball, origin: "setHistory" }],
    });

    expect(result.success).toBe(true);
    expect(result.unreviewedNameCount).toBe(1);
    const [card] = await readCards(t, w.variantTypeId);
    expect(card.playerIds ?? []).toEqual([]);
    expect(card.pendingPlayerNames).toContain("Bo Jackson");
  });

  test("a card with two players commits the linked one cross-sport and the other normally", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    const trout = await insertPlayer(t, w.sportId, "Mike Trout");

    await commit(t, w, [makeCard({ players: ["Bo Jackson", "Mike Trout"] })], {
      gateLinks: [{ kind: "player", name: "Bo Jackson", playerId: w.boFootball, origin: "setHistory" }],
    });

    expect((await readCards(t, w.variantTypeId))[0].playerIds).toEqual([w.boFootball, trout]);
  });

  test("the link is found under any spelling that normalises the same (diacritics)", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    const jose = await insertPlayer(t, w.football, "José Ramírez");
    await insertPlayer(t, w.sportId, "Jose Ramirez");

    await commit(t, w, [makeCard({ players: ["Jose Ramirez"] })], {
      gateLinks: [{ kind: "player", name: "José Ramírez", playerId: jose, origin: "setHistory" }],
    });

    expect((await readCards(t, w.variantTypeId))[0].playerIds).toEqual([jose]);
  });

  test("a team history link commits to that team and mints none", async () => {
    const t = convexTest(schema, modules);
    const w = await world(t);
    const athletics = await t.run((ctx) =>
      ctx.db.insert("teams", {
        location: "Oakland",
        name: "Athletics",
        nameNormalized: normalizeTeamName("Oakland Athletics"),
        sportId: w.sportId,
        lastUpdated: Date.now(),
      }),
    );

    await commit(t, w, [makeCard({ teams: ["Oakland Athletics"] })], {
      gateLinks: [{ kind: "team", name: "Oakland Athletics", teamId: athletics, origin: "setHistory" }],
    });

    expect((await readCards(t, w.variantTypeId))[0].teamOnCardIds).toEqual([athletics]);
    expect(await t.run((ctx) => ctx.db.query("teams").collect())).toHaveLength(1);
  });

  describe("checkGateLinks refuses what the set's sport and the origin do not allow (S2, P3)", () => {
    const raidersIn = (t: T, sportId: Sel) =>
      t.run((ctx) =>
        ctx.db.insert("teams", {
          location: "Oakland",
          name: "Raiders",
          nameNormalized: normalizeTeamName("Oakland Raiders"),
          sportId,
          lastUpdated: Date.now(),
        }),
      );

    test("a team link of ANOTHER sport is dropped: the card gets no team and none is minted", async () => {
      const t = convexTest(schema, modules);
      const w = await world(t);
      const raiders = await raidersIn(t, w.football);

      await commit(t, w, [makeCard({ teams: ["Oakland Raiders"] })], {
        gateLinks: [{ kind: "team", name: "Oakland Raiders", teamId: raiders, origin: "setHistory" }],
      });

      expect((await readCards(t, w.variantTypeId))[0].teamOnCardIds).toBeUndefined();
      expect(await t.run((ctx) => ctx.db.query("teams").collect())).toHaveLength(1);
    });

    test("a Hall of Fame TEAM link is refused even in the set's sport: the name is an ordinary unanswered one (NEO-490)", async () => {
      const t = convexTest(schema, modules);
      const w = await world(t);
      // The link points at a team the printed name does not resolve to on its
      // own, so a link that was honoured would be the only way to land on it.
      const team = await t.run((ctx) =>
        ctx.db.insert("teams", {
          name: "Some Team",
          nameNormalized: normalizeTeamName("Some Team"),
          sportId: w.sportId,
          lastUpdated: Date.now(),
        }),
      );

      await commit(t, w, [makeCard({ teams: ["Oakland Raiders"] })], {
        gateLinks: [{ kind: "team", name: "Oakland Raiders", teamId: team, origin: "hallOfFame" }],
      });

      expect((await readCards(t, w.variantTypeId))[0].teamOnCardIds ?? []).not.toContain(team);
    });

    test("a Hall of Fame link to a player of ANOTHER sport is dropped and the name is held back, not given to the namesake", async () => {
      const t = convexTest(schema, modules);
      const w = await world(t);

      const result = await commit(t, w, [makeCard({ players: ["Bo Jackson"] })], {
        gateLinks: [{ kind: "player", name: "Bo Jackson", playerId: w.boFootball, origin: "hallOfFame" }],
      });

      expect(result.unreviewedNameCount).toBe(1);
      const [card] = await readCards(t, w.variantTypeId);
      expect(card.playerIds ?? []).toEqual([]);
      expect(card.pendingPlayerNames).toContain("Bo Jackson");
    });

    test("a career-team link to a player of ANOTHER sport is dropped too; only a set-history link may cross sports", async () => {
      const t = convexTest(schema, modules);
      const w = await world(t);

      await commit(t, w, [makeCard({ players: ["Bo Jackson"] })], {
        gateLinks: [{ kind: "player", name: "Bo Jackson", playerId: w.boFootball, origin: "careerTeam" }],
      });

      expect((await readCards(t, w.variantTypeId))[0].playerIds ?? []).toEqual([]);
    });
  });
});
