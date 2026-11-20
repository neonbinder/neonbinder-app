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
const guideLines = new Set(readFileSync(join(dir, "GUIDE.md"), "utf8").split(/\r?\n/));

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
