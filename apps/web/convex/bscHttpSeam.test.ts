/**
 * NEO-552 — `lib/bscHttp.ts` is the only door from Convex to BuySportsCards.
 * A test deployment points that door at the fake; a call that went around it
 * (a host literal, a raw `fetch`) would reach the real BuySportsCards from CI
 * and skip the deployment-wide call gate. This scans the Convex source so a
 * new call site cannot do that by accident. Each detector is also run on a
 * planted line, so a detector that stopped matching fails here too.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, test } from "vitest";

const CONVEX_DIR = __dirname;
const SEAM = join("lib", "bscHttp.ts");

/** Every non-test TypeScript source under convex/, as paths relative to it. */
function convexSources(dir = CONVEX_DIR): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "_generated" || entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...convexSources(full));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(relative(CONVEX_DIR, full));
    }
  }
  return out;
}

const read = (rel: string) => readFileSync(join(CONVEX_DIR, rel), "utf8");

/**
 * The source with comments blanked, so prose ("the filters fetch (...)")
 * is not a call. A `//` after a `:` (a URL) is kept.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}
const code = (rel: string) => stripComments(read(rel));

/** A BuySportsCards host, in any form a URL could take. */
const BSC_HOST = /buysportscards\.com/i;
/** A bare `fetch(` call (not `bscFetch(`, `fakeBscControlFetch(`, `x.fetch(`). */
const RAW_FETCH = /(?<![\w.$])fetch\s*\(|globalThis\.fetch\b/;
/** The real base leaking out of the seam as an export. */
const EXPORTED_BASE = /export\s+(?:const|let|var|function)\s+(?:REAL_API_BASE|REAL_API_HOST|BSC_API_BASE|REAL_SITE_ORIGIN)\b/;

/** The modules that talk to BuySportsCards (or the fake) at all. */
const BSC_CALLERS = [
  join("adapters", "buysportscards.ts"),
  join("adapters", "bscSeller.ts"),
  "bscCallGate.ts",
  "fakeBsc.ts",
  join("lib", "bscFakeIdToken.ts"),
];

describe("the BuySportsCards seam", () => {
  test("the detectors match what they are for", () => {
    expect(BSC_HOST.test('const u = "https://api-prod.BuySportsCards.com/x";')).toBe(true);
    expect(RAW_FETCH.test("  const r = await fetch(url, init);")).toBe(true);
    expect(RAW_FETCH.test("await globalThis.fetch(url)")).toBe(true);
    expect(RAW_FETCH.test("await bscFetch(path, init, opts)")).toBe(false);
    expect(RAW_FETCH.test("await fakeBscControlFetch(path, init, opts)")).toBe(false);
    expect(EXPORTED_BASE.test('export const BSC_API_BASE = "x";')).toBe(true);
    // Comments are not calls; code after a comment still is.
    expect(RAW_FETCH.test(stripComments("// the filters fetch (1 initial)\n/* a fetch (x) */"))).toBe(false);
    expect(RAW_FETCH.test(stripComments("/* note */ await fetch(url);"))).toBe(true);
    expect(BSC_HOST.test(stripComments('const u = "https://www.buysportscards.com";'))).toBe(true);
  });

  test("the scan sees the BSC modules", () => {
    const sources = convexSources();
    for (const file of [SEAM, ...BSC_CALLERS]) expect(sources).toContain(file);
  });

  test("no BuySportsCards host appears outside lib/bscHttp.ts", () => {
    const offenders = convexSources().filter((f) => f !== SEAM && BSC_HOST.test(read(f)));
    expect(offenders).toEqual([]);
  });

  test("no BSC caller sends a raw fetch: every call goes through bscFetch", () => {
    const offenders = BSC_CALLERS.filter((f) => RAW_FETCH.test(code(f)));
    expect(offenders).toEqual([]);
  });

  test("lib/bscHttp.ts keeps the real host private", () => {
    expect(EXPORTED_BASE.test(read(SEAM))).toBe(false);
  });

  test("lib/bscHttp.ts sends from exactly two places: bscFetch and fakeBscControlFetch", () => {
    const calls = code(SEAM).split("\n").filter((line) => RAW_FETCH.test(line));
    expect(calls).toHaveLength(2);
  });

  test("paths are portable across separators", () => {
    expect(SEAM.split(sep).join("/")).toBe("lib/bscHttp.ts");
  });
});
