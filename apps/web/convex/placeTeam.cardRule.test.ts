/**
 * NEO-591 (Jason, 2026-11-20) — a checklist team that is only a PLACE
 * ("Seattle") takes its era from the card's PLAYERS, like a printed team name
 * does (NEO-602), and never from the set year.
 *
 * Fixture: a 2001 MLB set. The league holds two Seattle teams, the one-season
 * 1969 Pilots and the 1977- Mariners (and an other-league Seattle team that
 * never counts). The year alone would say Mariners for every card, silently
 * linking a retro Pilots card printed "Seattle" to the wrong franchise.
 *
 * The same scene is driven through BOTH consumers of the card rule, so the two
 * cannot drift: the review gate (`resolveChecklistEntities`, which asks the
 * operator or raises a visible decided row) and the commit prelude
 * (`commitCardChecklist`, which links silently or leaves the name unreviewed).
 * Whatever the gate shows as needing the operator, the commit must not resolve
 * silently, and the reverse.
 */
import type { GateLink } from "./lib/tidyAnswerDecisions";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { normalizePlayerName } from "./players";
import { normalizeTeamName } from "./teams";
import { resolveCardTeamName } from "./lib/teamRow";
import { cancelScheduled } from "../lib/testing/drain-scheduled";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const ADMIN = {
  subject: "admin_place_team_card_rule_001",
  issuer: "https://clerk.example.com",
  tokenIdentifier: "clerk|admin_place_team_card_rule_001",
  name: "Admin User",
  role: "admin",
};

const PLACE = "Seattle";

type T = ReturnType<typeof convexTest>;
type Sel = Id<"selectorOptions">;

const live: T[] = [];
function newT(): T {
  const t = convexTest(schema, modules);
  live.push(t);
  return t;
}
afterEach(async () => {
  for (const t of live.splice(0)) await cancelScheduled(t);
});

type World = {
  sportId: Sel;
  leafId: Sel;
  pilots: Id<"teams">;
  mariners: Id<"teams">;
  kraken: Id<"teams">;
};

/**
 * Baseball > 2001 > Topps (carries the league) > Base. `leagues` are the set's
 * league(s): the MLB league by default, none with `"none"`.
 */
async function seedWorld(
  t: T,
  opts: { year?: string; leagues?: "mlb" | "other" | "none"; only?: Array<"pilots" | "mariners"> } = {},
): Promise<World> {
  const year = opts.year ?? "2001";
  const only = opts.only ?? ["pilots", "mariners"];
  return t.run(async (ctx) => {
    const now = Date.now();
    const node = async (level: string, value: string, parentId?: Sel): Promise<Sel> => {
      const id = await ctx.db.insert("selectorOptions", {
        level,
        value,
        platformData: {},
        children: [],
        ...(parentId ? { parentId } : {}),
        lastUpdated: now,
      });
      if (parentId) {
        const parent = await ctx.db.get(parentId);
        await ctx.db.patch(parentId, { children: [...(parent?.children ?? []), id] });
      }
      return id;
    };
    const sportId = await node("sport", "Baseball");
    const yearId = await node("year", year, sportId);
    const setNameId = await node("setName", "Topps", yearId);
    const leafId = await node("variantType", "Base", setNameId);
    const league = async (name: string, level: "major" | "other") =>
      ctx.db.insert("leagues", {
        name,
        nameNormalized: name.toLowerCase(),
        sportId,
        level,
        lastUpdated: now,
      });
    const mlb = await league("Major League Baseball", "major");
    const other = await league("Exhibition", "other");
    if (opts.leagues !== "none") {
      await ctx.db.patch(setNameId, { leagueIds: [opts.leagues === "other" ? other : mlb] });
    }
    const team = async (
      name: string,
      leagueId: Id<"leagues">,
      yearsActive?: { from: number; to?: number },
    ) =>
      ctx.db.insert("teams", {
        location: PLACE,
        name,
        nameNormalized: normalizeTeamName(`${PLACE} ${name}`),
        sportId,
        leagueId,
        ...(yearsActive ? { yearsActive } : {}),
        lastUpdated: now,
      });
    const pilots = await team("Pilots", mlb, { from: 1969, to: 1969 });
    const mariners = await team("Mariners", mlb, { from: 1977 });
    if (!only.includes("pilots")) await ctx.db.delete(pilots);
    if (!only.includes("mariners")) await ctx.db.delete(mariners);
    const kraken = await team("Kraken", other, { from: 2021 });
    return { sportId, leafId, pilots, mariners, kraken };
  });
}

function player(
  t: T,
  sportId: Sel,
  name: string,
  teamYears: Array<{ teamId: Id<"teams">; fromYear?: number; toYear?: number }> = [],
): Promise<Id<"players">> {
  return t.run((ctx) =>
    ctx.db.insert("players", {
      name,
      nameNormalized: normalizePlayerName(name),
      sportId,
      teamYears,
      lastUpdated: Date.now(),
    }),
  );
}

const PILOTS_STINT = (w: World) => [{ teamId: w.pilots, fromYear: 1969, toYear: 1969 }];
const MARINERS_STINT = (w: World) => [{ teamId: w.mariners, fromYear: 1995, toYear: 1999 }];

type CardOverrides = {
  cardNumber?: string;
  players?: string[];
  teams?: string[];
  playerIdByName?: Array<{ name: string; playerId: Id<"players"> }>;
  newPlayerByName?: Array<{ name: string; ref: string }>;
};

function makeCard(o: CardOverrides = {}) {
  return {
    cardNumber: o.cardNumber ?? "1",
    cardName: "Card",
    team: undefined,
    teams: o.teams ?? [PLACE],
    players: o.players ?? [],
    attributes: [],
    isRookie: false,
    isRelic: false,
    printRun: undefined,
    autographType: undefined,
    cardVariation: undefined,
    platformData: {},
    unmatched: undefined,
    ...(o.playerIdByName ? { playerIdByName: o.playerIdByName } : {}),
    ...(o.newPlayerByName ? { newPlayerByName: o.newPlayerByName } : {}),
  };
}

function gate(t: T, w: World, cards: ReturnType<typeof makeCard>[]) {
  return t.withIdentity(ADMIN).action(api.selectorOptions.resolveChecklistEntities, {
    selectorOptionId: w.leafId,
    sportId: w.sportId,
    cards,
  });
}

function commit(
  t: T,
  w: World,
  cards: ReturnType<typeof makeCard>[],
  extra: {
    gateLinks?: GateLink[];
    careerNewPlayers?: Array<{ ref: string; name: string; stints: never[] }>;
  } = {},
) {
  return t.withIdentity(ADMIN).action(api.selectorOptions.commitCardChecklist, {
    selectorOptionId: w.leafId,
    sportId: w.sportId,
    cards,
    ...extra,
  });
}

/** The gate's automatic team links (NEO-656: facts it returns, nothing stored). */
function teamLinks(result: { gateLinks?: GateLink[] }) {
  return (result.gateLinks ?? []).filter((l) => l.kind === "team");
}

/**
 * The place's candidates, as the walk reads them after the commit
 * (`tidyLeafFacts` over the stored cards): the printed team names still
 * pending, with the in-league teams a place offered.
 */
async function pendingTeamItems(t: T, w: World, cards: ReturnType<typeof makeCard>[]) {
  await commit(t, w, cards);
  const facts = await t
    .withIdentity(ADMIN)
    .action(api.selectorOptions.tidyLeafFacts, { selectorOptionId: w.leafId });
  return facts.gateItems.filter((i) => i.kind === "team");
}

async function storedCards(t: T, w: World) {
  return t.run((ctx) =>
    ctx.db
      .query("cardChecklist")
      .withIndex("by_selector_option", (q) => q.eq("selectorOptionId", w.leafId))
      .collect(),
  );
}

describe("the review gate: a printed place reads the card's players, never the year", () => {
  test("a player with a Mariners stint agrees with the year: linked silently, no team row", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await player(t, w.sportId, "Ichiro Suzuki", MARINERS_STINT(w));

    const result = await gate(t, w, [makeCard({ players: ["Ichiro Suzuki"] })]);

    expect(result.unknownTeams).toEqual([]);
    expect(teamLinks(result)).toEqual([]);
  });

  test("a player with a Pilots stint is the Pilots: a visible, changeable careerTeam row against the year", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await player(t, w.sportId, "Don Mincher", PILOTS_STINT(w));

    const result = await gate(t, w, [makeCard({ players: ["Don Mincher"] })]);

    expect(result.unknownTeams).toEqual([]);
    const links = teamLinks(result);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ teamId: w.pilots, origin: "careerTeam" });
  });

  test("no players on the card: the operator is asked, nothing linked, and both Seattle teams are offered", async () => {
    const t = newT();
    const w = await seedWorld(t);

    const result = await gate(t, w, [makeCard({ players: [] })]);

    expect(result.unknownTeams).toEqual([PLACE]);
    expect(teamLinks(result)).toEqual([]);
    // The step shows the printed place and the in-league teams there, not the Kraken.
    const [row] = await pendingTeamItems(t, w, [makeCard({ players: [] })]);
    expect(row.name).toBe(PLACE);
    expect([...(row.candidateTeamIds ?? [])].sort()).toEqual([w.pilots, w.mariners].sort());
    // The candidates are teams located at the place, none named it: the step's
    // lead-in says so ("from Seattle"), and reads it back from the query.
    expect(row.candidatePlace).toBe(true);
  });

  test("a player with no stint on either Seattle team says nothing: the operator is asked", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const elsewhere = await t.run((ctx) =>
      ctx.db.insert("teams", {
        name: "Cubs",
        location: "Chicago",
        nameNormalized: normalizeTeamName("Chicago Cubs"),
        sportId: w.sportId,
        lastUpdated: Date.now(),
      }),
    );
    await player(t, w.sportId, "Ryne Sandberg", [{ teamId: elsewhere, fromYear: 1982, toYear: 1994 }]);

    const result = await gate(t, w, [makeCard({ players: ["Ryne Sandberg"] })]);

    expect(result.unknownTeams).toEqual([PLACE]);
  });

  test("a split (one card per team) and a player on both teams are the operator's", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await player(t, w.sportId, "Don Mincher", PILOTS_STINT(w));
    await player(t, w.sportId, "Ichiro Suzuki", MARINERS_STINT(w));
    await player(t, w.sportId, "Tied Player", [...PILOTS_STINT(w), ...MARINERS_STINT(w)]);

    const split = await gate(t, w, [
      makeCard({ cardNumber: "1", players: ["Don Mincher"] }),
      makeCard({ cardNumber: "2", players: ["Ichiro Suzuki"] }),
    ]);
    expect(split.unknownTeams).toEqual([PLACE]);

    const tied = await gate(t, w, [makeCard({ players: ["Tied Player"] })]);
    expect(tied.unknownTeams).toEqual([PLACE]);
  });

  test("a card with an unresolved player leaves the name to the operator", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await player(t, w.sportId, "Ichiro Suzuki", MARINERS_STINT(w));

    const result = await gate(t, w, [
      makeCard({ cardNumber: "1", players: ["Ichiro Suzuki"] }),
      makeCard({ cardNumber: "2", players: ["Nobody Onfile"] }),
    ]);

    expect(result.unknownTeams).toEqual([PLACE]);
  });

  test("a New player card gives no evidence: his namesake's Pilots stint does not link the place", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await player(t, w.sportId, "Bob Allen", PILOTS_STINT(w));

    const result = await gate(t, w, [
      makeCard({
        players: ["Bob Allen"],
        newPlayerByName: [{ name: "Bob Allen", ref: "np-one" }],
      }),
    ]);

    expect(result.unknownTeams).toEqual([PLACE]);
    expect(teamLinks(result)).toEqual([]);
  });

  test("only ONE in-league team at the place: the gate does not settle it either (pairing did, or the operator does) - as before", async () => {
    const t = newT();
    const w = await seedWorld(t, { only: ["mariners"] });
    await player(t, w.sportId, "Ichiro Suzuki", MARINERS_STINT(w));

    const result = await gate(t, w, [makeCard({ players: ["Ichiro Suzuki"] })]);

    expect(result.unknownTeams).toEqual([PLACE]);
  });

  test("a set with no league, or a league the Seattle teams are not in, reads no place", async () => {
    for (const leagues of ["none", "other"] as const) {
      const t = newT();
      const w = await seedWorld(t, { leagues });
      await player(t, w.sportId, "Don Mincher", PILOTS_STINT(w));
      const result = await gate(t, w, [makeCard({ players: ["Don Mincher"] })]);
      expect(result.unknownTeams).toEqual([PLACE]);
      // Asked, not decided, and no candidates to offer: nothing read a place.
      expect(teamLinks(result)).toEqual([]);
      const items = await pendingTeamItems(t, w, [makeCard({ players: ["Don Mincher"] })]);
      expect(items.flatMap((i) => i.candidateTeamIds ?? [])).toEqual([]);
    }
  });

  test("a team some row already answers to by name is a name, not a place", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(w.mariners, { aliases: [PLACE] });
      await ctx.db.insert("teamAliases", {
        teamId: w.mariners,
        sportId: w.sportId,
        aliasNormalized: normalizeTeamName(PLACE),
      });
    });
    await player(t, w.sportId, "Don Mincher", PILOTS_STINT(w));

    const result = await gate(t, w, [makeCard({ players: ["Don Mincher"] })]);

    // One row answers to the name (the alias): it links as a name always did,
    // and the place leg never ran, so the Pilots stint was not consulted.
    expect(result.unknownTeams).toEqual([]);
    expect(teamLinks(result).some((l) => l.teamId === w.pilots)).toBe(false);
  });

  test("resolveGateTeamNames: the answer's shape, and a caller without the set reads no place", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const mincher = await player(t, w.sportId, "Don Mincher", PILOTS_STINT(w));
    const ask = (withSet: boolean, cardPlayerIds?: Id<"players">[][]) =>
      t.query(internal.selectorOptions.resolveGateTeamNames, {
        sportId: w.sportId,
        ...(withSet ? { selectorOptionId: w.leafId } : {}),
        setYear: 2001,
        asks: [{ name: PLACE, ...(cardPlayerIds ? { cardPlayerIds } : {}) }],
      });

    const byPlayers = (await ask(true, [[mincher]]))[0];
    expect(byPlayers.ambiguous).toBe(false);
    expect(byPlayers.answer).toMatchObject({
      teamId: w.pilots,
      via: "players",
      agreesWithYear: false,
      fullName: "Seattle Pilots",
    });
    const noPlayers = (await ask(true))[0];
    expect(noPlayers).toMatchObject({ answer: null, ambiguous: true, place: true });
    expect(byPlayers.place).toBe(true);
    expect([...noPlayers.candidateTeamIds].sort()).toEqual([w.pilots, w.mariners].sort());
    expect((await ask(false, [[mincher]]))[0]).toEqual({
      answer: null,
      ambiguous: false,
      candidateTeamIds: [],
    });
  });
});

describe("the commit prelude: the same place, the same answers, never silently against the year", () => {
  test("a Mariners player links the Mariners (the evidence agrees with the year)", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await player(t, w.sportId, "Ichiro Suzuki", MARINERS_STINT(w));

    const result = await commit(t, w, [makeCard({ players: ["Ichiro Suzuki"] })]);

    expect(result.unreviewedNameCount).toBe(0);
    expect((await storedCards(t, w))[0].teamOnCardIds).toEqual([w.mariners]);
  });

  test("a Pilots player is NOT linked silently without the gate's row: the name is left unreviewed", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await player(t, w.sportId, "Don Mincher", PILOTS_STINT(w));

    const result = await commit(t, w, [makeCard({ players: ["Don Mincher"] })]);

    expect(result.unreviewedNameCount).toBe(1);
    const [card] = await storedCards(t, w);
    expect(card.teamOnCardIds ?? []).toEqual([]);
    expect(card.pendingTeamNames).toEqual([PLACE]);
  });

  test("gate then commit: the gate's visible Pilots row is what the commit links", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await player(t, w.sportId, "Don Mincher", PILOTS_STINT(w));
    const cards = [makeCard({ players: ["Don Mincher"] })];

    const asked = await gate(t, w, cards);
    expect(asked.unknownTeams).toEqual([]);
    const result = await commit(t, w, cards, { gateLinks: asked.gateLinks });

    expect(result.unreviewedNameCount).toBe(0);
    expect((await storedCards(t, w))[0].teamOnCardIds).toEqual([w.pilots]);
  });

  test("no player evidence: left to the operator, whichever team the year favours", async () => {
    const t = newT();
    const w = await seedWorld(t);

    const result = await commit(t, w, [makeCard({ players: [] })]);

    expect(result.unreviewedNameCount).toBe(1);
    const [card] = await storedCards(t, w);
    expect(card.teamOnCardIds ?? []).toEqual([]);
    expect(card.pendingTeamNames).toEqual([PLACE]);
  });

  test("a split between cards is left to the operator", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await player(t, w.sportId, "Don Mincher", PILOTS_STINT(w));
    await player(t, w.sportId, "Ichiro Suzuki", MARINERS_STINT(w));

    const result = await commit(t, w, [
      makeCard({ cardNumber: "1", players: ["Don Mincher"] }),
      makeCard({ cardNumber: "2", players: ["Ichiro Suzuki"] }),
    ]);

    expect(result.unreviewedNameCount).toBe(1);
    for (const card of await storedCards(t, w)) expect(card.teamOnCardIds ?? []).toEqual([]);
  });

  test("a New player card gives no evidence: his namesake's Mariners stint does not link, nor do the other cards alone", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await player(t, w.sportId, "Bob Allen", MARINERS_STINT(w));
    await player(t, w.sportId, "Ichiro Suzuki", MARINERS_STINT(w));

    const result = await commit(
      t,
      w,
      [
        makeCard({
          cardNumber: "1",
          players: ["Bob Allen"],
          newPlayerByName: [{ name: "Bob Allen", ref: "np-one" }],
        }),
        makeCard({ cardNumber: "2", players: ["Ichiro Suzuki"] }),
      ],
      { careerNewPlayers: [{ ref: "np-one", name: "Bob Allen", stints: [] }] },
    );

    expect(result.unreviewedNameCount).toBe(1);
    for (const card of await storedCards(t, w)) {
      expect(card.teamOnCardIds ?? []).toEqual([]);
      expect(card.pendingTeamNames).toEqual([PLACE]);
    }
  });

  test("a re-linked card reads the CHOSEN player's career, not the printed name's", async () => {
    const t = newT();
    const w = await seedWorld(t);
    // The printed name resolves to a Pilots man; the operator chose the right,
    // Mariners, player.
    await player(t, w.sportId, "Bob Allen", PILOTS_STINT(w));
    const chosen = await t.run((ctx) =>
      ctx.db.insert("players", {
        name: "Bob Allen",
        nameNormalized: normalizePlayerName("Bob Allen"),
        sportId: w.sportId,
        teamYears: MARINERS_STINT(w),
        creationRef: "other-bob",
        lastUpdated: Date.now(),
      }),
    );

    const result = await commit(t, w, [
      makeCard({
        players: ["Bob Allen"],
        playerIdByName: [{ name: "Bob Allen", playerId: chosen }],
      }),
    ]);

    expect(result.unreviewedNameCount).toBe(0);
    expect((await storedCards(t, w))[0].teamOnCardIds).toEqual([w.mariners]);
  });

  test("a retry reads the same evidence: the row its own earlier attempt minted is not a namesake", async () => {
    const t = newT();
    const w = await seedWorld(t);
    await player(t, w.sportId, "Bob Allen", MARINERS_STINT(w));
    const np = [{ ref: "np-one", name: "Bob Allen", stints: [] as never[] }];
    const cards = () => [
      makeCard({
        cardNumber: "1",
        players: ["Bob Allen"],
        teams: [],
        newPlayerByName: [{ name: "Bob Allen", ref: "np-one" }],
      }),
      makeCard({ cardNumber: "2", players: ["Bob Allen"] }),
    ];
    const teamOf = async () =>
      (await storedCards(t, w)).find((c) => c.cardNumber === "2")!.teamOnCardIds ?? [];

    const first = await commit(t, w, cards(), { careerNewPlayers: np });
    expect(first.careerNewPlayers).toMatchObject({ created: 1, adopted: 0 });
    expect(await teamOf()).toEqual([w.mariners]);

    // Weighed as a second namesake the player would be "ambiguous", the
    // evidence dropped, and the place left to the operator.
    const second = await commit(t, w, cards(), { careerNewPlayers: np });
    expect(second.careerNewPlayers).toMatchObject({ created: 0, adopted: 1 });
    expect(await teamOf()).toEqual([w.mariners]);
    expect(second.unreviewedNameCount).toBe(0);
  });

  test("a place only one in-league team holds is no place here (pairing settles it; otherwise the operator)", async () => {
    const t = newT();
    const w = await seedWorld(t, { only: ["mariners"] });
    await player(t, w.sportId, "Ichiro Suzuki", MARINERS_STINT(w));

    const result = await commit(t, w, [makeCard({ players: ["Ichiro Suzuki"] })]);

    expect(result.unreviewedNameCount).toBe(1);
  });
});

describe("the commit prelude: bounds on what it is handed and what it reads", () => {
  /**
   * `teamPlayerNames[].cardPlayerIds` pairs with `cards` by index. A list of
   * another length cannot say which card is which, so it is no evidence at
   * all (never a mis-attribution to the card at the same index).
   */
  async function preludeTeam(
    t: T,
    w: World,
    cardPlayerIds: Array<Array<{ name: string; playerId: Id<"players"> }>>,
  ) {
    const result = await t.withIdentity(ADMIN).mutation(
      internal.selectorOptions.commitCardChecklistPrelude,
      {
        selectorOptionId: w.leafId,
        sportId: w.sportId,
        playerNames: [],
        teamNames: [PLACE],
        teamPlayerNames: [
          {
            teamNameNormalized: normalizeTeamName(PLACE),
            cards: [["Bob Allen"]],
            cardPlayerIds,
          },
        ],
      },
    );
    return result.teamIdByName.find((e) => e.name === PLACE)?.id;
  }

  async function bobWorld(t: T) {
    const w = await seedWorld(t);
    // The printed name resolves to the one Pilots man...
    await player(t, w.sportId, "Bob Allen", PILOTS_STINT(w));
    // ...and the operator chose another person for it on the card.
    const chosen = await t.run((ctx) =>
      ctx.db.insert("players", {
        name: "Robert Allen",
        nameNormalized: normalizePlayerName("Robert Allen"),
        sportId: w.sportId,
        teamYears: MARINERS_STINT(w),
        lastUpdated: Date.now(),
      }),
    );
    return { w, chosen };
  }

  test("a cardPlayerIds list as long as cards is read: the chosen player's Mariners career links", async () => {
    const t = newT();
    const { w, chosen } = await bobWorld(t);
    expect(await preludeTeam(t, w, [[{ name: "Bob Allen", playerId: chosen }]])).toBe(w.mariners);
  });

  test("a cardPlayerIds list longer than cards is ignored: no re-link evidence, nothing mis-attributed", async () => {
    const t = newT();
    const { w, chosen } = await bobWorld(t);
    // Index 0 would say Mariners if it were read; the extra entry makes the
    // list unpairable, so the printed name's Pilots career is all there is,
    // and a Pilots answer against the year is never linked silently.
    expect(
      await preludeTeam(t, w, [[{ name: "Bob Allen", playerId: chosen }], []]),
    ).toBeUndefined();
  });

  test("a cardPlayerIds list shorter than cards is ignored the same way", async () => {
    const t = newT();
    const { w, chosen } = await bobWorld(t);
    await player(t, w.sportId, "Ichiro Suzuki", MARINERS_STINT(w));
    // Read, the one entry would turn card 1 Mariners and agree with card 2;
    // ignored, card 1 is the Pilots man and the two cards split.
    const result = await t.withIdentity(ADMIN).mutation(
      internal.selectorOptions.commitCardChecklistPrelude,
      {
        selectorOptionId: w.leafId,
        sportId: w.sportId,
        playerNames: [],
        teamNames: [PLACE],
        teamPlayerNames: [
          {
            teamNameNormalized: normalizeTeamName(PLACE),
            cards: [["Bob Allen"], ["Ichiro Suzuki"]],
            cardPlayerIds: [[{ name: "Bob Allen", playerId: chosen }]],
          },
        ],
      },
    );
    expect(result.teamIdByName.find((e) => e.name === PLACE)).toBeUndefined();
  });

  /**
   * The place search is a bounded read per name. The prelude asks about a
   * name in its create-decision branch and again in its resolve phase, handing
   * the same `placeCache` each time, so the name searches once.
   */
  test("a name resolved twice with one placeCache searches the place once", async () => {
    const t = newT();
    const w = await seedWorld(t);
    const searches = await t.run(async (ctx) => {
      let count = 0;
      const db = new Proxy(ctx.db, {
        get(target, prop) {
          if (prop !== "query") {
            const value = Reflect.get(target, prop);
            return typeof value === "function" ? value.bind(target) : value;
          }
          return (table: never) => {
            const q = (target.query as (t: never) => object)(table);
            return new Proxy(q, {
              get(qt, p) {
                if (p === "withSearchIndex") count += 1;
                const value = Reflect.get(qt, p);
                return typeof value === "function" ? value.bind(qt) : value;
              },
            });
          };
        },
      });
      const counted = { ...ctx, db } as typeof ctx;
      const leagues = new Set<string>(
        (await ctx.db.query("leagues").collect()).filter((l) => l.level === "major").map((l) => l._id),
      );
      const options = { placeLeagueIds: async () => leagues };

      const cache = new Map();
      const first = await resolveCardTeamName(counted, w.sportId, PLACE, 2001, {
        ...options,
        placeCache: cache,
      });
      const afterFirst = count;
      const second = await resolveCardTeamName(counted, w.sportId, "  seattle ", 2001, {
        ...options,
        placeCache: cache,
      });
      const afterSecond = count;
      // No cache: the search repeats (the control for the claim above).
      await resolveCardTeamName(counted, w.sportId, PLACE, 2001, options);
      const afterUncached = count;
      // A cleared cache searches again (a team was written between).
      cache.clear();
      await resolveCardTeamName(counted, w.sportId, PLACE, 2001, { ...options, placeCache: cache });
      return {
        afterFirst,
        afterSecond,
        afterUncached,
        afterCleared: count,
        sameCandidates:
          first.candidates.map((r) => r._id).join() === second.candidates.map((r) => r._id).join(),
        candidateCount: first.candidates.length,
      };
    });

    expect(searches.candidateCount).toBe(2);
    expect(searches.sameCandidates).toBe(true);
    expect(searches.afterFirst).toBeGreaterThanOrEqual(1);
    expect(searches.afterSecond).toBe(searches.afterFirst);
    expect(searches.afterUncached).toBeGreaterThan(searches.afterSecond);
    expect(searches.afterCleared).toBeGreaterThan(searches.afterUncached);
  });
});
