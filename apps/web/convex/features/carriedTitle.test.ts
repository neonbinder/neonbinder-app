import { describe, expect, test } from "vitest";
import {
  assessParallelCopyTitle,
  carriedTitleRest,
  storedTitleFails,
} from "./carriedTitle";
import { listingInputsForCard } from "./listingInputs";
import { titleChainFacts, type TitleChainRow } from "../listingShortName";
import {
  assessListingTitle,
  titleDescription,
  titleDescriptionForms,
  type ListingCardInputs,
} from "./generateListing";

/**
 * NEO-535 — a parallel copy's title: the builder's when it fits with full
 * names, else the source card's hand edit re-headed (80 or under), else the
 * builder's flagged result for the Card titles dialog.
 */

/** An insert card whose builder title fits: "2024 Topps Chrome Anime Insert Mike Trout #BA-1 Los Angeles Angels Baseball". */
const SOURCE: ListingCardInputs = {
  cardNumber: "BA-1",
  playerNames: ["Mike Trout"],
  year: "2024",
  manufacturer: "Topps",
  setName: "Topps Chrome",
  insertName: "Anime",
  sport: "Baseball",
  teamNames: ["Los Angeles Angels"],
};

/** The same card on a parallel of that insert. */
const parallel = (parallelName: string, printRun?: number, extra?: Partial<ListingCardInputs>): ListingCardInputs => ({
  ...SOURCE,
  parallelName,
  parallelIsRole: true,
  ...(printRun ? { printRun } : {}),
  ...extra,
});

/** Builder title 77 chars, "Mike" cut: fails on the first-name rule. Description 67. */
const LONG = "Kanji Orange Wave Refractor Sapphire Gold X";
/** Builder title fits with nothing from the Tidy Up line left out (NEO-609). */
const SHORT = "Kanji Gold";

const rest = (sourceTitle: string, sourceInputs: ListingCardInputs = SOURCE, sourceFlagged = false) =>
  carriedTitleRest({ sourceTitle, sourceFlagged, sourceInputs });

describe("titleDescriptionForms", () => {
  test("every form the builder writes, labels on and off, longest first", () => {
    expect(titleDescriptionForms(SOURCE)).toEqual([
      "2024 Topps Chrome Anime Insert",
      "2024 Topps Chrome Anime",
    ]);
  });

  test("a parallel adds its own name; forms never repeat", () => {
    const forms = titleDescriptionForms(parallel("Kanji Gold Refractor", 50));
    expect(forms).toContain("2024 Topps Chrome Anime Kanji Gold Refractor");
    expect(new Set(forms).size).toBe(forms.length);
    for (let i = 1; i < forms.length; i += 1) {
      expect(forms[i - 1].length).toBeGreaterThanOrEqual(forms[i].length);
    }
  });
});

describe("carriedTitleRest", () => {
  test("the builder's own title is not a hand edit, so nothing is carried", () => {
    const unedited = assessListingTitle(SOURCE).title;
    expect(unedited).toBe("2024 Topps Chrome Anime Insert Mike Trout #BA-1 Los Angeles Angels Baseball");
    expect(rest(unedited)).toBeUndefined();
  });

  test("the description found once: the rest is everything around it", () => {
    expect(rest("2024 Topps Chrome Anime M. Trout #BA-1 Halos")).toBe("M. Trout #BA-1 Halos");
    expect(rest("M. Trout 2024 Topps Chrome Anime Halos")).toBe("M. Trout Halos");
  });

  test("the match is whole words, case-folded and whitespace-normalised", () => {
    expect(rest("2024  TOPPS chrome   Anime Trout Halos")).toBe("Trout Halos");
  });

  test("the labelled form wins over the bare one (longest first)", () => {
    expect(rest("2024 Topps Chrome Anime Insert Trout Halos")).toBe("Trout Halos");
  });

  test("no description in the title: nothing to carry", () => {
    expect(rest("Topps Anime Trout Halos")).toBeUndefined();
  });

  test("the description twice is ambiguous: nothing to carry", () => {
    expect(rest("2024 Topps Chrome Anime Trout 2024 Topps Chrome Anime")).toBeUndefined();
  });

  test("the box text that applied to the source is a candidate too", () => {
    const boxed = { ...SOURCE, setShortName: "Chrome Anime" };
    expect(rest("Chrome Anime Trout Halos", boxed)).toBe("Trout Halos");
  });

  describe("print run", () => {
    const numbered = { ...SOURCE, printRun: 99 };

    test("the source's own /N stays in the rest, to be swapped later", () => {
      expect(rest("2024 Topps Chrome Anime Trout /99 Halos", numbered)).toBe("Trout /99 Halos");
    });

    test("a /N that is not the source's own is never carried", () => {
      expect(rest("2024 Topps Chrome Anime Trout /25", numbered)).toBeUndefined();
      expect(rest("2024 Topps Chrome Anime Trout /25")).toBeUndefined();
    });

    test("the source's own /N twice is refused", () => {
      expect(rest("2024 Topps Chrome Anime Trout /99 /99", numbered)).toBeUndefined();
    });

    test("a /N beside the source's own is refused", () => {
      expect(rest("2024 Topps Chrome Anime Trout /99 /25", numbered)).toBeUndefined();
    });
  });

  test("a flagged source is no answer to copy", () => {
    expect(rest("2024 Topps Chrome Anime Trout Halos", SOURCE, true)).toBeUndefined();
  });

  test("a source title over 80 is no answer to copy", () => {
    expect(rest(`2024 Topps Chrome Anime Trout ${"x".repeat(60)}`)).toBeUndefined();
  });

  test("a hand edit without the surname is not carried", () => {
    expect(rest("2024 Topps Chrome Anime Mike #BA-1 Halos")).toBeUndefined();
  });

  test("an old builder title that cut the surname is not carried", () => {
    expect(rest("2024 Topps Chrome Anime Mike T. #BA-1 Angels")).toBeUndefined();
  });

  test("every player's surname must be there; a Jr. is set aside", () => {
    const pair = { ...SOURCE, playerNames: ["Ken Griffey Jr.", "Mike Trout"] };
    expect(rest("2024 Topps Chrome Anime Griffey Trout", pair)).toBe("Griffey Trout");
    expect(rest("2024 Topps Chrome Anime Griffey Jr. Halos", pair)).toBeUndefined();
  });

  test("punctuation around a surname still counts it", () => {
    expect(rest("2024 Topps Chrome Anime (Trout) Halos")).toBe("(Trout) Halos");
  });
});

describe("assessParallelCopyTitle", () => {
  test("the long parallel's builder title loses a first name", () => {
    const builder = assessListingTitle(parallel(LONG, 25));
    expect(builder.title).toBe("2024 Topps Chrome Anime Kanji Orange Wave Refractor Sapphire Gold X Trout /25");
    expect(builder.firstNameLost).toBe(true);
    expect(titleDescription(parallel(LONG, 25))).toHaveLength(67);
  });

  test("step 1: the builder wins when it fits with nothing in Tidy Up, hand edit or not", () => {
    const inputs = parallel(SHORT, 50);
    const outcome = assessParallelCopyTitle(inputs, "Trout Halos");
    expect(outcome.title).toBe(assessListingTitle(inputs).title);
    expect(outcome.tidyUp).toBe(false);
    expect(outcome.carried).toBeUndefined();
    expect(outcome.failing).toBe(false);
  });

  test("step 1 reads fits && !tidyUp: a title that fits but dropped a whole team does not win (NEO-609)", () => {
    // "Kanji Gold Refractor" fits in 80 but gives up the Angels (row 12).
    const inputs = parallel("Kanji Gold Refractor", 50);
    const builder = assessListingTitle(inputs);
    expect(builder).toMatchObject({ fits: true, tidyUp: true, firstNameLost: false });
    const outcome = assessParallelCopyTitle(inputs, "Trout Halos");
    expect(outcome.carried).toBe(true);
    expect(outcome.title).toBe("2024 Topps Chrome Anime Kanji Gold Refractor Trout Halos /50");
    expect(outcome.failing).toBe(false);
    // With no hand edit to carry the builder's flagged result goes to the dialog.
    const flagged = assessParallelCopyTitle(inputs);
    expect(flagged.title).toBe(builder.title);
    expect(flagged.failing).toBe(true);
    expect(flagged.tidyUp).toBe(true);
  });

  test("step 2: the hand edit, re-headed with the parallel's description and its /N", () => {
    const outcome = assessParallelCopyTitle(parallel(LONG, 25), rest("2024 Topps Chrome Anime Trout"));
    expect(outcome).toMatchObject({
      title: "2024 Topps Chrome Anime Kanji Orange Wave Refractor Sapphire Gold X Trout /25",
      fits: true,
      firstNameLost: false,
      tidyUp: false,
      coreFits: true,
      carried: true,
      failing: false,
    });
  });

  test("step 2 at exactly 80 is carried; at 81 the builder's result fails", () => {
    const at80 = assessParallelCopyTitle(parallel(LONG, 25), "Trout Up");
    expect(at80.title).toHaveLength(80);
    expect(at80.carried).toBe(true);
    expect(at80.failing).toBe(false);

    const at81 = assessParallelCopyTitle(parallel(LONG, 25), "Trout Fly");
    expect(at81.carried).toBeUndefined();
    expect(at81.failing).toBe(true);
    expect(at81.title).toBe(assessListingTitle(parallel(LONG, 25)).title);
  });

  test("the source's /N is swapped in place", () => {
    const outcome = assessParallelCopyTitle(parallel(LONG, 25), "Trout /99 GO");
    expect(outcome.title.endsWith(" Trout /25 GO")).toBe(true);
  });

  test("the /N is appended when the hand edit had none", () => {
    const outcome = assessParallelCopyTitle(parallel(LONG, 25), "Trout");
    expect(outcome.title.endsWith(" Trout /25")).toBe(true);
  });

  test("the /N is dropped on an unnumbered parallel", () => {
    const inputs = parallel(`${LONG}YZW`);
    expect(assessListingTitle(inputs).firstNameLost).toBe(true);
    const outcome = assessParallelCopyTitle(inputs, "Trout /99");
    expect(outcome.carried).toBe(true);
    expect(outcome.title).toBe(`${titleDescription(inputs)} Trout`);
  });

  test("without a hand edit the builder's result is stored and fails", () => {
    const outcome = assessParallelCopyTitle(parallel(LONG, 25));
    expect(outcome.failing).toBe(true);
    expect(outcome.carried).toBeUndefined();
  });

  test("a box-built title that fits with full names is not failing", () => {
    const inputs = parallel(LONG, 25, { setShortName: "Anime Kanji Sapphire" });
    const outcome = assessParallelCopyTitle(inputs);
    expect(outcome.shortNameUsed).toBe(true);
    expect(outcome.fits && !outcome.firstNameLost).toBe(true);
    expect(outcome.failing).toBe(false);
  });

  test("NEO-618 step 2: a Tidy Up source that fits still heads the carried rest with the box when the box-headed title fits", () => {
    // A box long enough that its own builder title still gives up the Angels.
    const box = "Anime Kanji Gold Refractor Sapphire Orange Wave";
    const inputs = parallel("Kanji Gold Refractor", 50, { setShortName: box });
    expect(assessListingTitle({ ...inputs, setShortName: undefined })).toMatchObject({ fits: true, tidyUp: true });
    expect(assessListingTitle(inputs)).toMatchObject({ fits: true, tidyUp: true, shortNameUsed: true });
    // The builder's own description would also fit with the rest.
    expect(`${titleDescription(inputs)} Trout Halos /50`.length).toBeLessThanOrEqual(80);
    const outcome = assessParallelCopyTitle(inputs, "Trout Halos");
    expect(outcome.title).toBe(`${box} Trout Halos /50`);
    expect(outcome).toMatchObject({ carried: true, fits: true, tidyUp: false, failing: false });
  });

  test("NEO-618 step 2: a box-headed title over 80 leaves the builder's description heading the rest", () => {
    const box = "Anime Kanji Gold Refractor Sapphire Orange Wave Padparadscha Superfractor Edition";
    const inputs = parallel("Kanji Gold Refractor", 50, { setShortName: box });
    expect(assessListingTitle({ ...inputs, setShortName: undefined })).toMatchObject({ fits: true, tidyUp: true });
    expect(`${box} Trout Halos /50`.length).toBeGreaterThan(80);
    const outcome = assessParallelCopyTitle(inputs, "Trout Halos");
    expect(outcome.title).toBe("2024 Topps Chrome Anime Kanji Gold Refractor Trout Halos /50");
    expect(outcome.carried).toBe(true);
    expect(outcome.failing).toBe(false);
  });

  test("NEO-618 step 2: a blank box leaves the builder's description heading the rest", () => {
    const outcome = assessParallelCopyTitle(parallel("Kanji Gold Refractor", 50, { setShortName: "   " }), "Trout Halos");
    expect(outcome.title).toBe("2024 Topps Chrome Anime Kanji Gold Refractor Trout Halos /50");
  });

  test("step 2 re-heads with the box text when the description runs long", () => {
    // A box the builder will not take: its own title loses Mike as well.
    const box = "Anime Kanji Orange Wave Refractor Sapphire Padparadscha Superfractor";
    const inputs = parallel("Kanji Orange Wave Refractor Sapphire Padparadscha", 25, { setShortName: box });
    const builder = assessListingTitle(inputs);
    expect(builder.firstNameLost).toBe(true);
    expect(`${titleDescription(inputs)} Trout /25`.length).toBeGreaterThan(80);

    const outcome = assessParallelCopyTitle(inputs, "Trout");
    expect(outcome.carried).toBe(true);
    expect(outcome.title).toBe(`${box} Trout /25`);
  });

  describe("TRItanium: parallel names lengthen the description, so few are rescued", () => {
    const trit: ListingCardInputs = {
      cardNumber: "TA-AJ",
      playerNames: ["Aaron Judge"],
      year: "2025",
      manufacturer: "Topps",
      setName: "Topps Chrome Update",
      insertName: "TRItanium Autographs",
      sport: "Baseball",
      teamNames: ["New York Yankees"],
      autographed: "On Card",
    };
    const carried = carriedTitleRest({
      sourceTitle: "2025 Topps Chrome Update TRItanium Autographs Judge AUTO Yankees",
      sourceFlagged: false,
      sourceInputs: trit,
    });
    const on = (name: string, printRun: number, extra?: Partial<ListingCardInputs>) =>
      assessParallelCopyTitle({ ...trit, parallelName: name, parallelIsRole: true, printRun, ...extra }, carried);

    test("the hand edit reads as its rest", () => {
      expect(carried).toBe("Judge AUTO Yankees");
    });

    test("a short parallel name that costs a whole team goes to the dialog (Tidy Up, NEO-609)", () => {
      // Fits at 76, but the Yankees and the number are out: not a title that "works".
      expect(on("Gold Refractor", 50)).toMatchObject({
        failing: true,
        tidyUp: true,
        title: "2025 Topps Chrome Update TRItanium Autographs Gold Refractor Aaron Judge /50",
      });
    });

    test("a hand edit is carried where the builder would sit in Tidy Up and the re-head fits", () => {
      expect(on("Gold", 50)).toMatchObject({
        failing: false,
        carried: true,
        title: "2025 Topps Chrome Update TRItanium Autographs Gold Judge AUTO Yankees /50",
      });
      expect(on("SuperFractor", 1)).toMatchObject({ failing: false });
    });

    test("long parallel names run past 80 re-headed (89 and 97 here), so they go to the dialog", () => {
      for (const [name, printRun] of [
        ["Orange Wave Refractor", 25],
        ["Black Mini-Diamond Refractor", 10],
      ] as const) {
        const inputs = { ...trit, parallelName: name, parallelIsRole: true, printRun };
        const reheaded = `${titleDescription(inputs)} Judge AUTO Yankees /${printRun}`.length;
        expect(reheaded).toBeGreaterThan(80);
        expect(on(name, printRun).failing).toBe(true);
      }
    });

    test("longer still fails the same way", () => {
      expect(on("Rose Gold Mini-Diamond Refractor", 15).failing).toBe(true);
    });

    test("one box on the parallel fixes them", () => {
      expect(on("Rose Gold Mini-Diamond Refractor", 15, { setShortName: "Chrome Update TRItanium" })).toMatchObject({
        failing: false,
        fits: true,
        firstNameLost: false,
      });
    });
  });
});

describe("storedTitleFails", () => {
  test("over 80, or flagged cut short", () => {
    expect(storedTitleFails({ listingTitle: "x".repeat(80) })).toBe(false);
    expect(storedTitleFails({ listingTitle: "x".repeat(81) })).toBe(true);
    expect(storedTitleFails({ listingTitle: "short", listingTitleTruncated: true })).toBe(true);
    expect(storedTitleFails({ listingTitle: "short", listingTitleTruncated: false })).toBe(false);
    expect(storedTitleFails({})).toBe(false);
  });
});

/**
 * NEO-619 — "Parallels name themselves": the insert card's hand edit is
 * re-headed onto a switched parallel with the parallel's own description, so
 * the insert's name does not travel with it. Invented words throughout.
 */
describe("NEO-619: a hand edit re-headed onto a parallel that names itself", () => {
  const row = (level: string, value: string, metadata?: TitleChainRow["metadata"]): TitleChainRow => ({
    level,
    value,
    ...(metadata ? { metadata } : {}),
  });
  const inputsFor = (chain: TitleChainRow[], printRun?: number) =>
    listingInputsForCard(
      { cardNumber: "7", ...(printRun ? { printRun } : {}) },
      {
        sportValue: "Baseball",
        setNameValue: "Pulse",
        inheritedFeatures: { manufacturer: "Leaf", season: "2026" },
        ...titleChainFacts(chain),
      },
      { playerNames: ["Bartholomew Carlon"], teamNames: ["Long Island Sea Wolves"] },
    );
  const insertChain = (on: boolean) => [
    row("insert", "Zorbo Special Purple", on ? { parallelsNameThemselves: true } : undefined),
    row("variantType", "Inserts"),
    row("setName", "Pulse"),
  ];
  const goldChain = (on: boolean) => [row("parallel", "Zorbo Special Gold"), ...insertChain(on)];

  // The operator's hand edit on the insert card: the description, then their words.
  const handEdit = (source: ListingCardInputs) => `${titleDescription(source)} Carlon Wolves`;

  test("the Purple is dropped and the rest is kept", () => {
    const source = inputsFor(insertChain(true));
    const carried = carriedTitleRest({
      sourceTitle: handEdit(source),
      sourceFlagged: false,
      sourceInputs: source,
    });
    expect(carried).toBe("Carlon Wolves");

    const target = inputsFor(goldChain(true), 25);
    // The fixture is what it claims: the builder needs Tidy Up, so step 2 runs.
    expect(assessListingTitle(target).tidyUp).toBe(true);
    const outcome = assessParallelCopyTitle(target, carried);
    expect(outcome.carried).toBe(true);
    expect(outcome.title).toContain("Zorbo Special Gold");
    expect(outcome.title).not.toContain("Purple");
    expect(outcome.title.endsWith(" Carlon Wolves /25")).toBe(true);
  });

  test("switch off: the same re-heading keeps the insert's name in the description", () => {
    const source = inputsFor(insertChain(false));
    const carried = carriedTitleRest({
      sourceTitle: handEdit(source),
      sourceFlagged: false,
      sourceInputs: source,
    });
    const outcome = assessParallelCopyTitle(inputsFor(goldChain(false), 25), carried);
    expect(outcome.carried).toBe(true);
    expect(outcome.title).toContain("Purple");
  });
});
