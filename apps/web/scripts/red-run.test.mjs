// NEO-398: playwright/red-run.mjs reads a blob report's report.jsonl and keeps every
// test with a red result, one entry per red try (a retried spec has several); picks
// one attempt's artifacts; and unpacks untrusted artifacts behind guards (symlinks,
// paths outside the report, zip bombs, terminal escapes). The unit tests sit here,
// where vitest collects .mjs (vitest.include.mjs).
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32 } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import {
  attemptOf,
  cleanPath,
  cleanText,
  containedFile,
  freshDir,
  inspectZip,
  logsFor,
  outDir,
  pickArtifacts,
  redTests,
  safeUnzip,
  slowestInWindow,
  walkNoSymlinks,
} from "../playwright/red-run.mjs";

const ev = (method, params) => JSON.stringify({ method, params });
const project = ev("onProject", {
  project: {
    name: "e2e",
    suites: [
      {
        title: "binders/delete.spec.ts",
        location: { file: "binders/delete.spec.ts" },
        entries: [
          { testId: "t-retried", title: "deletes a binder" },
          { testId: "t-flaky", title: "renames a binder" },
          { testId: "t-green", title: "lists binders" },
          { title: "a describe", location: { file: "binders/delete.spec.ts" }, entries: [{ testId: "t-expected-fail", title: "known bug" }] },
          { testId: "t-skipped", title: "seller only" },
          { testId: "t-interrupted", title: "stopped" },
          { testId: "t-timed-out", title: "slow" },
        ],
      },
    ],
  },
});
const run = (testId, id, retry, start, status, { expected = "passed", error, attachments = [] } = {}) => [
  ev("onTestBegin", { testId, result: { id, retry, startTime: start } }),
  ...attachments.map((a) => ev("onAttach", { testId, resultId: id, attachments: [a] })),
  ev("onTestEnd", {
    test: { testId, expectedStatus: expected },
    result: { id, duration: 1000, status, errors: error ? [{ message: error }] : [] },
  }),
];
const jsonl = [
  project,
  ...run("t-retried", "r1", 0, 1000, "failed", {
    error: "\u001b[2mexpect(\u001b[22mlocator).toBeVisible() failed",
    attachments: [
      { name: "screenshot", path: "resources/a.png", contentType: "image/png" },
      { name: "client-wire.log", contentType: "text/plain", base64: Buffer.from("  12ms -> Mutation #1 binders:remove").toString("base64") },
    ],
  }),
  ...run("t-retried", "r2", 1, 5000, "timedOut", { error: "Test timeout of 1200000ms exceeded." }),
  ...run("t-flaky", "r3", 0, 9000, "failed", { error: "boom" }),
  ...run("t-flaky", "r4", 1, 12000, "passed"),
  ...run("t-green", "r5", 0, 15000, "passed"),
  ...run("t-expected-fail", "r6", 0, 16000, "failed", { expected: "failed" }),
  ...run("t-skipped", "r7", 0, 17000, "skipped"),
  ...run("t-interrupted", "r8", 0, 18000, "interrupted"),
  ...run("t-timed-out", "r9", 0, 19000, "timedOut"),
  "",
].join("\n");

describe("redTests", () => {
  const tests = redTests(jsonl);
  const byId = Object.fromEntries(tests.map((t) => [t.testId, t]));

  it("keeps only tests with a red try (not green, expected failures or skips)", () => {
    expect(tests.map((t) => t.testId).sort()).toEqual(["t-flaky", "t-interrupted", "t-retried", "t-timed-out"]);
  });

  it("keeps every red try of a retried test, in order, with its own window and error", () => {
    const t = byId["t-retried"];
    expect(t).toMatchObject({ title: "deletes a binder", file: "binders/delete.spec.ts", project: "e2e", flaky: false, tries: 2 });
    expect(t.red.map((r) => [r.retry, r.status, r.start, r.end])).toEqual([
      [0, "failed", 1000, 2000],
      [1, "timedOut", 5000, 6000],
    ]);
    expect(t.red[0].error).toBe("expect(locator).toBeVisible() failed");
    expect(t.red[0].attachments.map((a) => a.name)).toEqual(["screenshot", "client-wire.log"]);
    expect(t.red[1].attachments).toEqual([]);
  });

  it("marks a test whose last try passed as flaky, with its red try", () => {
    const t = byId["t-flaky"];
    expect(t.flaky).toBe(true);
    expect(t.red.map((r) => r.retry)).toEqual([0]);
  });

  it("counts interrupted and timedOut results as red, not flaky", () => {
    expect(byId["t-interrupted"]).toMatchObject({ flaky: false, tries: 1 });
    expect(byId["t-interrupted"].red.map((r) => r.status)).toEqual(["interrupted"]);
    expect(byId["t-timed-out"]).toMatchObject({ flaky: false, tries: 1 });
    expect(byId["t-timed-out"].red.map((r) => r.status)).toEqual(["timedOut"]);
  });

  it("titles a test inside a describe with the describe's name", () => {
    const withDescribe = redTests([project, ...run("t-expected-fail", "x1", 0, 1, "passed", { expected: "failed" })].join("\n"));
    expect(withDescribe).toHaveLength(1);
    expect(withDescribe[0].title).toBe("a describe › known bug");
  });

  it("skips lines that are not JSON and events missing their fields, and keeps reading", () => {
    const messy = [
      "not json {",
      ev("onProject", { project: { name: "e2e", suites: "nope" } }),
      ev("onProject", {}),
      JSON.stringify({ method: "onTestEnd" }),
      ev("onTestEnd", { test: {}, result: {} }),
      ev("onAttach", { resultId: "r1", attachments: "x" }),
      project,
      ...run("t-timed-out", "m1", 0, 1, "failed"),
    ].join("\n");
    const out = redTests(messy);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ testId: "t-timed-out", title: "slow" });
  });
});

describe("attemptOf", () => {
  it("reads e2e.yml's -a<attempt> suffix, 0 when there is none", () => {
    expect(attemptOf("pw-report-desktop-3-a2")).toBe(2);
    expect(attemptOf("convex-logs-seed-mobile-a11")).toBe(11);
    expect(attemptOf("pw-report-desktop-3")).toBe(0);
  });
});

describe("pickArtifacts", () => {
  const a = (name, expired = false) => ({ id: "1", name, expired });
  const all = [
    a("pw-report-desktop-1-a1"),
    a("pw-report-desktop-2-a1"),
    a("pw-report-desktop-2-a2"),
    a("pw-report-desktop-2-a3"),
    a("convex-logs-desktop-1-a1"),
    a("convex-logs-desktop-2-a2"),
    a("convex-logs-desktop-2-a3", true),
    a("pw-merged"),
    a("convex-probe-desktop-1-a1"),
  ];

  it("defaults to the latest attempt", () => {
    const v = pickArtifacts(all, undefined);
    expect(v).toMatchObject({ latest: 3, attempt: 3 });
    expect(v.reports.map((r) => r.name)).toEqual(["pw-report-desktop-1-a1", "pw-report-desktop-2-a3"]);
    expect(v.expired).toEqual(["convex-logs-desktop-2-a3"]);
    expect(v.logs.map((r) => r.name)).toEqual(["convex-logs-desktop-1-a1"]);
  });

  it("attempt 2 of 3 keeps an attempt-1 shard that was not rerun, and drops attempt 3", () => {
    const v = pickArtifacts(all, "2");
    expect(v.attempt).toBe(2);
    expect(v.reports.map((r) => r.name)).toEqual(["pw-report-desktop-1-a1", "pw-report-desktop-2-a2"]);
    expect(v.older).toBe(1);
    expect(v.logs.map((r) => r.name)).toEqual(["convex-logs-desktop-1-a1", "convex-logs-desktop-2-a2"]);
  });

  it("refuses an attempt that is not a whole number from 1 to the latest", () => {
    for (const bad of ["0", "4", "1.5", "-1", "two", ""]) expect(pickArtifacts(all, bad)).toHaveProperty("error");
  });
});

describe("logsFor", () => {
  const logs = [{ name: "convex-logs-desktop-1-a1" }, { name: "convex-logs-desktop-2-a2" }, { name: "convex-logs-mobile-2-a1" }];

  it("reads only the red jobs' logs, matched by job across attempts", () => {
    expect(logsFor(["pw-report-desktop-2-a2"], logs).set.map((l) => l.name)).toEqual(["convex-logs-desktop-2-a2"]);
    expect(logsFor(["pw-report-mobile-2-a3"], logs).set.map((l) => l.name)).toEqual(["convex-logs-mobile-2-a1"]);
  });

  it("falls back to every log when no red job has its own", () => {
    const r = logsFor(["pw-report-seller-desktop-a1"], logs);
    expect(r.set).toEqual(logs);
    expect(r.fallback).toBe(true);
  });

  it("reads every log with --all-logs", () => {
    expect(logsFor(["pw-report-desktop-2-a2"], logs, true).set).toEqual(logs);
  });
});

describe("slowestInWindow", () => {
  const c = (timestamp, executionTime, extra = {}) => ({ timestamp, executionTime, ...extra });

  it("is inclusive at both ends (window start, and 1 s after the end)", () => {
    const end = 100_000; // 100 s
    const comps = [c(79.999, 1), c(80, 2), c(101, 3), c(101.001, 4)];
    const { inWin } = slowestInWindow(comps, end, 20);
    expect(inWin.map((x) => x.timestamp)).toEqual([80, 101]);
  });

  it("returns the n slowest, slowest first, and the errored or retried ones", () => {
    const comps = [c(90, 0.1), c(91, 3, { error: "x" }), c(92, 2, { willRetry: true }), c(93, 1)];
    const r = slowestInWindow(comps, 95_000, 20, 2);
    expect(r.slow.map((x) => x.executionTime)).toEqual([3, 2]);
    expect(r.errs.map((x) => x.timestamp)).toEqual([91, 92]);
  });
});

describe("cleanText / cleanPath", () => {
  it("strips C0/C1 control characters (an OSC or CSI escape) and keeps tab and newline", () => {
    const osc = "title\u001b]8;;https://evil.example\u0007click\u001b]8;;\u0007 \u009b31m\tend\nnext\u0000";
    const out = cleanText(osc);
    expect(out).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/);
    expect(out).toContain("\tend\nnext");
    expect(cleanPath("/tmp/a\u001b[2Jb")).toBe("/tmp/a[2Jb");
  });

  it("scrubs with the shared redactor first", () => {
    const jwt = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyXzEyMyJ9.c2lnbmF0dXJlLXZhbHVl";
    expect(cleanText(`token ${jwt} at x.convex.cloud`)).not.toContain(jwt);
  });
});

// Filesystem guards, on temp dirs.
let tmp;
const fresh = () => (tmp = mkdtempSync(join(tmpdir(), "red-run-test-")));
afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});

/** A stored (uncompressed) zip; `mode` sets the unix mode, `size` overrides the declared size. */
function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data = "", mode = 0o100644, size } of entries) {
    const body = Buffer.from(data);
    const nameBuf = Buffer.from(name);
    const crc = crc32(body);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(10, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(size ?? body.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4); // made by unix
    central.writeUInt16LE(10, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(size ?? body.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE((mode << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, body);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

describe("inspectZip", () => {
  it("lists a plain zip's entries", () => {
    const z = makeZip([{ name: "report/blob/report-1.zip", data: "x" }, { name: "report/junit.xml", data: "<x/>" }]);
    expect(inspectZip(z).map((e) => e.name)).toEqual(["report/blob/report-1.zip", "report/junit.xml"]);
  });

  it("refuses a symlink entry (the nested-zip escape: a link planted where the inner zip unpacks)", () => {
    const z = makeZip([
      { name: "report/blob/report-1.zip.d", data: "/Users/someone/.ssh", mode: 0o120777 },
      { name: "report/blob/report-1.zip", data: "x" },
    ]);
    expect(() => inspectZip(z)).toThrow(/symlink/);
  });

  it("refuses absolute and .. names", () => {
    expect(() => inspectZip(makeZip([{ name: "/etc/passwd" }]))).toThrow(/unsafe name/);
    expect(() => inspectZip(makeZip([{ name: "report/../../x" }]))).toThrow(/unsafe name/);
  });

  it("refuses a zip that unpacks past the size or entry limit (a zip bomb)", () => {
    expect(() => inspectZip(makeZip([{ name: "a", data: "x", size: 3_000_000_000 }]))).toThrow(/over/);
    expect(() => inspectZip(makeZip([{ name: "a" }, { name: "b" }]), { entries: 1, bytes: 10 })).toThrow(/entries/);
  });

  it("refuses what is not a zip", () => {
    expect(() => inspectZip(Buffer.from("hello"))).toThrow(/not a zip/);
  });
});

describe("safeUnzip / freshDir / walkNoSymlinks", () => {
  it("unpacks a clean zip into a directory it creates", () => {
    const dir = fresh();
    writeFileSync(join(dir, "a.zip"), makeZip([{ name: "report/report.jsonl", data: "{}" }]));
    const out = safeUnzip(join(dir, "a.zip"), dir, "a");
    expect(readFileSync(join(out, "report/report.jsonl"), "utf8")).toBe("{}");
  });

  it("refuses to unpack into a path an earlier archive planted a symlink at", () => {
    const dir = fresh();
    mkdirSync(join(dir, "elsewhere"));
    symlinkSync(join(dir, "elsewhere"), join(dir, "inner.zip.d"));
    writeFileSync(join(dir, "inner.zip"), makeZip([{ name: "pwned", data: "x" }]));
    expect(() => safeUnzip(join(dir, "inner.zip"), dir, "inner.zip.d")).toThrow(/already exists as a symlink/);
    expect(() => lstatSync(join(dir, "elsewhere", "pwned"))).toThrow();
  });

  it("freshDir refuses an existing file or directory", () => {
    const dir = fresh();
    writeFileSync(join(dir, "f"), "");
    expect(() => freshDir(dir, "f")).toThrow(/already exists/);
    expect(freshDir(dir, "new")).toBe(join(dir, "new"));
  });

  it("walkNoSymlinks lists regular files and throws on any symlink, file or directory", () => {
    const dir = fresh();
    mkdirSync(join(dir, "a/b"), { recursive: true });
    writeFileSync(join(dir, "a/b/f.txt"), "x");
    expect(walkNoSymlinks(dir)).toEqual([join(dir, "a/b/f.txt")]);
    symlinkSync("/etc/hosts", join(dir, "a/link"));
    expect(() => walkNoSymlinks(dir)).toThrow(/symlink/);
    expect(() => walkNoSymlinks(join(dir, "a/link"))).toThrow(/symlink/);
  });
});

describe("containedFile", () => {
  it("returns a regular file inside the report", () => {
    const dir = fresh();
    mkdirSync(join(dir, "resources"));
    writeFileSync(join(dir, "resources/a.md"), "x");
    expect(containedFile(dir, "resources/a.md")).toMatch(/resources[\\/]a\.md$/);
  });

  it("refuses a path outside the report, absolute or through ..", () => {
    const dir = fresh();
    mkdirSync(join(dir, "report"));
    writeFileSync(join(dir, "secret"), "x");
    expect(() => containedFile(join(dir, "report"), "../secret")).toThrow(/outside/);
    expect(() => containedFile(join(dir, "report"), join(dir, "secret"))).toThrow(/outside/);
    expect(() => containedFile(join(dir, "report"), "")).toThrow(/outside/);
  });

  it("refuses a symlink, or a file reached through a symlinked directory", () => {
    const dir = fresh();
    mkdirSync(join(dir, "report"));
    mkdirSync(join(dir, "outside"));
    writeFileSync(join(dir, "outside/key"), "x");
    symlinkSync(join(dir, "outside/key"), join(dir, "report/link"));
    symlinkSync(join(dir, "outside"), join(dir, "report/dir"));
    expect(() => containedFile(join(dir, "report"), "link")).toThrow(/regular file/);
    expect(() => containedFile(join(dir, "report"), "dir/key")).toThrow(/symlink/);
  });
});

describe("outDir", () => {
  it("makes a fresh private temp directory when --out is not given", () => {
    const a = outDir(undefined, "123");
    const b = outDir(undefined, "123");
    try {
      expect(a).not.toBe(b);
      expect(lstatSync(a).isDirectory()).toBe(true);
    } finally {
      rmSync(a, { recursive: true, force: true });
      rmSync(b, { recursive: true, force: true });
    }
  });

  it("accepts a real directory and refuses a symlink", () => {
    const dir = fresh();
    expect(outDir(join(dir, "out"), "1")).toBe(join(dir, "out"));
    symlinkSync(join(dir, "out"), join(dir, "link"));
    expect(() => outDir(join(dir, "link"), "1")).toThrow(/not a real directory/);
  });
});
