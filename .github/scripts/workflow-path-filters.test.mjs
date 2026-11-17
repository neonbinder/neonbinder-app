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
