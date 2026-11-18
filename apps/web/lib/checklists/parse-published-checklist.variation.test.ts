/**
 * NEO-591: a published checklist's variation note is kept as the row's
 * `variationName`. The note is read from the text the cleaners already drop
 * and nothing they drop changes; a team bracket or "RC" is no variation.
 */
import { describe, expect, it } from "vitest";
import { checklistSections } from "./checklist-sections";
import {
  MAX_VARIATION_NAME,
  parsePublishedChecklist,
  parsePublishedChecklistCells,
  variationNameOf,
  type ChecklistCellRecord,
} from "./parse-published-checklist";

const line = (text: string) => parsePublishedChecklist(text).rows[0];

describe("variationNameOf: the note shapes", () => {
  it.each([
    ["Mike Trout (photo variation)", "photo variation"],
    ["Mike Trout (Photo Variation)", "Photo Variation"],
    ["Mike Trout [VAR Throwback]", "Throwback"],
    ["Mike Trout {Image Variation}", "Image Variation"],
    ["Mike Trout [SP - Image Variation]", "SP - Image Variation"],
    ["Mike Trout (SSP Photo Variation)", "SSP Photo Variation"],
    ["Mike Trout (Short Print)", "Short Print"],
    ["Mike Trout (var. Throwback)", "Throwback"],
    ["Mike Trout (Variation: Team Logo)", "Variation: Team Logo"],
    ["Mike Trout (image)", "image"],
  ])("%s -> %s", (text, name) => {
    expect(variationNameOf(text)).toBe(name);
  });

  it("a bare VAR token, or a note of only VAR, is named Variation", () => {
    expect(variationNameOf("Aaron Judge VAR")).toBe("Variation");
    expect(variationNameOf("Aaron Judge [VAR]")).toBe("Variation");
    expect(variationNameOf("Aaron Judge (VAR.)")).toBe("Variation");
  });

  it("a note that says what it shows wins over a bare SP/SSP note, and the first such note wins", () => {
    expect(variationNameOf("Judge (SP) (Photo Variation)")).toBe("Photo Variation");
    // NEO-591 (collector 10): a note of only SP / SSP counts a print run and names nothing.
    expect(variationNameOf("Judge (SP) [SSP]")).toBeUndefined();
    expect(variationNameOf("Judge (Photo Variation) [VAR Throwback]")).toBe("Photo Variation");
  });

  it("a bracket's VAR token beats nothing and is not read twice", () => {
    expect(variationNameOf("Judge [VAR Throwback] VAR")).toBe("Throwback");
  });

  it("is not set by a team bracket, RC, a hobby marker token, or a name that holds the letters", () => {
    for (const text of [
      "Mike Trout (A)",
      "New York (N)",
      "Mike Trout (RC)",
      "Mike Trout [RC] (Future Stars)",
      "Mike Trout (Prospect)",
      "Mike Trout SP",
      "Mike Trout SSP",
      "Spencer Strider",
      "Marcus Arcos",
      "Austin Riley (Imagery)",
      "Team Photo",
      "Mike Trout",
      "",
    ]) {
      expect(variationNameOf(text), text).toBeUndefined();
    }
  });

  it("an unclosed bracket is no note", () => {
    expect(variationNameOf("Mike Trout (photo variation")).toBeUndefined();
  });
});

describe("variationNameOf: bounds", () => {
  it("holds a name to the cap and never ends on a half surrogate pair", () => {
    const long = `(Photo Variation ${"x".repeat(200)})`;
    const name = variationNameOf(`Mike Trout ${long}`)!;
    expect(name.length).toBeLessThanOrEqual(MAX_VARIATION_NAME);
    expect(name.startsWith("Photo Variation xxx")).toBe(true);

    // An emoji (two code units) straddling the cut is dropped whole.
    const edge = `(Photo ${"x".repeat(MAX_VARIATION_NAME - 8)}\u{1F600}\u{1F600})`;
    const cut = variationNameOf(edge)!;
    expect(cut.length).toBeLessThanOrEqual(MAX_VARIATION_NAME);
    expect(/[\ud800-\udbff]$/.test(cut)).toBe(false);
  });

  it("keeps a name of exactly the cap", () => {
    const exact = `Photo ${"x".repeat(MAX_VARIATION_NAME - 6)}`;
    expect(exact).toHaveLength(MAX_VARIATION_NAME);
    expect(variationNameOf(`(${exact})`)).toBe(exact);
  });

  it("carries no control characters", () => {
    const name = variationNameOf("Judge (Photo\u0000\u0007 Varia\u0001tion\u009f\ttwo)")!;
    // eslint-disable-next-line no-control-regex
    expect(/[\u0000-\u001f\u007f-\u009f]/.test(name)).toBe(false);
    expect(name).toBe("Photo Varia tion two");
  });

  it("a note that is only SP / SSP sets no variation name, alone or beside a real one", () => {
    for (const text of ["Judge (SP)", "Judge [SSP]", "Judge {SP, SSP}", "Judge (sp)"]) {
      expect(variationNameOf(text), text).toBeUndefined();
    }
    expect(variationNameOf("Judge (SP) [Photo Variation]")).toBe("Photo Variation");
    expect(variationNameOf("Judge (SP - Image Variation)")).toBe("SP - Image Variation");
  });

  it("strips bidi and format characters and line / paragraph separators", () => {
    const name = variationNameOf(
      "Judge (Photo\u202e Varia\u200ftion\u2066 x\u2069\u2028two\u2029 \u200e\u202a\u202b\u202c\u202d)",
    )!;
    expect(/[\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/.test(name)).toBe(false);
    expect(name).toBe("Photo Varia tion x two");
  });

  it("looks at only the first few bracket groups", () => {
    const text = `${"(RC) ".repeat(50)}(Photo Variation)`;
    expect(variationNameOf(text)).toBeUndefined();
  });
});

describe("parsePublishedChecklist: lines carry variationName without changing the rest", () => {
  it("(photo variation) after the player", () => {
    expect(line("38b Mike Trout (photo variation) - Los Angeles Angels")).toEqual({
      number: "38b",
      players: ["Mike Trout"],
      teams: ["Los Angeles Angels"],
      variationName: "photo variation",
    });
  });

  it("[VAR Throwback] and a bare VAR token", () => {
    expect(line("38b Mike Trout [VAR Throwback] - Los Angeles Angels")).toEqual({
      number: "38b",
      players: ["Mike Trout"],
      teams: ["Los Angeles Angels"],
      variationName: "Throwback",
    });
    expect(line("3 Aaron Judge VAR - New York Yankees")).toEqual({
      number: "3",
      players: ["Aaron Judge"],
      teams: ["New York Yankees"],
      variationName: "Variation",
    });
  });

  it("a note after the team, and a note inside the team part", () => {
    expect(line("38b Mike Trout - Los Angeles Angels [SP - Image Variation]")).toEqual({
      number: "38b",
      players: ["Mike Trout"],
      teams: ["Los Angeles Angels"],
      variationName: "SP - Image Variation",
    });
    expect(line("38b Mike Trout - Los Angeles Angels (Photo Variation)").variationName).toBe("Photo Variation");
  });

  it("a team bracket, RC and a bare SP set no name and the row is as before", () => {
    expect(line("38 Mike Trout (RC) - Los Angeles Angels")).toEqual({
      number: "38",
      players: ["Mike Trout"],
      teams: ["Los Angeles Angels"],
    });
    expect(line("39 Mike Trout - Seattle (A) (RC)")).toEqual({
      number: "39",
      players: ["Mike Trout"],
      teams: ["Seattle"],
    });
    expect(line("40 Mike Trout SP - Los Angeles Angels")).toEqual({
      number: "40",
      players: ["Mike Trout"],
      teams: ["Los Angeles Angels"],
    });
  });

  it("names, teams and numbers come out the same as with no note", () => {
    const plain = line("38b Mike Trout - Los Angeles Angels");
    const noted = line("38b Mike Trout (Photo Variation) [VAR] - Los Angeles Angels {RC}");
    const { variationName, ...rest } = noted;
    expect(variationName).toBe("Photo Variation");
    expect(rest).toEqual(plain);
  });
});

describe("parsePublishedChecklist: delimited files", () => {
  it("reads the note from a player cell and from a team cell", () => {
    const out = parsePublishedChecklist(
      [
        "Number,Player,Team",
        '38b,"Mike Trout (Photo Variation)",Angels',
        '39,Aaron Judge,"Yankees [VAR Throwback]"',
        "40,Juan Soto (RC),Mets",
        "41,Pete Alonso,Mets",
      ].join("\n"),
    );
    expect(out.rows).toEqual([
      { number: "38b", players: ["Mike Trout"], teams: ["Angels"], variationName: "Photo Variation" },
      { number: "39", players: ["Aaron Judge"], teams: ["Yankees"], variationName: "Throwback" },
      { number: "40", players: ["Juan Soto"], teams: ["Mets"] },
      { number: "41", players: ["Pete Alonso"], teams: ["Mets"] },
    ]);
  });

  it("never reads the number cell", () => {
    const out = parsePublishedChecklist(["Number,Player", "VAR,Mike Trout", "1,Aaron Judge"].join("\n"));
    expect(out.rows.every((r) => r.variationName === undefined)).toBe(true);
  });

  it("reads a Last Name / First Name pair", () => {
    const records: ChecklistCellRecord[] = [
      { line: 1, cells: ["Last Name", "First Name", "Team"] },
      { line: 2, cells: ["Trout (Photo Variation)", "Mike", "Angels"] },
      { line: 3, cells: ["Judge", "Aaron", "Yankees"] },
    ];
    const out = parsePublishedChecklistCells({ format: "xlsx", records });
    expect(out.rows).toEqual([
      {
        number: "NNO",
        players: ["Mike Trout"],
        teams: ["Angels"],
        noNumber: true,
        variationName: "Photo Variation",
      },
      { number: "NNO", players: ["Aaron Judge"], teams: ["Yankees"], noNumber: true },
    ]);
  });

  it("a section heading that says variations is not a note", () => {
    const out = parsePublishedChecklist(
      ["Card Set,Number,Player", "BASE CARDS IMAGE VARIATIONS,1,Mike Trout"].join("\n"),
    );
    expect(out.rows[0].variationName).toBeUndefined();
    expect(out.rows[0].subset).toBe("BASE CARDS IMAGE VARIATIONS");
  });
});

describe("set mode keeps variationName on a section's rows", () => {
  it("carries the name through checklistSections and leaves a row without one alone", () => {
    const parse = parsePublishedChecklist(
      [
        "Card Set,Number,Player,Team",
        'Base,38,Mike Trout,Angels',
        'Base,38b,"Mike Trout (Photo Variation)",Angels',
        "Base,39,Aaron Judge (RC),Yankees",
      ].join("\n"),
      { mode: "set" },
    );
    const out = checklistSections(parse);
    expect(out.sections.flatMap((s) => s.rows)).toEqual([
      { number: "38", players: ["Mike Trout"], teams: ["Angels"] },
      { number: "38b", players: ["Mike Trout"], teams: ["Angels"], variationName: "Photo Variation" },
      { number: "39", players: ["Aaron Judge"], teams: ["Yankees"] },
    ]);
  });
});
