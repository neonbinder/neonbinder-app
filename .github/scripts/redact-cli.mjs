// stdin -> stdout through the suite's one scrubber (apps/web/playwright/support/
// redact.mjs), line by line. This is what `redact-ci-log.sh` runs.
//
//   REDACT_LITERALS=$'name1\nname2' node redact-cli.mjs < raw > safe
//   node redact-cli.mjs --md-rows 160 < rows.tsv > rows.md
//
// `--md-rows N` is for the run summary's tables: each input line is TSV (as
// `jq @tsv` writes it, a newline inside a cell being the two characters `\n`),
// every cell is redacted ON ITS OWN and IN FULL, and only then is the last cell
// cut to its first line and N characters (cutting first once left an email or a
// host half-masked). Output is one markdown table row per line, pipes escaped.
//
// Fails closed: the whole input is read and redacted before anything is
// written, so an error leaves stdout empty and the exit code non-zero, and the
// caller drops the artifact. A line that was valid JSON stays valid JSON; if a
// rule would have broken it (a bare number under a secret-named key), the line
// is replaced with a fixed placeholder rather than published half-masked.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const { redact, redactLiterals } = await import(
  join(here, "..", "..", "apps", "web", "playwright", "support", "redact.mjs")
);

const isJson = (line) => {
  try {
    JSON.parse(line);
    return true;
  } catch {
    return false;
  }
};

const mdRows = process.argv[2] === "--md-rows" ? Number(process.argv[3]) : 0;
if (process.argv[2] === "--md-rows" && !(mdRows > 0)) {
  process.stderr.write("redact-cli: --md-rows needs a positive length\n");
  process.exit(2);
}

/** @param {string} line */
function mdRow(line) {
  const cells = line.split("\t").map((cell) => redact(redactLiterals(cell, literals)));
  const last = cells.length - 1;
  cells[last] = cells[last].split("\\n")[0].slice(0, mdRows).trim();
  return `| ${cells.map((c) => c.replace(/\|/g, "\\|")).join(" | ")} |`;
}

// The rules are quadratic on very long [\w.-] runs (about 1 s per 20k characters),
// so a line over the cap is never passed through them, and never published raw.
const MAX_LINE = 8000;
/** @param {string} line */
const guard = (line) => (line.length > MAX_LINE ? `[line truncated: ${line.length} chars]` : line);

const literals = (process.env.REDACT_LITERALS ?? "").split("\n");

try {
  const input = readFileSync(0, "utf8");
  if (mdRows) {
    const rows = input.split("\n").filter((l) => l !== "").map((l) => mdRow(guard(l)));
    process.stdout.write(rows.length ? `${rows.join("\n")}\n` : "");
    process.exit(0);
  }
  const out = input
    .split("\n")
    .map((raw) => {
      const line = guard(raw);
      const safe = redact(redactLiterals(line, literals));
      return safe !== line && isJson(line) && !isJson(safe) ? '{"redacted":"line withheld"}' : safe;
    })
    .join("\n");
  process.stdout.write(out);
} catch (error) {
  process.stderr.write(`redact-cli: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
