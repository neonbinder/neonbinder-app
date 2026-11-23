import { describe, expect, test } from "vitest";
import { NO_PLAYERS_LINE_KEY, hasTeamLine, teamLineKey } from "./teamLine";

describe("hasTeamLine (NEO-645)", () => {
  test("a card with nobody on it is on the no-players line, which has no team to apply", () => {
    expect(teamLineKey({ playerIds: [] })).toBe(NO_PLAYERS_LINE_KEY);
    expect(hasTeamLine(NO_PLAYERS_LINE_KEY)).toBe(false);
    expect(hasTeamLine(teamLineKey({}))).toBe(false);
  });

  test("a card with a player is on a real line", () => {
    expect(hasTeamLine(teamLineKey({ playerIds: ["p1"] }))).toBe(true);
    expect(hasTeamLine(teamLineKey({ playerIds: ["p1", "p2"], bscTeamName: "Royals" }))).toBe(true);
  });
});
