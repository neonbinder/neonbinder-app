/**
 * NEO-609 (Jason, 2026-11-18, card titles) — every level of a card's chain is
 * named in its title from NB's own rows (`titleLevels`, top level first), each
 * level's variant type's name follows it in the SINGULAR, "Base" is said and
 * cut first, and nothing the title says of a level is keyed on a marketplace.
 *
 * The twenty cut rows and the Tidy Up line live in
 * `generateListing.cutLoop.test.ts`; this file pins the level machinery under
 * them: singular type names, the worked example end to end, repeat detection,
 * the description's per-level lines, the old-input path, and the edges.
 */
import { describe, expect, test } from "vitest";
import {
  assessListingTitle,
  generateListingDescription,
  leftOutOfTitle,
  readsAsGeneratedDescription,
  singularTypeName,
  titleDescription,
  titleDescriptionForms,
  type ListingCardInputs,
} from "./generateListing";
import { listingInputsForCard, type ListingSetContext } from "./listingInputs";
import { titleChainFacts, type TitleChainRow } from "../listingShortName";
import { LISTING_TITLE_MAX } from "./listingLimits";

const ichiro = { year: "2001", cardNumber: "7", playerNames: ["Ichiro"] };

/** Pads the set name so the FULL (uncut) title is exactly `fullLength`. */
function atFullLength(
  inputs: Omit<ListingCardInputs, "setName"> & { setTail?: string },
  fullLength: number,
): ListingCardInputs {
  const { setTail, ...rest } = inputs;
  const build = (pad: string) => ({ ...rest, setName: [pad, setTail].filter(Boolean).join(" ") });
  const base = assessListingTitle(build("S")).title;
  if (base.length > LISTING_TITLE_MAX) throw new Error(`base too long: ${base}`);
  return build("S".padEnd(1 + fullLength - base.length, "x"));
}

describe("singularTypeName — a variant type's name as a title says it", () => {
  test.each([
    ["Inserts", "Insert"],
    ["Parallels", "Parallel"],
    ["Proofs", "Proof"],
    ["Promos", "Promo"],
    ["Rookies", "Rookie"],
    ["Legacies", "Legacy"],
    ["Short Prints", "Short Print"],
    ["Press Proofs", "Press Proof"],
    ["Bases", "Base"],
  ])("%s reads %s", (plural, singular) => {
    expect(singularTypeName(plural)).toBe(singular);
  });

  test.each(["Series", "Species", "Glass", "Chassis", "Bonus", "Analysis", "Insert", "Base", "Parallel"])(
    "%s is left alone (ss, us, is endings, the two words that are their own plural, already singular)",
    (word) => {
      expect(singularTypeName(word)).toBe(word);
    },
  );

  test("only the LAST word changes, and padding goes", () => {
    expect(singularTypeName("  Gold Inserts  ")).toBe("Gold Insert");
    expect(singularTypeName("Short Prints Series")).toBe("Short Prints Series");
  });

  test("a blank name stays blank", () => {
    expect(singularTypeName("")).toBe("");
    expect(singularTypeName("   ")).toBe("");
  });
});

describe("the worked example, end to end (a non-Insert type)", () => {
  const LEVEL = "Animated Autographs Pre-Production Proofs Lazer Red";
  const row = (level: string, value: string, metadata?: TitleChainRow["metadata"]): TitleChainRow => ({
    level,
    value,
    ...(metadata ? { metadata } : {}),
  });
  // Leaf first, as every walk hands the rows over.
  const chain = [row("insert", LEVEL), row("variantType", "Proof"), row("setName", "Vivid")];
  const set = (): ListingSetContext => ({
    sportValue: "Baseball",
    setNameValue: "Vivid",
    inheritedFeatures: { manufacturer: "Leaf", season: "2026" },
    ...titleChainFacts(chain),
  });
  const names = { playerNames: ["Cole Carlon"], teamNames: ["Arizona State Sun Devils baseball"] };
  const inputs = () => listingInputsForCard({ cardNumber: "NNO", printRun: 1 }, set(), names);

  test("the chain names the level by its own row and its type's title, with no role gate", () => {
    const facts = titleChainFacts(chain);
    expect(facts.titleLevels).toEqual([{ name: LEVEL, typeName: "Proof" }]);
    // "Proof" has no insert/parallel kind, so the eBay-aspect facts stay empty.
    expect(facts.insertNameValue).toBeUndefined();
    expect(facts.insertIsRole).toBeUndefined();
    expect(facts.parallelLeafValue).toBeUndefined();
  });

  test("listingInputsForCard carries the levels to the generator", () => {
    expect(inputs().titleLevels).toEqual([{ name: LEVEL, typeName: "Proof" }]);
    expect(inputs().insertName).toBeUndefined();
  });

  test("the title is cut to the example's: type name, then team, number and first name go", () => {
    const a = assessListingTitle(inputs());
    expect(a.title).toBe(`2026 Leaf Vivid ${LEVEL} Carlon /1`);
    expect(a.fits).toBe(true);
    expect(a.tidyUp).toBe(true);
    expect(a.coreFits).toBe(false);
    expect(a.firstNameLost).toBe(true);
    expect(a.dropped).toEqual(["Arizona State Sun Devils baseball", "#NNO", "Cole"]);
  });

  test("with room to spare it names the level's type, singular, after the level", () => {
    const a = assessListingTitle({
      ...inputs(),
      titleLevels: [{ name: "Lazer Red", typeName: "Proofs" }],
      teamNames: [],
      playerNames: ["Carlon"],
      cardNumber: "",
    });
    expect(a.title).toBe("2026 Leaf Vivid Lazer Red Proof Carlon /1 Baseball");
  });

  test("the description names the level in the opening line and in its own line headed by the type", () => {
    expect(generateListingDescription(inputs()).split("\n")).toEqual([
      `2026 Leaf Vivid ${LEVEL} card of Cole Carlon, #NNO.`,
      `Proof: ${LEVEL}.`,
      "Serial numbered to 1 (/1).",
      "Team: Arizona State Sun Devils baseball.",
      "Sport: Baseball.",
    ]);
  });

  test("the type's title is the word whatever it is: a description line for it still reads as generated", () => {
    expect(readsAsGeneratedDescription(generateListingDescription(inputs()))).toBe(true);
  });
});

describe("the description names every level", () => {
  const base = { ...ichiro, manufacturer: "Topps", setName: "Chrome" } satisfies ListingCardInputs;

  test("one `<Type>: <name>.` line per level, top level first, after the opening line", () => {
    const text = generateListingDescription({
      ...base,
      titleLevels: [
        { name: "Future Stars", typeName: "Inserts" },
        { name: "Gold Refractor", typeName: "Parallels" },
      ],
    });
    expect(text.split("\n")).toEqual([
      "2001 Topps Chrome Future Stars Gold Refractor card of Ichiro, #7.",
      "Insert: Future Stars.",
      "Parallel: Gold Refractor.",
    ]);
  });

  test("a type is said in its singular, whatever the row is called", () => {
    const text = generateListingDescription({
      ...base,
      titleLevels: [{ name: "Gold", typeName: "Short Prints" }],
    });
    expect(text).toContain("Short Print: Gold.");
  });

  test("a level with no type name has no line of its own; a Base level has none at all", () => {
    const text = generateListingDescription({
      ...base,
      titleLevels: [{ name: "Base", base: true }, { name: "Gold" }],
    });
    expect(text.split("\n")).toEqual(["2001 Topps Chrome Gold card of Ichiro, #7."]);
  });

  test("a level that opens with the one above stands for both in the opening line, and each keeps its line", () => {
    const text = generateListingDescription({
      ...base,
      titleLevels: [
        { name: "Gold", typeName: "Inserts" },
        { name: "Gold Wave", typeName: "Parallels" },
      ],
    });
    expect(text.split("\n")).toEqual([
      "2001 Topps Chrome Gold Wave card of Ichiro, #7.",
      "Insert: Gold.",
      "Parallel: Gold Wave.",
    ]);
  });

  test("an empty level name says nothing", () => {
    const text = generateListingDescription({
      ...base,
      titleLevels: [{ name: "  ", typeName: "Inserts" }],
    });
    expect(text).toBe("2001 Topps Chrome card of Ichiro, #7.");
  });
});

describe("the old-input path (no titleLevels) is unchanged", () => {
  const score: ListingCardInputs = {
    cardNumber: "5",
    year: "1996",
    manufacturer: "Score",
    setName: "Score",
    playerNames: ["Ken Griffey Jr."],
  };

  test("an insert and a role parallel still carry the Insert and Parallel labels", () => {
    const old = assessListingTitle({
      ...score,
      insertName: "Dugout Collection",
      parallelName: "Gold",
      parallelIsRole: true,
    });
    expect(old.title).toBe("1996 Score Dugout Collection Insert Gold Parallel Ken Griffey Jr. #5");
  });

  test("the same card built from levels says exactly the same title and description", () => {
    const legacy: ListingCardInputs = {
      ...score,
      insertName: "Dugout Collection",
      parallelName: "Gold",
      parallelIsRole: true,
    };
    const levels: ListingCardInputs = {
      ...score,
      titleLevels: [
        { name: "Dugout Collection", typeName: "Inserts" },
        { name: "Gold", typeName: "Parallel" },
      ],
    };
    expect(assessListingTitle(levels)).toEqual(assessListingTitle(legacy));
    expect(generateListingDescription(levels)).toBe(generateListingDescription(legacy));
    expect(titleDescriptionForms(levels)).toEqual(titleDescriptionForms(legacy));
  });

  test("a parallel name that is no role carries no label", () => {
    expect(assessListingTitle({ ...score, parallelName: "Gold" }).title).toBe(
      "1996 Score Gold Ken Griffey Jr. #5",
    );
  });

  test("a card that names no level at all builds the title it always did", () => {
    expect(assessListingTitle(score).title).toBe("1996 Score Ken Griffey Jr. #5");
  });
});

describe("Base is in the full title and is the first thing cut", () => {
  test("a card on the Base type says Base after the set while it fits", () => {
    const a = assessListingTitle({
      ...ichiro,
      manufacturer: "Topps",
      setName: "Chrome",
      titleLevels: [{ name: "Base", base: true }],
    });
    expect(a.title).toBe("2001 Topps Chrome Base Ichiro #7");
    expect(a.dropped).toEqual([]);
  });

  test("at exactly 80 Base stays; at 81 it alone goes, then nothing else is touched", () => {
    const at80 = assessListingTitle(
      atFullLength({ ...ichiro, titleLevels: [{ name: "Base", base: true }], sport: "Baseball" }, 80),
    );
    expect(at80.title).toMatch(/ Base Ichiro #7 Baseball$/);
    expect(at80.title.length).toBe(80);
    const at81 = assessListingTitle(
      atFullLength({ ...ichiro, titleLevels: [{ name: "Base", base: true }], sport: "Baseball" }, 81),
    );
    expect(at81.title).not.toMatch(/\bBase\b/);
    expect(at81.title).toMatch(/ Ichiro #7 Baseball$/);
    expect(at81.title.length).toBe(76);
    expect(at81.dropped).toEqual([]);
    expect(at81.tidyUp).toBe(false);
  });

  test("Base is never listed as left out, and the description does not name it", () => {
    const inputs: ListingCardInputs = {
      ...ichiro,
      manufacturer: "Topps",
      setName: "Chrome",
      titleLevels: [{ name: "Base", base: true }],
    };
    expect(leftOutOfTitle(inputs, "2001 Topps Chrome Ichiro #7")).toEqual([]);
    expect(titleDescription(inputs)).toBe("2001 Topps Chrome");
    expect(generateListingDescription(inputs)).toBe("2001 Topps Chrome card of Ichiro, #7.");
  });

  test("Base is the flag the chain sets, whatever the row is called: the cut is the same for every name", () => {
    for (const name of ["Base", "base", "BASES"]) {
      const a = assessListingTitle(
        atFullLength({ ...ichiro, titleLevels: [{ name, base: true }] }, 80 + name.length + 1),
      );
      expect(a.title).not.toContain(name);
      expect(a.title.length).toBe(80);
    }
  });

  // NEO-609 (invariant 4): a level NAMED Base is an ordinary level. Only the
  // flag `titleChainFacts` sets from the variant type's kind is the Base role.
  test.each(["Base", "Basex"])("an insert row named %s under Inserts is an ordinary insert", (name) => {
    const levels = [{ name, typeName: "Inserts" }];
    const inputs: ListingCardInputs = {
      ...ichiro,
      manufacturer: "Topps",
      setName: "Chrome",
      titleLevels: levels,
    };
    expect(assessListingTitle(inputs).title).toBe(`2001 Topps Chrome ${name} Insert Ichiro #7`);
    expect(titleDescription(inputs)).toBe(`2001 Topps Chrome ${name}`);
    expect(generateListingDescription(inputs).split("\n")).toEqual([
      `2001 Topps Chrome ${name} card of Ichiro, #7.`,
      `Insert: ${name}.`,
    ]);
    // Row 1 does not take it: at 81 the type name goes (row 5), the name stays.
    const over = assessListingTitle(atFullLength({ ...ichiro, titleLevels: levels }, 84));
    expect(over.title).toMatch(new RegExp(`${name} Ichiro #7$`));
    expect(over.title).not.toContain("Insert");
  });

  test("the same chain read through titleChainFacts: Base under Inserts has no base flag", () => {
    const row = (level: string, value: string): TitleChainRow => ({ level, value });
    expect(
      titleChainFacts([row("insert", "Base"), row("variantType", "Inserts"), row("setName", "Chrome")])
        .titleLevels,
    ).toEqual([{ name: "Base", typeName: "Inserts" }]);
    expect(
      titleChainFacts([row("variantType", "Base"), row("setName", "Chrome")]).titleLevels,
    ).toEqual([{ name: "Base", base: true }]);
  });

  test("a type's name is trimmed in the facts", () => {
    const row = (level: string, value: string): TitleChainRow => ({ level, value });
    expect(
      titleChainFacts([row("insert", "Gold"), row("variantType", "  Inserts  "), row("setName", "Chrome")])
        .titleLevels,
    ).toEqual([{ name: "Gold", typeName: "Inserts" }]);
  });

  test("a card directly on a type names its level in the singular", () => {
    const row = (level: string, value: string): TitleChainRow => ({ level, value });
    expect(
      titleChainFacts([row("variantType", "Parallels"), row("setName", "Chrome")]).titleLevels,
    ).toEqual([{ name: "Parallel" }]);
    expect(
      titleChainFacts([row("variantType", "Short Prints"), row("setName", "Chrome")]).titleLevels,
    ).toEqual([{ name: "Short Print" }]);
    expect(
      titleChainFacts([row("variantType", "Series"), row("setName", "Chrome")]).titleLevels,
    ).toEqual([{ name: "Series" }]);
  });

  test("a features-only Base card (no level in its chain) says Base through its parallel name", () => {
    expect(
      assessListingTitle({ ...ichiro, setName: "Chrome", parallelName: "Base" }).title,
    ).toBe("2001 Chrome Base Ichiro #7");
  });
});

describe("a variation is never cut", () => {
  const long = "Wearing an extraordinarily long throwback uniform from nineteen seventy";

  test("a title over the cap with it stays over, flagged by its length; the variation is whole", () => {
    const a = assessListingTitle({
      ...ichiro,
      manufacturer: "Topps",
      setName: "Chrome Update Series Sapphire Edition",
      cardVariation: long,
    });
    expect(a.title).toContain(long);
    expect(a.fits).toBe(false);
    expect(a.title.length).toBeGreaterThan(LISTING_TITLE_MAX);
    // Everything cuttable went first: the number, then the player's... only
    // the surname is left, and a one-word name has no first name to give up.
    expect(a.dropped).toEqual(["#7"]);
    expect(a.tidyUp).toBe(true);
  });

  test("at exactly 80 with it the title fits; one character more and only the cuttable goes", () => {
    const fits = assessListingTitle(
      atFullLength({ ...ichiro, cardVariation: "Sliding", teamNames: ["Seattle Mariners"] }, 80),
    );
    expect(fits.title).toMatch(/Ichiro #7 Sliding Seattle Mariners$/);
    const over = assessListingTitle(
      atFullLength({ ...ichiro, cardVariation: "Sliding", teamNames: ["Seattle Mariners"] }, 81),
    );
    // The "#" alone (exactly 81, from the Tidy Up line), never the variation.
    expect(over.title).toContain("Sliding");
    expect(over.title).toMatch(/Ichiro 7 Sliding Seattle Mariners$/);
  });

  test("its words are not a repeat of anything else: a variation that says Auto lets nothing else go early", () => {
    const a = assessListingTitle(
      atFullLength(
        { ...ichiro, cardVariation: "Auto Sliding", autographed: "On Card", isRelic: true },
        80 + "AUTO ".length,
      ),
    );
    // AUTO is a repeat (the variation says it): it goes first, the variation stays.
    expect(a.title).toMatch(/Ichiro #7 RELIC Auto Sliding$/);
    expect(a.title).not.toMatch(/\bAUTO\b/);
    expect(a.title.length).toBe(80);
  });
});

describe("repeat detection ignores the cuttable type names", () => {
  test("an 'Autographs' TYPE does not make AUTO a repeat: the type goes (row 5), AUTO stays", () => {
    const a = assessListingTitle(
      atFullLength(
        {
          ...ichiro,
          titleLevels: [{ name: "Gold", typeName: "Autographs" }],
          autographed: "On Card",
          isRelic: true,
        },
        80 + "Autograph".length + 1,
      ),
    );
    expect(a.title).not.toContain("Autograph");
    expect(a.title).toMatch(/Gold Ichiro #7 AUTO RELIC$/);
    expect(a.dropped).toEqual([]);
  });

  test("a 'Rookies' type does not make RC a repeat; a 'Relics' type does not make RELIC one", () => {
    const rookie = assessListingTitle(
      atFullLength(
        { ...ichiro, titleLevels: [{ name: "Gold", typeName: "Rookies" }], isRookie: true },
        81,
      ),
    );
    // Row 3 (RC because the title says Rookie) does not fire for the TYPE's word:
    // the type goes at row 5 and RC stays.
    expect(rookie.title).toMatch(/Gold Ichiro #7 RC$/);
    expect(rookie.title).not.toContain("Rookie");
    const relic = assessListingTitle(
      atFullLength(
        { ...ichiro, titleLevels: [{ name: "Gold", typeName: "Relics" }], isRelic: true },
        81,
      ),
    );
    expect(relic.title).toMatch(/Gold Ichiro #7 RELIC$/);
    expect(relic.title).not.toContain("Relic");
  });

  test("the SAME word in a level NAME is a repeat (the name is never cut, so it is said)", () => {
    const a = assessListingTitle(
      atFullLength(
        { ...ichiro, titleLevels: [{ name: "Dual Autographs" }], autographed: "On Card", isRelic: true },
        80 + "AUTO".length + 1,
      ),
    );
    expect(a.title).not.toMatch(/\bAUTO\b/);
    expect(a.title).toMatch(/Dual Autographs Ichiro #7 RELIC$/);
  });

  test("the type name does not make the 'Rookie' in a level name a second spelling", () => {
    const a = assessListingTitle({
      ...ichiro,
      manufacturer: "Topps",
      setName: "Chrome",
      titleLevels: [{ name: "Rookie Debut", typeName: "Inserts" }],
      isRookie: true,
    });
    // The level name (never cut) says Rookie; while it fits, RC is still said.
    expect(a.title).toBe("2001 Topps Chrome Rookie Debut Insert Ichiro #7 RC");
    const over = assessListingTitle(
      atFullLength({ ...ichiro, titleLevels: [{ name: "Rookie Gold", typeName: "Inserts" }], isRookie: true }, 83),
    );
    // Row 3: the name says Rookie, so RC goes ahead of the type name (row 5).
    expect(over.title).toMatch(/Rookie Gold Insert Ichiro #7$/);
    expect(over.title).not.toContain("RC");
  });
});

describe("type names sit after their level and never repeat it", () => {
  const base = { ...ichiro, manufacturer: "Topps", setName: "Chrome" } satisfies ListingCardInputs;
  const title = (levels: ListingCardInputs["titleLevels"]) =>
    assessListingTitle({ ...base, titleLevels: levels }).title;

  test("level name, then its type, top level first", () => {
    expect(
      title([
        { name: "Future Stars", typeName: "Inserts" },
        { name: "Gold", typeName: "Parallels" },
      ]),
    ).toBe("2001 Topps Chrome Future Stars Insert Gold Parallel Ichiro #7");
  });

  test("a name already ending in its type word, singular or plural, gets no repeat", () => {
    expect(title([{ name: "Hot Inserts", typeName: "Inserts" }])).toBe(
      "2001 Topps Chrome Hot Inserts Ichiro #7",
    );
    expect(title([{ name: "Prizm Parallel", typeName: "Parallels" }])).toBe(
      "2001 Topps Chrome Prizm Parallel Ichiro #7",
    );
    expect(title([{ name: "Rare Short Print", typeName: "Short Prints" }])).toBe(
      "2001 Topps Chrome Rare Short Print Ichiro #7",
    );
  });

  test("a word that merely ends in the letters is not the word", () => {
    expect(title([{ name: "Reinsert", typeName: "Inserts" }])).toBe(
      "2001 Topps Chrome Reinsert Insert Ichiro #7",
    );
  });

  test("a type name equal to its level's name is said once", () => {
    expect(title([{ name: "Inserts", typeName: "Inserts" }])).toBe("2001 Topps Chrome Inserts Ichiro #7");
    expect(title([{ name: "Insert", typeName: "Inserts" }])).toBe("2001 Topps Chrome Insert Ichiro #7");
  });

  test("an empty or blank type name adds nothing", () => {
    expect(title([{ name: "Gold", typeName: "" }, { name: "Silver", typeName: "   " }])).toBe(
      "2001 Topps Chrome Gold Silver Ichiro #7",
    );
  });

  test("an empty level name is no level, and its type is not said alone", () => {
    expect(title([{ name: "", typeName: "Inserts" }, { name: "  ", typeName: "Parallels" }])).toBe(
      "2001 Topps Chrome Ichiro #7",
    );
  });

  test("a level the set already says adds no words, but the top level keeps its type name", () => {
    expect(
      assessListingTitle({
        ...base,
        setName: "Chrome Gold",
        titleLevels: [{ name: "Gold", typeName: "Inserts" }],
      }).title,
    ).toBe("2001 Topps Chrome Gold Insert Ichiro #7");
  });

  test("levels that repeat each other say the repeated words once", () => {
    expect(
      title([
        { name: "Gold", typeName: "Inserts" },
        { name: "Gold", typeName: "Parallels" },
      ]),
    ).toBe("2001 Topps Chrome Gold Insert Ichiro #7");
    expect(
      title([
        { name: "Gold Wave", typeName: "Inserts" },
        { name: "gold wave", typeName: "Parallels" },
      ]),
    ).toBe("2001 Topps Chrome Gold Wave Insert Ichiro #7");
  });

  test("the year and maker inside a level name are not said twice", () => {
    expect(title([{ name: "2001 Topps Gold", typeName: "Inserts" }])).toBe(
      "2001 Topps Chrome Gold Insert Ichiro #7",
    );
  });

  test("at exactly 80 the type names stay; at 81 the top level's goes first (row 5)", () => {
    const levels = [
      { name: "Future Stars", typeName: "Inserts" },
      { name: "Gold", typeName: "Parallels" },
    ];
    const at80 = assessListingTitle(atFullLength({ ...ichiro, titleLevels: levels }, 80));
    expect(at80.title).toMatch(/Future Stars Insert Gold Parallel Ichiro #7$/);
    const at81 = assessListingTitle(atFullLength({ ...ichiro, titleLevels: levels }, 81));
    expect(at81.title).toMatch(/Future Stars Gold Parallel Ichiro #7$/);
    expect(at81.title.length).toBe(74);
    expect(at81.dropped).toEqual([]);
  });

  test("a level name is never cut, however far over the title runs", () => {
    const name = "Extraordinarily Photographic Superfractor Heritage Refractor Update";
    const a = assessListingTitle({
      ...ichiro,
      manufacturer: "Topps",
      setName: "Chrome",
      titleLevels: [{ name, typeName: "Inserts" }],
      playerNames: ["Fitzwilliam-Harrington Rodriguez"],
    });
    expect(a.title).toContain(name);
    expect(a.fits).toBe(false);
    expect(a.title).not.toContain("Insert");
  });
});

describe("several teams, some with a city to give up", () => {
  const NY = { location: "New York", name: "Yankees" };
  const BOS = { location: "Boston", name: "Red Sox" };
  const teams = ["New York Yankees", "Boston Red Sox", "Tigres del Licey"];
  const card = (setLength: number): ListingCardInputs => ({
    ...ichiro,
    manufacturer: "Topps",
    setName: "Q".repeat(setLength),
    teamNames: teams,
    teamSplits: [NY, BOS],
  });

  test("a card that fits keeps every team whole", () => {
    expect(assessListingTitle(card(5)).title).toMatch(/#7 New York Yankees Boston Red Sox Tigres del Licey$/);
  });

  test("cities go last team first and come back where they fit; a team with no split has none to give", () => {
    const a = assessListingTitle(card(12));
    expect(a.title).toMatch(/#7 New York Yankees Red Sox Tigres del Licey$/);
    expect(a.tidyUp).toBe(false);
    const b = assessListingTitle(card(20));
    expect(b.title).toMatch(/#7 Yankees Red Sox Tigres del Licey$/);
    expect(b.dropped).toEqual([]);
    expect(b.tidyUp).toBe(false);
  });

  test("then whole teams go last first, and that is Tidy Up", () => {
    const a = assessListingTitle(card(28));
    expect(a.title).toMatch(/#7 New York Yankees Red Sox$/);
    expect(a.dropped).toEqual(["Tigres del Licey"]);
    expect(a.tidyUp).toBe(true);
    const b = assessListingTitle(card(46));
    expect(b.title).toMatch(/#7 Yankees$/);
    expect(b.dropped).toEqual(["Tigres del Licey", "Boston Red Sox"]);
    expect(b.tidyUp).toBe(true);
  });
});

describe("the exact 80 / 81 boundary with levels and cameos", () => {
  const levels = [
    { name: "Gold Rush", typeName: "Inserts" },
    { name: "Silver", typeName: "Parallels" },
  ];
  const card = (setLength: number, extra: Partial<ListingCardInputs> = {}): ListingCardInputs => ({
    ...ichiro,
    manufacturer: "Topps",
    setName: "S".repeat(setLength),
    titleLevels: levels,
    ...extra,
  });

  test("the full title at 80 changes nothing; at 81 a type name (row 5) goes before the cameo (row 7)", () => {
    const full = assessListingTitle(card(1, { cameoNames: ["Ken Griffey Jr."] })).title;
    const grow = 80 - full.length;
    const at80 = assessListingTitle(card(1 + grow, { cameoNames: ["Ken Griffey Jr."] }));
    expect(at80.title.length).toBe(80);
    expect(at80.title).toContain("Insert");
    expect(at80.title).toContain("Parallel");
    const at81 = assessListingTitle(card(2 + grow, { cameoNames: ["Ken Griffey Jr."] }));
    expect(at81.title).toContain("Ken Griffey Jr.");
    expect(at81.title).not.toContain("Insert");
    expect(at81.title).toContain("Parallel");
  });
});

describe("a stray 'Base' word in an unrelated field does not make a Base level", () => {
  test("a team or a player named Base is just a name", () => {
    const a = assessListingTitle({
      ...ichiro,
      setName: "Chrome",
      playerNames: ["Base Ruth"],
      titleLevels: [{ name: "Gold", typeName: "Inserts" }],
    });
    expect(a.title).toBe("2001 Chrome Gold Insert Base Ruth #7");
  });
});

/**
 * NEO-619 — "Parallels name themselves": the card's title and description
 * through the real chain reading. Invented words: the insert is "Zorbo
 * Special Purple", its parallel "Zorbo Special Gold".
 */
describe("NEO-619: parallels name themselves, end to end", () => {
  const row = (level: string, value: string, metadata?: TitleChainRow["metadata"]): TitleChainRow => ({
    level,
    value,
    ...(metadata ? { metadata } : {}),
  });
  const setFor = (chain: TitleChainRow[]): ListingSetContext => ({
    sportValue: "Baseball",
    setNameValue: "Pulse",
    inheritedFeatures: { manufacturer: "Leaf", season: "2026" },
    ...titleChainFacts(chain),
  });
  const names = { playerNames: ["Cole Carlon"] };
  const goldChain = (on: boolean) => [
    row("parallel", "Zorbo Special Gold"),
    row("insert", "Zorbo Special Purple", on ? { parallelsNameThemselves: true } : undefined),
    row("variantType", "Inserts"),
    row("setName", "Pulse"),
  ];
  const insertChain = (on: boolean) => goldChain(on).slice(1);

  test("the Gold card's title and description never say Purple; the Gold name is whole", () => {
    const inputs = listingInputsForCard({ cardNumber: "7" }, setFor(goldChain(true)), names);
    const { title } = assessListingTitle(inputs);
    expect(title).toContain("Zorbo Special Gold");
    expect(title).not.toContain("Purple");
    expect(title).not.toContain("Insert");
    expect(titleDescription(inputs)).not.toContain("Purple");
    expect(generateListingDescription(inputs)).not.toContain("Purple");
  });

  test("the insert's own card still says Purple, switch on or off", () => {
    for (const on of [true, false]) {
      const inputs = listingInputsForCard({ cardNumber: "7" }, setFor(insertChain(on)), names);
      expect(assessListingTitle(inputs).title).toContain("Zorbo Special Purple");
    }
  });

  test("switch off: the Gold card's title names the insert (the previous behaviour)", () => {
    const inputs = listingInputsForCard({ cardNumber: "7" }, setFor(goldChain(false)), names);
    expect(assessListingTitle(inputs).title).toContain("Purple");
  });
});
