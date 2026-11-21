/**
 * NEO-591 — pure helpers for the slow-test guard (verify-test-duration.mjs).
 *
 * A unit test that needs seconds is either waiting on the wall clock or
 * rendering far more than the unit under test. Both fail only under load, as a
 * random red, so the run fails on the slow test itself, by name, before load
 * can turn it into a timeout.
 */

/** A single test over this many ms fails the run. The default vitest timeout is 5s. */
export const MAX_TEST_MS = 2000;

/**
 * Every finished test in a vitest JSON report with its duration.
 * Skipped and todo tests carry no meaningful duration and are left out.
 */
export function collectDurations(report) {
  const out = [];
  for (const file of report?.testResults ?? []) {
    for (const t of file.assertionResults ?? []) {
      if (t.status !== "passed" && t.status !== "failed") continue;
      if (typeof t.duration !== "number") continue;
      out.push({
        file: file.name,
        title: t.fullName ?? [...(t.ancestorTitles ?? []), t.title].join(" > "),
        ms: t.duration,
      });
    }
  }
  return out;
}

/** The tests over the limit, slowest first. */
export function findSlow(durations, limit = MAX_TEST_MS) {
  return durations.filter((d) => d.ms > limit).sort((a, b) => b.ms - a.ms);
}

/**
 * Of the tests flagged in the full run, keep those that are STILL over the
 * limit when their file runs alone. A full run on a shared machine can starve
 * a worker and stretch a 0.7 s test past 2 s; running the file alone takes
 * that away, while a real wall-clock wait (a planted sleep, a retry delay) or
 * an oversized render stays slow. A flagged test that is missing from the
 * alone-run (renamed, skipped, or the rerun died) is kept: fail closed.
 */
export function confirmSlow(flagged, aloneDurations, limit = MAX_TEST_MS) {
  const alone = new Map(aloneDurations.map((d) => [`${d.file}\0${d.title}`, d.ms]));
  return flagged.filter((f) => {
    const ms = alone.get(`${f.file}\0${f.title}`);
    return ms === undefined || ms > limit;
  }).map((f) => ({ ...f, aloneMs: alone.get(`${f.file}\0${f.title}`) }));
}
