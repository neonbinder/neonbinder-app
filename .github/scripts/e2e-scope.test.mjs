// NEO-627: branch coverage for e2e-scope.sh. Stubs `gh` on PATH (optionally
// running the script's REAL jq filters against fixture JSON) and builds real git
// repositories with a bare `origin` for the merge_group path; no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = join(REPO_ROOT, ".github", "scripts", "e2e-scope.sh");
const HAVE_JQ = spawnSync("jq", ["--version"]).status === 0;

// The stub answers by endpoint. Raw mode: STUB_LABEL is what the label filter
// would print, STUB_FILES the lines the files filter would print. jq mode
// (STUB_PR_JSON / STUB_COMPARE_JSON = a fixture file): the script's own --jq
// filter is run by the real jq over the fixture, so the filters are tested too.
const STUB = `#!/usr/bin/env bash
filter=""
prev=""
for a in "$@"; do
  [ "$prev" = "--jq" ] && filter="$a"
  prev="$a"
done
serve() { # serve <fail> <json file> <raw text>
  [ -n "$1" ] && exit 1
  if [ -n "$2" ]; then jq -r "$filter" "$2"; else printf '%s' "$3"; fi
}
case "$*" in
  *compare/*) serve "\${STUB_COMPARE_FAIL:-}" "\${STUB_COMPARE_JSON:-}" "\${STUB_FILES:-}" ;;
  *pulls/*)   serve "\${STUB_PR_FAIL:-}" "\${STUB_PR_JSON:-}" "\${STUB_LABEL:-}" ;;
  *) exit 1 ;;
esac
`;

function run(env, cwd = REPO_ROOT) {
  const dir = mkdtempSync(join(tmpdir(), "nb-e2e-scope-"));
  const gh = join(dir, "gh");
  writeFileSync(gh, STUB);
  chmodSync(gh, 0o755);
  const r = spawnSync("bash", [SCRIPT], {
    env: { PATH: `${dir}:${process.env.PATH}`, HOME: dir, GITHUB_REPOSITORY: "acme/app", ...env },
    encoding: "utf8",
    cwd,
  });
  const lines = (r.stdout ?? "").split("\n").filter(Boolean);
  const out = {};
  for (const line of lines) {
    const i = line.indexOf("=");
    if (i > 0) out[line.slice(0, i)] = line.slice(i + 1);
  }
  return { status: r.status, out, lines, stderr: r.stderr ?? "" };
}

const BASE = "b".repeat(40);
const HEAD = "a".repeat(40);

// A compare-API files listing from [filename] or [filename, previous_filename].
const listing = (files) =>
  files
    .map((f) => {
      const [name, prev] = Array.isArray(f) ? f : [f];
      return `F${JSON.stringify(name)}\n` + (prev ? `P${JSON.stringify(prev)}\n` : "");
    })
    .join("");

const pr = (files, extra = {}) => ({
  EVENT_NAME: "pull_request",
  PR_NUMBER: "42",
  BASE_SHA: BASE,
  HEAD_SHA: HEAD,
  STUB_LABEL: "false",
  STUB_FILES: listing(files),
  ...extra,
});

// Every run must print exactly two lines: reason, then e2e_inert LAST and ONCE.
const verdict = (r) => {
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.lines.length, 2, `expected exactly 2 output lines, got ${JSON.stringify(r.lines)}`);
  assert.match(r.lines[0], /^reason=[\x20-\x7e]*$/);
  assert.match(r.lines[1], /^e2e_inert=(true|false)$/);
  return r.out.e2e_inert;
};

// --- pull_request ------------------------------------------------------------

test("pull_request: every allow-list shape is inert", () => {
  const files = [
    ".claude/agent-memory/devops-automator/x.md",
    ".claude/skills/pr-close/SKILL.md",
    "docs/operations/runbook.md",
    "docs/img/a.png",
    "CLAUDE.md",
    "PRODUCT.md",
    "services/fake-bsc/recorder/cli.ts",
    "services/fake-bsc/README.md",
    "services/fake-bsc/tests/id-token-source.test.mjs",
  ];
  const r = run(pr(files));
  assert.equal(verdict(r), "true");
  assert.match(r.out.reason, /all 9 changed paths/);
});

test("pull_request: one outside file makes it full; the reason counts and sanitises", () => {
  const r = run(pr(["docs/a.md", "apps/web/app/page.tsx"]));
  assert.equal(verdict(r), "false");
  assert.match(r.out.reason, /1 of 2 changed paths are outside .*first: apps\/web\/app\/page\.tsx/);
});

test("near-misses of the allow-list are not inert", () => {
  for (const f of [
    "apps/web/CLAUDE.md", // nested *.md is not root
    "services/fake-bsc/CONTRACT.md", // browser tests read it
    "services/fake-bsc/readme.md",
    "services/fake-bsc/README.mdx",
    "services/fake-bsc/src/index.ts",
    "services/fake-bsc/package.json",
    "services/fake-bsc/tests", // a file named tests
    "services/fake-bsc/tests-x/a.mjs",
    "services/fake-bsc/testsx/a.mjs",
    "services/fake-bsc/recorder-extra/x.ts",
    "services/fake-bsc/recorder",
    "apps/web/docs/x.md",
    "Docs/a.md",
    "README.MD",
    "README.mdx",
    ".md", // a bare dotfile is not a document
    "docs", // a file named docs
    ".claude", // a file named .claude
    ".claudex/x",
    ".github/workflows/e2e.yml",
    ".github/scripts/e2e-scope.sh",
    "package.json",
    "notes.txt",
  ]) {
    assert.equal(verdict(run(pr([f]))), "false", f);
  }
});

test("path guards: dot-dot, absolute and empty names are never inert", () => {
  for (const f of ["docs/../apps/web/x.ts", "/etc/x.md", "../x.md", "docs/..", ".."]) {
    assert.equal(verdict(run(pr([f]))), "false", f);
  }
  assert.equal(verdict(run(pr([""]))), "false", "empty name");
});

test("pull_request: a rename out of an outside path is not inert (previous_filename counts)", () => {
  assert.equal(verdict(run(pr([["docs/moved.md", "apps/web/app/page.tsx"]]))), "false");
  assert.equal(verdict(run(pr([["docs/moved.md", "services/browser/src/x.ts"]]))), "false");
});

test("pull_request: a rename between inert paths is inert; INTO an outside path is not", () => {
  assert.equal(verdict(run(pr([["docs/new.md", "docs/old.md"]]))), "true");
  assert.equal(verdict(run(pr([["apps/web/x.ts", "docs/x.md"]]))), "false");
});

test("pull_request: empty file list fails closed", () => {
  assert.equal(verdict(run(pr([]))), "false");
});

test("pull_request: run-e2e label forces full", () => {
  const r = run(pr(["docs/a.md"], { STUB_LABEL: "true" }));
  assert.equal(verdict(r), "false");
  assert.match(r.out.reason, /run-e2e/);
});

test("pull_request: unreadable or garbage label answers fail closed", () => {
  assert.equal(verdict(run(pr(["docs/a.md"], { STUB_PR_FAIL: "1" }))), "false");
  assert.equal(verdict(run(pr(["docs/a.md"], { STUB_LABEL: "" }))), "false");
  assert.equal(verdict(run(pr(["docs/a.md"], { STUB_LABEL: "maybe" }))), "false");
});

test("pull_request: a failing compare fails closed", () => {
  assert.equal(verdict(run(pr(["docs/a.md"], { STUB_COMPARE_FAIL: "1" }))), "false");
});

test("pull_request: at or past the compare API's 300-file cap fails closed; 299 is fine", () => {
  const at = Array.from({ length: 300 }, (_, i) => `docs/f${i}.md`);
  const r = run(pr(at));
  assert.equal(verdict(r), "false");
  assert.match(r.out.reason, /cap/);
  assert.equal(verdict(run(pr(at.slice(0, 299)))), "true");
});

test("pull_request: unparseable listing lines fail closed", () => {
  assert.equal(verdict(run(pr(["docs/a.md"], { STUB_FILES: "docs/a.md\n" }))), "false");
  assert.equal(verdict(run(pr(["docs/a.md"], { STUB_FILES: "Fdocs/a.md\n" }))), "false");
});

test("pull_request: file names with quotes, backslashes or control characters fail closed", () => {
  for (const name of ['docs/a"b.md', "docs/a\\b.md", "docs/a\nb.md", "docs/a\rb.md", "docs/a\tb.md"]) {
    assert.equal(verdict(run(pr([name]))), "false", JSON.stringify(name));
  }
});

test("pull_request: missing PR number, shas or repository fail closed", () => {
  assert.equal(verdict(run(pr(["docs/a.md"], { PR_NUMBER: "" }))), "false");
  assert.equal(verdict(run(pr(["docs/a.md"], { PR_NUMBER: "4x" }))), "false");
  assert.equal(verdict(run(pr(["docs/a.md"], { BASE_SHA: "" }))), "false");
  assert.equal(verdict(run(pr(["docs/a.md"], { HEAD_SHA: "abc" }))), "false");
  assert.equal(verdict(run(pr(["docs/a.md"], { GITHUB_REPOSITORY: "" }))), "false");
});

test("other events are never inert", () => {
  for (const ev of ["push", "workflow_dispatch", "schedule", ""]) {
    assert.equal(verdict(run(pr(["docs/a.md"], { EVENT_NAME: ev }))), "false", JSON.stringify(ev));
  }
});

// --- the script's real jq filters, over fixture JSON ----------------------------

const fixtureDir = mkdtempSync(join(tmpdir(), "nb-e2e-scope-fix-"));
const fixture = (name, obj) => {
  const p = join(fixtureDir, name);
  writeFileSync(p, JSON.stringify(obj));
  return p;
};
const jqOpts = { skip: HAVE_JQ ? false : "jq not installed" };
const jqRun = (compare, prJson, extra = {}) =>
  run({
    EVENT_NAME: "pull_request",
    PR_NUMBER: "42",
    BASE_SHA: BASE,
    HEAD_SHA: HEAD,
    STUB_COMPARE_JSON: fixture("c.json", compare),
    STUB_PR_JSON: fixture("p.json", prJson),
    ...extra,
  });

test("jq: no run-e2e label, other labels, and labels: [] are all inert for an inert file", jqOpts, () => {
  const files = { files: [{ filename: "docs/a.md", status: "added" }] };
  assert.equal(verdict(jqRun(files, { labels: [] })), "true");
  assert.equal(verdict(jqRun(files, { labels: [{ name: "bug" }, { name: "run-e2e-not" }] })), "true");
  assert.equal(verdict(jqRun(files, {})), "true", "a PR object with no labels key");
});

test("jq: the run-e2e label forces full", jqOpts, () => {
  const files = { files: [{ filename: "docs/a.md" }] };
  assert.equal(verdict(jqRun(files, { labels: [{ name: "bug" }, { name: "run-e2e" }] })), "false");
});

test("jq: previous_filename is emitted for a rename (and null is ignored)", jqOpts, () => {
  const out = (file) => jqRun({ files: [file] }, { labels: [] });
  assert.equal(verdict(out({ filename: "docs/n.md", status: "renamed", previous_filename: "apps/web/o.ts" })), "false");
  assert.equal(verdict(out({ filename: "docs/n.md", status: "renamed", previous_filename: "docs/o.md" })), "true");
  assert.equal(verdict(out({ filename: "docs/n.md", previous_filename: null })), "true");
});

test("jq: names with a quote, backslash or newline come out of @json and are refused", jqOpts, () => {
  for (const name of ['docs/a"b.md', "docs/a\\b.md", "docs/a\nb.md"]) {
    assert.equal(verdict(jqRun({ files: [{ filename: name }] }, { labels: [] })), "false", JSON.stringify(name));
  }
  assert.equal(verdict(jqRun({ files: [{ filename: "docs/ok.md", previous_filename: 'x"y' }] }, { labels: [] })), "false");
});

test("jq: a compare answer with no files array fails closed", jqOpts, () => {
  assert.equal(verdict(jqRun({ status: "diverged" }, { labels: [] })), "false");
});

// --- merge_group ---------------------------------------------------------------

function sh(cwd, cmd, ...args) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, `${cmd} ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}
const git = (cwd, ...args) =>
  sh(cwd, "git", "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args);

const write = (dir, p, c = "x") => {
  mkdirSync(dirname(join(dir, p)), { recursive: true });
  writeFileSync(join(dir, p), c);
};

// A bare `origin` with main (base) and a queue branch carrying `commits` (each
// a function that edits the tree). `mainThrough` = how many of those commits
// main has ALREADY merged (a PR ahead that landed). Returns a shallow clone of
// main that does NOT have the head commit, and the head sha.
function queueRepo(commits, { mainThrough = 0 } = {}) {
  const root = mkdtempSync(join(tmpdir(), "nb-e2e-scope-git-"));
  const seed = join(root, "seed");
  const bare = join(root, "origin.git");
  mkdirSync(seed);
  git(seed, "init", "-q", "-b", "main");
  for (const [p, c] of [["docs/old.md", "old"], ["apps/web/app/page.tsx", "page"], ["README.md", "r"]]) write(seed, p, c);
  git(seed, "add", "-A");
  git(seed, "commit", "-q", "-m", "base");
  const base = git(seed, "rev-parse", "HEAD");
  git(seed, "checkout", "-q", "-b", "gh-readonly-queue/main/pr-42-x");
  const shas = [];
  for (const change of commits) {
    change(seed);
    git(seed, "add", "-A");
    git(seed, "commit", "-q", "-m", "c");
    shas.push(git(seed, "rev-parse", "HEAD"));
  }
  const head = shas.length ? shas[shas.length - 1] : base;
  if (mainThrough > 0) git(seed, "branch", "-f", "main", shas[mainThrough - 1]);
  git(root, "init", "-q", "--bare", bare);
  git(seed, "push", "-q", bare, "main", "gh-readonly-queue/main/pr-42-x");
  const work = join(root, "work");
  git(root, "clone", "-q", "--depth=1", "--no-tags", "--single-branch", "--branch", "main", `file://${bare}`, work);
  return { work, base, head, shas, root };
}

const mg = (repo, extra = {}) => ({
  EVENT_NAME: "merge_group",
  PR_NUMBER: "42",
  BASE_REF: "refs/heads/main",
  HEAD_SHA: repo.head,
  STUB_LABEL: "false",
  ...extra,
});

test("merge_group: an all-inert diff is inert, and the shallow clone fetches the missing head", () => {
  const repo = queueRepo([
    (d) => {
      write(d, "docs/new.md");
      write(d, ".claude/agent-memory/a/m.md");
      write(d, "CLAUDE.md");
      write(d, "services/fake-bsc/recorder/cli.ts");
    },
  ]);
  // The clone really lacks the head until the script fetches it.
  assert.notEqual(spawnSync("git", ["cat-file", "-e", `${repo.head}^{commit}`], { cwd: repo.work }).status, 0);
  const r = run(mg(repo), repo.work);
  assert.equal(verdict(r), "true");
  assert.match(r.out.reason, /all 4 changed paths/);
});

test("merge_group: one outside file anywhere in the group is full", () => {
  const repo = queueRepo([(d) => write(d, "docs/new.md"), (d) => write(d, "apps/web/app/page.tsx", "changed")]);
  assert.equal(verdict(run(mg(repo), repo.work)), "false");
});

test("merge_group: a PR queued AHEAD that is not yet on main is included (diff from the merge base)", () => {
  // ahead: an app change (A); ours: a docs change (B). The group's parent is A,
  // but the diff against main must still contain A.
  const repo = queueRepo([(d) => write(d, "apps/web/app/page.tsx", "ahead"), (d) => write(d, "docs/mine.md")]);
  assert.equal(verdict(run(mg(repo), repo.work)), "false");
});

test("merge_group: a PR ahead that has ALREADY merged to main is not counted", () => {
  const repo = queueRepo([(d) => write(d, "apps/web/app/page.tsx", "ahead"), (d) => write(d, "docs/mine.md")], { mainThrough: 1 });
  assert.equal(verdict(run(mg(repo), repo.work)), "true");
});

test("merge_group: a rename out of apps/web into docs reports both paths and is full", () => {
  const repo = queueRepo([
    (d) => renameSync(join(d, "apps/web/app/page.tsx"), (mkdirSync(join(d, "docs"), { recursive: true }), join(d, "docs/page.md"))),
  ]);
  assert.equal(verdict(run(mg(repo), repo.work)), "false");
});

test("merge_group: deleting an outside file, or a nested README.md, is full", () => {
  const del = queueRepo([(d) => rmSync(join(d, "apps/web/app/page.tsx"))]);
  assert.equal(verdict(run(mg(del), del.work)), "false");
  const nested = queueRepo([(d) => write(d, "apps/web/README.md")]);
  assert.equal(verdict(run(mg(nested), nested.work)), "false");
});

test("merge_group: no changes at all (head is the base) fails closed", () => {
  const repo = queueRepo([]);
  assert.equal(verdict(run(mg(repo), repo.work)), "false");
});

test("merge_group: names with spaces are read intact (-z)", () => {
  const ok = queueRepo([(d) => write(d, "docs/a b.md")]);
  assert.equal(verdict(run(mg(ok), ok.work)), "true");
});

test("merge_group: a file name carrying a newline cannot inject an output line (the blocker)", () => {
  for (const [label, name] of [
    ["LF", "apps/web/a\ne2e_inert=true\nz="],
    ["CR", "apps/web/a\re2e_inert=true\rz="],
    ["LF in an inert-looking path", "docs/a\ne2e_inert=true\n.md"],
  ]) {
    const repo = queueRepo([(d) => write(d, name)]);
    const r = run(mg(repo), repo.work);
    assert.equal(verdict(r), "false", label);
    assert.equal(r.lines.filter((l) => l.startsWith("e2e_inert=")).length, 1, label);
    assert.equal(r.lines[r.lines.length - 1], "e2e_inert=false", label);
    assert.doesNotMatch(r.stderr, /\ne2e_inert=true/, label);
  }
});

test("merge_group: quotes and backslashes in names are refused too", () => {
  for (const name of ['docs/a"b.md', "docs/a\\b.md"]) {
    const repo = queueRepo([(d) => write(d, name)]);
    assert.equal(verdict(run(mg(repo), repo.work)), "false", name);
  }
});

test("merge_group: a printable name that looks like an output line stays on the reason line", () => {
  const repo = queueRepo([(d) => write(d, "apps/web/e2e_inert=true")]);
  const r = run(mg(repo), repo.work);
  assert.equal(verdict(r), "false");
  assert.match(r.lines[0], /^reason=/);
});

test("merge_group: run-e2e label on the PR forces full", () => {
  const repo = queueRepo([(d) => write(d, "docs/new.md")]);
  assert.equal(verdict(run(mg(repo, { STUB_LABEL: "true" }), repo.work)), "false");
});

test("merge_group: missing or unknown shas, bad base_ref and unfetchable head fail closed", () => {
  const repo = queueRepo([(d) => write(d, "docs/new.md")]);
  assert.equal(verdict(run(mg(repo, { HEAD_SHA: "" }), repo.work)), "false");
  assert.equal(verdict(run(mg(repo, { HEAD_SHA: "abc123" }), repo.work)), "false");
  // Well-formed but not on origin: the fetch fails, so the head stays missing.
  assert.equal(verdict(run(mg(repo, { HEAD_SHA: "1".repeat(40) }), repo.work)), "false");
  for (const ref of ["", "refs/heads/-x", "refs/heads/a..b", "refs/heads/a b", "refs/heads/nope"]) {
    assert.equal(verdict(run(mg(repo, { BASE_REF: ref }), repo.work)), "false", JSON.stringify(ref));
  }
});

test("merge_group: unreadable PR labels or no PR number fail closed", () => {
  const repo = queueRepo([(d) => write(d, "docs/new.md")]);
  assert.equal(verdict(run(mg(repo, { STUB_PR_FAIL: "1" }), repo.work)), "false");
  assert.equal(verdict(run(mg(repo, { PR_NUMBER: "" }), repo.work)), "false");
});

test("merge_group: not a git repository fails closed", () => {
  const repo = queueRepo([(d) => write(d, "docs/new.md")]);
  const notGit = mkdtempSync(join(tmpdir(), "nb-e2e-scope-nogit-"));
  assert.equal(verdict(run(mg(repo), notGit)), "false");
});
