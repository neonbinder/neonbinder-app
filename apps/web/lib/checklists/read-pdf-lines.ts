/**
 * NEO-496 — read an official PDF checklist into lines of cells, in the
 * browser.
 *
 * pdf.js returns each page's text as positioned items. A checklist page sets
 * its columns apart with wide horizontal gaps (Topps: 40-120 pt between the
 * card number, the player and the team), while the words inside one column
 * sit a space apart. So:
 *
 *  1. items on one baseline (within a fraction of the font height) are one
 *     line, read left to right; lines go top to bottom;
 *  2. a gap between two items wider than `cellGap` for that line's font
 *     starts a new cell; a narrower gap is a space inside the cell.
 *
 * The columns are never guessed from the words: "Shohei Ohtani Los Angeles
 * Dodgers" as one flat string cannot say where the player ends, but the
 * x-gap can. What the cells mean (number, player, team, a heading) is for
 * `parse-published-checklist.ts` to decide.
 *
 * pdf.js is loaded only when a PDF is read (`loadPdfjs`, a dynamic import),
 * so it never weighs on the main bundle. It runs with `disableFontFace:
 * true` (no font is ever installed in the page) and XFA off, and its worker
 * is served from our own origin. pdf.js 6 has no eval path left at all:
 * the `isEvalSupported` option (the CVE-2024-4367 class) was removed with
 * the code it guarded, and `read-pdf-lines.test.ts` pins that the shipped
 * build holds no `new Function(` or `eval(`, so a version bump that brings
 * one back fails the suite.
 */

import type * as Pdfjs from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import {
  PDF_MAX_LINE_ITEMS,
  cellGap,
  cleanPdfText,
  joinRuns,
  lineSize,
  roundPt,
  type PdfTextRun,
} from "./pdf-text-runs";

export { cellGap };

/** The largest PDF read, in bytes. */
export const PDF_MAX_FILE_BYTES = 20 * 1024 * 1024;
/** The most pages read. */
export const PDF_MAX_PAGES = 300;
/** The most lines kept; past it the document is not read further. */
export const PDF_MAX_LINES = 100_000;
/**
 * The most text items grouped from one page. A real checklist page has a few
 * thousand; past this the rest of the page is not grouped and the document is
 * not read further (`truncatedAfterPage` says where it stopped).
 */
export const PDF_MAX_PAGE_ITEMS = 50_000;
/**
 * How long one read may take. Past it the pdf.js task (and its worker) is
 * destroyed and the file is refused as `malformed`, so a PDF built to spin
 * the parser cannot hold the dialog forever.
 */
export const PDF_READ_TIMEOUT_MS = 60_000;

/**
 * One line of a page: its cells left to right and the x (pt) each starts at,
 * and (NEO-591) the text runs the cells were merged from, so a column the
 * cell merge hid can still be found. `line` counts from 1 across the document.
 */
export type PdfLine = {
  page: number;
  line: number;
  cells: string[];
  xs: number[];
  items: PdfTextRun[];
};

/** Why a PDF could not be read. The dialog words each one. */
export type PdfRefusal = "too-big" | "too-many-pages" | "password" | "malformed";

export type PdfRead =
  | { ok: true; lines: PdfLine[]; pages: number; truncatedAfterPage?: number }
  | { ok: false; reason: PdfRefusal };

/** The part of a pdf.js text item the grouping reads. */
export type PdfTextItem = {
  str: string;
  /** [a, b, c, d, e, f]: e is x, f is the baseline y (up is positive). */
  transform: readonly number[];
  width: number;
  height: number;
  /** pdf.js's font id for the run. */
  fontName?: string;
};

/**
 * One grouped line: its cells left to right, the x (pt) each cell starts at,
 * and the text runs it was built from (left to right, blank runs left out).
 */
export type PdfPageLine = { cells: string[]; xs: number[]; items: PdfTextRun[] };

/**
 * Group one page's text items into lines of cells. Pure: the unit tests feed
 * it items by hand, and `readPdfLines` feeds it pdf.js's own. Only the first
 * `PDF_MAX_PAGE_ITEMS` items are read.
 */
export function groupPageItems(items: readonly PdfTextItem[]): PdfPageLine[] {
  type Placed = { x: number; end: number; y: number; size: number; text: string; font?: string };
  const placed: Placed[] = [];
  for (const item of items.length > PDF_MAX_PAGE_ITEMS ? items.slice(0, PDF_MAX_PAGE_ITEMS) : items) {
    if (typeof item.str !== "string" || item.str.trim() === "") continue;
    const [a, b, , d, x, y] = item.transform;
    if (![a, b, d, x, y].every(Number.isFinite)) continue;
    // A rotated item (sideways text, a stamp) is not a checklist line.
    if (Math.abs(b) > 0.01 * Math.abs(a || 1)) continue;
    const size = Math.abs(item.height) || Math.abs(d) || Math.abs(a) || 10;
    placed.push({
      x,
      end: x + Math.max(0, item.width),
      y,
      size,
      text: item.str,
      ...(typeof item.fontName === "string" ? { font: item.fontName } : {}),
    });
  }
  // Top to bottom, then left to right.
  placed.sort((p, q) => q.y - p.y || p.x - q.x);
  const lines: Placed[][] = [];
  for (const item of placed) {
    const current = lines[lines.length - 1];
    if (current) {
      const anchor = current[0];
      if (Math.abs(anchor.y - item.y) <= Math.min(anchor.size, item.size) * 0.5) {
        current.push(item);
        continue;
      }
    }
    lines.push([item]);
  }
  const out: PdfPageLine[] = [];
  for (const line of lines) {
    line.sort((p, q) => p.x - q.x);
    const size = lineSize(line);
    const gap = cellGap(size);
    const cells: string[] = [];
    const xs: number[] = [];
    let run: Placed[] = [];
    let lastEnd = -Infinity;
    const close = () => {
      const text = joinRuns(run, size);
      if (text !== "") {
        cells.push(text);
        xs.push(roundPt(run[0].x));
      }
      run = [];
    };
    for (const item of line) {
      if (run.length > 0 && item.x - lastEnd >= gap) close();
      run.push(item);
      lastEnd = Math.max(lastEnd, item.end);
    }
    close();
    if (cells.length > 0) {
      // A line of more runs than the parser will read keeps none: the cells
      // stand alone, and the page's memory stays bounded.
      const items: PdfTextRun[] = [];
      for (const p of line.length > PDF_MAX_LINE_ITEMS ? [] : line) {
        if (cleanPdfText(p.text) === "") continue;
        items.push({
          text: p.text,
          x: roundPt(p.x),
          end: roundPt(p.end),
          size: roundPt(p.size),
          ...(p.font !== undefined ? { font: p.font } : {}),
        });
      }
      out.push({ cells, xs, items });
    }
  }
  return out;
}

type PdfjsModule = Pick<typeof Pdfjs, "getDocument">;

/**
 * pdf.js and its worker, imported on first use. The worker's URL comes from
 * Vite (`?url`), so it is emitted beside our own assets and served from our
 * origin.
 */
export async function loadPdfjs(): Promise<PdfjsModule> {
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
}

/**
 * Read every page's lines. Never throws: a file it cannot read comes back
 * `{ ok: false, reason }`, and a read that runs past `timeoutMs` (default
 * `PDF_READ_TIMEOUT_MS`) is stopped, its task destroyed, and refused as
 * `malformed`. `pdfjs` is injectable so a Node probe can hand in the same
 * module the browser loads.
 */
export async function readPdfLines(
  input: Uint8Array | ArrayBuffer,
  options: { pdfjs?: PdfjsModule; timeoutMs?: number } = {},
): Promise<PdfRead> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length > PDF_MAX_FILE_BYTES) return { ok: false, reason: "too-big" };
  let task: Pdfjs.PDFDocumentLoadingTask | null = null;
  let stopped = false;
  let destroyed: Promise<unknown> | null = null;
  // Ends the worker's copy of the document too. Once only, whichever of the
  // read and the timeout gets there first.
  const destroy = () => {
    if (!task) return Promise.resolve();
    destroyed ??= task.destroy().catch(() => undefined);
    return destroyed;
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<PdfRead>((resolve) => {
    timer = setTimeout(() => {
      stopped = true;
      resolve({ ok: false, reason: "malformed" });
    }, options.timeoutMs ?? PDF_READ_TIMEOUT_MS);
  });
  try {
    return await Promise.race([readAll(), timeout]);
  } finally {
    clearTimeout(timer);
    stopped = true;
    await destroy();
  }

  async function readAll(): Promise<PdfRead> {
    try {
      const pdfjs = options.pdfjs ?? (await loadPdfjs());
      if (stopped) return { ok: false, reason: "malformed" };
      task = pdfjs.getDocument({
        // pdf.js may transfer the buffer to its worker: hand it a copy.
        data: bytes.slice(),
        disableFontFace: true,
        enableXfa: false,
        useSystemFonts: false,
        stopAtErrors: false,
      });
      const doc = await task.promise;
      if (stopped) return { ok: false, reason: "malformed" };
      if (doc.numPages > PDF_MAX_PAGES) return { ok: false, reason: "too-many-pages" };
      const lines: PdfLine[] = [];
      let truncatedAfterPage: number | undefined;
      for (let page = 1; page <= doc.numPages; page++) {
        const content = await (await doc.getPage(page)).getTextContent();
        if (stopped) return { ok: false, reason: "malformed" };
        const items = content.items.filter((item): item is TextItem => "str" in item);
        for (const { cells, xs, items: runs } of groupPageItems(items)) {
          if (lines.length >= PDF_MAX_LINES) break;
          lines.push({ page, line: lines.length + 1, cells, xs, items: runs });
        }
        // A page past the item cap was grouped only in part: nothing after it
        // is read, and the read says where it stopped.
        if (items.length > PDF_MAX_PAGE_ITEMS || (lines.length >= PDF_MAX_LINES && page < doc.numPages)) {
          truncatedAfterPage = page;
          break;
        }
      }
      return truncatedAfterPage === undefined
        ? { ok: true, lines, pages: doc.numPages }
        : { ok: true, lines, pages: doc.numPages, truncatedAfterPage };
    } catch (error) {
      const name = (error as { name?: string } | null)?.name;
      if (name === "PasswordException") return { ok: false, reason: "password" };
      return { ok: false, reason: "malformed" };
    } finally {
      await destroy();
    }
  }
}
