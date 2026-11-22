/**
 * NEO-645 — one writer for the `cardPrintedNames` side table, the twin of
 * `cardTeamLinks.pin.test.ts`.
 *
 * The table is derived from the card plus its `tidyNames` row. Two copies of
 * one fact can disagree, and silently: a card whose printed rows are missing
 * simply never receives an answer's fan-out. So exactly one module
 * (`cardPrintedNames.ts`) inserts, patches or deletes, and exactly one module
 * reads the table, apart from the named reset drain.
 *
 * ## What W1b still has to pin
 *
 * This file pins the table's own single-writer property, which holds from the
 * day the table exists. The "every writer of `pendingPlayerNames` /
 * `pendingTeamNames` reaches `syncCardPrintedNames` in the same function" and
 * "`insertCardRow` / `removeCardRow` call the helpers" checks need those
 * callers wired, which is W1b; add them here, in the shape of
 * `cardTeamLinks.pin.test.ts`'s `enclosing`/`dbCalls` helpers, when they are.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const CONVEX_DIR = __dirname;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "_generated" || entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) continue;
    out.push(full);
  }
  return out;
}

const isFile = (file: string, name: string) => file.endsWith(join("convex", name));

describe("NEO-645: only cardPrintedNames.ts writes or reads the printed-names table", () => {
  test("no other module inserts into, patches or deletes cardPrintedNames", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(CONVEX_DIR)) {
      if (isFile(file, "cardPrintedNames.ts")) continue;
      const src = readFileSync(file, "utf8");
      if (/\.insert\(\s*"cardPrintedNames"/.test(src)) offenders.push(`${file}: insert`);
      // A patch or delete takes a document id, so the table name never appears
      // in the call. Those can only be reached through a row, and rows can only
      // be read through this module (the next test pins that), so an insert
      // and a read are the two doors worth watching.
    }
    expect(offenders).toEqual([]);
  });

  test("no other module queries the table, except the reset drain by name and position", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(CONVEX_DIR)) {
      if (isFile(file, "cardPrintedNames.ts")) continue;
      const src = readFileSync(file, "utf8");
      const queries = src.match(/query\(\s*"cardPrintedNames"/g) ?? [];
      if (queries.length === 0) continue;
      if (isFile(file, "selectorOptions.ts")) {
        // The E2E head-of-run reset drain (`resetCardPrintedNamesBatch`, added
        // with the reset steps) is the one sanctioned reader outside.
        const drain = src.indexOf("export const resetCardPrintedNamesBatch");
        if (
          drain !== -1 &&
          queries.length === 1 &&
          src.indexOf('query("cardPrintedNames"') > drain
        ) {
          continue;
        }
      }
      offenders.push(`${file}: query`);
    }
    expect(offenders).toEqual([]);
  });

  test("the module's one insert sits inside syncCardPrintedNames, its deletes inside the two writers", () => {
    const src = readFileSync(join(CONVEX_DIR, "cardPrintedNames.ts"), "utf8");
    expect(src.match(/ctx\.db\.insert\("cardPrintedNames"/g) ?? []).toHaveLength(1);
    const writer = src.slice(
      src.indexOf("export async function syncCardPrintedNames"),
      src.indexOf("export async function deleteCardPrintedNames"),
    );
    expect(writer).toContain('ctx.db.insert("cardPrintedNames"');
    expect(writer).toContain("ctx.db.delete(id)");
    expect(writer).toContain("ctx.db.patch(id, patch)");
    // Deletes: the diff's own, and the whole-card delete.
    expect(src.match(/ctx\.db\.delete\(/g) ?? []).toHaveLength(2);
    // Patches: the diff's only.
    expect(src.match(/ctx\.db\.patch\(/g) ?? []).toHaveLength(1);
  });

  test("the table is declared once, with the two indexes the readers use", () => {
    const schema = readFileSync(join(CONVEX_DIR, "schema.ts"), "utf8");
    const at = schema.indexOf("cardPrintedNames: defineTable(");
    expect(at).toBeGreaterThan(0);
    const decl = schema.slice(at, at + 3000);
    expect(decl).toContain('.index("by_scope_kind_name", ["scopeId", "kind", "nameNormalized"])');
    expect(decl).toContain('.index("by_card", ["cardChecklistId"])');
  });
});
