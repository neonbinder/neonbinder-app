/**
 * NEO-590 — `titleSport`: which NB sport a listing's title names. Pure, so no
 * deployment: whole-name verification, the title's search term, and how
 * players and teams decide (or fail to decide) one sport.
 */
import { describe, expect, test } from "vitest";
import { SEARCH_QUERY_MAX_CHARS, SEARCH_QUERY_MAX_TOKENS } from "./searchQueryClamp";
import {
  TITLE_SEARCH_MAX_TERMS,
  boundedTitle,
  decideTitleSport,
  nameInTitle,
  namedPlayers,
  namedTeams,
  teamInTitle,
  skipGraderPrefix,
  titleNameText,
  titleSearchTerm,
  titleTeamSearchTerm,
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

describe("titleTeamSearchTerm", () => {
  test("folds accents and punctuation the way team names are stored, and drops digit-only words", () => {
    expect(titleTeamSearchTerm("2023-24 Montréal Canadiens #12 /99")).toBe("montreal canadiens");
    expect(titleTeamSearchTerm("St. Louis Blues")).toBe("st louis blues");
  });

  test("keeps at most the search term bound and is empty when no words are left", () => {
    expect(titleTeamSearchTerm(Array.from({ length: 30 }, (_, i) => `w${i}`).join(" ")).split(" ")).toHaveLength(16);
    expect(titleTeamSearchTerm("2024 #12 /99")).toBe("");
  });
});

describe("titleNameText (the words searched for players and teams)", () => {
  test("with a card number token, only the words after it: the set's generic words stay out", () => {
    expect(titleNameText("2023 Rookie Card #12 Zorbo Quillfeather")).toBe("Zorbo Quillfeather");
    expect(titleNameText("2023 Topps Chrome # 12 Mike Trout Angels")).toBe("Mike Trout Angels");
    expect(titleNameText("2023 Topps #BC-2, Mike Trout")).toBe("Mike Trout");
  });

  test("the term builders then search only those words", () => {
    const tail = titleNameText("2023 Rookie Card #12 Zorbo Quillfeather");
    expect(titleSearchTerm(tail)).toBe("Zorbo Quillfeather");
    expect(titleTeamSearchTerm(tail)).toBe("zorbo quillfeather");
  });

  test("with no # token, the whole title (whitespace collapsed)", () => {
    expect(titleNameText("2023  Rookie Card Zorbo Quillfeather")).toBe("2023 Rookie Card Zorbo Quillfeather");
  });

  test("clamps the raw title first: a # past the clamp point is never seen, the whole clamped title comes back", () => {
    const head = Array.from({ length: SEARCH_QUERY_MAX_TOKENS }, (_, i) => `w${i}`).join(" ");
    const title = `${head} #12 Zorbo Quillfeather`;
    expect(titleNameText(title)).toBe(head);
    expect(titleNameText(title)).toBe(boundedTitle(title));
    // The character cut too: a # beyond the first 200 characters is dropped with the rest.
    const long = `${"x".repeat(SEARCH_QUERY_MAX_CHARS)} #12 Zorbo Quillfeather`;
    expect(titleNameText(long)).toBe("x".repeat(SEARCH_QUERY_MAX_CHARS));
  });

  test("a # as the last token, or with only digits or symbols after it, falls back to the whole title", () => {
    expect(titleNameText("Zorbo Quillfeather Rookie Card #")).toBe("Zorbo Quillfeather Rookie Card #");
    expect(titleNameText("Zorbo Quillfeather Rookie Card #12")).toBe("Zorbo Quillfeather Rookie Card #12");
    expect(titleNameText("Zorbo Quillfeather #12 /99")).toBe("Zorbo Quillfeather #12 /99");
  });
});

describe("namedPlayers (the most specific player wins)", () => {
  const names = (list: Array<{ name: string }>) => list.map((p) => p.name);

  test("a name that is a contiguous part of another verified name is dropped: Acuña inside Acuña Jr.", () => {
    const title = "2018 Topps Update #US250 Ronald Acuña Jr. Braves";
    const out = namedPlayers([{ name: "Ronald Acuña" }, { name: "Ronald Acuña Jr." }], titleWords(title));
    expect(names(out)).toEqual(["Ronald Acuña Jr."]);
  });

  test("accent and period fold on both sides: 'Jr.' in the row matches 'Jr' in a plain-ASCII title", () => {
    const out = namedPlayers([{ name: "Ronald Acuña" }, { name: "Ronald Acuña Jr." }], titleWords("RONALD ACUNA JR Braves"));
    expect(names(out)).toEqual(["Ronald Acuña Jr."]);
  });

  test("when only the shorter name is in the title, it stands", () => {
    const out = namedPlayers([{ name: "Ronald Acuña" }, { name: "Ronald Acuña Jr." }], titleWords("Ronald Acuña soccer card"));
    expect(names(out)).toEqual(["Ronald Acuña"]);
  });

  test("two players with the very same name are both kept (not a strict sub-phrase)", () => {
    const out = namedPlayers([{ name: "Mike Trout" }, { name: "Mike Trout" }], titleWords("Mike Trout"));
    expect(out).toHaveLength(2);
  });

  test("two different players side by side are both kept", () => {
    const out = namedPlayers([{ name: "Mike Trout" }, { name: "Shohei Ohtani" }], titleWords("Mike Trout Shohei Ohtani"));
    expect(names(out)).toEqual(["Mike Trout", "Shohei Ohtani"]);
  });

  test("a candidate whose name is not in the title is not named", () => {
    expect(namedPlayers([{ name: "Mike Trout" }], titleWords("Rainbow Trout Lure"))).toEqual([]);
  });
});

describe("namedTeams (the most specific team wins)", () => {
  const braves = { name: "Braves", location: "Atlanta" };
  const fcl = { name: "Braves", location: "FCL" };
  const boston = { name: "Braves", location: "Boston" };
  const bareBraves = { name: "Braves" };
  const label = (list: Array<{ name: string; location?: string }>) => list.map((t) => `${t.location ?? ""} ${t.name}`.trim());

  test("a full 'Location Name' in the title beats nickname-only matches", () => {
    const out = namedTeams([fcl, braves, boston, bareBraves], titleWords("#1 Atlanta Braves"));
    expect(label(out)).toEqual(["Atlanta Braves"]);
  });

  test("with no full name in the title, every nickname match stands", () => {
    const out = namedTeams([fcl, braves, boston], titleWords("#1 Braves"));
    expect(label(out)).toEqual(["FCL Braves", "Atlanta Braves", "Boston Braves"]);
  });

  test("a locationless team never counts as a full-name match", () => {
    expect(label(namedTeams([bareBraves, fcl], titleWords("Braves lot")))).toEqual(["Braves", "FCL Braves"]);
    expect(label(namedTeams([{ name: "Athletics" }], titleWords("Oakland Athletics pin")))).toEqual(["Athletics"]);
  });

  test("two franchises said by full name are both kept", () => {
    const out = namedTeams([braves, { name: "Yankees", location: "New York" }, fcl], titleWords("Atlanta Braves New York Yankees"));
    expect(label(out)).toEqual(["Atlanta Braves", "New York Yankees"]);
  });

  test("a team not in the title is not named", () => {
    expect(namedTeams([braves], titleWords("Chicago Cubs"))).toEqual([]);
  });
});

describe("a graded slab's leading grader and grade (NEO-590)", () => {
  test("skipGraderPrefix drops one grader+grade pair and nothing else", () => {
    expect(skipGraderPrefix("PSA 10 2018 Prizm Luka Doncic #280")).toBe("2018 Prizm Luka Doncic #280");
    expect(skipGraderPrefix("bgs 9.5 2018 Prizm")).toBe("2018 Prizm");
    expect(skipGraderPrefix("SGC 10 2018 Prizm")).toBe("2018 Prizm");
    expect(skipGraderPrefix("CGC 9 2018 Prizm")).toBe("2018 Prizm");
    expect(skipGraderPrefix("BVG 8 2018 Prizm")).toBe("2018 Prizm");
    expect(skipGraderPrefix("PSA 10 BGS 9.5 Prizm")).toBe("BGS 9.5 Prizm");
    // A year is not a grade; a grader word without a grade, or mid-title, stays.
    expect(skipGraderPrefix("PSA 2018 Prizm")).toBe("PSA 2018 Prizm");
    expect(skipGraderPrefix("PSA Prizm Luka Doncic")).toBe("PSA Prizm Luka Doncic");
    expect(skipGraderPrefix("2018 Prizm PSA 10")).toBe("2018 Prizm PSA 10");
  });

  test("the grader is no word of the name text, the search terms or the verified words", () => {
    expect(titleNameText("PSA 10 2018 Prizm #280 Luka Doncic")).toBe("Luka Doncic");
    // No name after the # token, or no # token: the whole title, minus the grader and grade.
    expect(titleNameText("PSA 10 2018 Prizm Luka Doncic #280")).toBe("2018 Prizm Luka Doncic #280");
    expect(titleNameText("PSA 10 2018 Prizm Luka Doncic")).toBe("2018 Prizm Luka Doncic");
    expect(titleSearchTerm(titleNameText("BGS 9.5 2018 Prizm Luka Doncic"))).toBe("Prizm Luka Doncic");
    expect(titleTeamSearchTerm("PSA 10 2018 Prizm Luka Doncic")).toBe("prizm luka doncic");
    expect(titleWords("PSA 10 2018 Prizm Luka Doncic #280")).toEqual(titleWords("2018 Prizm Luka Doncic #280"));
  });

  test("a slab's title names the same player as the raw card's", () => {
    expect(said("Luka Doncic", "PSA 10 2018 Prizm Luka Doncic #280")).toBe(true);
    expect(said("Luka Doncic", "2018 Prizm Luka Doncic #280")).toBe(true);
  });
});
