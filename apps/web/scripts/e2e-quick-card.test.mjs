// NEO-622: playwright/QUICK.md is a one-page card of GUIDE.md and indexes GUIDE by its
// exact heading lines. If a GUIDE heading is renamed the index goes stale, and an
// agent opening "a section by heading" finds nothing. Every first cell of the table
// under "## GUIDE index" must be a whole line of GUIDE.md.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "playwright");
const quick = readFileSync(join(dir, "QUICK.md"), "utf8").split(/\r?\n/);
const guideText = readFileSync(join(dir, "GUIDE.md"), "utf8");
const guideLines = new Set(guideText.split(/\r?\n/));
const quickText = quick.join("\n");

/** First cells of the table rows under "## GUIDE index" (header and separator skipped). */
function indexedHeadings() {
  const start = quick.findIndex((l) => l.startsWith("## GUIDE index"));
  if (start < 0) return [];
  const cells = [];
  for (const line of quick.slice(start + 1)) {
    if (line.startsWith("## ")) break;
    if (!line.startsWith("|")) continue;
    const first = line.split("|")[1]?.trim() ?? "";
    if (first === "GUIDE heading" || /^-+$/.test(first)) continue;
    cells.push(first);
  }
  return cells;
}

describe("QUICK.md GUIDE index", () => {
  const headings = indexedHeadings();

  it("lists the GUIDE sections (the table is found and not empty)", () => {
    expect(headings.length).toBeGreaterThanOrEqual(10);
  });

  it("every first cell is a markdown heading", () => {
    for (const h of headings) expect(h, h).toMatch(/^#{2,3} \S/);
  });

  it("every first cell matches a whole line of GUIDE.md", () => {
    const missing = headings.filter((h) => !guideLines.has(h));
    expect(missing).toEqual([]);
  });

  it("names no heading twice", () => {
    expect(new Set(headings).size).toBe(headings.length);
  });
});

describe("QUICK.md rule references and budgets", () => {
  // QUICK's own aside says which numbers GUIDE does not define ("GUIDE defines no R6 or R8").
  const disclaimer = quick.find((l) => /GUIDE defines no/.test(l)) ?? "";
  const undefinedRefs = new Set((disclaimer.split("GUIDE defines no")[1]?.match(/\bR\d+a?\b/g) ?? []));
  const cited = quick.filter((l) => !/GUIDE defines no/.test(l)).join("\n");
  const refs = [...new Set(cited.match(/\bR\d+a?\b/g) ?? [])].filter((r) => !undefinedRefs.has(r));
  const guideRefs = new Set(guideText.match(/\bR\d+a?\b/g) ?? []);

  it("names rules at all (the scan finds them)", () => {
    expect(refs.length).toBeGreaterThanOrEqual(5);
  });

  it("the numbers QUICK says GUIDE lacks really are absent (the aside is true)", () => {
    expect([...undefinedRefs].sort()).toEqual(["R6", "R8"]);
    for (const r of undefinedRefs) expect(guideRefs.has(r), r).toBe(false);
  });

  it("every other R<n> / R<n>a it cites is named in GUIDE.md", () => {
    expect(refs.filter((r) => !guideRefs.has(r))).toEqual([]);
  });

  it("every time budget QUICK quotes for actions and launch is in GUIDE.md too", () => {
    // The 7 s UX budget, the 3.5 s BSC measurement line, the 45 s launch gate and the 170 s wait slice.
    for (const budget of ["7 s", "3.5 s", "45 s", "170 s"]) {
      expect(quickText, `QUICK no longer quotes ${budget}`).toContain(budget);
      expect(guideText, `GUIDE does not mention ${budget}`).toContain(budget);
    }
  });
});
