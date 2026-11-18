/**
 * NEO-591 — what the text runs of a PDF checklist page say about its
 * columns, once the header row has told us where they are.
 *
 * Some publishers (Onyx) set two tables side by side on a page: "Base Cards"
 * on the left with Last Name / First Name / team, "Player Autographs" on the
 * right with the same three. One baseline then carries a row of each. This
 * module finds those side-by-side groups from the header row, puts each text
 * run under the column it starts at (rather than trusting the reader's
 * cells, which can fuse a long surname to the first name beside it), spots a
 * heading by its font, and resolves a name that one run printed across two
 * columns.
 *
 * Pure and browser-safe. It knows nothing of NB's column vocabulary: the
 * parser hands in the header's column kinds as plain strings.
 */

import { cellGap, joinRuns, lineSize, type PdfTextRun } from "./pdf-text-runs";

/** The most side-by-side groups read; a header repeating more often is one group. */
export const PDF_MAX_COLUMN_GROUPS = 8;
/**
 * The most text runs read from one line. A real checklist line holds a dozen;
 * a line past this is read from its cells instead (the reader already caps a
 * page at 50,000 runs, and this keeps one line from being walked many times).
 */
export const PDF_MAX_LINE_ITEMS = 400;

/** Where a header cell sits: its start and end x (pt). */
export type HeaderCell = { x: number; end: number };

export type ColumnGroup = {
  /** The header cells (by index) this group covers, left to right. */
  columns: number[];
  /** A run starting left of this x belongs to an earlier group. */
  left: number;
  /** Where the group's last header cell ends: a run starting past it is the team column. */
  lastEnd: number;
  /** The group's header has no team column, so a run past `lastEnd` is one. */
  teamSlot: boolean;
};

/**
 * The side-by-side groups a header row makes. The header's column kinds must
 * be a WHOLE repetition of one unit that holds both of `pair` (Last Name,
 * First Name, Last Name, First Name); anything else is one group over every
 * header cell. `slack` lets a run start a little left of its group's first
 * header cell and still belong to it. Always at least one group.
 */
export function columnGroups(
  kinds: ReadonlyArray<string | null>,
  cells: readonly HeaderCell[],
  options: { pair: readonly [string, string]; team: string; slack: number },
): ColumnGroup[] {
  const n = Math.min(kinds.length, cells.length);
  const make = (starts: number[], width: number): ColumnGroup[] =>
    starts.map((start, g) => {
      const columns = Array.from({ length: width }, (_, k) => start + k);
      return {
        columns,
        left: g === 0 ? -Infinity : cells[start].x - options.slack,
        lastEnd: cells[start + width - 1].end,
        teamSlot: !columns.some((c) => kinds[c] === options.team),
      };
    });
  for (let unit = 2; unit * 2 <= n; unit++) {
    if (n % unit !== 0 || n / unit > PDF_MAX_COLUMN_GROUPS) continue;
    const base = kinds.slice(0, unit);
    if (!options.pair.every((kind) => base.includes(kind))) continue;
    let whole = true;
    for (let i = unit; i < n && whole; i++) whole = kinds[i] === base[i % unit];
    if (whole) return make(Array.from({ length: n / unit }, (_, g) => g * unit), unit);
  }
  return n === 0 ? [] : make([0], n);
}

/** The group a run starting at `x` belongs to: the last whose `left` it has reached. */
export function groupIndexOf(groups: readonly ColumnGroup[], x: number): number {
  for (let g = groups.length - 1; g > 0; g--) if (x >= groups[g].left) return g;
  return 0;
}

/** A line's runs split by group, each group's left to right. */
export function runsByGroup(
  runs: readonly PdfTextRun[],
  groups: readonly ColumnGroup[],
): PdfTextRun[][] {
  const out: PdfTextRun[][] = groups.map(() => []);
  for (const run of runs) out[groupIndexOf(groups, run.x)].push(run);
  return out;
}

/**
 * One group's runs for one line, put under the group's columns: a run past
 * the last header cell (when the header has no team column) is the team; any
 * other goes under the header cell it starts nearest. The result has one
 * string per column of the group and, when `teamSlot`, one more for the team.
 */
export function slotGroupRuns(
  runs: readonly PdfTextRun[],
  group: ColumnGroup,
  cells: readonly HeaderCell[],
): string[] {
  const slots: PdfTextRun[][] = group.columns.map(() => []);
  const team: PdfTextRun[] = [];
  for (const run of runs) {
    if (group.teamSlot && run.x > group.lastEnd) {
      team.push(run);
      continue;
    }
    let best = 0;
    let distance = Infinity;
    group.columns.forEach((c, k) => {
      const d = Math.abs(cells[c].x - run.x);
      if (d < distance) {
        best = k;
        distance = d;
      }
    });
    slots[best].push(run);
  }
  const size = lineSize(runs);
  const out = slots.map((slot) => joinRuns(slot, size));
  if (group.teamSlot) out.push(joinRuns(team, size));
  return out;
}

/** The font most runs are set in, or undefined when none carries one. */
export function modeFont(lines: Iterable<readonly PdfTextRun[]>): string | undefined {
  const counts = new Map<string, number>();
  for (const runs of lines) {
    for (const run of runs) if (run.font !== undefined) counts.set(run.font, (counts.get(run.font) ?? 0) + 1);
  }
  let best: string | undefined;
  let most = 0;
  for (const [font, count] of counts) {
    if (count > most) {
      best = font;
      most = count;
    }
  }
  return best;
}

/** The font every run is set in, or undefined when they differ or carry none. */
export function soleFont(runs: readonly PdfTextRun[]): string | undefined {
  let font: string | undefined;
  for (const run of runs) {
    if (run.font === undefined) return undefined;
    if (font !== undefined && font !== run.font) return undefined;
    font = run.font;
  }
  return font;
}

/**
 * A heading by its type: every run of the group on this line is set in the
 * header row's font, not the data rows' font, at about the header's size, and
 * together they read as one cell. Returns its text, or null. Font ids are
 * compared for equality only.
 */
export function fontHeading(
  runs: readonly PdfTextRun[],
  context: { headerFont?: string; dataFont?: string; headerSize: number },
): string | null {
  const { headerFont, dataFont, headerSize } = context;
  if (runs.length === 0 || headerFont === undefined || headerFont === dataFont) return null;
  const size = lineSize(runs);
  if (headerSize <= 0 || Math.abs(size - headerSize) > headerSize * 0.15) return null;
  const reach = cellGap(size);
  for (let i = 0; i < runs.length; i++) {
    if (runs[i].font !== headerFont) return null;
    if (i > 0 && runs[i].x - runs[i - 1].end >= reach) return null;
  }
  const text = joinRuns(runs, size);
  return text === "" ? null : text;
}

/**
 * Names that one run printed across two columns ("Owusu-Asiedu Avery" in the
 * Last Name column, First Name empty) cannot be split by geometry. The file
 * itself usually prints the same person split properly elsewhere, so the
 * rows that DO have both parts are indexed by "last first", and a straddling
 * run is split only when exactly one pair was printed that way.
 */
export class NamePairs {
  private readonly pairs = new Map<string, Set<string>>();
  /** Past this many distinct keys nothing more is indexed (a lookup then misses). */
  static readonly MAX_KEYS = 100_000;

  static key(text: string): string {
    return text.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
  }

  /** Record a row that printed both parts in their own columns. */
  add(last: string, first: string): void {
    if (last.trim() === "" || first.trim() === "") return;
    const key = NamePairs.key(`${last} ${first}`);
    let set = this.pairs.get(key);
    if (!set) {
      if (this.pairs.size >= NamePairs.MAX_KEYS) return;
      this.pairs.set(key, (set = new Set()));
    }
    set.add(`${last.trim()}\u0000${first.trim()}`);
  }

  /** The one pair that printed as `printed`, or null when none or more than one did. */
  split(printed: string): { last: string; first: string } | null {
    const set = this.pairs.get(NamePairs.key(printed));
    if (!set || set.size !== 1) return null;
    const [pair] = set;
    const at = pair.indexOf("\u0000");
    return { last: pair.slice(0, at), first: pair.slice(at + 1) };
  }
}
