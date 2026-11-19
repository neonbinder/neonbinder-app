/**
 * NEO-535 — the title cut loop, golden. Every worked example in the approved
 * spec, one test per cut row, the 81-character "#" rule (first step and mid
 * loop), the refill, the first-name rule, the box (cases a and b) and the
 * STOP. Strings are exact: a change here is a change to what goes on eBay.
 */
import { describe, expect, test } from "vitest";
import {
  assessListingTitle,
  generateListingDescription,
  leftOutOfTitle,
  titleDescription,
  withoutFirstName,
  type ListingCardInputs,
} from "./generateListing";
import { checkTitleAnswer, setDescriptionForTitles } from "./listingInputs";
import { titleChainFacts, type TitleChainRow } from "../listingShortName";

const leafMetal = {
  year: "2026",
  manufacturer: "Leaf",
  setName: "Leaf Metal",
  insertName: "1991 Gold Leaf Prospects Autographs",
  parallelName: "Prismatic Silver",
  parallelIsRole: true,
  autographed: "On Card",
  printRun: 5,
  sport: "Baseball",
} satisfies Partial<ListingCardInputs>;

const ohtaniTrout = {
  year: "2024",
  manufacturer: "Topps",
  setName: "Topps Chrome",
  insertName: "Dual Autographs",
  parallelName: "Gold Refractor",
  parallelIsRole: true,
  cardNumber: "DA-OT",
  playerNames: ["Shohei Ohtani", "Mike Trout"],
  autographed: "On Card",
  printRun: 50,
  teamNames: ["Los Angeles Dodgers", "Los Angeles Angels"],
  sport: "Baseball",
} satisfies ListingCardInputs;

const vladUpdate = {
  year: "2019",
  manufacturer: "Topps",
  setName: "Topps Chrome Update",
  parallelName: "Gold Refractor",
  parallelIsRole: true,
  cardNumber: "85",
  playerNames: ["Vladimir Guerrero Jr."],
  printRun: 50,
  isRookie: true,
  teamNames: ["Toronto Blue Jays"],
  sport: "Baseball",
} satisfies ListingCardInputs;

const chromeUpdateSeries = {
  year: "2024",
  manufacturer: "Topps",
  setName: "Topps Chrome Update Series",
  cardNumber: "USC150",
  isRookie: true,
  teamNames: ["Baltimore Orioles"],
  sport: "Baseball",
} satisfies ListingCardInputs;

const ellyHeritage = {
  year: "2024",
  manufacturer: "Topps",
  setName: "Topps Heritage High Number",
  cardNumber: "713",
  playerNames: ["Elly De La Cruz"],
  isRookie: true,
  shortPrint: "SSP",
  teamNames: ["Cincinnati Reds"],
  sport: "Baseball",
} satisfies ListingCardInputs;

function golden(inputs: ListingCardInputs, title: string, length: number) {
  const a = assessListingTitle(inputs);
  expect(a.title).toBe(title);
  expect(a.title.length).toBe(length);
  return a;
}

describe("NEO-535 worked examples", () => {
  test("1. Leaf Metal, Aiva Arquette: the number goes, nothing else (Tidy Up since NEO-609)", () => {
    const a = golden(
      { ...leafMetal, cardNumber: "91A-AA1", playerNames: ["Aiva Arquette"] },
      "2026 Leaf Metal 1991 Gold Prospects Autographs Prismatic Silver Aiva Arquette /5",
      80,
    );
    expect(a.fits).toBe(true);
    expect(a.firstNameLost).toBe(false);
    expect(a.dropped).toEqual(["#91A-AA1"]);
    // NEO-609: the card number is a Tidy Up cut (row 13).
    expect(a.tidyUp).toBe(true);
    expect(a.coreFits).toBe(false);
  });

  test("2. Alejandro Rosario, no box: the number then his first name", () => {
    const a = golden(
      { ...leafMetal, cardNumber: "91A-AR1", playerNames: ["Alejandro Rosario"] },
      "2026 Leaf Metal 1991 Gold Prospects Autographs Prismatic Silver Rosario /5",
      74,
    );
    expect(a.firstNameLost).toBe(true);
    expect(a.dropped).toEqual(["#91A-AR1", "Alejandro"]);
    expect(a.coreFits).toBe(false);
    expect(a.shortNameUsed).toBeUndefined();
  });

  test("2b. the same card with a box: the box keeps his whole name", () => {
    const a = golden(
      {
        ...leafMetal,
        cardNumber: "91A-AR1",
        playerNames: ["Alejandro Rosario"],
        setShortName: "2026 Leaf Metal 1991 Gold Prospect Autograph Prismatic",
      },
      "2026 Leaf Metal 1991 Gold Prospect Autograph Prismatic Alejandro Rosario /5",
      75,
    );
    expect(a.shortNameUsed).toBe(true);
    expect(a.firstNameLost).toBe(false);
    // In the dialog all the same: it is on the box.
    expect(a.coreFits).toBe(false);
    expect(a.dropped).toEqual(["#91A-AR1"]);
  });

  test("3. the sport and the second Rookie go; the '#' rule waits for the Tidy Up line (NEO-609)", () => {
    // Cutting the sport leaves 81, but the "#"-alone rule is only checked from
    // the Tidy Up line on, so the quiet second Rookie goes next and the "#"
    // stays. (Rookie does not fit back: 73 + 7 is 81.)
    const a = golden(
      { ...chromeUpdateSeries, playerNames: ["Colton Cowser"] },
      "2024 Topps Chrome Update Series Colton Cowser #USC150 RC Baltimore Orioles",
      74,
    );
    expect(a.dropped).toEqual([]);
    expect(a.tidyUp).toBe(false);
  });

  test("3. the same card with no sport: the second Rookie is the quiet cut", () => {
    const { sport: _sport, ...noSport } = chromeUpdateSeries;
    golden(
      { ...noSport, playerNames: ["Colton Cowser"] },
      "2024 Topps Chrome Update Series Colton Cowser #USC150 RC Baltimore Orioles",
      74,
    );
  });

  test("4. Ohtani & Trout dual autograph: both full names stay", () => {
    const a = golden(
      ohtaniTrout,
      "2024 Topps Chrome Dual Autographs Gold Refractor Shohei Ohtani & Mike Trout /50",
      79,
    );
    expect(a.dropped).toEqual(["Los Angeles Angels", "Los Angeles Dodgers", "#DA-OT"]);
  });

  test("5. a longer insert: every cut made, still over — STOP, flagged, nothing of the description cut", () => {
    const a = golden(
      { ...ohtaniTrout, insertName: "Update All-Star Game Dual Autographs" },
      "2024 Topps Chrome Update All-Star Game Dual Autographs Gold Refractor Ohtani & Trout /50",
      88,
    );
    expect(a.fits).toBe(false);
    expect(a.firstNameLost).toBe(true);
    expect(a.dropped).toEqual([
      "Los Angeles Angels",
      "Los Angeles Dodgers",
      "#DA-OT",
      "Mike",
      "Shohei",
    ]);
  });

  test("6. Vladimir Guerrero Jr. Gold Refractor: the team goes, the second Rookie comes back", () => {
    golden(
      vladUpdate,
      "2019 Topps Chrome Update Gold Refractor Vladimir Guerrero Jr. #85 /50 RC Rookie",
      79,
    );
  });

  test("7. Padparadscha /1: the number is cut, then refilled once his first name frees room", () => {
    const a = golden(
      { ...vladUpdate, parallelName: "Sapphire Edition Padparadscha", printRun: 1 },
      "2019 Topps Chrome Update Sapphire Edition Padparadscha Guerrero Jr. #85 /1 RC",
      77,
    );
    expect(a.dropped).toEqual(["Toronto Blue Jays", "Vladimir"]);
  });

  test("8. Jackson Holliday Update Series: the sport and second Rookie go", () => {
    golden(
      { ...chromeUpdateSeries, playerNames: ["Jackson Holliday"] },
      "2024 Topps Chrome Update Series Jackson Holliday #USC150 RC Baltimore Orioles",
      77,
    );
  });

  test("9. Rookie Relics: RC→ swap happens before the team, and the refill puts 'Rookie' back", () => {
    // Recomputed with row 8 ahead of the teams (spec note): the swap is made
    // (94 → 90) and the team still has to go (→ 72); the refill then restores
    // "Rookie" (→ 76). Same string the planner computed.
    const a = golden(
      {
        year: "2024",
        manufacturer: "Topps",
        setName: "Topps Chrome",
        insertName: "Rookie Relics",
        parallelName: "Orange Refractor",
        parallelIsRole: true,
        cardNumber: "CRR-JC",
        playerNames: ["Jackson Chourio"],
        isRelic: true,
        isRookie: true,
        printRun: 25,
        teamNames: ["Milwaukee Brewers"],
        sport: "Baseball",
      },
      "2024 Topps Chrome Rookie Relics Orange Refractor Jackson Chourio #CRR-JC /25",
      76,
    );
    // RC and RELIC are repeats ("Rookie Relics"): never listed.
    expect(a.dropped).toEqual(["Milwaukee Brewers"]);
  });

  test("10. Topps Chrome Black relic: RELIC and RC are not repeats and stay", () => {
    golden(
      {
        year: "2023",
        manufacturer: "Topps",
        setName: "Topps Chrome Black",
        parallelName: "Orange Refractor",
        parallelIsRole: true,
        cardNumber: "CBR-GH",
        playerNames: ["Gunnar Henderson"],
        isRelic: true,
        isRookie: true,
        printRun: 25,
        teamNames: ["Baltimore Orioles"],
        sport: "Baseball",
      },
      "2023 Topps Chrome Black Orange Refractor Gunnar Henderson #CBR-GH RELIC /25 RC",
      78,
    );
  });

  test("11. Heritage Action Image Variation: the number goes, the variation stays (NEO-189 copy)", () => {
    golden(
      {
        ...ellyHeritage,
        parallelName: "Action Image Variation",
        cardVariation: "Action Image Variation",
      },
      "2024 Topps Heritage High Number Elly De La Cruz Action Image Variation RC SSP",
      77,
    );
  });

  test("12. a longer variation: first name, SSP and RC go", () => {
    const a = golden(
      {
        ...ellyHeritage,
        parallelName: "Action Image Variation Batting Helmet",
        cardVariation: "Action Image Variation Batting Helmet",
      },
      "2024 Topps Heritage High Number De La Cruz Action Image Variation Batting Helmet",
      80,
    );
    expect(a.dropped).toEqual(["Cincinnati Reds", "#713", "Elly", "SSP", "RC"]);
  });

  test("13. 1996 Score Dugout Collection: fits whole, Insert label and sport included", () => {
    const a = golden(
      {
        year: "1996",
        manufacturer: "Score",
        setName: "Score",
        insertName: "Dugout Collection",
        cardNumber: "2",
        playerNames: ["Ken Griffey Jr."],
        teamNames: ["Seattle Mariners"],
        sport: "Baseball",
      },
      "1996 Score Dugout Collection Insert Ken Griffey Jr. #2 Seattle Mariners Baseball",
      80,
    );
    expect(a.dropped).toEqual([]);
    expect(a.coreFits).toBe(true);
  });

  test("14. Museum Collection Quad Patch Relics Gold: first name and RC go", () => {
    golden(
      {
        year: "2024",
        manufacturer: "Topps",
        setName: "Topps Museum Collection",
        insertName: "Primary Pieces Quad Patch Relics",
        parallelName: "Gold",
        parallelIsRole: true,
        cardNumber: "PPQ-JH",
        playerNames: ["Jackson Holliday"],
        isRelic: true,
        isRookie: true,
        printRun: 25,
        teamNames: ["Baltimore Orioles"],
        sport: "Baseball",
      },
      "2024 Topps Museum Collection Primary Pieces Quad Patch Relics Gold Holliday /25",
      79,
    );
  });
});

/**
 * Pads the set name so the FULL (uncut) title is exactly `fullLength`. The
 * base must fit uncut with a one-letter set name.
 */
function atFullLength(
  inputs: Omit<ListingCardInputs, "setName"> & { setTail?: string },
  fullLength: number,
): ListingCardInputs {
  const { setTail, ...rest } = inputs;
  const build = (pad: string) => ({
    ...rest,
    setName: [pad, setTail].filter(Boolean).join(" "),
  });
  const base = assessListingTitle(build("S")).title;
  if (base.length > 80) throw new Error(`base too long: ${base}`);
  return build("S".padEnd(1 + fullLength - base.length, "x"));
}

const ichiro = { year: "2001", cardNumber: "7", playerNames: ["Ichiro"] };

/**
 * NEO-609 (Jason, 2026-11-18) — the twenty cut rows, one focused test each.
 * Each card carries the token of the row under test AND of the row after it
 * (or, where two rows cannot share a card, a token further down), and its full
 * title is over the cap by exactly the room the row under test frees. So the
 * row fires, the one after stays, and nothing earlier is needed. The Tidy Up
 * line sits between rows 11 and 12.
 */
describe("NEO-609 cut rows 1-20, one each", () => {
  const NY = { location: "New York", name: "Yankees" };
  const room = (...words: string[]) => words.reduce((sum, w) => sum + w.length + 1, 0);
  const cut = (inputs: Parameters<typeof atFullLength>[0], tokens: number) =>
    assessListingTitle(atFullLength(inputs, 80 + tokens));
  const noNumber = { ...ichiro, cardNumber: "" };

  test("row 1: Base goes first, before a repeated AUTO", () => {
    const a = cut(
      {
        ...ichiro,
        titleLevels: [{ name: "Base", base: true }],
        setTail: "Autographs",
        autographed: "On Card",
      },
      room("Base"),
    );
    expect(a.title).not.toMatch(/\bBase\b/);
    expect(a.title).toMatch(/Autographs Ichiro #7 AUTO$/);
    expect(a.title.length).toBe(80);
    // Base is a quiet cut: not a loss, not Tidy Up.
    expect(a.dropped).toEqual([]);
    expect(a.tidyUp).toBe(false);
  });

  test("row 1: a type named Base goes first too, before the next level's type name", () => {
    const a = cut(
      {
        ...ichiro,
        titleLevels: [{ name: "Gold", typeName: "Base" }],
        parallelName: undefined,
      },
      room("Base"),
    );
    expect(a.title).not.toMatch(/\bBase\b/);
    expect(a.title).toMatch(/ Gold Ichiro #7$/);
  });

  test("row 2: AUTO goes when the title says Autographs, before a repeated RC", () => {
    const a = cut(
      { ...ichiro, setTail: "Autographs Rookies", autographed: "On Card", isRookie: true },
      room("AUTO"),
    );
    expect(a.title).not.toMatch(/\bAUTO\b/);
    expect(a.title).toMatch(/Ichiro #7 RC$/);
    expect(a.tidyUp).toBe(false);
  });

  test("row 3: RC goes when the title says Rookies, before a repeated RELIC", () => {
    const a = cut(
      { ...ichiro, setTail: "Rookies Relic", isRookie: true, isRelic: true },
      room("RC"),
    );
    expect(a.title).not.toMatch(/\bRC\b/);
    expect(a.title).toMatch(/Ichiro #7 RELIC$/);
    expect(a.tidyUp).toBe(false);
  });

  test("row 4: RELIC goes when the title says Relic, before the top level's type name", () => {
    const a = cut(
      {
        ...ichiro,
        setTail: "Relic",
        isRelic: true,
        titleLevels: [{ name: "Gold Rush", typeName: "Inserts" }],
      },
      room("RELIC"),
    );
    expect(a.title).not.toMatch(/\bRELIC\b/);
    expect(a.title).toMatch(/Gold Rush Insert Ichiro #7$/);
    expect(a.tidyUp).toBe(false);
  });

  test("row 5: the top level's type name goes, the next level's stays", () => {
    const a = cut(
      {
        ...ichiro,
        titleLevels: [
          { name: "Gold Rush", typeName: "Inserts" },
          { name: "Silver", typeName: "Parallels" },
        ],
      },
      room("Insert"),
    );
    expect(a.title).toMatch(/Gold Rush Silver Parallel Ichiro #7$/);
    expect(a.dropped).toEqual([]);
  });

  test("row 6: the next type names go, top level first, before a cameo", () => {
    const levels = [
      { name: "Gold Rush", typeName: "Inserts" },
      { name: "Silver", typeName: "Parallels" },
      { name: "Wave", typeName: "Proofs" },
    ];
    const one = cut({ ...ichiro, titleLevels: levels, cameoNames: ["Ken Griffey Jr."] }, room("Insert", "Parallel"));
    expect(one.title).toMatch(/Gold Rush Silver Wave Proof Ichiro & Ken Griffey Jr\. #7$/);
    const all = cut(
      { ...ichiro, titleLevels: levels, cameoNames: ["Ken Griffey Jr."] },
      room("Insert", "Parallel", "Proof"),
    );
    expect(all.title).toMatch(/Gold Rush Silver Wave Ichiro & Ken Griffey Jr\. #7$/);
    expect(all.dropped).toEqual([]);
  });

  test("row 7: cameos go last first, before the sport; a loss, but not Tidy Up", () => {
    const a = cut(
      { ...ichiro, cameoNames: ["Ken Griffey Jr.", "Zed Smith"], sport: "Baseball" },
      3 + "Zed Smith".length,
    );
    expect(a.title).toMatch(/Ichiro & Ken Griffey Jr\. #7 Baseball$/);
    expect(a.dropped).toEqual(["Zed Smith"]);
    expect(a.tidyUp).toBe(false);
    expect(a.coreFits).toBe(true);
  });

  test("row 8: the sport goes, the second Rookie stays", () => {
    const a = cut({ ...ichiro, isRookie: true, sport: "Baseball" }, room("Baseball"));
    expect(a.title).toMatch(/Ichiro #7 RC Rookie$/);
    expect(a.dropped).toEqual([]);
  });

  test("row 9: the second Rookie goes, before a team gives up its city", () => {
    const a = cut(
      { ...ichiro, isRookie: true, teamNames: ["New York Yankees"], teamSplits: [NY] },
      room("Rookie"),
    );
    expect(a.title).toMatch(/Ichiro #7 RC New York Yankees$/);
    expect(a.dropped).toEqual([]);
  });

  test("row 10: Rookie becomes RC in a level's name, before a team gives up its city", () => {
    const a = cut(
      {
        ...ichiro,
        titleLevels: [{ name: "Rookie Debut" }],
        teamNames: ["New York Yankees"],
        teamSplits: [NY],
      },
      "Rookie".length - "RC".length,
    );
    expect(a.title).toMatch(/ RC Debut Ichiro #7 New York Yankees$/);
    expect(a.title.length).toBe(80);
    // An abbreviation is not a loss.
    expect(a.dropped).toEqual([]);
  });

  test("row 11: a team gives up its city, last team first, and that alone is not Tidy Up", () => {
    const a = cut(
      {
        ...ichiro,
        teamNames: ["Boston Red Sox", "New York Yankees"],
        teamSplits: [{ location: "Boston", name: "Red Sox" }, NY],
      },
      room("New", "York"),
    );
    expect(a.title).toMatch(/#7 Boston Red Sox Yankees$/);
    expect(a.dropped).toEqual([]);
    expect(a.tidyUp).toBe(false);
    expect(a.coreFits).toBe(true);
  });

  test("row 12: a whole team goes once its city is out, and that is Tidy Up", () => {
    const a = cut(
      { ...ichiro, teamNames: ["New York Yankees"], teamSplits: [NY] },
      room("New", "York", "Yankees"),
    );
    expect(a.title).toMatch(/Ichiro #7$/);
    expect(a.dropped).toEqual(["New York Yankees"]);
    expect(a.tidyUp).toBe(true);
    expect(a.coreFits).toBe(false);
  });

  test("row 12: teams go last first, nicknames included, before the card number", () => {
    const a = cut(
      { ...ichiro, teamNames: ["Seattle Mariners", "Orix BlueWave"] },
      room("Orix", "BlueWave"),
    );
    expect(a.title).toMatch(/#7 Seattle Mariners$/);
    expect(a.dropped).toEqual(["Orix BlueWave"]);
    expect(a.tidyUp).toBe(true);
  });

  test("row 13: the card number goes before a first name, and is Tidy Up", () => {
    const a = cut({ ...ichiro, playerNames: ["Ichiro Suzuki"], cardNumber: "123" }, room("#123"));
    expect(a.title).toMatch(/ Ichiro Suzuki$/);
    expect(a.dropped).toEqual(["#123"]);
    expect(a.tidyUp).toBe(true);
  });

  test("row 14: RELIC goes when the title says Memorabilia, before SP", () => {
    const a = cut(
      { ...noNumber, setTail: "Memorabilia", isRelic: true, shortPrint: "SP" },
      room("RELIC"),
    );
    expect(a.title).not.toMatch(/\bRELIC\b/);
    expect(a.title).toMatch(/Ichiro SP$/);
    expect(a.tidyUp).toBe(true);
  });

  test("row 15: AUTO goes when the title says Signatures, before SP", () => {
    const a = cut(
      { ...noNumber, setTail: "Signatures", autographed: "On Card", shortPrint: "SSP" },
      room("AUTO"),
    );
    expect(a.title).not.toMatch(/\bAUTO\b/);
    expect(a.title).toMatch(/Ichiro SSP$/);
    expect(a.tidyUp).toBe(true);
  });

  test("row 16: SP goes before RELIC", () => {
    const a = cut({ ...noNumber, shortPrint: "SSP", isRelic: true }, room("SSP"));
    expect(a.title).toMatch(/Ichiro RELIC$/);
    expect(a.dropped).toEqual(["SSP"]);
  });

  test("row 17: RELIC goes before a first name", () => {
    const a = cut({ ...noNumber, playerNames: ["Ichiro Suzuki"], isRelic: true }, room("RELIC"));
    expect(a.title).toMatch(/ Ichiro Suzuki$/);
    expect(a.dropped).toEqual(["RELIC"]);
  });

  test("row 18: first names go last player first, one per step, before RC", () => {
    const a = cut(
      { ...noNumber, playerNames: ["Ichiro Suzuki", "Ken Griffey Jr."], printRun: 10 },
      room("Ken"),
    );
    expect(a.title).toMatch(/ Ichiro Suzuki & Griffey Jr\. \/10$/);
    expect(a.firstNameLost).toBe(true);
    expect(a.dropped).toEqual(["Ken"]);
    const both = cut(
      { ...noNumber, playerNames: ["Ichiro Suzuki", "Ken Griffey Jr."], printRun: 10 },
      room("Ken", "Ichiro"),
    );
    expect(both.title).toMatch(/ Suzuki & Griffey Jr\. \/10$/);
    expect(both.dropped).toEqual(["Ken", "Ichiro"]);
  });

  test("row 19: RC goes (after its second Rookie) before AUTO", () => {
    const a = cut(
      { ...noNumber, isRookie: true, autographed: "On Card" },
      room("Rookie", "RC"),
    );
    expect(a.title).toMatch(/Ichiro AUTO$/);
    expect(a.dropped).toEqual(["RC"]);
  });

  test("row 20: AUTO is the last cut; /N is never cut", () => {
    const a = cut({ ...noNumber, autographed: "On Card", printRun: 99 }, room("AUTO"));
    expect(a.title).toMatch(/ Ichiro \/99$/);
    expect(a.dropped).toEqual(["AUTO"]);
    expect(a.tidyUp).toBe(true);
  });

  test("never cut, however far over: year, set, level names, /N, surname, variation", () => {
    const a = assessListingTitle({
      year: "2026",
      manufacturer: "Leaf",
      setName: "Vivid",
      titleLevels: [{ name: "Animated Autographs Pre-Production Proofs Lazer Red", typeName: "Proof" }],
      cardNumber: "NNO",
      playerNames: ["Cole Carlon"],
      printRun: 1,
      cardVariation: "Wearing an extraordinarily long throwback uniform",
      isRookie: true,
      autographed: "On Card",
      isRelic: true,
      shortPrint: "SSP",
      cameoNames: ["Ken Griffey Jr."],
      teamNames: ["Arizona State Sun Devils baseball"],
      sport: "Baseball",
    });
    expect(a.fits).toBe(false);
    for (const kept of [
      "2026 Leaf Vivid",
      "Animated Autographs Pre-Production Proofs Lazer Red",
      "Carlon",
      "/1",
      "Wearing an extraordinarily long throwback uniform",
    ]) {
      expect(a.title).toContain(kept);
    }
  });
});

describe("NEO-609 the Tidy Up line", () => {
  const NY = { location: "New York", name: "Yankees" };
  const ichiro = { year: "2001", cardNumber: "7", playerNames: ["Ichiro"] };
  const fit = (inputs: Parameters<typeof atFullLength>[0], over: number) =>
    assessListingTitle(atFullLength(inputs, 80 + over));

  test("cutting only a team's city (row 11) is not Tidy Up", () => {
    const a = fit({ ...ichiro, teamNames: ["New York Yankees"], teamSplits: [NY] }, 9);
    expect(a.title).toMatch(/#7 Yankees$/);
    expect(a.tidyUp).toBe(false);
    expect(a.coreFits).toBe(true);
  });

  test("one more character over: the city cut lands on 81 and the '#' alone goes, not the team", () => {
    const a = fit({ ...ichiro, teamNames: ["New York Yankees"], teamSplits: [NY] }, 10);
    expect(a.title).toMatch(/Ichiro 7 Yankees$/);
    expect(a.title.length).toBe(80);
    expect(a.dropped).toEqual([]);
    expect(a.tidyUp).toBe(false);
  });

  test("a character beyond that the whole team goes (row 12): Tidy Up", () => {
    const a = fit({ ...ichiro, teamNames: ["New York Yankees"], teamSplits: [NY] }, 11);
    expect(a.title).toMatch(/Ichiro #7$/);
    expect(a.tidyUp).toBe(true);
    expect(a.coreFits).toBe(false);
  });

  test("a '#' dropped on its own at exactly 81 is not Tidy Up", () => {
    const a = fit(ichiro, 1);
    expect(a.title).toMatch(/Ichiro 7$/);
    expect(a.title.length).toBe(80);
    expect(a.dropped).toEqual([]);
    expect(a.tidyUp).toBe(false);
    expect(a.coreFits).toBe(true);
  });

  test("at 82 the whole number goes: Tidy Up", () => {
    const a = fit(ichiro, 2);
    expect(a.title).toMatch(/Ichiro$/);
    expect(a.dropped).toEqual(["#7"]);
    expect(a.tidyUp).toBe(true);
  });

  test("a cut that the refill undoes is not Tidy Up", () => {
    // The number is cut for room and comes back bare once a first name frees
    // more: only what is STILL out after the refill counts.
    const a = fit({ ...ichiro, cardNumber: "12345", playerNames: ["Alexander Ichiro"] }, 11);
    expect(a.title).toMatch(/ Ichiro 12345$/);
    expect(a.tidyUp).toBe(true); // the first name is the Tidy Up cut that stays
    expect(a.dropped).toEqual(["Alexander"]);
  });

  test("a quiet cut is made before the '#' rule at 81, even with a Tidy Up cut waiting", () => {
    // 81 in full with a sport and a team on: the sport (row 8) goes, nothing
    // from the Tidy Up line is touched, the '#' is kept.
    const a = fit(
      { ...ichiro, sport: "Baseball", teamNames: ["Seattle Mariners"] },
      "Baseball".length + 1 - 8,
    );
    expect(a.title).toMatch(/#7 Seattle Mariners$/);
    expect(a.tidyUp).toBe(false);
  });
});

describe("NEO-535 the '#' rule, the refill and the stop", () => {
  test("the number comes back without its '#' when that is the only way it fits", () => {
    const a = assessListingTitle(
      atFullLength({ ...ichiro, cardNumber: "12345", playerNames: ["Alexander Ichiro"] }, 91),
    );
    expect(a.title).toMatch(/ Ichiro 12345$/);
    expect(a.title.length).toBe(80);
    expect(a.dropped).toEqual(["Alexander"]);
  });

  test("a repeat stays out while a real token is still out", () => {
    const a = assessListingTitle(
      atFullLength(
        {
          ...ichiro,
          setTail: "Autographs",
          autographed: "On Card",
          teamNames: ["Long Team Name Here"],
        },
        90,
      ),
    );
    expect(a.title).toMatch(/Autographs Ichiro #7$/);
    expect(a.title.length).toBe(65);
  });

  test("a repeat comes back once no real token is out", () => {
    const a = assessListingTitle(
      atFullLength(
        { ...ichiro, setTail: "Autographs", autographed: "On Card", sport: "Baseball" },
        87,
      ),
    );
    expect(a.title).toMatch(/Autographs Ichiro #7 AUTO$/);
    expect(a.title.length).toBe(78);
  });

  test("the stop never cuts a description word, a surname or /N", () => {
    const a = assessListingTitle({
      year: "2024",
      manufacturer: "Panini",
      setName: "Panini National Treasures Collegiate",
      insertName: "Signature Dual Material Laundry Tag Booklet",
      cardNumber: "SDM-1",
      playerNames: ["Caleb Williams"],
      printRun: 1,
      sport: "Football",
    });
    expect(a.fits).toBe(false);
    expect(a.title).toBe(
      "2024 Panini National Treasures Collegiate Signature Dual Material Laundry Tag Booklet Williams /1",
    );
  });
});

describe("NEO-535 first names", () => {
  test.each([
    ["Aiva Arquette", "Arquette"],
    ["Vladimir Guerrero Jr.", "Guerrero Jr."],
    ["Elly De La Cruz", "De La Cruz"],
    ["J.D. Martinez", "Martinez"],
    ["Cal Ripken III", "Ripken III"],
    ["Ichiro", undefined],
    ["Griffey Jr.", undefined],
  ])("%s → %s", (name, short) => {
    expect(withoutFirstName(name)).toBe(short);
  });
});

describe("NEO-535 the box (Set name in titles)", () => {
  const rosario = { ...leafMetal, cardNumber: "91A-AR1", playerNames: ["Alejandro Rosario"] };

  test("never on a title that fits with full names", () => {
    const a = assessListingTitle({
      ...leafMetal,
      cardNumber: "91A-AA1",
      playerNames: ["Aiva Arquette"],
      setShortName: "Leaf Metal",
    });
    expect(a.shortNameUsed).toBeUndefined();
    expect(a.title.startsWith("2026 Leaf Metal 1991")).toBe(true);
  });

  test("(b) not used when the box version loses the same first name", () => {
    const a = assessListingTitle({
      ...rosario,
      setShortName: "2026 Leaf Metal 1991 Gold Prospects Autographs Prismatic Silver Edition",
    });
    expect(a.shortNameUsed).toBeUndefined();
    expect(a.title).toBe(
      "2026 Leaf Metal 1991 Gold Prospects Autographs Prismatic Silver Rosario /5",
    );
  });

  test("(a) an over-cap title is rebuilt from the box", () => {
    const a = assessListingTitle({
      ...ohtaniTrout,
      insertName: "Update All-Star Game Dual Autographs",
      setShortName: "2024 Topps Chrome ASG Dual Auto Gold Refractor",
    });
    expect(a.shortNameUsed).toBe(true);
    expect(a.fits).toBe(true);
    expect(a.title).toBe(
      "2024 Topps Chrome ASG Dual Auto Gold Refractor Shohei Ohtani & Mike Trout /50",
    );
    expect(a.coreFits).toBe(false);
  });

  test("(a) a box that is over too: STOP on the box version", () => {
    const a = assessListingTitle({
      ...ohtaniTrout,
      insertName: "Update All-Star Game Dual Autographs",
      setShortName: "2024 Topps Chrome Update All-Star Game Dual Autographs Gold Refractor Edition",
    });
    expect(a.fits).toBe(false);
    expect(a.shortNameUsed).toBe(true);
    expect(a.title).toBe(
      "2024 Topps Chrome Update All-Star Game Dual Autographs Gold Refractor Edition Ohtani & Trout /50",
    );
  });

  test("the box is used verbatim: no Insert/Parallel labels, nothing prepended", () => {
    const a = assessListingTitle({ ...rosario, setShortName: "Leaf Metal Prismatic" });
    expect(a.shortNameUsed).toBe(true);
    // No year added, no labels; AUTO is no longer a repeat (the box says no autograph).
    expect(a.title).toBe("Leaf Metal Prismatic Alejandro Rosario #91A-AR1 AUTO /5 Baseball");
  });
});

describe("NEO-535 leftOutOfTitle reads any text", () => {
  const inputs: ListingCardInputs = {
    ...leafMetal,
    cardNumber: "91A-AA1",
    playerNames: ["Aiva Arquette"],
    isRookie: true,
    teamNames: ["Seattle Mariners"],
  };

  test("the number with or without '#' is present; without it, it is listed with '#'", () => {
    const base = "2026 Leaf Metal 1991 Gold Prospects Autographs Prismatic Silver Aiva Arquette /5 RC";
    expect(leftOutOfTitle(inputs, `${base} 91A-AA1`)).toEqual(["Seattle Mariners"]);
    expect(leftOutOfTitle(inputs, `${base} #91A-AA1`)).toEqual(["Seattle Mariners"]);
    expect(leftOutOfTitle(inputs, base)).toEqual(["Seattle Mariners", "#91A-AA1"]);
  });

  test("a surname alone reports the first name; a missing player reports the whole name", () => {
    expect(leftOutOfTitle(inputs, "2026 Leaf Metal 1991 Gold Prospects Autographs Prismatic Silver Arquette #91A-AA1 /5 RC Seattle Mariners")).toEqual(["Aiva"]);
    expect(leftOutOfTitle(inputs, "2026 Leaf Metal 1991 Gold Prospects Autographs Prismatic Silver #91A-AA1 /5 RC Seattle Mariners")).toEqual(["Aiva Arquette"]);
  });

  test("description words the operator removed are listed; the box text in the field stands in for them", () => {
    expect(
      leftOutOfTitle(inputs, "2026 Leaf Metal Prismatic Aiva Arquette #91A-AA1 /5 RC Seattle Mariners"),
    ).toEqual(["1991 Gold Prospects Autographs", "Silver", "AUTO"]);
    // The box text stands in for the description; AUTO is still owed, because
    // the text no longer says autograph anywhere.
    expect(
      leftOutOfTitle(
        { ...inputs, setShortName: "2026 Leaf Metal Prismatic" },
        "2026 Leaf Metal Prismatic Aiva Arquette #91A-AA1 /5 RC Seattle Mariners",
      ),
    ).toEqual(["AUTO"]);
  });

  test("attributes: RC, AUTO and /N are listed unless the text says them; repeats never", () => {
    const text = "2026 Leaf Metal 1991 Gold Prospects Prismatic Silver Aiva Arquette #91A-AA1 Seattle Mariners";
    // "Autographs" is gone from the description: listed, and AUTO is then not a repeat.
    expect(leftOutOfTitle(inputs, text)).toEqual(["Autographs", "RC", "AUTO", "/5"]);
    expect(leftOutOfTitle(inputs, `${text} Rookie Autographs /5`)).toEqual([]);
  });

  test("labels, the sport and the second Rookie are never listed", () => {
    const score: ListingCardInputs = {
      year: "1996",
      manufacturer: "Score",
      setName: "Score",
      insertName: "Dugout Collection",
      parallelName: "Gold",
      parallelIsRole: true,
      cardNumber: "2",
      playerNames: ["Ken Griffey Jr."],
      isRookie: true,
      sport: "Baseball",
    };
    expect(leftOutOfTitle(score, "1996 Score Dugout Collection Gold Ken Griffey Jr. #2 RC")).toEqual([]);
  });
});

describe("NEO-535 the builder's description (row 0) and the prefill", () => {
  test("year and maker words come out of the insert's and parallel's names", () => {
    expect(
      titleDescription({ ...leafMetal, cardNumber: "1", parallelName: "2026 Leaf Prismatic Silver" }),
    ).toBe("2026 Leaf Metal 1991 Gold Prospects Autographs Prismatic Silver");
  });

  test("an insert named after its set still collapses into it", () => {
    expect(
      titleDescription({
        cardNumber: "1",
        year: "2024",
        manufacturer: "Topps",
        setName: "Topps Chrome",
        insertName: "Topps Chrome Refractor",
      }),
    ).toBe("2024 Topps Chrome Refractor");
  });

  test("setDescriptionForTitles: the leaf's description, never the stored box", () => {
    expect(
      setDescriptionForTitles({
        sportValue: "Baseball",
        setNameValue: "Leaf Metal",
        inheritedFeatures: { season: "2026", manufacturer: "Leaf" },
        insertNameValue: "1991 Gold Leaf Prospects Autographs",
        insertIsRole: true,
        parallelLeafValue: "Prismatic Silver",
        listingShortName: "Leaf 1991",
      }),
    ).toBe("2026 Leaf Metal 1991 Gold Prospects Autographs Prismatic Silver");
  });
});

describe("NEO-535 a stored box covers its row and everything above it", () => {
  const variantType = (title: string): TitleChainRow => ({ level: "variantType", value: title });
  const setRow = (short?: string): TitleChainRow => ({
    level: "setName",
    value: "Leaf Metal",
    ...(short ? { metadata: { listingShortName: short } } : {}),
  });
  const insertRow = (short?: string): TitleChainRow => ({
    level: "insert",
    value: "1991 Gold Leaf Prospects Autographs",
    ...(short ? { metadata: { listingShortName: short } } : {}),
  });
  const parallelLeaf = (short?: string): TitleChainRow => ({
    level: "parallel",
    value: "Prismatic Silver",
    ...(short ? { metadata: { listingShortName: short } } : {}),
  });

  test("on the leaf: used as typed", () => {
    expect(
      titleChainFacts([parallelLeaf("Leaf Metal Gold Prismatic"), insertRow(), variantType("Insert"), setRow()])
        .listingShortName,
    ).toBe("Leaf Metal Gold Prismatic");
  });

  test("on the insert row above a parallel leaf: the parallel's name is added", () => {
    expect(
      titleChainFacts([parallelLeaf(), insertRow("Leaf Metal Gold Prospects"), variantType("Insert"), setRow()])
        .listingShortName,
    ).toBe("Leaf Metal Gold Prospects Prismatic Silver");
  });

  test("on the set row: the insert's and the parallel's names are added", () => {
    expect(
      titleChainFacts([parallelLeaf(), insertRow(), variantType("Insert"), setRow("2026 Leaf Metal")])
        .listingShortName,
    ).toBe("2026 Leaf Metal 1991 Gold Leaf Prospects Autographs Prismatic Silver");
  });

  test("a name the box already says is not added twice", () => {
    expect(
      titleChainFacts([parallelLeaf(), insertRow(), variantType("Insert"), setRow("Leaf Prismatic Silver")])
        .listingShortName,
    ).toBe("Leaf Prismatic Silver 1991 Gold Leaf Prospects Autographs");
  });
});

describe("NEO-535 the description carries every fact", () => {
  const inputs: ListingCardInputs = {
    year: "2026",
    manufacturer: "Leaf",
    setName: "Leaf Metal",
    insertName: "1991 Gold Leaf Prospects Autographs",
    parallelName: "Prismatic Silver",
    parallelIsRole: true,
    cardNumber: "91A-AA1",
    playerNames: ["Dwight Gooden", "Aiva Arquette"],
    autographed: "On Card",
    isRelic: true,
    isRookie: true,
    shortPrint: "SSP",
    printRun: 5,
    cardVariation: "Image Variation",
    teamNames: ["New York Mets", "Seattle Mariners"],
    sport: "Baseball",
  };

  test("long and short forms, full names in reading order, the number with its '#'", () => {
    const d = generateListingDescription(inputs);
    for (const fact of [
      "2026",
      "Leaf Metal",
      "1991 Gold Leaf Prospects Autographs",
      "Prismatic Silver",
      "Dwight Gooden",
      "Aiva Arquette",
      "#91A-AA1",
      "/5",
      "Serial numbered to 5",
      "AUTO",
      "Autographed",
      "RELIC",
      "relic",
      "RC",
      "Rookie Card",
      "SSP",
      "Super Short Print",
      "Image Variation",
      "New York Mets",
      "Seattle Mariners",
      "Baseball",
    ]) {
      expect(d).toContain(fact);
    }
    expect(d).not.toContain("Gooden, Dwight");
  });

  test("deterministic: the same inputs give the same text", () => {
    expect(generateListingDescription(inputs)).toBe(generateListingDescription({ ...inputs }));
  });
});

describe("NEO-535 checkTitleAnswer", () => {
  test("a kept title may be over the cap (the step showed it); the operator's own may not", () => {
    const over = "x".repeat(88);
    expect(checkTitleAnswer({ listingTitleKept: over }, "Card #1")).toEqual({ listingTitleKept: over });
    expect(() => checkTitleAnswer({ listingTitle: over }, "Card #1")).toThrow(/limit is 80/);
  });
});

describe("NEO-535 a token the title already said comes back when what said it is cut", () => {
  test("a team said by the variation does not come back: a variation is never cut (NEO-609)", () => {
    const a = assessListingTitle({
      cardNumber: "T-12",
      year: "1999",
      manufacturer: "Topps",
      setName: "Topps Stadium Club Chrome",
      playerNames: ["Ken Griffey Jr."],
      cardVariation: "Seattle Mariners Turn Ahead The Clock Jersey Variation",
      teamNames: ["Seattle Mariners"],
      sport: "Baseball",
    });
    // Over the cap even with the number and the first name gone: the title is
    // stored as it stands and flagged by its length, the variation whole.
    expect(a.title).toBe(
      "1999 Topps Stadium Club Chrome Griffey Jr. Seattle Mariners Turn Ahead The Clock Jersey Variation",
    );
    expect(a.fits).toBe(false);
    expect(a.tidyUp).toBe(true);
    expect(a.dropped).toEqual(["#T-12", "Ken"]);
  });

  test("while the variation stays in, the team stays latent (said once, not twice)", () => {
    const a = assessListingTitle({
      cardNumber: "T-12",
      year: "1999",
      manufacturer: "Topps",
      setName: "Topps",
      playerNames: ["Ken Griffey Jr."],
      cardVariation: "Seattle Mariners Turn Ahead",
      teamNames: ["Seattle Mariners"],
      sport: "Baseball",
    });
    expect(a.title).toBe("1999 Topps Ken Griffey Jr. #T-12 Seattle Mariners Turn Ahead Baseball");
    expect(a.dropped).toEqual([]);
  });

  test("a sport said by a team returns once the team is cut", () => {
    const a = assessListingTitle(
      atFullLength(
        { ...ichiro, teamNames: ["Oregon Ducks Baseball Club Of Eugene"], sport: "Baseball" },
        95,
      ),
    );
    expect(a.title).toMatch(/ Ichiro #7 Baseball$/);
    expect(a.dropped).toEqual(["Oregon Ducks Baseball Club Of Eugene"]);
  });

  test("a latent team comes back once the team that said it is cut", () => {
    // "Mariners" is said by "Seattle Mariners", so it starts latent. The first
    // team is cut whole (row 12); the refill then offers the latent one back,
    // and its nickname alone fits where the full name did not.
    const a = assessListingTitle(
      atFullLength({ ...ichiro, teamNames: ["Seattle Mariners", "Mariners"] }, 88),
    );
    expect(a.title).toMatch(/ Ichiro #7 Mariners$/);
    expect(a.title.length).toBe(80);
    expect(a.tidyUp).toBe(true);
  });
});

describe("NEO-535 the same player named twice", () => {
  test("listed once in the title, the left-out list and the description", () => {
    const inputs: ListingCardInputs = {
      cardNumber: "19",
      setName: "Topps Chrome",
      playerNames: ["Mike Trout", " Mike  Trout ", "mike trout"],
      sport: "Baseball",
    };
    const a = assessListingTitle(inputs);
    expect(a.title).toBe("Topps Chrome Mike Trout #19 Baseball");
    expect(leftOutOfTitle(inputs, "Topps Chrome #19")).toEqual(["Mike Trout"]);
    expect(generateListingDescription(inputs)).toContain("card of Mike Trout, #19.");
  });

  test("a three-word name loses only its first word (the stored-card parity case)", () => {
    const a = assessListingTitle({
      cardNumber: "19",
      setName: "Topps Chrome",
      playerNames: [
        "Bartholomew Maximilian Fitzgerald-Worthington",
        "Bartholomew Maximilian Fitzgerald-Worthington",
      ],
      sport: "Baseball",
    });
    expect(a.title).toBe("Topps Chrome Bartholomew Maximilian Fitzgerald-Worthington #19 Baseball");
    expect(a.fits).toBe(true);
  });
});

describe("NEO-535 an insert's name enters the title on its ROLE, never on its name", () => {
  const set = "ttlw8-abcdefxxxxxxxxx"; // the E2E fixture's 21-character set name
  const card = {
    cardNumber: "91A-AA1234567",
    playerNames: ["George Brett"],
    year: "2024",
    manufacturer: "Topps",
    setName: set,
    sport: "Baseball",
  } satisfies ListingCardInputs;
  const setRow: TitleChainRow = { level: "setName", value: set };
  const row = (value: string): TitleChainRow => ({ level: "insert", value });
  const type = (title: string): TitleChainRow => ({ level: "variantType", value: title });

  test("a row named Base under an Insert type is an insert called Base: name and label", () => {
    const facts = titleChainFacts([row("Base"), type("Insert"), setRow]);
    expect(facts).toMatchObject({ insertNameValue: "Base", insertIsRole: true });
    const a = assessListingTitle({ ...card, insertName: facts.insertNameValue });
    // 81 in full; the "Insert" label is the first quiet cut (row 5, NEO-609)
    // and frees the room, so the "#" stays.
    expect(a.title).toBe(`2024 Topps ${set} Base George Brett #91A-AA1234567 Baseball`);
    expect(a.title.length).toBe(74);
  });

  test("the same row under the Base type confers no insert role: no name, no label", () => {
    const facts = titleChainFacts([row("Base"), type("Base"), setRow]);
    expect(facts.insertNameValue).toBeUndefined();
    expect(facts.insertIsRole).toBeUndefined();
    expect(assessListingTitle({ ...card, insertName: facts.insertNameValue }).title).toBe(
      `2024 Topps ${set} George Brett #91A-AA1234567 Baseball`,
    );
  });
});

describe("NEO-535 + NEO-528 cameos in the cut loop", () => {
  const cameo = "Ken Griffey Jr.";

  test("(a) an over-cap builder title is rebuilt from the box, and the cameo is the first thing the box version drops", () => {
    const a = assessListingTitle({
      ...ohtaniTrout,
      insertName: "Update All-Star Game Dual Autographs",
      setShortName: "2024 Topps Chrome ASG Dual Auto Gold Refractor",
      cameoNames: [cameo],
    });
    expect(a.shortNameUsed).toBe(true);
    expect(a.title).toBe(
      "2024 Topps Chrome ASG Dual Auto Gold Refractor Shohei Ohtani & Mike Trout /50",
    );
    // The cameo is listed first; the box text carries no team or number.
    expect(a.dropped).toEqual([cameo, "Los Angeles Angels", "Los Angeles Dodgers", "#DA-OT"]);
    expect(a.firstNameLost).toBe(false);
  });

  test("(b) the box is still not used when it loses the same first name: the cameo goes first on both", () => {
    const a = assessListingTitle({
      ...leafMetal,
      cardNumber: "91A-AR1",
      playerNames: ["Alejandro Rosario"],
      cameoNames: [cameo],
      setShortName: "2026 Leaf Metal 1991 Gold Prospects Autographs Prismatic Silver Edition",
    });
    expect(a.shortNameUsed).toBeUndefined();
    expect(a.title).toBe(
      "2026 Leaf Metal 1991 Gold Prospects Autographs Prismatic Silver Rosario /5",
    );
    expect(a.dropped).toEqual([cameo, "#91A-AR1", "Alejandro"]);
  });

  test("refill: the sport is tried back before the cameo, so a title with room for one gets the sport", () => {
    const a = assessListingTitle(
      atFullLength(
        {
          year: "2001",
          cardNumber: "7",
          playerNames: ["Ichiro"],
          cameoNames: ["Al Bo"],
          teamNames: ["Los Angeles Dodgers"],
          sport: "Baseball",
        },
        105,
      ),
    );
    expect(a.title).toContain("Baseball");
    expect(a.title).not.toContain("Al Bo");
    expect(a.title).not.toContain("Dodgers");
    expect(a.title.length).toBeLessThanOrEqual(80);
    expect(a.dropped).toEqual(["Al Bo", "Los Angeles Dodgers"]);
  });

  test("refill: a repeat stays out while a cameo is still out", () => {
    const a = assessListingTitle(
      atFullLength(
        {
          ...ichiro,
          setTail: "Autographs",
          autographed: "On Card",
          cameoNames: ["Zed Gggggggggggggg"],
        },
        90,
      ),
    );
    expect(a.title).not.toMatch(/\bAUTO\b/);
    expect(a.title).not.toContain("Zed");
    expect(a.title.length).toBeLessThanOrEqual(80);
    expect(a.dropped).toEqual(["Zed Gggggggggggggg"]);
  });

  test("a repeat goes before a cameo, which then stays in", () => {
    const a = assessListingTitle(
      atFullLength(
        {
          ...ichiro,
          setTail: "Autographs",
          autographed: "On Card",
          cameoNames: ["Zed Gg"],
        },
        84,
      ),
    );
    // Only the repeat AUTO had to go; the cameo never left, so nothing is out.
    expect(a.title).toContain("Ichiro & Zed Gg #7");
    expect(a.dropped).toEqual([]);
  });

  test("several cameos and a first name: both cameos go (last first), then the number, then the first name", () => {
    const a = assessListingTitle(
      atFullLength(
        {
          year: "2001",
          cardNumber: "91A-AR1",
          playerNames: ["Alejandro Rosario"],
          cameoNames: [cameo, "Mike Trout"],
        },
        130,
      ),
    );
    expect(a.title).not.toContain("Griffey");
    expect(a.title).not.toContain("Trout");
    expect(a.title).not.toContain("91A-AR1");
    expect(a.title).toMatch(/ Rosario$/);
    expect(a.firstNameLost).toBe(true);
    expect(a.dropped).toEqual(["Mike Trout", cameo, "#91A-AR1", "Alejandro"]);
  });
});

describe("NEO-535 + NEO-528 leftOutOfTitle lists a dropped cameo", () => {
  const inputs: ListingCardInputs = {
    year: "2024",
    manufacturer: "Topps",
    setName: "Chrome",
    cardNumber: "17",
    playerNames: ["Shohei Ohtani"],
    teamNames: ["Los Angeles Dodgers"],
    cameoNames: ["Ken Griffey Jr.", "Mike Trout"],
  };
  const text = "2024 Topps Chrome Shohei Ohtani";

  test("each cameo the text lacks is listed, last first, before teams and the number", () => {
    expect(leftOutOfTitle(inputs, text)).toEqual([
      "Mike Trout",
      "Ken Griffey Jr.",
      "Los Angeles Dodgers",
      "#17",
    ]);
  });

  test("a cameo the text names is not listed", () => {
    expect(leftOutOfTitle(inputs, `${text} & Ken Griffey Jr. #17 Dodgers`)).toEqual(["Mike Trout"]);
  });

  test("a cameo equal to the card's own player is never listed, and a repeated cameo is listed once", () => {
    expect(
      leftOutOfTitle(
        { ...inputs, cameoNames: ["shohei ohtani", "Mike Trout", "mike trout"] },
        `${text} #17 Dodgers`,
      ),
    ).toEqual(["Mike Trout"]);
  });
});
