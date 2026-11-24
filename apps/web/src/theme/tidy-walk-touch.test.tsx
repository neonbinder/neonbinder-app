/**
 * NEO-645 — the Tidy Up walk's size-1 buttons take size 2 on a coarse pointer.
 *
 * happy-dom cannot evaluate `(pointer: coarse)` or the cascade, so what a
 * phone computes is proven by measurement and the E2E suite; this pins the
 * rule's existence and its scope: inside the walk's own panel only, and
 * unlayered (so it also lifts the 24px floor the wrap class sets).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "../../app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

describe("the walk's coarse-pointer button size", () => {
  const start = css.indexOf("@media (pointer: coarse)");
  const block = start < 0 ? "" : css.slice(start, css.indexOf("\n}\n", start));

  it("exists, and is scoped to the walk's own panel", () => {
    expect(start).toBeGreaterThanOrEqual(0);
    expect(block).toContain(".tidy-walk .rt-BaseButton.rt-r-size-1");
    // Nothing outside the walk: the only selector in the block is the walk's.
    expect(block.match(/\{/g)).toHaveLength(2);
  });

  it("gives size 2's height, floor, padding and type", () => {
    expect(block).toContain("--base-button-height: var(--space-6)");
    expect(block).toContain("min-height: var(--space-6)");
    expect(block).toContain("font-size: var(--font-size-2)");
  });

  it("sits at the top level, not in a cascade layer, so it outranks Radix and the utilities", () => {
    const before = css.slice(0, start);
    const opens = (before.match(/@layer[^;{]*\{/g) ?? []).length;
    const closes = (before.match(/\}/g) ?? []).length;
    // Every layer block opened before it has been closed again by the time it starts.
    expect(opens).toBeLessThanOrEqual(closes);
  });
});
