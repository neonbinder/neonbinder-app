/**
 * NEO-645 (Q1 = A) — the batch tier of the commit's team fill.
 *
 * `planBatchTeamFill` is pure: a teamless card takes a team only when the same
 * player set is printed WITH a team on other cards of the commit and they all
 * agree on ONE team set. Rule 8: a card a source named a team on (`mayFill`
 * false) is never filled, however strong the evidence.
 */

import { describe, expect, test } from "vitest";
import { planBatchTeamFill, type FillCard } from "./teamFillOnCommit";

const card = (index: number, over: Partial<FillCard> = {}): FillCard => ({
  index,
  players: ["p1"],
  teamIds: [],
  mayFill: true,
  ...over,
});

describe("planBatchTeamFill", () => {
  test("a teamless card takes the team the same player has on another card", () => {
    const out = planBatchTeamFill([card(0, { teamIds: ["padres"] }), card(1)], 8);
    expect(out).toEqual([{ index: 1, teamIds: ["padres"], reason: "otherCards" }]);
  });

  test("never fills the evidence card itself", () => {
    const out = planBatchTeamFill([card(0, { teamIds: ["padres"] })], 8);
    expect(out).toEqual([]);
  });

  test("rule 8: a card a source named a team on is never filled", () => {
    const out = planBatchTeamFill(
      [card(0, { teamIds: ["padres"] }), card(1, { mayFill: false })],
      8,
    );
    expect(out).toEqual([]);
  });

  test("a traded player (two different team sets) fills nothing", () => {
    const out = planBatchTeamFill(
      [card(0, { teamIds: ["padres"] }), card(1, { teamIds: ["mets"] }), card(2)],
      8,
    );
    expect(out).toEqual([]);
  });

  test("the same team set listed in another order is one set", () => {
    const out = planBatchTeamFill(
      [
        card(0, { teamIds: ["padres", "mets"] }),
        card(1, { teamIds: ["mets", "padres"] }),
        card(2),
      ],
      8,
    );
    expect(out).toHaveLength(1);
    expect(out[0].index).toBe(2);
  });

  test("evidence is per player SET: a different player on the card is not evidence", () => {
    const out = planBatchTeamFill(
      [card(0, { players: ["p2"], teamIds: ["padres"] }), card(1, { players: ["p1"] })],
      8,
    );
    expect(out).toEqual([]);
  });

  test("a two-player card is matched on the exact set, order aside", () => {
    const out = planBatchTeamFill(
      [
        card(0, { players: ["a", "b"], teamIds: ["padres"] }),
        card(1, { players: ["b", "a"] }),
        card(2, { players: ["a"] }),
      ],
      8,
    );
    expect(out).toEqual([{ index: 1, teamIds: ["padres"], reason: "otherCards" }]);
  });

  test("a card with no player is never filled", () => {
    const out = planBatchTeamFill(
      [card(0, { teamIds: ["padres"] }), card(1, { players: [] })],
      8,
    );
    expect(out).toEqual([]);
  });

  test("a card that already has a team keeps it", () => {
    const out = planBatchTeamFill(
      [card(0, { teamIds: ["padres"] }), card(1, { teamIds: ["padres"] })],
      8,
    );
    expect(out).toEqual([]);
  });

  test("the fill is capped at maxTeams", () => {
    const many = ["t1", "t2", "t3", "t4"];
    const out = planBatchTeamFill([card(0, { teamIds: many }), card(1)], 2);
    expect(out[0].teamIds).toEqual(["t1", "t2"]);
  });

  test("duplicate ids in the evidence are written once", () => {
    const out = planBatchTeamFill([card(0, { teamIds: ["padres", "padres"] }), card(1)], 8);
    expect(out[0].teamIds).toEqual(["padres"]);
  });

  test("every teamless card of the player is filled, each by index", () => {
    const out = planBatchTeamFill(
      [card(0, { teamIds: ["padres"] }), card(1), card(2), card(3, { mayFill: false })],
      8,
    );
    expect(out.map((f) => f.index)).toEqual([1, 2]);
  });
});
