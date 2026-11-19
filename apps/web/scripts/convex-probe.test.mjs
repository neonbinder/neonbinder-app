import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "convex-probe.mjs");

function summary(error, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), "probe-"));
  try {
    const file = join(dir, "p.jsonl");
    writeFileSync(file, `${JSON.stringify({ t: "2026-01-01T00:00:00Z", kind: "query", ms: 5000, ok: false, error })}\n`);
    const r = spawnSync("node", [SCRIPT, "--summary", file], { encoding: "utf8", env: { ...process.env, ...env } });
    return r.stdout;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("convex-probe summary redaction", () => {
  it("masks a Convex host that straddles column 120", () => {
    const out = summary(`${"x ".repeat(55)}fetch https://quiet-fox-123.convex.cloud/api failed`);
    expect(out).not.toMatch(/quiet-fox|convex\.cloud\/api/);
    expect(out).not.toMatch(/\.convex\.cloud/);
  });

  it("masks the literal deployment name, even where cutting would split it", () => {
    const out = summary(`${"y".repeat(100)} quiet-fox-123 and ${"z".repeat(30)} quiet-fox-123`, { CONVEX_NAME: "quiet-fox-123" });
    expect(out).not.toContain("quiet-fox-123");
    expect(out).not.toContain("quiet-fox");
  });
});
