/**
 * NEO-656 — `tidyLeafFacts` answers, after the commit, exactly what the review
 * gate answered at fetch time.
 *
 * origin/main's gate used the FETCHED cards' co-printed teams and players to
 * break ties (a printed team narrows a same-name player; a team name two eras
 * share is settled by the players printed on the cards that name it) and wrote
 * the answer on a `tidyNames` row. Nothing is stored now, so the walk asks
 * again with the cards the commit left behind. The same fixture goes through
 * both: `computeGateFacts` with the inputs `gateCardInputs` builds from the
 * fetched cards, then `tidyLeafFacts` over the committed ones. For every name
 * still pending, the preselect, the history pick and the candidate teams must
 * be identical. A run with the card-level inputs taken away differs, which is
 * what proves the fixture exercises them.
 */

import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { normalizePlayerName } from "./players";
import { normalizeTeamName } from "./teams";
import { computeGateFacts, gateCardInputs, gateInputsOfStoredCards } from "./selectorOptions";
import { cancelScheduled } from "../lib/testing/drain-scheduled";
import { insertTestCard } from "../lib/testing/card-row";
import { committedCard, node, playerRow, product, teamRow } from "../lib/testing/neo592-gate-fixture";

const modules = (import.meta as unknown as {
  glob: (pattern: string) => Record<string, () => Promise<unknown>>;
}).glob("./**/*.*s");

const ADMIN = {
  subject: "admin_neo656_leaf_001",
  issuer: "https://clerk.example.com",
  tokenIdentifier: "clerk|admin_neo656_leaf_001",
  name: "Admin User",
  role: "admin",
};

type T = ReturnType<typeof convexTest>;

const live: T[] = [];
afterEach(async () => {
  for (const t of live.splice(0)) await cancelScheduled(t);
  vi.restoreAllMocks();
});

const fetched = (n: number, players: string[], teams: string[]) => ({
  cardNumber: `I-${n}`,
  cardName: "Card",
  players,
  teams,
  platformData: {},
});

async function world() {
  const t = convexTest(schema, modules);
  live.push(t);
  const baseball = await node(t, { level: "sport", value: "Baseball" });
  const football = await node(t, { level: "sport", value: "Football" });
  const prior = await product(t, baseball, { year: "2012" });
  const now = await product(t, baseball, { year: "2013" });

  const mets = await teamRow(t, baseball, "New York", "Mets");
  const reds = await teamRow(t, baseball, "Cincinnati", "Reds");
  const oldJets = await teamRow(t, baseball, "Winnipeg", "Jets", {
    yearsActive: { from: 1972, to: 1996 },
  });
  await teamRow(t, baseball, "Winnipeg", "Jets", { yearsActive: { from: 2011 } });

  // Two Luis Castillos, both active in 2013: the card's printed team tells them apart.
  const castilloMets = await playerRow(t, baseball, "Luis Castillo", {
    teamYears: [{ teamId: mets, fromYear: 2013, toYear: 2013 }],
  });
  await playerRow(t, baseball, "Luis Castillo", {
    teamYears: [{ teamId: reds, fromYear: 2013, toYear: 2013 }],
  });
  // The Jets' cards: one player of the old era, one with no career on either row.
  // The set's year covers only the modern row.
  const silentJet = await playerRow(t, baseball, "Silent Jet");
  const oldJet = await playerRow(t, baseball, "Old Jet", {
    teamYears: [{ teamId: oldJets, fromYear: 1990, toYear: 1991 }],
  });
  // Two same-name players the set has already linked, and two the lookup cannot tell apart.
  const twinA = await playerRow(t, baseball, "Pat Twin");
  const twinB = await playerRow(t, baseball, "Pat Twin");
  await playerRow(t, baseball, "Bob Allen", { birthYear: 1867 });
  await playerRow(t, baseball, "Bob Allen", { birthYear: 1937 });
  // A football player the prior year's product linked to the name (rule E1).
  const marino = await playerRow(t, football, "Dan Marino");
  await committedCard(t, prior.base, "1", { printed: [["Dan Marino", marino]] });
  // Set history: the set's own committed cards link "Pat Twin" to both (rule A, a pick).
  await committedCard(t, now.base, "1", { printed: [["Pat Twin", twinA]] });
  await committedCard(t, now.base, "2", { printed: [["Pat Twin", twinB]] });

  const cards = [
    fetched(1, ["Luis Castillo", "Bob Allen"], ["New York Mets"]),
    fetched(2, ["Old Jet"], ["Winnipeg Jets"]),
    fetched(3, ["Silent Jet"], ["Winnipeg Jets"]),
    fetched(4, ["Dan Marino", "Pat Twin", "Stranger"], []),
  ];
  return {
    t,
    baseball,
    cards,
    leaf: now.insert,
    ids: { mets, castilloMets, oldJet, silentJet, oldJets, marino, twinA, twinB },
  };
}

type W = Awaited<ReturnType<typeof world>>;

/** The gate's own derivation, run at fetch time over the fetched cards. */
async function gateFactsAtFetch(w: W, withCardInputs: boolean) {
  const prelude = await w.t.query(internal.selectorOptions.reviewGatePrelude, {
    selectorOptionId: w.leaf,
    sportId: w.baseball,
  });
  const ctx = {
    runQuery: (ref: any, args: any) => w.t.query(ref, args),
    runMutation: (ref: any, args: any) => w.t.mutation(ref, args),
  } as unknown as ActionCtx;
  const inputs = gateCardInputs(w.cards);
  return computeGateFacts(ctx, {
    selectorOptionId: w.leaf,
    sportId: w.baseball,
    sportLabel: prelude.sportLabel,
    additionalPlayerNames: inputs.additionalPlayerNames,
    additionalTeamNames: inputs.additionalTeamNames,
    ...(withCardInputs
      ? {
          cardTeamNamesByPlayer: inputs.cardTeamNamesByPlayer,
          cardPlayerNamesByTeam: inputs.cardPlayerNamesByTeam,
        }
      : {}),
    prelude,
    timing: { hops: 0, phases: {} },
  });
}

/**
 * What the commit leaves behind: the names the gate settled are linked on their
 * cards, the ones it did not are pending names.
 */
async function commit(w: W) {
  const { ids } = w;
  const store = (row: Parameters<typeof insertTestCard>[1]) =>
    w.t.run((ctx) => insertTestCard(ctx, row));
  const base = {
    selectorOptionId: w.leaf,
    cardName: "Card",
    platformData: {},
    sortOrder: 0,
    lastUpdated: 1,
  };
  await store({
    ...base,
    cardNumber: "I-1",
    playerIds: [ids.castilloMets],
    playerLinks: [{ playerId: ids.castilloMets, nameOnCard: "Luis Castillo" }],
    pendingPlayerNames: ["Bob Allen"],
    teamOnCardIds: [ids.mets],
  });
  await store({
    ...base,
    cardNumber: "I-2",
    playerIds: [ids.oldJet],
    playerLinks: [{ playerId: ids.oldJet, nameOnCard: "Old Jet" }],
    pendingTeamNames: ["Winnipeg Jets"],
  });
  await store({
    ...base,
    cardNumber: "I-3",
    playerIds: [ids.silentJet],
    playerLinks: [{ playerId: ids.silentJet, nameOnCard: "Silent Jet" }],
    pendingTeamNames: ["Winnipeg Jets"],
  });
  await store({
    ...base,
    cardNumber: "I-4",
    pendingPlayerNames: ["Dan Marino", "Pat Twin", "Stranger"],
  });
}

const tidyFacts = (w: W) =>
  w.t.withIdentity(ADMIN).action(api.selectorOptions.tidyLeafFacts, { selectorOptionId: w.leaf });

/** The fields the walk decides from, per name. */
const pick = (items: ReadonlyArray<Record<string, any>>) =>
  items
    .map((i) => ({
      kind: i.kind,
      name: i.name,
      preselect: i.preselect,
      historyPlayerIds: i.historyPlayerIds,
      candidateTeamIds: i.candidateTeamIds,
      candidatePlace: i.candidatePlace,
      noExistingMatch: i.noExistingMatch,
      auto: i.auto,
    }))
    .sort((a, b) => `${a.kind}|${a.name}`.localeCompare(`${b.kind}|${b.name}`));

const jetsOf = (facts: { gateItems: ReadonlyArray<Record<string, any>> }) =>
  facts.gateItems.find((i) => i.kind === "team" && i.name === "Winnipeg Jets");

describe("tidyLeafFacts after the commit equals the gate at fetch time", () => {
  test("preselect, history pick, candidate teams and links are the gate's, name for name", async () => {
    const w = await world();
    const gate = await gateFactsAtFetch(w, true);

    // What the card-level inputs change in this fixture: the printed team
    // settled one Castillo (no name to ask about), and one Jets card names an
    // old-era player while the other names nobody with a career, so the year's
    // modern row is not the players' to confirm: the operator picks, from both.
    expect(gate.unknownPlayers).not.toContain("Luis Castillo");
    expect(gate.unknownTeams).toEqual(["Winnipeg Jets"]);
    expect(jetsOf(gate)?.candidateTeamIds).toHaveLength(2);
    const twin = gate.gateItems.find((i) => i.kind === "player" && i.name === "Pat Twin");
    expect(twin?.historyPlayerIds).toHaveLength(2);
    const marino = gate.gateItems.find((i) => i.kind === "player" && i.name === "Dan Marino");
    expect(marino?.preselect?.playerId).toBe(w.ids.marino);

    // The commit linked what it could and left these names pending on the cards
    // (the Jets too: a visible link is the walk's to show, never to apply).
    await commit(w);
    const walk = await tidyFacts(w);

    expect(pick(walk.gateItems)).toEqual(pick(gate.gateItems));
    expect(walk.unknownPlayers).toEqual(gate.unknownPlayers);
    expect(walk.unknownTeams).toEqual(gate.unknownTeams);
    expect(walk.ambiguousPlayers).toEqual(gate.ambiguousPlayers);
    expect(walk.autoLinkedCount).toBe(gate.autoLinkedCount);
  });

  test("the fixture bites: without the card-level inputs the gate answers differently", async () => {
    const w = await world();
    const withCards = await gateFactsAtFetch(w, true);
    const without = await gateFactsAtFetch(w, false);
    expect(withCards.unknownPlayers).not.toContain("Luis Castillo");
    expect(without.unknownPlayers).toContain("Luis Castillo");
    expect(withCards.unknownTeams).toEqual(["Winnipeg Jets"]);
    expect(jetsOf(withCards)?.candidateTeamIds).toHaveLength(2);
    // The year alone picks the modern row, so there is nothing to ask.
    expect(without.unknownTeams).toEqual([]);
    expect(jetsOf(without)).toBeUndefined();
  });

  test("a pending name the card's printed team settles is no name to ask about", async () => {
    const w = await world();
    await w.t.run((ctx) =>
      insertTestCard(ctx, {
        selectorOptionId: w.leaf,
        cardNumber: "I-1",
        cardName: "Card",
        platformData: {},
        sortOrder: 0,
        lastUpdated: 1,
        teamOnCardIds: [w.ids.mets],
        pendingPlayerNames: ["Luis Castillo"],
      }),
    );
    const walk = await tidyFacts(w);
    expect(walk.unknownPlayers).toEqual([]);
    expect(walk.ambiguousPlayers).toEqual([]);
  });

  test("stored cards file the same inputs the fetched cards did", async () => {
    const w = await world();
    const fetchedInputs = gateCardInputs(w.cards);
    const storedInputs = gateInputsOfStoredCards(
      [
        {
          cardNumber: "I-2",
          playerNames: ["Old Jet"],
          teamNames: ["Winnipeg Jets"],
          pendingTeamNames: ["Winnipeg Jets"],
        },
        {
          cardNumber: "I-3",
          playerNames: ["Silent Jet"],
          teamNames: ["Winnipeg Jets"],
          pendingTeamNames: ["Winnipeg Jets"],
        },
      ],
      ["Winnipeg Jets"],
    );
    const jets = normalizeTeamName("Winnipeg Jets");
    expect(storedInputs.cardPlayerNamesByTeam.get(jets)?.cards).toEqual(
      fetchedInputs.cardPlayerNamesByTeam.get(jets)?.cards,
    );
    expect(storedInputs.cardTeamNamesByPlayer.get(normalizePlayerName("Old Jet"))).toEqual(
      fetchedInputs.cardTeamNamesByPlayer.get(normalizePlayerName("Old Jet")),
    );
  });
});

describe("tidyLeafFacts reads the cards cross-listed into the leaf too", () => {
  test("a guest card's printed players settle a pending team", async () => {
    const w = await world();
    const other = await product(w.t, w.baseball, { year: "2013", set: "Update" });
    const guest = await w.t.run((ctx) =>
      insertTestCard(ctx, {
        selectorOptionId: other.insert,
        cardNumber: "G-1",
        cardName: "Card",
        platformData: {},
        sortOrder: 0,
        lastUpdated: 1,
        playerIds: [w.ids.oldJet],
        playerLinks: [{ playerId: w.ids.oldJet, nameOnCard: "Old Jet" }],
        pendingTeamNames: ["Winnipeg Jets"],
      }),
    );
    await w.t.run((ctx) =>
      ctx.db.insert("cardCrossListings", {
        cardChecklistId: guest as Id<"cardChecklist">,
        selectorOptionId: w.leaf,
        lastUpdated: 1,
      }),
    );
    const walk = await tidyFacts(w);
    // One card, one old-era player: the players' stints answer against the
    // year, so the name is a visible link, not a plain year pick.
    expect(walk.gateItems.find((i) => i.kind === "team")?.auto?.origin).toBe("careerTeam");
  });
});
