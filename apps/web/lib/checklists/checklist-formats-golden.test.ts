/**
 * NEO-591 step 0 — golden regression for every checklist fixture that exists
 * today. It pins the FULL parse output (leaf mode and set mode) of each
 * format's reader and parser, so a change to read a new PDF layout can prove
 * nothing else moved. A snapshot diff here is a behaviour change: read it,
 * and update only when the change is meant.
 *
 * The new-format fixture (2026-onyx-vintage-baseball.pdf) is deliberately not
 * here: its output is expected to change.
 */
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { parsePublishedChecklist, parsePublishedChecklistCells } from "./parse-published-checklist";
import { readChecklistFile, readChecklistSections, type ChecklistFile } from "./read-checklist-file";
import { readPdfLines } from "./read-pdf-lines";
import { readXlsx } from "./read-xlsx";

const FIXTURES = join(__dirname, "../../playwright/fixtures/checklists");

function fileOf(name: string): ChecklistFile {
  const bytes = new Uint8Array(readFileSync(join(FIXTURES, name)));
  return {
    name,
    size: bytes.length,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) as ArrayBuffer,
  };
}

describe("golden — PDF (Topps layout, real pdf.js)", () => {
  it("pins the reader's cells/xs, the records mapping, and the leaf and set parses", async () => {
    // Node needs pdf.js's legacy build; its API is the browser build's.
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const require = createRequire(import.meta.url);
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
      require.resolve("pdfjs-dist/legacy/build/pdf.worker.min.mjs"),
    ).href;
    const name = "2026-topps-chrome-sample.pdf";
    const bytes = new Uint8Array(readFileSync(join(FIXTURES, name)));

    const read = await readPdfLines(bytes, { pdfjs });
    if (!read.ok) throw new Error(read.reason);
    expect({
      pages: read.pages,
      lines: read.lines.map((l) => ({ cells: l.cells, xs: l.xs })),
    }).toMatchSnapshot("reader output");

    // The real read-checklist-file records mapping, through the same reader.
    const file = await readChecklistFile(fileOf(name), {
      readPdf: (b) => readPdfLines(b, { pdfjs }),
    });
    if (!file.ok || file.input.kind !== "cells") throw new Error("PDF was not read into cells");
    expect(file.input.cells).toMatchSnapshot("records mapping");

    expect(parsePublishedChecklistCells(file.input.cells, { mode: "leaf" })).toMatchSnapshot("leaf parse");
    expect(readChecklistSections(file.input)).toMatchSnapshot("set parse");
  }, 30_000);
});

describe("golden — XLSX", () => {
  it("pins the reader's rows, the records mapping, and the leaf and set parses", async () => {
    const name = "2026-donruss-sample.xlsx";
    const bytes = new Uint8Array(readFileSync(join(FIXTURES, name)));

    const read = await readXlsx(bytes);
    if (!read.ok) throw new Error(read.reason);
    expect(read).toMatchSnapshot("reader output");

    const file = await readChecklistFile(fileOf(name));
    if (!file.ok || file.input.kind !== "cells") throw new Error("XLSX was not read into cells");
    expect(file.input.cells).toMatchSnapshot("records mapping");

    expect(parsePublishedChecklistCells(file.input.cells, { mode: "leaf" })).toMatchSnapshot("leaf parse");
    expect(readChecklistSections(file.input)).toMatchSnapshot("set parse");
  });
});

describe("golden — CSV fixtures", () => {
  const csvs = readdirSync(FIXTURES)
    .filter((f) => f.endsWith(".csv"))
    .sort();

  it("finds the fixtures", () => {
    expect(csvs.length).toBeGreaterThan(30);
  });

  it.each(csvs)("%s: leaf and set parses", async (name) => {
    const text = readFileSync(join(FIXTURES, name), "utf8");
    expect(parsePublishedChecklist(text, { mode: "leaf" })).toMatchSnapshot("leaf parse");

    const file = await readChecklistFile(fileOf(name));
    if (!file.ok) throw new Error(file.message);
    expect(readChecklistSections(file.input)).toMatchSnapshot("set parse");
  });
});
