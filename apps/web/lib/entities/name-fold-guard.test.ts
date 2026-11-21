/**
 * NEO-643 — there is ONE character fold for names.
 *
 * `foldNameText` in `lib/entities/normalize-name.ts` is the only place that
 * decomposes a string (NFD/NFKD) or removes combining marks. A second copy is
 * how a matcher quietly stops agreeing with the identity keys: BSC sends
 * "Wilmer R\ios" for Ríos, and a hand-rolled fold that does not delete the
 * backslash (or that runs after a `[^\w\s]` strip) keeps those two names apart.
 *
 * This reads the source of `convex/`, `lib/` and `components/` and fails when
 * one of the fold's ingredients turns up anywhere else. A name matcher that
 * needs a new fold step changes `foldNameText`; it does not grow its own.
 *
 * Test files are exempt (they pin the behaviour, so they spell the characters).
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "vitest";

/** apps/web: this file is lib/entities/name-fold-guard.test.ts. */
const WEB_ROOT = join(__dirname, "..", "..");
const SCANNED_DIRS = ["convex", "lib", "components"];

/** The one module allowed to fold. */
const FOLD_HOME = "lib/entities/normalize-name.ts";

/** Non-name uses of a Unicode normalisation form, each with its reason. */
const ALLOWLIST: Record<string, string> = {
  "lib/collection/share-links.ts": "builds a URL slug for a share link, not a name comparison",
  "convex/lib/easypostWebhookSignature.ts":
    "NFKD-normalises an HMAC secret to match EasyPost's library, not a name",
};

/**
 * What marks a hand-rolled name fold: a decomposing `normalize` call, or the
 * combining-marks range written as an escape or as
 * the literal characters (U+0300 and U+036F, which is how an editor saves it).
 */
const FOLD_INGREDIENTS: Array<{ label: string; pattern: RegExp }> = [
  { label: '.normalize("NFD")', pattern: /\.normalize\(\s*["'`]NFD["'`]\s*\)/ },
  { label: '.normalize("NFKD")', pattern: /\.normalize\(\s*["'`]NFKD["'`]\s*\)/ },
  { label: "combining-mark range escape", pattern: /\\u0?0?300|\\u0?0?36f/i },
  { label: "combining-mark literal", pattern: /[\u0300-\u036f]/ },
];

/** Every non-test `.ts` / `.tsx` under `dir`, recursively. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "_generated" || entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) continue;
    if (/\.test\.tsx?$/.test(entry.name)) continue;
    out.push(full);
  }
  return out;
}

describe("NEO-643: one character fold for names", () => {
  const files = SCANNED_DIRS.flatMap((d) => sourceFiles(join(WEB_ROOT, d))).map((full) => ({
    rel: relative(WEB_ROOT, full).split("\\").join("/"),
    src: readFileSync(full, "utf8"),
  }));

  test("the scan sees the source tree and the fold's home", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((f) => f.rel === FOLD_HOME)).toBe(true);
  });

  test("no module outside normalize-name.ts re-implements the fold", () => {
    const offenders: string[] = [];
    for (const { rel, src } of files) {
      if (rel === FOLD_HOME || rel in ALLOWLIST) continue;
      for (const { label, pattern } of FOLD_INGREDIENTS) {
        if (pattern.test(src)) offenders.push(`${rel}: ${label}`);
      }
    }
    expect(
      offenders,
      "Use foldNameText (lib/entities/normalize-name.ts) instead of a second fold. " +
        "A genuinely non-name use goes on ALLOWLIST with a one-line reason.",
    ).toEqual([]);
  });

  test("every allowlisted file still exists and still needs its exemption", () => {
    for (const rel of Object.keys(ALLOWLIST)) {
      const file = files.find((f) => f.rel === rel);
      expect(file, `${rel} is allowlisted but missing`).toBeDefined();
      expect(
        FOLD_INGREDIENTS.some(({ pattern }) => pattern.test(file!.src)),
        `${rel} no longer folds; drop it from ALLOWLIST`,
      ).toBe(true);
    }
  });

  test("the fold's home really does fold (the guard is not vacuous)", () => {
    const home = files.find((f) => f.rel === FOLD_HOME)!;
    expect(FOLD_INGREDIENTS.some(({ pattern }) => pattern.test(home.src))).toBe(true);
  });
});
