import { describe, expect, it } from "vitest";
import { leagueShortName, teamDetailLine } from "./team-detail";

describe("teamDetailLine", () => {
  it("says the league and the years, the way the team candidates do", () => {
    expect(teamDetailLine("MLB", { from: 1954 })).toBe("MLB · 1954–present");
    expect(teamDetailLine("American League", { from: 1901, to: 1953 })).toBe(
      "American League · 1901–1953",
    );
  });

  it("says only what the row has", () => {
    expect(teamDetailLine(undefined, { from: 1954 })).toBe("1954–present");
    expect(teamDetailLine("MLB", undefined)).toBe("MLB");
    expect(teamDetailLine("  ", undefined)).toBe("");
    expect(teamDetailLine(undefined, undefined)).toBe("");
  });

  it("tells three same-name teams apart", () => {
    const lines = [
      teamDetailLine("MLB", { from: 1954 }),
      teamDetailLine("MLB", { from: 1901, to: 1953 }),
      teamDetailLine("International League", { from: 1884, to: 1953 }),
    ];
    expect(new Set(lines).size).toBe(3);
  });
});

describe("leagueShortName", () => {
  it("prefers the abbreviation and falls back to the name", () => {
    expect(leagueShortName({ name: "Major League Baseball", abbreviation: "MLB" })).toBe("MLB");
    expect(leagueShortName({ name: "Major League Baseball", abbreviation: " " })).toBe(
      "Major League Baseball",
    );
    expect(leagueShortName({ name: "Pac-12" })).toBe("Pac-12");
  });
});
