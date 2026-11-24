/**
 * Guard: a Convex test that mocks the credentials module must also warm it.
 *
 * The adapters import "./credentials" and convex-test's function loader
 * imports it too. When those two first imports overlap, vitest builds the
 * async mock factory twice and one importer can fall through to the REAL
 * module, so the code under test reads a real token. That is a random red
 * (it only happens when the imports race), so the cure is a top-level
 * `await import("./credentials")` right after the `vi.mock`, which caches the
 * mocked module before anything can race. This test fails the file that has
 * the mock without the warm-up, instead of a flaky run weeks later.
 *
 * Sources are read with `?raw` (the edge-runtime project has no fs).
 */
import { describe, expect, test } from "vitest";

const sources = (import.meta as unknown as {
  glob: (pattern: string, opts: { query: string; import: string; eager: true }) => Record<string, string>;
}).glob("./**/*.test.ts", { query: "?raw", import: "default", eager: true });

const SELF = "./credentialsMockWarmup.test.ts";
const SPEC = String.raw`(?:\.\/|\.\.\/)+credentials`;
// A mock of the credentials module (any depth), and the line-start top-level
// await of the same module. Comments that merely mention either do not count.
const MOCK = new RegExp(String.raw`^\s*vi\.mock\(\s*["']${SPEC}["']`, "m");
const WARMUP = new RegExp(String.raw`^await import\(\s*["']${SPEC}["']\s*\)`, "m");

const mockers = Object.entries(sources).filter(([path, src]) => path !== SELF && MOCK.test(src));

describe("credentials mock warm-up", () => {
  test("the scan sees the test files and finds known credentials mockers (not vacuous)", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(100);
    const names = mockers.map(([path]) => path);
    expect(names).toContain("./listingSync.test.ts");
    expect(names).toContain("./sportlots.test.ts");
    expect(mockers.length).toBeGreaterThan(10);
  });

  test("the matchers tell a warmed mock from a bare one", () => {
    const bare = `vi.mock("./credentials", () => ({}));\nawait import("./other");`;
    const warmed = `vi.mock("../credentials", () => ({}));\nawait import("../credentials");`;
    const commentOnly = `// await import("./credentials") would warm it\nvi.mock("./credentials", () => ({}));`;
    expect([MOCK.test(bare), WARMUP.test(bare)]).toEqual([true, false]);
    expect([MOCK.test(warmed), WARMUP.test(warmed)]).toEqual([true, true]);
    expect(WARMUP.test(commentOnly)).toBe(false);
  });

  test("every file that mocks credentials also awaits an import of it at top level", () => {
    const unwarmed = mockers.filter(([, src]) => !WARMUP.test(src)).map(([path]) => path);
    expect(unwarmed).toEqual([]);
  });
});
