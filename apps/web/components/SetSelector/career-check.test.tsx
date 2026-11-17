/**
 * NEO-574 — the career step's pure model (`career-check.ts`).
 *
 * (`.test.tsx` although it renders nothing: the components project only
 * collects `.test.tsx` under components/.)
 */
import { describe, expect, it } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import {
  applyCareerCardEdit,
  careerCommitFields,
  careerContextAsks,
  classifyPairs,
  deriveSittingPairs,
  followUpPair,
  freshStint,
  gateJudgedKeys,
  linesWithBadYears,
  pairKey,
  parseStintDraft,
  reteamedIndexes,
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

describe("parseStintDraft", () => {
  it("accepts a From year, with or without a To year", () => {
    expect(parseStintDraft({ fromYear: "2022", toYear: "" }, 2030)).toEqual({ fromYear: 2022 });
    expect(parseStintDraft({ fromYear: "2020", toYear: "2022" }, 2030)).toEqual({
      fromYear: 2020,
      toYear: 2022,
    });
  });
  it("refuses blanks, floors, ceilings and an inverted range", () => {
    expect(parseStintDraft({ fromYear: "", toYear: "" }, 2030)).toBeNull();
    expect(parseStintDraft({ fromYear: "1200", toYear: "" }, 2030)).toBeNull();
    expect(parseStintDraft({ fromYear: "2031", toYear: "" }, 2030)).toBeNull();
    expect(parseStintDraft({ fromYear: "2022", toYear: "2020" }, 2030)).toBeNull();
    expect(parseStintDraft({ fromYear: "20.5", toYear: "" }, 2030)).toBeNull();
  });
  it("opens on the set's year", () => {
    expect(freshStint(2022)).toEqual({ fromYear: "2022", toYear: "" });
    expect(freshStint(undefined)).toEqual({ fromYear: "", toYear: "" });
  });
});

describe("careerCommitFields", () => {
  const pairs = deriveSittingPairs({ cards: CARDS, rows: [], context: CONTEXT });
  const lines = toLines(pairs);
  const tatis = lines[0];
  const trout = lines[1];

  it("is nothing when every line is left", () => {
    expect(careerCommitFields({ lines, answers: {}, cards: CARDS, maxYear: 2030 })).toBeUndefined();
    expect(
      careerCommitFields({ lines, answers: { [tatis.key]: { kind: "leave" } }, cards: CARDS, maxYear: 2030 }),
    ).toBeUndefined();
  });

  it("adds a stint by team id", () => {
    const answers: CareerAnswers = { [tatis.key]: { kind: "add", fromYear: "2022", toYear: "" } };
    const out = careerCommitFields({ lines, answers, cards: CARDS, maxYear: 2030 });
    expect(out?.stints).toEqual([{ playerId: "p-tatis", teamId: "t-padres", fromYear: 2022 }]);
    expect(out?.cardEdits.every((e) => e === undefined)).toBe(true);
  });

  it("adds a stint for a team the batch creates by its printed name", () => {
    const created = deriveSittingPairs({
      cards: CARDS,
      rows: [{ kind: "team", name: "Padres", decision: { action: "create" } }],
      context: CONTEXT,
    });
    const line = toLines(created)[0];
    const out = careerCommitFields({
      lines: [line],
      answers: { [line.key]: { kind: "add", fromYear: "2022", toYear: "2023" } },
      cards: CARDS,
      maxYear: 2030,
    });
    expect(out?.stints).toEqual([
      { playerId: "p-tatis", teamName: "Padres", fromYear: 2022, toYear: 2023 },
    ]);
  });

  it("does not send an add whose years are not a stint", () => {
    const answers: CareerAnswers = { [tatis.key]: { kind: "add", fromYear: "", toYear: "" } };
    expect(careerCommitFields({ lines, answers, cards: CARDS, maxYear: 2030 })).toBeUndefined();
    expect(linesWithBadYears(lines, answers, 2030)).toEqual([tatis.key]);
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
        then: { kind: "add", fromYear: "1996", toYear: "" },
      },
    };
    const out = careerCommitFields({ lines, answers, cards: CARDS, maxYear: 2030 });
    expect(out?.stints).toEqual([{ playerId: "p-tatis-sr", teamId: "t-padres", fromYear: 1996 }]);
  });

  it("re-teams the line's cards: the printed string comes off and the pick goes on", () => {
    const answers: CareerAnswers = {
      [trout.key]: {
        kind: "team",
        pick: { teamId: tid("t-other"), name: "Los Angeles Angels" },
        then: { kind: "add", fromYear: "2022", toYear: "" },
      },
    };
    const out = careerCommitFields({ lines, answers, cards: CARDS, maxYear: 2030 });
    expect(out?.cardEdits[2]).toEqual({ dropTeams: ["Angels"], teamIds: ["t-other"] });
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
        [tatis.key]: { kind: "add", fromYear: "2022", toYear: "" },
        other: { kind: "add", fromYear: "2022", toYear: "" },
      },
      cards: CARDS,
      maxYear: 2030,
    });
    expect(out?.stints).toHaveLength(1);
  });
});

describe("followUpPair", () => {
  const line = toLines(deriveSittingPairs({ cards: CARDS, rows: [], context: CONTEXT }))[0];
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

describe("adversarial: careerCommitFields and parseStintDraft", () => {
  it("parseStintDraft holds the year bounds exactly and refuses a to-year before the from-year", () => {
    expect(parseStintDraft({ fromYear: "2030", toYear: "" }, 2030)).toEqual({ fromYear: 2030 });
    expect(parseStintDraft({ fromYear: "2031", toYear: "" }, 2030)).toBeNull();
    expect(parseStintDraft({ fromYear: "2022", toYear: "2021" }, 2030)).toBeNull();
    expect(parseStintDraft({ fromYear: "2022", toYear: "2022" }, 2030)).toEqual({ fromYear: 2022, toYear: 2022 });
    expect(parseStintDraft({ fromYear: "2022.5", toYear: "" }, 2030)).toBeNull();
    expect(parseStintDraft({ fromYear: "abc", toYear: "" }, 2030)).toBeNull();
  });

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

  it("an add on a line sends exactly one stint", () => {
    const lines = toLines(deriveSittingPairs({ cards: CARDS, rows: [], context: CONTEXT }));
    const tatis = lines[0];
    const out = careerCommitFields({
      lines,
      answers: { [tatis.key]: { kind: "add", fromYear: "2022", toYear: "" } },
      cards: CARDS,
      maxYear: 2030,
    });
    expect(out?.stints).toHaveLength(1);
  });
});

