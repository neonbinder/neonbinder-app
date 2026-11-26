/**
 * NEO-676, invariant 4: the walk-and-match behind `mlbamId.invariantPin.test.ts`.
 *
 * Pure (the file system is injected) so the pin can be shown to FAIL on a
 * planted file as well as pass on the real tree; a pin that has never been seen
 * to flag anything proves nothing. May not import `node:*`: this directory is
 * bundled by Convex.
 */

/** Just enough of a file system to walk a tree and read a file. */
export type PinFs = {
  /** Names directly inside `dir`. */
  readdir: (dir: string) => string[];
  isDirectory: (path: string) => boolean;
  readFile: (path: string) => string;
  join: (dir: string, name: string) => string;
};

const SOURCE_FILE = /\.(ts|tsx|js|jsx|mjs)$/;

/** Every source file under `dir`, skipping `node_modules`. */
export function walkSourceFiles(fs: PinFs, dir: string, out: string[] = []): string[] {
  for (const name of fs.readdir(dir)) {
    if (name === "node_modules") continue;
    const full = fs.join(dir, name);
    if (fs.isDirectory(full)) walkSourceFiles(fs, full, out);
    else if (SOURCE_FILE.test(name)) out.push(full);
  }
  return out;
}

/** The files among `files` that name an MLB id, in any case. */
export function filesNamingMlbam(fs: PinFs, files: ReadonlyArray<string>): string[] {
  return files.filter((f) => /mlbam/i.test(fs.readFile(f)));
}

/** Walk every dir and return the files that name an MLB id, plus how many were scanned. */
export function scanForMlbam(
  fs: PinFs,
  dirs: ReadonlyArray<string>,
): { scanned: number; hits: string[] } {
  const files = dirs.flatMap((d) => walkSourceFiles(fs, d));
  return { scanned: files.length, hits: filesNamingMlbam(fs, files) };
}
