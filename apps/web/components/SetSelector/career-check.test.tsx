/**
 * NEO-574 — the career step's pure model (`career-check.ts`).
 *
 * (`.test.tsx` although it renders nothing: the components project only
 * collects `.test.tsx` under components/.)
 */
import { describe, expect, it } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import { MIN_CAREER_YEAR, maxCareerYear } from "../../lib/players/career-years";
import {
  CAREER_READ_FAILED,
  CAREER_STINTS_MAX,
  NO_CAREER_TEXT,
  applyCareerCardEdit,
  careerCommitFields,
  careerHeading,
  cleanNewPlayerName,
  isNewPlayerPick,
  newPlayerAnswer,
  newPlayerNameReady,
  newPlayerRef,
  noStintText,
  coveredText,
  playedForText,
  sortCareerLines,
  uncoveredAgainText,
  careerContextAsks,
  classifyPairs,
  defaultCareerAnswer,
  lineStintTeam,
  deriveSittingPairs,
  followUpPair,
  gateJudgedKeys,
  isValidStint,
  pairKey,
  preAddedStints,
  reteamedIndexes,
  sameStint,
  stintChipText,
  stintYearsText,
  stintsOf,
  replaceStint,
  withStint,
  type StagedStint,
  toLines,
  unreferencedCreatedTeamRows,
  type CareerAnswers,
  type CareerContext,
  type CareerRow,
} from "./career-check";

const pid = (s: string) => s as unknown as Id<"players">;
const tid = (s: string) => s as unknown as Id<"teams">;

const CONTEXT: CareerContext = {
  setYear: 2022,
  players: [
    { printed: "Fernando Tatis Jr.", playerId: pid("p-tatis") },
    { printed: "Mike Trout", playerId: pid("p-trout") },
  ],
  teams: [
    { printed: "Padres", teamId: tid("t-padres") },
    { printed: "Angels", teamId: tid("t-angels") },
  ],
  gaps: [{ teamId: tid("t-padres"), playerIds: [pid("p-tatis")] }],
};

const CARDS = [
  { cardNumber: "12", cardName: "Tatis", players: ["Fernando Tatis Jr."], teams: ["Padres"] },
  { cardNumber: "45", cardName: "Tatis", players: ["Fernando Tatis Jr."], teams: ["Padres"] },
  { cardNumber: "27", cardName: "Trout", players: ["Mike Trout"], teams: ["Angels"] },
  { cardNumber: "99", cardName: "Duo", players: ["Mike Trout", "Fernando Tatis Jr."], teams: ["Padres"] },
];

describe("deriveSittingPairs", () => {
  it("lists one pair per (player, team) with every card behind it, and never a multi-player card", () => {
    const pairs = deriveSittingPairs({ cards: CARDS, rows: [], context: CONTEXT });
    expect(pairs.map((p) => [p.playerId, p.teamId, p.cardNumbers])).toEqual([
      ["p-tatis", "t-padres", ["12", "45"]],
      ["p-trout", "t-angels", ["27"]],
    ]);
  });

  it("checks nothing without a set year", () => {
    expect(
      deriveSittingPairs({ cards: CARDS, rows: [], context: { ...CONTEXT, setYear: undefined } }),
    ).toEqual([]);
    expect(deriveSittingPairs({ cards: CARDS, rows: [], context: undefined })).toEqual([]);
  });

  it("skips cards that re-sync a stored row", () => {
    const pairs = deriveSittingPairs({
      cards: CARDS,
      existingIndexes: [0, 1],
      rows: [],
      context: CONTEXT,
    });
    expect(pairs.map((p) => p.playerId)).toEqual(["p-trout"]);
  });

  it("reads a player the operator linked, and not one the wizard creates", () => {
    const rows: CareerRow[] = [
      { kind: "player", name: "Fernando Tatis Jr.", decision: { action: "create" } },
      { kind: "player", name: "Mike Trout", decision: { action: "link", linkedPlayerId: "p-other" } },
    ];
    const pairs = deriveSittingPairs({ cards: CARDS, rows, context: CONTEXT });
    expect(pairs.map((p) => p.playerId)).toEqual(["p-other"]);
  });

  it("gives a team the batch creates by its printed text only, and drops a skipped team", () => {
    const rows: CareerRow[] = [
      { kind: "team", name: "Padres", decision: { action: "create" } },
      { kind: "team", name: "Angels", decision: { action: "skip" } },
    ];
    const pairs = deriveSittingPairs({ cards: CARDS, rows, context: CONTEXT });
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ playerId: "p-tatis", teamName: "Padres" });
    expect(pairs[0].teamId).toBeUndefined();
  });

  it("a name ruled 'not a person' is nobody, so its card still has one player", () => {
    const cards = [
      { cardNumber: "7", cardName: "x", players: ["Mike Trout", "Checklist"], teams: ["Angels"] },
    ];
    const rows: CareerRow[] = [{ kind: "player", name: "Checklist", decision: { action: "skip" } }];
    expect(deriveSittingPairs({ cards, rows, context: CONTEXT })).toHaveLength(1);
    expect(
      deriveSittingPairs({ cards, rows: [], skippedPlayerNames: ["Checklist"], context: CONTEXT }),
    ).toHaveLength(1);
    expect(deriveSittingPairs({ cards, rows: [], context: CONTEXT })).toHaveLength(0);
  });
});

describe("classifyPairs", () => {
  const pairs = deriveSittingPairs({ cards: CARDS, rows: [], context: CONTEXT });
  const judged = gateJudgedKeys({ cards: CARDS, context: CONTEXT });

  it("reads a pair the gate judged from the gate: a gap iff it listed it", () => {
    const { gaps, pending } = classifyPairs({ pairs, judgedByGate: judged, context: CONTEXT, coverage: {} });
    expect(gaps.map((p) => p.playerId)).toEqual(["p-tatis"]);
    expect(pending).toEqual([]);
  });

  it("puts a pair the gate did not judge to the coverage read, and waits for it", () => {
    const rows: CareerRow[] = [
      { kind: "player", name: "Mike Trout", decision: { action: "link", linkedPlayerId: "p-other" } },
    ];
    const linked = deriveSittingPairs({ cards: CARDS, rows, context: CONTEXT });
    const other = linked.find((p) => p.playerId === "p-other")!;
    const waiting = classifyPairs({ pairs: linked, judgedByGate: judged, context: CONTEXT, coverage: {} });
    expect(waiting.pending).toEqual([other]);
    const covered = classifyPairs({
      pairs: linked,
      judgedByGate: judged,
      context: CONTEXT,
      coverage: { [pairKey(other)]: true },
    });
    expect(covered.pending).toEqual([]);
    expect(covered.gaps.map((p) => p.playerId)).toEqual(["p-tatis"]);
    const uncovered = classifyPairs({
      pairs: linked,
      judgedByGate: judged,
      context: CONTEXT,
      coverage: { [pairKey(other)]: false },
    });
    expect(uncovered.gaps.map((p) => p.playerId)).toEqual(["p-tatis", "p-other"]);
  });
});

describe("careerContextAsks (no names to review)", () => {
  it("asks when the gate listed a gap", () => {
    expect(careerContextAsks(CARDS, [], CONTEXT)).toBe(true);
  });
  it("does not ask when every pair is covered", () => {
    expect(careerContextAsks(CARDS, [], { ...CONTEXT, gaps: [] })).toBe(false);
  });
  it("does not ask when the gap's cards re-sync stored rows", () => {
    expect(careerContextAsks(CARDS, [0, 1, 3], CONTEXT)).toBe(false);
  });
  it("does not ask without a context", () => {
    expect(careerContextAsks(CARDS, [], undefined)).toBe(false);
  });
});

describe("toLines ordering and copy", () => {
  it("sorts by team, then by card number (numerically)", () => {
    const cards = [
      { cardNumber: "100", cardName: "a", players: ["Mike Trout"], teams: ["Angels"] },
      { cardNumber: "9", cardName: "b", players: ["Fernando Tatis Jr."], teams: ["Padres"] },
      { cardNumber: "20", cardName: "c", players: ["Mike Trout"], teams: ["Padres"] },
      { cardNumber: "7", cardName: "d", players: ["Fernando Tatis Jr."], teams: ["Angels"] },
    ];
    const lines = toLines(deriveSittingPairs({ cards, rows: [], context: CONTEXT }));
    expect(lines.map((l) => `${l.printedTeam}|${l.printedPlayer}|${l.cardNumbers[0]}`)).toEqual([
      "Angels|Fernando Tatis Jr.|7",
      "Angels|Mike Trout|100",
      "Padres|Fernando Tatis Jr.|9",
      "Padres|Mike Trout|20",
    ]);
  });
  it("is the same order whatever order the pairs arrive in", () => {
    const pairs = deriveSittingPairs({ cards: CARDS, rows: [], context: CONTEXT });
    expect(toLines([...pairs].reverse()).map((l) => l.key)).toEqual(toLines(pairs).map((l) => l.key));
  });
  it("words the line, the heading and the failed read as the collector asked", () => {
    expect(careerHeading(3)).toBe("Career check · 3 to look at");
    expect(careerHeading(0)).toBe("Career check");
    expect(noStintText("Padres", 2022)).toBe("No Padres in the career by 2022.");
    expect(NO_CAREER_TEXT).toBe("No career on file yet.");
    expect(CAREER_READ_FAILED).toBe("Couldn’t check careers. Retry, or Next saves without it.");
    expect(uncoveredAgainText("Ana", "Padres", 2022)).toBe("No Padres in Ana’s career by 2022 either.");
    expect(coveredText("Ana", "Padres")).toBe("Ana played for the Padres.");
    expect(playedForText("Padres")).toBe("Played for the Padres");
  });
  it("never says 'No the team…': with no name known it says what is true of any team", () => {
    for (const none of [undefined, ""]) {
      expect(noStintText(none, 2022)).toBe("This team isn’t in the career by 2022.");
      expect(uncoveredAgainText("Ana", none, 2022)).toBe(
        "This team isn’t in Ana’s career by 2022 either.",
      );
      expect(coveredText("Ana", none)).toBe("Ana played for this team.");
      expect(playedForText(none)).toBe("Played for this team");
    }
  });
  it("sortCareerLines orders by the resolved short name, falling back to the printed text, then number", () => {
    const base = { cardIndexes: [0], printedPlayer: "x" };
    const mk = (id: string, printedTeam: string | undefined, no: string) => ({
      ...base,
      playerId: id,
      cardNumbers: [no],
      printedTeam,
      key: `${id}|${no}`,
    });
    const lines = [
      mk("a", "SD", "5"), // prints "SD", resolves to "Padres"
      mk("b", "Angels", "2"),
      mk("c", undefined, "1"), // no name at all: last
      mk("d", "Padres", "1"),
    ];
    const resolved: Record<string, string> = { a: "Padres" };
    const out = sortCareerLines(lines, (l) => resolved[l.playerId]);
    expect(out.map((l) => l.playerId)).toEqual(["b", "d", "a", "c"]);
    // Does not mutate its input.
    expect(lines.map((l) => l.playerId)).toEqual(["a", "b", "c", "d"]);
  });
});

const stint = (teamId: string, fromYear: number, toYear?: number, label = teamId): StagedStint => ({
  teamId: tid(teamId),
  label,
  fromYear,
  ...(toYear !== undefined ? { toYear } : {}),
});

describe("the stints a line stages", () => {
  it("opens with the card's team from the set's year, already staged", () => {
    // A past set is that one year.
    expect(
      preAddedStints({ teamId: tid("t-padres"), label: "San Diego Padres" }, 2022, 2026),
    ).toEqual([{ teamId: "t-padres", label: "San Diego Padres", fromYear: 2022, toYear: 2022 }]);
    // A team the batch creates is named by its printed string.
    expect(
      preAddedStints({ teamName: "Padres", label: "San Diego Padres" }, 2022, 2026),
    ).toEqual([{ teamName: "Padres", label: "San Diego Padres", fromYear: 2022, toYear: 2022 }]);
  });
  it("stays open-ended ('to present') for a set from this year or later", () => {
    const team = { teamId: tid("t-angels"), label: "Los Angeles Angels" };
    expect(preAddedStints(team, 2026, 2026)).toEqual([
      { teamId: "t-angels", label: "Los Angeles Angels", fromYear: 2026 },
    ]);
    expect(preAddedStints(team, 2027, 2026)).toEqual([
      { teamId: "t-angels", label: "Los Angeles Angels", fromYear: 2027 },
    ]);
    expect(stintChipText(preAddedStints(team, 2026, 2026)[0])).toBe(
      "Los Angeles Angels (2026–present)",
    );
  });
  it("closes the stint the year before this one, and for any earlier year", () => {
    const team = { teamId: tid("t-angels"), label: "Los Angeles Angels" };
    expect(preAddedStints(team, 2025, 2026)[0]).toMatchObject({ fromYear: 2025, toYear: 2025 });
    expect(stintChipText(preAddedStints(team, 1990, 2026)[0])).toBe(
      "Los Angeles Angels (1990–1990)",
    );
  });
  it("reads the calendar year when none is given", () => {
    const team = { teamId: tid("t-angels"), label: "Los Angeles Angels" };
    const thisYear = new Date().getFullYear();
    expect(preAddedStints(team, thisYear)[0].toYear).toBeUndefined();
    expect(preAddedStints(team, thisYear - 1)[0].toYear).toBe(thisYear - 1);
  });
  it("has nothing to stage without a team or a year", () => {
    expect(preAddedStints({ label: "this team" }, 2022)).toEqual([]);
    expect(preAddedStints(undefined, 2022)).toEqual([]);
    expect(preAddedStints({ teamId: tid("t"), label: "T" }, undefined)).toEqual([]);
  });
  it("calls two stints one when the team and From year agree (what the server dedupes on)", () => {
    expect(sameStint(stint("t1", 2022), stint("t1", 2022, 2024))).toBe(true);
    expect(sameStint(stint("t1", 2022), stint("t1", 2023))).toBe(false);
    expect(sameStint(stint("t1", 2022), stint("t2", 2022))).toBe(false);
    const named = (name: string): StagedStint => ({ teamName: name, label: name, fromYear: 2022 });
    expect(sameStint(named("Padres"), named(" padres "))).toBe(true);
    expect(sameStint(named("Padres"), stint("t1", 2022))).toBe(false);
  });
  it("adds a stint once", () => {
    const one = [stint("t1", 2022)];
    expect(withStint(one, stint("t2", 2019, 2021))).toHaveLength(2);
    expect(withStint(one, stint("t1", 2022, 2023))).toHaveLength(1);
    expect(one).toHaveLength(1);
  });
  it("replaces an edited stint where it stood, and keeps one of a kind", () => {
    const list = [stint("t1", 2022), stint("t2", 2019, 2021), stint("t3", 2015)];
    // New years for the first: same place.
    expect(replaceStint(list, list[0], stint("t1", 2020, 2023))).toEqual([
      stint("t1", 2020, 2023),
      list[1],
      list[2],
    ]);
    // Moved onto another stint's team and From year: the edit wins, the other goes.
    expect(replaceStint(list, list[0], stint("t2", 2019, 2020))).toEqual([
      stint("t2", 2019, 2020),
      list[2],
    ]);
    // The edited stint is gone already: a plain add.
    expect(replaceStint([list[1]], list[0], stint("t1", 2020))).toEqual([list[1], stint("t1", 2020)]);
    expect(list).toHaveLength(3);
  });
  it("reads the years as the New Player chips do", () => {
    expect(stintYearsText({ fromYear: 2022 })).toBe("2022–present");
    expect(stintYearsText({ fromYear: 2019, toYear: 2021 })).toBe("2019–2021");
    expect(stintYearsText({})).toBe("");
    expect(stintChipText({ label: "San Diego Padres", fromYear: 2022 })).toBe(
      "San Diego Padres (2022–present)",
    );
    expect(stintChipText({ label: "Reds" })).toBe("Reds");
  });
  it("holds the year bounds exactly and refuses a to-year before the from-year", () => {
    expect(isValidStint(stint("t", 2030), 2030)).toBe(true);
    expect(isValidStint(stint("t", 2031), 2030)).toBe(false);
    expect(isValidStint(stint("t", MIN_CAREER_YEAR - 1), 2030)).toBe(false);
    expect(isValidStint(stint("t", MIN_CAREER_YEAR), 2030)).toBe(true);
    expect(isValidStint(stint("t", 2022, 2021), 2030)).toBe(false);
    expect(isValidStint(stint("t", 2022, 2022), 2030)).toBe(true);
    expect(isValidStint(stint("t", 2022, 2031), 2030)).toBe(false);
    expect(isValidStint(stint("t", 2022.5), 2030)).toBe(false);
    expect(isValidStint(stint("t", 2022, 2022.5), 2030)).toBe(false);
    expect(maxCareerYear()).toBeGreaterThanOrEqual(2022);
  });
  it("finds the stints an answer holds: the add itself, or a follow-up add after a pick", () => {
    const s1 = [stint("t1", 2022)];
    expect(stintsOf(undefined)).toEqual([]);
    expect(stintsOf({ kind: "leave" })).toEqual([]);
    expect(stintsOf({ kind: "add", stints: s1 })).toBe(s1);
    expect(
      stintsOf({
        kind: "team",
        pick: { teamId: tid("t2"), name: "T2" },
        then: { kind: "add", stints: s1 },
      }),
    ).toBe(s1);
    // Not before a pick.
    expect(stintsOf({ kind: "player", then: { kind: "add", stints: s1 } })).toEqual([]);
  });
});

describe("careerCommitFields", () => {
  const pairs = deriveSittingPairs({ cards: CARDS, rows: [], context: CONTEXT });
  const lines = toLines(pairs);
  // Sorted by team: Angels (Trout) before Padres (Tatis).
  const tatis = lines.find((l) => l.playerId === "p-tatis")!;
  const trout = lines.find((l) => l.playerId === "p-trout")!;

  it("is nothing when every line is explicitly kept as is", () => {
    const kept: CareerAnswers = {
      [tatis.key]: { kind: "leave" },
      [trout.key]: { kind: "leave" },
    };
    expect(
      careerCommitFields({ lines, answers: kept, cards: CARDS, setYear: 2022, currentYear: 2026, maxYear: 2030 }),
    ).toBeUndefined();
  });

  describe("untouched lines are the default add (Jason 2026-11-19)", () => {
    const base = { lines, cards: CARDS, setYear: 2022, currentYear: 2026, maxYear: 2030 };

    it("sends every untouched line's card team, closed at the set's year for a past set", () => {
      const out = careerCommitFields({ ...base, answers: {} });
      // Lines are in team order: Angels (Trout), then Padres (Tatis).
      expect(out?.stints).toEqual([
        { playerId: "p-trout", teamId: "t-angels", fromYear: 2022, toYear: 2022 },
        { playerId: "p-tatis", teamId: "t-padres", fromYear: 2022, toYear: 2022 },
      ]);
      expect(out?.cardEdits.every((e) => e === undefined)).toBe(true);
    });

    it("leaves the stint open-ended for a set from this year or later", () => {
      const out = careerCommitFields({ ...base, setYear: 2026, answers: {} });
      expect(out?.stints).toEqual([
        { playerId: "p-trout", teamId: "t-angels", fromYear: 2026 },
        { playerId: "p-tatis", teamId: "t-padres", fromYear: 2026 },
      ]);
    });

    it("names a team the batch creates by its printed text", () => {
      const created = deriveSittingPairs({
        cards: CARDS,
        rows: [{ kind: "team", name: "Padres", decision: { action: "create" } }],
        context: CONTEXT,
      });
      const line = toLines(created).find((l) => l.playerId === "p-tatis")!;
      const out = careerCommitFields({ ...base, lines: [line], answers: {} });
      expect(out?.stints).toEqual([
        { playerId: "p-tatis", teamName: "Padres", fromYear: 2022, toYear: 2022 },
      ]);
    });

    it("Keep as is on a line drops only that line's stint", () => {
      const out = careerCommitFields({ ...base, answers: { [tatis.key]: { kind: "leave" } } });
      expect(out?.stints).toEqual([
        { playerId: "p-trout", teamId: "t-angels", fromYear: 2022, toYear: 2022 },
      ]);
    });

    it("a stored add replaces the default for its line, an emptied one sends nothing for it", () => {
      const out = careerCommitFields({
        ...base,
        answers: {
          [tatis.key]: { kind: "add", stints: [stint("t-reds", 2019, 2021)] },
          [trout.key]: { kind: "add", stints: [] },
        },
      });
      expect(out?.stints).toEqual([
        { playerId: "p-tatis", teamId: "t-reds", fromYear: 2019, toYear: 2021 },
      ]);
    });

    it("a line whose team cannot be named adds nothing and does not hide the others", () => {
      const nameless = { ...tatis, teamId: undefined, teamName: undefined, key: "nameless" };
      expect(careerCommitFields({ ...base, lines: [nameless], answers: {} })).toBeUndefined();
      const out = careerCommitFields({ ...base, lines: [nameless, trout], answers: {} });
      expect(out?.stints).toEqual([
        { playerId: "p-trout", teamId: "t-angels", fromYear: 2022, toYear: 2022 },
      ]);
    });

    it("with no set year there is nothing to stage, so nothing is sent", () => {
      expect(careerCommitFields({ ...base, setYear: undefined, answers: {} })).toBeUndefined();
    });

    it("does not send the default stint of a line that was re-teamed away", () => {
      // The printed string comes off every card of the line, so a name-keyed stint has nothing to resolve by.
      const created = deriveSittingPairs({
        cards: CARDS,
        rows: [{ kind: "team", name: "Padres", decision: { action: "create" } }],
        context: CONTEXT,
      });
      const line = toLines(created).find((l) => l.playerId === "p-tatis")!;
      const out = careerCommitFields({
        ...base,
        lines: [line],
        cards: CARDS.filter((c) => c.teams[0] === "Padres").slice(0, 2),
        answers: {
          [line.key]: { kind: "team", pick: { teamId: tid("t-other"), name: "Other" }, then: { kind: "leave" } },
        },
      });
      expect(out?.stints).toEqual([]);
      expect(out?.cardEdits[0]?.teamIds).toEqual(["t-other"]);
    });
  });

  describe("a pick's follow-up defaults to add, once the new pair reads uncovered", () => {
    const base = { lines, cards: CARDS, setYear: 2022, currentYear: 2026, maxYear: 2030 };
    const keptTrout: CareerAnswers = { [trout.key]: { kind: "leave" } };
    const playerPick: CareerAnswers = {
      ...keptTrout,
      [tatis.key]: { kind: "player", pick: { playerId: pid("p-tatis-sr"), name: "Fernando Tatis" } },
    };
    const teamPick: CareerAnswers = {
      [tatis.key]: { kind: "leave" },
      [trout.key]: { kind: "team", pick: { teamId: tid("t-other"), name: "Other" } },
    };

    it("a different player gets the card's team when their career lacks it", () => {
      const out = careerCommitFields({ ...base, answers: playerPick, coverage: { "p-tatis-sr|t-padres": false } });
      expect(out?.stints).toEqual([
        { playerId: "p-tatis-sr", teamId: "t-padres", fromYear: 2022, toYear: 2022 },
      ]);
      expect(out?.cardEdits[0]?.playerIdByName).toEqual([{ name: "Fernando Tatis Jr.", playerId: "p-tatis-sr" }]);
    });

    it("a different team gets the stint for the line's player on the PICKED team", () => {
      const out = careerCommitFields({ ...base, answers: teamPick, coverage: { "p-trout|t-other": false } });
      expect(out?.stints).toEqual([
        { playerId: "p-trout", teamId: "t-other", fromYear: 2022, toYear: 2022 },
      ]);
    });

    it("adds nothing while the re-check is unread, failed or covered", () => {
      const unreadFailedOrCovered: Array<Readonly<Record<string, boolean>> | undefined> = [
        undefined,
        {},
        { "p-tatis-sr|t-padres": true },
      ];
      for (const coverage of unreadFailedOrCovered) {
        const out = careerCommitFields({ ...base, answers: playerPick, coverage });
        expect(out?.stints).toEqual([]);
      }
    });

    it("an explicit Keep as is on the follow-up adds nothing, even when uncovered", () => {
      const answers: CareerAnswers = {
        ...keptTrout,
        [tatis.key]: {
          kind: "player",
          pick: { playerId: pid("p-tatis-sr"), name: "Fernando Tatis" },
          then: { kind: "leave" },
        },
      };
      const out = careerCommitFields({ ...base, answers, coverage: { "p-tatis-sr|t-padres": false } });
      expect(out?.stints).toEqual([]);
    });

    it("an unpicked player or team adds nothing, whatever the coverage says", () => {
      const answers: CareerAnswers = {
        [tatis.key]: { kind: "player" },
        [trout.key]: { kind: "team" },
      };
      expect(
        careerCommitFields({ ...base, answers, coverage: { "p-tatis-sr|t-padres": false } }),
      ).toBeUndefined();
    });

    it("a pick on a line whose team cannot be named adds nothing", () => {
      const nameless = { ...tatis, teamId: undefined, teamName: undefined, key: "nameless" };
      const answers: CareerAnswers = {
        nameless: { kind: "player", pick: { playerId: pid("p-tatis-sr"), name: "Fernando Tatis" } },
      };
      const out = careerCommitFields({ ...base, lines: [nameless], answers, coverage: { "p-tatis-sr|~": false } });
      expect(out?.stints).toEqual([]);
    });
  });

  it("adds a stint by team id", () => {
    const answers: CareerAnswers = { [tatis.key]: { kind: "add", stints: [stint("t-padres", 2022)] } };
    const out = careerCommitFields({ lines, answers, cards: CARDS, maxYear: 2030 });
    expect(out?.stints).toEqual([{ playerId: "p-tatis", teamId: "t-padres", fromYear: 2022 }]);
    expect(out?.cardEdits.every((e) => e === undefined)).toBe(true);
  });

  it("sends EVERY stint staged on a line, for the line's player, in order", () => {
    const answers: CareerAnswers = {
      [tatis.key]: {
        kind: "add",
        stints: [stint("t-padres", 2022), stint("t-reds", 2019, 2021), stint("t-padres", 2015, 2016)],
      },
    };
    const out = careerCommitFields({ lines, answers, cards: CARDS, maxYear: 2030 });
    expect(out?.stints).toEqual([
      { playerId: "p-tatis", teamId: "t-padres", fromYear: 2022 },
      { playerId: "p-tatis", teamId: "t-reds", fromYear: 2019, toYear: 2021 },
      { playerId: "p-tatis", teamId: "t-padres", fromYear: 2015, toYear: 2016 },
    ]);
  });

  it("sends a mix of saved teams (by id) and a team the batch creates (by printed name)", () => {
    const created = deriveSittingPairs({
      cards: CARDS,
      rows: [{ kind: "team", name: "Padres", decision: { action: "create" } }],
      context: CONTEXT,
    });
    const line = toLines(created).find((l) => l.playerId === "p-tatis")!;
    const out = careerCommitFields({
      lines: [line],
      answers: {
        [line.key]: {
          kind: "add",
          stints: [
            { teamName: "Padres", label: "San Diego Padres", fromYear: 2022 },
            stint("t-reds", 2019, 2021, "Cincinnati Reds"),
          ],
        },
      },
      cards: CARDS,
      maxYear: 2030,
    });
    expect(out?.stints).toEqual([
      { playerId: "p-tatis", teamName: "Padres", fromYear: 2022 },
      { playerId: "p-tatis", teamId: "t-reds", fromYear: 2019, toYear: 2021 },
    ]);
  });

  it("sends nothing for a line whose stints were all removed", () => {
    const answers: CareerAnswers = { [tatis.key]: { kind: "add", stints: [] } };
    expect(careerCommitFields({ lines, answers, cards: CARDS, maxYear: 2030 })).toBeUndefined();
  });

  it("sends nothing for a line changed away from Add to career", () => {
    // The answer is replaced when the choice changes, so its stints are gone with it.
    const answers: CareerAnswers = { [tatis.key]: { kind: "leave" } };
    expect(careerCommitFields({ lines, answers, cards: CARDS, maxYear: 2030 })).toBeUndefined();
  });

  it("holds each stint to the year bounds and sends the rest", () => {
    const answers: CareerAnswers = {
      [tatis.key]: { kind: "add", stints: [stint("t-padres", 2031), stint("t-reds", 2019, 2018), stint("t-a", 2020)] },
    };
    const out = careerCommitFields({ lines, answers, cards: CARDS, maxYear: 2030 });
    expect(out?.stints).toEqual([{ playerId: "p-tatis", teamId: "t-a", fromYear: 2020 }]);
  });

  it("drops a stint for a printed team no card of the commit carries any more", () => {
    const created = deriveSittingPairs({
      cards: CARDS,
      rows: [{ kind: "team", name: "Padres", decision: { action: "create" } }],
      context: CONTEXT,
    });
    const line = toLines(created).find((l) => l.playerId === "p-tatis")!;
    // Cards 0, 1 and 3 print "Padres"; here every one of them is re-teamed away
    // by the line's own team answer, so nothing is left to resolve the name by.
    const out = careerCommitFields({
      lines: [line],
      answers: {
        [line.key]: {
          kind: "team",
          pick: { teamId: tid("t-other"), name: "Other" },
          then: { kind: "add", stints: [{ teamName: "Padres", label: "Padres", fromYear: 2020 }] },
        },
      },
      cards: CARDS.filter((c) => c.teams[0] === "Padres").slice(0, 2),
      maxYear: 2030,
    });
    expect(out?.stints).toEqual([]);
  });

  it("adds a stint for a team the batch creates by its printed name", () => {
    const created = deriveSittingPairs({
      cards: CARDS,
      rows: [{ kind: "team", name: "Padres", decision: { action: "create" } }],
      context: CONTEXT,
    });
    const line = toLines(created).find((l) => l.playerId === "p-tatis")!;
    const out = careerCommitFields({
      lines: [line],
      answers: { [line.key]: { kind: "add", stints: [{ teamName: "Padres", label: "Padres", fromYear: 2022, toYear: 2023 }] } },
      cards: CARDS,
      maxYear: 2030,
    });
    expect(out?.stints).toEqual([
      { playerId: "p-tatis", teamName: "Padres", fromYear: 2022, toYear: 2023 },
    ]);
  });

  it("relinks every card of the line to the picked player, by the card's printed name", () => {
    const answers: CareerAnswers = {
      [tatis.key]: {
        kind: "player",
        pick: { playerId: pid("p-tatis-sr"), name: "Fernando Tatis" },
        then: { kind: "leave" },
      },
    };
    const out = careerCommitFields({ lines, answers, cards: CARDS, maxYear: 2030 });
    expect(out?.cardEdits[0]).toEqual({
      playerIdByName: [{ name: "Fernando Tatis Jr.", playerId: "p-tatis-sr" }],
    });
    expect(out?.cardEdits[1]).toEqual(out?.cardEdits[0]);
    expect(out?.cardEdits[2]).toBeUndefined();
    expect(out?.stints).toEqual([]);
  });

  it("a relink followed by an add puts the stint on the NEW player", () => {
    const answers: CareerAnswers = {
      [tatis.key]: {
        kind: "player",
        pick: { playerId: pid("p-tatis-sr"), name: "Fernando Tatis" },
        then: { kind: "add", stints: [stint("t-padres", 1996), stint("t-reds", 1990, 1995)] },
      },
    };
    const out = careerCommitFields({ lines, answers, cards: CARDS, maxYear: 2030 });
    expect(out?.stints).toEqual([
      { playerId: "p-tatis-sr", teamId: "t-padres", fromYear: 1996 },
      { playerId: "p-tatis-sr", teamId: "t-reds", fromYear: 1990, toYear: 1995 },
    ]);
  });

  it("re-teams the line's cards: the printed string comes off and the pick goes on", () => {
    const answers: CareerAnswers = {
      [trout.key]: {
        kind: "team",
        pick: { teamId: tid("t-other"), name: "Los Angeles Angels" },
        then: { kind: "add", stints: [stint("t-other", 2022)] },
      },
    };
    const out = careerCommitFields({ lines, answers, cards: CARDS, maxYear: 2030 });
    expect(out?.cardEdits[2]).toEqual({
      dropTeams: ["Angels"],
      dropTeamIds: ["t-angels"],
      teamIds: ["t-other"],
    });
    expect(out?.stints).toEqual([{ playerId: "p-trout", teamId: "t-other", fromYear: 2022 }]);
    expect(reteamedIndexes(out!.cardEdits)).toEqual([2]);
  });

  it("an unpicked player or team is 'Leave it'", () => {
    const answers: CareerAnswers = {
      [tatis.key]: { kind: "player", then: { kind: "leave" } },
      [trout.key]: { kind: "team", then: { kind: "leave" } },
    };
    expect(careerCommitFields({ lines, answers, cards: CARDS, maxYear: 2030 })).toBeUndefined();
  });

  it("does not repeat the same stint", () => {
    const dup = { ...tatis, key: "other" };
    const out = careerCommitFields({
      lines: [tatis, dup],
      answers: {
        [tatis.key]: { kind: "add", stints: [stint("t-padres", 2022)] },
        other: { kind: "add", stints: [stint("t-padres", 2022)] },
      },
      cards: CARDS,
      maxYear: 2030,
    });
    expect(out?.stints).toHaveLength(1);
  });
});

describe("followUpPair", () => {
  const line = toLines(deriveSittingPairs({ cards: CARDS, rows: [], context: CONTEXT })).find(
    (l) => l.playerId === "p-tatis",
  )!;
  it("asks about the new player on the card's team", () => {
    const f = followUpPair(line, {
      kind: "player",
      pick: { playerId: pid("p-new"), name: "X" },
      then: { kind: "leave" },
    });
    expect(f?.ask).toMatchObject({ playerId: "p-new", teamId: "t-padres" });
  });
  it("asks about the same player on the new team", () => {
    const f = followUpPair(line, {
      kind: "team",
      pick: { teamId: tid("t-new"), name: "Y" },
      then: { kind: "leave" },
    });
    expect(f?.ask).toEqual({ playerId: "p-tatis", teamId: "t-new" });
  });
  it("is nothing before a pick", () => {
    expect(followUpPair(line, { kind: "player", then: { kind: "leave" } })).toBeNull();
    expect(followUpPair(line, undefined)).toBeNull();
  });
});

describe("applyCareerCardEdit", () => {
  it("hands back the same card when there is no edit", () => {
    const card = { team: "Padres", teams: ["Padres"] };
    expect(applyCareerCardEdit(card, undefined)).toBe(card);
  });
  it("drops the replaced team from teams and the legacy team, case-folded, and keeps the others", () => {
    const card: { team?: string; teams?: string[]; teamIds?: Id<"teams">[] } = {
      team: "padres",
      teams: ["Padres", "Angels"],
    };
    const out = applyCareerCardEdit(card, { dropTeams: ["Padres"], teamIds: [tid("t1")] });
    expect(out.teams).toEqual(["Angels"]);
    expect(out.team).toBeUndefined();
    expect(out.teamIds).toEqual(["t1"]);
  });
  it("drops the replaced team's id too, so a team that came from a picked id goes off the card (U2)", () => {
    const card: { team?: string; teams?: string[]; teamIds?: Id<"teams">[] } = {
      teams: [],
      teamIds: [tid("t-old"), tid("t-keep")],
    };
    const out = applyCareerCardEdit(card, {
      dropTeamIds: [tid("t-old")],
      teamIds: [tid("t-new")],
    });
    expect(out.teamIds).toEqual(["t-keep", "t-new"]);
    // Picking the very team that is being replaced keeps it (drop first, then add).
    const same = applyCareerCardEdit(card, { dropTeamIds: [tid("t-old")], teamIds: [tid("t-old")] });
    expect(same.teamIds).toEqual(["t-keep", "t-old"]);
    // Without the id drop nothing leaves teamIds.
    expect(applyCareerCardEdit(card, { teamIds: [tid("t-new")] }).teamIds).toEqual([
      "t-old",
      "t-keep",
      "t-new",
    ]);
  });
  it("puts the relink on the card without touching its printed players", () => {
    const card = { players: ["A"], teams: ["T"] } as { players: string[]; teams: string[] };
    const out = applyCareerCardEdit(card, {
      playerIdByName: [{ name: "A", playerId: pid("p1") }],
    }) as typeof card & { playerIdByName?: unknown };
    expect(out.players).toEqual(["A"]);
    expect(out.playerIdByName).toEqual([{ name: "A", playerId: "p1" }]);
  });
});

describe("classifyPairs with a failed read", () => {
  const rows: CareerRow[] = [
    { kind: "player", name: "Mike Trout", decision: { action: "link", linkedPlayerId: "p-other" } },
  ];
  const pairs = deriveSittingPairs({ cards: CARDS, rows, context: CONTEXT });
  const judged = gateJudgedKeys({ cards: CARDS, context: CONTEXT });
  const other = pairs.find((p) => p.playerId === "p-other")!;

  it("is neither covered nor a gap nor waiting: it is reported as failed", () => {
    const out = classifyPairs({
      pairs,
      judgedByGate: judged,
      context: CONTEXT,
      coverage: {},
      failed: { [pairKey(other)]: true },
    });
    expect(out.failed).toEqual([other]);
    expect(out.pending).toEqual([]);
    expect(out.gaps.map((p) => p.playerId)).toEqual(["p-tatis"]);
  });

  it("an answer that arrived wins over an old failure", () => {
    const out = classifyPairs({
      pairs,
      judgedByGate: judged,
      context: CONTEXT,
      coverage: { [pairKey(other)]: false },
      failed: { [pairKey(other)]: true },
    });
    expect(out.failed).toEqual([]);
    expect(out.gaps.map((p) => p.playerId)).toContain("p-other");
  });
});

describe("unreferencedCreatedTeamRows", () => {
  const rows: CareerRow[] = [
    { kind: "team", name: "Angels", decision: { action: "create" } },
    { kind: "team", name: "Padres", decision: { action: "create" } },
    { kind: "team", name: "Reds", decision: { action: "link", linkedTeamId: "t-reds" } },
  ];

  it("lists a New Team whose only printed reference came off its card", () => {
    const before = [{ teams: ["Angels"] }, { teams: ["Padres"] }];
    const after = [{ teams: [] as string[] }, { teams: ["Padres"] }];
    expect(unreferencedCreatedTeamRows(before, after, rows)).toEqual(["angels"]);
  });

  it("keeps a team another card still prints", () => {
    const before = [{ teams: ["Angels"] }, { teams: ["Angels"] }];
    const after = [{ teams: [] as string[] }, { teams: ["Angels"] }];
    expect(unreferencedCreatedTeamRows(before, after, rows)).toEqual([]);
  });

  it("keeps a team the same card still prints beside the dropped one", () => {
    const before = [{ teams: ["Angels", "Padres"] }];
    const after = [{ teams: ["Padres"] }];
    expect(unreferencedCreatedTeamRows(before, after, rows)).toEqual(["angels"]);
  });

  it("reads the legacy single team, and ignores linked rows and rows no card named", () => {
    expect(unreferencedCreatedTeamRows([{ team: "Angels" }], [{}], rows)).toEqual(["angels"]);
    expect(unreferencedCreatedTeamRows([{ team: "Reds" }], [{}], rows)).toEqual([]);
    expect(unreferencedCreatedTeamRows([{}], [{}], rows)).toEqual([]);
  });

  it("is nothing when nothing changed", () => {
    const cards = [{ teams: ["Angels"] }];
    expect(unreferencedCreatedTeamRows(cards, cards, rows)).toEqual([]);
  });
});

describe("adversarial: careerCommitFields", () => {
  it("two lines on one card, both re-teamed, drop both printed teams and keep both picks", () => {
    const cards = [
      { cardNumber: "5", cardName: "Two", players: ["Mike Trout"], teams: ["Angels", "Padres"] },
    ];
    const context: CareerContext = {
      ...CONTEXT,
      gaps: [
        { teamId: tid("t-angels"), playerIds: [pid("p-trout")] },
        { teamId: tid("t-padres"), playerIds: [pid("p-trout")] },
      ],
    };
    const lines = toLines(deriveSittingPairs({ cards, rows: [], context }));
    expect(lines).toHaveLength(2);
    const answers: CareerAnswers = {
      [lines[0].key]: { kind: "team", pick: { teamId: tid("t-a2"), name: "A2" }, then: { kind: "leave" } },
      [lines[1].key]: { kind: "team", pick: { teamId: tid("t-p2"), name: "P2" }, then: { kind: "leave" } },
    };
    const out = careerCommitFields({ lines, answers, cards, maxYear: 2030 });
    const applied = applyCareerCardEdit({ ...cards[0], teamIds: [] as Id<"teams">[] }, out?.cardEdits[0]);
    expect(applied.teams).toEqual([]);
    expect(applied.teamIds).toEqual(["t-a2", "t-p2"]);
  });

  it("a stint staged twice on one line (same team, same From year) is sent once", () => {
    const lines = toLines(deriveSittingPairs({ cards: CARDS, rows: [], context: CONTEXT }));
    const tatis = lines.find((l) => l.playerId === "p-tatis")!;
    const out = careerCommitFields({
      lines,
      answers: { [tatis.key]: { kind: "add", stints: [stint("t-padres", 2022), stint("t-padres", 2022, 2023)] } },
      cards: CARDS,
      maxYear: 2030,
    });
    expect(out?.stints).toHaveLength(1);
  });

  it("never sends more stints than the commit accepts", () => {
    const lines = toLines(deriveSittingPairs({ cards: CARDS, rows: [], context: CONTEXT }));
    const tatis = lines.find((l) => l.playerId === "p-tatis")!;
    const many = Array.from({ length: CAREER_STINTS_MAX + 20 }, (_, i) => stint(`t-${i}`, 2000));
    const out = careerCommitFields({
      lines,
      answers: { [tatis.key]: { kind: "add", stints: many } },
      cards: CARDS,
      maxYear: 2030,
    });
    expect(out?.stints).toHaveLength(CAREER_STINTS_MAX);
  });
});


describe("a card settled from the uploaded checklist is checked like any other", () => {
  // The marketplace said Trout; the operator took the checklist's Tatis. The
  // gate resolved and judged the checklist side up front (`gaps` below), so the
  // settled card has its pair, judged by the gate, with no read to wait for.
  const settled = [
    { cardNumber: "7", cardName: "Tatis", players: ["Fernando Tatis Jr."], teams: ["Padres"] },
  ];

  it("lists the settled card's pair from the gate's own answers", () => {
    const pairs = deriveSittingPairs({ cards: settled, rows: [], context: CONTEXT });
    expect(pairs.map(pairKey)).toEqual(["p-tatis|t-padres"]);
    const judged = gateJudgedKeys({ cards: settled, context: CONTEXT });
    const { gaps, pending } = classifyPairs({
      pairs,
      judgedByGate: judged,
      context: CONTEXT,
      coverage: {},
    });
    expect(gaps.map(pairKey)).toEqual(["p-tatis|t-padres"]);
    expect(pending).toEqual([]);
  });

  it("had no pair at all when the gate left the checklist's names out of the context", () => {
    const withoutChecklistNames: CareerContext = { ...CONTEXT, players: [], teams: [], gaps: [] };
    expect(deriveSittingPairs({ cards: settled, rows: [], context: withoutChecklistNames })).toEqual([]);
  });
});

describe("a new player (NEO-591)", () => {
  const lines = toLines(deriveSittingPairs({ cards: CARDS, rows: [], context: CONTEXT }));
  const tatis = lines.find((l) => l.playerId === "p-tatis")!;
  const trout = lines.find((l) => l.playerId === "p-trout")!;
  const teamRef = { teamId: tid("t-padres"), label: "San Diego Padres" };

  const answerOf = (name: string, ref = "np-one", stints?: StagedStint[]) =>
    ({
      kind: "player",
      pick: { new: true, ref, name },
      then: { kind: "add", stints: stints ?? preAddedStints(teamRef, 2022, 2026) },
    }) as const;

  it("mints a ref the wire accepts, and a different one each time", () => {
    const a = newPlayerRef();
    expect(a).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
    expect(newPlayerRef()).not.toBe(a);
  });

  it("opens as the printed name with the card's team staged, keeping a ref it already has", () => {
    const answer = newPlayerAnswer({
      printedName: "  Fernando Tatis Jr. ",
      team: teamRef,
      setYear: 2022,
      currentYear: 2026,
    });
    expect(answer).toMatchObject({
      kind: "player",
      pick: { new: true, name: "Fernando Tatis Jr." },
      then: { kind: "add", stints: [{ teamId: "t-padres", fromYear: 2022, toYear: 2022 }] },
    });
    const kept = newPlayerAnswer({ printedName: "X", team: teamRef, setYear: 2022, ref: "np-keep" });
    expect(kept.kind === "player" && kept.pick && isNewPlayerPick(kept.pick) && kept.pick.ref).toBe(
      "np-keep",
    );
  });

  it("cleans a name for the wire: white space folded, invisible characters gone, bounded", () => {
    expect(cleanNewPlayerName("  Luis \t Rodriguez\n")).toBe("Luis Rodriguez");
    expect(cleanNewPlayerName("Lu\u200Bis\u0007 Rodriguez")).toBe("Luis Rodriguez");
    expect(cleanNewPlayerName(" \u200B ")).toBe("");
    // NEO-643: the shared cleanser — BSC's backslash and a soft hyphen go too.
    expect(cleanNewPlayerName("Wilmer R\\ios")).toBe("Wilmer Rios");
    expect(cleanNewPlayerName("Lu\u00ADis \u200E Rodriguez")).toBe("Luis Rodriguez");
    expect(cleanNewPlayerName("x".repeat(500))).toHaveLength(120);
  });

  it("sends the player once, with the line's stints, and points the line's cards at its ref", () => {
    const out = careerCommitFields({
      lines,
      answers: { [tatis.key]: answerOf("Luis Rodriguez") },
      cards: CARDS,
      maxYear: 2030,
    });
    expect(out?.newPlayers).toEqual([
      {
        ref: "np-one",
        name: "Luis Rodriguez",
        stints: [{ teamId: "t-padres", fromYear: 2022, toYear: 2022 }],
      },
    ]);
    // Only the line's cards; the printed spelling is the card's own.
    expect(out?.cardEdits[0]).toEqual({
      newPlayerByName: [{ name: "Fernando Tatis Jr.", ref: "np-one" }],
    });
    expect(out?.cardEdits[1]).toEqual({
      newPlayerByName: [{ name: "Fernando Tatis Jr.", ref: "np-one" }],
    });
    expect(out?.cardEdits[2]).toBeUndefined();
    // Not an existing-player stint, and no relink.
    expect(out?.stints).toEqual([]);
    expect(out?.cardEdits.some((e) => e?.playerIdByName)).toBe(false);
  });

  it("sends a player who has no stints at all", () => {
    const out = careerCommitFields({
      lines,
      answers: { [tatis.key]: answerOf("Luis Rodriguez", "np-one", []) },
      cards: CARDS,
      maxYear: 2030,
    });
    expect(out?.newPlayers).toEqual([{ ref: "np-one", name: "Luis Rodriguez", stints: [] }]);
  });

  it("sends nothing for a new player with no name yet", () => {
    expect(
      careerCommitFields({
        lines,
        answers: { [tatis.key]: answerOf("   ") },
        cards: CARDS,
        maxYear: 2030,
      }),
    ).toBeUndefined();
  });

  it("treats a name with no letter or digit as not named", () => {
    expect(newPlayerNameReady("Luis Rodriguez")).toBe(true);
    expect(newPlayerNameReady("J.")).toBe(true);
    expect(newPlayerNameReady("... -")).toBe(false);
    expect(newPlayerNameReady("")).toBe(false);
    expect(
      careerCommitFields({
        lines,
        answers: { [tatis.key]: answerOf("?!") },
        cards: CARDS,
        maxYear: 2030,
      }),
    ).toBeUndefined();
  });

  it("folds two lines that name the same person into one player: the first line's ref, both lines' stints", () => {
    const stintFor = (team: string, year: number): StagedStint => ({
      teamId: tid(team),
      label: team,
      fromYear: year,
    });
    // Lines are sorted by team: Angels (Trout) first.
    const out = careerCommitFields({
      lines,
      answers: {
        [trout.key]: answerOf("Luis  Rodriguez", "np-first", [stintFor("t-angels", 2022)]),
        [tatis.key]: answerOf("luis rodriguez", "np-second", [
          stintFor("t-padres", 2022),
          stintFor("t-angels", 2022),
        ]),
      },
      cards: CARDS,
      maxYear: 2030,
    });
    expect(out?.newPlayers).toHaveLength(1);
    expect(out?.newPlayers?.[0]).toMatchObject({ ref: "np-first", name: "Luis Rodriguez" });
    expect(out?.newPlayers?.[0].stints).toEqual([
      { teamId: "t-angels", fromYear: 2022 },
      { teamId: "t-padres", fromYear: 2022 },
    ]);
    // Every card of both lines carries the one ref.
    const refs = out?.cardEdits.flatMap((e) => (e?.newPlayerByName ?? []).map((x) => x.ref));
    expect(new Set(refs)).toEqual(new Set(["np-first"]));
  });

  it("keeps two differently-named new players apart", () => {
    const out = careerCommitFields({
      lines,
      answers: {
        [trout.key]: answerOf("Luis Rodriguez", "np-a", []),
        [tatis.key]: answerOf("Luis Rodriguez Jr.", "np-b", []),
      },
      cards: CARDS,
      maxYear: 2030,
    });
    expect(out?.newPlayers?.map((p) => p.ref).sort()).toEqual(["np-a", "np-b"]);
  });

  it("drops a stint that names a team by a printed string no card carries any more", () => {
    const named: StagedStint = { teamName: "Gone Team", label: "Gone Team", fromYear: 2022 };
    const out = careerCommitFields({
      lines,
      answers: { [tatis.key]: answerOf("Luis Rodriguez", "np-one", [named, stint("t-reds", 2022)]) },
      cards: CARDS,
      maxYear: 2030,
    });
    expect(out?.newPlayers?.[0].stints).toEqual([{ teamId: "t-reds", fromYear: 2022 }]);
  });

  it("names a batch-created team by the string a card still prints", () => {
    const named: StagedStint = { teamName: "Padres", label: "San Diego Padres", fromYear: 2022 };
    const out = careerCommitFields({
      lines,
      answers: { [tatis.key]: answerOf("Luis Rodriguez", "np-one", [named]) },
      cards: CARDS,
      maxYear: 2030,
    });
    expect(out?.newPlayers?.[0].stints).toEqual([{ teamName: "Padres", fromYear: 2022 }]);
  });

  it("leaves the existing-player wire exactly as it was (no newPlayers key)", () => {
    const out = careerCommitFields({
      lines,
      answers: { [tatis.key]: { kind: "add", stints: [stint("t-padres", 2022)] } },
      cards: CARDS,
      maxYear: 2030,
    });
    expect(out).not.toHaveProperty("newPlayers");
  });

  it("asks no coverage question about a new player", () => {
    expect(followUpPair(tatis, answerOf("Luis Rodriguez"))).toBeNull();
  });

  it("stintsOf reads the new player's staged stints", () => {
    expect(stintsOf(answerOf("Luis Rodriguez"))).toHaveLength(1);
  });

  it("puts newPlayerByName on the card, without touching its printed players", () => {
    const card = { players: ["A"], teams: ["T"] } as { players: string[]; teams: string[] };
    const out = applyCareerCardEdit(card, {
      newPlayerByName: [{ name: "A", ref: "np-one" }],
    }) as typeof card & { newPlayerByName?: unknown };
    expect(out.players).toEqual(["A"]);
    expect(out.newPlayerByName).toEqual([{ name: "A", ref: "np-one" }]);
  });

  it("shares the stint budget with the existing players' stints", () => {
    const many: StagedStint[] = Array.from({ length: CAREER_STINTS_MAX + 20 }, (_, i) => ({
      teamId: tid(`t-${i}`),
      label: `T${i}`,
      fromYear: 1990,
    }));
    const out = careerCommitFields({
      lines,
      answers: { [tatis.key]: answerOf("Luis Rodriguez", "np-one", many) },
      cards: CARDS,
      maxYear: 2030,
    });
    expect(out?.newPlayers?.[0].stints).toHaveLength(CAREER_STINTS_MAX);
  });
});

describe("defaultCareerAnswer (an untouched line is Add to career)", () => {
  const line = { teamId: "t-padres", teamName: undefined };

  it("stages the card's team the way Add to career does, label included", () => {
    expect(defaultCareerAnswer(line, 2022, "San Diego Padres", 2026)).toEqual({
      kind: "add",
      stints: [{ teamId: "t-padres", label: "San Diego Padres", fromYear: 2022, toYear: 2022 }],
    });
    expect(defaultCareerAnswer(line, 2026, "San Diego Padres", 2026).stints).toEqual([
      { teamId: "t-padres", label: "San Diego Padres", fromYear: 2026 },
    ]);
  });

  it("names a batch team by its printed text", () => {
    expect(defaultCareerAnswer({ teamId: undefined, teamName: "Padres" }, 2022, "Padres", 2026).stints).toEqual([
      { teamName: "Padres", label: "Padres", fromYear: 2022, toYear: 2022 },
    ]);
  });

  it("is still an add, with nothing staged, when the team cannot be named or the set has no year", () => {
    expect(defaultCareerAnswer({ teamId: undefined, teamName: undefined }, 2022)).toEqual({
      kind: "add",
      stints: [],
    });
    expect(defaultCareerAnswer(line, undefined)).toEqual({ kind: "add", stints: [] });
  });

  it("lineStintTeam is the line's team ref with the chip's label", () => {
    expect(lineStintTeam(line, "San Diego Padres")).toEqual({ teamId: "t-padres", label: "San Diego Padres" });
    expect(lineStintTeam({ teamId: undefined, teamName: "Padres" })).toEqual({ teamName: "Padres", label: "" });
  });
});
