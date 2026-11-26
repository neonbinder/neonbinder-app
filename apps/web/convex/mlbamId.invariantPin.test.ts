/**
 * NEO-676, invariant 4: an MLB id is linkage, never something user-facing reads.
 *
 * No component, route, hook or browser-side helper may mention `mlbamId`. The
 * id lives in Convex rows and in the loader that writes it; the one place a
 * client could see it is a whole-document reader, and nothing in the client
 * ever names it.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, test } from "vitest";

const APP_ROOT = resolve(__dirname, "..");
const CLIENT_DIRS = ["components", "app", "src", "lib"];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

describe("NEO-676 invariant 4: no client code reads mlbamId", () => {
  test("components/, app/, src/ and the non-convex lib/ never name it", () => {
    const files = CLIENT_DIRS.flatMap((d) => walk(join(APP_ROOT, d)));
    // The pin means something only if it scanned the client.
    expect(files.length).toBeGreaterThan(100);
    const hits = files.filter((f) => /mlbam/i.test(readFileSync(f, "utf8")));
    expect(hits.map((f) => f.slice(APP_ROOT.length + 1))).toEqual([]);
  });
});
