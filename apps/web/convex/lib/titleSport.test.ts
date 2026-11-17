/**
 * NEO-590 — `titleSport`: which NB sport a listing's title names. Pure, so no
 * deployment: whole-name verification, the title's search term, and how
 * players and teams decide (or fail to decide) one sport.
 */
import { describe, expect, test } from "vitest";
import {
  TITLE_SEARCH_MAX_TERMS,
  decideTitleSport,
  nameInTitle,
  teamInTitle,
  titleSearchTerm,
  titleWords,
} from "./titleSport";

const said = (name: string, title: string) => nameInTitle(name, titleWords(title));

describe("nameInTitle", () => {
  test("a whole name said as consecutive words matches, wherever it sits", () => {
    expect(said("Mike Trout", "2011 Topps Update Mike Trout RC")).toBe(true);
    expect(said("Mike Trout", "Mike Trout")).toBe(true);
  });

  test("a partial name does not match: the surname alone is not the player", () => {
    expect(said("Mike Trout", "Rainbow Trout Lure")).toBe(false);
    expect(said("Mike Trout", "Mike Troutman 2020")).toBe(false);
    expect(said("Mike Trout", "Mike")).toBe(false);
  });

  test("words must be consecutive and in order", () => {
    expect(said("Mike Trout", "Mike Angels Trout")).toBe(false);
    expect(said("Mike Trout", "Trout Mike")).toBe(false);
  });

  test("case, accents, apostrophes and periods fold away on both sides", () => {
    expect(said("José Ramírez", "2019 JOSE RAMIREZ Topps")).toBe(true);
    expect(said("Shaquille O'Neal", "Shaquille O’Neal rookie")).toBe(true);
    expect(said("Ken Griffey Jr.", "1989 Upper Deck Ken Griffey Jr RC")).toBe(true);
    expect(said("C.J. Kayfus", "C. J. Kayfus bowman")).toBe(true);
  });

  test("punctuation between words does not hide a name", () => {
    expect(said("Mike Trout", "Topps,Mike Trout/Shohei Ohtani")).toBe(true);
    expect(said("Shohei Ohtani", "Mike Trout/Shohei Ohtani (RC)")).toBe(true);
  });

  test("an empty name or an empty title matches nothing", () => {
    expect(said("", "Mike Trout")).toBe(false);
    expect(said("Mike Trout", "")).toBe(false);
    expect(said("!!!", "Mike Trout")).toBe(false);
  });

  test("a name longer than the title cannot match", () => {
    expect(said("Mike Trout Jr", "Mike Trout")).toBe(false);
  });
});

describe("teamInTitle", () => {
  const padres = { name: "Padres", location: "San Diego" };

  test("a team is said by its full name or by its nickname alone", () => {
    expect(teamInTitle(padres, titleWords("2020 San Diego Padres team set"))).toBe(true);
    expect(teamInTitle(padres, titleWords("Padres lot"))).toBe(true);
  });

  test("the location alone is not the team", () => {
    expect(teamInTitle(padres, titleWords("San Diego Chargers"))).toBe(false);
  });

  test("a team with no location is said by its name", () => {
    expect(teamInTitle({ name: "Athletics" }, titleWords("Oakland Athletics pin"))).toBe(true);
  });
});

describe("titleSearchTerm", () => {
  test("drops digit-only words (year, number, print run) and keeps the rest in order", () => {
    expect(titleSearchTerm("2023-24 Prizm #12 Mike Trout /99")).toBe("Prizm Mike Trout");
  });

  test("splits on punctuation and keeps accented letters", () => {
    expect(titleSearchTerm("José/Ramírez (RC)")).toBe("José Ramírez RC");
  });

  test("is empty when nothing but digits and symbols is left", () => {
    expect(titleSearchTerm("2023 #12 /99")).toBe("");
    expect(titleSearchTerm("")).toBe("");
  });

  test("is cut to the search term budget", () => {
    const words = Array.from({ length: 40 }, (_, i) => `w${String.fromCharCode(97 + (i % 26))}x`);
    expect(titleSearchTerm(words.join(" ")).split(" ").length).toBeLessThanOrEqual(TITLE_SEARCH_MAX_TERMS);
  });
});

describe("decideTitleSport", () => {
  test("players that all name one sport decide it", () => {
    expect(decideTitleSport([["bb"], ["bb"]], [["fb"]])).toBe("bb");
  });

  test("a player in two sports decides nothing, so the teams are asked", () => {
    expect(decideTitleSport([["bb", "fb"]], [["fb"]])).toBe("fb");
  });

  test("players in different sports and no team: null", () => {
    expect(decideTitleSport([["bb"], ["fb"]], [])).toBeNull();
  });

  test("teams in one sport decide when no player is named", () => {
    expect(decideTitleSport([], [["hk"], ["hk"]])).toBe("hk");
  });

  test("teams in two sports (a shared nickname) decide nothing", () => {
    expect(decideTitleSport([], [["bb"], ["fb"]])).toBeNull();
  });

  test("nothing named: null", () => {
    expect(decideTitleSport([], [])).toBeNull();
  });
});
