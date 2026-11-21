/**
 * NEO-638 — scanFile skips the TypeScript parse for a file whose text cannot
 * hold a palette class. The skip must never hide a finding: for every source
 * below, the prefiltered answer equals the full scan's, and the ones that
 * hold a violation really are flagged.
 */
import { describe, expect, it } from "vitest";
import { mayHoldViolation, scanSource } from "./scan-theme.mjs";

const FLAGGED = {
  "a className string": `export const a = <div className="bg-gray-900" />;`,
  "a hued step": `const a = "text-amber-300";`,
  "a cn() argument": `const a = cn("p-2", open && "border-red-600");`,
  "a clsx object key": `const a = clsx({ "bg-slate-800": on });`,
  "a template chunk": "const a = `flex ${x} text-white`;",
  "a template tail": "const a = `${x} bg-black/60`;",
  "a template head": "const a = `bg-black ${x}`;",
  "a hover variant": `const a = "hover:bg-blue-500";`,
  "a stacked variant": `const a = "md:hover:ring-gray-500/50";`,
  "an arbitrary variant": `const a = "[&>svg]:text-pink-400";`,
  "dark: alone": `const a = "dark:p-2";`,
  "an arbitrary hex": `const a = "bg-[#00D558]";`,
  "an arbitrary color: hex": `const a = "text-[color:#fff]";`,
  "a negative-prefixed utility": `const a = "-bg-gray-100";`,
  "an important prefix": `const a = "!bg-gray-100";`,
  "a single-quoted string": `const a = 'text-white';`,
  "a ts file constant": `export const TONE: Record<string, string> = { a: "border-green-600" };`,
  "an identity escape in the token": `const a = "\\dark:p-2";`,
  "an identity escape in the colour": `const a = "bg-\\gray-900";`,
  "a hex escape": `const a = "\\x64ark:p-2";`,
  "a unicode escape": `const a = "\\u0064ark:p-2";`,
  "a braced unicode escape": `const a = "\\u{64}ark:p-2";`,
  "an octal escape": `const a = "bg-gray-\\071\\060\\060";`,
  "a digit escape in the step": `const a = "bg-gray-\\9";`,
  "a line continuation": 'const a = "bg-gr\\\nay-900";',
  "a CRLF line continuation": 'const a = "bg-gr\\\r\nay-900";',
  "a separator escape before the token": `const a = "p-2\\nbg-gray-900";`,
};

const CLEAN = {
  "an empty file": ``,
  "role classes": `const a = "bg-surface text-ink-2 border-rule";`,
  "a black shadow": `const a = "shadow-black/40";`,
  "concatenated halves (the full scan sees only halves)": `const a = "bg-" + "gray-900";`,
  "a template built from a variable": "const a = `bg-${tone}-900`;",
  "a comment naming a class": `// bg-gray-900 dark:p-2\nconst a = 1;`,
  "an identifier": `const darkMode = true;`,
};

describe("scan-theme prefilter", () => {
  for (const [name, src] of Object.entries({ ...FLAGGED, ...CLEAN })) {
    for (const rel of ["x.tsx", "x.ts"]) {
      it(`${name} (${rel}): prefilter never hides what the full scan finds`, () => {
        const full = scanSource(rel, src);
        if (full.length > 0) expect(mayHoldViolation(src)).toBe(true);
      });
    }
  }

  for (const [name, src] of Object.entries(FLAGGED)) {
    it(`${name}: the full scan flags it, so the file reaches the parser`, () => {
      expect(scanSource("x.tsx", src).length).toBeGreaterThan(0);
      expect(mayHoldViolation(src)).toBe(true);
    });
  }

  it("a file with no palette text is skipped", () => {
    expect(mayHoldViolation(`const a = "bg-surface text-ink-2";`)).toBe(false);
  });
});
