import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MAX_BSC_PRINT_RUN } from "../../convex/lib/bscAttributeTokens";
import { checklistSections } from "./checklist-sections";
import {
  badPrintRunReason,
  foilColourHeader,
  NO_SUBSET_ON_LINE,
  PARALLEL_NAME_TOO_LONG,
  PRINT_RUN_WITHOUT_FOIL,
  printRunClashReason,
} from "./foil-colour-layout";
import {
  ABOVE_THE_HEADER,
  parsePublishedChecklist,
  parsePublishedChecklistCells,
  type ChecklistCellRecord,
  type PublishedChecklistParse,
} from "./parse-published-checklist";

const HEADER = ["Set", "Subset", "Name", "Checklist", "Foil", "RWB", "Silver", "Gold", "MEM", "BASE", "City Designation"];

/** One data line: subset, name, number, foil, then the RWB / Silver / Gold cells and the city. */
function line(
  subset: string,
  name: string,
  number: string,
  foil: string,
  runs: [string, string, string],
  city = "",
): string[] {
  return ["2026 Pro Set Metal Baseball", subset, name, number, foil, ...runs, "No", "Base", city];
}

function csv(rows: string[][], header = HEADER): string {
  const cell = (c: string) => (/[",]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);
  return [header, ...rows].map((r) => r.map(cell).join(",")).join("\n");
}

function tsv(rows: string[][], header = HEADER): string {
  return [header, ...rows].map((r) => r.join("\t")).join("\n");
}

const names = (parse: PublishedChecklistParse) => [...new Set(parse.rows.map((r) => r.subset))];

describe("foilColourHeader (the signature)", () => {
  it("wants Subset, Name, Checklist and Foil plus a heading that is none of the known ones", () => {
    const header = foilColourHeader(HEADER);
    expect(header).toMatchObject({ subset: 1, name: 2, checklist: 3, foil: 4, city: 10 });
    expect(header?.candidates.map((c) => c.label)).toEqual(["RWB", "Silver", "Gold"]);
  });

  it("folds case, dots and spacing in the headings", () => {
    const header = foilColourHeader(["SUBSET", " name ", "Checklist", "FOIL.", "Red", "City  Designation"]);
    expect(header).toMatchObject({ subset: 0, name: 1, checklist: 2, foil: 3, city: 5 });
    expect(header?.candidates).toEqual([{ index: 4, label: "Red" }]);
  });

  it.each([
    ["no Foil heading", ["Subset", "Name", "Checklist", "Red"]],
    ["no Checklist heading", ["Subset", "Name", "Foil", "Red"]],
    ["no Name heading", ["Subset", "Checklist", "Foil", "Red"]],
    ["no Subset heading", ["Name", "Checklist", "Foil", "Red"]],
    ["only the known extras after the foil", ["Set", "Subset", "Name", "Checklist", "Foil", "MEM", "BASE", "City Designation"]],
    ["a generic card-number file", ["Card #", "Player", "Team", "Subset"]],
    ["a plain card line", ["1", "Mike Trout", "Los Angeles Angels"]],
  ])("is not it: %s", (_label, cells) => {
    expect(foilColourHeader(cells)).toBeNull();
  });

  it("is not it when no extra column holds print runs (the data decides)", () => {
    const text = csv(
      [
        ["Base", "Aaron Watson", "1", "Prismatic", "rare", "Cincinnati"],
        ["Base", "Adam Serwinowski", "2", "Prismatic", "common", "Oakland"],
      ],
      ["Subset", "Name", "Checklist", "Foil", "Notes", "City Designation"],
    );
    const parse = parsePublishedChecklist(text);
    expect(parse.subsets).toBeUndefined();
    expect(parse.rows.some((r) => r.printRun !== undefined)).toBe(false);
  });

  it("is not tried when the generic reader finds a header (additive only)", () => {
    // "Checklist #" and "Player" are generic spellings: the old path reads it.
    const text = ["Checklist #,Player,Team,Subset,Foil,Gold", "1,Mike Trout,Los Angeles Angels,Base,Prismatic,5"].join("\n");
    const parse = parsePublishedChecklist(text);
    expect(parse.rows).toEqual([
      { number: "1", players: ["Mike Trout"], teams: ["Los Angeles Angels"], subset: "Base" },
    ]);
  });
});

describe("parsePublishedChecklist: the foil × colour layout", () => {
  const text = csv([
    line("1989 Pro Set Base", "Aaron Watson", "89B-1", "Prismatic", ["6", "10", "1"], "Cincinnati"),
    line("1989 Pro Set Base", "Aaron Watson", "89B-1", "Silver Circles RWB", ["1", "", ""], "Cincinnati"),
    line("1989 Pro Set Base", "Adam Serwinowski", "89B-2", "Prismatic", ["6", "10", "1"], "Los Angeles N"),
    line("1989 Pro Set Base", "Adam Serwinowski", "89B-2", "Silver Circles RWB", ["1", "", ""], "Los Angeles N"),
  ]);

  it("reads each card once per subset, however many foil rows it has", () => {
    const parse = parsePublishedChecklist(text, { mode: "leaf" });
    expect(parse.format).toBe("csv");
    expect(parse.rows).toEqual([
      { number: "89B-1", players: ["Aaron Watson"], teams: ["Cincinnati"], subset: "1989 Pro Set Base" },
      { number: "89B-2", players: ["Adam Serwinowski"], teams: ["Los Angeles N"], subset: "1989 Pro Set Base" },
    ]);
    expect(parse.subsets).toEqual(["1989 Pro Set Base"]);
    expect(parse.skipped).toEqual([]);
  });

  it("makes each foil × colour with a print run a parallel named literally, cards first", () => {
    const parse = parsePublishedChecklist(text, { mode: "set" });
    expect(names(parse)).toEqual([
      "1989 Pro Set Base",
      "1989 Pro Set Base Prismatic RWB",
      "1989 Pro Set Base Prismatic Silver",
      "1989 Pro Set Base Prismatic Gold",
      "1989 Pro Set Base Silver Circles RWB RWB",
    ]);
    expect(parse.subsets).toEqual(names(parse));
    expect(parse.groups).toBeUndefined();
  });

  it("gives each card its own print run from its parallel row, never a plain card", () => {
    const parse = parsePublishedChecklist(text, { mode: "set" });
    const runs = (subset: string) => parse.rows.filter((r) => r.subset === subset).map((r) => [r.number, r.printRun]);
    expect(runs("1989 Pro Set Base")).toEqual([
      ["89B-1", undefined],
      ["89B-2", undefined],
    ]);
    expect(runs("1989 Pro Set Base Prismatic Silver")).toEqual([
      ["89B-1", 10],
      ["89B-2", 10],
    ]);
    expect(runs("1989 Pro Set Base Prismatic Gold")).toEqual([
      ["89B-1", 1],
      ["89B-2", 1],
    ]);
    // A parallel's row carries the card's players and team, and no "/N" in any name.
    expect(parse.rows.find((r) => r.subset === "1989 Pro Set Base Prismatic RWB")).toEqual({
      number: "89B-1",
      players: ["Aaron Watson"],
      teams: ["Cincinnati"],
      printRun: 6,
      subset: "1989 Pro Set Base Prismatic RWB",
    });
    expect(names(parse).some((n) => n?.includes("/"))).toBe(false);
  });

  it("reads a tab-delimited file the same way", () => {
    const fromCsv = parsePublishedChecklist(text, { mode: "set" });
    const tabs = tsv([
      line("1989 Pro Set Base", "Aaron Watson", "89B-1", "Prismatic", ["6", "10", "1"], "Cincinnati"),
      line("1989 Pro Set Base", "Aaron Watson", "89B-1", "Silver Circles RWB", ["1", "", ""], "Cincinnati"),
      line("1989 Pro Set Base", "Adam Serwinowski", "89B-2", "Prismatic", ["6", "10", "1"], "Los Angeles N"),
      line("1989 Pro Set Base", "Adam Serwinowski", "89B-2", "Silver Circles RWB", ["1", "", ""], "Los Angeles N"),
    ]);
    const fromTabs = parsePublishedChecklist(tabs, { mode: "set" });
    expect(fromTabs.format).toBe("tsv");
    expect(fromTabs.rows).toEqual(fromCsv.rows);
    expect(fromTabs.subsets).toEqual(fromCsv.subsets);
  });

  it("reads a spreadsheet's cells the same way", () => {
    const grid = [HEADER, ...text.split("\n").slice(1).map((l) => l.split(","))];
    const records: ChecklistCellRecord[] = grid.map((cells, i) => ({ line: i + 1, cells }));
    const fromCells = parsePublishedChecklistCells({ format: "xlsx", records }, { mode: "set" });
    const fromText = parsePublishedChecklist(text, { mode: "set" });
    expect(fromCells.format).toBe("xlsx");
    expect(fromCells.rows).toEqual(fromText.rows);
    expect(fromCells.subsets).toEqual(fromText.subsets);
    expect(fromCells.skipped).toEqual([]);
  });

  it("finds the spreadsheet header under a title row and skips what sits above it", () => {
    const records: ChecklistCellRecord[] = [
      { line: 1, cells: ["Pro Set Metal checklist"] },
      { line: 2, cells: HEADER },
      { line: 3, cells: line("Base", "Aaron Watson", "1", "Prismatic", ["", "5", ""], "Cincinnati") },
    ];
    const parse = parsePublishedChecklistCells({ format: "xlsx", records }, { mode: "set" });
    expect(parse.skipped).toEqual([
      { line: 1, text: "Pro Set Metal checklist", reason: ABOVE_THE_HEADER },
    ]);
    expect(names(parse)).toEqual(["Base", "Base Prismatic Silver"]);
  });

  it("does not take a PDF's lines for this layout", () => {
    const records: ChecklistCellRecord[] = [
      { line: 1, page: 1, cells: HEADER },
      { line: 2, page: 1, cells: line("Base", "Aaron Watson", "1", "Prismatic", ["", "5", ""]) },
    ];
    const parse = parsePublishedChecklistCells({ format: "pdf", records }, { mode: "set" });
    expect(parse.rows.some((r) => r.printRun !== undefined)).toBe(false);
  });

  it("lines above the header are skipped, and an over-long line is skipped", () => {
    const parse = parsePublishedChecklist(
      ["Pro Set Metal checklist", text, "x".repeat(2500)].join("\n"),
      { mode: "set" },
    );
    expect(parse.skipped.map((s) => s.reason)).toEqual([
      ABOVE_THE_HEADER,
      "Longer than 2,000 characters",
    ]);
    expect(parse.rows.length).toBeGreaterThan(2);
  });
});

describe("cards and teams", () => {
  it("splits a duo's name on ' / ' into two players", () => {
    const parse = parsePublishedChecklist(
      csv([
        line("Dugout Duos", "Carlton Fisk / Harold Baines", "DD-1", "Prismatic", ["", "", "5"]),
        line("Dugout Duos", "Carlton Fisk / Harold Baines", "DD-1", "Super Prismatic Gold", ["", "1", ""]),
      ]),
      { mode: "leaf" },
    );
    expect(parse.rows).toEqual([
      { number: "DD-1", players: ["Carlton Fisk", "Harold Baines"], teams: [], subset: "Dugout Duos" },
    ]);
  });

  it("sends the city as the team cell as printed, and a blank city makes no claim", () => {
    const parse = parsePublishedChecklist(
      csv([
        line("Base", "Adam Serwinowski", "2", "Prismatic", ["", "", "1"], "Los Angeles N"),
        line("Base", "Aaron Watson", "1", "Prismatic", ["", "", "1"], ""),
      ]),
      { mode: "leaf" },
    );
    const [la, blank] = parse.rows;
    expect(la.teams).toEqual(["Los Angeles N"]);
    expect(blank.teams).toEqual([]);
    expect(blank.noTeam).toBeUndefined();
  });

  it("takes a city a later foil row names when the first row left it blank", () => {
    const parse = parsePublishedChecklist(
      csv([
        line("Base", "Aaron Watson", "1", "Prismatic", ["", "", "1"], ""),
        line("Base", "Aaron Watson", "1", "Lazer", ["", "", "1"], "Cincinnati"),
      ]),
      { mode: "leaf" },
    );
    expect(parse.rows).toEqual([
      { number: "1", players: ["Aaron Watson"], teams: ["Cincinnati"], subset: "Base" },
    ]);
  });

  it("keeps two cards that share a number in a subset when their players differ", () => {
    const parse = parsePublishedChecklist(
      csv([
        line("Base", "Aaron Watson", "7", "Prismatic", ["", "", "1"]),
        line("Base", "Adam Serwinowski", "7", "Prismatic", ["", "", "1"]),
        line("Base", "Aaron Watson", "7", "Lazer", ["", "", "1"]),
      ]),
      { mode: "leaf" },
    );
    expect(parse.rows.map((r) => r.players[0])).toEqual(["Aaron Watson", "Adam Serwinowski"]);
  });

  it("keeps a team card (no player) per team when its number repeats", () => {
    const parse = parsePublishedChecklist(
      csv([
        line("Base", "Checklist", "NNO", "Prismatic", ["", "", "1"], "Cincinnati"),
        line("Base", "Checklist", "NNO", "Prismatic", ["", "", "1"], "Oakland"),
      ]),
      { mode: "leaf" },
    );
    expect(parse.rows).toHaveLength(2);
  });

  it("skips a line with no usable number or no subset, with the reason", () => {
    const parse = parsePublishedChecklist(
      csv([
        line("Base", "Aaron Watson", "", "Prismatic", ["", "", "1"]),
        line("", "Adam Serwinowski", "2", "Prismatic", ["", "", "1"]),
        line("Base", "Ok Player", "3", "Prismatic", ["", "", "1"]),
      ]),
      { mode: "set" },
    );
    expect(parse.skipped.map((s) => [s.line, s.reason])).toEqual([
      [2, "No card number"],
      [3, NO_SUBSET_ON_LINE],
    ]);
    expect(parse.rows.filter((r) => r.subset === "Base")).toHaveLength(1);
  });
});

describe("parallel names, order and print runs", () => {
  it("names a parallel from the file's own words, even when they repeat", () => {
    const parse = parsePublishedChecklist(
      csv([
        line("1989 Pro Set Auto", "Aaron Watson", "89A-AW1", "Super Prismatic Gold", ["", "1", ""]),
        line("1989 Pro Set Auto", "Aaron Watson", "89A-AW1", "Silver Circles RWB", ["1", "", ""]),
      ]),
      { mode: "set" },
    );
    expect(names(parse)).toEqual([
      "1989 Pro Set Auto",
      "1989 Pro Set Auto Super Prismatic Gold Silver",
      "1989 Pro Set Auto Silver Circles RWB RWB",
    ]);
  });

  it("orders foils by first appearance, colours by column, and groups parallels by subset", () => {
    const parse = parsePublishedChecklist(
      csv([
        line("B", "P1", "1", "Lazer", ["1", "", "3"]),
        line("A", "P2", "1", "Prismatic", ["", "2", ""]),
        line("B", "P1", "1", "Prismatic", ["4", "5", ""]),
        line("A", "P2", "1", "Lazer", ["6", "", ""]),
      ]),
      { mode: "set" },
    );
    expect(names(parse)).toEqual([
      "B",
      "A",
      "B Lazer RWB",
      "B Lazer Gold",
      "B Prismatic RWB",
      "B Prismatic Silver",
      "A Prismatic Silver",
      "A Lazer RWB",
    ]);
  });

  it("emits every card subset before any parallel", () => {
    const parse = parsePublishedChecklist(
      csv([
        line("A", "P1", "1", "F", ["1", "", ""]),
        line("B", "P2", "1", "F", ["1", "", ""]),
      ]),
      { mode: "set" },
    );
    expect(parse.rows.map((r) => r.subset)).toEqual(["A", "B", "A F RWB", "B F RWB"]);
  });

  it("ignores MEM and BASE and the Set column", () => {
    const parse = parsePublishedChecklist(
      csv([line("A", "P1", "1", "F", ["", "", "1"])]),
      { mode: "set" },
    );
    expect(names(parse)).toEqual(["A", "A F Gold"]);
  });

  it("collapses a card repeated inside one parallel, and skips a different run for it", () => {
    const parse = parsePublishedChecklist(
      csv([
        line("A", "P1", "1", "F", ["5", "", ""]),
        line("A", "P1", "1", "F", ["5", "", ""]),
        line("A", "P1", "1", "F", ["7", "", ""]),
      ]),
      { mode: "set" },
    );
    expect(parse.rows.filter((r) => r.subset === "A F RWB")).toEqual([
      { number: "1", players: ["P1"], teams: [], printRun: 5, subset: "A F RWB" },
    ]);
    expect(parse.skipped).toEqual([
      expect.objectContaining({ line: 4, reason: printRunClashReason(5, "A F RWB") }),
    ]);
  });

  it("keeps the card and reports a bad print-run cell", () => {
    const parse = parsePublishedChecklist(
      csv([
        line("A", "P1", "1", "F", ["x", "3", ""]),
        line("A", "P2", "2", "F", ["0", "1000001", "2.5"]),
        line("A", "P3", "3", "F", ["", "", "1"]),
        line("A", "P4", "4", "F", ["4", "5", "6"]),
        line("A", "P5", "5", "F", ["4", "5", "6"]),
        line("A", "P6", "6", "F", ["4", "5", "6"]),
      ]),
      { mode: "set" },
    );
    expect(parse.rows.filter((r) => r.subset === "A").map((r) => r.number)).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(parse.skipped.map((s) => s.reason)).toEqual([
      badPrintRunReason("RWB", "x"),
      badPrintRunReason("RWB", "0"),
      badPrintRunReason("Silver", "1000001"),
      badPrintRunReason("Gold", "2.5"),
    ]);
    expect(parse.skipped[0]).toMatchObject({ line: 2, text: expect.stringContaining("P1") });
    expect(parse.rows.filter((r) => r.subset === "A F Silver")).toHaveLength(4);
    // The cap is the server's own, with a thousands separator in the words.
    expect(MAX_BSC_PRINT_RUN).toBe(1_000_000);
    expect(badPrintRunReason("Silver", "1000001")).toContain("from 1 to 1,000,000");
  });

  it("takes a print run of exactly the server's cap", () => {
    const parse = parsePublishedChecklist(
      csv([
        line("A", "P1", "1", "F", [String(MAX_BSC_PRINT_RUN), "", ""]),
        line("A", "P2", "2", "F", ["1", "", ""]),
        line("A", "P3", "3", "F", ["2", "", ""]),
      ]),
      { mode: "set" },
    );
    expect(parse.rows.find((r) => r.subset === "A F RWB")?.printRun).toBe(MAX_BSC_PRINT_RUN);
    expect(parse.skipped).toEqual([]);
  });

  it("skips a print run on a line that names no foil, and a name over the limit once", () => {
    const parse = parsePublishedChecklist(
      csv([
        line("A", "P1", "1", "", ["5", "", ""]),
        line("A".repeat(70), "P1", "1", "F".repeat(60), ["1", "2", ""]),
        line("A".repeat(70), "P2", "2", "F".repeat(60), ["1", "2", ""]),
      ]),
      { mode: "set" },
    );
    expect(parse.skipped.map((s) => s.reason)).toEqual([
      PRINT_RUN_WITHOUT_FOIL,
      PARALLEL_NAME_TOO_LONG,
      PARALLEL_NAME_TOO_LONG,
    ]);
    expect(names(parse)).toEqual(["A", "A".repeat(70)]);
  });

  it("leaf mode gives the card subsets only, and says nothing of print runs", () => {
    const parse = parsePublishedChecklist(
      csv([
        line("A", "P1", "1", "F", ["x", "3", ""]),
        line("B", "P2", "1", "F", ["1", "", ""]),
      ]),
      { mode: "leaf" },
    );
    expect(parse.rows.map((r) => r.subset)).toEqual(["A", "B"]);
    expect(parse.rows.every((r) => r.printRun === undefined)).toBe(true);
    expect(parse.subsets).toEqual(["A", "B"]);
    expect(parse.skipped).toEqual([]);
  });
});

describe("the set's limits hold by whole parallel sections", () => {
  it("drops whole parallel sections past the row cap and keeps every subset", () => {
    // 3 subsets of 12,000 cards would break the 2,000-row section cap, so use
    // 25 subsets of 1,000 cards, each with two colours: 25,000 cards plus
    // 50,000 parallel rows against the 50,000-row set cap.
    const rows: string[][] = [];
    for (let s = 0; s < 25; s++) {
      for (let n = 1; n <= 1000; n++) {
        rows.push(line(`Subset ${s}`, `Player ${s}-${n}`, String(n), "Foil", ["3", "4", ""]));
      }
    }
    const parse = parsePublishedChecklist(csv(rows), { mode: "set" });
    const out = checklistSections(parse);
    const cardSections = out.sections.filter((s) => /^Subset \d+$/.test(s.name));
    expect(cardSections).toHaveLength(25);
    expect(out.rowCount).toBeLessThanOrEqual(50_000);
    expect(out.skippedSections.length).toBeGreaterThan(0);
    // Everything dropped is a parallel, whole, with the row-limit reason.
    expect(out.skippedSections.every((s) => /Foil (RWB|Silver)$/.test(s.name) && s.rowCount === 1000)).toBe(true);
    expect(out.skippedSections.every((s) => /Over 50,000 cards/.test(s.reason))).toBe(true);
    // A kept parallel keeps its print runs through the sections.
    const kept = out.sections.find((s) => s.name === "Subset 0 Foil RWB");
    expect(kept?.rows[0]).toMatchObject({ number: "1", printRun: 3 });
  });
});

describe("the trimmed fixture and the full sample's shape", () => {
  const FIXTURE = join(
    dirname(fileURLToPath(import.meta.url)),
    "../../playwright/fixtures/checklists/2026-pro-set-metal-sample.csv",
  );

  it("reads the sample: four card subsets, their parallels, duo, Mini and the city teams", () => {
    const parse = parsePublishedChecklist(readFileSync(FIXTURE, "utf8"), { mode: "set", setYear: 2026 });
    expect(parse.skipped).toEqual([]);
    const cardSubsets = ["Dugout Duos", "1989 Pro Set Base", "1989 Pro Set Base Mini", "1989 Pro Set Auto"];
    // The card subsets come first, in the file's order.
    expect(parse.subsets?.slice(0, 4)).toEqual([
      "Dugout Duos",
      "1989 Pro Set Auto",
      "1989 Pro Set Base",
      "1989 Pro Set Base Mini",
    ]);
    const cards = parse.rows.filter((r) => cardSubsets.includes(r.subset ?? ""));
    expect(cards).toHaveLength(16);
    expect(cards.every((r) => r.printRun === undefined)).toBe(true);
    expect(parse.rows.find((r) => r.number === "DD-1")?.players).toEqual(["Carlton Fisk", "Harold Baines"]);
    expect(parse.rows.find((r) => r.number === "89B-2")?.teams).toEqual(["Los Angeles N"]);
    expect(parse.subsets).toContain("1989 Pro Set Auto Silver Circles RWB RWB");
    expect(parse.subsets).toContain("1989 Pro Set Base Mini Lazer Gold");
    expect(parse.subsets).toContain("Dugout Duos Super Prismatic Gold Silver");
    const sections = checklistSections(parse);
    expect(sections.skippedSections).toEqual([]);
  });
});
