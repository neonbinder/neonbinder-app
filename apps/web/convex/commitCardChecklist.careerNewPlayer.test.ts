/**
 * NEO-591 — the commit side of the career check's "New player named X".
 *
 * A card's printed name can belong to someone who is not on file at all (the
 * wrong-player answer with no right player to pick). The wizard sends the card
 * a `newPlayerByName` pick (name + ref) and the commit a top-level
 * `careerNewPlayers` entry (ref + name + staged career). The commit mints the
 * player as its own phase AFTER the prelude's resolve walk and BEFORE the
 * career stints and the chunks, points ONLY that card at it, schedules no
 * enrichment, and adopts the row a retried commit already made by `ref`.
 */
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { normalizeTeamName } from "./teams";
import {
  normalizePlayerName,
  MAX_CAREER_NEW_PLAYERS,
  MAX_CREATION_REF_LENGTH,
  MAX_CAREER_STINT_APPENDS,
  MAX_PLAYER_TEAM_YEARS,
} from "./players";
import { maxCareerYear } from "../lib/players/career-years";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const ADMIN = {
  subject: "admin_career_new_player_001",
  issuer: "https://clerk.example.com",
  tokenIdentifier: "clerk|admin_career_new_player_001",
  name: "Admin User",
  role: "admin",
};

type T = ReturnType<typeof convexTest>;
type Ids = { sportId: Id<"selectorOptions">; leafId: Id<"selectorOptions"> };

async function seedSet(t: T, sportName = "Baseball", slots?: Record<string, string>): Promise<Ids> {
  return t.run(async (ctx) => {
    const now = Date.now();
    const sportId = await ctx.db.insert("selectorOptions", {
      level: "sport",
      value: sportName,
      sportConfig: { skuCode: sportName === "Baseball" ? "BB" : "FB", league: "MLB" },
      platformData: {},
      children: [],
      lastUpdated: now,
    });
    const yearId = await ctx.db.insert("selectorOptions", {
      level: "year",
      value: "1990",
      platformData: {},
      parentId: sportId,
      children: [],
      lastUpdated: now,
    });
    const setNameId = await ctx.db.insert("selectorOptions", {
      level: "setName",
      value: "Topps",
      platformData: {},
      parentId: yearId,
      children: [],
      lastUpdated: now,
    });
    const leafId = await ctx.db.insert("selectorOptions", {
      level: "variantType",
      value: "Base",
      platformData: slots ? { bsc: slots } : {},
      parentId: setNameId,
      children: [],
      lastUpdated: now,
    });
    await ctx.db.patch(setNameId, { children: [leafId] });
    await ctx.db.patch(yearId, { children: [setNameId] });
    await ctx.db.patch(sportId, { children: [yearId] });
    return { sportId, leafId };
  });
}

function insertTeam(t: T, sportId: Id<"selectorOptions">, location: string, name: string) {
  return t.run((ctx) =>
    ctx.db.insert("teams", {
      location,
      name,
      nameNormalized: normalizeTeamName(`${location} ${name}`),
      sportId,
      lastUpdated: Date.now(),
    }),
  );
}

function insertPlayer(
  t: T,
  sportId: Id<"selectorOptions">,
  name: string,
  teamYears?: Array<{ teamId: Id<"teams">; fromYear?: number; toYear?: number }>,
) {
  return t.run((ctx) =>
    ctx.db.insert("players", {
      name,
      nameNormalized: normalizePlayerName(name),
      sportId,
      ...(teamYears ? { teamYears } : {}),
      lastUpdated: Date.now(),
    }),
  );
}

type CardOverrides = {
  cardNumber?: string;
  players?: string[];
  teams?: string[];
  playerIdByName?: Array<{ name: string; playerId: Id<"players"> }>;
  newPlayerByName?: Array<{ name: string; ref: string }>;
  bscRef?: string;
};

function makeCard(o: CardOverrides = {}) {
  return {
    cardNumber: o.cardNumber ?? "1",
    cardName: "Card",
    team: undefined,
    teams: o.teams ?? [],
    players: o.players ?? [],
    attributes: [],
    isRookie: false,
    isRelic: false,
    printRun: undefined,
    autographType: undefined,
    cardVariation: undefined,
    platformData: o.bscRef ? { bsc: { ref: o.bscRef, setId: "set-primary" } } : {},
    unmatched: undefined,
    ...(o.playerIdByName ? { playerIdByName: o.playerIdByName } : {}),
    ...(o.newPlayerByName ? { newPlayerByName: o.newPlayerByName } : {}),
  };
}

type NewPlayers = Array<{
  ref: string;
  name: string;
  stints: Array<{ teamId?: Id<"teams">; teamName?: string; fromYear: number; toYear?: number }>;
}>;

function commit(
  t: T,
  ids: Ids,
  cards: ReturnType<typeof makeCard>[],
  extra: {
    careerNewPlayers?: NewPlayers;
    careerStints?: Array<{
      playerId: Id<"players">;
      teamId?: Id<"teams">;
      teamName?: string;
      fromYear: number;
      toYear?: number;
    }>;
    batchId?: string;
  } = {},
) {
  return t.withIdentity(ADMIN).action(api.selectorOptions.commitCardChecklist, {
    selectorOptionId: ids.leafId,
    sportId: ids.sportId,
    cards,
    ...extra,
  });
}

function cardsOf(t: T, leafId: Id<"selectorOptions">) {
  return t.run((ctx) =>
    ctx.db
      .query("cardChecklist")
      .withIndex("by_selector_option", (q) => q.eq("selectorOptionId", leafId))
      .collect(),
  );
}

function allPlayers(t: T) {
  return t.run((ctx) => ctx.db.query("players").collect());
}

function playersNamed(t: T, name: string) {
  return t.run(async (ctx) =>
    (await ctx.db.query("players").collect()).filter(
      (p) => p.nameNormalized === normalizePlayerName(name),
    ),
  );
}

/** The two-card scene: a namesake on file, card 1 is the wrong one, card 2 is not. */
async function twoBobAllens(t: T) {
  const ids = await seedSet(t);
  const padres = await insertTeam(t, ids.sportId, "San Diego", "Padres");
  const cubs = await insertTeam(t, ids.sportId, "Chicago", "Cubs");
  const namesake = await insertPlayer(t, ids.sportId, "Bob Allen", [
    { teamId: cubs, fromYear: 1985, toYear: 1986 },
  ]);
  return { ids, padres, cubs, namesake };
}

describe("commitCardChecklist — careerNewPlayers", () => {
  test("mints the player beside its namesake and points only the overridden card at it", async () => {
    const t = convexTest(schema, modules);
    const { ids, namesake, cubs } = await twoBobAllens(t);

    const result = await commit(
      t,
      ids,
      [
        makeCard({
          cardNumber: "1",
          players: ["Bob Allen"],
          newPlayerByName: [{ name: "Bob Allen", ref: "np-one" }],
        }),
        makeCard({ cardNumber: "2", players: ["Bob Allen"] }),
      ],
      { careerNewPlayers: [{ ref: "np-one", name: "Bob Allen", stints: [] }] },
    );

    const same = await playersNamed(t, "Bob Allen");
    expect(same).toHaveLength(2);
    const minted = same.find((p) => p._id !== namesake)!;
    expect(minted.name).toBe("Bob Allen");
    expect(minted.nameNormalized).toBe(normalizePlayerName("Bob Allen"));
    expect(minted.creationRef).toBe("np-one");
    expect(minted.createdByUserId).toBeTruthy();
    // No birth year, no Wikidata id, no stints invented.
    expect(minted.birthYear).toBeUndefined();
    expect(minted.externalIds).toBeUndefined();
    expect(minted.teamYears).toBeUndefined();

    const cards = await cardsOf(t, ids.leafId);
    const one = cards.find((c) => c.cardNumber === "1")!;
    const two = cards.find((c) => c.cardNumber === "2")!;
    expect(one.playerIds).toEqual([minted._id]);
    expect(one.playerLinks).toEqual([{ playerId: minted._id, nameOnCard: "Bob Allen" }]);
    // The other card keeps the name's ordinary resolution (the namesake), and
    // is not left "unreviewed" by the second same-name row.
    expect(two.playerIds).toEqual([namesake]);
    expect(two.playerLinks).toEqual([{ playerId: namesake, nameOnCard: "Bob Allen" }]);
    expect(two.pendingPlayerNames).toBeUndefined();
    expect(one.pendingPlayerNames).toBeUndefined();

    // The existing player is exactly as it was.
    const after = await t.run((ctx) => ctx.db.get(namesake));
    expect(after?.teamYears).toEqual([{ teamId: cubs, fromYear: 1985, toYear: 1986 }]);

    expect(result.createdPlayerIds).toEqual([minted._id]);
    expect(result.careerNewPlayers).toEqual({ created: 1, adopted: 0, stintsAdded: 0, stintsSkipped: 0 });
  });

  test("the card's title names the new player's own spelling, while the printed name stays on the card", async () => {
    const t = convexTest(schema, modules);
    const { ids } = await twoBobAllens(t);

    await commit(
      t,
      ids,
      [
        makeCard({
          cardNumber: "1",
          players: ["Bob Allen"],
          newPlayerByName: [{ name: "Bob Allen", ref: "np-one" }],
        }),
      ],
      { careerNewPlayers: [{ ref: "np-one", name: "  Robert Allen  ", stints: [] }] },
    );

    const [card] = await cardsOf(t, ids.leafId);
    expect(card.listingTitle).toContain("Robert Allen");
    expect(card.listingTitle).not.toContain("Bob Allen");
    expect(card.playerLinks?.[0].nameOnCard).toBe("Bob Allen");
    const minted = (await playersNamed(t, "Robert Allen"))[0];
    // Trimmed on the way in.
    expect(minted.name).toBe("Robert Allen");
  });

  test("two cards that print different spellings point at the one player they were grouped into", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedSet(t);

    await commit(
      t,
      ids,
      [
        makeCard({ cardNumber: "1", players: ["Jose Ramirez"], newPlayerByName: [{ name: "Jose Ramirez", ref: "np-j" }] }),
        makeCard({ cardNumber: "2", players: ["José Ramírez"], newPlayerByName: [{ name: "José Ramírez", ref: "np-j" }] }),
      ],
      { careerNewPlayers: [{ ref: "np-j", name: "Jose Ramirez", stints: [] }] },
    );

    const minted = await allPlayers(t);
    expect(minted).toHaveLength(1);
    const cards = await cardsOf(t, ids.leafId);
    expect(cards.map((c) => c.playerIds)).toEqual([[minted[0]._id], [minted[0]._id]]);
    expect(cards.find((c) => c.cardNumber === "2")!.playerLinks).toEqual([
      { playerId: minted[0]._id, nameOnCard: "José Ramírez" },
    ]);
  });

  test("stints land on the new player: a saved team by id, a team the batch creates by name, one team twice, in order", async () => {
    const t = convexTest(schema, modules);
    const { ids, padres, cubs, namesake } = await twoBobAllens(t);
    await t.run((ctx) =>
      ctx.db.insert("entityReviewQueue", {
        selectorOptionId: ids.leafId,
        batchId: "batch-np-1",
        createdByUserId: "user_review_001",
        kind: "team",
        name: "Brand New Club",
        sportId: ids.sportId,
        status: "ready",
        decision: { action: "create", create: { location: "Brand", name: "New Club" } },
      }),
    );

    const result = await commit(
      t,
      ids,
      [
        makeCard({
          cardNumber: "1",
          players: ["Bob Allen"],
          teams: ["Brand New Club"],
          newPlayerByName: [{ name: "Bob Allen", ref: "np-one" }],
        }),
      ],
      {
        batchId: "batch-np-1",
        careerNewPlayers: [
          {
            ref: "np-one",
            name: "Bob Allen",
            stints: [
              { teamName: "Brand New Club", fromYear: 1988 },
              { teamId: padres, fromYear: 1982, toYear: 1984 },
              { teamId: cubs, fromYear: 1990 },
              { teamId: padres, fromYear: 1995, toYear: 1996 },
              // The same (team, year) twice in one answer: written once.
              { teamId: padres, fromYear: 1982, toYear: 1984 },
            ],
          },
        ],
      },
    );

    const [createdTeam] = result.createdTeamIds;
    expect(createdTeam).toBeDefined();
    const minted = (await playersNamed(t, "Bob Allen")).find((p) => p._id !== namesake)!;
    expect(minted.teamYears).toEqual([
      { teamId: padres, fromYear: 1982, toYear: 1984 },
      { teamId: createdTeam, fromYear: 1988 },
      { teamId: cubs, fromYear: 1990 },
      { teamId: padres, fromYear: 1995, toYear: 1996 },
    ]);
    expect(result.careerNewPlayers).toEqual({ created: 1, adopted: 0, stintsAdded: 4, stintsSkipped: 0 });
    // The namesake never gains any of them.
    expect((await t.run((ctx) => ctx.db.get(namesake)))?.teamYears).toEqual([
      { teamId: cubs, fromYear: 1985, toYear: 1986 },
    ]);
  });

  test("a stint whose printed team resolves to nothing is skipped and counted; the rest land", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedSet(t);
    const padres = await insertTeam(t, ids.sportId, "San Diego", "Padres");

    const result = await commit(
      t,
      ids,
      [makeCard({ players: ["Bob Allen"], newPlayerByName: [{ name: "Bob Allen", ref: "np-one" }] })],
      {
        careerNewPlayers: [
          {
            ref: "np-one",
            name: "Bob Allen",
            stints: [
              { teamId: padres, fromYear: 1982 },
              { teamName: "Nobody Heard Of Them", fromYear: 1988 },
            ],
          },
        ],
      },
    );

    expect(result.careerNewPlayers).toEqual({ created: 1, adopted: 0, stintsAdded: 1, stintsSkipped: 1 });
    expect((await allPlayers(t))[0].teamYears).toEqual([{ teamId: padres, fromYear: 1982 }]);
  });

  test("the new player may end up with no stints at all (every one removed)", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedSet(t);

    const result = await commit(
      t,
      ids,
      [makeCard({ players: ["Bob Allen"], newPlayerByName: [{ name: "Bob Allen", ref: "np-one" }] })],
      { careerNewPlayers: [{ ref: "np-one", name: "Bob Allen", stints: [] }] },
    );

    expect(result.careerNewPlayers?.created).toBe(1);
    expect((await allPlayers(t))[0].teamYears).toBeUndefined();
  });

  test("a stint on the new player and a careerStints entry on another player both land", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedSet(t);
    const padres = await insertTeam(t, ids.sportId, "San Diego", "Padres");
    const gwynn = await insertPlayer(t, ids.sportId, "Tony Gwynn");

    const result = await commit(
      t,
      ids,
      [
        makeCard({ cardNumber: "1", players: ["Bob Allen"], newPlayerByName: [{ name: "Bob Allen", ref: "np-one" }] }),
        makeCard({ cardNumber: "2", players: ["Tony Gwynn"] }),
      ],
      {
        careerNewPlayers: [{ ref: "np-one", name: "Bob Allen", stints: [{ teamId: padres, fromYear: 1982 }] }],
        careerStints: [{ playerId: gwynn, teamId: padres, fromYear: 1983 }],
      },
    );

    expect(result.careerNewPlayers?.stintsAdded).toBe(1);
    expect(result.careerStints).toEqual({ added: 1, existing: 0, skipped: 0 });
  });

  test("schedules no enrichment for the new player", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedSet(t);

    await commit(
      t,
      ids,
      [makeCard({ players: ["Bob Allen"], newPlayerByName: [{ name: "Bob Allen", ref: "np-one" }] })],
      { careerNewPlayers: [{ ref: "np-one", name: "Bob Allen", stints: [] }] },
    );

    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled.filter((s) => s.name.includes("wikidataPool"))).toEqual([]);
    expect(scheduled.filter((s) => JSON.stringify(s.args).includes("playerIds"))).toEqual([]);
  });

  test("logs ids and counts only, never a name", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedSet(t);
    const padres = await insertTeam(t, ids.sportId, "San Diego", "Padres");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await commit(
        t,
        ids,
        [makeCard({ players: ["Bob Allen"], newPlayerByName: [{ name: "Bob Allen", ref: "np-secret-ref" }] })],
        { careerNewPlayers: [{ ref: "np-secret-ref", name: "Bob Allen", stints: [{ teamId: padres, fromYear: 1982 }] }] },
      );
      const lines = log.mock.calls
        .map((c) => String(c[0]))
        .filter((s) => s.includes("commit_career_new_players"));
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0])).toMatchObject({ requested: 1, created: 1, adopted: 0, stintsAdded: 1, stintsSkipped: 0 });
      expect(lines[0]).not.toContain("Allen");
      expect(lines[0]).not.toContain("Padres");
    } finally {
      log.mockRestore();
    }
  });
});

describe("commitCardChecklist — careerNewPlayers retry", () => {
  test("a retried commit adopts the player the first attempt made, by ref, and mints nothing twice", async () => {
    const t = convexTest(schema, modules);
    const { ids, padres, namesake } = await twoBobAllens(t);
    const cards = () => [
      makeCard({ cardNumber: "1", players: ["Bob Allen"], newPlayerByName: [{ name: "Bob Allen", ref: "np-one" }] }),
      makeCard({ cardNumber: "2", players: ["Bob Allen"] }),
    ];
    const np: NewPlayers = [{ ref: "np-one", name: "Bob Allen", stints: [{ teamId: padres, fromYear: 1982 }] }];

    const first = await commit(t, ids, cards(), { careerNewPlayers: np });
    const second = await commit(t, ids, cards(), { careerNewPlayers: np });

    const same = await playersNamed(t, "Bob Allen");
    expect(same).toHaveLength(2);
    const minted = same.find((p) => p._id !== namesake)!;
    expect(second.createdPlayerIds).toEqual([minted._id]);
    expect(second.careerNewPlayers).toEqual({ created: 0, adopted: 1, stintsAdded: 0, stintsSkipped: 0 });
    expect(first.careerNewPlayers?.created).toBe(1);
    // Stints are not doubled.
    expect(minted.teamYears).toEqual([{ teamId: padres, fromYear: 1982 }]);
  });

  test("a retry whose first attempt already minted the row still resolves the OTHER same-name cards to the namesake", async () => {
    const t = convexTest(schema, modules);
    const { ids, namesake } = await twoBobAllens(t);
    const np: NewPlayers = [{ ref: "np-one", name: "Bob Allen", stints: [] }];
    // The first attempt got as far as minting the player (here: a commit that
    // carried only the wrong-player card) and no further for card 2.
    await commit(
      t,
      ids,
      [makeCard({ cardNumber: "1", players: ["Bob Allen"], newPlayerByName: [{ name: "Bob Allen", ref: "np-one" }] })],
      { careerNewPlayers: np },
    );
    expect(await playersNamed(t, "Bob Allen")).toHaveLength(2);

    const result = await commit(
      t,
      ids,
      [
        makeCard({ cardNumber: "1", players: ["Bob Allen"], newPlayerByName: [{ name: "Bob Allen", ref: "np-one" }] }),
        makeCard({ cardNumber: "2", players: ["Bob Allen"] }),
      ],
      { careerNewPlayers: np },
    );

    expect(result.careerNewPlayers).toMatchObject({ created: 0, adopted: 1 });
    expect(await playersNamed(t, "Bob Allen")).toHaveLength(2);
    const two = (await cardsOf(t, ids.leafId)).find((c) => c.cardNumber === "2")!;
    // The row this commit's own answer made is not a namesake to weigh: card 2
    // resolves exactly as it would on the first attempt, not to "unreviewed".
    expect(two.playerIds).toEqual([namesake]);
    expect(two.pendingPlayerNames).toBeUndefined();
  });

  test("a row carrying the ref but made by someone else is not adopted", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedSet(t);
    await t.run((ctx) =>
      ctx.db.insert("players", {
        name: "Bob Allen",
        nameNormalized: normalizePlayerName("Bob Allen"),
        sportId: ids.sportId,
        creationRef: "np-one",
        createdByUserId: "someone_else",
        lastUpdated: Date.now(),
      }),
    );

    const result = await commit(
      t,
      ids,
      [makeCard({ players: ["Bob Allen"], newPlayerByName: [{ name: "Bob Allen", ref: "np-one" }] })],
      { careerNewPlayers: [{ ref: "np-one", name: "Bob Allen", stints: [] }] },
    );

    expect(result.careerNewPlayers).toMatchObject({ created: 1, adopted: 0 });
    expect(await playersNamed(t, "Bob Allen")).toHaveLength(2);
  });

  test("a ref on another operator's row hides nothing: a card printing the name still sees both rows", async () => {
    const t = convexTest(schema, modules);
    const { ids, namesake } = await twoBobAllens(t);
    const theirs = await t.run((ctx) =>
      ctx.db.insert("players", {
        name: "Bob Allen",
        nameNormalized: normalizePlayerName("Bob Allen"),
        sportId: ids.sportId,
        creationRef: "np-one",
        createdByUserId: "someone_else",
        lastUpdated: Date.now(),
      }),
    );

    const result = await commit(
      t,
      ids,
      [
        makeCard({ cardNumber: "1", players: ["Bob Allen"], newPlayerByName: [{ name: "Bob Allen", ref: "np-one" }] }),
        makeCard({ cardNumber: "2", players: ["Bob Allen"] }),
      ],
      { careerNewPlayers: [{ ref: "np-one", name: "Bob Allen", stints: [] }] },
    );

    // Not adopted, so a third row is minted for card 1 ...
    expect(result.careerNewPlayers).toMatchObject({ created: 1, adopted: 0 });
    expect(await playersNamed(t, "Bob Allen")).toHaveLength(3);
    // ... and card 2 weighed BOTH rows that already carried the name, so it
    // does not silently settle on the namesake as if the other were hidden
    // (the other operator's matching ref excluded nothing).
    const two = (await cardsOf(t, ids.leafId)).find((c) => c.cardNumber === "2")!;
    // The cross-user row is weighed, and the era narrowing prefers it to the
    // namesake whose stints are in other years; hidden, card 2 would have
    // settled on the namesake exactly as the same-operator retry above does.
    expect(two.playerIds).toEqual([theirs]);
    expect(two.playerIds).not.toEqual([namesake]);
  });
});

describe("commitCardChecklist — careerNewPlayers and a later re-sync", () => {
  const slots = { b0: "set-primary" };
  const bscCard = (o: CardOverrides) => makeCard({ ...o, bscRef: o.bscRef ?? "ref-1" });

  test("a re-sync with no applyFields keeps the card on the new player, and does not offer or force the namesake", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedSet(t, "Baseball", slots);
    const namesake = await insertPlayer(t, ids.sportId, "Bob Allen");

    await commit(
      t,
      ids,
      [bscCard({ cardNumber: "1", players: ["Bob Allen"], newPlayerByName: [{ name: "Bob Allen", ref: "np-one" }] })],
      { careerNewPlayers: [{ ref: "np-one", name: "Bob Allen", stints: [] }] },
    );
    const [before] = await cardsOf(t, ids.leafId);
    const minted = before.playerIds![0];
    expect(minted).not.toBe(namesake);

    // The next sync prints the same name and carries no answer. The name now
    // has two players on file, so it is the operator's question, not a guess.
    await commit(t, ids, [bscCard({ cardNumber: "1", players: ["Bob Allen"] })]);

    const rows = await cardsOf(t, ids.leafId);
    expect(rows).toHaveLength(1);
    expect(rows[0]._id).toBe(before._id);
    expect(rows[0].playerIds).toEqual([minted]);
    expect(rows[0].playerLinks).toEqual([{ playerId: minted, nameOnCard: "Bob Allen" }]);
    // (Known and left alone: with two same-name players on file and no review
    // decision, the update stamps the name as unreviewed on the row, as it does
    // for any ambiguous name. The link above is untouched.)
  });
});

describe("commitCardChecklist — careerNewPlayers refusals write nothing", () => {
  const stint = { fromYear: 1988 };
  const okCard = (extra: Partial<CardOverrides> = {}) =>
    makeCard({
      players: ["Bob Allen"],
      newPlayerByName: [{ name: "Bob Allen", ref: "np-one" }],
      ...extra,
    });
  const okNp = (over: Partial<NewPlayers[number]> = {}): NewPlayers[number] => ({
    ref: "np-one",
    name: "Bob Allen",
    stints: [],
    ...over,
  });

  type Case = {
    label: string;
    message: RegExp;
    build: (x: { padres: Id<"teams">; foreignTeam: Id<"teams">; gwynn: Id<"players"> }) => {
      cards: ReturnType<typeof makeCard>[];
      careerNewPlayers: NewPlayers;
      careerStints?: Array<{ playerId: Id<"players">; teamId?: Id<"teams">; fromYear: number }>;
    };
  };

  const cases: Case[] = [
    { label: "a malformed ref", message: /malformed reference/, build: () => ({ cards: [okCard({ newPlayerByName: [{ name: "Bob Allen", ref: "no spaces!" }] })], careerNewPlayers: [okNp({ ref: "no spaces!" })] }) },
    { label: "a ref over 32 characters", message: /malformed reference/, build: () => ({ cards: [okCard()], careerNewPlayers: [okNp({ ref: "a".repeat(33) })] }) },
    { label: "a per-card ref over 32 characters", message: /new-player reference of 33 characters; the limit is 32/, build: () => ({ cards: [okCard({ newPlayerByName: [{ name: "Bob Allen", ref: "a".repeat(33) }] })], careerNewPlayers: [okNp({ ref: "a".repeat(33) })] }) },
    { label: "an empty ref", message: /malformed reference/, build: () => ({ cards: [okCard({ newPlayerByName: [{ name: "Bob Allen", ref: "" }] })], careerNewPlayers: [okNp({ ref: "" })] }) },
    { label: "a repeated ref", message: /repeats another new player's reference/, build: () => ({ cards: [okCard()], careerNewPlayers: [okNp(), okNp({ name: "Other Person" })] }) },
    { label: "a blank name", message: /has no name/, build: () => ({ cards: [okCard()], careerNewPlayers: [okNp({ name: "   " })] }) },
    { label: "a name over the length limit", message: /characters; the limit is/, build: () => ({ cards: [okCard()], careerNewPlayers: [okNp({ name: "x".repeat(201) })] }) },
    { label: "a name with a control character", message: /control or invisible/, build: () => ({ cards: [okCard()], careerNewPlayers: [okNp({ name: "Bob\u0007Allen" })] }) },
    { label: "a name with a zero-width character", message: /control or invisible/, build: () => ({ cards: [okCard()], careerNewPlayers: [okNp({ name: "Bob​Allen" })] }) },
    { label: "a name with no letters or digits", message: /no letters or digits/, build: () => ({ cards: [okCard()], careerNewPlayers: [okNp({ name: "..." })] }) },
    { label: "two new players sharing a folded name", message: /repeats another new player's name/, build: () => ({ cards: [okCard({ newPlayerByName: [{ name: "Bob Allen", ref: "np-one" }, { name: "Robert", ref: "np-two" }], players: ["Bob Allen", "Robert"] })], careerNewPlayers: [okNp(), okNp({ ref: "np-two", name: "bob  ALLEN" })] }) },
    { label: "a card pointing at an undeclared ref", message: /does not declare/, build: () => ({ cards: [okCard({ newPlayerByName: [{ name: "Bob Allen", ref: "np-ghost" }] })], careerNewPlayers: [okNp()] }) },
    { label: "a declared player no card uses", message: /used by no card/, build: () => ({ cards: [makeCard({ players: ["Bob Allen"] })], careerNewPlayers: [okNp()] }) },
    { label: "a pick for a name the card does not print", message: /does not print/, build: () => ({ cards: [okCard({ players: ["Somebody Else"] })], careerNewPlayers: [okNp()] }) },
    { label: "a name both re-linked and new", message: /answers one printed name twice/, build: ({ gwynn }) => ({ cards: [okCard({ playerIdByName: [{ name: "Bob Allen", playerId: gwynn }] })], careerNewPlayers: [okNp()] }) },
    { label: "a name picked new twice on one card", message: /answers one printed name twice/, build: () => ({ cards: [okCard({ newPlayerByName: [{ name: "Bob Allen", ref: "np-one" }, { name: "Bob Allen", ref: "np-two" }] })], careerNewPlayers: [okNp(), okNp({ ref: "np-two", name: "Another One" })] }) },
    { label: "a stint with both a team id and a name", message: /exactly one team/, build: ({ padres }) => ({ cards: [okCard()], careerNewPlayers: [okNp({ stints: [{ teamId: padres, teamName: "X", ...stint }] })] }) },
    { label: "a stint with no team", message: /exactly one team/, build: () => ({ cards: [okCard()], careerNewPlayers: [okNp({ stints: [{ ...stint }] })] }) },
    { label: "a stint team name over the limit", message: /team name over/, build: () => ({ cards: [okCard()], careerNewPlayers: [okNp({ stints: [{ teamName: "t".repeat(201), ...stint }] })] }) },
    { label: "a stint start year before the floor", message: /fromYear/, build: ({ padres }) => ({ cards: [okCard()], careerNewPlayers: [okNp({ stints: [{ teamId: padres, fromYear: 1500 }] })] }) },
    { label: "a stint start year past next year", message: /fromYear/, build: ({ padres }) => ({ cards: [okCard()], careerNewPlayers: [okNp({ stints: [{ teamId: padres, fromYear: maxCareerYear() + 1 }] })] }) },
    { label: "a stint end year before the start", message: /toYear/, build: ({ padres }) => ({ cards: [okCard()], careerNewPlayers: [okNp({ stints: [{ teamId: padres, fromYear: 1990, toYear: 1989 }] })] }) },
    { label: "a team from another sport", message: /another sport/, build: ({ foreignTeam }) => ({ cards: [okCard()], careerNewPlayers: [okNp({ stints: [{ teamId: foreignTeam, ...stint }] })] }) },
    { label: "more stints on one player than a career holds", message: /career stints; the limit is/, build: ({ padres }) => ({ cards: [okCard()], careerNewPlayers: [okNp({ stints: Array.from({ length: MAX_PLAYER_TEAM_YEARS + 1 }, (_, i) => ({ teamId: padres, fromYear: 1900 + i })) })] }) },
    { label: "nested stints plus careerStints over the shared budget", message: /career stints exceeds/, build: ({ padres, gwynn }) => ({ cards: [okCard()], careerNewPlayers: [okNp({ stints: Array.from({ length: 60 }, (_, i) => ({ teamId: padres, fromYear: 1900 + (i % 100) })) }), ], careerStints: Array.from({ length: MAX_CAREER_STINT_APPENDS - 59 }, (_, i) => ({ playerId: gwynn, teamId: padres, fromYear: 1900 + (i % 100) })) }) },
    { label: "a one-word name that is a fragment of a fuller player", message: /single word that matches a fuller player/, build: () => ({ cards: [makeCard({ players: ["Walker"], newPlayerByName: [{ name: "Walker", ref: "np-one" }] })], careerNewPlayers: [okNp({ name: "Walker" })] }) },
  ];

  test.each(cases)("refuses $label before writing anything", async ({ build, message }) => {
    const t = convexTest(schema, modules);
    const ids = await seedSet(t);
    const other = await seedSet(t, "Football");
    const padres = await insertTeam(t, ids.sportId, "San Diego", "Padres");
    const foreignTeam = await insertTeam(t, other.sportId, "Dallas", "Cowboys");
    const gwynn = await insertPlayer(t, ids.sportId, "Tony Gwynn");
    await insertPlayer(t, ids.sportId, "Larry Walker");
    const before = (await allPlayers(t)).length;

    const built = build({ padres, foreignTeam, gwynn });
    await expect(
      commit(t, ids, built.cards, {
        careerNewPlayers: built.careerNewPlayers,
        ...(built.careerStints ? { careerStints: built.careerStints } : {}),
      }),
    ).rejects.toThrow(message);

    expect(await cardsOf(t, ids.leafId)).toEqual([]);
    expect(await allPlayers(t)).toHaveLength(before);
    expect((await t.run((ctx) => ctx.db.get(gwynn)))?.teamYears).toBeUndefined();
  });

  test("refusal messages never echo the name", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedSet(t);
    let message = "";
    try {
      await commit(t, ids, [okCard()], { careerNewPlayers: [okNp({ name: "Bob\u0007Allen" })] });
    } catch (e) {
      message = String((e as Error).message);
    }
    expect(message).toMatch(/control or invisible/);
    expect(message).not.toContain("Allen");
  });

  test("refuses more new players than a commit may mint", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedSet(t);
    const nps = Array.from({ length: MAX_CAREER_NEW_PLAYERS + 1 }, (_, i) => ({
      ref: `np-${i}`,
      name: `Player Number${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`,
      stints: [],
    }));
    await expect(
      commit(
        t,
        ids,
        nps.map((np, i) =>
          makeCard({ cardNumber: String(i + 1), players: [np.name], newPlayerByName: [{ name: np.name, ref: np.ref }] }),
        ),
        { careerNewPlayers: nps },
      ),
    ).rejects.toThrow(/new players exceeds/);
    expect(await cardsOf(t, ids.leafId)).toEqual([]);
    expect(await allPlayers(t)).toEqual([]);
  });

  test("a card carrying more new-player picks than it may print is refused", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedSet(t);
    // The roster is at its own limit (20); the 21st pick can only repeat a name.
    const names = Array.from({ length: 20 }, (_, i) => `Name${String.fromCharCode(97 + i)}`);
    const picks = [...names, names[0]].map((name, i) => ({ name, ref: `np-${i}` }));
    await expect(
      commit(t, ids, [makeCard({ players: names, newPlayerByName: picks })], {
        careerNewPlayers: picks.map((p) => ({ ref: p.ref, name: `${p.name}${p.ref}`, stints: [] })),
      }),
    ).rejects.toThrow(/new-player picks, above the/);
    expect(await allPlayers(t)).toEqual([]);
  });

  test("a per-card new-player ref longer than the commit's ref format allows is refused at the boundary", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedSet(t);
    expect(MAX_CREATION_REF_LENGTH).toBe(32);
    const longRef = "r".repeat(MAX_CREATION_REF_LENGTH + 1);
    await expect(
      commit(t, ids, [makeCard({ players: ["Bob Allen"], newPlayerByName: [{ name: "Bob Allen", ref: longRef }] })]),
    ).rejects.toThrow(/new-player reference of 33 characters; the limit is 32/);
    // The other two entry points hold the same bound.
    await expect(
      t.withIdentity(ADMIN).action(api.selectorOptions.resolveChecklistEntities, {
        selectorOptionId: ids.leafId,
        sportId: ids.sportId,
        cards: [makeCard({ players: ["Bob Allen"], newPlayerByName: [{ name: "Bob Allen", ref: longRef }] })],
      }),
    ).rejects.toThrow(/new-player reference of 33 characters/);
    expect(await allPlayers(t)).toEqual([]);
  });
});

describe("players.createCareerNewPlayers", () => {
  test("mints under a sport only", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedSet(t);
    await expect(
      t.mutation(internal.players.createCareerNewPlayers, {
        sportId: ids.leafId,
        userId: "u",
        players: [{ ref: "r", name: "Bob Allen", stints: [] }],
      }),
    ).rejects.toThrow(/under a sport/);
    expect(await allPlayers(t)).toEqual([]);
  });

  test("a team that vanished or sits in another sport is skipped and counted, never written", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedSet(t);
    const other = await seedSet(t, "Football");
    const padres = await insertTeam(t, ids.sportId, "San Diego", "Padres");
    const foreign = await insertTeam(t, other.sportId, "Dallas", "Cowboys");
    const gone = await insertTeam(t, ids.sportId, "Gone", "Away");
    await t.run((ctx) => ctx.db.delete(gone));

    const result = await t.mutation(internal.players.createCareerNewPlayers, {
      sportId: ids.sportId,
      userId: "u",
      players: [
        {
          ref: "r",
          name: "Bob Allen",
          stints: [
            { teamId: padres, fromYear: 1982 },
            { teamId: foreign, fromYear: 1983 },
            { teamId: gone, fromYear: 1984 },
          ],
        },
      ],
    });

    expect(result.stintsAdded).toBe(1);
    expect(result.stintsSkipped).toBe(2);
    expect((await allPlayers(t))[0].teamYears).toEqual([{ teamId: padres, fromYear: 1982 }]);
  });
});

describe("public player shapes", () => {
  test("the retry token never leaves through a public read", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedSet(t);
    await commit(
      t,
      ids,
      [makeCard({ players: ["Bob Allen"], newPlayerByName: [{ name: "Bob Allen", ref: "np-one" }] })],
      { careerNewPlayers: [{ ref: "np-one", name: "Bob Allen", stints: [] }] },
    );
    const found = await t.withIdentity(ADMIN).query(api.players.findByNameAndSport, {
      name: "Bob Allen",
      sportId: ids.sportId,
    });
    expect(found).not.toBeNull();
    expect(JSON.stringify(found)).not.toContain("np-one");
    expect(found).not.toHaveProperty("creationRef");
  });
});
