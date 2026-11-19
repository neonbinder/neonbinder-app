// NEO-592: shard-plan.mjs refuses to plan when a seller or breaker spec can retry
// (GUIDE hard rule 5), so a new tagged spec that forgets
// `test.describe.configure({ retries: 0 })` fails planning before CI runs it,
// not only the runtime backstop after its first failure. The planner lives under
// playwright/; the unit test sits here, where vitest collects .mjs.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkNoRetryTagged } from "../playwright/shard-plan.mjs";

const TESTS = join(dirname(fileURLToPath(import.meta.url)), "../playwright/tests");

/** A spec source with the given tag and body lines. */
const spec = (tag, ...lines) =>
  [`import { test } from "../../support/fixtures";`, ...lines, `test("x", { tag: ["${tag}"] }, async () => {});`].join(
    "\n",
  );

const check = (sources) => checkNoRetryTagged(Object.keys(sources), (s) => sources[s]);

describe("checkNoRetryTagged", () => {
  it("passes a seller and a breaker spec that each configure retries: 0", () => {
    expect(
      check({
        "a/seller.spec.ts": spec("@marketplace-seller", "test.describe.configure({ retries: 0 });"),
        "a/breaker.spec.ts": spec("@bsc-breaker", "test.describe.configure({ mode: 'serial', retries: 0 });"),
      }),
    ).toEqual([]);
  });

  it("recognises a tag in single quotes and backticks, not only double quotes", () => {
    const bare = (q) => `import { test } from "x";\ntest("x", { tag: [${q}@marketplace-seller${q}] }, async () => {});`;
    expect(check({ "a/s.spec.ts": bare("'") })).toHaveLength(1);
    expect(check({ "a/s.spec.ts": bare("`") })).toHaveLength(1);
  });

  it("names a tagged spec that lacks the configure call, with its tag", () => {
    expect(
      check({
        "a/seller.spec.ts": spec("@marketplace-seller"),
        "a/breaker.spec.ts": spec("@bsc-breaker"),
      }),
    ).toEqual([
      "a/seller.spec.ts carries @marketplace-seller but lacks test.describe.configure({ retries: 0 }) (GUIDE hard rule 5)",
      "a/breaker.spec.ts carries @bsc-breaker but lacks test.describe.configure({ retries: 0 }) (GUIDE hard rule 5)",
    ]);
  });

  it("refuses a retry count other than 0", () => {
    expect(check({ "a/s.spec.ts": spec("@bsc-breaker", "test.describe.configure({ retries: 1 });") })).toHaveLength(1);
    expect(check({ "a/s.spec.ts": spec("@bsc-breaker", "test.describe.configure({ retries: 10 });") })).toHaveLength(1);
  });

  it("does not count a configure call that only appears in a comment", () => {
    expect(
      check({ "a/s.spec.ts": spec("@marketplace-seller", "// test.describe.configure({ retries: 0 });") }),
    ).toHaveLength(1);
    expect(
      check({ "a/s.spec.ts": spec("@marketplace-seller", "/* test.describe.configure({ retries: 0 }); */") }),
    ).toHaveLength(1);
  });

  it("ignores an untagged spec, with or without retries", () => {
    expect(check({ "a/plain.spec.ts": spec("@smoke") })).toEqual([]);
  });

  it("holds for every spec in the suite today", () => {
    const specs = readdirSync(TESTS, { recursive: true })
      .map(String)
      .filter((p) => p.endsWith(".spec.ts"));
    expect(specs.length).toBeGreaterThan(0);
    expect(checkNoRetryTagged(specs, (s) => readFileSync(join(TESTS, s), "utf8"))).toEqual([]);
  });
});
