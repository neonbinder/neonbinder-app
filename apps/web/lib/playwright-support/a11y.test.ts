/**
 * NEO-628 — `playwright/support/a11y.ts` `runAxe`: the order of
 * `.options({ resultTypes })` and `.withTags(...)`. AxeBuilder's `options()`
 * REPLACES its whole option object and `withTags()` adds `runOnly` to it, so
 * options-after-tags silently drops the tag filter and runs EVERY rule (a
 * green suite that checks more, or the other way round a lost resultTypes that
 * keeps every node of every pass: the slow path this ticket removed).
 *
 * The stub AxeBuilder below keeps AxeBuilder's replace-vs-merge semantics and
 * records the option object each `analyze()` actually ran with. Lives under
 * lib/ (collected as a node test): playwright/ is excluded from the unit run.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";

type Opts = Record<string, unknown>;
const ran: Opts[] = [];
const calls: string[] = [];
let nextResults: { violations: unknown[]; incomplete: unknown[]; passes: unknown[]; testEngine?: { version: string } };

vi.mock("@axe-core/playwright", () => ({
  default: class StubAxeBuilder {
    private opts: Opts = {};
    options(o: Opts) {
      calls.push("options");
      this.opts = o; // replaces, like the real builder
      return this;
    }
    withTags(tags: string[]) {
      calls.push("withTags");
      this.opts = { ...this.opts, runOnly: { type: "tag", values: tags } };
      return this;
    }
    exclude() {
      return this;
    }
    include() {
      return this;
    }
    async analyze() {
      ran.push(this.opts);
      return nextResults;
    }
  },
}));
vi.mock("../../playwright/support/theme", () => ({
  pageHasBanner: async () => true,
  paintsLook: async () => true,
}));

import { WCAG_TAGS, checkAccessibility } from "../../playwright/support/a11y";

const page = {
  url: () => "https://example.test/players",
  emulateMedia: async () => undefined,
  waitForFunction: async () => undefined,
  evaluate: async () => false,
};

function testInfo() {
  const attach = vi.fn(async () => undefined);
  return { attach, info: { project: { name: "desktop" }, annotations: [], attach } as never };
}

beforeEach(() => {
  ran.length = 0;
  calls.length = 0;
  nextResults = { violations: [], incomplete: [], passes: [] };
});

describe("runAxe option order", () => {
  test("options() is applied before withTags(), so the final option object keeps both", async () => {
    await checkAccessibility(page as never, testInfo().info);
    expect(calls.slice(0, 2)).toEqual(["options", "withTags"]);
    expect(ran.length).toBeGreaterThan(0);
    for (const opts of ran) {
      expect(opts).toEqual({
        resultTypes: ["violations", "incomplete"],
        runOnly: { type: "tag", values: [...WCAG_TAGS] },
      });
    }
  });

  test("the WCAG tag filter is never empty or dropped from a run", async () => {
    await checkAccessibility(page as never, testInfo().info);
    for (const opts of ran) {
      const runOnly = opts.runOnly as { values: string[] } | undefined;
      expect(runOnly?.values).toEqual([...WCAG_TAGS]);
    }
  });
});

describe("the attachment still carries the result counts", () => {
  test("passes, incomplete and violations counts reach the attached JSON for each mode", async () => {
    nextResults = {
      testEngine: { version: "4.13.0" },
      violations: [],
      incomplete: [{ id: "color-contrast", impact: "serious", help: "h", nodes: [{}, {}] }],
      passes: [{ id: "a" }, { id: "b" }, { id: "c" }],
    };
    const { attach, info } = testInfo();
    await checkAccessibility(page as never, info);
    expect(attach).toHaveBeenCalledTimes(1);
    const [, arg] = attach.mock.calls[0] as unknown as [string, { body: string }];
    const body = JSON.parse(arg.body);
    expect(body.modesChecked).toEqual(["light", "dark"]);
    for (const mode of ["light", "dark"]) {
      expect(body.modes[mode].passes).toBe(3);
      expect(body.modes[mode].incomplete).toEqual([{ id: "color-contrast", impact: "serious", help: "h", count: 2 }]);
      expect(body.modes[mode].violations).toEqual([]);
    }
    expect(body.tags).toEqual([...WCAG_TAGS]);
  });

  test("a violation reaches the attachment with its node and fails the check", async () => {
    nextResults = {
      violations: [
        {
          id: "label",
          impact: "critical",
          help: "Form elements must have labels",
          description: "d",
          helpUrl: "u",
          tags: [],
          nodes: [{ target: ["#x"], impact: "critical", failureSummary: "fix", html: "<input>" }],
        },
      ],
      incomplete: [],
      passes: [{ id: "a" }],
    };
    const { attach, info } = testInfo();
    await expect(checkAccessibility(page as never, info)).rejects.toThrow();
    const [, arg] = attach.mock.calls[0] as unknown as [string, { body: string }];
    const body = JSON.parse(arg.body);
    expect(body.modes.light.violations).toHaveLength(1);
    expect(body.modes.light.passes).toBe(1);
    expect(arg.body).not.toContain("<input>");
  });
});
