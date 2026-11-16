import { describe, expect, test } from "vitest";
import {
  assessListingTitle,
  brandedSetName,
  generateListingTitle,
  generateListingDescription,
  leftOutOfTitle,
  readsAsGeneratedDescription,
  rookieAsRc,
  titleDescription,
  withoutFirstName,
  type ListingCardInputs,
} from "./generateListing";
import { LISTING_DESCRIPTION_MAX, LISTING_TITLE_MAX } from "./listingLimits";

describe("generateListingTitle", () => {
  test("full base card gets core tokens + RC", () => {
    const title = generateListingTitle({
      cardNumber: "50",
      playerNames: ["Elly De La Cruz"],
      year: "2024",
      manufacturer: "Topps",
      setName: "Chrome",
      parallelName: "Base",
      isRookie: true,
    });
    // NEO-101 (Jason, 2026-09-02): titles now PACK. `Rookie` is appended as a
    // second spelling behind `RC` — a third of sold rookie listings carry both
    // words, and an unused character is a search term thrown away.
    expect(title).toBe("2024 Topps Chrome Elly De La Cruz #50 RC Rookie");
    expect(title.length).toBeLessThanOrEqual(80);
  });

  test("parallel name included when not Base, as part of the description before the players", () => {
    // NEO-535: the parallel is part of the description, not the optional tail.
    const title = generateListingTitle({
      cardNumber: "50",
      playerNames: ["Elly De La Cruz"],
      year: "2024",
      manufacturer: "Topps",
      setName: "Chrome",
      parallelName: "Gold Refractor",
      printRun: 50,
    });
    expect(title).toBe(
      "2024 Topps Chrome Gold Refractor Elly De La Cruz #50 /50",
    );
  });

  test("autographed, relic, and short print all append", () => {
    const title = generateListingTitle({
      cardNumber: "1",
      playerNames: ["Mike Trout"],
      year: "2024",
      manufacturer: "Topps",
      setName: "Update",
      autographed: "On Card",
      isRelic: true,
      shortPrint: "SSP",
    });
    expect(title).toContain("AUTO");
    expect(title).toContain("RELIC");
    expect(title).toContain("SSP");
  });

  test("multiple players joined with &", () => {
    const title = generateListingTitle({
      cardNumber: "1",
      playerNames: ["Mike Trout", "Shohei Ohtani"],
      year: "2024",
      manufacturer: "Topps",
      setName: "Chrome",
    });
    expect(title).toBe("2024 Topps Chrome Mike Trout & Shohei Ohtani #1");
  });

  test("no players still produces a valid title", () => {
    const title = generateListingTitle({
      cardNumber: "1",
      year: "2024",
      manufacturer: "Topps",
      setName: "Chrome",
    });
    expect(title).toBe("2024 Topps Chrome #1");
  });

  test("a description too long for the cap: every cut is made, then STOP — description, surname and /N stay whole", () => {
    // NEO-535 replaced "the card number is never dropped, the prefix is cut to
    // fit" with the opposite: the number is cut row 10, and description words
    // are never cut, so an over-long description leaves the title over the cap
    // for the operator to fix in the Card titles dialog.
    const a = assessListingTitle({
      cardNumber: "1",
      playerNames: ["A Very Long Player Name Indeed Jones Jr"],
      year: "2024",
      manufacturer: "Topps Chrome Update Series Baseball",
      setName: "Extremely Long Insert Set Name Here",
      parallelName: "Gold Refractor",
      isRookie: true,
      autographed: "On Card",
      isRelic: true,
      shortPrint: "SSP",
      printRun: 25,
    });
    expect(a.title).toBe(
      "2024 Topps Chrome Update Series Baseball Extremely Long Insert Set Name Here Gold Refractor Very Long Player Name Indeed Jones Jr /25",
    );
    expect(a.fits).toBe(false);
    expect(a.title.length).toBeGreaterThan(LISTING_TITLE_MAX);
    expect(a.firstNameLost).toBe(true);
    expect(a.coreFits).toBe(false);
    // Every cuttable token is out, in "Left out to fit" order.
    expect(a.dropped).toEqual(["#1", "A", "SSP", "RC", "RELIC", "AUTO"]);
  });

  test("setName matching manufacturer is not duplicated (e.g. Topps flagship base product)", () => {
    const title = generateListingTitle({
      cardNumber: "2",
      playerNames: ["Daulton Varsho"],
      year: "2026",
      manufacturer: "Topps",
      setName: "Topps",
    });
    expect(title).toBe("2026 Topps Daulton Varsho #2");
    expect(title).not.toContain("Topps Topps");
  });

  test("setName carrying manufacturer as a prefix word is not duplicated (e.g. Topps Heritage)", () => {
    const title = generateListingTitle({
      cardNumber: "390",
      playerNames: ["Colson Montgomery"],
      year: "2026",
      manufacturer: "Topps",
      setName: "Topps Heritage",
    });
    expect(title).toBe("2026 Topps Heritage Colson Montgomery #390");
    expect(title).not.toContain("Topps Topps");
  });

  test("setName sharing a prefix that is NOT a whole word is left alone", () => {
    const title = generateListingTitle({
      cardNumber: "1",
      year: "2024",
      manufacturer: "Topps",
      setName: "Toppsmania",
    });
    expect(title).toBe("2024 Topps Toppsmania #1");
  });

  test("a player name too long for the cap: only the number and the first word go, never a mid-name cut or an ellipsis", () => {
    // NEO-535 retired the hard cap: a surname is never cut, so the title is
    // returned over the cap (`fits: false`) rather than sliced.
    const a = assessListingTitle({
      cardNumber: "99999",
      playerNames: [
        "An Absurdly Long Player Full Name That Alone Exceeds The Entire Title Budget",
      ],
      year: "2024",
      manufacturer: "Topps",
      setName: "Chrome",
    });
    expect(a.title).not.toContain("…");
    expect(a.title).toBe(
      "2024 Topps Chrome Absurdly Long Player Full Name That Alone Exceeds The Entire Title Budget",
    );
    expect(a.fits).toBe(false);
    expect(a.dropped).toEqual(["#99999", "An"]);
  });
});

// ===========================================================================
// NEO-101 — the cap, the new token priority, and the assessment
// ===========================================================================

describe("assessListingTitle (NEO-101)", () => {
  const BASE = {
    cardNumber: "50",
    playerNames: ["Elly De La Cruz"],
    year: "2024",
    manufacturer: "Topps",
    setName: "Chrome",
  };

  test("reports the title, that the core fit, and nothing dropped, for a card that fits easily", () => {
    expect(assessListingTitle({ ...BASE, isRookie: true })).toEqual({
      title: "2024 Topps Chrome Elly De La Cruz #50 RC Rookie",
      fits: true,
      firstNameLost: false,
      coreFits: true,
      dropped: [],
    });
  });

  test("generateListingTitle is exactly assessListingTitle's title", () => {
    const inputs = { ...BASE, isRookie: true, autographed: "On Card" };
    expect(generateListingTitle(inputs)).toBe(assessListingTitle(inputs).title);
  });

  test("cardVariation goes into the title VERBATIM, not parsed", () => {
    // The `;`-separated shape some rows carry is an artefact of how the string
    // was authored, not a schema. Splitting on it would be re-introducing the
    // marketplace vocabulary NEO-189 removed.
    const { title } = assessListingTitle({
      ...BASE,
      cardVariation: "Image Variation; Wearing sunglasses",
    });
    expect(title).toBe(
      "2024 Topps Chrome Elly De La Cruz #50 Image Variation; Wearing sunglasses",
    );
  });

  test("tokens come out in the NEO-535 layout order", () => {
    // Jason, 2026-11-13: <description> <players> #<num> AUTO RELIC /<N>
    // <variation> RC SP|SSP <teams> Rookie <sport>. The parallel ("Gold") is
    // part of the description, before the players.
    const { title, dropped } = assessListingTitle({
      cardNumber: "1",
      playerNames: ["A Player"],
      year: "2024",
      autographed: "On Card",
      isRelic: true,
      parallelName: "Gold",
      printRun: 25,
      cardVariation: "Action",
      isRookie: true,
      shortPrint: "SSP",
      teamNames: ["Reds"],
      sport: "Baseball",
    });
    expect(title).toBe(
      "2024 Gold A Player #1 AUTO RELIC /25 Action RC SSP Reds Rookie Baseball",
    );
    expect(dropped).toEqual([]);
    expect(title.length).toBeLessThanOrEqual(LISTING_TITLE_MAX);
  });

  test("a parallelName that IS the cardVariation is not printed twice", () => {
    // Not a contrived case: `deriveCardObservedFeatures` copies a card's
    // `cardVariation` into `features.parallelName` (NEO-189), so both insert
    // call sites hand the generator the same string in two fields. Before the
    // de-dup this titled as "... #300b Image Variation Image Variation".
    const { title, dropped } = assessListingTitle({
      cardNumber: "300b",
      playerNames: ["Julio Rodriguez"],
      year: "2024",
      manufacturer: "Topps",
      setName: "Chrome",
      parallelName: "Image Variation",
      cardVariation: "Image Variation",
    });
    expect(title).toBe("2024 Topps Chrome Julio Rodriguez #300b Image Variation");
    // A duplicate is not "dropped" — it is right there in the title.
    expect(dropped).toEqual([]);
  });

  test("de-duplication ignores case and surrounding whitespace", () => {
    // A parallel that IS the variation (NEO-189 copy) is said once, as the
    // variation, whatever its casing or padding.
    const { title } = assessListingTitle({
      cardNumber: "1",
      parallelName: "  Gold Refractor ",
      cardVariation: "gold refractor",
    });
    expect(title).toBe("#1 gold refractor");
    expect(title.toLowerCase().split("gold refractor")).toHaveLength(2);
  });

  test('parallelName "Base" is not a token, in any casing', () => {
    for (const parallelName of ["Base", "base", "  BASE  "]) {
      expect(assessListingTitle({ ...BASE, parallelName }).title).toBe(
        "2024 Topps Chrome Elly De La Cruz #50",
      );
    }
  });

  test("the cut list, not token length, decides what goes: a long variation outlasts RC and SP", () => {
    // NEO-535 cuts in a fixed order (row 15, the variation, is near the end)
    // and the refill puts a cut token back only where it still fits. So a
    // long variation stays while the number, the first name, SP and RC go,
    // and none of those comes back because none fits.
    const longVariation = "A Preposterously Long Photo Variation Description";
    const a = assessListingTitle({
      ...BASE,
      cardVariation: longVariation,
      isRookie: true,
      shortPrint: "SP",
    });
    expect(a.title).toBe(
      "2024 Topps Chrome De La Cruz A Preposterously Long Photo Variation Description",
    );
    expect(a.fits).toBe(true);
    expect(a.firstNameLost).toBe(true);
    expect(a.coreFits).toBe(false);
    expect(a.dropped).toEqual(["#50", "Elly", "SP", "RC"]);
    // Each one left out really would not fit back in.
    for (const token of a.dropped) {
      expect(a.title.length + 1 + token.length).toBeGreaterThan(LISTING_TITLE_MAX);
    }
  });

  test("an over-cap title is never cut mid-word or with an ellipsis: whole words of the source only", () => {
    // NEO-535 retired the word-boundary core cut: nothing of the description
    // or a surname is cut, so every word in the title is a word of the source.
    const a = assessListingTitle({
      cardNumber: "7",
      playerNames: ["Wenceslaus Bartholomew Fitzwilliam-Harrington III"],
      year: "2024",
      manufacturer: "Topps",
      setName: "Chrome Sapphire Edition Refractor Selections",
    });
    expect(a.fits).toBe(false);
    expect(a.title).not.toContain("…");
    expect(a.title).toBe(
      "2024 Topps Chrome Sapphire Edition Refractor Selections Bartholomew Fitzwilliam-Harrington III",
    );
    const source = new Set(
      "2024 Topps Chrome Sapphire Edition Refractor Selections Wenceslaus Bartholomew Fitzwilliam-Harrington III".split(
        " ",
      ),
    );
    for (const word of a.title.split(" ")) expect(source.has(word)).toBe(true);
  });

  test("a single unbroken name longer than the cap is kept whole, never sliced", () => {
    // NEO-535 retired the hard-slice fallback. A one-word name has no first
    // name to cut, so only the number goes and the title stays over the cap.
    const name = "X".repeat(120);
    const a = assessListingTitle({ cardNumber: "1", playerNames: [name] });
    expect(a.title).toBe(name);
    expect(a.fits).toBe(false);
    expect(a.dropped).toEqual(["#1"]);
  });

  test("astral characters are never split: nothing slices a title, so no orphaned surrogate half", () => {
    const unbroken = "\u{1F600}".repeat(60); // 120 code units, zero spaces
    const { title, fits } = assessListingTitle({ cardNumber: "1", playerNames: [unbroken] });
    expect(fits).toBe(false);
    expect(title).toBe(unbroken);
    for (const ch of title) {
      const cp = ch.codePointAt(0)!;
      expect(cp < 0xd800 || cp > 0xdfff).toBe(true);
    }
    const roundTripped = new TextDecoder().decode(new TextEncoder().encode(title));
    expect(roundTripped).toBe(title);
  });

  test("a multi-player title never strands a ' & ': players are kept whole and the number is what goes", () => {
    const cardNumber = "9".repeat(64);
    const a = assessListingTitle({ cardNumber, playerNames: ["Aaron Judge", "Ohtani"] });
    expect(a.title).toBe("Aaron Judge & Ohtani");
    expect(a.title).not.toMatch(/&\s*$/);
    expect(a.fits).toBe(true);
    expect(a.dropped).toEqual([`#${cardNumber}`]);
  });

  test("degenerate player names made only of '&' terminate and keep the never-blank title", () => {
    // Not a real card; pins that the loop terminates on input with nothing
    // to cut but the number.
    // NEO-535: a name repeated on one card is said once (`distinctNames`),
    // so five "&" players are one, and a 70-digit number still fits beside it.
    const cardNumber = "9".repeat(70);
    const a = assessListingTitle({ cardNumber, playerNames: ["&", "&", "&", "&", "&"] });
    expect(a.title).toBe(`& #${cardNumber}`);
    expect(a.dropped).toEqual([]);
    const long = "9".repeat(80);
    const b = assessListingTitle({ cardNumber: long, playerNames: ["&", "&"] });
    // Over the cap with it: the number is the cut (row 10), never the title.
    expect(b.title).toBe("&");
    expect(b.dropped).toEqual([`#${long}`]);
  });

  test("team names are appended verbatim, in stored order, and never abbreviated", () => {
    // ~50% of sold listings name the team (Jason's two-sample research,
    // 2026-09-02). Verbatim matters: a buyer types the name as it is printed,
    // so "Seattle Mariners" must not become "SEA" or "Mariners".
    const { title, dropped } = assessListingTitle({
      cardNumber: "12",
      playerNames: ["Julio Rodriguez"],
      year: "2024",
      manufacturer: "Topps",
      teamNames: ["Seattle Mariners"],
      sport: "Baseball",
    });
    expect(title).toBe("2024 Topps Julio Rodriguez #12 Seattle Mariners Baseball");
    expect(dropped).toEqual([]);
  });

  test("a multi-team card names every team it fits, in stored order", () => {
    const { title } = assessListingTitle({
      cardNumber: "1",
      year: "2024",
      teamNames: ["Tigres del Licey", "Aguilas Cibaenas"],
    });
    expect(title).toBe("2024 #1 Tigres del Licey Aguilas Cibaenas");
  });

  test('"Rookie" rides behind RC, and only when the card is a rookie', () => {
    const rookie = assessListingTitle({
      cardNumber: "1",
      year: "2024",
      isRookie: true,
    });
    expect(rookie.title).toBe("2024 #1 RC Rookie");
    // Order matters: RC is the token that must survive if only one fits.
    expect(rookie.title.indexOf("RC")).toBeLessThan(rookie.title.indexOf("Rookie"));

    const notRookie = assessListingTitle({ cardNumber: "1", year: "2024" });
    expect(notRookie.title).toBe("2024 #1");
    expect(notRookie.title).not.toContain("Rookie");
  });

  test('a team name that already contains the sport swallows the sport token', () => {
    // "Oregon Ducks baseball" ⊃ "Baseball". Word-level, case-insensitive — and
    // NOT reported as dropped, because the word is right there in the title.
    const { title, dropped } = assessListingTitle({
      cardNumber: "5",
      year: "2024",
      teamNames: ["Oregon Ducks baseball"],
      sport: "Baseball",
    });
    expect(title).toBe("2024 #5 Oregon Ducks baseball");
    expect(dropped).toEqual([]);
  });

  test("a token repeating a word already in the CORE is skipped", () => {
    // The core carries "Topps" via the set name; a parallel that repeats it
    // spends five characters saying nothing new.
    const { title } = assessListingTitle({
      cardNumber: "1",
      year: "2024",
      manufacturer: "Topps",
      setName: "Topps Chrome",
      parallelName: "Topps Chrome",
    });
    expect(title).toBe("2024 Topps Chrome #1");
  });

  test("RC and Rookie are NOT collapsed into each other", () => {
    // Different words, and carrying both is what real sold listings do — the
    // de-dup is word-level, not concept-level, precisely so this survives.
    const { title } = assessListingTitle({ cardNumber: "1", isRookie: true });
    expect(title).toBe("#1 RC Rookie");
  });

  test("the same team listed twice is named once", () => {
    const { title } = assessListingTitle({
      cardNumber: "1",
      year: "2024",
      teamNames: ["Seattle Mariners", "Seattle Mariners"],
    });
    expect(title).toBe("2024 #1 Seattle Mariners");
  });

  test("a typical base card now PACKS toward the cap instead of stopping at ~34", () => {
    // The defect this whole change answers: NB's real titles averaged 34
    // characters against a sold-listing mean of 70, which is half the
    // searchable surface of the listing left blank. A perfectly ordinary base
    // card — year, set, one player, number, parallel, one team, sport — must
    // now land in the band real sellers use.
    const { title, coreFits, dropped } = assessListingTitle({
      cardNumber: "150",
      playerNames: ["Bobby Witt Jr"],
      year: "2024",
      manufacturer: "Topps",
      setName: "Chrome",
      parallelName: "Refractor",
      teamNames: ["Kansas City Royals"],
      sport: "Baseball",
    });
    expect(coreFits).toBe(true);
    expect(dropped).toEqual([]);
    expect(title).toBe(
      "2024 Topps Chrome Refractor Bobby Witt Jr #150 Kansas City Royals Baseball",
    );
    expect(title.length).toBeGreaterThanOrEqual(60);
    expect(title.length).toBeLessThanOrEqual(LISTING_TITLE_MAX);
  });

  test("no optional tokens present means nothing dropped and nothing invented", () => {
    expect(assessListingTitle({ cardNumber: "9" })).toEqual({
      title: "#9",
      fits: true,
      firstNameLost: false,
      coreFits: true,
      dropped: [],
    });
  });
});

describe("generateListingTitle invariants — fuzz (NEO-101)", () => {
  // A deterministic PRNG, so a failure is reproducible from the seed printed
  // in the assertion message rather than being a Heisenbug in CI.
  function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const WORDS = [
    "Chrome",
    "Sapphire",
    "Update",
    "Heritage",
    "Refractor",
    "Superfractor",
    "Rodriguez",
    "Fitzwilliam-Harrington",
    "Elly",
    "De",
    "La",
    "Cruz",
    "Extraordinarily",
    "Photographic",
    "Variation",
  ];

  test("for any inputs: fits is the length test, and nothing that is never cut is cut", () => {
    const rand = mulberry32(20260902);
    const pick = <T,>(list: T[]): T => list[Math.floor(rand() * list.length)];
    const words = (n: number) =>
      Array.from({ length: n }, () => pick(WORDS)).join(" ");

    for (let i = 0; i < 2000; i++) {
      // Card numbers stay within real-world shape (BSC/SportLots numbers are a
      // handful of characters; sku.ts already caps its own copy at 10).
      const cardNumber = `${Math.floor(rand() * 100000)}${
        rand() < 0.25 ? pick(["a", "b", "c", "SP"]) : ""
      }`;
      const inputs = {
        cardNumber,
        // Long multi-player lists — a League Leaders / rookie-combo card.
        playerNames:
          rand() < 0.15
            ? undefined
            : Array.from({ length: 1 + Math.floor(rand() * 4) }, () =>
                words(1 + Math.floor(rand() * 4)),
              ),
        year: rand() < 0.1 ? undefined : String(1950 + Math.floor(rand() * 80)),
        manufacturer: rand() < 0.1 ? undefined : words(1 + Math.floor(rand() * 5)),
        // Long set / insert names.
        setName: rand() < 0.1 ? undefined : words(1 + Math.floor(rand() * 8)),
        parallelName: rand() < 0.4 ? "Base" : words(1 + Math.floor(rand() * 5)),
        isRookie: rand() < 0.5,
        isRelic: rand() < 0.3,
        autographed: rand() < 0.3 ? "On Card" : "None",
        shortPrint: pick(["None", "SP", "SSP"]),
        // Huge print runs, including ones that are themselves long strings.
        printRun:
          rand() < 0.5 ? undefined : Math.floor(rand() * 10 ** (1 + Math.floor(rand() * 12))),
        // Long variation strings.
        cardVariation: rand() < 0.5 ? undefined : words(1 + Math.floor(rand() * 10)),
        // NEO-101 fill tokens: several long team names, and a sport that
        // sometimes duplicates a word already inside one of them.
        teamNames:
          rand() < 0.3
            ? undefined
            : Array.from({ length: 1 + Math.floor(rand() * 4) }, () =>
                words(1 + Math.floor(rand() * 4)),
              ),
        sport: rand() < 0.3 ? undefined : pick(WORDS),
        // NEO-335: long insert names in the description, and NEO-535 box
        // text standing in for the whole description (capped at 80).
        insertName: rand() < 0.5 ? undefined : words(1 + Math.floor(rand() * 6)),
        setShortName: rand() < 0.5 ? undefined : words(1 + Math.floor(rand() * 4)).slice(0, 80),
        // NEO-335: the "Parallel" label rides on the parallel role.
        parallelIsRole: rand() < 0.5,
      };

      const a = assessListingTitle(inputs);
      const { title, dropped } = a;
      const context = JSON.stringify(inputs);
      const titleWords = new Set(title.split(" "));

      expect(a.fits, context).toBe(title.length <= LISTING_TITLE_MAX);
      expect(title, context).not.toContain("…");
      expect(title, context).not.toMatch(/\s{2}/);
      expect(title.trim(), context).toBe(title);
      // Never cut: the description (or, when used, the box text verbatim at
      // the start), every player's surname part, and /N.
      if (a.shortNameUsed) {
        expect(title.startsWith(inputs.setShortName!.trim()), context).toBe(true);
      } else {
        // The fuzz vocabulary has no "Rookie", so row 8 never rewrites a word.
        for (const word of titleDescription(inputs).split(" ").filter(Boolean)) {
          expect(titleWords.has(word), `${context} :: description word ${word}`).toBe(true);
        }
      }
      for (const name of inputs.playerNames ?? []) {
        const kept = withoutFirstName(name) ?? name;
        expect(title.includes(kept), `${context} :: surname ${kept}`).toBe(true);
      }
      if (inputs.printRun) {
        expect(titleWords.has(`/${inputs.printRun}`), context).toBe(true);
      }
      // The card number is in the title (with or without its "#"), or it is
      // reported as left out.
      expect(
        titleWords.has(`#${cardNumber}`) || titleWords.has(cardNumber) || dropped.includes(`#${cardNumber}`),
        context,
      ).toBe(true);
      // A token left out of a title that fits really would not have fitted
      // back in: the refill only ever adds characters.
      if (a.fits) {
        for (const token of dropped) {
          const cost = token === `#${cardNumber}` ? cardNumber.length : token.length;
          expect(title.length + 1 + cost, `${context} :: dropped ${token}`).toBeGreaterThan(
            LISTING_TITLE_MAX,
          );
        }
      }
      expect(a.coreFits, context).toBe(!a.firstNameLost && !a.shortNameUsed);
    }
  });
});

describe("generateListingDescription", () => {
  test("full facts compose a multi-sentence description", () => {
    const desc = generateListingDescription({
      cardNumber: "50",
      playerNames: ["Elly De La Cruz"],
      year: "2024",
      manufacturer: "Topps",
      setName: "Chrome",
      parallelName: "Gold Refractor",
      isRookie: true,
      autographed: "On Card",
      isRelic: true,
      shortPrint: "SSP",
      printRun: 50,
    });
    // NEO-535: every fact, in its long form and the short form collectors
    // type, so collector search on the description finds either.
    expect(desc.split("\n")).toEqual([
      "2024 Topps Chrome Gold Refractor card of Elly De La Cruz, #50.",
      "Parallel: Gold Refractor.",
      "Serial numbered to 50 (/50).",
      "Autographed (AUTO), On Card.",
      "Includes a memorabilia relic piece (RELIC).",
      "Rookie Card (RC).",
      "Super Short Print (SSP).",
    ]);
  });

  test("each fact renders on its own line rather than one run-on paragraph", () => {
    const desc = generateListingDescription({
      cardNumber: "50",
      playerNames: ["Elly De La Cruz"],
      year: "2024",
      manufacturer: "Topps",
      setName: "Chrome",
      isRookie: true,
      autographed: "On Card",
    });
    expect(desc.split("\n")).toEqual([
      "2024 Topps Chrome card of Elly De La Cruz, #50.",
      "Autographed (AUTO), On Card.",
      "Rookie Card (RC).",
    ]);
  });

  test("base card with no special attributes gets a minimal description", () => {
    const desc = generateListingDescription({
      cardNumber: "1",
      playerNames: ["Mike Trout"],
      year: "2024",
      manufacturer: "Topps",
      setName: "Chrome",
      parallelName: "Base",
    });
    expect(desc).toBe("2024 Topps Chrome card of Mike Trout, #1.");
  });

  test("no ancestor data at all still produces a sane sentence", () => {
    expect(generateListingDescription({ cardNumber: "1" })).toBe(
      "Card #1.",
    );
    expect(
      generateListingDescription({
        cardNumber: "1",
        playerNames: ["Mike Trout"],
      }),
    ).toBe("Card #1 of Mike Trout.");
  });

  test("setName matching manufacturer is not duplicated (e.g. Topps flagship base product)", () => {
    const desc = generateListingDescription({
      cardNumber: "2",
      playerNames: ["Daulton Varsho"],
      year: "2026",
      manufacturer: "Topps",
      setName: "Topps",
    });
    expect(desc).toBe("2026 Topps card of Daulton Varsho, #2.");
    expect(desc).not.toContain("Topps Topps");
  });

  test("setName carrying manufacturer as a prefix word is not duplicated (e.g. Topps Heritage)", () => {
    const desc = generateListingDescription({
      cardNumber: "390",
      playerNames: ["Colson Montgomery"],
      year: "2026",
      manufacturer: "Topps",
      setName: "Topps Heritage",
    });
    expect(desc).toBe("2026 Topps Heritage card of Colson Montgomery, #390.");
    expect(desc).not.toContain("Topps Topps");
  });

  test("NEO-101: cardVariation gets its own line, verbatim and uncapped", () => {
    const desc = generateListingDescription({
      cardNumber: "300b",
      playerNames: ["Julio Rodriguez"],
      year: "2024",
      manufacturer: "Topps",
      setName: "Chrome",
      cardVariation: "Image Variation; Wearing sunglasses",
      shortPrint: "SP",
    });
    expect(desc.split("\n")).toEqual([
      "2024 Topps Chrome card of Julio Rodriguez, #300b.",
      "Variation: Image Variation; Wearing sunglasses.",
      "Short Print (SP).",
    ]);
  });

  test("NEO-101: a variation that already ends in a full stop does not get a second one", () => {
    const desc = generateListingDescription({
      cardNumber: "1",
      cardVariation: "Bat on shoulder.",
    });
    expect(desc).toContain("Variation: Bat on shoulder.");
    expect(desc).not.toContain("shoulder..");
  });

  test("NEO-101: a variation far too long for the title still states itself in full here", () => {
    // The description has no cap (eBay takes ~500k of HTML), so unlike the
    // title nothing is dropped — this is where the dropped token goes.
    const variation = "A ".repeat(60) + "Variation";
    const desc = generateListingDescription({ cardNumber: "1", cardVariation: variation });
    expect(desc).toContain(variation);
    // The 129-character variation alone is over the cap: the title cuts it
    // (row 15) and the refill puts the number back.
    expect(generateListingTitle({ cardNumber: "1", cardVariation: variation })).toBe(
      "#1",
    );
  });

  test("NEO-101: teams get their own line, named in full", () => {
    const desc = generateListingDescription({
      cardNumber: "12",
      playerNames: ["Julio Rodriguez"],
      year: "2024",
      manufacturer: "Topps",
      setName: "Chrome",
      teamNames: ["Seattle Mariners"],
      isRookie: true,
    });
    expect(desc.split("\n")).toEqual([
      "2024 Topps Chrome card of Julio Rodriguez, #12.",
      "Rookie Card (RC).",
      "Team: Seattle Mariners.",
    ]);
  });

  test("NEO-101: a multi-team card lists every team, uncapped", () => {
    // The description has no cap, so unlike the title nothing here competes
    // for room — a team the title had to drop still states itself in full.
    const desc = generateListingDescription({
      cardNumber: "1",
      teamNames: ["Tigres del Licey", "Aguilas Cibaenas", "Estrellas Orientales"],
    });
    expect(desc).toContain(
      "Team: Tigres del Licey, Aguilas Cibaenas, Estrellas Orientales.",
    );
  });

  test("NEO-101: no teams means no Team line at all", () => {
    const desc = generateListingDescription({ cardNumber: "1", teamNames: [] });
    expect(desc).not.toContain("Team:");
  });

  test("autographed None does not add an autograph sentence", () => {
    const desc = generateListingDescription({
      cardNumber: "1",
      autographed: "None",
    });
    expect(desc).not.toContain("Autographed");
  });
});

// ===========================================================================
// NEO-272 — a set whose brand NB has not identified
// ===========================================================================

/**
 * `syncSetsAcrossManufacturers` files a BSC set under the marketplace's
 * all-brands FILTER OPTION — "show all cards from all brands", carried on the
 * brand axis as a `manufacturer` row — whenever the set name prefix-matches no
 * real brand. That row names no brand, so its name says nothing about the card
 * and must never reach a listing. It is identified by
 * `manufacturerBrandUnknown`, an NB ROLE resolved from the ancestor row's
 * `metadata.isBrandUnknown`, NEVER by comparing the name.
 *
 * The name comparison is the thing this ticket removes: the name is a
 * marketplace filter label NB does not own, so keying on it would be NB
 * behaviour driven by a marketplace value (product invariant 4) — and it would
 * miss a renamed row besides.
 *
 * The fixture below deliberately KEEPS the name in `manufacturer` while
 * setting the flag. A generator that passed these tests by ignoring the flag
 * and matching the string would be caught by
 * `an unflagged manufacturer named "All Brands" is still a brand`.
 */
describe("a set whose brand NB has not identified (NEO-272)", () => {
  const BUCKET = {
    cardNumber: "12",
    playerNames: ["Chris Grassie"],
    year: "1995",
    manufacturer: "All Brands",
    setName: "Roanoke Express ECHL",
  };

  test("a flagged manufacturer is omitted from the title entirely", () => {
    const title = generateListingTitle({
      ...BUCKET,
      manufacturerBrandUnknown: true,
    });
    expect(title).toBe("1995 Roanoke Express ECHL Chris Grassie #12");
    expect(title).not.toContain("All Brands");
  });

  test("omitting it leaves no dangling separator and no double space", () => {
    // The failure this guards is an empty token surviving the join — a title
    // reading "1995  Roanoke ..." or "1995 - Roanoke ...". The generator never
    // produces a manufacturer token at all for a flagged row, which is what
    // makes `filter(Boolean).join(" ")` a complete answer.
    const title = generateListingTitle({
      ...BUCKET,
      manufacturerBrandUnknown: true,
    });
    expect(title).not.toMatch(/\s{2}/);
    expect(title.trim()).toBe(title);
    // Same check with every other core part absent, so nothing else is
    // covering for the missing token.
    const bare = generateListingTitle({
      cardNumber: "12",
      manufacturer: "All Brands",
      manufacturerBrandUnknown: true,
      setName: "Roanoke Express ECHL",
    });
    expect(bare).toBe("Roanoke Express ECHL #12");
    expect(bare).not.toMatch(/\s{2}/);
  });

  test('an unflagged manufacturer named "All Brands" is still a brand', () => {
    // The regression guard, and the reason the flag is read instead of the
    // name. A row that carries no brand-unknown role is an ordinary
    // manufacturer whatever it happens to be called.
    const title = generateListingTitle(BUCKET);
    expect(title).toBe("1995 All Brands Roanoke Express ECHL Chris Grassie #12");
    // …and an explicit `false` reads the same as absent.
    expect(
      generateListingTitle({ ...BUCKET, manufacturerBrandUnknown: false }),
    ).toBe(title);
  });

  test("the freed characters are genuinely available to the title", () => {
    // "All Brands" plus its separator is 11 characters. With it, the title is
    // 84 characters and loses the card number (cut row 10); without it the
    // same card fits whole, number included. The characters it reclaimed were
    // spent on a word that told a buyer nothing.
    const variation = "Image Variation Sunglasses On";
    expect(variation).toHaveLength(29);

    const withBucket = assessListingTitle({ ...BUCKET, cardVariation: variation });
    expect(withBucket.dropped).toEqual(["#12"]);
    expect(withBucket.title).toBe(
      "1995 All Brands Roanoke Express ECHL Chris Grassie Image Variation Sunglasses On",
    );

    const withoutBucket = assessListingTitle({
      ...BUCKET,
      cardVariation: variation,
      manufacturerBrandUnknown: true,
    });
    expect(withoutBucket.dropped).toEqual([]);
    expect(withoutBucket.title).toBe(
      "1995 Roanoke Express ECHL Chris Grassie #12 Image Variation Sunglasses On",
    );
    expect(withoutBucket.title.length).toBeLessThanOrEqual(LISTING_TITLE_MAX);
    expect(withoutBucket.coreFits).toBe(true);
  });

  test("the description omits it too — one helper serves both", () => {
    const desc = generateListingDescription({
      ...BUCKET,
      manufacturerBrandUnknown: true,
      isRookie: true,
    });
    expect(desc.split("\n")).toEqual([
      "1995 Roanoke Express ECHL card of Chris Grassie, #12.",
      "Rookie Card (RC).",
    ]);
    expect(desc).not.toContain("All Brands");
    // Unflagged, the same inputs still name it.
    expect(generateListingDescription({ ...BUCKET, isRookie: true })).toContain(
      "1995 All Brands Roanoke Express ECHL card of Chris Grassie, #12.",
    );
  });

  test("a setName starting with the flagged manufacturer keeps the setName whole", () => {
    // The `startsWithWord` collapse branch needs a truthy manufacturer, so a
    // flagged row never reaches it. The result has to be the same either way:
    // the set name is a display value in its own right and is emitted verbatim,
    // never stripped of a prefix that happens to match the dropped row's name.
    const flagged = generateListingTitle({
      cardNumber: "7",
      year: "1995",
      manufacturer: "All Brands",
      manufacturerBrandUnknown: true,
      setName: "All Brands Showcase",
      playerNames: ["Chris Grassie"],
    });
    expect(flagged).toBe("1995 All Brands Showcase Chris Grassie #7");
    expect(flagged).not.toMatch(/\s{2}/);
    // Unflagged, the collapse still does its job: the word is not doubled.
    const unflagged = generateListingTitle({
      cardNumber: "7",
      year: "1995",
      manufacturer: "All Brands",
      setName: "All Brands Showcase",
      playerNames: ["Chris Grassie"],
    });
    expect(unflagged).toBe("1995 All Brands Showcase Chris Grassie #7");
  });

  test("a flagged manufacturer with no setName leaves only year, players and number", () => {
    const title = generateListingTitle({
      cardNumber: "3",
      year: "1995",
      manufacturer: "All Brands",
      manufacturerBrandUnknown: true,
      playerNames: ["Chris Grassie"],
    });
    expect(title).toBe("1995 Chris Grassie #3");
    expect(title).not.toMatch(/\s{2}/);
  });
});

describe("NEO-335 — the insert's name is set identity", () => {
  const score: ListingCardInputs = {
    cardNumber: "5",
    year: "1996",
    manufacturer: "Score",
    setName: "Score",
    playerNames: ["Ken Griffey Jr."],
  };

  test("joins the core after the set name and before the players", () => {
    expect(generateListingTitle({ ...score, insertName: "Dugout Collection" })).toBe(
      "1996 Score Dugout Collection Insert Ken Griffey Jr. #5",
    );
  });

  test("no insert name: the title is exactly what it was", () => {
    expect(generateListingTitle(score)).toBe("1996 Score Ken Griffey Jr. #5");
  });

  test("an insert named after its set collapses into it, like a set named after its maker", () => {
    expect(
      generateListingTitle({
        ...score,
        manufacturer: "Topps",
        setName: "Topps Chrome",
        insertName: "Topps Chrome Refractor",
      }),
    ).toBe("1996 Topps Chrome Refractor Insert Ken Griffey Jr. #5");
    expect(
      generateListingTitle({
        ...score,
        manufacturer: "Upper Deck",
        setName: "Collector's Choice",
        insertName: "Collector's Choice Silver Signature",
      }),
    ).toBe("1996 Upper Deck Collector's Choice Silver Signature Insert Ken Griffey Jr. #5");
  });

  test("an insert whose every word the set already says adds nothing", () => {
    expect(
      generateListingTitle({ ...score, manufacturer: "Topps", setName: "Topps Chrome", insertName: "Chrome" }),
    ).toBe("1996 Topps Chrome Insert Ken Griffey Jr. #5");
  });

  test("never cut: a long insert stays whole and the title STOPs over the cap (flagged)", () => {
    const a = assessListingTitle({
      ...score,
      insertName: "Extraordinarily Photographic Superfractor Heritage Refractor Update",
      playerNames: ["Fitzwilliam-Harrington Rodriguez"],
    });
    expect(a.title).toBe(
      "1996 Score Extraordinarily Photographic Superfractor Heritage Refractor Update Rodriguez",
    );
    expect(a.fits).toBe(false);
    expect(a.coreFits).toBe(false);
    // The "Insert" label, the number and the first name went; none is a
    // description word.
    expect(a.dropped).toEqual(["#5", "Fitzwilliam-Harrington"]);
  });

  test("the description names the insert too, in full, and ignores the box", () => {
    expect(
      generateListingDescription({ ...score, insertName: "Dugout Collection", setShortName: "Score DC" }),
    ).toBe("1996 Score Dugout Collection card of Ken Griffey Jr., #5.\nInsert: Dugout Collection.");
  });
});

describe("NEO-535 — the box (\"Set name in titles\") replaces the whole description, only when needed", () => {
  // 1990 Upper Deck Collector's Choice, Hologram insert, a card whose
  // builder title is over the cap after every cut.
  const long: ListingCardInputs = {
    cardNumber: "H12",
    year: "1990",
    manufacturer: "Upper Deck",
    setName: "Upper Deck Collector's Choice",
    insertName: "Hologram Heroes Extraordinarily Photographic",
    playerNames: ["Fitzwilliam-Harrington Rodriguez"],
    setShortName: "1990 Upper Deck Hologram",
  };
  // Fits once the number and Elly's first name go; the box keeps both.
  const losesFirstName: ListingCardInputs = {
    cardNumber: "1",
    year: "2024",
    manufacturer: "Topps",
    setName: "Topps Chrome Sapphire",
    insertName: "Debut Patch Autographs",
    playerNames: ["Elly De La Cruz"],
    autographed: "On Card",
    isRelic: true,
    isRookie: true,
    printRun: 99,
    cardVariation: "Image Variation",
    setShortName: "Topps Debut",
  };
  // Fits with full names, but a real token (the team) is still left out.
  const dropsTeamOnly: ListingCardInputs = {
    cardNumber: "RD-12",
    year: "2024",
    manufacturer: "Topps",
    setName: "Topps Chrome",
    insertName: "Rookie Debut Patch Autographs",
    playerNames: ["Elly De La Cruz"],
    autographed: "On Card",
    isRookie: true,
    teamNames: ["Cincinnati Reds"],
    setShortName: "Topps RDPA",
  };

  test("the fixtures are what they claim", () => {
    const noBox = (i: ListingCardInputs) => assessListingTitle({ ...i, setShortName: undefined });
    expect(noBox(long).fits).toBe(false);
    expect(noBox(losesFirstName).fits).toBe(true);
    expect(noBox(losesFirstName).firstNameLost).toBe(true);
    expect(noBox(losesFirstName).dropped).toEqual(["#1", "Elly", "RC", "RELIC"]);
    expect(noBox(dropsTeamOnly).firstNameLost).toBe(false);
    expect(noBox(dropsTeamOnly).dropped).toEqual(["Cincinnati Reds"]);
  });

  test("(a) a title over the cap after every cut is built from the box, verbatim", () => {
    expect(assessListingTitle(long)).toEqual({
      title: "1990 Upper Deck Hologram Fitzwilliam-Harrington Rodriguez #H12",
      fits: true,
      firstNameLost: false,
      dropped: [],
      shortNameUsed: true,
      coreFits: false,
    });
  });

  test("(b) a title that lost a first name is built from the box when the box keeps it", () => {
    const a = assessListingTitle(losesFirstName);
    expect(a.shortNameUsed).toBe(true);
    expect(a.title).toBe("Topps Debut Elly De La Cruz #1 AUTO RELIC /99 Image Variation RC Rookie");
    expect(a.firstNameLost).toBe(false);
    // Born flagged, so the card is on the Card titles step.
    expect(a.coreFits).toBe(false);
  });

  test("never on a title that fits with full names, even when a real token is left out", () => {
    const a = assessListingTitle(dropsTeamOnly);
    expect(a.shortNameUsed).toBeUndefined();
    expect(a.coreFits).toBe(true);
    expect(a.title).toContain("Rookie Debut Patch Autographs");
  });

  test("nothing is prepended to the box: not the year, not the maker", () => {
    const a = assessListingTitle({ ...long, setShortName: "CC Hologram" });
    expect(a.title).toBe("CC Hologram Fitzwilliam-Harrington Rodriguez #H12");
  });

  test("a brand NB has not identified is never put back by the box", () => {
    const a = assessListingTitle({
      ...long,
      manufacturer: "All Brands",
      manufacturerBrandUnknown: true,
      setShortName: "CC Hologram",
    });
    expect(a.title).toBe("CC Hologram Fitzwilliam-Harrington Rodriguez #H12");
    expect(a.title).not.toContain("All Brands");
  });

  test("a blank short name is no short name", () => {
    expect(assessListingTitle({ ...long, setShortName: "   " })).toEqual(
      assessListingTitle({ ...long, setShortName: undefined }),
    );
  });
});

describe("NEO-335 — the \"Insert\" and \"Parallel\" labels (cut rows 4 and 5)", () => {
  const score: ListingCardInputs = {
    cardNumber: "5",
    year: "1996",
    manufacturer: "Score",
    setName: "Score",
    playerNames: ["Ken Griffey Jr."],
  };
  const both: ListingCardInputs = {
    ...score,
    insertName: "Dugout Collection",
    parallelName: "Gold",
    parallelIsRole: true,
  };

  test("each label follows the name it labels, inside the description", () => {
    expect(assessListingTitle(both)).toEqual({
      title: "1996 Score Dugout Collection Insert Gold Parallel Ken Griffey Jr. #5",
      fits: true,
      firstNameLost: false,
      coreFits: true,
      dropped: [],
    });
    expect(generateListingTitle({ ...score, insertName: "Dugout Collection" })).toBe(
      "1996 Score Dugout Collection Insert Ken Griffey Jr. #5",
    );
    expect(generateListingTitle({ ...score, parallelName: "Gold", parallelIsRole: true })).toBe(
      "1996 Score Gold Parallel Ken Griffey Jr. #5",
    );
  });

  test("\"Parallel\" only on the parallel ROLE, never on a parallel name alone", () => {
    // A base card whose features name a parallel (or a copied variation)
    // carries no role: no label.
    expect(generateListingTitle({ ...score, parallelName: "Gold" })).toBe(
      "1996 Score Gold Ken Griffey Jr. #5",
    );
    expect(
      generateListingTitle({ ...score, parallelName: "Gold", parallelIsRole: false }),
    ).toBe("1996 Score Gold Ken Griffey Jr. #5");
    // A "Base" parallel name is no parallel token, so nothing to label.
    expect(generateListingTitle({ ...score, parallelName: "Base", parallelIsRole: true })).toBe(
      "1996 Score Ken Griffey Jr. #5",
    );
  });

  test("a name that already ends with the word is not labelled twice", () => {
    expect(generateListingTitle({ ...score, insertName: "Gold Insert" })).toBe(
      "1996 Score Gold Insert Ken Griffey Jr. #5",
    );
    expect(generateListingTitle({ ...score, insertName: "Hot Inserts" })).toBe(
      "1996 Score Hot Inserts Ken Griffey Jr. #5",
    );
    expect(
      generateListingTitle({ ...score, parallelName: "Prizm Parallel", parallelIsRole: true }),
    ).toBe("1996 Score Prizm Parallel Ken Griffey Jr. #5");
    // A word that merely ends in the letters is not the word.
    expect(generateListingTitle({ ...score, insertName: "Reinsert" })).toBe(
      "1996 Score Reinsert Insert Ken Griffey Jr. #5",
    );
  });

  test("a parallel token that is really the card's variation is not called a parallel", () => {
    expect(
      generateListingTitle({
        ...score,
        parallelName: "Image Variation",
        cardVariation: "Image Variation",
        parallelIsRole: true,
      }),
    ).toBe("1996 Score Ken Griffey Jr. #5 Image Variation");
  });

  test("\"Insert\" goes first: the team and the parallel label keep their room, and no label is ever reported", () => {
    const a = assessListingTitle({ ...both, teamNames: ["Seattle Mariners"] });
    expect(a.title).toBe(
      "1996 Score Dugout Collection Gold Parallel Ken Griffey Jr. #5 Seattle Mariners",
    );
    expect(a.dropped).toEqual([]);
  });

  test("\"Parallel\" is the second: both labels go before a team does", () => {
    const a = assessListingTitle({ ...both, teamNames: ["Seattle Mariners Club"] });
    expect(a.title).toBe("1996 Score Dugout Collection Gold Ken Griffey Jr. #5 Seattle Mariners Club");
    expect(a.dropped).toEqual([]);
  });

  test("the labels go before the sport", () => {
    const a = assessListingTitle({ ...both, teamNames: ["Seattle Mariners"], sport: "Baseball" });
    expect(a.title).toBe(
      "1996 Score Dugout Collection Gold Ken Griffey Jr. #5 Seattle Mariners Baseball",
    );
    expect(a.dropped).toEqual([]);
  });

  test("no labels beside the box: the box is the operator's text, used as typed", () => {
    const a = assessListingTitle({
      ...both,
      insertName: "Extraordinarily Photographic Superfractor Heritage Refractor Update",
      playerNames: ["Fitzwilliam-Harrington Rodriguez"],
      setShortName: "1996 Score EPS",
    });
    expect(a.shortNameUsed).toBe(true);
    expect(a.title).toBe("1996 Score EPS Fitzwilliam-Harrington Rodriguez #5");
  });

  test("losing only the labels never switches to the box", () => {
    const a = assessListingTitle({
      ...both,
      teamNames: ["Seattle Mariners Club"],
      setShortName: "Score DC",
    });
    expect(a.dropped).toEqual([]);
    expect(a.shortNameUsed).toBeUndefined();
    expect(a.title).toContain("Dugout Collection");
  });

  test("the description carries no labels", () => {
    expect(generateListingDescription(both)).toBe(
      "1996 Score Dugout Collection Gold card of Ken Griffey Jr., #5.\nInsert: Dugout Collection.\nParallel: Gold.",
    );
  });

  test("a base card's title is byte-identical: no role, no label", () => {
    expect(
      generateListingTitle({
        cardNumber: "50",
        playerNames: ["Elly De La Cruz"],
        year: "2024",
        manufacturer: "Topps",
        setName: "Chrome",
        parallelName: "Base",
        isRookie: true,
        teamNames: ["Cincinnati Reds"],
        sport: "Baseball",
      }),
    ).toBe("2024 Topps Chrome Elly De La Cruz #50 RC Cincinnati Reds Rookie Baseball");
  });
});

describe("NEO-535 — \"Rookie\" → \"RC\" in an insert's name is cut row 8", () => {
  const debut: ListingCardInputs = {
    cardNumber: "RD-12",
    year: "2024",
    manufacturer: "Topps",
    setName: "Topps Chrome",
    insertName: "Rookie Debut Patch Autographs",
    playerNames: ["Elly De La Cruz"],
    autographed: "On Card",
    isRookie: true,
  };

  test("the old builder's exact replacement: first occurrence, case-sensitive, no word boundary", () => {
    expect(rookieAsRc("Rookie Debut")).toBe("RC Debut");
    expect(rookieAsRc("Rookie Rookie")).toBe("RC Rookie");
    expect(rookieAsRc("Rookies Club")).toBe("RCs Club");
    expect(rookieAsRc("rookie debut")).toBe("rookie debut");
    expect(rookieAsRc("Future Stars")).toBe("Future Stars");
  });

  test("a title that fits once the repeats and labels go keeps the printed name", () => {
    // AUTO is a repeat of "Autographs" (row 1) and goes first; RC repeats
    // "Rookie" and is not needed out. Row 8 is never reached.
    expect(assessListingTitle(debut).title).toBe(
      "2024 Topps Chrome Rookie Debut Patch Autographs Insert Elly De La Cruz #RD-12 RC",
    );
    expect(
      assessListingTitle({ ...debut, isRelic: true, printRun: 99 }).title,
    ).toBe("2024 Topps Chrome Rookie Debut Patch Autographs Elly De La Cruz #RD-12 RELIC /99");
  });

  test("tried before a team is cut, and undone by the refill when the team still does not fit", () => {
    // Rows 1-8 all go, the team still does not fit, so the team goes (row 9)
    // and the refill restores "Rookie" and the "Insert" label.
    const a = assessListingTitle({ ...debut, teamNames: ["Cincinnati Reds"] });
    expect(a.title).toBe(
      "2024 Topps Chrome Rookie Debut Patch Autographs Insert Elly De La Cruz #RD-12",
    );
    expect(a.dropped).toEqual(["Cincinnati Reds"]);
  });

  test("kept on a title still over the cap: four characters back, and never reported", () => {
    const a = assessListingTitle({
      ...debut,
      insertName: "Rookie Debut Patch Autographs Sapphire Platinum Anniversary Edition",
    });
    expect(a.fits).toBe(false);
    expect(a.title).toBe(
      "2024 Topps Chrome RC Debut Patch Autographs Sapphire Platinum Anniversary Edition De La Cruz",
    );
    expect(a.dropped).toEqual(["#RD-12", "Elly"]);
  });

  test("kept when it is what lets the variation stay", () => {
    const a = assessListingTitle({
      ...debut,
      isRelic: true,
      printRun: 99,
      cardVariation: "Gold Glove",
    });
    expect(a.title).toBe(
      "2024 Topps Chrome RC Debut Patch Autographs Elly De La Cruz RELIC /99 Gold Glove",
    );
    expect(a.dropped).toEqual(["#RD-12"]);
  });

  test("never touches a name without \"Rookie\", nor the description", () => {
    const fresh = assessListingTitle({
      ...debut,
      insertName: "Freshman Debut Patch Autographs",
      isRelic: true,
      printRun: 99,
    });
    expect(fresh.title).toContain("Freshman Debut Patch Autographs");
    expect(generateListingDescription({ ...debut, isRelic: true, printRun: 99 })).toContain(
      "Rookie Debut Patch Autographs",
    );
  });
});

describe("brandedSetName (NEO-464) — the set as its cards' titles name it", () => {
  test("puts the brand before a set name that does not start with it", () => {
    expect(brandedSetName({ manufacturer: "Topps", setName: "Finest" })).toBe("Topps Finest");
  });

  test("keeps a set name that already leads with its brand, as a whole word", () => {
    expect(brandedSetName({ manufacturer: "Topps", setName: "Topps Chrome" })).toBe("Topps Chrome");
    expect(brandedSetName({ manufacturer: "Score", setName: "Score" })).toBe("Score");
    expect(brandedSetName({ manufacturer: "Pro", setName: "Pro Set" })).toBe("Pro Set");
    expect(brandedSetName({ manufacturer: "Pro", setName: "Prospects" })).toBe("Pro Prospects");
  });

  test("names the set alone when NB has no brand, or has not identified it", () => {
    expect(brandedSetName({ manufacturer: "", setName: "Finest" })).toBe("Finest");
    expect(brandedSetName({ setName: "Finest" })).toBe("Finest");
    expect(brandedSetName({ manufacturer: "Any Brand", manufacturerBrandUnknown: true, setName: "Finest" })).toBe("Finest");
  });

  test("is the words the title puts after the year", () => {
    const title = generateListingTitle({
      cardNumber: "1",
      year: "1993",
      manufacturer: "Topps",
      setName: "Finest",
      parallelName: "Base",
    });
    expect(title.startsWith(`1993 ${brandedSetName({ manufacturer: "Topps", setName: "Finest" })} `)).toBe(true);
  });
});

describe("NEO-535 leftOutOfTitle: a team the title already names is not left out", () => {
  const card = (teamNames: string[], sport = "Baseball"): ListingCardInputs => ({
    cardNumber: "17",
    playerNames: ["Shohei Ohtani"],
    year: "2024",
    manufacturer: "Topps",
    setName: "Topps",
    teamNames,
    sport,
  });

  test("the nickname in the box text counts ('…Dodgers Japan Edition')", () => {
    const text = "2024 Topps Dodgers Japan Edition Shohei Ohtani #17";
    expect(leftOutOfTitle(card(["Los Angeles Dodgers"]), text)).not.toContain(
      "Los Angeles Dodgers",
    );
  });

  test("a plural or case difference still counts", () => {
    expect(
      leftOutOfTitle(card(["Los Angeles Dodgers"]), "2024 Topps DODGER Stadium Shohei Ohtani #17"),
    ).not.toContain("Los Angeles Dodgers");
  });

  test("a team the title does not name is still listed", () => {
    expect(leftOutOfTitle(card(["Los Angeles Dodgers"]), "2024 Topps Shohei Ohtani #17")).toContain(
      "Los Angeles Dodgers",
    );
  });

  test("a trailing sport word is set aside: 'Oregon Ducks baseball' reads 'Ducks'", () => {
    expect(
      leftOutOfTitle(card(["Oregon Ducks baseball"]), "2024 Topps Ducks Shohei Ohtani #17"),
    ).not.toContain("Oregon Ducks baseball");
    // The sport word alone never names the team.
    expect(
      leftOutOfTitle(card(["Oregon Ducks baseball"]), "2024 Topps Shohei Ohtani #17 Baseball"),
    ).toContain("Oregon Ducks baseball");
  });

  test("a one-word team is named only whole", () => {
    expect(leftOutOfTitle(card(["Brazil"]), "2024 Topps Brazil Shohei Ohtani #17")).not.toContain(
      "Brazil",
    );
    expect(leftOutOfTitle(card(["Brazil"]), "2024 Topps Shohei Ohtani #17")).toContain("Brazil");
  });
});

describe("NEO-535 readsAsGeneratedDescription", () => {
  const full: ListingCardInputs = {
    cardNumber: "85",
    playerNames: ["Vladimir Guerrero Jr."],
    year: "2019",
    manufacturer: "Topps",
    setName: "Topps Chrome Update",
    insertName: "Rookie Debut",
    parallelName: "Gold Refractor",
    isRookie: true,
    isRelic: true,
    autographed: "On Card",
    shortPrint: "SSP",
    printRun: 50,
    cardVariation: "Batting Helmet",
    teamNames: ["Toronto Blue Jays"],
    sport: "Baseball",
  };

  test("the generator's own output reads as the generator's, for full and sparse facts", () => {
    const cases: ListingCardInputs[] = [
      full,
      { cardNumber: "1" },
      { cardNumber: "" },
      { cardNumber: "7", playerNames: ["Mike Trout"] },
      { cardNumber: "7", year: "2011", setName: "Topps Update" },
      { ...full, shortPrint: "SP", printRun: undefined, cardVariation: "Sliding." },
      { ...full, playerNames: ["Shohei Ohtani", "Mike Trout"], teamNames: ["A", "B"] },
    ];
    for (const inputs of cases) {
      const text = generateListingDescription(inputs);
      expect(readsAsGeneratedDescription(text), text).toBe(true);
    }
  });

  test("an operator's own words do not", () => {
    const generated = generateListingDescription(full);
    expect(readsAsGeneratedDescription("Mint condition. Ships in a top loader.")).toBe(false);
    expect(readsAsGeneratedDescription(`${generated}\nSharp corners, great centering.`)).toBe(false);
    expect(readsAsGeneratedDescription(`${generated}\n\nShips fast.`)).toBe(false);
    expect(readsAsGeneratedDescription(`Pulled this myself!\n${generated}`)).toBe(false);
    expect(readsAsGeneratedDescription("")).toBe(false);
  });

  test("text past the description cap is refused before any line is read", () => {
    // Both read as the builder's shape; only the length tells them apart.
    const atCap = `${"A".repeat(LISTING_DESCRIPTION_MAX - " card.".length)} card.`;
    expect(atCap.length).toBe(LISTING_DESCRIPTION_MAX);
    expect(readsAsGeneratedDescription(atCap)).toBe(true);
    expect(readsAsGeneratedDescription(`A${atCap}`)).toBe(false);
    expect(readsAsGeneratedDescription(`${"Rookie Card (RC).\n".repeat(100_000)}`)).toBe(false);
  });
});

describe("NEO-535 — a parallel's leading insert words are said once", () => {
  const BOWMAN: ListingCardInputs = {
    cardNumber: "BA-3",
    playerNames: ["Takashi Murakami"],
    year: "2026",
    manufacturer: "Bowman",
    setName: "Bowman",
    insertName: "Anime",
    parallelName: "Anime Red Refractors",
    parallelIsRole: true,
    sport: "Baseball",
  };

  test("Anime + Anime Red Refractors reads Anime Red Refractors", () => {
    expect(titleDescription(BOWMAN)).toBe("2026 Bowman Anime Red Refractors");
    expect(assessListingTitle(BOWMAN).title.startsWith("2026 Bowman Anime Insert Red Refractors Parallel")).toBe(true);
  });

  test("TRItanium Prismatic White + TRItanium Red Flood reads TRItanium Prismatic White Red Flood", () => {
    expect(
      titleDescription({
        ...BOWMAN,
        year: "2025",
        manufacturer: "Topps",
        setName: "Topps Chrome",
        insertName: "TRItanium Prismatic White",
        parallelName: "TRItanium Red Flood",
      }),
    ).toBe("2025 Topps Chrome TRItanium Prismatic White Red Flood");
  });

  test("a parallel that is all insert words is not said again", () => {
    expect(titleDescription({ ...BOWMAN, parallelName: "Anime" })).toBe("2026 Bowman Anime");
  });

  test("the long description keeps the parallel's full name and says the insert once", () => {
    const lines = generateListingDescription(BOWMAN).split("\n");
    expect(lines[0]).toBe("2026 Bowman Anime Red Refractors card of Takashi Murakami, #BA-3.");
    expect(lines).toContain("Insert: Anime.");
    expect(lines).toContain("Parallel: Anime Red Refractors.");
  });

  test("a parallel named exactly as its insert opens the description once", () => {
    const lines = generateListingDescription({ ...BOWMAN, parallelName: "Anime" }).split("\n");
    expect(lines[0]).toBe("2026 Bowman Anime card of Takashi Murakami, #BA-3.");
    expect(lines).toContain("Insert: Anime.");
    expect(lines).toContain("Parallel: Anime.");
  });

  test("a parallel that only shares a leading word keeps both names whole", () => {
    const lines = generateListingDescription({
      ...BOWMAN,
      insertName: "Gold Prospects",
      parallelName: "Gold Refractor",
    }).split("\n");
    expect(lines[0]).toBe(
      "2026 Bowman Gold Prospects Gold Refractor card of Takashi Murakami, #BA-3.",
    );
    expect(lines).toContain("Insert: Gold Prospects.");
    expect(lines).toContain("Parallel: Gold Refractor.");
  });

  test("the long description keeps TRItanium's full parallel name too", () => {
    const text = generateListingDescription({
      ...BOWMAN,
      year: "2025",
      manufacturer: "Topps",
      setName: "Topps Chrome",
      insertName: "TRItanium Prismatic White",
      parallelName: "TRItanium Red Flood",
    });
    expect(text.split("\n")[0]).toBe(
      "2025 Topps Chrome TRItanium Prismatic White TRItanium Red Flood card of Takashi Murakami, #BA-3.",
    );
    expect(text).toContain("Parallel: TRItanium Red Flood.");
  });

  test("a parallel that shares no leading word is untouched", () => {
    expect(titleDescription({ ...BOWMAN, parallelName: "Red Refractors" })).toBe(
      "2026 Bowman Anime Red Refractors",
    );
    expect(titleDescription({ ...BOWMAN, parallelName: "Red Anime Refractors" })).toBe(
      "2026 Bowman Anime Red Anime Refractors",
    );
  });
});

describe("NEO-528 — the description names the card's cameos", () => {
  const profiles = {
    cardNumber: "TP-1",
    year: "2026",
    manufacturer: "Topps",
    setName: "Profiles",
    playerNames: ["Shohei Ohtani"],
    teamNames: ["Los Angeles Dodgers"],
  };

  test("one cameo: its own line, right after the team, without a doubled full stop", () => {
    expect(generateListingDescription(profiles, { cameoNames: ["Ken Griffey Jr."] })).toBe(
      "2026 Topps Profiles card of Shohei Ohtani, #TP-1.\nTeam: Los Angeles Dodgers.\nCameo: Ken Griffey Jr.",
    );
  });

  test("several cameos: plural, in the order given", () => {
    const desc = generateListingDescription(
      { ...profiles, isRookie: true },
      { cameoNames: ["Mookie Betts", "Freddie Freeman"] },
    );
    // NEO-535's line order: the RC line comes before the team.
    expect(desc.split("\n")).toEqual([
      "2026 Topps Profiles card of Shohei Ohtani, #TP-1.",
      "Rookie Card (RC).",
      "Team: Los Angeles Dodgers.",
      "Cameos: Mookie Betts, Freddie Freeman.",
    ]);
  });

  test("none (absent, empty or blank names): no cameo line, the description unchanged", () => {
    const plain = generateListingDescription(profiles);
    expect(plain).not.toMatch(/Cameo/);
    expect(generateListingDescription(profiles, { cameoNames: [] })).toBe(plain);
    expect(generateListingDescription(profiles, { cameoNames: ["  "] })).toBe(plain);
  });

  test("a card with no team still states its cameo after the identity line", () => {
    expect(
      generateListingDescription({ ...profiles, teamNames: [] }, { cameoNames: ["Ken Griffey Jr."] }),
    ).toBe("2026 Topps Profiles card of Shohei Ohtani, #TP-1.\nCameo: Ken Griffey Jr.");
  });

  test("a description with a cameo line still reads as the builder's (Regenerate rebuilds it)", () => {
    const one = generateListingDescription(profiles, { cameoNames: ["Ken Griffey Jr."] });
    const two = generateListingDescription(profiles, { cameoNames: ["Mookie Betts", "Freddie Freeman"] });
    expect(readsAsGeneratedDescription(one)).toBe(true);
    expect(readsAsGeneratedDescription(two)).toBe(true);
  });

  test("the title never names a cameo: it takes no cameo argument at all", () => {
    expect(generateListingTitle.length).toBe(1);
    expect(assessListingTitle.length).toBe(1);
  });
});

describe("NEO-528 + NEO-535 — cameos in the title: named while there is room, dropped first", () => {
  // Jason: "secondary names should be dropped before we drop anything else
  // with meaning". Only the no-loss cuts (a repeated AUTO/RC/RELIC, the
  // "Insert" / "Parallel" labels) and the "#" at exactly 81 go before them.
  const base: ListingCardInputs = {
    cardNumber: "17",
    year: "2024",
    manufacturer: "Topps",
    setName: "Chrome",
    playerNames: ["Shohei Ohtani"],
    teamNames: ["Los Angeles Dodgers"],
    isRookie: true,
    sport: "Baseball",
  };
  const plain = assessListingTitle(base);
  /** A two-word name exactly `length` characters long. */
  const nameOf = (length: number, first = "Ken") => `${first} ${"G".repeat(length - first.length - 1)}`;

  test("the baseline card fits with every token, so any loss below is the cameo's", () => {
    expect(plain.fits).toBe(true);
    expect(plain.dropped).toEqual([]);
    expect(plain.title).toContain("Baseball");
    expect(plain.title).toContain("Shohei Ohtani #17");
  });

  test("a title that fits with its cameo keeps it, after the card's own player", () => {
    const a = assessListingTitle({ ...base, cameoNames: ["Ken Griffey Jr."], teamNames: [], sport: undefined });
    expect(a.title).toBe("2024 Topps Chrome Shohei Ohtani & Ken Griffey Jr. #17 RC Rookie");
    expect(a.fits).toBe(true);
    expect(a.dropped).toEqual([]);
    expect(a.coreFits).toBe(true);
  });

  test("over the limit with a cameo: the cameo goes first and everything else stays", () => {
    const cameo = nameOf(80 - plain.title.length);
    const a = assessListingTitle({ ...base, cameoNames: [cameo] });
    // Over the cap with it: plain + " & " + the name is 83 characters.
    expect(plain.title.length + 3 + cameo.length).toBeGreaterThan(81);
    expect(a.title).toBe(plain.title);
    expect(a.fits).toBe(true);
    expect(a.dropped).toEqual([cameo]);
    // Losing a cameo is not a first-name loss: the card is not flagged.
    expect(a.firstNameLost).toBe(false);
    expect(a.coreFits).toBe(true);
  });

  test("the cameo goes before the sport, a team, the number and a first name", () => {
    // A cameo long enough that the sport alone would have made room for it.
    const cameo = nameOf("Baseball".length - 3 + 80 - plain.title.length);
    const a = assessListingTitle({ ...base, cameoNames: [cameo] });
    expect(a.title).toContain("Baseball");
    expect(a.title).toContain("Los Angeles Dodgers");
    expect(a.title).toContain("Shohei Ohtani #17");
    expect(a.title).not.toContain(cameo);
  });

  test("several cameos: the last goes first, and one that still fits stays", () => {
    const first = "Ken Griffey Jr.";
    const last = nameOf(30, "Zed");
    const a = assessListingTitle({ ...base, sport: undefined, teamNames: [], cameoNames: [first, last] });
    expect(a.title).toContain(`Shohei Ohtani & ${first} #17`);
    expect(a.title).not.toContain(last);
    expect(a.dropped).toEqual([last]);
  });

  test("the no-loss cuts go before a cameo: the Parallel label, then the cameo keeps its place", () => {
    const card: ListingCardInputs = {
      ...base,
      teamNames: [],
      sport: undefined,
      parallelName: "Gold Refractor",
      parallelIsRole: true,
    };
    const labelled = assessListingTitle(card).title;
    expect(labelled).toContain("Gold Refractor Parallel");
    // Exactly the label's room over the cap: the label goes, the cameo stays.
    const cameo = nameOf(80 - labelled.length - 3 + " Parallel".length);
    const a = assessListingTitle({ ...card, cameoNames: [cameo] });
    expect(a.title).not.toContain("Parallel");
    expect(a.title).toContain(`Shohei Ohtani & ${cameo} #17`);
    expect(a.fits).toBe(true);
  });

  test("at exactly 81 with a cameo the \"#\" alone goes, and the cameo stays", () => {
    const card = { ...base, teamNames: [] };
    const short = assessListingTitle(card).title;
    const cameo = nameOf(81 - short.length - 3);
    expect(cameo.length).toBeGreaterThan(10);
    const a = assessListingTitle({ ...card, cameoNames: [cameo] });
    expect(a.title).toBe(short.replace("Shohei Ohtani #17", `Shohei Ohtani & ${cameo} 17`));
    expect(a.title.length).toBe(80);
  });

  test("a cameo who is also the card's player is said once", () => {
    const a = assessListingTitle({ ...base, cameoNames: ["shohei ohtani"] });
    expect(a.title).toBe(plain.title);
    expect(a.dropped).toEqual([]);
  });

  test("the description still names a cameo the title had to drop", () => {
    const cameo = nameOf(80 - plain.title.length);
    const inputs = { ...base, cameoNames: [cameo] };
    expect(assessListingTitle(inputs).title).not.toContain(cameo);
    expect(generateListingDescription(inputs).split("\n")).toContain(`Cameo: ${cameo}.`);
  });
});
