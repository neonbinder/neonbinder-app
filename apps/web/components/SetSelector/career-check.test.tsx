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
  noStintText,
  coveredText,
  playedForText,
  sortCareerLines,
  uncoveredAgainText,
  careerContextAsks,
  classifyPairs,
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
    expect(preAddedStints({ teamId: tid("t-padres"), label: "San Diego Padres" }, 2022)).toEqual([
      { teamId: "t-padres", label: "San Diego Padres", fromYear: 2022 },
    ]);
    // A team the batch creates is named by its printed string.
    expect(preAddedStints({ teamName: "Padres", label: "San Diego Padres" }, 2022)).toEqual([
      { teamName: "Padres", label: "San Diego Padres", fromYear: 2022 },
    ]);
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

  it("is nothing when every line is left", () => {
    expect(careerCommitFields({ lines, answers: {}, cards: CARDS, maxYear: 2030 })).toBeUndefined();
    expect(
      careerCommitFields({ lines, answers: { [tatis.key]: { kind: "leave" } }, cards: CARDS, maxYear: 2030 }),
    ).toBeUndefined();
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
