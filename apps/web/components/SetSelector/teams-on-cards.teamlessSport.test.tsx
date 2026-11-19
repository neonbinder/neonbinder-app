/**
 * NEO-426 — the client half of "a teamless sport defaults a card to No team":
 * `autoNoTeamIndexes` (cards the commit stamps without asking),
 * `teamlessCardIndexes` (cards still asked about) and `cardsForTeamsStep`
 * (the step's membership).
 *
 * `takesNoTeamByDefault` is private, so every case here reads it through the
 * partition it drives: a card that would save with no team is in EXACTLY ONE of
 * `autoNoTeamIndexes` and `teamlessCardIndexes`. `partition` asserts that on
 * every call, so no case can forget a side.
 *
 * Client against server, on one shared table, is
 * `teamlessSport.clientServerParity.test.tsx`.
 *
 * `.test.tsx` because `.test.ts` is not collected under components/ (see
 * vitest.include.mjs).
 */

import { describe, expect, test } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import { normalizeEntityName } from "../../convex/lib/entityNearMatch";
import { cardsForTeamsStep } from "./entity-review-steps";
import {
  autoNoTeamIndexes,
  storedPeople,
  teamlessCardIndexes,
  type PreviewCardForTeams,
  type StoredPeople,
  type TeamlessFacts,
  type TeamsReviewRow,
} from "./teams-on-cards";

const NONE = "sport_none"; // flagged "No teams in this sport"
const BALL = "sport_ball"; // has teams
const pid = (s: string) => `player_${s}` as Id<"players">;

let rowCounter = 0;
function row(partial: Omit<TeamsReviewRow, "_id">): TeamsReviewRow {
  rowCounter += 1;
  return { _id: `row_${rowCounter}`, ...partial };
}
/** A player the operator is creating, born in `sportId`. */
const created = (name: string, sportId: string | null = NONE) =>
  row({ kind: "player", name, ...(sportId ? { sportId } : {}), decision: { action: "create" } });
/** A team name no review row has decided yet: its string does not resolve. */
const pendingTeam = (name: string) => row({ kind: "team", name, decision: null });
/** A player the operator linked to an existing player row. */
const linked = (name: string, playerId: string) =>
  row({ kind: "player", name, decision: { action: "link", linkedPlayerId: playerId } });
const undecided = (name: string) => row({ kind: "player", name, decision: null });
const skippedPlayer = (name: string) =>
  row({ kind: "player", name, decision: { action: "skip" } });
const skippedTeam = (name: string) => row({ kind: "team", name, decision: { action: "skip" } });

function card(over: Partial<PreviewCardForTeams> = {}): PreviewCardForTeams {
  return { cardNumber: "1", cardName: "Card 1", players: ["Pat Nonsport"], ...over };
}

const FLAGGED: TeamlessFacts = { teamlessSportIds: [NONE] };

function people(
  facts: TeamlessFacts = FLAGGED,
  playerless?: readonly number[],
  skippedPlayers?: readonly string[],
  skippedTeams?: readonly string[],
) {
  return storedPeople(playerless, skippedPlayers, skippedTeams, undefined, facts);
}

/** Both sides of the partition, with the partition itself asserted. */
function partition(
  cards: PreviewCardForTeams[],
  rows: TeamsReviewRow[],
  stored: StoredPeople | undefined,
  settled?: ReadonlySet<number>,
) {
  const auto = autoNoTeamIndexes(cards, rows, settled, stored);
  const asked = teamlessCardIndexes(cards, rows, settled, stored);
  expect(auto.filter((i) => asked.includes(i))).toEqual([]);
  return { auto, asked };
}

describe("storedPeople: the teamless facts", () => {
  test("carries nothing (undefined) when no sport is flagged and no name is teamless", () => {
    expect(storedPeople(undefined, undefined, undefined, undefined, {})).toBeUndefined();
    expect(
      storedPeople(undefined, undefined, undefined, undefined, {
        teamlessSportIds: [],
        playerSportIds: new Map([[pid("a"), BALL]]),
        existingIndexes: [0],
      }),
    ).toBeUndefined();
  });

  test("drops the per-player sports and existing positions beside no flagged sport", () => {
    const stored = storedPeople([3], undefined, undefined, undefined, {
      playerSportIds: new Map([[pid("a"), NONE]]),
      existingIndexes: [0],
    });
    expect(stored?.playerSportIds).toBeUndefined();
    expect(stored?.existingPositions).toBeUndefined();
    expect([...(stored?.playerless ?? [])]).toEqual([3]);
  });

  test("a resolved name alone (no flagged sport id) is enough to carry the facts", () => {
    const stored = storedPeople(undefined, undefined, undefined, undefined, {
      teamlessPlayerNames: ["  Pat Nonsport "],
      existingIndexes: [2],
    });
    expect([...(stored?.teamlessPlayerNames ?? [])]).toEqual([normalizeEntityName("Pat Nonsport")]);
    expect([...(stored?.existingPositions ?? [])]).toEqual([2]);
  });
});

describe("autoNoTeamIndexes / teamlessCardIndexes: who counts as teamless", () => {
  test("a created player whose sport is flagged: the card is stamped, not asked", () => {
    const { auto, asked } = partition([card()], [created("Pat Nonsport")], people());
    expect(auto).toEqual([0]);
    expect(asked).toEqual([]);
  });

  test("a created player in a sport with teams: the card is asked", () => {
    const { auto, asked } = partition([card()], [created("Pat Nonsport", BALL)], people());
    expect(auto).toEqual([]);
    expect(asked).toEqual([0]);
  });

  test("a created player with no sport on his row is not teamless", () => {
    const { auto, asked } = partition([card()], [created("Pat Nonsport", null)], people());
    expect([auto, asked]).toEqual([[], [0]]);
  });

  test("a linked player is teamless by his stored HOME sport", () => {
    const facts: TeamlessFacts = {
      ...FLAGGED,
      playerSportIds: new Map([[pid("pat"), NONE]]),
    };
    const { auto } = partition([card()], [linked("Pat Nonsport", pid("pat"))], people(facts));
    expect(auto).toEqual([0]);
  });

  test("a linked player whose sport has not loaded yet is asked, never assumed teamless", () => {
    const { auto, asked } = partition(
      [card()],
      [linked("Pat Nonsport", pid("pat"))],
      people({ ...FLAGGED, playerSportIds: new Map() }),
    );
    expect([auto, asked]).toEqual([[], [0]]);
  });

  test("a name resolved before the sitting is teamless only when the fetch said so", () => {
    const named = people({ teamlessPlayerNames: ["PAT NONSPORT"] });
    expect(partition([card()], [], named).auto).toEqual([0]);
    // Another name on the same flagged facts is not.
    expect(partition([card({ players: ["Someone Else"] })], [], named).asked).toEqual([0]);
  });

  test("a mixed card (one teamless person, one not) is asked", () => {
    const { auto, asked } = partition(
      [card({ players: ["Pat Nonsport", "Ron Ballplayer"] })],
      [created("Pat Nonsport"), created("Ron Ballplayer", BALL)],
      people(),
    );
    expect([auto, asked]).toEqual([[], [0]]);
  });

  test("a card of two teamless people is stamped", () => {
    expect(
      partition(
        [card({ players: ["Pat Nonsport", "Kim Nonsport"] })],
        [created("Pat Nonsport"), created("Kim Nonsport")],
        people(),
      ).auto,
    ).toEqual([0]);
  });

  test("a card with nobody on it is asked: nothing says what sport it is", () => {
    const { auto, asked } = partition([card({ players: [] })], [], people());
    expect([auto, asked]).toEqual([[], [0]]);
  });

  test("with no flagged sport at all, nothing is stamped", () => {
    expect(autoNoTeamIndexes([card()], [created("Pat Nonsport")], undefined, undefined)).toEqual(
      [],
    );
    expect(
      autoNoTeamIndexes([card()], [created("Pat Nonsport")], undefined, people({})),
    ).toEqual([]);
  });

  test("a person ruled 'not a person' is nobody: the others decide, and alone he leaves nobody", () => {
    const withTeamless = partition(
      [card({ players: ["Pat Nonsport", "Checklist Header"] })],
      [created("Pat Nonsport"), skippedPlayer("Checklist Header")],
      people(),
    );
    expect(withTeamless.auto).toEqual([0]);
    const alone = partition(
      [card({ players: ["Checklist Header"] })],
      [skippedPlayer("Checklist Header")],
      people(),
    );
    expect([alone.auto, alone.asked]).toEqual([[], [0]]);
  });

  test("a name an earlier save ruled 'not a person' is nobody too", () => {
    const stored = people(FLAGGED, undefined, ["Checklist Header"]);
    const { auto } = partition(
      [card({ players: ["Pat Nonsport", "Checklist Header"] })],
      [created("Pat Nonsport")],
      stored,
    );
    expect(auto).toEqual([0]);
  });

  test("a card the save keeps with no players is asked (playerless)", () => {
    const { auto, asked } = partition([card()], [created("Pat Nonsport")], people(FLAGGED, [0]));
    expect([auto, asked]).toEqual([[], [0]]);
  });
});

describe("autoNoTeamIndexes: a data claim holds the default back (invariant 8)", () => {
  const rows = () => [created("Pat Nonsport")];

  test("a listing team the card carries as a printed string asks the operator", () => {
    const { auto, asked } = partition(
      [card({ teams: ["Cubs"] })],
      [...rows(), pendingTeam("Cubs")],
      people(),
    );
    expect([auto, asked]).toEqual([[], [0]]);
  });

  test("the legacy singular `team` is a claim too", () => {
    expect(partition([card({ team: "Cubs" })], [...rows(), pendingTeam("Cubs")], people()).asked).toEqual([0]);
  });

  test("BSC's unsplit rawTeamName is a claim even with no team strings", () => {
    const { auto, asked } = partition([card({ rawTeamName: "Cubs" })], rows(), people());
    expect([auto, asked]).toEqual([[], [0]]);
  });

  test("a blank rawTeamName is no claim", () => {
    expect(partition([card({ rawTeamName: "   " })], rows(), people()).auto).toEqual([0]);
  });

  test("a printed team the operator ruled 'not a team' in this sitting no longer holds it back", () => {
    const { auto } = partition(
      [card({ teams: ["Wilson Glove"] })],
      [...rows(), skippedTeam("Wilson Glove")],
      people(),
    );
    expect(auto).toEqual([0]);
  });

  test("a printed team an earlier save ruled out no longer holds it back", () => {
    const stored = people(FLAGGED, undefined, undefined, ["Wilson Glove"]);
    expect(partition([card({ teams: ["Wilson Glove"] })], rows(), stored).auto).toEqual([0]);
  });

  test("rawTeamName ruled out by its team row no longer holds it back", () => {
    const { auto } = partition(
      [card({ rawTeamName: "Wilson Glove" })],
      [...rows(), skippedTeam("Wilson Glove")],
      people(),
    );
    expect(auto).toEqual([0]);
  });

  test("some printed strings ruled out: the REMAINING one still claims a team", () => {
    const { auto, asked } = partition(
      [card({ teams: ["Wilson Glove", "Cubs"] })],
      [...rows(), skippedTeam("Wilson Glove"), pendingTeam("Cubs")],
      people(),
    );
    expect([auto, asked]).toEqual([[], [0]]);
  });

  test("a printed team with no review row was resolved before the sitting: the card has a team", () => {
    const { auto, asked } = partition([card({ teams: ["Cubs"] })], rows(), people());
    expect([auto, asked]).toEqual([[], []]);
  });

  test("a printed team that resolves gives the card a team: neither stamped nor asked", () => {
    const { auto, asked } = partition(
      [card({ teams: ["Cubs"] })],
      [
        ...rows(),
        row({ kind: "team", name: "Cubs", decision: { action: "create" } }),
      ],
      people(),
    );
    expect([auto, asked]).toEqual([[], []]);
  });
});

describe("autoNoTeamIndexes: the BSC team lookup must have ended with no team", () => {
  const bsc = { bsc: { ref: "ref-1" } };
  const rows = () => [created("Pat Nonsport")];

  test.each([
    ["failed", "failed", false],
    ["absent", undefined, false],
    ["answered", "answered", true],
    ["checklist says No Team (settled, in neither list)", "checklist", null],
  ] as const)("a BSC card whose lookup is %s", (_label, teamLookup, stamped) => {
    const { auto, asked } = partition(
      [card({ platformData: bsc, ...(teamLookup ? { teamLookup } : {}) })],
      rows(),
      people(),
    );
    if (stamped === null) {
      expect([auto, asked]).toEqual([[], []]);
      return;
    }
    expect(auto).toEqual(stamped ? [0] : []);
    expect(asked).toEqual(stamped ? [] : [0]);
  });

  test("a checklist lookup beside a ruled-out printed team ends the lookup: stamped", () => {
    const { auto } = partition(
      [card({ platformData: bsc, teamLookup: "checklist", teams: ["Wilson Glove"] })],
      [...rows(), skippedTeam("Wilson Glove")],
      people(),
    );
    expect(auto).toEqual([0]);
  });

  test("a card with no BSC ref has nothing to look up, whatever teamLookup says", () => {
    expect(partition([card()], rows(), people()).auto).toEqual([0]);
    expect(partition([card({ teamLookup: "failed" })], rows(), people()).auto).toEqual([0]);
  });

  test("an answered lookup does not outrank a listing team it returned", () => {
    const { asked } = partition(
      [card({ platformData: bsc, teamLookup: "answered", rawTeamName: "Cubs" })],
      rows(),
      people(),
    );
    expect(asked).toEqual([0]);
  });
});

describe("autoNoTeamIndexes: existing rows and settled cards", () => {
  test("a card that re-syncs a stored row is never answered by the default", () => {
    const facts: TeamlessFacts = { ...FLAGGED, existingIndexes: [0] };
    const { auto, asked } = partition([card()], [created("Pat Nonsport")], people(facts));
    expect([auto, asked]).toEqual([[], [0]]);
  });

  test("only the existing position is held back; a new card beside it is still stamped", () => {
    const facts: TeamlessFacts = { ...FLAGGED, existingIndexes: [1] };
    const { auto, asked } = partition(
      [card({ cardNumber: "1" }), card({ cardNumber: "2" })],
      [created("Pat Nonsport")],
      people(facts),
    );
    expect([auto, asked]).toEqual([[0], [1]]);
  });

  test("a settled position (the set's team, or a stored team) is in neither list", () => {
    const { auto, asked } = partition(
      [card()],
      [created("Pat Nonsport")],
      people(),
      new Set([0]),
    );
    expect([auto, asked]).toEqual([[], []]);
  });
});

describe("autoNoTeamIndexes: a person who is not accounted for", () => {
  test("a printed name whose review row is undecided keeps the card asked", () => {
    const { auto, asked } = partition(
      [card({ players: ["Pat Nonsport", "New Guy"] })],
      [created("Pat Nonsport"), undecided("New Guy")],
      people(),
    );
    expect([auto, asked]).toEqual([[], [0]]);
  });

  test("a link with no player id is unaccounted too", () => {
    const { auto, asked } = partition(
      [card({ players: ["Pat Nonsport", "Linky"] })],
      [
        created("Pat Nonsport"),
        row({ kind: "player", name: "Linky", decision: { action: "link" } }),
      ],
      people(),
    );
    expect([auto, asked]).toEqual([[], [0]]);
  });

  test("an unaccounted name does not count against a card the save keeps playerless", () => {
    const { auto } = partition(
      [card({ players: ["New Guy"] })],
      [undecided("New Guy")],
      people(FLAGGED, [0]),
    );
    // Playerless = nobody on it, so there is no one teamless: asked, not stamped.
    expect(auto).toEqual([]);
  });
});

describe("autoNoTeamIndexes: the row's 'Player on every card' (NEO-528)", () => {
  const DEFAULT_ID = pid("default");
  const defaultPlayer = (positions: number[], name = "Default Dan") => ({
    playerId: DEFAULT_ID,
    name,
    positions,
  });
  const stored = (sport: string | undefined, positions: number[] = [0]) =>
    storedPeople(undefined, undefined, undefined, defaultPlayer(positions), {
      ...FLAGGED,
      playerSportIds: sport ? new Map([[DEFAULT_ID, sport]]) : new Map(),
    });

  test("a card naming nobody takes the default player, whose flagged sport stamps it", () => {
    const { auto, asked } = partition([card({ players: [] })], [], stored(NONE));
    expect([auto, asked]).toEqual([[0], []]);
  });

  test("a default player in a sport with teams keeps the card asked", () => {
    expect(partition([card({ players: [] })], [], stored(BALL)).asked).toEqual([0]);
  });

  test("a default player whose sport has not loaded keeps the card asked", () => {
    expect(partition([card({ players: [] })], [], stored(undefined)).asked).toEqual([0]);
  });

  test("a position the default player does not cover is asked", () => {
    expect(partition([card({ players: [] })], [], stored(NONE, [4])).asked).toEqual([0]);
  });

  test("a card that prints a name never takes the default, even one ruled out", () => {
    const { auto, asked } = partition(
      [card({ players: ["Checklist Header"] })],
      [skippedPlayer("Checklist Header")],
      stored(NONE),
    );
    expect([auto, asked]).toEqual([[], [0]]);
  });
});

describe("cardsForTeamsStep: the step lists only the cards still asked", () => {
  test("a stamped card is out of the step; a mixed card beside it stays in", () => {
    const rows = [created("Pat Nonsport"), created("Ron Ballplayer", BALL)];
    const cards = [
      card({ cardNumber: "1", players: ["Pat Nonsport"] }),
      card({ cardNumber: "2", players: ["Ron Ballplayer"] }),
      card({ cardNumber: "3", players: ["Pat Nonsport", "Ron Ballplayer"] }),
    ];
    expect(cardsForTeamsStep(cards, rows, undefined, people())).toEqual([1, 2]);
  });

  test("with every card teamless the step is empty", () => {
    expect(cardsForTeamsStep([card()], [created("Pat Nonsport")], undefined, people())).toEqual(
      [],
    );
  });

  test("an unflagged sport leaves the step exactly as it was", () => {
    expect(cardsForTeamsStep([card()], [created("Pat Nonsport", BALL)], undefined, people())).toEqual(
      [0],
    );
    expect(cardsForTeamsStep([card()], [created("Pat Nonsport")], undefined, undefined)).toEqual(
      [0],
    );
  });

  test("an undecided team name is assumed to resolve: the card is in neither list", () => {
    const rows = [created("Pat Nonsport"), row({ kind: "team", name: "Cubs", decision: null })];
    expect(cardsForTeamsStep([card({ teams: ["Cubs"] })], rows, undefined, people())).toEqual([]);
  });

  test("an undecided player name keeps the card in the step", () => {
    const rows = [created("Pat Nonsport"), undecided("New Guy")];
    expect(
      cardsForTeamsStep([card({ players: ["Pat Nonsport", "New Guy"] })], rows, undefined, people()),
    ).toEqual([0]);
  });

  test("a settled index stays out whatever the default says", () => {
    expect(
      cardsForTeamsStep([card({ players: ["Ron Ballplayer"] })], [created("Ron Ballplayer", BALL)], [0], people()),
    ).toEqual([]);
  });
});
