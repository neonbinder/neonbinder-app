// NEO-622: the agents' tool grants are a security boundary (read-only auditors
// must not be able to edit), so they are pinned here rather than trusted to review.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AGENTS = join(dirname(fileURLToPath(import.meta.url)), "..", ".claude", "agents");

function frontmatter(file) {
  const text = readFileSync(join(AGENTS, file), "utf8");
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(m, `${file}: no frontmatter block`);
  const fm = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([A-Za-z]+):\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2];
  }
  return fm;
}
const list = (v) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const agent = (name) => {
  const fm = frontmatter(`${name}.md`);
  return { tools: list(fm.tools), disallowed: list(fm.disallowedTools), raw: fm };
};

const READ_ONLY = [
  "security-auditor",
  "accessibility-auditor",
  "test-coverage-auditor",
  "feature-planner",
  "card-collector-tester",
];
const WRITE_TOOLS = ["Edit", "Write", "NotebookEdit"];

for (const name of READ_ONLY) {
  test(`${name} disallows every write tool and is not granted one`, () => {
    const { tools, disallowed } = agent(name);
    for (const t of WRITE_TOOLS) {
      assert.ok(disallowed.includes(t), `${name}: disallowedTools must list ${t}`);
      assert.ok(!tools.includes(t), `${name}: tools must not include ${t}`);
    }
  });
}

test("every agent that is not an impeccable helper declares a tools line", () => {
  const files = readdirSync(AGENTS).filter((f) => f.endsWith(".md") && !f.startsWith("impeccable-"));
  assert.ok(files.length >= READ_ONLY.length, "agent list looks empty");
  for (const f of files) {
    assert.ok(agent(f.replace(/\.md$/, "")).tools.length > 0, `${f}: missing tools:`);
  }
});

test("playwright-e2e-author tools are exactly the shell-and-files set", () => {
  assert.deepEqual(agent("playwright-e2e-author").tools, [
    "Read", "Grep", "Glob", "Edit", "Write", "Bash", "WebFetch",
  ]);
});

test("feature-planner has no PostHog tool", () => {
  const { tools } = agent("feature-planner");
  assert.deepEqual(tools.filter((t) => /posthog/i.test(t)), []);
});
