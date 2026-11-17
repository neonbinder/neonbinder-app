/**
 * NEO-569 — the free-text `features.league` is retired: a set's leagues are
 * `selectorOptions.leagueIds` and a card's is `cardChecklist.leagueId`. The
 * armed `leagueBackfill.ts` is the ONE module that still reads the legacy key
 * (to resolve it once, then strip it). A new reader anywhere in the app — a
 * listing builder, a filter, a panel — would put the old text back in front of
 * a person or a marketplace, so this test greps the source for one.
 *
 * Comments are stripped before matching, so a doc line that names the old key
 * is not a reader.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "vitest";

const APP_ROOT = join(__dirname, "..");
const ROOTS = ["convex", "lib", "components", "app", "src"];
const ALLOWED = new Set(["convex/leagueBackfill.ts"]);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "_generated") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(path, out);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(path);
  }
  return out;
}

/** The source with `//` and `/* *\/` comments removed (strings are left alone). */
function withoutComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

const LEGACY_READ = /features\??\.league\b|features\??\[\s*["'`]league["'`]\s*\]/;

describe("NEO-569: only leagueBackfill.ts reads the retired features.league", () => {
  test("no other module reads it", () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      let files: string[] = [];
      try {
        files = sourceFiles(join(APP_ROOT, root));
      } catch {
        continue;
      }
      for (const file of files) {
        const rel = relative(APP_ROOT, file).split("\\").join("/");
        if (ALLOWED.has(rel)) continue;
        if (LEGACY_READ.test(withoutComments(readFileSync(file, "utf8")))) offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("the backfill does read it (so the pin is not vacuous)", () => {
    const src = withoutComments(readFileSync(join(__dirname, "leagueBackfill.ts"), "utf8"));
    expect(src).toMatch(LEGACY_READ);
  });
});
