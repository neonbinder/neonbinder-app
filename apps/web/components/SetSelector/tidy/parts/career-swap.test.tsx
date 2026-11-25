/**
 * NEO-672: the career teams a gap team on a card can be swapped for. "Covers" is
 * production's window (`stintCoversWindow`): the set year and the one before it.
 */
import { describe, expect, it } from "vitest";
import { careerSwapOptions } from "./career-swap";

const stint = (teamId: string, teamName: string, fromYear?: number, toYear?: number) => ({
  teamId,
  teamName,
  ...(fromYear !== undefined ? { fromYear } : {}),
  ...(toYear !== undefined ? { toYear } : {}),
});

describe("careerSwapOptions", () => {
  it("offers every team whose stint covers the set's year, newest first", () => {
    const options = careerSwapOptions({
      stints: [stint("t-bos", "Boston Red Sox", 2025), stint("t-pit", "Pittsburgh Pirates", 2026)],
      teamsOnCard: [],
      setYear: 2026,
    });
    expect(options).toEqual([
      { teamId: "t-pit", teamName: "Pittsburgh Pirates", years: "2026–" },
      { teamId: "t-bos", teamName: "Boston Red Sox", years: "2025–" },
    ]);
  });

  it("keeps career order between teams whose latest covering stints start the same year", () => {
    expect(
      careerSwapOptions({
        stints: [stint("t-bos", "Boston Red Sox", 2025), stint("t-pit", "Pittsburgh Pirates", 2025)],
        teamsOnCard: [],
        setYear: 2026,
      }).map((o) => o.teamId),
    ).toEqual(["t-bos", "t-pit"]);
  });

  it("orders a team by its latest covering stint, not its first", () => {
    expect(
      careerSwapOptions({
        stints: [
          stint("t-bos", "Boston Red Sox", 2024, 2024),
          stint("t-pit", "Pittsburgh Pirates", 2025),
          stint("t-bos", "Boston Red Sox", 2026),
        ],
        teamsOnCard: [],
        setYear: 2026,
      }).map((o) => o.teamId),
    ).toEqual(["t-bos", "t-pit"]);
  });

  it("does not offer a stint that starts after the set's year", () => {
    expect(
      careerSwapOptions({ stints: [stint("t-nyy", "New York Yankees", 2027)], teamsOnCard: [], setYear: 2026 }),
    ).toEqual([]);
  });

  it("does not offer a stint that ended two years before the set's year", () => {
    expect(
      careerSwapOptions({ stints: [stint("t-old", "Old Team", 2020, 2024)], teamsOnCard: [], setYear: 2026 }),
    ).toEqual([]);
  });

  it("offers a stint that ended the year before the set's year (the window is Y-1 to Y)", () => {
    expect(
      careerSwapOptions({ stints: [stint("t-old", "Old Team", 2020, 2025)], teamsOnCard: [], setYear: 2026 }),
    ).toEqual([{ teamId: "t-old", teamName: "Old Team", years: "2020–2025" }]);
  });

  it("does not offer an undated stint", () => {
    expect(
      careerSwapOptions({ stints: [stint("t-und", "Undated Team")], teamsOnCard: [], setYear: 2026 }),
    ).toEqual([]);
  });

  it("does not offer a team that is already on the card", () => {
    expect(
      careerSwapOptions({
        stints: [stint("t-bos", "Boston Red Sox", 2025), stint("t-pit", "Pittsburgh Pirates", 2026)],
        teamsOnCard: ["t-bos"],
        setYear: 2026,
      }).map((o) => o.teamId),
    ).toEqual(["t-pit"]);
  });

  it("offers a team with several covering stints once, each stint's years written as the Career tile writes them", () => {
    const options = careerSwapOptions({
      stints: [stint("t-bos", "Boston Red Sox", 2024, 2025), stint("t-bos", "Boston Red Sox", 2026)],
      teamsOnCard: [],
      setYear: 2026,
    });
    expect(options).toEqual([{ teamId: "t-bos", teamName: "Boston Red Sox", years: "2024–2025, 2026–" }]);
  });

  it("lists only the covering stints' years, not the team's other stints", () => {
    const options = careerSwapOptions({
      stints: [stint("t-bos", "Boston Red Sox", 2010, 2012), stint("t-bos", "Boston Red Sox", 2025, 2026)],
      teamsOnCard: [],
      setYear: 2026,
    });
    expect(options).toEqual([{ teamId: "t-bos", teamName: "Boston Red Sox", years: "2025–2026" }]);
  });

  it("offers nothing when the set has no year", () => {
    expect(
      careerSwapOptions({ stints: [stint("t-bos", "Boston Red Sox", 2025)], teamsOnCard: [], setYear: undefined }),
    ).toEqual([]);
  });

  it("offers nothing for a player with no stints", () => {
    expect(careerSwapOptions({ stints: [], teamsOnCard: [], setYear: 2026 })).toEqual([]);
  });
});
