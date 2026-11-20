/**
 * NEO-616 — Pro Set's "foil × colour" checklist layout.
 *
 * One row per card per FOIL; the columns after the foil are COLOURS, and a
 * cell in one is that foil-and-colour's print run:
 *
 *   Set,Subset,Name,Checklist,Foil,RWB,Silver,Platinum,…,Gold,MEM,BASE,City Designation
 *   …,1989 Pro Set Base,Aaron Watson,89B-1,Prismatic,6,10,8,…,1,No,Base,Cincinnati
 *   …,1989 Pro Set Base,Aaron Watson,89B-1,Silver Circles RWB,1,,,…
 *
 * What it reads:
 *
 *  - **Cards.** Each subset's cards are read once: the card rows repeat for
 *    every foil, so a card is kept once per `subset + number + players`
 *    (the number alone is never the key: product rule 7). The number, the
 *    players and the team go through the parser's own positional rules
 *    (`readCard`), so "/" splits a duo, a blank city makes no claim and
 *    "No Team" means what it always means. The team is the City Designation
 *    cell as printed ("Los Angeles N"); a blank one is no claim.
 *  - **Parallels.** Each foil × colour with a print run is one more section,
 *    named literally "<Subset> <Foil> <Colour>" ("1989 Pro Set Auto Super
 *    Prismatic Gold Silver", "1989 Pro Set Auto Silver Circles RWB RWB"),
 *    holding its cards, each with its own `printRun`. The "/N" is never part
 *    of a name. MEM and BASE (and the Set column) are ignored.
 *  - **Order.** All card subsets first (file order), then the parallel
 *    sections grouped by subset: foils in first-appearance order, colours in
 *    the file's column order. Whole parallel sections are what a limit drops
 *    (`checklist-sections.ts` holds them), so every subset survives.
 *  - **Leaf mode** (the per-variant dialog) reads the card subsets only.
 *
 * The layout is recognised by its own header and nothing else:
 * `foilColourHeader` wants Subset, Name, Checklist and Foil headings plus at
 * least one more heading (a colour), and `readFoilColourLayout` then wants
 * one of those extra columns to hold print runs (most of its filled cells are
 * whole numbers). It is tried only where the generic reader finds no header
 * at all, so a file that reads today reads byte-for-byte as before.
 *
 * Pure and browser-safe. It imports only types from the parser (the parser
 * imports this file), and takes the parser's card and limit rules in `deps`.
 */

import type { PublishedChecklistRow } from "./parse-published-checklist";

/** The most a single print-run cell may say; a bigger number is a bad cell. */
export const FOIL_COLOUR_MAX_PRINT_RUN = 99_999;

/** Said for a line whose subset cell is blank: the parallels hang off the subset. */
export const NO_SUBSET_ON_LINE = "No subset on this line";
/** Said for a print run on a line that names no foil. */
export const PRINT_RUN_WITHOUT_FOIL = "Print run with no foil on this line";

/** Said for a print-run cell that is not a whole number in range. */
export function badPrintRunReason(colour: string, cell: string): string {
  const shown = cell.length > 20 ? `${cell.slice(0, 20)}…` : cell;
  return `Print run “${shown}” in the ${colour} column isn't a whole number from 1 to ${FOIL_COLOUR_MAX_PRINT_RUN.toLocaleString("en-US")}`;
}

/** Said for a card that already has a different print run in the same parallel. */
export function printRunClashReason(existing: number, parallel: string): string {
  return `Already has a print run of ${existing} in ${parallel}`;
}

/** Said for a foil × colour whose name is over the name limit. */
export const PARALLEL_NAME_TOO_LONG = "The section name is too long";

/** Where a line sits beyond its number: a workbook's sheet. */
export type FoilColourLineAt = { page?: number; sheet?: string };

/** The columns the header names. */
export type FoilColourHeader = {
  subset: number;
  name: number;
  checklist: number;
  foil: number;
  /** The City Designation column, when the file has one. */
  city: number | null;
  /** Every other headed column: a colour if the data says its cells are print runs. */
  candidates: Array<{ index: number; label: string }>;
};

/** One line or spreadsheet row, split into cells. */
export type FoilColourRecord = {
  line: number;
  cells: readonly string[];
  text: string;
  at: FoilColourLineAt;
  /** The parser already knows this line gives no row (above the header, over-long). */
  skip?: string;
};

export type FoilColourDeps = {
  mode: "leaf" | "set";
  /** The parser's name limit. */
  maxName: number;
  /** [checklist, name, city] read by the parser's positional rules. */
  readCard: (cells: [string, string, string]) => { row: PublishedChecklistRow } | { reason: string };
  /** The parser's own per-row limits (the row carries its subset). */
  overLimit: (row: PublishedChecklistRow) => string | null;
};

export type FoilColourRead = {
  skipped: Array<{ line: number; text: string; reason: string; at: FoilColourLineAt }>;
  /** In emit order; each row carries its subset (a card subset or a parallel's name). */
  rows: Array<{ row: PublishedChecklistRow; line: number; text: string; at: FoilColourLineAt }>;
};

/** "Card No." → "card no". Case, dots and runs of spaces don't count. */
function fold(cell: string): string {
  return cell.trim().toLowerCase().replace(/\./g, "").replace(/\s+/g, " ");
}

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Headings that are never a colour: the four the layout needs, and its known extras. */
const NOT_A_COLOUR = new Set([
  "",
  "set",
  "subset",
  "name",
  "checklist",
  "foil",
  "city designation",
  "mem",
  "base",
]);

/**
 * The layout's header, from a row's cells; null when the row is not it. The
 * header alone decides this much; `readFoilColourLayout` checks the data.
 */
export function foilColourHeader(cells: readonly string[]): FoilColourHeader | null {
  const folded = cells.map(fold);
  const subset = folded.indexOf("subset");
  const name = folded.indexOf("name");
  const checklist = folded.indexOf("checklist");
  const foil = folded.indexOf("foil");
  if (subset < 0 || name < 0 || checklist < 0 || foil < 0) return null;
  const city = folded.indexOf("city designation");
  const candidates: FoilColourHeader["candidates"] = [];
  folded.forEach((heading, index) => {
    if (!NOT_A_COLOUR.has(heading)) candidates.push({ index, label: clean(cells[index]) });
  });
  if (candidates.length === 0) return null;
  return { subset, name, checklist, foil, city, candidates };
}

/** A cell that reads as a print run in shape: whole digits, above zero. */
function runShaped(cell: string): boolean {
  const text = cell.trim();
  return /^\d+$/.test(text) && Number(text) > 0;
}

/** A print run: a whole number from 1 to the cap, or null. */
function printRunOf(cell: string): number | null {
  const text = cell.trim();
  if (!/^\d{1,6}$/.test(text)) return null;
  const n = Number(text);
  return n >= 1 && n <= FOIL_COLOUR_MAX_PRINT_RUN ? n : null;
}

type Card = {
  row: PublishedChecklistRow;
  line: number;
  text: string;
  at: FoilColourLineAt;
};

type Parallel = {
  name: string;
  subsetIndex: number;
  foilIndex: number;
  colourIndex: number;
  rows: Map<string, { card: Card; run: number }>;
};

/**
 * Read a header-matched file. Returns null when no extra column holds print
 * runs (the file is not this layout after all), so the caller carries on as
 * if this had never been tried.
 */
export function readFoilColourLayout(
  header: FoilColourHeader,
  records: readonly FoilColourRecord[],
  deps: FoilColourDeps,
): FoilColourRead | null {
  // Which extra columns hold print runs: those where the filled cells are
  // mostly whole numbers. A stray word in one is a bad cell, reported below,
  // not a reason to drop the column.
  const colours = header.candidates.filter((candidate) => {
    let runs = 0;
    let others = 0;
    for (const record of records) {
      if (record.skip !== undefined) continue;
      const cell = (record.cells[candidate.index] ?? "").trim();
      if (cell === "") continue;
      if (runShaped(cell)) runs++;
      else others++;
    }
    return runs > 0 && runs > others;
  });
  if (colours.length === 0) return null;

  const skipped: FoilColourRead["skipped"] = [];
  const subsets = new Map<string, { name: string; index: number; cards: Map<string, Card> }>();
  const foilIndexes = new Map<string, Map<string, number>>();
  const parallels = new Map<string, Parallel>();
  const tooLongReported = new Set<string>();
  const leaf = deps.mode === "leaf";

  for (const record of records) {
    const skip = (reason: string) =>
      skipped.push({ line: record.line, text: record.text, reason, at: record.at });
    if (record.skip !== undefined) {
      skip(record.skip);
      continue;
    }
    const cell = (index: number | null) => (index === null ? "" : (record.cells[index] ?? ""));
    const read = deps.readCard([cell(header.checklist), cell(header.name), cell(header.city)]);
    if ("reason" in read) {
      skip(read.reason);
      continue;
    }
    const subsetCell = clean(cell(header.subset));
    if (subsetCell === "") {
      skip(NO_SUBSET_ON_LINE);
      continue;
    }
    const tooLong = deps.overLimit({ ...read.row, subset: subsetCell });
    if (tooLong) {
      skip(tooLong);
      continue;
    }

    const subsetKey = fold(subsetCell);
    let subset = subsets.get(subsetKey);
    if (!subset) {
      subset = { name: subsetCell, index: subsets.size, cards: new Map() };
      subsets.set(subsetKey, subset);
    }
    // The key is subset + number + players (rule 7: a number alone is not
    // one). A card naming no player is told apart by its teams.
    const { number, players, teams } = read.row;
    const cardKey = `${number}\u0000${players.join("\u0001")}${players.length === 0 ? `\u0002${teams.join("\u0001")}` : ""}`;
    let card = subset.cards.get(cardKey);
    if (!card) {
      card = { row: { ...read.row, subset: subset.name }, line: record.line, text: record.text, at: record.at };
      subset.cards.set(cardKey, card);
    } else if (card.row.teams.length === 0 && !card.row.noTeam) {
      // An earlier foil row left the city blank; this one names it.
      if (read.row.noTeam) card.row.noTeam = true;
      else if (teams.length > 0) card.row.teams = teams;
    }

    if (leaf) continue;
    const foil = clean(cell(header.foil));
    colours.forEach((colour, colourIndex) => {
      const raw = (record.cells[colour.index] ?? "").trim();
      if (raw === "") return;
      const run = printRunOf(raw);
      if (run === null) {
        skip(badPrintRunReason(colour.label, raw));
        return;
      }
      if (foil === "") {
        skip(PRINT_RUN_WITHOUT_FOIL);
        return;
      }
      // Literal: the file's own words, joined by single spaces.
      const name = `${subset.name} ${foil} ${colour.label}`;
      if (name.length > deps.maxName) {
        if (!tooLongReported.has(name)) {
          tooLongReported.add(name);
          skip(PARALLEL_NAME_TOO_LONG);
        }
        return;
      }
      const parallelKey = fold(name);
      let parallel = parallels.get(parallelKey);
      if (!parallel) {
        let foils = foilIndexes.get(subsetKey);
        if (!foils) foilIndexes.set(subsetKey, (foils = new Map()));
        const foilKey = fold(foil);
        let foilIndex = foils.get(foilKey);
        if (foilIndex === undefined) foils.set(foilKey, (foilIndex = foils.size));
        parallel = { name, subsetIndex: subset.index, foilIndex, colourIndex, rows: new Map() };
        parallels.set(parallelKey, parallel);
      }
      const had = parallel.rows.get(cardKey);
      if (had === undefined) parallel.rows.set(cardKey, { card, run });
      else if (had.run !== run) skip(printRunClashReason(had.run, parallel.name));
    });
  }

  const rows: FoilColourRead["rows"] = [];
  for (const subset of subsets.values()) {
    for (const card of subset.cards.values()) {
      rows.push({ row: card.row, line: card.line, text: card.text, at: card.at });
    }
  }
  const ordered = [...parallels.values()].sort(
    (a, b) =>
      a.subsetIndex - b.subsetIndex || a.foilIndex - b.foilIndex || a.colourIndex - b.colourIndex,
  );
  for (const parallel of ordered) {
    for (const { card, run } of parallel.rows.values()) {
      const { subset: _subset, ...rest } = card.row;
      rows.push({
        row: { ...rest, printRun: run, subset: parallel.name },
        line: card.line,
        text: card.text,
        at: card.at,
      });
    }
  }
  return { skipped, rows };
}
