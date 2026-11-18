// NEO-592: redact-ci-log.sh masks storage hosts, bucket names, account ids,
// deployment hosts and emails in the public Convex-log artifacts, and leaves
// function names, timings and review_gate_timing lines alone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "redact-ci-log.sh");

function redact(input, env = {}) {
  const r = spawnSync("bash", [SCRIPT], { input, encoding: "utf8", env: { ...process.env, ...env } });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

// Fake values only; none of these name a real account, bucket or deployment.
const ACCT = "0123456789abcdef0123456789abcdef";

test("masks R2 and other object-store hosts, with or without a bucket path", () => {
  const out = redact(
    [
      `https://${ACCT}.r2.cloudflarestorage.com/example-bucket/photos/a.jpg`,
      `https://example-bucket.s3.us-east-1.amazonaws.com/k`,
      `https://storage.googleapis.com/example-bucket/o`,
      `pub-abc123.r2.dev/x`,
    ].join("\n") + "\n",
  );
  assert.doesNotMatch(out, /cloudflarestorage|amazonaws|r2\.dev/);
  assert.doesNotMatch(out, /example-bucket/);
  assert.doesNotMatch(out, new RegExp(ACCT));
  assert.match(out, /<storage-host>/);
});

test("masks bucket names in JSON, escaped JSON, key=value and quoted forms", () => {
  const out = redact(
    [
      `{"bucket":"example-bucket"}`,
      `{"messages":["{\\"bucketName\\":\\"example-bucket\\"}"]}`,
      `Bucket=example-bucket region=auto`,
      `NoSuchBucket: the specified bucket "example-bucket" does not exist`,
      `gs://example-bucket/ref/seed.tar`,
    ].join("\n") + "\n",
  );
  assert.doesNotMatch(out, /example-bucket/);
  for (const line of out.trim().split("\n").slice(0, 2)) JSON.parse(line);
});

test("masks 32-hex account ids, deployment hosts, deployment ids and emails", () => {
  const out = redact(
    `acct ${ACCT} at happy-animal-123.convex.cloud and other-thing-45.convex.site ` +
      `dev:happy-animal-123 neonbinder-abc-neon-binder.vercel.app svc-xyz.a.run.app ` +
      `user.name+tag@example.org\n`,
  );
  assert.doesNotMatch(out, new RegExp(ACCT));
  assert.doesNotMatch(out, /convex\.(cloud|site)|vercel\.app|run\.app|example\.org|happy-animal/);
});

test("masks a deployment value in plain and escaped JSON", () => {
  const out = redact(
    `{"deployment":"quiet-fox-9"}\n{"messages":["{\\"msg\\":\\"bsc_call_summary\\",\\"deployment\\":\\"quiet-fox-9\\",\\"calls\\":1}"]}\n`,
  );
  assert.doesNotMatch(out, /quiet-fox/);
  for (const line of out.trim().split("\n")) JSON.parse(line);
  assert.match(out, /bsc_call_summary/);
});

test("masks REDACT_LITERALS, longest first, ignoring entries under 4 chars", () => {
  const out = redact(`name quiet-fox-9 and quiet-fox-99 and abc\n`, {
    REDACT_LITERALS: "quiet-fox-9\nquiet-fox-99\nabc",
  });
  assert.equal(out, `name <redacted> and <redacted> and abc\n`);
});

test("keeps function names, timings and review_gate_timing lines byte-for-byte", () => {
  const lines = [
    `{"identifier":"setBuilder:getSetCards","udfType":"query","executionTime":0.0123,"readDocs":42,"kind":"Completion"}`,
    `{"logLines":[{"level":"LOG","messages":["{\\"msg\\":\\"review_gate_timing\\",\\"ms\\":812,\\"phase\\":\\"open\\"}"]}]}`,
    `{"requestId":"b7d2c0c5-9a9e-4c7f-8f1e-3a6d6e1d2f00","error":null}`,
  ];
  const input = lines.join("\n") + "\n";
  assert.equal(redact(input), input);
});

test("is idempotent", () => {
  const once = redact(`https://${ACCT}.r2.cloudflarestorage.com/example-bucket/k "bucket":"example-bucket"\n`);
  assert.equal(redact(once), once);
});
