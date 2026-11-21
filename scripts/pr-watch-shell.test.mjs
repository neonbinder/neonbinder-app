// NEO-622: the pr-watch skill's shell tests (change-only output, resume state,
// queue mode) run in the repo-root scripts lane. They drive watch.sh against a
// fake gh and need only bash and jq (on ubuntu-latest and macOS alike). Each run
// gets a fresh TMPDIR so the watch's resume state never leaks between files or
// onto the host.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TEST_DIR = join(REPO_ROOT, ".claude", "skills", "pr-watch", "test");

for (const file of ["queue.test.sh", "pr.test.sh"]) {
  test(`pr-watch ${file} exits 0 and reports all passed`, () => {
    const tmp = mkdtempSync(join(tmpdir(), "pr-watch-shell-"));
    try {
      const r = spawnSync("bash", [join(TEST_DIR, file)], {
        env: { ...process.env, TMPDIR: tmp },
        encoding: "utf8",
      });
      const out = `${r.stdout}${r.stderr}`;
      assert.equal(r.status, 0, out);
      assert.match(r.stdout, /^all passed$/m, out);
      assert.doesNotMatch(r.stdout, /^FAIL /m, out);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
}
