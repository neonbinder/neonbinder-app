/**
 * NEO-616 — corpus regression guard for the published-checklist parser.
 *
 * Adding a layout to `parse-published-checklist.ts` must not change how any
 * file that already reads, reads. This file pins that. It snapshots, as
 * committed files under `__corpus__/`:
 *
 *  1. every file in `playwright/fixtures/checklists/`, once per mode
 *     ("leaf" and "set"): the file as read (spreadsheet records / PDF lines),
 *     the full `PublishedChecklistParse` (rows, skipped, format, subsets,
 *     groups, ...) and `checklistSections` of it. Each file goes through
 *     `readChecklistFile` (the real reader for its type), with the set year
 *     taken from the file name's leading four digits, as the app passes it;
 *  2. every input the three existing parser test files feed the parser
 *     (`parse-published-checklist.test.ts`, `read-checklist-file.test.ts`,
 *     `checklist-sections.test.ts`), recorded by wrapping the parser
 *     entry points while those files' tests run here. Those files keep
 *     asserting behaviour; this only pins the whole output for each input.
 *
 * A change that is meant to alter an existing reading shows up as a snapshot
 * diff to review; run `vitest -u` only after reading it. A new fixture with no
 * snapshot is written on a local run and fails in CI.
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { checklistSections } from "./checklist-sections";
import { parseChecklistInput, readChecklistFile } from "./read-checklist-file";
import { readPdfLines } from "./read-pdf-lines";

// ── Recording the existing tests' inputs ───────────────────────────────────

type Recorded = { test: string; fn: string; args: unknown[]; result: unknown };

const recorded = vi.hoisted(() => ({ calls: [] as Recorded[] }));

function record(fn: string, args: unknown[], result: unknown): void {
  recorded.calls.push({
    test: expect.getState().currentTestName ?? "(outside a test)",
    fn,
    args,
    result,
  });
}

vi.mock("./parse-published-checklist", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./parse-published-checklist")>();
  return {
    ...actual,
    parsePublishedChecklist: (...args: Parameters<typeof actual.parsePublishedChecklist>) => {
      const result = actual.parsePublishedChecklist(...args);
      record("parsePublishedChecklist", args, result);
      return result;
    },
    parsePublishedChecklistCells: (...args: Parameters<typeof actual.parsePublishedChecklistCells>) => {
      const result = actual.parsePublishedChecklistCells(...args);
      record("parsePublishedChecklistCells", args, result);
      return result;
    },
  };
});

vi.mock("./checklist-sections", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./checklist-sections")>();
  return {
    ...actual,
    checklistSections: (...args: Parameters<typeof actual.checklistSections>) => {
      const result = actual.checklistSections(...args);
      record("checklistSections", args, result);
      return result;
    },
  };
});

// The fixture tests below also pass through the wrappers; their calls carry
// this file's own test names and are filtered out of the inline snapshot.

// Registering the three files here runs their tests in this file too, in
// order, before the tests below; the recorded calls are snapshotted last.
await import("./parse-published-checklist.test");
await import("./read-checklist-file.test");
await import("./checklist-sections.test");

// ── Fixtures ───────────────────────────────────────────────────────────────

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "../../playwright/fixtures/checklists");
const SNAPSHOTS = join(HERE, "__corpus__");

const FIXTURE_FILES = readdirSync(FIXTURES)
  .filter((f) => [".csv", ".tsv", ".txt", ".xlsx", ".pdf"].includes(extname(f).toLowerCase()))
  .sort();

/** pdf.js for Node: the legacy build, as `read-pdf-lines.test.ts` loads it. */
async function nodePdfjs() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const require = createRequire(import.meta.url);
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
    require.resolve("pdfjs-dist/legacy/build/pdf.worker.min.mjs"),
  ).href;
  return pdfjs;
}

/**
 * Pretty JSON that keeps any value that fits on one line (120 chars) on one
 * line, so a row is one line in a diff and the files stay small.
 */
function json(value: unknown): string {
  const render = (v: unknown, indent: string): string => {
    const flat = JSON.stringify(v);
    if (flat === undefined) return "null";
    if (flat.length + indent.length <= 120 || typeof v !== "object" || v === null) return flat;
    const inner = `${indent}  `;
    if (Array.isArray(v)) {
      return `[\n${v.map((x) => inner + render(x, inner)).join(",\n")}\n${indent}]`;
    }
    const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined);
    return `{\n${entries.map(([k, x]) => `${inner}${JSON.stringify(k)}: ${render(x, inner)}`).join(",\n")}\n${indent}}`;
  };
  return `${render(value, "")}\n`;
}

describe("published-checklist corpus: every fixture file, in leaf and set mode", () => {
  it("finds the fixtures it is meant to pin", () => {
    // Not a snapshot: a guard that the directory read did not come back empty.
    expect(FIXTURE_FILES.length).toBeGreaterThan(30);
    const types = new Set(FIXTURE_FILES.map((f) => extname(f).toLowerCase()));
    expect([...types].sort()).toEqual([".csv", ".pdf", ".xlsx"]);
  });

  for (const fileName of FIXTURE_FILES) {
    for (const mode of ["leaf", "set"] as const) {
      it(`${fileName} reads the same in ${mode} mode`, async () => {
        const bytes = readFileSync(join(FIXTURES, fileName));
        const read = await readChecklistFile(
          {
            name: fileName,
            size: bytes.length,
            arrayBuffer: async () =>
              bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
          },
          extname(fileName).toLowerCase() === ".pdf"
            ? { readPdf: async (b) => readPdfLines(b, { pdfjs: await nodePdfjs() }) }
            : {},
        );
        if (!read.ok) {
          // A refusal is part of the reading too; pin it.
          await expect(json({ refused: read })).toMatchFileSnapshot(
            join(SNAPSHOTS, "fixtures", `${fileName}.${mode}.json`),
          );
          return;
        }
        const year = /^(\d{4})/.exec(fileName)?.[1];
        const options = { ...(year ? { setYear: year } : {}), mode };
        const parse = parseChecklistInput(read.input, options);
        const sections = checklistSections(parse);
        const body = {
          file: fileName,
          mode,
          options,
          // The reader's output for a workbook or PDF; a text file is its own bytes.
          read: read.input.kind === "text" ? { kind: "text" } : read.input,
          parse,
          sections,
        };
        await expect(json(body)).toMatchFileSnapshot(
          join(SNAPSHOTS, "fixtures", `${fileName}.${mode}.json`),
        );
      }, 30_000);
    }
  }
});

// ── Inline inputs ──────────────────────────────────────────────────────────

/** Long strings and outputs are pinned by length and hash, not stored whole. */
function shrink(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, v) => {
      if (typeof v === "string" && v.length > 800) {
        return { chars: v.length, sha1: createHash("sha1").update(v).digest("hex") };
      }
      if (Array.isArray(v) && v.length > 40) {
        return {
          items: v.length,
          sha1: createHash("sha1").update(JSON.stringify(v)).digest("hex"),
          first: v.slice(0, 3),
          last: v.slice(-3),
        };
      }
      return v;
    }),
  );
}

describe("published-checklist corpus: the inputs the existing parser tests use", () => {
  it("reads every recorded input the same as before", async () => {
    const calls = recorded.calls.filter((c) => !c.test.startsWith("published-checklist corpus"));
    // The three files hold hundreds of cases; an empty list means the wrap broke.
    expect(calls.length).toBeGreaterThan(150);
    const body = calls.map((c) => ({
      test: c.test,
      fn: c.fn,
      args: shrink(c.args),
      result: shrink(c.result),
    }));
    await expect(json(body)).toMatchFileSnapshot(join(SNAPSHOTS, "inline-inputs.json"));
  });
});
