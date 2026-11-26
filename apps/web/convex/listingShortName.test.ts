/**
 * NEO-335 — the short-name rule and the chain's title facts, as pure
 * functions. The doors that call them are pinned in
 * `setSelectorOptionListingShortName.test.ts` and
 * `commitCardChecklist.listingShortName.test.ts`.
 */

import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import {
  MAX_LISTING_SHORT_NAME_LENGTH,
  normalizeListingShortName,
  parallelAfterInsert,
  parallelsNameThemselvesApplies,
  roughlySays,
  titleChainFacts,
  type TitleChainRow,
} from "./listingShortName";

describe("normalizeListingShortName", () => {
  test("trims", () => {
    expect(normalizeListingShortName("  Upper Deck Hologram ")).toBe("Upper Deck Hologram");
  });

  test("blank and whitespace-only are no short name", () => {
    expect(normalizeListingShortName("")).toBeUndefined();
    expect(normalizeListingShortName(" \t ")).toBeUndefined();
  });

  test("the cap is inclusive", () => {
    const atCap = "s".repeat(MAX_LISTING_SHORT_NAME_LENGTH);
    // NEO-535: raised from 60, the box holds the whole set description.
    expect(MAX_LISTING_SHORT_NAME_LENGTH).toBe(80);
    expect(normalizeListingShortName(atCap)).toBe(atCap);
    expect(() => normalizeListingShortName(`${atCap}s`)).toThrow(ConvexError);
    expect(() => normalizeListingShortName(`${atCap}s`)).toThrow(
      "Set name in titles tops out at 80 characters.",
    );
  });

  test("a cap is measured after the trim", () => {
    const atCap = "s".repeat(MAX_LISTING_SHORT_NAME_LENGTH);
    expect(normalizeListingShortName(`  ${atCap}  `)).toBe(atCap);
  });

  test.each([
    ["a newline", "Upper\nDeck"],
    ["a tab inside", "Upper\tDeck"],
    ["DEL", "Upper\u007FDeck"],
    ["a C1 control (NEL)", "Upper\u0085Deck"],
    ["a line separator", "Upper\u2028Deck"],
    ["a paragraph separator", "Upper\u2029Deck"],
  ])("refuses %s", (_label, raw) => {
    expect(() => normalizeListingShortName(raw)).toThrow(/line breaks or control characters/);
  });

  test.each([
    ["a zero-width space", "Upper\u200BDeck"],
    ["a word joiner", "Upper\u2060Deck"],
    ["a BOM", "Upper\uFEFFDeck"],
    ["a right-to-left override", "Upper\u202EDeck"],
    ["a bidi isolate", "Upper\u2066Deck"],
    ["a left-to-right mark", "Upper\u200EDeck"],
    ["a soft hyphen", "Upper\u00ADDeck"],
    ["an Arabic letter mark", "Upper\u061CDeck"],
    ["a tag character", "Upper\u{E0041}Deck"],
  ])("refuses %s", (_label, raw) => {
    expect(() => normalizeListingShortName(raw)).toThrow(/zero-width or invisible/);
  });
});

/** Rows LEAF FIRST, as every walk hands them over. */
function row(
  level: string,
  value: string,
  metadata?: TitleChainRow["metadata"],
): TitleChainRow {
  return { level, value, ...(metadata ? { metadata } : {}) };
}

describe("titleChainFacts", () => {
  // NEO-334: a row's role is its level plus its variant type's KIND, and the
  // kind is the variant type's title (`variantTypeKind`). No flag is read.
  test("an insert-level row under an Insert type puts its name in", () => {
    for (const title of ["Inserts", "Insert", "  inserts "]) {
      expect(
        titleChainFacts([
          row("insert", "Dugout Collection"),
          row("variantType", title),
          row("setName", "Score"),
        ]),
      ).toEqual({
        insertNameValue: "Dugout Collection",
        insertIsRole: true,
        // NEO-609: every level is named with its type's row title, as stored.
        titleLevels: [{ name: "Dugout Collection", typeName: title.trim() }],
      });
    }
  });

  test("an insert-level row under a type with no kind is no insert role, but it is still a level the title names (NEO-609)", () => {
    // The ROLE facts (the eBay aspects read them) stay gated on the kind.
    for (const title of ["Insert Set", "Promo", "Inserts & Autographs"]) {
      const facts = titleChainFacts([
        row("insert", "Dugout Collection"),
        row("variantType", title),
        row("setName", "Score"),
      ]);
      expect(facts).toEqual({ titleLevels: [{ name: "Dugout Collection", typeName: title }] });
      expect(facts.insertNameValue).toBeUndefined();
      expect(facts.insertIsRole).toBeUndefined();
    }
    // The insert's OWN name is never the role.
    expect(
      titleChainFacts([
        row("insert", "Inserts"),
        row("variantType", "Promo"),
        row("setName", "Score"),
      ]),
    ).toEqual({ titleLevels: [{ name: "Inserts", typeName: "Promo" }] });
    // No variant type in the chain: no kind, no role, no type name.
    expect(
      titleChainFacts([row("insert", "Dugout Collection"), row("setName", "Score")]),
    ).toEqual({ titleLevels: [{ name: "Dugout Collection" }] });
  });

  test("a stored retired flag is ignored: the title decides", () => {
    const stale = { isInsert: true, isParallel: true } as unknown as TitleChainRow["metadata"];
    expect(
      titleChainFacts([
        row("insert", "Dugout Collection", stale),
        row("variantType", "Promo"),
        row("setName", "Score"),
      ]),
    ).toEqual({ titleLevels: [{ name: "Dugout Collection", typeName: "Promo" }] });
  });

  test("an insert-level row under a Parallel type is a parallel, not an insert", () => {
    expect(
      titleChainFacts([
        row("insert", "Artist's Proof"),
        row("variantType", "Parallels"),
        row("setName", "Score"),
      ]),
    ).toEqual({
      parallelLeafValue: "Artist's Proof",
      titleLevels: [{ name: "Artist's Proof", typeName: "Parallels" }],
    });
  });

  test("a parallel leaf under an insert: both the insert and the leaf", () => {
    expect(
      titleChainFacts([
        row("parallel", "Artist's Proof"),
        row("insert", "Dugout Collection"),
        row("variantType", "Inserts"),
        row("setName", "Score"),
      ]),
    ).toEqual({
      insertNameValue: "Dugout Collection",
      insertIsRole: true,
      parallelLeafValue: "Artist's Proof",
      // Top level first; a sub-variant has no type row, so it is a "Parallel".
      titleLevels: [
        { name: "Dugout Collection", typeName: "Inserts" },
        { name: "Artist's Proof", typeName: "Parallel" },
      ],
    });
  });

  test("the parallel role counts on the LEAF only", () => {
    // Refractor is a parallel of base (insert-level under Parallels) but not
    // the leaf: it is neither the insert name nor the parallel token.
    expect(
      titleChainFacts([
        row("parallel", "Gold"),
        row("insert", "Refractor"),
        row("variantType", "Parallels"),
        row("setName", "Chrome"),
      ]),
    ).toEqual({
      parallelLeafValue: "Gold",
      // Both are levels the title names (NEO-609); only the leaf is the role.
      titleLevels: [
        { name: "Refractor", typeName: "Parallels" },
        { name: "Gold", typeName: "Parallel" },
      ],
    });
    // A variant type is never a parallel leaf, whatever its title.
    expect(
      titleChainFacts([row("variantType", "Parallels"), row("setName", "Chrome")]).parallelLeafValue,
    ).toBeUndefined();
  });

  test("the NEAREST short name wins, self first", () => {
    expect(
      titleChainFacts([
        row("insert", "Hologram", { listingShortName: "UD Hologram" }),
        row("variantType", "Inserts"),
        row("setName", "Collector's Choice", { listingShortName: "UD Choice" }),
      ]).listingShortName,
    ).toBe("UD Hologram");
    // NEO-535: a value stored above the insert row covers the set, so the
    // insert's name is appended (trimmed value, verbatim name).
    expect(
      titleChainFacts([
        row("insert", "Hologram"),
        row("variantType", "Inserts"),
        row("setName", "Collector's Choice", { listingShortName: " UD Choice " }),
      ]).listingShortName,
    ).toBe("UD Choice Hologram");
  });

  test("nothing past the setName row is read", () => {
    expect(
      titleChainFacts([
        row("variantType", "Base"),
        row("setName", "Score"),
        row("manufacturer", "Score", { listingShortName: "Nope" }),
        row("insert", "Stray"),
        row("variantType", "Inserts"),
      ]),
    ).toEqual({ titleLevels: [{ name: "Base", base: true }] });
    // A variant type past the setName row confers no kind, and no type name.
    expect(
      titleChainFacts([
        row("insert", "Stray"),
        row("setName", "Score"),
        row("variantType", "Inserts"),
      ]),
    ).toEqual({ titleLevels: [{ name: "Stray" }] });
  });

  test("the first (nearest) insert-level row is the one named", () => {
    expect(
      titleChainFacts([
        row("insert", "Child"),
        row("insert", "Parent"),
        row("variantType", "Inserts"),
        row("setName", "Score"),
      ]),
    ).toEqual({
      insertNameValue: "Child",
      insertIsRole: true,
      titleLevels: [
        { name: "Parent", typeName: "Inserts" },
        { name: "Child", typeName: "Inserts" },
      ],
    });
  });

  test("an empty or broken chain says nothing", () => {
    expect(titleChainFacts([])).toEqual({});
    expect(titleChainFacts([null])).toEqual({});
    expect(
      titleChainFacts([row("variantType", "Base"), null, row("setName", "x", { listingShortName: "y" })]),
    ).toEqual({ titleLevels: [{ name: "Base", base: true }] });
    // A break before the variant type: the insert has no kind to read, so no
    // role and no type name.
    expect(
      titleChainFacts([row("insert", "Hologram"), null, row("variantType", "Inserts")]),
    ).toEqual({ titleLevels: [{ name: "Hologram" }] });
  });
});

describe("NEO-535: a name the box already says, in another spelling, is not appended again", () => {
  test("roughlySays folds case, edge punctuation, a plural s and the autograph spellings", () => {
    expect(roughlySays("Metal 1991 Gold Prospect Auto", "1991 Gold Prospects Autographs")).toBe(true);
    expect(roughlySays("Leaf Metal AU", "Autographed")).toBe(true);
    expect(roughlySays("Chrome Refractors,", "refractor")).toBe(true);
    // "ss" and short words keep their s; a missing word is not said.
    expect(roughlySays("Chrome Glass", "Glas")).toBe(false);
    expect(roughlySays("Chrome Bu", "Bus")).toBe(false);
    expect(roughlySays("Metal 1991 Gold Prospect", "1991 Gold Prospects Autographs")).toBe(false);
    expect(roughlySays("anything", "  ")).toBe(false);
  });

  test("an insert the box says in a shortened spelling is not appended", () => {
    const chain = (box: string) => [
      row("insert", "1991 Gold Prospects Autographs"),
      row("variantType", "Insert"),
      row("setName", "Leaf Metal", { listingShortName: box }),
    ];
    expect(titleChainFacts(chain("2026 Leaf Metal 1991 Gold Prospect Auto")).listingShortName).toBe(
      "2026 Leaf Metal 1991 Gold Prospect Auto",
    );
    expect(titleChainFacts(chain("2026 Leaf Metal")).listingShortName).toBe(
      "2026 Leaf Metal 1991 Gold Prospects Autographs",
    );
  });

  test("a parallel the box says in a plural is not appended", () => {
    const chain = (box: string) => [
      row("parallel", "Prismatic"),
      row("insert", "Gold Prospects"),
      row("variantType", "Insert"),
      row("setName", "Leaf Metal"),
    ].map((r, i) => (i === 1 ? { ...r, metadata: { listingShortName: box } } : r));
    expect(titleChainFacts(chain("2026 Leaf Metal Gold Prospects Prismatics")).listingShortName).toBe(
      "2026 Leaf Metal Gold Prospects Prismatics",
    );
    expect(titleChainFacts(chain("2026 Leaf Metal Gold Prospects")).listingShortName).toBe(
      "2026 Leaf Metal Gold Prospects Prismatic",
    );
  });
});

describe("parallelAfterInsert (NEO-535: the insert's words said once)", () => {
  test("the leading run the parallel shares with its insert goes", () => {
    expect(parallelAfterInsert("Anime Red Refractors", "Anime")).toBe("Red Refractors");
    expect(parallelAfterInsert("TRItanium Red Flood", "TRItanium Prismatic White")).toBe("Red Flood");
    expect(parallelAfterInsert("anime  RED Refractors", "ANIME")).toBe("RED Refractors");
  });

  test("folded as roughlySays folds: plural and autograph spellings", () => {
    expect(parallelAfterInsert("Gold Prospect Auto Orange", "Gold Prospects Autographs")).toBe("Orange");
  });

  test("only a leading run: a shared word later in the name stays", () => {
    expect(parallelAfterInsert("Red Anime Refractors", "Anime")).toBe("Red Anime Refractors");
    expect(parallelAfterInsert("Gold Refractor", "Chrome Gold")).toBe("Gold Refractor");
  });

  test("a parallel that is all insert words leaves nothing; no insert leaves it whole", () => {
    expect(parallelAfterInsert("Anime", "Anime")).toBe("");
    expect(parallelAfterInsert("Anime Red", undefined)).toBe("Anime Red");
    expect(parallelAfterInsert("Anime Red", "")).toBe("Anime Red");
  });

  test("a box stored above the parallel appends only the parallel's own words", () => {
    const chain = [
      row("parallel", "Anime Red Refractors"),
      row("insert", "Anime"),
      row("variantType", "Inserts"),
      row("setName", "Bowman", { listingShortName: "Bowman" }),
    ];
    expect(titleChainFacts(chain).listingShortName).toBe("Bowman Anime Red Refractors");
    // Stored ON the insert row: the parallel's own words follow it.
    expect(
      titleChainFacts([
        row("parallel", "Anime Red Refractors"),
        row("insert", "Anime", { listingShortName: "Bowman Anime" }),
        row("variantType", "Inserts"),
        row("setName", "Bowman"),
      ]).listingShortName,
    ).toBe("Bowman Anime Red Refractors");
  });

  test("a parallel that is all insert words leaves a stored box unchanged", () => {
    const facts = titleChainFacts([
      row("parallel", "Anime"),
      row("insert", "Anime"),
      row("variantType", "Inserts"),
      row("setName", "Bowman", { listingShortName: "Bowman Anime" }),
    ]);
    expect(facts.listingShortName).toBe("Bowman Anime");
  });

  test("an insert that is not a role leaves the parallel appended whole", () => {
    const facts = titleChainFacts([
      row("parallel", "Anime Red Refractors"),
      row("insert", "Anime"),
      row("variantType", "Parallels"),
      row("setName", "Bowman", { listingShortName: "Bowman" }),
    ]);
    expect(facts.insertIsRole).toBeUndefined();
    expect(facts.listingShortName).toBe("Bowman Anime Red Refractors");
  });
});

/**
 * NEO-619 — "Parallels name themselves" on an insert-role row. Invented words
 * throughout: "Zorbo Special Purple" is the insert, "Zorbo Special Gold" a
 * parallel of it. The reader of the switch is `titleChainFacts`; the eBay
 * reader asks `parallelsNameThemselvesApplies` (pinned in listingDrainEbay).
 */
describe("NEO-619: parallels name themselves", () => {
  const INSERT = "Zorbo Special Purple";
  const GOLD = "Zorbo Special Gold";
  const ON = { parallelsNameThemselves: true } as const;

  /** Gold under the insert, under an Insert type, under the set. */
  const goldChain = (
    insertMeta?: TitleChainRow["metadata"],
    opts: { goldMeta?: TitleChainRow["metadata"]; setMeta?: TitleChainRow["metadata"]; type?: string } = {},
  ) => [
    row("parallel", GOLD, opts.goldMeta),
    row("insert", INSERT, insertMeta),
    row("variantType", opts.type ?? "Inserts"),
    row("setName", "Pulse", opts.setMeta),
  ];

  test("switch off: both levels are named, the previous behaviour", () => {
    const facts = titleChainFacts(goldChain());
    expect(facts.titleLevels).toEqual([
      { name: INSERT, typeName: "Inserts" },
      { name: GOLD, typeName: "Parallel" },
    ]);
    expect(parallelsNameThemselvesApplies(goldChain())).toBe(false);
    // An explicit false is off too.
    expect(
      titleChainFacts(goldChain({ parallelsNameThemselves: false })).titleLevels,
    ).toHaveLength(2);
  });

  test("switch on: a parallel leaf is the only level, typed Parallel and said whole", () => {
    const chain = goldChain(ON);
    expect(parallelsNameThemselvesApplies(chain)).toBe(true);
    expect(titleChainFacts(chain).titleLevels).toEqual([{ name: GOLD, typeName: "Parallel" }]);
  });

  test("switch on: insertNameValue, insertIsRole and parallelLeafValue are unchanged", () => {
    const on = titleChainFacts(goldChain(ON));
    const off = titleChainFacts(goldChain());
    expect(on.insertNameValue).toBe(INSERT);
    expect(on.insertIsRole).toBe(true);
    expect(on.parallelLeafValue).toBe(GOLD);
    expect(on.insertNameValue).toBe(off.insertNameValue);
    expect(on.insertIsRole).toBe(off.insertIsRole);
    expect(on.parallelLeafValue).toBe(off.parallelLeafValue);
  });

  test("switch on: the insert's own leaf (and a card on it) still names the insert", () => {
    const chain = [
      row("insert", INSERT, ON),
      row("variantType", "Inserts"),
      row("setName", "Pulse"),
    ];
    expect(parallelsNameThemselvesApplies(chain)).toBe(false);
    expect(titleChainFacts(chain)).toEqual({
      insertNameValue: INSERT,
      insertIsRole: true,
      titleLevels: [{ name: INSERT, typeName: "Inserts" }],
    });
  });

  test("switch on: the insert row's own box is skipped, the set's box gets the parallel's name appended whole", () => {
    const facts = titleChainFacts(
      goldChain(
        { ...ON, listingShortName: "Purple Box" },
        { setMeta: { listingShortName: "Pulse Box" } },
      ),
    );
    expect(facts.listingShortName).toBe("Pulse Box Zorbo Special Gold");
    expect(facts.listingShortName).not.toContain("Purple");
  });

  test("switch off: the insert row's box applies, with the parallel's name trimmed to its own words", () => {
    const facts = titleChainFacts(
      goldChain(
        { listingShortName: "Purple Box" },
        { setMeta: { listingShortName: "Pulse Box" } },
      ),
    );
    expect(facts.listingShortName).toMatch(/^Purple Box /);
  });

  test("switch on, no box above: no short name at all", () => {
    expect(
      titleChainFacts(goldChain({ ...ON, listingShortName: "Purple Box" })).listingShortName,
    ).toBeUndefined();
  });

  test("switch on: a box on the parallel row wins verbatim", () => {
    const facts = titleChainFacts(
      goldChain(
        { ...ON, listingShortName: "Purple Box" },
        { goldMeta: { listingShortName: "Gold Box" }, setMeta: { listingShortName: "Pulse Box" } },
      ),
    );
    expect(facts.listingShortName).toBe("Gold Box");
  });

  test("the flag on an insert-level row under a Parallel-kind type does nothing", () => {
    const chain = [
      row("parallel", GOLD),
      row("insert", INSERT, ON),
      row("variantType", "Parallels"),
      row("setName", "Pulse"),
    ];
    expect(parallelsNameThemselvesApplies(chain)).toBe(false);
    expect(titleChainFacts(chain).titleLevels).toEqual([
      { name: INSERT, typeName: "Parallels" },
      { name: GOLD, typeName: "Parallel" },
    ]);
  });

  test("the flag on an insert-level row under a type with no kind does nothing", () => {
    const chain = goldChain(ON, { type: "Promo" });
    expect(parallelsNameThemselvesApplies(chain)).toBe(false);
    expect(titleChainFacts(chain).titleLevels).toEqual([
      { name: INSERT, typeName: "Promo" },
      { name: GOLD, typeName: "Parallel" },
    ]);
  });

  test("the flag on a parallel-level row does nothing", () => {
    const chain = goldChain(undefined, { goldMeta: ON });
    expect(parallelsNameThemselvesApplies(chain)).toBe(false);
    expect(titleChainFacts(chain).titleLevels).toEqual([
      { name: INSERT, typeName: "Inserts" },
      { name: GOLD, typeName: "Parallel" },
    ]);
  });

  test("rows past the setName row are ignored, and a broken chain never applies", () => {
    const stray = [
      row("parallel", GOLD),
      row("variantType", "Inserts"),
      row("setName", "Pulse"),
      row("insert", INSERT, ON),
    ];
    expect(parallelsNameThemselvesApplies(stray)).toBe(false);
    expect(parallelsNameThemselvesApplies([row("parallel", GOLD), null, row("insert", INSERT, ON)])).toBe(false);
    expect(parallelsNameThemselvesApplies([])).toBe(false);
  });
});
