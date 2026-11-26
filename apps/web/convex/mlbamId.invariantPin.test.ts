/**
 * NEO-676, invariant 4: an MLB id is linkage, never something user-facing reads.
 *
 * No component, route, hook or browser-side helper may mention `mlbamId`. The
 * id lives in Convex rows and in the loader that writes it; the one place a
 * client could see it is a whole-document reader, and nothing in the client
 * ever names it.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { scanForMlbam, type PinFs } from "./lib/mlbamClientPin";

const APP_ROOT = resolve(__dirname, "..");
const CLIENT_DIRS = ["components", "app", "src", "lib"];

const realFs: PinFs = {
  readdir: (dir) => readdirSync(dir),
  isDirectory: (path) => statSync(path).isDirectory(),
  readFile: (path) => readFileSync(path, "utf8"),
  join,
};

/** An in-memory tree: a path maps to its content; directories are the prefixes. */
function fakeFs(files: Record<string, string>): PinFs {
  const paths = Object.keys(files);
  return {
    readdir: (dir) => {
      const prefix = dir === "" ? "" : `${dir}/`;
      return [
        ...new Set(
          paths.filter((p) => p.startsWith(prefix)).map((p) => p.slice(prefix.length).split("/")[0]),
        ),
      ];
    },
    isDirectory: (path) => paths.some((p) => p.startsWith(`${path}/`)),
    readFile: (path) => files[path],
    join: (dir, name) => (dir === "" ? name : `${dir}/${name}`),
  };
}

describe("NEO-676 invariant 4: no client code reads mlbamId", () => {
  test("components/, app/, src/ and the non-convex lib/ never name it", () => {
    const { scanned, hits } = scanForMlbam(
      realFs,
      CLIENT_DIRS.map((d) => join(APP_ROOT, d)),
    );
    // The pin means something only if it scanned the client.
    expect(scanned).toBeGreaterThan(100);
    expect(hits.map((f) => f.slice(APP_ROOT.length + 1))).toEqual([]);
  });

  test("the walk flags a planted file that names it, in any case", () => {
    const fs = fakeFs({
      "components/Card.tsx": "export const a = 1;",
      "components/deep/Row.tsx": "const id = row.externalIds?.mlbamId;",
      "src/hooks/use-thing.ts": "const x = player.MLBAMid;",
      "src/notes.md": "mlbamId in a markdown file is not source",
      "components/node_modules/pkg/index.js": "mlbamId",
    });
    const { scanned, hits } = scanForMlbam(fs, ["components", "src"]);
    expect(scanned).toBe(3);
    expect(hits.sort()).toEqual(["components/deep/Row.tsx", "src/hooks/use-thing.ts"]);
  });

  test("the walk reports nothing on a clean tree", () => {
    const fs = fakeFs({ "components/Card.tsx": "export const a = 1;" });
    expect(scanForMlbam(fs, ["components"])).toEqual({ scanned: 1, hits: [] });
  });
});
