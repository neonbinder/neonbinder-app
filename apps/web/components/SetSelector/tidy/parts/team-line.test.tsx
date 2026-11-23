/**
 * NEO-645 (A12/B5, B1-B4, B6-B8, B12) — `buildTeamLine` decides one card's team
 * evidence the way main's Tidy Up wizard decided one line
 * (`teams-on-cards.test.tsx`). Literal rows in, a decision out. (`.test.tsx`:
 * the components project only collects that suffix.)
 */
import { describe, expect, it } from "vitest";
import type { Id } from "../../../../convex/_generated/dataModel";
import { MAX_CARD_TEAMS } from "../../../../convex/features/cardAttention";
import { buildTeamLine, TEAM_OPTIONS_MAX, type PlayerEvidence } from "./team-line";

const team = (n: number | string) => `team${n}` as Id<"teams">;
const t = (n: number | string, rank?: number) => ({
  teamId: team(n),
  name: `Team ${n}`,
  ...(rank === undefined ? {} : { rank }),
});
const career = (tier: string, ...teams: ReturnType<typeof t>[]): PlayerEvidence => ({
  answer: { tier, teams },
  candidates: teams,
});
const none = (...candidates: ReturnType<typeof t>[]): PlayerEvidence => ({ answer: null, candidates });

const line = (
  playerIds: string[],
  evidence: Record<string, PlayerEvidence>,
  over: { batchSets?: Array<Array<Id<"teams">>>; held?: "setNoTeam" | "listing" | "checklist" | null; setYear?: number | null } = {},
) =>
  buildTeamLine({
    playerIds,
    evidence: new Map(Object.entries(evidence)),
    batchSets: over.batchSets ?? [],
    held: over.held ?? null,
    setYear: over.setYear === undefined ? 2024 : over.setYear,
  });

describe("tier 1: the checklist's other cards of the same player set (batch)", () => {
  it("one distinct team set pre-fills, ahead of the server's answer", () => {
    const l = line(["p1"], { p1: career("career", t(9)) }, { batchSets: [[team(1)]] });
    expect(l.suggestion).toEqual([team(1)]);
    expect(l.source).toBe("otherCards");
    expect(l.options[0].teamId).toBe(team(1));
  });

  it("the checklist disagreeing with itself STOPS the search: every team offered, none selected, the career does not speak", () => {
    const l = line(["p1"], { p1: career("career", t(9)) }, { batchSets: [[team(1)], [team(2)]] });
    expect(l.suggestion).toEqual([]);
    expect(l.options.map((o) => o.teamId).sort()).toEqual([team(1), team(2)].sort());
    expect(l.options.map((o) => o.teamId)).not.toContain(team(9));
    expect(l.disagree).toBe(true);
  });

  it("a two-team batch set pre-fills both", () => {
    const l = line(["p1"], {}, { batchSets: [[team(1), team(2)]] });
    expect(l.suggestion).toEqual([team(1), team(2)]);
  });

  it("a card with nobody on it has no batch and no evidence: nothing", () => {
    const l = line([], {}, { batchSets: [[team(1)]] });
    expect(l.suggestion).toEqual([]);
    expect(l.options).toEqual([]);
  });
});

describe("tier 2: per player, stored cards then career (B1-B4 are the server's, passed through)", () => {
  it("one player, one answer: pre-filled, from the career", () => {
    const l = line(["p1"], { p1: career("career", t(1)) });
    expect(l.suggestion).toEqual([team(1)]);
    expect(l.source).toBe("career");
  });

  it("a stored-card answer says so", () => {
    const l = line(["p1"], { p1: career("sameNode", t(1)) });
    expect(l.suggestion).toEqual([team(1)]);
    expect(l.source).toBe("otherCards");
  });

  it("the evidence has not arrived: loading, nothing selected", () => {
    const l = buildTeamLine({ playerIds: ["p1"], evidence: undefined, batchSets: [], held: null, setYear: 2024 });
    expect(l.loading).toBe(true);
    expect(l.suggestion).toEqual([]);
  });

  it("B6: several players, every one answers: the union is the pre-fill, in card order", () => {
    const l = line(["p1", "p2"], { p1: career("career", t(1)), p2: career("sameNode", t(2)) });
    expect(l.suggestion).toEqual([team(1), team(2)]);
    expect(l.options.find((o) => o.teamId === team(2))!.playerIds).toEqual(["p2"]);
  });

  it("B6: two players with the same team make one team", () => {
    const l = line(["p1", "p2"], { p1: career("career", t(1)), p2: career("career", t(1)) });
    expect(l.suggestion).toEqual([team(1)]);
  });

  it("B6: one player unsure offers every team unselected, the co-player's answer included", () => {
    const l = line(["p1", "p2"], { p1: career("career", t(1)), p2: none(t(2), t(3)) });
    expect(l.suggestion).toEqual([]);
    expect(l.options.map((o) => o.teamId).sort()).toEqual([team(1), team(2), team(3)].sort());
  });

  it("B6: a union over what a card holds pre-fills nothing, and every team is a choice", () => {
    const ids = Array.from({ length: MAX_CARD_TEAMS + 1 }, (_, i) => `p${i}`);
    const evidence = Object.fromEntries(ids.map((id, i) => [id, career("career", t(i + 1))]));
    const l = line(ids, evidence);
    expect(l.suggestion).toEqual([]);
    expect(l.options.length).toBeGreaterThanOrEqual(MAX_CARD_TEAMS + 1 > TEAM_OPTIONS_MAX ? TEAM_OPTIONS_MAX : MAX_CARD_TEAMS + 1);
  });

  it("B12: a tie pre-fills nothing, and says it is a tie when two stints cover the window", () => {
    const stints = [
      { teamId: team(1), fromYear: 2018 },
      { teamId: team(2), fromYear: 2022 },
    ];
    const l = line(["p1"], { p1: { answer: null, candidates: [t(1), t(2)], stints } });
    expect(l.suggestion).toEqual([]);
    expect(l.tie).toBe(true);
    expect(l.options.map((o) => o.teamId)).toEqual([team(1), team(2)]);
  });

  it("B2: a tie-break pre-fills one and keeps the teams it ranked below as choices", () => {
    const l = line(["p1"], {
      p1: { answer: { tier: "career", teams: [t(1, 0)] }, candidates: [t(1, 0), t(2, 1)] },
    });
    expect(l.suggestion).toEqual([team(1)]);
    expect(l.options.map((o) => o.teamId)).toEqual([team(1), team(2)]);
  });

  it("nothing in the set year: the career is offered whole, unselected, with the year it lacks", () => {
    const stints = [{ teamId: team(1), fromYear: 2010, toYear: 2018 }];
    const l = line(["p1"], { p1: { answer: null, candidates: [t(1)], stints } });
    expect(l.suggestion).toEqual([]);
    expect(l.uncoveredSetYear).toBe(2024);
    expect(l.tie).toBe(false);
  });

  it("no year on the set: the career is offered whole, and says so", () => {
    const stints = [{ teamId: team(1), fromYear: 2010 }];
    const l = line(["p1"], { p1: { answer: null, candidates: [t(1)], stints } }, { setYear: null });
    expect(l.suggestion).toEqual([]);
    expect(l.noYear).toBe(true);
  });

  it("the player's stored cards disagreeing: teams the career does not hold are offered, and it says they disagree", () => {
    const l = line(["p1"], { p1: { answer: null, candidates: [t(7), t(8)], stints: [] } });
    expect(l.suggestion).toEqual([]);
    expect(l.disagree).toBe(true);
  });

  it("options are capped at six, but a longer pre-fill is never cut", () => {
    const many = Array.from({ length: 9 }, (_, i) => t(i + 1));
    const l = line(["p1"], { p1: none(...many) });
    expect(l.options).toHaveLength(TEAM_OPTIONS_MAX);
    const batch = line(["p1"], {}, { batchSets: [[team(1), team(2), team(3)]] });
    expect(batch.options).toHaveLength(3);
  });

  it("options keep the pre-fill first, then the rest by preference rank", () => {
    const l = line(["p1"], {
      p1: { answer: { tier: "career", teams: [t(3, 0)] }, candidates: [t(1, 2), t(3, 0), t(2, 1)] },
    });
    expect(l.options.map((o) => o.teamId)).toEqual([team(3), team(2), team(1)]);
  });
});

describe("a data claim holds the pre-fill back (rule 8): it becomes the first unselected choice", () => {
  const evidence = { p1: career("career", t(1)) };

  it.each(["listing", "checklist", "setNoTeam"] as const)("B7/B8: %s pre-fills nothing and offers the team", (held) => {
    const l = line(["p1"], evidence, { held });
    expect(l.suggestion).toEqual([]);
    expect(l.held).toBe(held);
    expect(l.options.map((o) => o.teamId)).toEqual([team(1)]);
  });

  it("a claim holds back the batch answer too", () => {
    const l = line(["p1"], evidence, { held: "listing", batchSets: [[team(5)]] });
    expect(l.suggestion).toEqual([]);
    expect(l.options[0].teamId).toBe(team(5));
  });

  it("no claim, no hold: the same evidence pre-fills (a failed lookup is not a claim, NEO-639)", () => {
    const l = line(["p1"], evidence, { held: null });
    expect(l.suggestion).toEqual([team(1)]);
    expect(l.held).toBeNull();
  });
});
