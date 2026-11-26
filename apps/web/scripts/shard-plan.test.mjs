// The shard planner (playwright/shard-plan.mjs). The planner lives under
// playwright/; the unit test sits here, where vitest collects .mjs.
//
// NEO-628: a RUN_TOGETHER group plans at the sum of its specs' measured times,
// with no stale floor on pipeline-escalation-cold-start (300 s against a real
// 19-58 s made its unit the heaviest, so shard 1 always ran minutes short), and
// the former BSC breaker specs are planned in the ordinary shards like any other
// (the BSC call gate is per test user against the fake, so there is no
// `--breaker` list any more).
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MIN_SECONDS, PROJECTS, RUN_TOGETHER, plan } from "../playwright/shard-plan.mjs";
import { ignoredSpecs } from "../playwright/project-scope.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PLANNER = join(HERE, "../playwright/shard-plan.mjs");
const TESTS = join(HERE, "../playwright/tests");
const NOT_PLANNED = new Set(["setup.spec.ts", "profile/worker-bootstrap.spec.ts"]);

const COLD_START = "placeholders/pipeline-escalation-cold-start.spec.ts";
const REAL_SCANS = "collection/add-cards-from-photos-real-scans.spec.ts";
const FORMER_BREAKERS = [
  "set-selector/checklist-fetch-bsc-429-cooldown-holds-the-cards-back-and-queues-them.spec.ts",
  "set-selector/checklist-fetch-bounds-a-bsc-stall-and-queues-the-cards.spec.ts",
];

const shardOf = (shards, spec) => shards.find((s) => s.specs.includes(spec));
const spread = (shards) => Math.max(...shards.map((s) => s.secs)) - Math.min(...shards.map((s) => s.secs));

describe("plan: grouped units and floors", () => {
  it("plans a RUN_TOGETHER group as one unit at the sum of its measured times, in the listed order", () => {
    const shards = plan(2, "e2e", {
      specs: [REAL_SCANS, COLD_START, "a/x.spec.ts", "a/y.spec.ts"],
      timings: { [COLD_START]: 40, [REAL_SCANS]: 200, "a/x.spec.ts": 250, "a/y.spec.ts": 10 },
      minSeconds: {},
    });
    const group = shardOf(shards, COLD_START);
    expect(group).toBe(shardOf(shards, REAL_SCANS));
    expect(group.specs.slice(0, 2)).toEqual([COLD_START, REAL_SCANS]);
    // 240 for the group, then the 10 s spec on the lighter shard: 250 each.
    expect(group.secs).toBe(250);
    expect(shards.map((s) => s.secs)).toEqual([250, 250]);
  });

  it("the cold-start spec carries no floor, and the group is the real one", () => {
    expect(MIN_SECONDS[COLD_START]).toBeUndefined();
    expect(RUN_TOGETHER).toContainEqual([COLD_START, REAL_SCANS]);
    const shards = plan(8, "e2e", {
      specs: [COLD_START, REAL_SCANS],
      timings: { [COLD_START]: 19, [REAL_SCANS]: 120 },
    });
    expect(shardOf(shards, COLD_START).secs).toBe(139);
  });

  it("keeps the floor mechanism: a listed spec plans at no less than its floor, and weighs its whole unit", () => {
    const timings = { [COLD_START]: 40, [REAL_SCANS]: 200, "a/x.spec.ts": 30 };
    const specs = Object.keys(timings);
    expect(shardOf(plan(2, "e2e", { specs, timings, minSeconds: { "a/x.spec.ts": 300 } }), "a/x.spec.ts").secs).toBe(300);
    expect(shardOf(plan(2, "e2e", { specs, timings, minSeconds: { [COLD_START]: 300 } }), COLD_START).secs).toBe(500);
  });

  it("gives a spec with no timing the median of the known ones", () => {
    const shards = plan(1, "e2e", { specs: ["a/1.spec.ts", "a/2.spec.ts", "a/3.spec.ts", "a/new.spec.ts"], timings: { "a/1.spec.ts": 10, "a/2.spec.ts": 20, "a/3.spec.ts": 90 }, minSeconds: {} });
    expect(shards[0].secs).toBe(140);
  });
});

describe("plan: the real suite", () => {
  const onDisk = readdirSync(TESTS, { recursive: true })
    .map((p) => String(p).split("\\").join("/"))
    .filter((p) => p.endsWith(".spec.ts") && !NOT_PLANNED.has(p))
    .sort();

  for (const project of PROJECTS) {
    it(`plans every spec on ${project} exactly once, the former breaker specs included`, () => {
      const planned = plan(8, project).flatMap((s) => s.specs);
      const ignored = new Set(ignoredSpecs(project));
      expect([...planned].sort()).toEqual(onDisk.filter((p) => !ignored.has(p)));
      for (const spec of FORMER_BREAKERS) expect(planned.filter((p) => p === spec)).toHaveLength(1);
    });

    it(`is level on ${project} with the committed timings (no floor props up one shard)`, () => {
      const shards = plan(8, project);
      expect(shards.every((s) => s.specs.length > 0)).toBe(true);
      expect(spread(shards)).toBeLessThanOrEqual(60);
    });
  }
});

describe("CLI", () => {
  const run = (...args) => spawnSync(process.execPath, [PLANNER, ...args], { encoding: "utf8" });

  it("refuses --breaker as a usage error, and the usage no longer offers it", () => {
    const out = run("--breaker");
    expect(out.status).not.toBe(0);
    expect(out.stderr).toMatch(/usage: shard-plan\.mjs/);
    expect(out.stderr).not.toMatch(/--breaker \|/);
  });

  it("prints one shard's files, each under playwright/tests/", () => {
    const out = run("8", "1", "--project", "e2e-mobile");
    expect(out.status).toBe(0);
    const lines = out.stdout.trim().split("\n");
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).toMatch(/^playwright\/tests\/.+\.spec\.ts$/);
  });
});
