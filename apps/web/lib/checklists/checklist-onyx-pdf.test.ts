/**
 * NEO-591 — the real Onyx Vintage checklist PDF, end to end: legacy pdf.js →
 * `readPdfLines` → `readChecklistFile`'s records mapping → the set-mode parse →
 * `classifySections`. No stand-ins: the fixture's own text runs decide which
 * column a word is in (the surname "De La Torre" and the given name "Luis"
 * sit 17.5 pt apart, under the 18.2 pt cell gap, so the reader merges them).
 *
 * The expected values were checked against the fixture's own text, not copied
 * from the output.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { classifySections } from "./classify-sections";
import { readChecklistFile, readChecklistSections, type ChecklistFile } from "./read-checklist-file";
import { readPdfLines } from "./read-pdf-lines";

const NAME = "2026-onyx-vintage-baseball.pdf";
const BASE = "Base Cards";
const AUTOS = "Player Autographs";
const DUAL = "Dual Autographs";

type Sections = ReturnType<typeof readChecklistSections>;
type Row = Sections["sections"][number]["rows"][number];

let sections: Sections;
let recordCount = 0;
let recordsWithRuns = 0;

beforeAll(async () => {
  // Node needs pdf.js's legacy build; its API is the browser build's.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const require = createRequire(import.meta.url);
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
    require.resolve("pdfjs-dist/legacy/build/pdf.worker.min.mjs"),
  ).href;
  const bytes = new Uint8Array(
    readFileSync(join(__dirname, "../../playwright/fixtures/checklists", NAME)),
  );
  const file: ChecklistFile = {
    name: NAME,
    size: bytes.length,
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) as ArrayBuffer,
  };
  const read = await readChecklistFile(file, { readPdf: (b) => readPdfLines(b, { pdfjs }) });
  if (!read.ok || read.input.kind !== "cells") throw new Error("the Onyx PDF was not read into cells");
  recordCount = read.input.cells.records.length;
  recordsWithRuns = read.input.cells.records.filter((r) => r.items !== undefined).length;
  sections = readChecklistSections(read.input);
}, 30_000);

const section = (name: string) => {
  const found = sections.sections.find((s) => s.name === name);
  if (!found) throw new Error(`no section ${name}`);
  return found;
};
const rowFor = (sectionName: string, player: string): Row[] =>
  section(sectionName).rows.filter((r) => r.players.includes(player));

describe("Onyx Vintage Baseball 2026 PDF through the real reader and parser", () => {
  it("hands the text runs on to the parser because the header names Last Name and First Name", () => {
    expect(recordCount).toBeGreaterThan(0);
    expect(recordsWithRuns).toBe(recordCount);
  });

  it("finds exactly three sections with the printed row counts", () => {
    expect(sections.sections.map((s) => [s.name, s.rows.length])).toEqual([
      [BASE, 56],
      [AUTOS, 38],
      [DUAL, 2],
    ]);
    expect(sections.rowCount).toBe(96);
    expect(sections.skippedSections).toEqual([]);
  });

  it("gives every card the number NNO and flags it as having no number", () => {
    const rows = sections.sections.flatMap((s) => s.rows);
    expect(rows).toHaveLength(96);
    expect(rows.every((r) => r.number === "NNO" && r.noNumber === true)).toBe(true);
  });

  it("skips only the title line, as above the column headings", () => {
    expect(sections.skipped).toEqual([
      {
        line: 1,
        page: 1,
        text: "2026 Onyx Vintage Baseball Checklist - FINAL",
        reason: "Above the column headings",
      },
    ]);
  });

  it("classifies Base Cards as the base section", () => {
    const names = sections.sections.map((s) => s.name);
    expect(classifySections(names).base).toBe(BASE);
    const withEvidence = sections.sections.map((s) => ({
      name: s.name,
      numbers: s.rows.map((r) => r.number),
      rowCount: s.rows.length,
    }));
    expect(classifySections(withEvidence).base).toBe(BASE);
  });

  it("splits a surname that sits within the cell gap of the given name (De La Torre, Luis)", () => {
    for (const name of [BASE, AUTOS]) {
      expect(rowFor(name, "Luis De La Torre")).toEqual([
        { number: "NNO", players: ["Luis De La Torre"], teams: ["San Francisco"], noNumber: true },
      ]);
    }
  });

  it("reads a team on page 1 and one on page 2 (the page with no header row)", () => {
    expect(rowFor(BASE, "Kade Anderson")).toEqual([
      { number: "NNO", players: ["Kade Anderson"], teams: ["Seattle"], noNumber: true },
    ]);
    expect(rowFor(BASE, "JJ Wetherholt")).toEqual([
      { number: "NNO", players: ["JJ Wetherholt"], teams: ["St Louis"], noNumber: true },
    ]);
  });

  it("keeps a hyphenated surname whole in both sections", () => {
    for (const name of [BASE, AUTOS]) {
      expect(rowFor(name, "Avery Owusu-Asiedu")).toEqual([
        { number: "NNO", players: ["Avery Owusu-Asiedu"], teams: ["Arizona"], noNumber: true },
      ]);
    }
  });

  it("keeps the brackets of a team that needs them to be told apart (New York (N))", () => {
    for (const name of [BASE, AUTOS]) {
      expect(rowFor(name, "Joe Scarborough")[0].teams).toEqual(["New York (N)"]);
    }
  });

  it("reads Prospect (Oklahoma) as a prospect with a held-for-the-server team, not a team string", () => {
    expect(rowFor(BASE, "Cord Rager")).toEqual([
      {
        number: "NNO",
        players: ["Cord Rager"],
        teams: [],
        noNumber: true,
        prospect: true,
        prospectTeams: ["Oklahoma"],
      },
    ]);
  });

  it("reads a bare Prospect as a prospect with No Team", () => {
    expect(rowFor(AUTOS, "Cord Rager")).toEqual([
      {
        number: "NNO",
        players: ["Cord Rager"],
        teams: [],
        noNumber: true,
        noTeam: true,
        prospect: true,
      },
    ]);
  });

  it("keeps a multi-word college in Prospect (Dallas Baptist)", () => {
    const [row] = rowFor(BASE, "Russ Smith");
    expect(row.prospect).toBe(true);
    expect(row.prospectTeams).toEqual(["Dallas Baptist"]);
    expect(row.teams).toEqual([]);
    expect(row.noTeam).toBeUndefined();
  });

  it("reads the dual autograph as one card of two players with no team and no No Team claim", () => {
    expect(section(DUAL).rows).toContainEqual({
      number: "NNO",
      players: ["Paul Skenes", "Konnor Griffin"],
      teams: [],
      noNumber: true,
    });
    expect(section(DUAL).rows.every((r) => r.teams.length === 0 && r.noTeam === undefined)).toBe(true);
  });

  it("never plants a prospect's X in a team list anywhere in the file", () => {
    const x = new Set(
      sections.sections.flatMap((s) => s.rows.flatMap((r) => r.prospectTeams ?? [])),
    );
    expect([...x].sort()).toContain("Oklahoma");
    for (const r of sections.sections.flatMap((s) => s.rows)) {
      for (const team of r.teams) expect(x.has(team)).toBe(false);
    }
  });
});
