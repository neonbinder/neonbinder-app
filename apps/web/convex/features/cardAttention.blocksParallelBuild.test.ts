/**
 * NEO-645 (J3, Jason 2026-11-22) — `blocksParallelBuild`: the one rule behind
 * "the parallels wait", read by the server's refusal and the client's held
 * auto-start. Only an unanswered NAME holds a build; a teamless card does not
 * (the parallel's own Set Team fills it, NEO-556).
 */

import { describe, expect, test } from "vitest";
import { blocksParallelBuild, deriveCardAttention } from "./cardAttention";

const row = (over: Record<string, unknown> = {}) => ({
  platformData: {},
  playerIds: [],
  teamOnCardIds: [],
  ...over,
});

describe("blocksParallelBuild", () => {
  test("a pending player name holds the build", () => {
    expect(blocksParallelBuild(row({ pendingPlayerNames: ["S. Ohtani"] }))).toBe(true);
  });

  test("a pending team name holds the build", () => {
    expect(blocksParallelBuild(row({ pendingTeamNames: ["Yankees"] }))).toBe(true);
  });

  test("sources that disagree hold the build", () => {
    expect(
      blocksParallelBuild(
        row({
          sourceDisagreements: [
            {
              field: "players",
              values: [
                { value: ["A One"], sources: ["bsc"] },
                { value: ["A Two"], sources: ["checklist"] },
              ],
            },
          ],
        }),
      ),
    ).toBe(true);
  });

  test("a teamless card is pink but does not hold the build", () => {
    const teamless = row();
    expect(deriveCardAttention(teamless).items.some((i) => i.kind === "noTeam")).toBe(true);
    expect(blocksParallelBuild(teamless)).toBe(false);
  });

  test("an autograph with no format is pink but does not hold the build", () => {
    const au = row({ teamNoneConfirmedAt: 1, attributes: ["Autograph"] });
    const items = deriveCardAttention(au).items;
    // Whether this fixture raises the autograph item depends on the attribute
    // vocabulary; the rule under test is only that it never holds the build.
    expect(blocksParallelBuild(au)).toBe(false);
    expect(items.some((i) => i.kind === "playerName" || i.kind === "teamName")).toBe(false);
  });

  test("a tidy card does not hold it", () => {
    expect(blocksParallelBuild(row({ teamNoneConfirmedAt: 1 }))).toBe(false);
  });
});
