/**
 * NEO-591 — the text items pdf.js hands back for a checklist page, as the
 * reader (`read-pdf-lines.ts`) and the column reader (`pdf-column-groups.ts`)
 * both need them.
 *
 * pdf.js returns a page as positioned text items ("runs"). The reader merges
 * runs on one baseline into cells by an x-gap (`cellGap`); a tight layout can
 * merge two columns into one cell ("De La Torre" + "Luis", 17.5 pt apart
 * against an 18.2 pt gap), yet the runs themselves still start exactly at
 * their column's x. So the reader keeps every line's runs beside its cells,
 * and the parser re-slots them under the header's columns once it knows
 * where those are.
 *
 * Pure and browser-safe: no pdf.js, no DOM.
 */

/** One text run on a line: its raw text, where it starts and ends (pt), its height and font id. */
export type PdfTextRun = {
  text: string;
  x: number;
  end: number;
  size: number;
  /** pdf.js's font id; compared for equality only, never read as a name. */
  font?: string;
};

/**
 * The narrowest gap that starts a new cell, in points, for a line whose
 * font is `fontSize` high: never under 12 pt, and twice the font size for a
 * large font. A word space is about a quarter of the font size.
 */
export function cellGap(fontSize: number): number {
  return Math.max(12, fontSize * 2);
}

/** Control characters become spaces; runs of whitespace become one space. */
export function cleanPdfText(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim();
}

/** A run's x or width, to a tenth of a point: the precision a cell's `xs` already has. */
export function roundPt(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * The text of runs read left to right as one cell. pdf.js often splits a word
 * into runs that touch; a space goes only where the runs are apart and
 * neither side brings one. `size` is the line's font height.
 */
export function joinRuns(
  runs: ReadonlyArray<Pick<PdfTextRun, "text" | "x" | "end">>,
  size: number,
): string {
  let cell = "";
  let lastEnd = -Infinity;
  for (const run of runs) {
    const apart = cell !== "" && run.x - lastEnd > size * 0.15;
    cell += apart && !/\s$/.test(cell) && !/^\s/.test(run.text) ? ` ${run.text}` : run.text;
    lastEnd = Math.max(lastEnd, run.end);
  }
  return cleanPdfText(cell);
}

/** The tallest run's height (a loop, not a spread: a huge line overflows the stack). */
export function lineSize(runs: ReadonlyArray<Pick<PdfTextRun, "size">>): number {
  let size = 0;
  for (const run of runs) if (run.size > size) size = run.size;
  return size;
}

/**
 * Whether the reader's cell merge hid a gap on this line: two neighbouring
 * runs at least one font height apart (a word space is a quarter of one) that
 * `cellGap` still joined into a single cell. Only then do the runs say more
 * than the cells do, so a document without such a line is handed to the
 * parser as cells alone, exactly as before.
 */
export function hidesAColumnGap(runs: ReadonlyArray<PdfTextRun>): boolean {
  const size = lineSize(runs);
  if (size <= 0) return false;
  const reach = cellGap(size);
  for (let i = 1; i < runs.length; i++) {
    const gap = runs[i].x - runs[i - 1].end;
    if (gap >= size && gap < reach) return true;
  }
  return false;
}

/**
 * Runs read left to right as cells: a gap of `cellGap` or more starts a new
 * cell, exactly as the reader groups a page line. Each cell is its joined,
 * cleaned text; blank cells are left out.
 */
export function runCells(runs: ReadonlyArray<PdfTextRun>): string[] {
  const size = lineSize(runs);
  const reach = cellGap(size);
  const cells: string[] = [];
  let current: PdfTextRun[] = [];
  let lastEnd = -Infinity;
  const close = () => {
    const text = joinRuns(current, size);
    if (text !== "") cells.push(text);
    current = [];
  };
  for (const run of runs) {
    if (current.length > 0 && run.x - lastEnd >= reach) close();
    current.push(run);
    lastEnd = Math.max(lastEnd, run.end);
  }
  close();
  return cells;
}

/**
 * Stand-in runs for a line whose runs were not kept (a reader that hands over
 * cells only): one per cell, ending about half a font height per character
 * past its start.
 */
export function runsFromCells(
  cells: readonly string[],
  xs: readonly number[],
  size: number,
): PdfTextRun[] {
  const runs: PdfTextRun[] = [];
  cells.forEach((text, c) => {
    const x = xs[c];
    if (typeof x !== "number" || !Number.isFinite(x) || text.trim() === "") return;
    runs.push({ text, x, end: x + text.length * size * 0.5, size });
  });
  return runs;
}
