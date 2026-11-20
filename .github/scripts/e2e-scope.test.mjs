// NEO-627: branch coverage for e2e-scope.sh. Stubs `gh` on PATH and builds a
// throwaway git repository for the merge_group path; no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, mkdirSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = join(REPO_ROOT, ".github", "scripts", "e2e-scope.sh");

// The stub answers by endpoint. STUB_META is the line the script's own jq
// would produce for the PR (`<changed_files>\t<has run-e2e label>`), STUB_FILES
// the lines its jq would produce for the files listing (F<json> / P<json>).
const STUB = `#!/usr/bin/env bash
case "$*" in
  *pulls/*/files*)
    [ -n "\${STUB_FILES_FAIL:-}" ] && exit 1
    printf '%s' "\${STUB_FILES:-}" ;;
  *pulls/*)
    [ -n "\${STUB_META_FAIL:-}" ] && exit 1
    printf '%s' "\${STUB_META:-}" ;;
  *) exit 1 ;;
esac
`;

function parse(stdout) {
  const out = {};
  for (const line of (stdout ?? "").split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) out[line.slice(0, i)] = line.slice(i + 1);
  }
  return out;
}

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
  return { status: r.status, out: parse(r.stdout), stderr: r.stderr ?? "" };
}

// A PR files listing from [filename] or [filename, previous_filename] pairs.
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
  STUB_META: `${files.length}\tfalse`,
  STUB_FILES: listing(files),
  ...extra,
});

const inert = (r) => {
  assert.equal(r.status, 0, r.stderr);
  return r.out.e2e_inert;
};

// --- pull_request ------------------------------------------------------------

test("pull_request: every allow-list shape is inert", () => {
  const files = [
    ".claude/agent-memory/devops-automator/x.md",
    ".claude/skills/pr-watch/SKILL.md",
    "docs/operations/runbook.md",
    "docs/img/a.png",
    "CLAUDE.md",
    "PRODUCT.md",
    "services/fake-bsc/recorder/cli.ts",
    "services/fake-bsc/README.md",
    "services/fake-bsc/tests/id-token-source.test.mjs",
  ];
  const r = run(pr(files));
  assert.equal(inert(r), "true");
  assert.match(r.out.reason, /all 9 changed paths/);
});

test("pull_request: one outside file makes it full, and the reason names it", () => {
  const r = run(pr(["docs/a.md", "apps/web/app/page.tsx"]));
  assert.equal(inert(r), "false");
  assert.match(r.out.reason, /apps\/web\/app\/page\.tsx/);
});

test("pull_request: near-misses of the allow-list are not inert", () => {
  for (const f of [
    "apps/web/CLAUDE.md", // nested *.md is not root
    "services/fake-bsc/CONTRACT.md",
    "services/fake-bsc/README.mdx",
    "services/fake-bsc/tests",
    "services/fake-bsc/testsx/a.mjs",
    "services/fake-bsc/package.json",
    "services/fake-bsc/src/index.ts",
    "services/fake-bsc/recorder-extra/x.ts",
    "services/fake-bsc/recorder",
    "apps/web/docs/x.md",
    "docs", // a file named docs
    ".claude", // a file named .claude
    ".claudex/x",
    ".github/workflows/e2e.yml",
    ".github/scripts/e2e-scope.sh",
    "package.json",
    "notes.txt",
    "README.mdx",
  ]) {
    assert.equal(inert(run(pr([f]))), "false", f);
  }
});

test("pull_request: #502's file list is inert; adding CONTRACT.md makes it full", () => {
  const f502 = [
    ".claude/agent-memory/security-auditor/patterns_neo552_fake_upstream_and_recorder.md",
    "services/fake-bsc/README.md",
    "services/fake-bsc/recorder/cli.ts",
    "services/fake-bsc/recorder/fake-client.ts",
    "services/fake-bsc/tests/id-token-source.test.mjs",
  ];
  assert.equal(inert(run(pr(f502))), "true");
  assert.equal(inert(run(pr([...f502, "services/fake-bsc/CONTRACT.md"]))), "false");
});

test("pull_request: a rename out of an outside path is not inert (previous_filename counts)", () => {
  assert.equal(inert(run(pr([["docs/moved.md", "apps/web/app/page.tsx"]]))), "false");
  assert.equal(inert(run(pr([["docs/moved.md", "services/browser/src/x.ts"]]))), "false");
});

test("pull_request: a rename between inert paths is inert", () => {
  assert.equal(inert(run(pr([["docs/new.md", "docs/old.md"]]))), "true");
});

test("pull_request: a rename INTO an outside path is not inert", () => {
  assert.equal(inert(run(pr([["apps/web/x.ts", "docs/x.md"]]))), "false");
});

test("pull_request: empty file list fails closed", () => {
  assert.equal(inert(run(pr([], { STUB_META: "0\tfalse" }))), "false");
});

test("pull_request: run-e2e label forces full", () => {
  const r = run(pr(["docs/a.md"], { STUB_META: "1\ttrue" }));
  assert.equal(inert(r), "false");
  assert.match(r.out.reason, /run-e2e/);
});

test("pull_request: unreadable metadata, garbage metadata or bad count fail closed", () => {
  assert.equal(inert(run(pr(["docs/a.md"], { STUB_META_FAIL: "1" }))), "false");
  assert.equal(inert(run(pr(["docs/a.md"], { STUB_META: "" }))), "false");
  assert.equal(inert(run(pr(["docs/a.md"], { STUB_META: "1\tmaybe" }))), "false");
  assert.equal(inert(run(pr(["docs/a.md"], { STUB_META: "many\tfalse" }))), "false");
  assert.equal(inert(run(pr(["docs/a.md"], { STUB_META: "1" }))), "false");
});

test("pull_request: a failing files listing fails closed", () => {
  assert.equal(inert(run(pr(["docs/a.md"], { STUB_FILES_FAIL: "1" }))), "false");
});

test("pull_request: a listing shorter than the PR's file count (truncated) fails closed", () => {
  const r = run(pr(["docs/a.md"], { STUB_META: "2\tfalse" }));
  assert.equal(inert(r), "false");
  assert.match(r.out.reason, /truncated/);
});

test("pull_request: a PR at the API's 3000-file cap fails closed even if the listing matches", () => {
  const files = Array.from({ length: 3000 }, (_, i) => `docs/f${i}.md`);
  const r = run(pr(files));
  assert.equal(inert(r), "false");
  assert.match(r.out.reason, /cap/);
});

test("pull_request: 2999 inert files across many pages is still inert", () => {
  const files = Array.from({ length: 2999 }, (_, i) => `docs/f${i}.md`);
  assert.equal(inert(run(pr(files))), "true");
});

test("pull_request: unparseable listing lines fail closed", () => {
  assert.equal(inert(run(pr(["docs/a.md"], { STUB_FILES: "docs/a.md\n" }))), "false");
  assert.equal(inert(run(pr(["docs/a.md"], { STUB_FILES: 'Fdocs/a.md\n' }))), "false");
});

test("pull_request: file names with quotes, backslashes or control characters fail closed", () => {
  for (const name of ['docs/a"b.md', "docs/a\\b.md", "docs/a\nb.md", "docs/a\tb.md"]) {
    assert.equal(inert(run(pr([name]))), "false", JSON.stringify(name));
  }
});

test("pull_request: missing PR number fails closed", () => {
  assert.equal(inert(run(pr(["docs/a.md"], { PR_NUMBER: "" }))), "false");
  assert.equal(inert(run(pr(["docs/a.md"], { PR_NUMBER: "4x" }))), "false");
});

test("other events are never inert", () => {
  for (const ev of ["push", "workflow_dispatch", "schedule", ""]) {
    const r = run(pr(["docs/a.md"], { EVENT_NAME: ev }));
    assert.equal(inert(r), "false", JSON.stringify(ev));
  }
});

// --- merge_group ---------------------------------------------------------------

function git(cwd, ...args) {
  const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], {
    cwd,
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

// A repo with a base commit, then a head commit that applies `change(dir)`.
function queueRepo(change) {
  const dir = mkdtempSync(join(tmpdir(), "nb-e2e-scope-git-"));
  git(dir, "init", "-q", "-b", "main");
  for (const [p, c] of [["docs/old.md", "old"], ["apps/web/app/page.tsx", "page"], ["README.md", "r"]]) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), c);
  }
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "base");
  const base = git(dir, "rev-parse", "HEAD");
  change(dir);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "head");
  return { dir, base, head: git(dir, "rev-parse", "HEAD") };
}

const write = (dir, p, c = "x") => {
  mkdirSync(dirname(join(dir, p)), { recursive: true });
  writeFileSync(join(dir, p), c);
};

const mg = (repo, extra = {}) => ({
  EVENT_NAME: "merge_group",
  PR_NUMBER: "42",
  BASE_SHA: repo.base,
  HEAD_SHA: repo.head,
  STUB_META: "1\tfalse",
  ...extra,
});

test("merge_group: an all-inert diff is inert", () => {
  const repo = queueRepo((d) => {
    write(d, "docs/new.md");
    write(d, ".claude/agent-memory/a/m.md");
    write(d, "CLAUDE.md");
    write(d, "services/fake-bsc/recorder/cli.ts");
  });
  const r = run(mg(repo), repo.dir);
  assert.equal(inert(r), "true");
  assert.match(r.out.reason, /all 4 changed paths/);
});

test("merge_group: one outside file anywhere in the group (a PR queued ahead) is full", () => {
  const repo = queueRepo((d) => {
    write(d, "docs/new.md");
    write(d, "apps/web/app/page.tsx", "changed");
  });
  assert.equal(inert(run(mg(repo), repo.dir)), "false");
});

test("merge_group: a rename out of apps/web into docs reports BOTH paths and is full", () => {
  const repo = queueRepo((d) => {
    renameSync(join(d, "apps/web/app/page.tsx"), (mkdirSync(join(d, "docs"), { recursive: true }), join(d, "docs/page.md")));
  });
  const r = run(mg(repo), repo.dir);
  assert.equal(inert(r), "false");
  assert.match(r.out.reason, /apps\/web\/app\/page\.tsx/);
});

test("merge_group: a deletion of an outside file is full", () => {
  const repo = queueRepo((d) => spawnSync("rm", [join(d, "apps/web/app/page.tsx")]));
  assert.equal(inert(run(mg(repo), repo.dir)), "false");
});

test("merge_group: nested README.md is not root", () => {
  const repo = queueRepo((d) => write(d, "apps/web/README.md"));
  assert.equal(inert(run(mg(repo), repo.dir)), "false");
});

test("merge_group: a diff with no changes (empty list) fails closed", () => {
  const repo = queueRepo((d) => write(d, "docs/new.md"));
  // Base and head are the same commit: nothing changed.
  assert.equal(inert(run(mg({ base: repo.base, head: repo.base }), repo.dir)), "false");
});

test("merge_group: names with spaces and newlines are read intact (-z)", () => {
  const ok = queueRepo((d) => write(d, "docs/a b.md"));
  assert.equal(inert(run(mg(ok), ok.dir)), "true");
  const bad = queueRepo((d) => write(d, "apps/web/a\nb.ts"));
  assert.equal(inert(run(mg(bad), bad.dir)), "false");
});

test("merge_group: run-e2e label on the PR forces full", () => {
  const repo = queueRepo((d) => write(d, "docs/new.md"));
  assert.equal(inert(run(mg(repo, { STUB_META: "1\ttrue" }), repo.dir)), "false");
});

test("merge_group: missing, short or unknown shas fail closed", () => {
  const repo = queueRepo((d) => write(d, "docs/new.md"));
  assert.equal(inert(run(mg(repo, { BASE_SHA: "" }), repo.dir)), "false");
  assert.equal(inert(run(mg(repo, { HEAD_SHA: "abc123" }), repo.dir)), "false");
  assert.equal(inert(run(mg(repo, { BASE_SHA: "1".repeat(40) }), repo.dir)), "false");
});

test("merge_group: unreadable PR metadata or no PR number fails closed", () => {
  const repo = queueRepo((d) => write(d, "docs/new.md"));
  assert.equal(inert(run(mg(repo, { STUB_META_FAIL: "1" }), repo.dir)), "false");
  assert.equal(inert(run(mg(repo, { PR_NUMBER: "" }), repo.dir)), "false");
});

test("merge_group: not a git repository fails closed", () => {
  const repo = queueRepo((d) => write(d, "docs/new.md"));
  const notGit = mkdtempSync(join(tmpdir(), "nb-e2e-scope-nogit-"));
  assert.equal(inert(run(mg(repo), notGit)), "false");
});
