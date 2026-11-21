// NEO-555: the path filters that decide which lanes run must agree across
// pr-pipeline.yml, browser.yml and preprocess.yml. A drift is silent: a path in
// a `pull_request.paths` list but missing from the merge_group `scope` filter
// means the queue skips a lane the PR ran; a wire job gated on the wrong
// output wires a preview URL that was never built.
//
// No YAML parser is a dependency of this runner (`node --test` with no install
// step), so these helpers read the three shapes the workflows use: a block
// list under a key, a `filters: |` string holding `name:` + `- 'glob'` lists,
// and a job's `if: |` block. Every extraction is asserted non-empty so a
// reformat that defeats a helper fails loudly instead of comparing two empties.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (name) => readFileSync(join(REPO_ROOT, ".github", "workflows", name), "utf8").split("\n");

const indentOf = (line) => line.length - line.trimStart().length;
const isBlankOrComment = (line) => line.trim() === "" || line.trim().startsWith("#");

// Parse `- 'glob'` / `- "glob"` / `- glob` (trailing ` # comment` allowed).
function listItem(line) {
  const m = line.trim().match(/^-\s+(.*)$/);
  if (!m) return null;
  let v = m[1].replace(/\s+#.*$/, "").trim();
  if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) v = v.slice(1, -1);
  return v;
}

// Items of the block list directly under `lines[start]` (a `key:` line).
function listUnder(lines, start) {
  const base = indentOf(lines[start]);
  const items = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (isBlankOrComment(lines[i])) continue;
    if (indentOf(lines[i]) <= base) break;
    const item = listItem(lines[i]);
    assert.notEqual(item, null, `unparsed line in list: ${lines[i]}`);
    items.push(item);
  }
  return items;
}

// `on.pull_request.paths` of a workflow.
function pullRequestPaths(lines) {
  const on = lines.findIndex((l) => /^on:\s*$/.test(l));
  assert.notEqual(on, -1, "no top-level `on:`");
  let pr = -1;
  for (let i = on + 1; i < lines.length; i++) {
    if (!isBlankOrComment(lines[i]) && indentOf(lines[i]) === 0) break;
    if (/^ {2}pull_request:\s*$/.test(lines[i])) pr = i;
  }
  assert.notEqual(pr, -1, "no on.pull_request");
  for (let i = pr + 1; i < lines.length; i++) {
    if (isBlankOrComment(lines[i])) continue;
    if (indentOf(lines[i]) <= 2) break;
    if (/^ {4}paths:\s*$/.test(lines[i])) return listUnder(lines, i);
  }
  assert.fail("no on.pull_request.paths");
}

// Every `filters: |` block, parsed to { name: [globs] }.
function filterBlocks(lines) {
  const blocks = [];
  lines.forEach((line, i) => {
    if (!/^\s*filters:\s*\|\s*$/.test(line)) return;
    const base = indentOf(line);
    const body = [];
    for (let j = i + 1; j < lines.length; j++) {
      if (!isBlankOrComment(lines[j]) && indentOf(lines[j]) <= base) break;
      body.push(lines[j]);
    }
    const map = {};
    body.forEach((l, k) => {
      const m = l.match(/^\s*([A-Za-z0-9_]+):\s*$/);
      if (m) map[m[1]] = listUnder(body, k);
    });
    blocks.push(map);
  });
  return blocks;
}

// The `if:` block/line of top-level job `name`, as one string.
function jobIf(lines, name) {
  const start = lines.findIndex((l) => l === `  ${name}:`);
  assert.notEqual(start, -1, `job ${name} not found`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (!isBlankOrComment(lines[i]) && indentOf(lines[i]) <= 2) {
      end = i;
      break;
    }
  }
  for (let i = start + 1; i < end; i++) {
    const m = lines[i].match(/^ {4}if:\s*(.*)$/);
    if (!m) continue;
    if (m[1].trim() !== "|") return m[1];
    const out = [];
    for (let j = i + 1; j < end && (isBlankOrComment(lines[j]) || indentOf(lines[j]) > 4); j++) out.push(lines[j]);
    return out.join("\n");
  }
  assert.fail(`job ${name} has no if:`);
}

const nonEmpty = (arr, what) => {
  assert.ok(arr && arr.length > 0, `${what} extracted empty`);
  return arr;
};
const sorted = (arr) => [...new Set(arr)].sort();

const pipeline = read("pr-pipeline.yml");
const pipelineFilters = (() => {
  const hits = filterBlocks(pipeline).filter((b) => "scripts" in b && "preprocess" in b);
  assert.equal(hits.length, 1, "expected exactly one pipeline filter block with scripts + preprocess");
  return hits[0];
})();

function scopeFilter(file, key) {
  const hits = filterBlocks(read(file)).filter((b) => key in b);
  assert.equal(hits.length, 1, `${file}: expected one filters block with ${key}`);
  return nonEmpty(hits[0][key], `${file} scope.${key}`);
}

test("browser.yml pull_request.paths equals its merge_group scope filter", () => {
  const trigger = nonEmpty(pullRequestPaths(read("browser.yml")), "browser.yml pull_request.paths");
  assert.deepEqual(sorted(scopeFilter("browser.yml", "browser")), sorted(trigger));
});

test("preprocess.yml pull_request.paths equals its merge_group scope filter", () => {
  const trigger = nonEmpty(pullRequestPaths(read("preprocess.yml")), "preprocess.yml pull_request.paths");
  assert.deepEqual(sorted(scopeFilter("preprocess.yml", "preprocess")), sorted(trigger));
});

test("browser.yml lists no fake-bsc path in its trigger or scope", () => {
  const all = [...pullRequestPaths(read("browser.yml")), ...scopeFilter("browser.yml", "browser")];
  assert.deepEqual(all.filter((p) => p.startsWith("services/fake-bsc/")), []);
});

test("pipeline browser_preview equals browser.yml's scope", () => {
  const preview = nonEmpty(pipelineFilters.browser_preview, "pipeline browser_preview");
  assert.deepEqual(sorted(preview), sorted(scopeFilter("browser.yml", "browser")));
});

// Sees only scripts named directly in browser.yml. Scripts those call
// indirectly through `$here/` (bsc-probe-verdict.sh, ebay-probe-verdict.sh) are
// invisible here and must be added to the trigger and scope lists by hand.
test("every script browser.yml runs is in its trigger paths", () => {
  const text = read("browser.yml").join("\n");
  const used = [...text.matchAll(/\.github\/scripts\/([A-Za-z0-9_-]+\.sh)/g)].map((m) => `.github/scripts/${m[1]}`);
  const trigger = pullRequestPaths(read("browser.yml"));
  // Scripts that browser.yml names only inside comments or trigger lists are
  // still in `trigger`; the ones it runs must be.
  assert.deepEqual([...new Set(used)].filter((p) => !trigger.includes(p)), []);
});

test("wire-browser-url waits on the PREVIEW_SHA browser.yml stamps", () => {
  assert.match(read("browser.yml").join("\n"), /PREVIEW_SHA=\$\{\{\s*needs\.scope\.outputs\.sha\s*\}\}/);
  const text = pipeline.join("\n");
  assert.match(text, /wait-preprocess-revision\.sh[^\n]*\\\n[^\n]*--service neonbinder-browser /);
});

test("pipeline preprocess is a subset of preprocess.yml's scope", () => {
  const filter = nonEmpty(pipelineFilters.preprocess, "pipeline preprocess");
  const scope = scopeFilter("preprocess.yml", "preprocess");
  assert.deepEqual(filter.filter((p) => !scope.includes(p)), []);
});

test("wire jobs are gated on browser_preview and preprocess, not browser", () => {
  const browserIf = jobIf(pipeline, "wire-browser-url");
  assert.match(browserIf, /needs\.changes\.outputs\.browser_preview\s*==\s*'true'/);
  assert.doesNotMatch(browserIf, /outputs\.browser\s*==/);
  const preprocessIf = jobIf(pipeline, "wire-preprocess-url");
  assert.match(preprocessIf, /needs\.changes\.outputs\.preprocess\s*==\s*'true'/);
});

test("fake-bsc paths gate browser tests but not the browser preview", () => {
  const fake = nonEmpty(
    nonEmpty(pipelineFilters.browser, "pipeline browser").filter((p) => p.startsWith("services/fake-bsc/")),
    "fake-bsc paths in pipeline browser",
  );
  const preview = nonEmpty(pipelineFilters.browser_preview, "pipeline browser_preview");
  assert.deepEqual(preview.filter((p) => p.startsWith("services/fake-bsc/")), []);
  assert.ok(fake.length > 0);
});

test("scripts filter includes the workflow files", () => {
  assert.ok(nonEmpty(pipelineFilters.scripts, "pipeline scripts").includes(".github/workflows/**"));
});

// NEO-555 (B2): the seller jobs and their queue are retired, and the fake eBay
// wiring is in place. These pins keep a revert or a half-removal red.
test("the marketplace-seller jobs, queue and spec list are fully retired", async () => {
  const { readdirSync, existsSync } = await import("node:fs");
  const dir = join(REPO_ROOT, ".github");
  assert.ok(!existsSync(join(dir, "scripts", "seller-queue.sh")));
  assert.ok(!existsSync(join(dir, "scripts", "seller-queue.test.mjs")));
  const files = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (p !== fileURLToPath(import.meta.url)) files.push(p);
    }
  };
  walk(dir);
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    assert.doesNotMatch(text, /seller-queue|SELLER_SPECS|R_SELLER|seller-(desktop|mobile)|marketplace-seller|testingSellerCleanup|shard-plan\.mjs --seller/, f);
  }
});

test("e2e.yml points the desktop seed at the fake eBay and both seeds assert it", () => {
  const text = read("e2e.yml").join("\n");
  const count = (re) => (text.match(re) || []).length;
  // NEO-628: seed-mobile no longer rewrites the env switches (the desktop seed
  // set them on the same preview); it only re-asserts the eBay target.
  assert.equal(count(/- name: Point the Convex preview at the fake eBay/g), 1);
  assert.equal(count(/env set EBAY_ENVIRONMENT fake /g), 1);
  assert.equal(count(/env remove "\$name"/g), 1);
  for (const n of ["DEV_EBAY_REFRESH_TOKEN", "EBAY_CLIENT_ID", "EBAY_RU_NAME"]) assert.equal(count(new RegExp(`for name in [^\\n]*${n}`, "g")), 1, n);
  assert.equal(count(/fakeBsc:ebayTarget '\{\}'/g), 2);
  assert.equal(count(/credentials:deleteFakeSessionsFromCli/g), 1);
  assert.doesNotMatch(text, /deleteFakeBscSessionsFromCli/);
  // The eBay env is written after the BSC base it depends on.
  assert.ok(text.indexOf("env set EBAY_ENVIRONMENT") > text.indexOf("env set NEONBINDER_BSC_API_BASE"));
});

// NEO-628: seed-mobile starts right after the desktop seed and waits for the
// desktop pass by polling, so a revert to a `needs` edge, a dropped wait or a
// miscounted pattern turns red here instead of in a wiped preview.
test("seed-mobile starts early and waits for the desktop shards by name", () => {
  const text = read("e2e.yml").join("\n");
  const a = text.indexOf("\n  seed-mobile:\n");
  const job = text.slice(a, text.indexOf("\n  shard-mobile:\n"));
  assert.match(job, /\n {4}needs: \[setup, seed\]\n/);
  assert.match(job, /\n {6}actions: read\n/);
  assert.match(job, /wait-for-jobs\.sh/);
  assert.match(job, /--pattern '\^shard-desktop \\\(' --count \d+/);
  assert.doesNotMatch(job, /--pattern '(?!\^shard-desktop)/, "the shards are the only awaited jobs");
  assert.ok(job.indexOf("wait-for-jobs.sh") < job.indexOf("e2e-seed-reset.sh"), "wait precedes the reset");
  assert.ok(job.indexOf("wait-for-jobs.sh") < job.indexOf("Enrichment fixture coverage (desktop shards drained)"), "wait precedes the drained-coverage read");
  assert.doesNotMatch(job, /convex-env-retry\.sh" env (set|remove)/, "no env writes in seed-mobile");
  assert.match(job, /fakeBsc:ebayTarget/);
  // The jobs it waits for are named exactly so, and are never skipped when it runs.
  assert.match(text, /\n {2}shard-desktop:\n/);
  assert.match(text, /\n {2}shard-desktop:[\s\S]*?\n {4}if: \$\{\{ !cancelled\(\) && needs\.setup\.result == 'success' && needs\.seed\.result == 'success' \}\}\n/);
  assert.doesNotMatch(text, /\n {2}[a-z-]*brea[k]er[a-z-]*:\n/, "no carve-out job (the BSC gate is per user)");
});

test("the e2e gate depends on no seller job", () => {
  const gate = read("e2e.yml").find((l) => /^ {4}needs: \[setup, seed, shard-desktop, seed-mobile, shard-mobile\]$/.test(l));
  assert.ok(gate, "the gate needs list is the shard and seed jobs only");
});

test("the dev and preview browser deploys carry no sandbox eBay config", () => {
  const preview = read("browser.yml").join("\n");
  const deploy = read("browser-deploy.yml").join("\n");
  assert.doesNotMatch(preview, /EBAY_CLIENT_ID_SANDBOX|EBAY_RU_NAME_SANDBOX|EBAY_ENVIRONMENT=sandbox|Preflight eBay config/);
  const devLane = deploy.split("\n  ")[0] && deploy.slice(0, deploy.indexOf("EBAY_CLIENT_ID_PRODUCTION"));
  assert.doesNotMatch(devLane, /EBAY_CLIENT_ID_SANDBOX|EBAY_RU_NAME_SANDBOX|EBAY_ENVIRONMENT=sandbox/);
  assert.match(preview, /--remove-env-vars=EBAY_CLIENT_ID,EBAY_RU_NAME,EBAY_ENVIRONMENT --remove-secrets=EBAY_CLIENT_SECRET/);
  assert.match(deploy, /--remove-env-vars=PREVIEW_SHA,EBAY_CLIENT_ID,EBAY_RU_NAME,EBAY_ENVIRONMENT --remove-secrets=EBAY_CLIENT_SECRET/);
  // The prod lane keeps its production eBay config.
  assert.match(deploy, /EBAY_ENVIRONMENT=production/);
});

// NEO-628: the unit-test fan-out. Three numbers must agree or the lane
// silently covers a partial suite (or never goes green): the matrix length,
// N in `--shard=<i>/N`, and the blob count `web-unit` waits for.
const jobSection = (lines, name) => {
  const start = lines.findIndex((l) => l === `  ${name}:`);
  assert.notEqual(start, -1, `job ${name} not found`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (!isBlankOrComment(lines[i]) && indentOf(lines[i]) <= 2) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
};

test("pipeline web-unit-shard matrix length equals the --shard=<i>/N total and web-unit's blob count", () => {
  const shardJob = jobSection(pipeline, "web-unit-shard");
  const matrix = shardJob.match(/\n {8}shard: \[([^\]]*)\]\n/);
  assert.ok(matrix, "web-unit-shard matrix.shard list not found");
  const entries = matrix[1].split(",").map((s) => s.trim()).filter(Boolean);
  assert.ok(entries.length > 1, "matrix extracted (sharding needs at least 2)");
  assert.deepEqual(entries, entries.map((_, i) => String(i + 1)), "shards are 1..N");
  const flag = shardJob.match(/--shard=\$\{\{ matrix\.shard \}\}\/(\d+)/);
  assert.ok(flag, "no --shard=<i>/N in the vitest command");
  assert.equal(Number(flag[1]), entries.length, "--shard total equals the matrix length");

  const unitJob = jobSection(pipeline, "web-unit");
  const expected = unitJob.match(/if \[ "\$n" != "(\d+)" \]/);
  assert.ok(expected, "no blob-count comparison in web-unit");
  assert.equal(Number(expected[1]), entries.length, "web-unit expects one blob per shard");
  const msg = unitJob.match(/Expected (\d+) vitest blob reports/);
  assert.ok(msg, "no blob-count error message in web-unit");
  assert.equal(Number(msg[1]), entries.length, "the error message names the same count");
});

test("pipeline web-unit runs after failed shards and fails unless every shard succeeded", () => {
  const unitJob = jobSection(pipeline, "web-unit");
  assert.match(unitJob, /\n {4}needs: \[changes, web-unit-shard\]\n/);
  assert.match(unitJob, /\n {4}if: \$\{\{ always\(\) && needs\.changes\.outputs\.web == 'true' \}\}\n/);
  assert.match(unitJob, /SHARDS: \$\{\{ needs\.web-unit-shard\.result \}\}/);
  assert.match(unitJob, /if \[ "\$SHARDS" != "success" \]; then[\s\S]*?exit 1/);
  assert.ok(unitJob.indexOf('"$SHARDS" != "success"') < unitJob.indexOf("download-artifact"), "the shard gate precedes the merge");
});

test("pipeline web-unit-shard uploads the dot-directory blob even when the run failed", () => {
  const shardJob = jobSection(pipeline, "web-unit-shard");
  const step = shardJob.slice(shardJob.indexOf("- name: Upload the blob report"));
  assert.ok(step.startsWith("- name: Upload the blob report"), "upload step found");
  assert.match(step, /if: \$\{\{ !cancelled\(\) \}\}/);
  assert.match(step, /path: apps\/web\/\.vitest\/blob\//);
  assert.match(step, /\n {10}include-hidden-files: true\n/);
  assert.match(step, /if-no-files-found: error/);
});

// NEO-628: seed-mobile's wait counts the desktop shard jobs; the count is the
// matrix size, not a literal that can outlive a resized matrix.
test("e2e.yml seed-mobile waits for exactly as many shard-desktop jobs as the matrix has entries", () => {
  const e2e = read("e2e.yml");
  const desktop = jobSection(e2e, "shard-desktop");
  const entries = [...desktop.matchAll(/\n {10}- \{ shard: (\d+), worker: (\d+) \}/g)];
  assert.ok(entries.length > 1, "shard-desktop matrix.include extracted");
  assert.deepEqual(entries.map((m) => Number(m[1])), entries.map((_, i) => i + 1), "shards are 1..N");
  const wait = jobSection(e2e, "seed-mobile").match(/--pattern '\^shard-desktop \\\(' --count (\d+)/);
  assert.ok(wait, "seed-mobile wait-for-jobs.sh --count not found");
  assert.equal(Number(wait[1]), entries.length);
});

// NEO-628: the jobs this work touched check out with the token NOT written to
// .git/config, so a later step (or a spec's subprocess) cannot push with it.
// A job with no checkout fails too: a rename must not empty the loop.
const checkoutSteps = (jobText) => {
  const lines = jobText.split("\n");
  const steps = [];
  lines.forEach((l, i) => {
    if (!/^ {6}- uses: actions\/checkout@/.test(l)) return;
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      if (/^ {6}- /.test(lines[j])) {
        end = j;
        break;
      }
    }
    steps.push(lines.slice(i, end).join("\n"));
  });
  return steps;
};

for (const [file, jobs] of [
  ["e2e.yml", ["seed", "shard-desktop", "seed-mobile", "shard-mobile", "e2e"]],
  ["pr-pipeline.yml", ["web-lint", "web-typecheck", "web-unit-shard", "web-unit"]],
]) {
  test(`${file}: every actions/checkout in ${jobs.join(", ")} sets persist-credentials: false`, () => {
    const lines = read(file);
    for (const job of jobs) {
      const steps = checkoutSteps(jobSection(lines, job));
      assert.ok(steps.length > 0, `${file} ${job}: no actions/checkout step found`);
      for (const step of steps) assert.match(step, /\n {10}persist-credentials: false\b/, `${file} ${job}`);
    }
  });
}
