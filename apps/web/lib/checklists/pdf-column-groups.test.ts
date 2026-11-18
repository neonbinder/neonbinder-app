/**
 * NEO-591 — `pdf-column-groups.ts` (pure column geometry) and the parser's
 * Last Name / First Name reading of a PDF, driven by hand-built pages.
 *
 * The page cases build their lines with the real `groupPageItems`, so a
 * record's cells, xs and text runs are exactly what the reader would hand over.
 */
import { describe, expect, it } from "vitest";
import {
  COLUMN_HEADINGS_AGAIN,
  parsePublishedChecklist,
  parsePublishedChecklistCells,
  type ChecklistCellRecord,
} from "./parse-published-checklist";
import {
  NamePairs,
  PDF_MAX_COLUMN_GROUPS,
  columnGroups,
  fontHeading,
  groupIndexOf,
  modeFont,
  runsByGroup,
  slotGroupRuns,
  soleFont,
  type HeaderCell,
} from "./pdf-column-groups";
import { groupPageItems } from "./read-pdf-lines";
import type { PdfTextRun } from "./pdf-text-runs";

const run = (text: string, x: number, font?: string, size = 10): PdfTextRun => ({
  text,
  x,
  end: x + text.length * 5,
  size,
  ...(font !== undefined ? { font } : {}),
});

const PAIR: [string, string] = ["lastName", "firstName"];
const opts = { pair: PAIR, team: "teams", slack: 15 };
const cellsAt = (...xs: number[]): HeaderCell[] => xs.map((x) => ({ x, end: x + 45 }));

describe("columnGroups", () => {
  it("makes one group over every header cell when the header does not repeat", () => {
    const groups = columnGroups(["lastName", "firstName", "teams"], cellsAt(50, 130, 210), opts);
    expect(groups).toHaveLength(1);
    expect(groups[0].columns).toEqual([0, 1, 2]);
    expect(groups[0].teamSlot).toBe(false);
  });

  it("splits a header that is a whole repetition of its Last/First unit into side-by-side groups", () => {
    const kinds = ["lastName", "firstName", "teams", "lastName", "firstName", "teams"];
    const groups = columnGroups(kinds, cellsAt(50, 130, 210, 330, 410, 490), opts);
    expect(groups.map((g) => g.columns)).toEqual([[0, 1, 2], [3, 4, 5]]);
    expect(groups[0].left).toBe(-Infinity);
    expect(groups[1].left).toBe(330 - 15);
  });

  it("marks a group with no team column in its header as taking the team from past its last cell", () => {
    const kinds = ["lastName", "firstName", "lastName", "firstName"];
    const groups = columnGroups(kinds, cellsAt(50, 130, 330, 410), opts);
    expect(groups.map((g) => g.teamSlot)).toEqual([true, true]);
    expect(groups[0].lastEnd).toBe(130 + 45);
  });

  it("keeps two team columns as two team columns of one group", () => {
    const groups = columnGroups(["lastName", "firstName", "teams", "teams"], cellsAt(50, 130, 210, 330), opts);
    expect(groups).toHaveLength(1);
    expect(groups[0].columns).toEqual([0, 1, 2, 3]);
  });

  it("does not split a repetition whose unit lacks the pair", () => {
    expect(columnGroups(["teams", "teams", "teams", "teams"], cellsAt(1, 2, 3, 4), opts)).toHaveLength(1);
    expect(columnGroups(["lastName", "teams", "lastName", "teams"], cellsAt(1, 2, 3, 4), opts)).toHaveLength(1);
  });

  it("does not split a header that only half repeats", () => {
    const kinds = ["lastName", "firstName", "teams", "lastName", "firstName"];
    expect(columnGroups(kinds, cellsAt(50, 130, 210, 330, 410), opts)).toHaveLength(1);
  });

  it("does not split more repetitions than the cap", () => {
    const unit = ["lastName", "firstName"];
    const many = (n: number) => Array.from({ length: n }, () => unit).flat();
    const xs = (n: number) => cellsAt(...Array.from({ length: n * 2 }, (_, i) => i * 100));
    expect(columnGroups(many(PDF_MAX_COLUMN_GROUPS), xs(PDF_MAX_COLUMN_GROUPS), opts)).toHaveLength(
      PDF_MAX_COLUMN_GROUPS,
    );
    // 11 pairs: no divisor of 22 makes a whole repetition within the cap.
    const over = PDF_MAX_COLUMN_GROUPS + 3;
    expect(columnGroups(many(over), xs(over), opts)).toHaveLength(1);
  });

  it("returns no group for an empty header", () => {
    expect(columnGroups([], [], opts)).toEqual([]);
  });
});

describe("groupIndexOf / runsByGroup / slotGroupRuns", () => {
  const kinds = ["lastName", "firstName", "teams", "lastName", "firstName", "teams"];
  const header = cellsAt(50, 130, 210, 330, 410, 490);
  const groups = columnGroups(kinds, header, opts);

  it("puts a run in the last group whose left edge it has reached", () => {
    expect(groupIndexOf(groups, 50)).toBe(0);
    expect(groupIndexOf(groups, 314.9)).toBe(0);
    expect(groupIndexOf(groups, 315)).toBe(1);
    expect(groupIndexOf(groups, 600)).toBe(1);
  });

  it("splits a line's runs by group, each left to right", () => {
    const by = runsByGroup([run("a", 50), run("b", 130), run("c", 330), run("d", 410)], groups);
    expect(by.map((runs) => runs.map((r) => r.text))).toEqual([["a", "b"], ["c", "d"]]);
  });

  it("slots a long surname under Last Name even when the given name starts within the cell gap", () => {
    // "De La Torre" is 55 pt wide and ends at 105; "Luis" starts at 120.
    const slots = slotGroupRuns([run("De La Torre", 50), run("Luis", 120), run("SF", 210)], groups[0], header);
    expect(slots).toEqual(["De La Torre", "Luis", "SF"]);
  });

  it("slots a run to the header cell it starts nearest", () => {
    const slots = slotGroupRuns([run("Smith", 60), run("John", 118), run("Mets", 205)], groups[0], header);
    expect(slots).toEqual(["Smith", "John", "Mets"]);
  });

  it("leaves a column empty when no run starts under it", () => {
    expect(slotGroupRuns([run("Smith", 50), run("Mets", 210)], groups[0], header)).toEqual(["Smith", "", "Mets"]);
  });

  it("takes a run past the last header cell as the team when the header has no team column", () => {
    const noTeam = columnGroups(["lastName", "firstName"], cellsAt(50, 130), opts);
    // The header's last cell ends at 175; the team starts at 300.
    const slots = slotGroupRuns([run("Smith", 50), run("John", 130), run("Mets", 300)], noTeam[0], cellsAt(50, 130));
    expect(slots).toEqual(["Smith", "John", "Mets"]);
  });

  it("adds a team slot only when the header has none", () => {
    expect(slotGroupRuns([run("a", 50)], groups[0], header)).toHaveLength(3);
    const noTeam = columnGroups(["lastName", "firstName"], cellsAt(50, 130), opts);
    expect(slotGroupRuns([run("a", 50)], noTeam[0], cellsAt(50, 130))).toHaveLength(3);
  });
});

describe("modeFont / soleFont / fontHeading", () => {
  it("modeFont is the font most runs use, and undefined when none carries one", () => {
    expect(modeFont([[run("a", 0, "D"), run("b", 9, "D")], [run("c", 0, "H")]])).toBe("D");
    expect(modeFont([[run("a", 0)]])).toBeUndefined();
    expect(modeFont([])).toBeUndefined();
  });

  it("soleFont is the one font every run shares, else undefined", () => {
    expect(soleFont([run("a", 0, "H"), run("b", 60, "H")])).toBe("H");
    expect(soleFont([run("a", 0, "H"), run("b", 60, "D")])).toBeUndefined();
    expect(soleFont([run("a", 0, "H"), run("b", 60)])).toBeUndefined();
    expect(soleFont([])).toBeUndefined();
  });

  const ctx = { headerFont: "H", dataFont: "D", headerSize: 10 };

  it("reads runs in the header font as a heading, joined as one cell", () => {
    expect(fontHeading([run("Dual", 330, "H"), run("Autographs", 360, "H")], ctx)).toBe("Dual Autographs");
  });

  it("is no heading in the data font", () => {
    expect(fontHeading([run("Paul Skenes", 330, "D")], ctx)).toBeNull();
  });

  it("is no heading when the header and data share a font (the font says nothing)", () => {
    expect(fontHeading([run("Dual Autographs", 330, "H")], { ...ctx, dataFont: "H" })).toBeNull();
  });

  it("is no heading without a header font", () => {
    expect(fontHeading([run("Dual Autographs", 330, "H")], { ...ctx, headerFont: undefined })).toBeNull();
  });

  it("is no heading when any run is in another font", () => {
    expect(fontHeading([run("Dual", 330, "H"), run("Bob", 360, "D")], ctx)).toBeNull();
  });

  it("is no heading when the size is not about the header's", () => {
    expect(fontHeading([run("Dual Autographs", 330, "H", 14)], ctx)).toBeNull();
    expect(fontHeading([run("Dual Autographs", 330, "H", 8)], ctx)).toBeNull();
  });

  it("is no heading when the runs are a column gap apart (two cells, not one)", () => {
    expect(fontHeading([run("Dual", 330, "H"), run("Autographs", 400, "H")], ctx)).toBeNull();
  });

  it("is no heading for no runs", () => {
    expect(fontHeading([], ctx)).toBeNull();
  });
});

describe("NamePairs", () => {
  it("splits a printed name only when exactly one pair printed that way", () => {
    const pairs = new NamePairs();
    pairs.add("Owusu-Asiedu", "Avery");
    expect(pairs.split("Owusu-Asiedu Avery")).toEqual({ last: "Owusu-Asiedu", first: "Avery" });
    expect(pairs.split("owusu-asiedu   AVERY")).toEqual({ last: "Owusu-Asiedu", first: "Avery" });
  });

  it("repeats of the same pair are still one pair", () => {
    const pairs = new NamePairs();
    pairs.add("De La Torre", "Luis");
    pairs.add("De La Torre", "Luis");
    expect(pairs.split("De La Torre Luis")).toEqual({ last: "De La Torre", first: "Luis" });
  });

  it("returns null when none printed it", () => {
    expect(new NamePairs().split("Nobody Here")).toBeNull();
  });

  it("returns null when two different splits print the same text", () => {
    const pairs = new NamePairs();
    pairs.add("De La Torre", "Luis");
    pairs.add("De La", "Torre Luis");
    expect(pairs.split("De La Torre Luis")).toBeNull();
  });

  it("ignores a row with a blank part", () => {
    const pairs = new NamePairs();
    pairs.add("Madonna", "");
    pairs.add("", "Cher");
    expect(pairs.split("Madonna")).toBeNull();
    expect(pairs.split("Cher")).toBeNull();
  });
});

// ── The parser over hand-built pages ───────────────────────────────────────

type It = { s: string; x: number; y: number; f?: string };
const H = "font-header";
const D = "font-data";

/** Records for pages of items, built by the real line grouper. */
function pages(list: It[][], options: { items?: boolean } = {}): ChecklistCellRecord[] {
  let n = 0;
  const out: ChecklistCellRecord[] = [];
  list.forEach((items, p) => {
    const lines = groupPageItems(
      items.map((i) => ({
        str: i.s,
        transform: [10, 0, 0, 10, i.x, i.y],
        width: i.s.length * 5,
        height: 10,
        fontName: i.f ?? D,
      })),
    );
    for (const l of lines) {
      out.push({
        line: ++n,
        page: p + 1,
        cells: l.cells,
        xs: l.xs,
        ...(options.items === false ? {} : { items: l.items }),
      });
    }
  });
  return out;
}

/** Two tables side by side: columns Last, First, Team at 50/130/210 and 330/410/490. */
const HEADER2 = (y: number): It[] => [
  { s: "Last Name", x: 50, y, f: H },
  { s: "First Name", x: 130, y, f: H },
  { s: "Team", x: 210, y, f: H },
  { s: "Last Name", x: 330, y, f: H },
  { s: "First Name", x: 410, y, f: H },
  { s: "Team", x: 490, y, f: H },
];
type Triple = [string, string, string];
const ROW2 = (y: number, left?: Triple, right?: Triple): It[] => [
  ...(left
    ? [
        { s: left[0], x: 50, y },
        { s: left[1], x: 130, y },
        { s: left[2], x: 210, y },
      ]
    : []),
  ...(right
    ? [
        { s: right[0], x: 330, y },
        { s: right[1], x: 410, y },
        { s: right[2], x: 490, y },
      ]
    : []),
].filter((i) => i.s !== "");
const HEADINGS = (left: string, right: string, y = 700): It[] => [
  { s: left, x: 50, y, f: H },
  { s: right, x: 330, y, f: H },
];

function read(records: ChecklistCellRecord[]) {
  const out = parsePublishedChecklistCells({ format: "pdf", records }, { mode: "set" });
  return {
    rows: out.rows.map((r) => ({
      subset: r.subset,
      number: r.number,
      players: r.players,
      teams: r.teams,
      ...(r.noTeam ? { noTeam: true } : {}),
      ...(r.prospect ? { prospect: true } : {}),
      ...(r.prospectTeams ? { prospectTeams: r.prospectTeams } : {}),
    })),
    skipped: out.skipped.map((s) => [s.text, s.reason] as const),
  };
}

describe("parser: Last Name / First Name PDFs", () => {
  it("reads side-by-side tables as two sections, the left table first, each player first name then last", () => {
    const { rows, skipped } = read(
      pages([
        [
          ...HEADINGS("Base Cards", "Player Autographs"),
          ...HEADER2(686),
          ...ROW2(672, ["Smith", "John", "Mets"], ["Jones", "Bob", "Reds"]),
          ...ROW2(658, ["Lee", "Amy", "Cubs"], ["Kim", "Sue", "Mets"]),
        ],
      ]),
    );
    expect(rows).toEqual([
      { subset: "Base Cards", number: "NNO", players: ["John Smith"], teams: ["Mets"] },
      { subset: "Base Cards", number: "NNO", players: ["Amy Lee"], teams: ["Cubs"] },
      { subset: "Player Autographs", number: "NNO", players: ["Bob Jones"], teams: ["Reds"] },
      { subset: "Player Autographs", number: "NNO", players: ["Sue Kim"], teams: ["Mets"] },
    ]);
    expect(skipped).toEqual([]);
  });

  it("reads a header that does not repeat as one group, the team past the last column", () => {
    const { rows } = read(
      pages([
        [
          { s: "Base", x: 50, y: 700, f: H },
          { s: "Last Name", x: 50, y: 686, f: H },
          { s: "First Name", x: 130, y: 686, f: H },
          { s: "Team", x: 210, y: 686, f: H },
          ...ROW2(672, ["Smith", "John", "Mets"]),
          // Far to the right: still the same table's team, not a second table.
          ...ROW2(658, ["Lee", "Amy", "Reds"]),
        ],
      ]),
    );
    expect(rows).toEqual([
      { subset: "Base", number: "NNO", players: ["John Smith"], teams: ["Mets"] },
      { subset: "Base", number: "NNO", players: ["Amy Lee"], teams: ["Reds"] },
    ]);
  });

  it("keeps two team columns as two teams of one card", () => {
    const { rows } = read(
      pages([
        [
          { s: "Base", x: 50, y: 700, f: H },
          { s: "Last Name", x: 50, y: 686, f: H },
          { s: "First Name", x: 130, y: 686, f: H },
          { s: "Team", x: 210, y: 686, f: H },
          { s: "Team", x: 330, y: 686, f: H },
          { s: "Smith", x: 50, y: 672 },
          { s: "John", x: 130, y: 672 },
          { s: "Mets", x: 210, y: 672 },
          { s: "Yankees", x: 330, y: 672 },
        ],
      ]),
    );
    expect(rows).toEqual([
      { subset: "Base", number: "NNO", players: ["John Smith"], teams: ["Mets", "Yankees"] },
    ]);
  });

  it("reads each group down the pages in turn when later pages carry no header row", () => {
    const { rows } = read(
      pages([
        [
          ...HEADINGS("Base Cards", "Player Autographs"),
          ...HEADER2(686),
          ...ROW2(672, ["Smith", "John", "Mets"], ["Jones", "Bob", "Reds"]),
        ],
        [...ROW2(700, ["Brown", "Ann", "Cubs"], ["Gray", "Tom", "Mets"])],
      ]),
    );
    expect(rows.map((r) => [r.subset, r.players[0]])).toEqual([
      ["Base Cards", "John Smith"],
      ["Base Cards", "Ann Brown"],
      ["Player Autographs", "Bob Jones"],
      ["Player Autographs", "Tom Gray"],
    ]);
  });

  it("skips a header that appears again on page 2 as 'Column headings again' and keeps reading", () => {
    const { rows, skipped } = read(
      pages([
        [
          ...HEADINGS("Base Cards", "Player Autographs"),
          ...HEADER2(686),
          ...ROW2(672, ["Smith", "John", "Mets"]),
        ],
        [...HEADER2(700), ...ROW2(686, ["Lee", "Amy", "Reds"])],
      ]),
    );
    expect(COLUMN_HEADINGS_AGAIN).toBe("Column headings again");
    expect(skipped).toEqual([["Last Name | First Name | Team | Last Name | First Name | Team", COLUMN_HEADINGS_AGAIN]]);
    expect(rows.map((r) => r.players[0])).toEqual(["John Smith", "Amy Lee"]);
  });

  it("splits a surname the reader merged with the given name beside it (cells fused, runs apart)", () => {
    // "De La Torre" ends at 105 and "Luis" starts at 120: 15 pt apart, one cell.
    const records = pages([
      [
        ...HEADINGS("Base Cards", "Player Autographs"),
        ...HEADER2(686),
        ...ROW2(672, ["De La Torre", "Luis", "SF"]),
      ],
    ]);
    const fused = pages([
      [
        ...HEADINGS("Base Cards", "Player Autographs"),
        ...HEADER2(686),
        { s: "De La Torre", x: 50, y: 672 },
        { s: "Luis", x: 120, y: 672 },
        { s: "SF", x: 210, y: 672 },
      ],
    ]);
    // Normal spacing, then the fused one: the same person either way.
    expect(read(records).rows[0].players).toEqual(["Luis De La Torre"]);
    const fusedRecord = fused.find((r) => r.cells.some((c) => c.includes("De La Torre")))!;
    expect(fusedRecord.cells[0]).toBe("De La Torre Luis");
    expect(read(fused).rows[0]).toMatchObject({ players: ["Luis De La Torre"], teams: ["SF"] });
  });

  describe("a name printed across two columns in one run", () => {
    const straddle = (extra: It[][]) =>
      read(
        pages([
          [
            ...HEADINGS("Base Cards", "Player Autographs"),
            ...HEADER2(686),
            ...ROW2(672, ["Owusu-Asiedu Avery", "", "Arizona"]),
            ...extra.flat(),
          ],
        ]),
      ).rows.map((r) => r.players[0]);

    it("is split when the file prints exactly one such pair in its own columns", () => {
      expect(straddle([ROW2(658, ["Owusu-Asiedu", "Avery", "Arizona"])])).toEqual([
        "Avery Owusu-Asiedu",
        "Avery Owusu-Asiedu",
      ]);
    });

    it("is left as printed when no row prints the pair split", () => {
      expect(straddle([])).toEqual(["Owusu-Asiedu Avery"]);
    });

    it("is left as printed when two different splits print the same text", () => {
      const rows = read(
        pages([
          [
            ...HEADINGS("Base Cards", "Player Autographs"),
            ...HEADER2(686),
            ...ROW2(672, ["De La Torre Luis", "", "SF"]),
            ...ROW2(658, ["De La Torre", "Luis", "SF"]),
            ...ROW2(644, ["De La", "Torre Luis", "LA"]),
          ],
        ]),
      ).rows.map((r) => r.players[0]);
      expect(rows[0]).toBe("De La Torre Luis");
    });

    it("is split by a pair printed in the other side-by-side table too (the index is the whole file's)", () => {
      const rows = read(
        pages([
          [
            ...HEADINGS("Base Cards", "Player Autographs"),
            ...HEADER2(686),
            ...ROW2(672, ["Owusu-Asiedu Avery", "", "Arizona"], ["Owusu-Asiedu", "Avery", "Arizona"]),
          ],
        ]),
      ).rows;
      expect(rows.map((r) => r.players[0])).toEqual(["Avery Owusu-Asiedu", "Avery Owusu-Asiedu"]);
    });
  });

  describe("a heading in the middle of a page", () => {
    const body = (heading: It[]) =>
      read(
        pages([
          [
            ...HEADINGS("Base Cards", "Player Autographs"),
            ...HEADER2(686),
            ...ROW2(672, ["Smith", "John", "Mets"], ["Jones", "Bob", "Reds"]),
            ...heading,
            { s: "Paul Skenes", x: 330, y: 644 },
            { s: "Konnor Griffin", x: 430, y: 644 },
          ],
        ]),
      );

    it("starts a section with no column headings when it is in the header's font and alone in its columns", () => {
      const { rows } = body([{ s: "Dual Autographs", x: 330, y: 658, f: H }]);
      expect(rows.at(-1)).toEqual({
        subset: "Dual Autographs",
        number: "NNO",
        players: ["Paul Skenes", "Konnor Griffin"],
        teams: [],
      });
      // The left table is untouched by the right table's new section.
      expect(rows.filter((r) => r.subset === "Base Cards")).toHaveLength(1);
    });

    it("is not a heading when it is set in the data font", () => {
      const { rows } = body([{ s: "Dual Autographs", x: 330, y: 658, f: D }]);
      expect(rows.map((r) => r.subset)).not.toContain("Dual Autographs");
      expect(rows.every((r) => r.subset === "Base Cards" || r.subset === "Player Autographs")).toBe(true);
    });

    it("is not a heading when another run shares its columns on the line", () => {
      const { rows } = body([
        { s: "Dual Autographs", x: 330, y: 658, f: H },
        { s: "Bob", x: 430, y: 658, f: D },
      ]);
      expect(rows.map((r) => r.subset)).not.toContain("Dual Autographs");
    });

    it("reads each cell of a headingless section as one player, never a first/last pair", () => {
      const { rows } = body([{ s: "Dual Autographs", x: 330, y: 658, f: H }]);
      expect(rows.at(-1)?.players).toHaveLength(2);
      expect(rows.at(-1)?.teams).toEqual([]);
      expect(rows.at(-1)?.noTeam).toBeUndefined();
    });
  });

  it("falls back to the cells when a record carries no text runs", () => {
    const records = pages(
      [
        [
          ...HEADINGS("BASE CARDS", "PLAYER AUTOGRAPHS"),
          ...HEADER2(686),
          ...ROW2(672, ["Smith", "John", "Mets"], ["Jones", "Bob", "Reds"]),
        ],
      ],
      { items: false },
    );
    expect(records.every((r) => r.items === undefined)).toBe(true);
    expect(read(records).rows).toEqual([
      { subset: "BASE CARDS", number: "NNO", players: ["John Smith"], teams: ["Mets"] },
      { subset: "PLAYER AUTOGRAPHS", number: "NNO", players: ["Bob Jones"], teams: ["Reds"] },
    ]);
  });

  it("cannot tell a Title Case heading from a row without fonts, so those rows are skipped, not mis-sectioned", () => {
    const { rows, skipped } = read(
      pages(
        [
          [
            ...HEADINGS("Base Cards", "Player Autographs"),
            ...HEADER2(686),
            ...ROW2(672, ["Smith", "John", "Mets"]),
          ],
        ],
        { items: false },
      ),
    );
    expect(rows).toEqual([]);
    expect(skipped.map(([, reason]) => reason)).toContain("Not under any section heading");
  });

  it("reads Prospect cells in the team column as the claim, with brackets kept for X", () => {
    const { rows } = read(
      pages([
        [
          ...HEADINGS("Base Cards", "Player Autographs"),
          ...HEADER2(686),
          ...ROW2(672, ["Smith", "John", "Prospect (Oklahoma)"], ["Jones", "Bob", "Prospect"]),
          ...ROW2(658, ["Lee", "Amy", "New York (N)"], ["Kim", "Sue", "Prospect (N/A)"]),
        ],
      ]),
    );
    expect(rows).toEqual([
      { subset: "Base Cards", number: "NNO", players: ["John Smith"], teams: [], prospect: true, prospectTeams: ["Oklahoma"] },
      { subset: "Base Cards", number: "NNO", players: ["Amy Lee"], teams: ["New York (N)"] },
      { subset: "Player Autographs", number: "NNO", players: ["Bob Jones"], teams: [], noTeam: true, prospect: true },
      { subset: "Player Autographs", number: "NNO", players: ["Sue Kim"], teams: [], noTeam: true, prospect: true },
    ]);
  });
});

describe("parser: Last Name / First Name outside a PDF", () => {
  it("reads a CSV with Last Name and First Name columns as unnumbered cards, first name then last", () => {
    const out = parsePublishedChecklist("Last Name,First Name,Team\nSmith,John,Mets\nLee,Amy,Prospect (Oklahoma)\nKim,Sue,Prospect\n", {});
    expect(out.rows).toEqual([
      { number: "NNO", players: ["John Smith"], teams: ["Mets"], noNumber: true },
      { number: "NNO", players: ["Amy Lee"], teams: [], noNumber: true, prospect: true, prospectTeams: ["Oklahoma"] },
      { number: "NNO", players: ["Sue Kim"], teams: [], noNumber: true, noTeam: true, prospect: true },
    ]);
  });

  it("reads a Last/First header with no team column", () => {
    const out = parsePublishedChecklist("Last,First\nSmith,John\n", {});
    expect(out.rows).toEqual([{ number: "NNO", players: ["John Smith"], teams: [], noNumber: true }]);
  });

  it("reads a tab-separated file's No Team as the claim", () => {
    const out = parsePublishedChecklist("Last Name\tFirst Name\tTeam\nSmith\tJohn\tNo Team\n", {});
    expect(out.rows).toEqual([{ number: "NNO", players: ["John Smith"], teams: [], noNumber: true, noTeam: true }]);
  });

  it("reads a workbook sheet's Last Name and First Name columns, with its tab as the subset", () => {
    const out = parsePublishedChecklistCells(
      {
        format: "xlsx",
        records: [
          { line: 1, sheet: "Autos", cells: ["Last Name", "First Name", "Team"] },
          { line: 2, sheet: "Autos", cells: ["Smith", "John", "Prospect (Oklahoma)"] },
          { line: 3, sheet: "Autos", cells: ["Lee", "Amy", "Mets"] },
        ],
      },
      {},
    );
    expect(out.rows).toEqual([
      { number: "NNO", players: ["John Smith"], teams: [], noNumber: true, prospect: true, prospectTeams: ["Oklahoma"], subset: "Autos" },
      { number: "NNO", players: ["Amy Lee"], teams: ["Mets"], noNumber: true, subset: "Autos" },
    ]);
  });

  it("does not read a header of only Last Name (no First Name) as the pair", () => {
    const out = parsePublishedChecklist("Last Name,Team\nSmith,Mets\n", {});
    expect(out.rows).toEqual([]);
  });
});
