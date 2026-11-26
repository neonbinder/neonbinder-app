/**
 * NEO-661 (Jason, 2026-11-24: "if there is anything that would cause a pink
 * box we should hold the parallels back.") — `blocksParallelBuild`: the one
 * rule behind "the parallels wait", read by the server's refusal and the
 * client's held auto-start. Any pink item holds the build (it is exactly
 * `deriveCardAttention(row).level === "fix"`); a card that is only blue, only
 * awaiting its team lookup, or tidy does not. (NEO-645 J3 held only names.)
 */

import { describe, expect, test } from "vitest";
import {
  blocksParallelBuild,
  deriveCardAttention,
  isAwaitingTeamLookup,
  parallelBuildHold,
} from "./cardAttention";

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

  test("a teamless card is pink and holds the build", () => {
    const teamless = row();
    expect(deriveCardAttention(teamless).items.some((i) => i.kind === "noTeam")).toBe(true);
    expect(blocksParallelBuild(teamless)).toBe(true);
  });

  test("an autograph with no format is pink and holds the build", () => {
    const au = row({ teamNoneConfirmedAt: 1, attributes: ["AU"] });
    expect(deriveCardAttention(au).items.some((i) => i.kind === "autograph")).toBe(true);
    expect(blocksParallelBuild(au)).toBe(true);
  });

  test("a card with no name holds the build", () => {
    const nameless = row({ teamNoneConfirmedAt: 1, cardName: "" });
    expect(deriveCardAttention(nameless).items.some((i) => i.kind === "needsName")).toBe(true);
    expect(blocksParallelBuild(nameless)).toBe(true);
  });

  test("a title over the eBay limit holds the build", () => {
    const long = row({ teamNoneConfirmedAt: 1, listingTitle: "A".repeat(81) });
    expect(deriveCardAttention(long).items.some((i) => i.kind === "titleOverLimit")).toBe(true);
    expect(blocksParallelBuild(long)).toBe(true);
  });

  test("a card still awaiting its team lookup holds the build (wait for lookups)", () => {
    const awaiting = row({ platformData: { bsc: { ref: "ref-1" } } });
    expect(isAwaitingTeamLookup(awaiting)).toBe(true);
    expect(deriveCardAttention(awaiting).level).toBe("none");
    expect(blocksParallelBuild(awaiting)).toBe(true);
  });

  test("a card whose lookup finished with a team does not hold the build", () => {
    const answered = row({
      platformData: { bsc: { ref: "ref-1" } },
      teamCheckDoneAt: 5,
      teamOnCardIds: ["t1"],
    });
    expect(isAwaitingTeamLookup(answered)).toBe(false);
    expect(blocksParallelBuild(answered)).toBe(false);
  });

  test("a card the operator confirmed has no team does not hold the build", () => {
    expect(blocksParallelBuild(row({ teamNoneConfirmedAt: 1 }))).toBe(false);
  });

  test("a card that is only blue (a cut title) does not hold the build", () => {
    const cut = row({ teamNoneConfirmedAt: 1, listingTitleTruncated: true });
    const attention = deriveCardAttention(cut);
    expect(attention.level).toBe("check");
    expect(blocksParallelBuild(cut)).toBe(false);
  });

  test("a card that is only blue (a career gap) does not hold the build", () => {
    // NEO-656: a career gap is read live (`careerCoverage.careerGaps`), never from the row.
    const gap = row({ playerIds: ["p1"], teamOnCardIds: ["t1"] });
    const attention = deriveCardAttention(gap, { careerGaps: [{ playerId: "p1", teamId: "t1" }] });
    expect(attention.items.some((i) => i.kind === "careerGap")).toBe(true);
    expect(attention.level).toBe("check");
    expect(blocksParallelBuild(gap)).toBe(false);
  });

  test("a tidy card does not hold it", () => {
    expect(blocksParallelBuild(row({ teamNoneConfirmedAt: 1 }))).toBe(false);
  });
});

describe("parallelBuildHold", () => {
  const awaiting = { platformData: { bsc: { ref: "ref-1" } } };

  test("a pink card answers fix", () => {
    expect(parallelBuildHold(row({ pendingPlayerNames: ["S. Ohtani"] }))).toBe("fix");
  });

  test("a card only awaiting its lookup answers lookup", () => {
    expect(parallelBuildHold(row(awaiting))).toBe("lookup");
  });

  test("a card both pink and awaiting answers fix (pink wins)", () => {
    const pinkAwaiting = row({ ...awaiting, attributes: ["AU"] });
    expect(isAwaitingTeamLookup(pinkAwaiting)).toBe(true);
    expect(deriveCardAttention(pinkAwaiting).level).toBe("fix");
    expect(parallelBuildHold(pinkAwaiting)).toBe("fix");
  });

  test("a tidy or only-blue card answers null", () => {
    expect(parallelBuildHold(row({ teamNoneConfirmedAt: 1 }))).toBeNull();
    expect(parallelBuildHold(row({ teamNoneConfirmedAt: 1, listingTitleTruncated: true }))).toBeNull();
  });
});
